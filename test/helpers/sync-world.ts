/**
 * A fake "world" for sync tests: a GitHub repo with two commits (B and D) that
 * both change sections/header.liquid, and a Shopify store with an in-memory
 * theme file system behind the GraphQL API.
 */
import { createHash } from 'node:crypto';
import { graphqlHandler, installFetchMock, json } from './fetch-mock';
import { SHA_B, SHA_D, THEME_DEV, THEME_LIVE } from './fixtures';

export const blobSha = (content: string | Buffer) => {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
};

export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);

/** Repository content per commit. */
export const REPO: Record<string, Record<string, string | Buffer>> = {
  [SHA_B]: {
    'sections/header.liquid': '<header>B</header>',
    'snippets/new.liquid': 'new at B',
    'assets/logo.png': PNG,
    'config/settings_data.json': '{"current":"B"}',
    'README.md': '# readme',
    'layout/theme.liquid': '<html>{{ content_for_layout }}</html>',
  },
  [SHA_D]: { 'sections/header.liquid': '<header>D</header>' },
};

export const COMMIT_B_FILES = [
  { filename: 'sections/header.liquid', status: 'modified' },
  { filename: 'snippets/new.liquid', status: 'renamed', previous_filename: 'snippets/old.liquid' },
  { filename: 'assets/logo.png', status: 'added' },
  { filename: 'config/settings_data.json', status: 'modified' },
  { filename: 'README.md', status: 'modified' },
  { filename: 'snippets/gone.liquid', status: 'removed' },
  { filename: 'sections/../../evil.liquid', status: 'added' },
];

export interface WorldOptions {
  /** Filenames whose upsert returns a userError. */
  rejectUpserts?: Set<string>;
  /** Serve wrong bytes for this path (integrity failure). */
  corrupt?: string;
  /** Return ACCESS_DENIED for theme writes (no exemption). */
  denyWrites?: boolean;
}

export function installWorld(opts: WorldOptions = {}) {
  const mock = installFetchMock();
  const themeFiles = new Map<string, Map<string, string>>([
    [THEME_DEV.id, new Map([['sections/header.liquid', 'old'], ['snippets/old.liquid', 'old'], ['snippets/gone.liquid', 'x'], ['layout/theme.liquid', 'x']])],
    [THEME_LIVE.id, new Map([['sections/header.liquid', 'old']])],
  ]);
  const themes = [THEME_DEV, THEME_LIVE];
  const upserts: { themeId: string; files: { filename: string; body: { type: string; value: string } }[] }[] = [];
  const deletes: { themeId: string; files: string[] }[] = [];

  // --- GitHub ---
  mock.on((req) => {
    const url = new URL(req.url);
    if (url.hostname !== 'api.github.com') return undefined;
    const commitMatch = /^\/repos\/acme\/theme\/commits\/([0-9a-f]{40})$/.exec(url.pathname);
    if (commitMatch) {
      const sha = commitMatch[1]!;
      if (sha !== SHA_B && sha !== SHA_D) return json({ message: 'No commit found' }, { status: 422 });
      const files = (sha === SHA_B ? COMMIT_B_FILES : [{ filename: 'sections/header.liquid', status: 'modified' }]).map((f) => ({
        ...f,
        additions: 1,
        deletions: 1,
        changes: 2,
        sha: f.status === 'removed' ? null : blobSha(REPO[sha]![f.filename] ?? ''),
      }));
      return json({
        sha,
        html_url: `https://github.com/acme/theme/commit/${sha}`,
        commit: { message: `Commit ${sha[0]}`, author: { name: 'Dev', date: '2026-01-01T00:00:00Z' }, committer: null, tree: { sha: `tree${sha}`.slice(0, 40) } },
        author: { login: 'dev', avatar_url: '' },
        parents: [{ sha: 'p'.repeat(40) }],
        stats: { additions: 1, deletions: 1, total: 2 },
        files,
      });
    }
    const treeMatch = /^\/repos\/acme\/theme\/git\/trees\/(.+)$/.exec(url.pathname);
    if (treeMatch) {
      const entries = Object.entries(REPO[SHA_B]!).map(([path, content]) => ({
        path,
        mode: '100644',
        type: 'blob',
        sha: blobSha(content),
        size: Buffer.byteLength(content),
      }));
      return json({ tree: entries, truncated: false });
    }
    const contentMatch = /^\/repos\/acme\/theme\/contents\/(.+)$/.exec(url.pathname);
    if (contentMatch) {
      const path = decodeURIComponent(contentMatch[1]!);
      const ref = url.searchParams.get('ref')!;
      const content = REPO[ref]?.[path];
      if (content === undefined) return json({ message: 'Not Found' }, { status: 404 });
      return new Response(path === opts.corrupt ? 'tampered' : content);
    }
    return undefined;
  });

  // --- Shopify Admin GraphQL ---
  if (opts.denyWrites) {
    mock.on((req) =>
      req.url.includes('/graphql.json') && /mutation AceThemeFiles/.test(req.body ?? '')
        ? json({ errors: [{ message: 'Access denied for themeFilesUpsert field.', extensions: { code: 'ACCESS_DENIED' } }] })
        : undefined,
    );
  }
  mock.on(
    graphqlHandler({
      AceTheme: (v) => ({ theme: themes.find((t) => t.id === v.id) ?? null }),
      AceThemes: () => ({ themes: { nodes: themes, pageInfo: { hasNextPage: false, endCursor: null } } }),
      AceThemeFiles: (v) => {
        const files = themeFiles.get(v.id as string);
        if (!files) return { theme: null };
        const names = (v.filenames as string[] | null) ?? [...files.keys()];
        return {
          theme: {
            id: v.id,
            files: {
              nodes: names.filter((n) => files.has(n)).map((n) => ({ filename: n, size: String(files.get(n)!.length), checksumMd5: null })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      },
      AceThemeFileBodies: (v) => {
        const files = themeFiles.get(v.id as string);
        if (!files) return { theme: null };
        return {
          theme: {
            id: v.id,
            files: {
              nodes: (v.filenames as string[])
                .filter((n) => files.has(n))
                .map((n) => ({ filename: n, body: { __typename: 'OnlineStoreThemeFileBodyText', content: files.get(n)! } })),
            },
          },
        };
      },
      AceThemeFilesUpsert: (v) => {
        const files = v.files as { filename: string; body: { type: string; value: string } }[];
        upserts.push({ themeId: v.themeId as string, files });
        const ok = files.filter((f) => !opts.rejectUpserts?.has(f.filename));
        for (const f of ok) themeFiles.get(v.themeId as string)!.set(f.filename, f.body.value);
        return {
          themeFilesUpsert: {
            upsertedThemeFiles: ok.map((f) => ({ filename: f.filename })),
            job: { id: 'gid://shopify/Job/1', done: true },
            userErrors: files
              .filter((f) => opts.rejectUpserts?.has(f.filename))
              .map((f) => ({ field: ['files'], filename: f.filename, code: 'INVALID', message: 'Liquid syntax error' })),
          },
        };
      },
      AceThemeFilesDelete: (v) => {
        const files = v.files as string[];
        deletes.push({ themeId: v.themeId as string, files });
        const store = themeFiles.get(v.themeId as string)!;
        const existing = files.filter((f) => store.has(f));
        for (const f of existing) store.delete(f);
        return {
          themeFilesDelete: {
            deletedThemeFiles: existing.map((filename) => ({ filename })),
            userErrors: files.filter((f) => !existing.includes(f)).map((filename) => ({ field: null, filename, code: 'NOT_FOUND', message: 'File not found' })),
          },
        };
      },
    }),
  );

  return { mock, themeFiles, upserts, deletes };
}
