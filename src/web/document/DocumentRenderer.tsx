import { formatDateLong, formatDateShort } from '../../shared/dates';
import type { DocumentView } from '../../shared/document';
import { lineTotalCents } from '../../shared/lines';
import { formatEuros, formatQuantity } from '../../shared/money';
import type { TemplateModule } from '../../templates/types';
import './document.css';

const groupSiret = (s: string) => s.replace(/^(\d{3})(\d{3})(\d{3})(\d*)$/, '$1 $2 $3 $4').trim();
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

export function DocumentRenderer({ view, template }: { view: DocumentView; template: TemplateModule }) {
  const { company, client, labels } = { ...view, labels: template.labels };
  const qt = view.quoteTerms;
  const it = view.invoiceTerms;
  return (
    <article className={`doc ${template.className} doc--${view.kind}`} lang="fr">
      <header className="doc-header">
        <div className="doc-brand">
          {company.logoDataUrl
            ? <img className="doc-logo" src={company.logoDataUrl} alt="" />
            : <span className="doc-initials" aria-hidden="true">{initialsOf(company.tradeName || company.legalName)}</span>}
          <div className="doc-brand-text">
            <span className="doc-brand-bar" aria-hidden="true" />
            <p className="doc-trade-name">{company.tradeName || company.legalName}</p>
            {company.activityLine && <p className="doc-activity">{company.activityLine}</p>}
          </div>
        </div>
        <div className="doc-heading">
          <h1 className="doc-title">{view.title}</h1>
          <p className="doc-meta">
            <span className="doc-number">{view.number ? `N° ${view.number}` : 'Brouillon'}</span>
            {view.date && <span className="doc-date">{formatDateLong(view.date)}</span>}
          </p>
        </div>
      </header>
      <div className="doc-rule" aria-hidden="true" />

      <section className="doc-parties">
        <div className="doc-party">
          <h2 className="doc-label">{labels.company}</h2>
          <p className="doc-party-name">{company.legalName}</p>
          <p>{company.street}</p>
          <p>{company.postalCode} {company.city}</p>
          <p>SIRET {groupSiret(company.siret)}</p>
          {(company.phone || company.email) && <p>{[company.phone, company.email].filter(Boolean).join(' · ')}</p>}
        </div>
        <div className="doc-party">
          <h2 className="doc-label">{labels.client}</h2>
          {client ? (
            <>
              <p className="doc-party-name">{client.name}</p>
              {client.street && <p>{client.street}</p>}
              {(client.postalCode || client.city) && <p>{client.postalCode} {client.city}</p>}
              {client.type === 'business' && client.siren && <p>{client.siren.length === 14 ? 'SIRET' : 'SIREN'} {groupSiret(client.siren)}</p>}
            </>
          ) : <p className="doc-missing">Client à choisir</p>}
          {view.interventionAddress && <p>Intervention : {view.interventionAddress}</p>}
        </div>
      </section>

      {view.references.quote && <p className="doc-reference">Devis n° {view.references.quote.number} du {formatDateLong(view.references.quote.date)}</p>}
      {view.references.creditedInvoice && <p className="doc-reference">Annule la facture n° {view.references.creditedInvoice.number} du {formatDateLong(view.references.creditedInvoice.date)}</p>}

      {view.object && (
        <div className="doc-object"><span className="doc-label">{labels.object}</span><span className="doc-object-text">{view.object}</span></div>
      )}

      <table className="doc-lines">
        <thead>
          <tr>
            <th scope="col" className="col-designation">Désignation</th>
            <th scope="col" className="col-qty">Qté</th>
            <th scope="col" className="col-unit">Unité</th>
            <th scope="col" className="col-price">P.U. HT</th>
            <th scope="col" className="col-total">Total HT</th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((l) => (
            <tr key={l.id}>
              <td className="col-designation">{l.designation}</td>
              <td className="col-qty">{formatQuantity(l.quantityMilli)}</td>
              <td className="col-unit">{l.unit}</td>
              <td className="col-price">{formatEuros(l.unitPriceCents)}</td>
              <td className="col-total">{formatEuros(lineTotalCents(l))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="doc-totals">
        <div className="doc-total-row"><span>Total HT</span><span>{formatEuros(view.totals.totalHtCents)}</span></div>
        <p className="doc-vat">{view.vatMention}</p>
        {view.deductions?.deposits.map((d) => (
          <div key={d.invoiceId} className="doc-total-row doc-deduction">
            <span>Acompte {d.number} du {formatDateShort(d.issueDate)}</span>
            <span>{formatEuros(view.kind === 'credit' ? d.amountCents : -d.amountCents)}</span>
          </div>
        ))}
        <div className="doc-total-due"><span>{view.dueLabel}</span><span>{formatEuros(view.totals.totalDueCents)}</span></div>
      </section>

      <section className="doc-footer-blocks">
        <div className="doc-terms">
          <h2 className="doc-label">{labels.terms}</h2>
          {qt && (
            <>
              <p>Validité du devis : {qt.validityDays} jours</p>
              {qt.plannedStart && <p>Début prévisionnel : {qt.plannedStart}</p>}
              {qt.estimatedDuration && <p>Durée estimée : {qt.estimatedDuration}</p>}
              {qt.paymentTerms && <p>Paiement : {qt.paymentTerms}</p>}
            </>
          )}
          {it && (
            <>
              <p>Date de la prestation : {it.serviceDate ? formatDateLong(it.serviceDate) : 'date d’émission'}</p>
              <p>Échéance : {it.dueDate ? formatDateLong(it.dueDate) : 'fixée à l’émission'}</p>
              {it.paymentDetails && <p>Règlement : {it.paymentDetails}</p>}
              <p>{it.latePenaltyText}</p>
              {it.recoveryIndemnity && <p>{it.recoveryIndemnity}</p>}
              <p>{it.discount}</p>
              {it.notes && <p>{it.notes}</p>}
            </>
          )}
          {company.insurance && (
            <p className="doc-insurance">
              Assurance professionnelle {company.insurance.insurer} n° {company.insurance.policy}{company.insurance.area ? `, ${company.insurance.area}` : ''}
            </p>
          )}
        </div>
        {view.kind === 'quote' && (
          <div className="doc-approval">
            <h2 className="doc-label">{labels.approval}</h2>
            <p>Date :</p>
            <p>Nom et signature du client :</p>
            <div className="doc-signature" />
          </div>
        )}
      </section>
      {labels.thanks && <p className="doc-thanks">{labels.thanks}</p>}
    </article>
  );
}
