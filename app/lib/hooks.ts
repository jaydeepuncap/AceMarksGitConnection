import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClientError } from './api-client';

export interface QueryState<T> {
  data: T | null;
  error: ApiClientError | null;
  loading: boolean;
  reload: () => void;
  setData: (data: T | null) => void;
}

function toClientError(err: unknown): ApiClientError {
  return err instanceof ApiClientError
    ? err
    : new ApiClientError(0, 'INTERNAL_ERROR', err instanceof Error ? err.message : 'Unexpected error');
}

/** Loads data on mount and whenever `deps` change; ignores stale responses. */
export function useApiQuery<T>(load: () => Promise<T>, deps: unknown[], enabled = true): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toClientError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

/** Wraps a mutation with pending/error state. */
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (err) {
        setError(toClientError(err));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending, error, clearError: () => setError(null) };
}

/**
 * Client-side navigation for Polaris web components (<s-button>, <s-link>),
 * which emit native click events instead of rendering a router <Link>.
 */
export function useNavigateHandler() {
  const navigate = useNavigate();
  return useCallback(
    (to: string) => (event?: Event) => {
      event?.preventDefault();
      navigate(to);
    },
    [navigate],
  );
}
