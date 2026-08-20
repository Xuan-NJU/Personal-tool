import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSnapshot } from '../shared/types';
import { errorMessage, personalToolApi } from './api';
import { normalizeSnapshot } from './model';

export function useAppSnapshot() {
  const [rawSnapshot, setRawSnapshot] = useState<AppSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRawSnapshot(await personalToolApi().getSnapshot());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        const api = personalToolApi();
        const initial = await api.getSnapshot();
        if (!active) return;
        setRawSnapshot(initial);
        setError(null);
        unsubscribe = api.onSnapshot((next) => {
          if (active) setRawSnapshot(next);
        });
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return {
    snapshot: useMemo(() => (rawSnapshot ? normalizeSnapshot(rawSnapshot) : null), [rawSnapshot]),
    commitSnapshot: setRawSnapshot,
    loading,
    error,
    reload,
  };
}
