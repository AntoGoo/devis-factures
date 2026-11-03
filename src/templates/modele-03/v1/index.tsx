import type { TemplateModule } from '../../types';
import { meta } from './meta';
import './style.css';

function Thumbnail() {
  return (
    <div className="tpl-thumb tpl-modele-03-v1-thumb" aria-hidden="true">
      <div className="t-title">Devis</div>
      <div className="t-double-rule" />
      <div className="t-parties"><div /><div /></div>
      <div className="t-head" />
      <div className="t-row" /><div className="t-row" /><div className="t-row" /><div className="t-row" />
      <div className="t-total" />
    </div>
  );
}

const template: TemplateModule = {
  meta,
  className: 'tpl-modele-03-v1',
  labels: { company: 'Prestataire', client: 'Client', object: 'Objet :', terms: 'Modalités', approval: 'Bon pour accord', thanks: 'Merci de votre confiance' },
  fontsHref: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Source+Sans+3:wght@400;600;700&display=swap',
  Thumbnail,
};

export default template;
