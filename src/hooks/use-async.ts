import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { toUserMessage } from '@/lib/errors';

/**
 * Loads data whenever `deps` change, with loading/error state and a reload function.
 * The previous data stays visible while new data loads.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true) {
  const key = JSON.stringify(deps);
  const [result, setResult] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  async function load(forKey: string) {
    const id = ++seq.current;
    try {
      const data = await fn();
      if (id === seq.current) setResult({ key: forKey, data, error: null });
    } catch (e) {
      if (id === seq.current) setResult((r) => ({ key: forKey, data: r.data, error: toUserMessage(e) }));
    } finally {
      if (id === seq.current) setRefreshing(false);
    }
  }

  const loadForDeps = useEffectEvent((forKey: string) => {
    void load(forKey);
  });

  useEffect(() => {
    if (enabled) loadForDeps(key);
  }, [enabled, key]);

  async function reload() {
    setRefreshing(true);
    await load(key);
  }

  function setData(data: T | null) {
    setResult((r) => ({ ...r, data }));
  }

  return {
    data: result.data,
    error: result.key === key ? result.error : null,
    loading: enabled && (result.key !== key || refreshing),
    reload,
    setData,
  };
}

/** Throws Supabase errors so useAsync / try-catch can show them. */
export async function unwrap<T>(p: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}
