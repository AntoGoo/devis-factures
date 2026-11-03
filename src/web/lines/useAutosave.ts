import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** Enregistre `value` 800 ms après la dernière modification ; `flush` force l'enregistrement et rejette si l'enregistrement échoue. */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, { enabled, delay = 800 }: { enabled: boolean; delay?: number }) {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const serialized = JSON.stringify(value);
  const lastSaved = useRef(serialized);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ value, save, enabled });
  latest.current = { value, save, enabled };

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const { value: v, save: s, enabled: ok } = latest.current;
    const current = JSON.stringify(v);
    if (!ok || current === lastSaved.current) return;
    setState('saving');
    try {
      await s(v);
      lastSaved.current = current;
      setError(null);
      setState('saved');
    } catch (e) {
      const err = e as Error;
      setError(err);
      setState('error');
      throw err; // les appelants qui attendent flush() (ex. avant de changer le statut) doivent échouer aussi
    }
  }, []);

  useEffect(() => {
    if (!enabled || serialized === lastSaved.current) return;
    setState('pending');
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [serialized, enabled, delay, flush]);

  // Enregistre ce qui reste en attente quand l'utilisateur quitte la page ; l'erreur est déjà reflétée dans `state`/`error`.
  useEffect(() => () => { void flush().catch(() => {}); }, [flush]);

  return { state, error, flush };
}
