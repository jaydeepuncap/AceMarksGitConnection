/**
 * Route-based fetch mock for Shopify and GitHub APIs. Every outbound request is
 * recorded so tests can assert what was (and was not) sent upstream.
 */
import { vi } from 'vitest';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

type Handler = (req: RecordedRequest) => Response | Promise<Response> | undefined;

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  });
}

export function installFetchMock() {
  const handlers: Handler[] = [];
  const calls: RecordedRequest[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const req: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(req);
    for (const handler of handlers) {
      const res = await handler(req);
      if (res) return res;
    }
    throw new Error(`Unmocked fetch: ${req.method} ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return {
    calls,
    on(handler: Handler) {
      handlers.push(handler);
    },
    /** GraphQL calls to the Shopify Admin API, with parsed query/variables. */
    graphqlCalls() {
      return calls
        .filter((c) => c.url.includes('/graphql.json'))
        .map((c) => JSON.parse(c.body ?? '{}') as { query: string; variables: Record<string, unknown> });
    },
  };
}

/** Routes Shopify GraphQL by operation name (the `AceXxx` names in shopify-graphql.ts). */
export function graphqlHandler(routes: Record<string, (variables: Record<string, unknown>) => unknown>): Handler {
  return (req) => {
    if (!req.url.includes('/graphql.json')) return undefined;
    const { query, variables } = JSON.parse(req.body ?? '{}') as { query: string; variables: Record<string, unknown> };
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? '';
    const route = routes[name];
    if (!route) throw new Error(`Unmocked GraphQL operation ${name}`);
    return json({ data: route(variables) });
  };
}
