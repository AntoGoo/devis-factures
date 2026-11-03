import { useQueryClient } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../auth-client';
import { Brand } from '../layout/Brand';
import { useMe } from '../session/useMe';
import { classifyAccessDeniedError } from './accessDeniedError';
import './LoginPage.css';

export function AccessDeniedPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (me.data) return <Navigate to="/" replace />;

  const { kind, code } = classifyAccessDeniedError(params.get('error'));

  if (kind === 'invitation') {
    // Ferme la session refusée et oublie son erreur en cache, sinon l’accueil renverrait aussitôt ici.
    const goHome = async (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // nouvel onglet : laisser faire le navigateur
      e.preventDefault();
      await authClient.signOut().catch(() => {});
      qc.clear();
      navigate('/');
    };
    return (
      <main className="login">
        <section className="login-panel">
          <div className="login-box">
            <Brand className="brand" nameClassName="brand-name" />
            <div>
              <h2>Accès sur invitation</h2>
              <p>Ce compte Google n’est pas autorisé à utiliser l’application. Demandez à l’administrateur d’ajouter votre adresse, puis reconnectez-vous.</p>
            </div>
            <Link className="btn btn-secondary" to="/" onClick={goHome}>Accueil</Link>
          </div>
        </section>
      </main>
    );
  }

  const cancelled = kind === 'cancelled';
  return (
    <main className="login">
      <section className="login-panel">
        <div className="login-box">
          <Brand className="brand" nameClassName="brand-name" />
          <div>
            <h2>{cancelled ? 'Connexion annulée' : 'La connexion n’a pas abouti'}</h2>
            <p>
              {cancelled
                ? 'Vous avez annulé la connexion avec Google.'
                : 'La connexion avec Google a échoué pour une raison technique. Réessayez ; si le problème persiste, contactez l’administrateur.'}
            </p>
            {!cancelled && code && <p className="access-denied-code">Code : {code}</p>}
          </div>
          <div className="actions">
            <Link className="btn btn-secondary" to="/connexion">Réessayer</Link>
            <Link className="btn btn-secondary" to="/">Accueil</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
