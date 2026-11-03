import { expect, it } from 'vitest';
import { formatDashboardDate } from './dashboardDate';

it('écrit la date comme la maquette', () => {
  expect(formatDashboardDate('2026-11-03')).toBe('Mardi 3 novembre');
  expect(formatDashboardDate('2027-01-01')).toBe('Vendredi 1 janvier');
});
