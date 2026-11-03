const FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export function formatDashboardDate(iso: string): string {
  const s = FMT.format(new Date(`${iso}T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
