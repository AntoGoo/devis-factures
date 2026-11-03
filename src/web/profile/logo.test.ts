import { expect, it } from 'vitest';
import { fitWithin } from './logo';

it('réduit en gardant les proportions, sans agrandir', () => {
  expect(fitWithin(1200, 600, 400)).toEqual({ width: 400, height: 200 });
  expect(fitWithin(300, 900, 400)).toEqual({ width: 133, height: 400 });
  expect(fitWithin(200, 100, 400)).toEqual({ width: 200, height: 100 });
});
