import { useState } from 'react';
import { Navigate } from 'react-router';
import { authClient } from '../auth-client';
import { useMe } from '../session/useMe';
import './LoginPage.css';

export function LoginPage() {
  const me = useMe();
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  if (me.data) return <Navigate to="/" replace />;
  const signIn = async () => {
    setPending(true);
    setUnavailable(false);
    try {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL: '/', errorCallbackURL: '/acces-refuse' });
      if (result?.error) {
        setUnavailable(true);
        setPending(false);
      }
    } catch {
      setUnavailable(true);
      setPending(false);
    }
  };
  return (
    <main className="signin">
      <div className="signin-inner">
        <header className="signin-head">
          <span className="signin-mark" aria-hidden="true">D</span>
          <h1 className="signin-title">Devis &amp; Factures</h1>
          <p className="signin-subtitle">Du devis signé à la facture envoyée, sans rien ressaisir.</p>
        </header>
        <section className="signin-card" aria-label="Connexion">
          <button type="button" className="signin-google" onClick={signIn} disabled={pending}>
            <GoogleIcon />
            Continuer avec Google
          </button>
          {unavailable && (
            <p className="notice notice-error" role="alert">
              La connexion Google est indisponible pour le moment. Réessayez plus tard ou contactez l’administrateur.
            </p>
          )}
          <p className="signin-note">Accès réservé aux comptes ouverts par l’administrateur.</p>
        </section>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6C12.3 13.4 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.8c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4.2-13.6-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
