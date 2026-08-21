import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSnapshot } from '../shared/types';
import { errorMessage, personalToolApi } from './api';
import { normalizeSnapshot } from './model';

export function useAppSnapshot() {
  const [rawSnapshot, setRawSnapshot] = useState<AppSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);

  const commitSnapshot = useCallback((snapshot: AppSnapshot) => {
    revision.current += 1;
    setRawSnapshot(snapshot);
  }, []);

  const reload = useCallback(async () => {
    const requestedAtRevision = revision.current;
    setLoading(true);
    setError(null);
    try {
      const next = await personalToolApi().getSnapshot();
      if (revision.current === requestedAtRevision) commitSnapshot(next);
    } catch (cause) {
      if (revision.current === requestedAtRevision) setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [commitSnapshot]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let requestedAtRevision = revision.current;

    void (async () => {
      try {
        const api = personalToolApi();
        unsubscribe = api.onSnapshot((next) => {
          if (!active) return;
          commitSnapshot(next);
          setError(null);
        });
        requestedAtRevision = revision.current;
        const initial = await api.getSnapshot();
        if (!active) return;
        if (revision.current === requestedAtRevision) commitSnapshot(initial);
        setError(null);
      } catch (cause) {
        if (active && revision.current === requestedAtRevision) setError(errorMessage(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [commitSnapshot]);

  return {
    snapshot: useMemo(() => (rawSnapshot ? normalizeSnapshot(rawSnapshot) : null), [rawSnapshot]),
    commitSnapshot,
    loading,
    error,
    reload,
  };
}
