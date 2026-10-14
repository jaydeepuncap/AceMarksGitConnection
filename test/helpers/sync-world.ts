/**
 * A fake "world" for Theme Sync tests: a GitHub repository with a linear
 * history (C1 → C2 → C3, plus extra commits tests can add) and Shopify stores
 * whose themes are in-memory file systems behind the Admin GraphQL API.
 *
 *   C1  Add custom CSS              (the update both themes start on)
 *   C2  Update product template     + snippets/size-chart.liquid  ~ sections/main-product.liquid
 *                                   − snippets/old-badge.liquid   ~ templates/product.json (protected)
 *   C3  Update cart functionality   + snippets/cart-item.liquid   ~ sections/cart.liquid
 *                                   ~ assets/cart.css             − snippets/old-cart.liquid  + assets/logo.png
 */
import { createHash } from 'node:crypto';
import { graphqlHandler, installFetchMock, json } from './fetch-mock';
import { THEME_DEV, THEME_LIVE } from './fixtures';

export const blobSha = (content: string | Buffer) => {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
};
const md5 = (content: string | Buffer) => createHash('md5').update(content).digest('hex');

export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);

export const C1 = '1'.repeat(40);
export const C2 = '2'.repeat(40);
export const C3 = '3'.repeat(40);

type Files = Record<string, string | Buffer>;

const FILES_C1: Files = {
  'layout/theme.liquid': '<html>{{ content_for_layout }}</html>',
  'sections/header.liquid': '<header>{{ shop.name }}</header>',
  'sections/main-product.liquid': '<div>{{ product.title }}</div>',
  'sections/cart.liquid': '{% if cart.item_count > 0 %}<ul></ul>{% endif %}',
  'snippets/old-badge.liquid': '<span>badge</span>',
  'snippets/old-cart.liquid': '<div>old cart</div>',
  'assets/cart.css': '.cart{color:red}',
  'config/settings_data.json': '{"current":"Default"}',
  'templates/product.json': '{"sections":{}, "order": []}',
  'README.md': '# Master theme',
};

const FILES_C2: Files = {
  ...FILES_C1,
  'snippets/size-chart.liquid': '<table>size chart</table>',
  'sections/main-product.liquid': '<div>{{ product.title }}{% render "size-chart" %}</div>',
  'templates/product.json': '{"sections":{"main":{}}, "order": ["main"]}',
};
delete FILES_C2['snippets/old-badge.liquid'];

const FILES_C3: Files = {
  ...FILES_C2,
  'snippets/cart-item.liquid': '<li>{{ item.title }}</li>',
  'sections/cart.liquid': '{% for item in cart.items %}{% render "cart-item", item: item %}{% endfor %}',
  'assets/cart.css': '.cart{color:blue}',
  'assets/logo.png': PNG,
};
delete FILES_C3['snippets/old-cart.liquid'];

interface Commit {
  sha: string;
  message: string;
  date: string;
  files: Files;
}

export interface WorldOptions {
  /** Filenames whose upsert returns a userError. */
  rejectUpserts?: Set<string>;
  /** Serve wrong bytes for this path (integrity failure). */
  corrupt?: string;
  /** Return ACCESS_DENIED for theme writes (no exemption). */
  denyWrites?: boolean;
}

interface ThemeFile {
  type: 'TEXT' | 'BASE64';
  value: string;
  updatedAt: string;
}

const bytesOf = (f: ThemeFile) => (f.type === 'TEXT' ? Buffer.from(f.value) : Buffer.from(f.value, 'base64'));
const toThemeFile = (content: string | Buffer, updatedAt = '2026-10-01T00:00:00Z'): ThemeFile =>
  typeof content === 'string' ? { type: 'TEXT', value: content, updatedAt } : { type: 'BASE64', value: content.toString('base64'), updatedAt };

/** Theme content for a set of repository files (only theme directories). */
export function themeFilesFor(files: Files): Map<string, ThemeFile> {
  return new Map(
    Object.entries(files)
      .filter(([path]) => /^(assets|config|layout|sections|snippets|templates|locales|blocks)\//.test(path))
      .map(([path, content]) => [path, toThemeFile(content)]),
  );
}

export function installWorld(opts: WorldOptions = {}) {
  const mock = installFetchMock();
  const history: Commit[] = [
    { sha: C1, message: 'Add custom CSS', date: '2026-10-04T10:00:00Z', files: FILES_C1 },
    { sha: C2, message: 'Update product template', date: '2026-10-05T10:00:00Z', files: FILES_C2 },
    { sha: C3, message: 'Update cart functionality', date: '2026-10-06T10:00:00Z', files: FILES_C3 },
  ];
  const bySha = () => new Map(history.map((c) => [c.sha, c]));
  const blobs = () => {
    const out = new Map<string, Buffer>();
    for (const c of history) for (const content of Object.values(c.files)) {
      const buf = typeof content === 'string' ? Buffer.from(content) : content;
      out.set(blobSha(buf), buf);
    }
    return out;
  };

  /** Themes per shop domain → theme id → files. */
  const stores = new Map<string, Map<string, Map<string, ThemeFile>>>();
  const themesFor = (shop: string) => {
    let themes = stores.get(shop);
    if (!themes) {
      themes = new Map([
        [THEME_DEV.id, themeFilesFor(FILES_C1)],
        [THEME_LIVE.id, themeFilesFor(FILES_C1)],
      ]);
      stores.set(shop, themes);
    }
    return themes;
  };
  const upserts: { shop: string; themeId: string; files: { filename: string; body: { type: string; value: string } }[] }[] = [];
  const deletes: { shop: string; themeId: string; files: string[] }[] = [];

  function commitDiff(commit: Commit) {
    const index = history.indexOf(commit);
    const parent = index > 0 ? history[index - 1]!.files : {};
    const out: { filename: string; status: string; sha: string | null }[] = [];
    for (const [path, content] of Object.entries(commit.files)) {
      const before = parent[path];
      if (before === undefined) out.push({ filename: path, status: 'added', sha: blobSha(content) });
      else if (blobSha(before) !== blobSha(content)) out.push({ filename: path, status: 'modified', sha: blobSha(content) });
    }
    for (const path of Object.keys(parent)) if (!(path in commit.files)) out.push({ filename: path, status: 'removed', sha: null });
    return out;
  }

  const rawCommit = (c: Commit) => ({
    sha: c.sha,
    html_url: `https://github.com/acme/theme/commit/${c.sha}`,
    commit: { message: c.message, author: { name: 'Dev', date: c.date }, committer: null, tree: { sha: `tree-${c.sha}` } },
    author: { login: 'dev', avatar_url: '' },
    parents: history.indexOf(c) > 0 ? [{ sha: history[history.indexOf(c) - 1]!.sha }] : [],
  });

  // --- GitHub ---
  mock.on((req) => {
    const url = new URL(req.url);
    if (url.hostname !== 'api.github.com') return undefined;
    const path = url.pathname;
    if (path === '/user') return json({ login: 'octocat', type: 'User' });
    if (path === '/repos/acme/theme') {
      return json({ id: 1, full_name: 'acme/theme', name: 'theme', owner: { login: 'acme' }, private: true, default_branch: 'main', html_url: '', updated_at: null, permissions: { pull: true } });
    }
    if (path === '/repos/acme/theme/branches/main') return json({ name: 'main', commit: { sha: history.at(-1)!.sha }, protected: false });
    if (path === '/repos/acme/theme/commits') {
      const ref = url.searchParams.get('sha') ?? 'main';
      const perPage = Number(url.searchParams.get('per_page') ?? 30);
      const page = Number(url.searchParams.get('page') ?? 1);
      const end = ref === 'main' ? history.length : history.findIndex((c) => c.sha === ref) + 1;
      if (end === 0) return json({ message: 'No commit found for SHA' }, { status: 404 });
      const newestFirst = history.slice(0, end).reverse();
      const items = newestFirst.slice((page - 1) * perPage, page * perPage);
      const hasNext = page * perPage < newestFirst.length;
      return json(items.map(rawCommit), { headers: hasNext ? { link: '<https://api.github.com/x?page=2>; rel="next"' } : {} });
    }
    const commitMatch = /^\/repos\/acme\/theme\/commits\/([0-9a-f]{40})$/.exec(path);
    if (commitMatch) {
      const commit = bySha().get(commitMatch[1]!);
      if (!commit) return json({ message: 'No commit found for SHA' }, { status: 422 });
      const files = commitDiff(commit).map((f) => ({ ...f, additions: 1, deletions: 1, changes: 2 }));
      return json({ ...rawCommit(commit), stats: { additions: 1, deletions: 1, total: 2 }, files });
    }
    const treeMatch = /^\/repos\/acme\/theme\/git\/trees\/tree-([0-9a-f]{40})$/.exec(path);
    if (treeMatch) {
      const commit = bySha().get(treeMatch[1]!);
      if (!commit) return json({ message: 'Not Found' }, { status: 404 });
      const tree = Object.entries(commit.files).map(([p, content]) => ({
        path: p,
        mode: '100644',
        type: 'blob',
        sha: blobSha(content),
        size: Buffer.byteLength(content),
      }));
      return json({ tree, truncated: false });
    }
    const blobMatch = /^\/repos\/acme\/theme\/git\/blobs\/([0-9a-f]{40})$/.exec(path);
    if (blobMatch) {
      const blob = blobs().get(blobMatch[1]!);
      if (!blob) return json({ message: 'Not Found' }, { status: 404 });
      return json({ content: blob.toString('base64'), encoding: 'base64' });
    }
    const contentMatch = /^\/repos\/acme\/theme\/contents\/(.+)$/.exec(path);
    if (contentMatch) {
      const filePath = decodeURIComponent(contentMatch[1]!);
      const content = bySha().get(url.searchParams.get('ref')!)?.files[filePath];
      if (content === undefined) return json({ message: 'Not Found' }, { status: 404 });
      return new Response(filePath === opts.corrupt ? 'tampered' : content);
    }
    return undefined;
  });

  // --- Shopify Admin GraphQL (per shop) ---
  if (opts.denyWrites) {
    mock.on((req) =>
      req.url.includes('/graphql.json') && /mutation AceThemeFiles/.test(req.body ?? '')
        ? json({ errors: [{ message: 'Access denied for themeFilesUpsert field.', extensions: { code: 'ACCESS_DENIED' } }] })
        : undefined,
    );
  }
  mock.on((req) => {
    if (!req.url.includes('/graphql.json')) return undefined;
    const shop = new URL(req.url).hostname;
    const themes = themesFor(shop);
    const themeList = [THEME_DEV, THEME_LIVE];
    let clock = Date.parse('2026-10-10T00:00:00Z');
    const now = () => new Date((clock += 1000)).toISOString();
    return graphqlHandler({
      AceShop: () => ({ shop: { name: shop.split('.')[0]!.toUpperCase(), myshopifyDomain: shop } }),
      AceTheme: (v) => ({ theme: themeList.find((t) => t.id === v.id) ?? null }),
      AceThemes: () => ({ themes: { nodes: themeList, pageInfo: { hasNextPage: false, endCursor: null } } }),
      AceJob: () => ({ job: { id: 'gid://shopify/Job/1', done: true } }),
      AceThemeFiles: (v) => {
        const files = themes.get(v.id as string);
        if (!files) return { theme: null };
        const names = (v.filenames as string[] | null) ?? [...files.keys()];
        return {
          theme: {
            id: v.id,
            files: {
              nodes: names
                .filter((n) => files.has(n))
                .map((n) => {
                  const f = files.get(n)!;
                  return { filename: n, size: String(bytesOf(f).length), checksumMd5: md5(bytesOf(f)), updatedAt: f.updatedAt };
                }),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      },
      AceThemeFileBodies: (v) => {
        const files = themes.get(v.id as string);
        if (!files) return { theme: null };
        return {
          theme: {
            id: v.id,
            files: {
              nodes: (v.filenames as string[])
                .filter((n) => files.has(n))
                .map((n) => {
                  const f = files.get(n)!;
                  return {
                    filename: n,
                    checksumMd5: md5(bytesOf(f)),
                    body:
                      f.type === 'TEXT'
                        ? { __typename: 'OnlineStoreThemeFileBodyText', content: f.value }
                        : { __typename: 'OnlineStoreThemeFileBodyBase64', contentBase64: f.value },
                  };
                }),
            },
          },
        };
      },
      AceThemeFilesUpsert: (v) => {
        const files = v.files as { filename: string; body: { type: 'TEXT' | 'BASE64'; value: string } }[];
        upserts.push({ shop, themeId: v.themeId as string, files });
        const ok = files.filter((f) => !opts.rejectUpserts?.has(f.filename));
        for (const f of ok) themes.get(v.themeId as string)!.set(f.filename, { ...f.body, updatedAt: now() });
        return {
          themeFilesUpsert: {
            upsertedThemeFiles: ok.map((f) => ({ filename: f.filename })),
            job: { id: 'gid://shopify/Job/1', done: true },
            userErrors: files
              .filter((f) => opts.rejectUpserts?.has(f.filename))
              .map((f) => ({ field: ['files'], filename: f.filename, code: 'THROTTLED', message: 'Temporary Shopify issue' })),
          },
        };
      },
      AceThemeFilesDelete: (v) => {
        const files = v.files as string[];
        deletes.push({ shop, themeId: v.themeId as string, files });
        const store = themes.get(v.themeId as string)!;
        const existing = files.filter((f) => store.has(f));
        for (const f of existing) store.delete(f);
        return {
          themeFilesDelete: {
            deletedThemeFiles: existing.map((filename) => ({ filename })),
            userErrors: files.filter((f) => !existing.includes(f)).map((filename) => ({ field: null, filename, code: 'NOT_FOUND', message: 'File not found' })),
          },
        };
      },
    })(req);
  });

  return {
    mock,
    upserts,
    deletes,
    history,
    /** Theme files of a store (created on first access with both themes on C1). */
    theme: (shop: string, themeId: string) => themesFor(shop).get(themeId)!,
    /** Adds a commit on top of the branch. */
    addCommit(sha: string, message: string, change: (files: Files) => Files) {
      history.push({ sha, message, date: '2026-10-07T10:00:00Z', files: change({ ...history.at(-1)!.files }) });
    },
    /** Simulates an edit made directly in the Shopify code editor. */
    editInShopify(shop: string, themeId: string, path: string, value: string) {
      themesFor(shop).get(themeId)!.set(path, { type: 'TEXT', value, updatedAt: '2026-10-05T09:00:00Z' });
    },
  };
}

export const REPO_FILES = { C1: FILES_C1, C2: FILES_C2, C3: FILES_C3 };
