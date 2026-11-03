// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useAutosave', () => {
  it('n’enregistre pas au montage', () => {
    const save = vi.fn(async () => {});
    renderHook(({ v }) => useAutosave(v, save, { enabled: true }), { initialProps: { v: { a: 1 } } });
    vi.advanceTimersByTime(2000);
    expect(save).not.toHaveBeenCalled();
  });

  it('regroupe les frappes rapprochées en un seul enregistrement de la dernière valeur', async () => {
    const save = vi.fn(async () => {});
    const { rerender, result } = renderHook(({ v }) => useAutosave(v, save, { enabled: true, delay: 800 }), { initialProps: { v: { a: 1 } } });
    rerender({ v: { a: 2 } });
    vi.advanceTimersByTime(400);
    rerender({ v: { a: 3 } });
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ a: 3 });
    expect(result.current.state).toBe('saved');
  });

  it('enregistre immédiatement sur flush et passe en erreur si l’envoi échoue', async () => {
    const save = vi.fn(async () => { throw new Error('Réseau'); });
    const { rerender, result } = renderHook(({ v }) => useAutosave(v, save, { enabled: true }), { initialProps: { v: { a: 1 } } });
    rerender({ v: { a: 2 } });
    await act(async () => { await result.current.flush(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('error');
    expect(result.current.error?.message).toBe('Réseau');
  });

  it('n’enregistre pas tant que la saisie est invalide', () => {
    const save = vi.fn(async () => {});
    const { rerender } = renderHook(({ v, ok }) => useAutosave(v, save, { enabled: ok }), { initialProps: { v: { a: 1 }, ok: true } });
    rerender({ v: { a: 2 }, ok: false });
    vi.advanceTimersByTime(2000);
    expect(save).not.toHaveBeenCalled();
  });
});
