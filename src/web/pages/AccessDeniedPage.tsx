import { Link, Navigate, useSearchParams } from 'react-router';
import { authClient } from '../auth-client';
import { useMe } from '../session/useMe';
import { classifyAccessDeniedError } from './accessDeniedError';
import './LoginPage.css';

export function AccessDeniedPage() {
  const me = useMe();
  const [params] = useSearchParams();
  if (me.data) return <Navigate to="/" replace />;

  const { kind, code } = classifyAccessDeniedError(params.get('error'));

  if (kind === 'invitation') {
    return (
      <main className="login">
        <section className="login-panel">
          <div className="login-box">
            <div>
              <h2>Accès sur invitation</h2>
              <p>Ce compte Google n’est pas autorisé à utiliser l’application. Demandez à l’administrateur d’ajouter votre adresse, puis reconnectez-vous.</p>
            </div>
            <Link className="btn btn-secondary" to="/connexion" onClick={() => authClient.signOut()}>Revenir à la connexion</Link>
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
          <div>
            <h2>{cancelled ? 'Connexion annulée' : 'La connexion n’a pas abouti'}</h2>
            <p>
              {cancelled
                ? 'Vous avez annulé la connexion avec Google.'
                : 'La connexion avec Google a échoué pour une raison technique. Réessayez ; si le problème persiste, contactez l’administrateur.'}
            </p>
            {!cancelled && code && <p className="access-denied-code">Code : {code}</p>}
          </div>
          <Link className="btn btn-secondary" to="/connexion">Réessayer</Link>
        </div>
      </section>
    </main>
  );
}
