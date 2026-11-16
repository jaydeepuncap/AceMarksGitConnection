/**
 * GitHub REST API client (api.github.com or GitHub Enterprise Server).
 *
 * Commit-specific content: every content read is pinned to a commit SHA, never a
 * branch name. If a file changed in commits B and D and the user selects B,
 * `getFileAtCommit(path, B)` returns the bytes as of B. The sync executor also
 * recomputes the Git blob SHA of the downloaded bytes and compares it with the
 * blob SHA GitHub reported for that file in commit B.
 *
 * Limits handled here
 *  - Pagination via `page`/`per_page` and the Link header.
 *  - A single commit lists at most 3000 changed files (300 per page).
 *  - Recursive trees are truncated beyond 100,000 entries / 7 MB.
 *  - Primary (x-ratelimit-*) and secondary (retry-after) rate limits.
 */
import type {
  CommitDetail,
  CommitFile,
  CommitFileStatus,
  CommitSummary,
  GithubBranch,
  GithubRepository,
} from '../../shared/api-types';
import { base64ToBytes } from './crypto';
import { fetchWithRetry } from './http';
import type { Logger } from './logger';
import { ApiError } from './response';

export const GITHUB_MAX_COMMIT_FILES = 3000;
const GITHUB_COMMIT_FILES_PER_PAGE = 300;

export interface GitHubClientOptions {
  token: string;
  baseUrl?: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface GithubUser {
  login: string;
  type: string;
  tokenExpiresAt: Date | null;
  /** Classic PATs report scopes in x-oauth-scopes; fine-grained PATs do not. */
  scopes: string[] | null;
}

interface PageResult<T> {
  items: T[];
  hasNextPage: boolean;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

// Raw GitHub payload shapes (only the fields we use)
interface RawRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  html_url: string;
  updated_at: string | null;
  permissions?: { pull?: boolean; push?: boolean; admin?: boolean };
}

interface RawCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
    committer: { date?: string } | null;
    tree: { sha: string };
  };
  author: { login: string; avatar_url: string } | null;
  parents: { sha: string }[];
  stats?: { additions: number; deletions: number; total: number };
  files?: RawCommitFile[];
}

interface RawCommitFile {
  filename: string;
  previous_filename?: string;
  status: CommitFileStatus;
  additions: number;
  deletions: number;
  changes: number;
  sha: string | null;
}

const enc = encodeURIComponent;

function encodePath(path: string): string {
  return path.split('/').map(enc).join('/');
}

function hasNextLink(link: string | null): boolean {
  return !!link && /rel="next"/.test(link);
}

export class GitHubClient {
  private readonly baseUrl: string;

  constructor(private readonly options: GitHubClientOptions) {
    this.baseUrl = (options.baseUrl || 'https://api.github.com').replace(/\/+$/, '');
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------
  private async send(path: string, accept = 'application/vnd.github+json'): Promise<Response> {
    const response = await fetchWithRetry(
      `${this.baseUrl}${path}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'ace-marks-git-connection',
        },
      },
      {
        timeoutMs: this.options.timeoutMs ?? 15_000,
        idempotent: true,
        retries: 2,
        fetchImpl: this.options.fetchImpl,
        onRetry: (info) => this.options.logger.warn('github.retry', { path, ...info }),
      },
    );
    if (!response.ok) await this.throwForStatus(response, path);
    return response;
  }

  private async getJson<T>(path: string): Promise<{ data: T; response: Response }> {
    const response = await this.send(path);
    return { data: (await response.json()) as T, response };
  }

  private async throwForStatus(response: Response, path: string): Promise<never> {
    let message = '';
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? '';
    } catch {
      // ignore non-JSON bodies
    }
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = Number(response.headers.get('x-ratelimit-reset') ?? '0');
    const retryAfterHeader = Number(response.headers.get('retry-after') ?? 'NaN');

    this.options.logger.warn('github.request_failed', { path, status: response.status, message });

    if (response.status === 429 || (response.status === 403 && (remaining === '0' || /rate limit/i.test(message)))) {
      const retryAfter = Number.isFinite(retryAfterHeader)
        ? retryAfterHeader
        : reset
          ? Math.max(1, reset - Math.floor(Date.now() / 1000))
          : 60;
      throw new ApiError(429, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit exceeded', { retryAfter });
    }
    if (response.status === 401) {
      throw new ApiError(401, 'GITHUB_AUTH_FAILED', 'GitHub rejected the token (revoked or expired)');
    }
    if (response.status === 403) {
      throw new ApiError(
        403,
        'GITHUB_ACCESS_DENIED',
        'The GitHub token does not have permission for this resource (needs Contents: read and Metadata: read)',
      );
    }
    if (response.status === 404) {
      // GitHub returns 404 (not 403) for private repositories the token cannot see.
      throw new ApiError(404, 'GITHUB_NOT_FOUND', 'Repository, ref or file not found, or not accessible with this token');
    }
    if (response.status === 409) {
      throw new ApiError(409, 'GITHUB_ERROR', 'The repository is empty or the request conflicts with its state');
    }
    if (response.status === 422) {
      throw new ApiError(400, 'VALIDATION_ERROR', message || 'GitHub rejected the request parameters');
    }
    throw new ApiError(502, 'GITHUB_ERROR', `GitHub API responded with HTTP ${response.status}`);
  }

  // -------------------------------------------------------------------------
  // Identity & repositories
  // -------------------------------------------------------------------------
  async getAuthenticatedUser(): Promise<GithubUser> {
    const { data, response } = await this.getJson<{ login: string; type: string }>('/user');
    const expiry = response.headers.get('github-authentication-token-expiration');
    const scopes = response.headers.get('x-oauth-scopes');
    const parsedExpiry = expiry ? new Date(expiry.replace(' UTC', 'Z').replace(' ', 'T')) : null;
    return {
      login: data.login,
      type: data.type,
      tokenExpiresAt: parsedExpiry && !Number.isNaN(parsedExpiry.getTime()) ? parsedExpiry : null,
      scopes: scopes === null ? null : scopes.split(',').map((s) => s.trim()).filter(Boolean),
    };
  }

  async getRepository(owner: string, repo: string): Promise<GithubRepository> {
    const { data } = await this.getJson<RawRepo>(`/repos/${enc(owner)}/${enc(repo)}`);
    return toRepository(data);
  }

  /**
   * Confirms the token can actually read repository contents. Repository
   * metadata can be visible while Contents access is not granted (fine-grained
   * tokens), so this also reads one commit.
   */
  async verifyRepositoryAccess(owner: string, repo: string): Promise<GithubRepository> {
    const repository = await this.getRepository(owner, repo);
    if (repository.permissions.pull === false) {
      throw new ApiError(403, 'GITHUB_ACCESS_DENIED', 'The GitHub token cannot read this repository');
    }
    await this.send(`/repos/${enc(owner)}/${enc(repo)}/commits?per_page=1`);
    return repository;
  }

  async listRepositories(page: number, perPage: number): Promise<PageResult<GithubRepository>> {
    const { data, response } = await this.getJson<RawRepo[]>(
      `/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    );
    return { items: data.map(toRepository), hasNextPage: hasNextLink(response.headers.get('link')) };
  }

  async listBranches(owner: string, repo: string, page: number, perPage: number): Promise<PageResult<GithubBranch>> {
    const { data, response } = await this.getJson<{ name: string; commit: { sha: string }; protected: boolean }[]>(
      `/repos/${enc(owner)}/${enc(repo)}/branches?per_page=${perPage}&page=${page}`,
    );
    return {
      items: data.map((b) => ({ name: b.name, commitSha: b.commit.sha, protected: b.protected })),
      hasNextPage: hasNextLink(response.headers.get('link')),
    };
  }

  async getBranch(owner: string, repo: string, branch: string): Promise<GithubBranch> {
    const { data } = await this.getJson<{ name: string; commit: { sha: string }; protected: boolean }>(
      `/repos/${enc(owner)}/${enc(repo)}/branches/${encodePath(branch)}`,
    );
    return { name: data.name, commitSha: data.commit.sha, protected: data.protected };
  }

  // -------------------------------------------------------------------------
  // Commits
  // -------------------------------------------------------------------------
  async listCommits(
    owner: string,
    repo: string,
    opts: { ref?: string; path?: string; page: number; perPage: number },
  ): Promise<PageResult<CommitSummary>> {
    const params = new URLSearchParams({ per_page: String(opts.perPage), page: String(opts.page) });
    if (opts.ref) params.set('sha', opts.ref);
    if (opts.path) params.set('path', opts.path);
    const { data, response } = await this.getJson<RawCommit[]>(
      `/repos/${enc(owner)}/${enc(repo)}/commits?${params.toString()}`,
    );
    return { items: data.map(toCommitSummary), hasNextPage: hasNextLink(response.headers.get('link')) };
  }

  /**
   * Walks the history reachable from `ref` (newest first) until `stopSha` is
   * found. Returns the commits before it and whether it was found within
   * `maxCommits`.
   */
  async listCommitsUntil(
    owner: string,
    repo: string,
    ref: string,
    stopSha: string | null,
    maxCommits = 300,
  ): Promise<{ commits: CommitSummary[]; found: boolean; hasMore: boolean }> {
    const commits: CommitSummary[] = [];
    for (let page = 1; commits.length < maxCommits; page++) {
      const result = await this.listCommits(owner, repo, { ref, page, perPage: 100 });
      for (const commit of result.items) {
        if (stopSha && commit.sha === stopSha) return { commits, found: true, hasMore: false };
        commits.push(commit);
        if (commits.length >= maxCommits) return { commits, found: false, hasMore: true };
      }
      if (!result.hasNextPage) return { commits, found: false, hasMore: false };
    }
    return { commits, found: false, hasMore: true };
  }

  /** Commit metadata plus one page of its changed files. */
  async getCommitPage(
    owner: string,
    repo: string,
    sha: string,
    page = 1,
    perPage = GITHUB_COMMIT_FILES_PER_PAGE,
  ): Promise<{ commit: RawCommit; files: CommitFile[]; hasNextPage: boolean; treeSha: string }> {
    const { data, response } = await this.getJson<RawCommit>(
      `/repos/${enc(owner)}/${enc(repo)}/commits/${enc(sha)}?per_page=${perPage}&page=${page}`,
    );
    return {
      commit: data,
      files: (data.files ?? []).map(toCommitFile),
      hasNextPage: hasNextLink(response.headers.get('link')),
      treeSha: data.commit.tree.sha,
    };
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<CommitDetail> {
    const all = await this.getAllCommitFiles(owner, repo, sha);
    const summary = toCommitSummary(all.commit);
    return {
      ...summary,
      stats: all.commit.stats ?? { additions: 0, deletions: 0, total: 0 },
      filesCount: all.files.length,
      filesTruncated: all.truncated,
    };
  }

  /** All changed files of a commit (up to GitHub's 3000-file limit). */
  async getAllCommitFiles(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<{ commit: RawCommit; files: CommitFile[]; truncated: boolean; treeSha: string }> {
    const files: CommitFile[] = [];
    let page = 1;
    let first: Awaited<ReturnType<GitHubClient['getCommitPage']>> | null = null;
    for (;;) {
      const result = await this.getCommitPage(owner, repo, sha, page);
      first ??= result;
      files.push(...result.files);
      if (!result.hasNextPage || files.length >= GITHUB_MAX_COMMIT_FILES) break;
      page++;
    }
    return {
      commit: first.commit,
      files,
      truncated: files.length >= GITHUB_MAX_COMMIT_FILES,
      treeSha: first.treeSha,
    };
  }

  /** Full recursive tree of a commit; used by the full_snapshot strategy. */
  async getTree(owner: string, repo: string, treeSha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const { data } = await this.getJson<{ tree: TreeEntry[]; truncated: boolean }>(
      `/repos/${enc(owner)}/${enc(repo)}/git/trees/${enc(treeSha)}?recursive=1`,
    );
    return { entries: data.tree, truncated: data.truncated };
  }

  // -------------------------------------------------------------------------
  // File contents (always pinned to a commit SHA)
  // -------------------------------------------------------------------------
  /**
   * Raw bytes of `path` as it existed at `commitSha` (Contents API, ref=<sha>).
   * The raw media type supports files up to 100 MB.
   */
  async getFileAtCommit(owner: string, repo: string, path: string, commitSha: string): Promise<Uint8Array> {
    if (!/^[0-9a-f]{40}$/.test(commitSha)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'File reads must be pinned to a full commit SHA');
    }
    const response = await this.send(
      `/repos/${enc(owner)}/${enc(repo)}/contents/${encodePath(path)}?ref=${commitSha}`,
      'application/vnd.github.raw+json',
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Bytes of a Git blob by its SHA (content-addressed, therefore immutable). */
  async getBlob(owner: string, repo: string, blobSha: string): Promise<Uint8Array> {
    const { data } = await this.getJson<{ content: string; encoding: string }>(
      `/repos/${enc(owner)}/${enc(repo)}/git/blobs/${enc(blobSha)}`,
    );
    if (data.encoding !== 'base64') throw new ApiError(502, 'GITHUB_ERROR', 'Unexpected blob encoding');
    return base64ToBytes(data.content);
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------
function toRepository(raw: RawRepo): GithubRepository {
  return {
    id: raw.id,
    fullName: raw.full_name,
    owner: raw.owner.login,
    name: raw.name,
    private: raw.private,
    defaultBranch: raw.default_branch,
    htmlUrl: raw.html_url,
    updatedAt: raw.updated_at,
    permissions: {
      pull: raw.permissions?.pull ?? true,
      push: raw.permissions?.push ?? false,
      admin: raw.permissions?.admin ?? false,
    },
  };
}

export function toCommitSummary(raw: RawCommit): CommitSummary {
  return {
    sha: raw.sha,
    shortSha: raw.sha.slice(0, 7),
    message: raw.commit.message,
    authorName: raw.commit.author?.name ?? null,
    authorLogin: raw.author?.login ?? null,
    authorAvatarUrl: raw.author?.avatar_url ?? null,
    date: raw.commit.author?.date ?? raw.commit.committer?.date ?? null,
    htmlUrl: raw.html_url,
    parents: raw.parents.map((p) => p.sha),
  };
}

function toCommitFile(raw: RawCommitFile): CommitFile {
  return {
    filename: raw.filename,
    previousFilename: raw.previous_filename ?? null,
    status: raw.status,
    additions: raw.additions,
    deletions: raw.deletions,
    changes: raw.changes,
    blobSha: raw.status === 'removed' ? null : raw.sha,
    themePath: null,
    themePathError: null,
  };
}
