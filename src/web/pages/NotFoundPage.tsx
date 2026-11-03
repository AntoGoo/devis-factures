import { Link } from 'react-router';
import { Brand } from '../layout/Brand';
import './LoginPage.css';

export function NotFoundPage() {
  return (
    <main className="login">
      <section className="login-panel">
        <div className="login-box">
          <Brand className="brand" nameClassName="brand-name" />
          <div>
            <h2>Page introuvable</h2>
            <p>Cette adresse ne correspond à aucune page de l’application.</p>
          </div>
          <Link className="btn btn-primary" to="/">Accueil</Link>
        </div>
      </section>
    </main>
  );
}
