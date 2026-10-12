import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '../../worker/lib/github-client';
import { gitBlobSha } from '../../worker/lib/crypto';
import { createLogger } from '../../worker/lib/logger';
import { installFetchMock, json } from '../helpers/fetch-mock';
import { SHA_B, SHA_D } from '../helpers/fixtures';

const logger = createLogger('error');
const client = () => new GitHubClient({ token: 'github_pat_x', logger });

describe('GitHubClient', () => {
  let mock: ReturnType<typeof installFetchMock>;
  beforeEach(() => {
    mock = installFetchMock();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('retrieves a file exactly as it existed at the selected commit (B, not D or HEAD)', async () => {
    // sections/header.liquid changed in B and again in D.
    const versions: Record<string, string> = { [SHA_B]: 'header at B', [SHA_D]: 'header at D', main: 'header at HEAD' };
    mock.on((req) => {
      const url = new URL(req.url);
      if (!url.pathname.endsWith('/contents/sections/header.liquid')) return undefined;
      const ref = url.searchParams.get('ref')!;
      return new Response(versions[ref] ?? 'missing', { status: versions[ref] ? 200 : 404 });
    });
    const bytes = await client().getFileAtCommit('acme', 'theme', 'sections/header.liquid', SHA_B);
    expect(new TextDecoder().decode(bytes)).toBe('header at B');
    const req = mock.calls[0]!;
    expect(new URL(req.url).searchParams.get('ref')).toBe(SHA_B);
    expect(req.headers.get('Accept')).toBe('application/vnd.github.raw+json');
    expect(req.headers.get('Authorization')).toBe('Bearer github_pat_x');
  });

  it('refuses to read file contents by branch name', async () => {
    await expect(client().getFileAtCommit('acme', 'theme', 'a.liquid', 'main')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(mock.calls).toHaveLength(0);
  });

  it('encodes path segments', async () => {
    mock.on(() => new Response('x'));
    await client().getFileAtCommit('acme', 'theme', 'assets/a b#c.css', SHA_B);
    expect(mock.calls[0]!.url).toContain('/contents/assets/a%20b%23c.css?ref=');
  });

  it('maps an inaccessible repository (404) to GITHUB_NOT_FOUND', async () => {
    mock.on(() => json({ message: 'Not Found' }, { status: 404 }));
    await expect(client().verifyRepositoryAccess('acme', 'private')).rejects.toMatchObject({
      status: 404,
      code: 'GITHUB_NOT_FOUND',
    });
  });

  it('requires Contents access, not just repository metadata', async () => {
    mock.on((req) =>
      req.url.endsWith('/repos/acme/theme')
        ? json({ id: 1, full_name: 'acme/theme', name: 'theme', owner: { login: 'acme' }, private: true, default_branch: 'main', html_url: '', updated_at: null, permissions: { pull: true } })
        : undefined,
    );
    mock.on((req) => (req.url.includes('/commits?per_page=1') ? json({ message: 'Resource not accessible by personal access token' }, { status: 403 }) : undefined));
    await expect(client().verifyRepositoryAccess('acme', 'theme')).rejects.toMatchObject({ code: 'GITHUB_ACCESS_DENIED' });
  });

  it('reports primary rate limits with a retry hint', async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    mock.on(() =>
      json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }),
    );
    const err = await client().listBranches('acme', 'theme', 1, 30).catch((e) => e);
    expect(err).toMatchObject({ status: 429, code: 'GITHUB_RATE_LIMITED' });
    expect(err.retryAfter).toBeGreaterThan(100);
  });

  it('follows pagination for changed files and flags the 3000-file limit', async () => {
    const file = (i: number) => ({ filename: `snippets/f${i}.liquid`, status: 'modified', additions: 1, deletions: 0, changes: 1, sha: 'a'.repeat(40) });
    mock.on((req) => {
      const url = new URL(req.url);
      const page = Number(url.searchParams.get('page'));
      const files = Array.from({ length: 300 }, (_, i) => file((page - 1) * 300 + i));
      return json(
        { sha: SHA_B, html_url: '', commit: { message: 'big', author: null, committer: null, tree: { sha: 't'.repeat(40) } }, author: null, parents: [], files },
        { headers: page < 10 ? { link: `<https://api.github.com/x?page=${page + 1}>; rel="next"` } : {} },
      );
    });
    const result = await client().getAllCommitFiles('acme', 'theme', SHA_B);
    expect(result.files).toHaveLength(3000);
    expect(result.truncated).toBe(true);
    expect(mock.calls).toHaveLength(10);
  });

  it('decodes blobs (content-addressed) and their SHA matches git', async () => {
    const content = new TextEncoder().encode('{% comment %}x{% endcomment %}\n');
    const sha = await gitBlobSha(content);
    mock.on(() => json({ content: Buffer.from(content).toString('base64'), encoding: 'base64' }));
    const bytes = await client().getBlob('acme', 'theme', sha);
    expect(await gitBlobSha(bytes)).toBe(sha);
  });
});
