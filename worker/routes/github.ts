/**
 * GitHub connection management and repository discovery.
 *
 * Connection model: a per-shop GitHub personal access token. Recommended: a
 * fine-grained token limited to the theme repository with
 *   Repository permissions → Contents: Read-only, Metadata: Read-only.
 * The token is verified against GitHub, encrypted (AES-GCM, AAD bound to the
 * shop) and never returned to the browser.
 *
 *   GET    /api/github/connection
 *   POST   /api/github/connection     { token, repository? }
 *   DELETE /api/github/connection
 *   GET    /api/github/repositories   ?page&perPage&q
 *   GET    /api/github/branches       ?repository=owner/name&page&perPage
 */
import { Hono } from 'hono';
import type {
  GithubBranch,
  GithubConnectionResponse,
  GithubRepository,
  Paginated,
} from '../../shared/api-types';
import type { AppEnv } from '../env';
import { cached, cacheKeys } from '../lib/cache';
import { githubClient, githubTokenAad, resolveRepository } from '../lib/clients';
import { encryptSecret } from '../lib/crypto';
import {
  deleteGithubConnection,
  getDb,
  getGithubConnection,
  getSettings,
  toGithubConnectionDto,
  upsertGithubConnection,
  upsertSettings,
} from '../lib/database';
import { GitHubClient } from '../lib/github-client';
import { ApiError, ok } from '../lib/response';
import {
  branchesQuerySchema,
  createGithubConnectionSchema,
  parseOrThrow,
  readJsonBody,
  repositoriesQuerySchema,
  splitRepository,
} from '../lib/validators';

export const githubRoutes = new Hono<AppEnv>()
  .get('/connection', async (c) => {
    const connection = await getGithubConnection(getDb(c.env.DB), c.get('auth').shop.id);
    return ok<GithubConnectionResponse>(c, {
      connected: !!connection,
      connection: connection ? toGithubConnectionDto(connection) : null,
    });
  })
  .post('/connection', async (c) => {
    const { shop } = c.get('auth');
    const logger = c.get('logger');
    const body = parseOrThrow(createGithubConnectionSchema, await readJsonBody(c.req.raw, 8 * 1024));
    const client = new GitHubClient({ token: body.token, baseUrl: c.env.GITHUB_API_BASE_URL, logger });

    let user;
    try {
      user = await client.getAuthenticatedUser();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'GITHUB_AUTH_FAILED') {
        throw new ApiError(400, 'GITHUB_AUTH_FAILED', 'GitHub rejected this token. Check that it is valid and not expired.');
      }
      throw err;
    }

    let repo = null;
    if (body.repository) {
      const { owner, repo: name } = splitRepository(body.repository);
      repo = await client.verifyRepositoryAccess(owner, name);
    }

    const db = getDb(c.env.DB);
    const connection = await upsertGithubConnection(db, shop.id, {
      authType: body.token.startsWith('github_pat_') ? 'fine_grained_pat' : 'classic_pat',
      accountLogin: user.login,
      accountType: user.type,
      repoOwner: repo?.owner ?? null,
      repoName: repo?.name ?? null,
      defaultBranch: repo?.defaultBranch ?? null,
      tokenEncrypted: await encryptSecret(c.env, body.token, githubTokenAad(shop.shopDomain)),
      tokenExpiresAt: user.tokenExpiresAt,
      lastVerifiedAt: new Date(),
    });

    if (repo) {
      const settings = await getSettings(db, shop.id);
      if (!settings.defaultRepository) {
        await upsertSettings(db, shop.id, { defaultRepository: repo.fullName, defaultBranch: repo.defaultBranch });
      }
    }

    logger.info('github.connected', { account: user.login, authType: connection.authType, repository: repo?.fullName });
    return ok<GithubConnectionResponse>(
      c,
      { connected: true, connection: toGithubConnectionDto(connection) },
      'GitHub connected',
      201,
    );
  })
  .delete('/connection', async (c) => {
    const removed = await deleteGithubConnection(getDb(c.env.DB), c.get('auth').shop.id);
    if (!removed) throw new ApiError(404, 'NOT_FOUND', 'No GitHub connection to remove');
    c.get('logger').info('github.disconnected');
    return ok<GithubConnectionResponse>(c, { connected: false, connection: null }, 'GitHub disconnected');
  })
  .get('/repositories', async (c) => {
    const query = parseOrThrow(repositoriesQuerySchema, c.req.query());
    const { shop } = c.get('auth');
    const { client, connection } = await githubClient(c);
    const page = await cached(
      c.env.KV,
      cacheKeys.repos(shop.id, `${connection.id}:${connection.updatedAt.getTime()}`, query.page, query.perPage),
      120,
      () => client.listRepositories(query.page, query.perPage),
      c.get('logger'),
    );
    // GitHub's /user/repos has no name search; `q` filters the current page.
    const needle = query.q?.toLowerCase();
    const items = needle ? page.items.filter((r) => r.fullName.toLowerCase().includes(needle)) : page.items;
    return ok<Paginated<GithubRepository>>(c, {
      items,
      page: query.page,
      perPage: query.perPage,
      hasNextPage: page.hasNextPage,
    });
  })
  .get('/branches', async (c) => {
    const query = parseOrThrow(branchesQuerySchema, c.req.query());
    const { client, connection } = await githubClient(c);
    const { owner, repo } = await resolveRepository(c, connection, query.repository);
    const result = await client.listBranches(owner, repo, query.page, query.perPage);
    return ok<Paginated<GithubBranch>>(c, { ...result, page: query.page, perPage: query.perPage });
  });
