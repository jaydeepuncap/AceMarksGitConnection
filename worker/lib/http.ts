/**
 * fetch() with a timeout and a bounded retry policy for upstream APIs.
 *
 * Only requests the caller marks `idempotent` are retried on network errors and
 * 5xx responses. 429 responses are retried for any request (the upstream did
 * not process it) when the wait fits the retry budget.
 */
import { ApiError } from './response';

export interface FetchRetryOptions {
  timeoutMs?: number;
  retries?: number;
  idempotent?: boolean;
  /** Longest single wait we accept from Retry-After before giving up (ms). */
  maxRetryWaitMs?: number;
  fetchImpl?: typeof fetch;
  /** Called before each retry (for logging). */
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs);
}

function backoff(attempt: number): number {
  const base = Math.min(8000, 500 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 15_000,
    retries = 2,
    idempotent = false,
    maxRetryWaitMs = 10_000,
    fetchImpl = fetch,
    onRetry,
  } = options;

  let attempt = 0;
  for (;;) {
    let response: Response;
    try {
      response = await fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      if (idempotent && attempt < retries) {
        const waitMs = backoff(attempt);
        onRetry?.({ attempt: attempt + 1, waitMs, reason: isTimeout ? 'timeout' : 'network' });
        await sleep(waitMs);
        attempt++;
        continue;
      }
      const host = (() => {
        try {
          return new URL(input).hostname;
        } catch {
          return 'the upstream service';
        }
      })();
      if (isTimeout) {
        throw new ApiError(504, 'UPSTREAM_TIMEOUT', `${host} did not answer within ${timeoutMs / 1000} s. Try again.`);
      }
      const reason = err instanceof Error ? err.message : String(err);
      // Cloudflare refuses requests beyond the invocation's subrequest limit (worker/lib/limits.ts).
      if (/subrequest/i.test(reason)) {
        throw new ApiError(
          503,
          'SUBREQUEST_LIMIT',
          'This step needed more requests to GitHub and Shopify than Cloudflare allows at once. Try again; if it keeps happening, ignore files you do not sync or raise SUBREQUEST_BUDGET on a paid Workers plan.',
          { cause: err },
        );
      }
      throw new ApiError(502, 'UPSTREAM_UNREACHABLE', `Could not reach ${host}: ${reason}`, { cause: err });
    }

    const retryable = response.status === 429 || (idempotent && response.status >= 500);
    if (retryable && attempt < retries) {
      const waitMs = parseRetryAfter(response.headers.get('retry-after')) ?? backoff(attempt);
      if (waitMs <= maxRetryWaitMs) {
        onRetry?.({ attempt: attempt + 1, waitMs, reason: `status ${response.status}` });
        await response.body?.cancel();
        await sleep(waitMs);
        attempt++;
        continue;
      }
    }
    return response;
  }
}
