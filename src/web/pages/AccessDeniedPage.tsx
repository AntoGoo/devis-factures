import { Link, Navigate } from 'react-router';
import { authClient } from '../auth-client';
import { useMe } from '../session/useMe';
import './LoginPage.css';

export function AccessDeniedPage() {
  const me = useMe();
  if (me.data) return <Navigate to="/" replace />;
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
