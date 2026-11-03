import { describe, expect, it } from 'vitest';
import { formatLastLogin } from './lastLogin';

const now = new Date('2026-11-03T10:00:00Z'); // 11 h à Paris

describe('formatLastLogin', () => {
  it('écrit les dates relatives comme la maquette', () => {
    expect(formatLastLogin('2026-11-03T07:00:00Z', now)).toBe('aujourd’hui');
    expect(formatLastLogin('2026-11-02T17:42:00Z', now)).toBe('hier, 18 h 42');
    expect(formatLastLogin('2026-10-28T09:00:00Z', now)).toBe('28 oct. 2026');
    expect(formatLastLogin(null, now)).toBeNull();
  });
});
