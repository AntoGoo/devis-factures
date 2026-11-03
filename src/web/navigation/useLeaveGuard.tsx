import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router';
import { Dialog } from '../components/Dialog';

type GuardOptions = { dirty: boolean; trySave?: () => Promise<boolean> };
type Guard = { current: GuardOptions };

// React Router ne gère qu'un seul useBlocker à la fois : les gardes de la page (ex. formulaire + fenêtre
// « Nouveau client ») s'inscrivent ici et la première montée héberge l'unique blocage, qui les consulte toutes.
const guards: Guard[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const anyDirty = () => guards.some((g) => g.current.dirty);

let bypassNext = false;
/** Laisse passer la prochaine navigation sans confirmation : à appeler juste avant un `navigate()` lancé par la page après une action réussie. */
export function allowNextNavigation() { bypassNext = true; }

// Les gardes sont lues au moment de la navigation (refs à jour), jamais via une fonction capturée à un rendu ancien.
const shouldBlock: BlockerFunction = ({ currentLocation, nextLocation }) => {
  if (bypassNext) { bypassNext = false; return false; }
  return currentLocation.pathname !== nextLocation.pathname && anyDirty();
};

// Toutes les gardes modifiées doivent savoir s'enregistrer, et y parvenir, pour partir sans confirmation.
async function saveAll(): Promise<boolean> {
  const dirty = guards.map((g) => g.current).filter((o) => o.dirty);
  if (dirty.some((o) => !o.trySave)) return false;
  try {
    return (await Promise.all(dirty.map((o) => o.trySave!()))).every(Boolean);
  } catch {
    return false;
  }
}

function LeaveGuardHost() {
  const blocker = useBlocker(shouldBlock);
  const latest = useRef(blocker);
  latest.current = blocker;
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { bypassNext = false; }, []);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!anyDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useEffect(() => {
    if (blocker.state !== 'blocked') { setConfirming(false); return; }
    let live = true;
    void saveAll().then((ok) => {
      if (!live) return;
      if (ok) latest.current.proceed?.();
      else setConfirming(true);
    });
    return () => { live = false; };
  }, [blocker.state]);

  const stay = () => latest.current.reset?.();
  return (
    <Dialog open={confirming && blocker.state === 'blocked'} title="Quitter la page ?" onClose={stay}>
      <p className="page-intro">Des modifications ne sont pas enregistrées. Quitter la page ?</p>
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={stay}>Rester</button>
        <button type="button" className="btn btn-danger" onClick={() => latest.current.proceed?.()}>Quitter sans enregistrer</button>
      </div>
    </Dialog>
  );
}

/**
 * Demande confirmation avant de quitter la page (lien, retour, fermeture de l'onglet) tant que `dirty`.
 * Si `trySave` est fourni, il est tenté d'abord : `true` laisse partir sans rien demander.
 * `prompt` est à rendre dans la page ; `bypass` est `allowNextNavigation`.
 */
export function useLeaveGuard(opts: GuardOptions): { prompt: ReactNode; bypass: () => void } {
  const guard = useRef(opts);
  guard.current = opts;
  useEffect(() => {
    guards.push(guard);
    notify();
    return () => {
      const i = guards.indexOf(guard);
      if (i >= 0) guards.splice(i, 1);
      notify();
    };
  }, []);
  const isHost = useSyncExternalStore(subscribe, () => guards[0] === guard);
  return { prompt: isHost ? <LeaveGuardHost /> : null, bypass: allowNextNavigation };
}
