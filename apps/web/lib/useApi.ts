"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Fetch with the three states §140 demands, and a retry that really refetches. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<T>(path)
      .then((value) => { if (!cancelled) setData(value); })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

/**
 * What useApi returns.
 *
 * Named so a view can take a caller-owned request as a prop rather than firing
 * its own duplicate — two hooks on one path means two copies that drift.
 */
export type ApiState<T> = {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
};
