import type { TemplateModule } from '../../types';
import { meta } from './meta';
import './style.css';

function Thumbnail() {
  return (
    <div className="tpl-thumb tpl-modele-01-v1-thumb" aria-hidden="true">
      <div className="t-bar" />
      <div className="t-title">DEVIS</div>
      <div className="t-rule" />
      <div className="t-parties"><div /><div /></div>
      <div className="t-head" />
      <div className="t-row" /><div className="t-row" /><div className="t-row" /><div className="t-row" />
      <div className="t-total" />
    </div>
  );
}

const template: TemplateModule = {
  meta,
  className: 'tpl-modele-01-v1',
  labels: { company: 'Entreprise', client: 'Client', object: 'Objet', terms: 'Modalités', approval: 'Bon pour accord', thanks: null },
  fontsHref: 'https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=Manrope:wght@400;500;600;700&display=swap',
  Thumbnail,
};

export default template;
