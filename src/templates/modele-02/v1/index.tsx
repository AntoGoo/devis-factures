import type { TemplateModule } from '../../types';
import { meta } from './meta';
import './style.css';

function Thumbnail() {
  return (
    <div className="tpl-thumb tpl-modele-02-v1-thumb" aria-hidden="true">
      <div className="t-top"><div className="t-bar" /><div className="t-title">Devis</div></div>
      <div className="t-parties"><div /><div /></div>
      <div className="t-head" />
      <div className="t-row" /><div className="t-row t-row--plain" /><div className="t-row" /><div className="t-row t-row--plain" />
      <div className="t-total" />
    </div>
  );
}

const template: TemplateModule = {
  meta,
  className: 'tpl-modele-02-v1',
  labels: { company: 'De', client: 'Pour', object: 'Objet', terms: 'Modalités', approval: 'Bon pour accord', thanks: null },
  fontsHref: 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap',
  Thumbnail,
};

export default template;
