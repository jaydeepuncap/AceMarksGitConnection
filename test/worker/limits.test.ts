/**
 * Cloudflare request budget (worker/lib/limits.ts) and the errors shown when an
 * upstream request cannot be made (worker/lib/http.ts).
 */
import { describe, expect, it } from 'vitest';
import { fetchWithRetry } from '../../worker/lib/http';
import { DEFAULT_SUBREQUEST_BUDGET, filesPerStep, previewDownloadBudget, subrequestBudget } from '../../worker/lib/limits';
import { ApiError } from '../../worker/lib/response';

describe('request budget', () => {
  it('defaults to a budget that fits the Workers Free plan and can be raised', () => {
    expect(subrequestBudget({})).toBe(DEFAULT_SUBREQUEST_BUDGET);
    expect(subrequestBudget({ SUBREQUEST_BUDGET: 'abc' })).toBe(DEFAULT_SUBREQUEST_BUDGET);
    expect(subrequestBudget({ SUBREQUEST_BUDGET: '5' })).toBe(DEFAULT_SUBREQUEST_BUDGET);
    expect(subrequestBudget({ SUBREQUEST_BUDGET: '900' })).toBe(900);
  });

  it('splits the budget into preview downloads and files per sync step', () => {
    expect(previewDownloadBudget(45)).toBe(25);
    expect(filesPerStep(45)).toBe(6);
    expect(filesPerStep(900)).toBe(177);
    expect(filesPerStep(20)).toBe(1);
  });
});

describe('upstream request errors', () => {
  const failingFetch = (error: Error) => (async () => {
    throw error;
  }) as unknown as typeof fetch;

  it('explains the Cloudflare request limit instead of "Upstream request failed"', async () => {
    const err = await fetchWithRetry('https://api.github.com/repos/a/b', {}, { fetchImpl: failingFetch(new Error('Too many subrequests.')) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'SUBREQUEST_LIMIT', status: 503 });
  });

  it('names the service and the reason for other connection errors', async () => {
    const err = await fetchWithRetry('https://api.github.com/repos/a/b', {}, { fetchImpl: failingFetch(new TypeError('Network connection lost.')) }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'UPSTREAM_UNREACHABLE', status: 502 });
    expect((err as ApiError).message).toBe('Could not reach api.github.com: Network connection lost.');
  });
});
