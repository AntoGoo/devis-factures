import { addDays, formatDateShort, todayInParis } from '../../shared/dates';

const TIME = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

export function formatLastLogin(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  const day = todayInParis(at);
  const today = todayInParis(now);
  if (day === today) return 'aujourd’hui';
  if (day === addDays(today, -1)) return `hier, ${TIME.format(at).replace(':', ' h ')}`;
  return formatDateShort(day);
}
