// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useTemplateFonts } from './useTemplateFonts';

function Probe({ href }: { href: string }) {
  useTemplateFonts(href);
  return null;
}

it('ajoute la feuille de polices une seule fois', () => {
  render(<><Probe href="https://fonts.example/a.css" /><Probe href="https://fonts.example/a.css" /></>);
  expect(document.head.querySelectorAll('link[data-template-fonts="https://fonts.example/a.css"]')).toHaveLength(1);
});
