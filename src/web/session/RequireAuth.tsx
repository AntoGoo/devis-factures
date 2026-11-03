import { Navigate, Outlet } from 'react-router';
import { ApiError } from '../api';
import { useMe } from './useMe';

export function RequireAuth() {
  const me = useMe();
  if (me.isPending) return <p className="page-intro" style={{ padding: 32 }}>Chargement…</p>;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/connexion" replace />;
  if (me.error instanceof ApiError && me.error.code === 'not_invited') return <Navigate to="/acces-refuse" replace />;
  if (me.error) return <p className="notice notice-error" role="alert">{me.error.message}</p>;
  return <Outlet />;
}
