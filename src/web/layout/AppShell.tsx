import { NavLink, Outlet, useNavigate } from 'react-router';
import { authClient } from '../auth-client';
import { allowNextNavigation } from '../navigation/useLeaveGuard';
import { queryClient } from '../query';
import { useMe } from '../session/useMe';
import { Brand } from './Brand';
import './AppShell.css';

const LINKS = [
  { to: '/', label: 'Tableau de bord', end: true },
  { to: '/devis', label: 'Devis' },
  { to: '/factures', label: 'Factures' },
  { to: '/clients', label: 'Clients' },
  { to: '/lignes-types', label: 'Lignes types' },
  { to: '/profil', label: 'Profil entreprise' },
];

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export function AppShell() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const displayName = me?.profileSummary?.ownerName || me?.user.name || '';
  const logout = async () => {
    await authClient.signOut();
    queryClient.clear();
    allowNextNavigation(); // session déjà fermée : rester sur la page n’aurait plus de sens
    navigate('/connexion');
  };
  return (
    <div className="shell">
      <nav aria-label="Navigation principale" className="shell-nav">
        <Brand className="shell-brand" />
        <div className="shell-links">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="shell-link">{l.label}</NavLink>
          ))}
        </div>
        <div className="shell-bottom">
          {me?.isSuperadmin && <NavLink to="/admin" className="shell-link">Accès (superadmin)</NavLink>}
          <div className="shell-user">
            <span className="shell-avatar" aria-hidden="true">{initials(displayName)}</span>
            <div><span className="shell-user-name">{displayName}</span><span className="shell-user-company">{me?.profileSummary?.tradeName}</span></div>
          </div>
          <button type="button" className="shell-logout" onClick={logout}>Se déconnecter</button>
        </div>
      </nav>
      <main className="shell-main"><Outlet /></main>
    </div>
  );
}
