import { useState } from 'react';
import { Navigate } from 'react-router';
import { authClient } from '../auth-client';
import { Brand } from '../layout/Brand';
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
    <main className="login">
      <section className="login-hero">
        <Brand className="brand" nameClassName="brand-name" />
        <div className="login-pitch">
          <h1>Du devis signé à la facture payée, sans ressaisir une ligne.</h1>
          <p>Vos coordonnées sont saisies une fois. Chaque devis accepté devient acompte, puis facture de solde, prête à imprimer.</p>
        </div>
        <div className="login-flow" aria-hidden="true">
          <div className="flow-card"><span>Devis</span><strong>D-2026-014</strong></div>
          <span className="flow-arrow">→</span>
          <div className="flow-card"><span>Acompte 30 %</span><strong>F-2026-021</strong></div>
          <span className="flow-arrow">→</span>
          <div className="flow-card flow-card--strong"><span>Solde</span><strong>F-2026-027</strong></div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-box">
          <div>
            <h2>Connexion</h2>
            <p>Utilisez le compte Google associé à votre activité.</p>
          </div>
          <button type="button" className="google-button" onClick={signIn} disabled={pending}>
            <GoogleIcon />
            Continuer avec Google
          </button>
          {unavailable && (
            <p className="notice notice-error" role="alert">
              La connexion Google est indisponible pour le moment. Réessayez plus tard ou contactez l’administrateur.
            </p>
          )}
          <div className="notice">
            <LockIcon />
            <p>Accès sur invitation. Si votre adresse n’a pas encore été autorisée, contactez l’administrateur.</p>
          </div>
        </div>
      </section>
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

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
