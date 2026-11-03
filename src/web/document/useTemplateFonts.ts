import { useEffect } from 'react';

export function useTemplateFonts(href: string): void {
  useEffect(() => {
    if (!href) return;
    if (document.head.querySelector(`link[data-template-fonts="${CSS.escape(href)}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.templateFonts = href;
    document.head.appendChild(link);
  }, [href]);
}
