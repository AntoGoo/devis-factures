import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import './zod-config';

describe('configuration de Zod dans le navigateur', () => {
  it('désactive la compilation par new Function, interdite par la CSP (script-src sans unsafe-eval)', () => {
    expect(z.config().jitless).toBe(true);
  });
});
