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

  it('enregistre immédiatement sur flush, passe en erreur et rejette si l’envoi échoue', async () => {
    const save = vi.fn(async () => { throw new Error('Réseau'); });
    const { rerender, result } = renderHook(({ v }) => useAutosave(v, save, { enabled: true }), { initialProps: { v: { a: 1 } } });
    rerender({ v: { a: 2 } });
    await act(async () => {
      await expect(result.current.flush()).rejects.toThrow('Réseau');
    });
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

  it('ne tente aucun enregistrement au démontage quand la saisie est invalide (enabled: false)', () => {
    const save = vi.fn(async () => {});
    const { rerender, unmount } = renderHook(({ v, ok }) => useAutosave(v, save, { enabled: ok }), { initialProps: { v: { a: 1 }, ok: false } });
    rerender({ v: { a: 2 }, ok: false });
    unmount();
    expect(save).not.toHaveBeenCalled();
  });

  it('attend l’enregistrement en cours avant d’envoyer la version la plus récente (deux flush rapprochés)', async () => {
    const pending: { v: { a: number }; resolve: () => void }[] = [];
    const save = vi.fn((v: { a: number }) => new Promise<void>((resolve) => { pending.push({ v, resolve }); }));
    const { rerender, result } = renderHook(({ v }) => useAutosave(v, save, { enabled: true }), { initialProps: { v: { a: 1 } } });
    rerender({ v: { a: 2 } });
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.flush(); });
    rerender({ v: { a: 3 } });
    act(() => { second = result.current.flush(); });
    await act(async () => { await Promise.resolve(); });
    // Le second envoi ne part pas tant que le premier n'a pas répondu.
    expect(save.mock.calls.map(([v]) => v)).toEqual([{ a: 2 }]);
    await act(async () => { pending[0]!.resolve(); await first; });
    await act(async () => { await Promise.resolve(); });
    expect(save.mock.calls.map(([v]) => v)).toEqual([{ a: 2 }, { a: 3 }]);
    await act(async () => { pending[1]!.resolve(); await second; });
    expect(result.current.state).toBe('saved');
  });
});

describe('useAutosave — unsaved', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('signale une valeur différente de la dernière enregistrée, y compris quand l’enregistrement est désactivé', async () => {
    const save = vi.fn(async () => {});
    const { rerender, result } = renderHook(({ v, enabled }) => useAutosave(v, save, { enabled }), { initialProps: { v: { a: 1 } as { a: number } | null, enabled: true } });
    expect(result.current.unsaved).toBe(false);
    rerender({ v: null, enabled: false });
    expect(result.current.unsaved).toBe(true);
    rerender({ v: { a: 2 }, enabled: true });
    await act(() => result.current.flush());
    expect(result.current.unsaved).toBe(false);
  });
});
