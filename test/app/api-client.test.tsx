import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiClientError } from '../../app/lib/api-client';

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the App Bridge session token as a Bearer token and unwraps data', async () => {
    const fetchMock = vi.fn(async () => respond(200, { success: true, data: { ok: 1 } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest('GET', '/api/settings')).resolves.toEqual({ ok: 1 });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer header.payload.signature');
  });

  it('refreshes the session token and retries once on a retryable 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respond(
          401,
          { success: false, error: { code: 'UNAUTHORIZED', message: 'expired' } },
          {
            'X-Shopify-Retry-Invalid-Session-Request': '1',
          },
        ),
      )
      .mockResolvedValueOnce(respond(200, { success: true, data: 'second' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest('POST', '/api/sync', { body: {} })).resolves.toBe('second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.shopify.idToken).toHaveBeenCalledTimes(2);
  });

  it('surfaces error code, message, requestId and Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(
          429,
          { success: false, error: { code: 'RATE_LIMITED', message: 'slow down', requestId: 'r-1' } },
          { 'Retry-After': '60' },
        ),
      ),
    );
    const err = (await apiRequest('POST', '/api/sync', { body: {} }).catch((e) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'slow down',
      requestId: 'r-1',
      retryAfter: 60,
    });
  });

  it('never auto-retries failed writes on 5xx', async () => {
    const fetchMock = vi.fn(async () =>
      respond(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest('POST', '/api/sync', { body: {} })).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries idempotent GETs once on 5xx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(503, { success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } }))
      .mockResolvedValueOnce(respond(200, { success: true, data: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest('GET', '/api/themes')).resolves.toBe(1);
  });
});
