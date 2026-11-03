import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { DEFAULT_UNITS, type ProfileData } from '../../shared/profile';
import { ApiError, api } from '../api';
import { OnboardingLayout } from '../layout/OnboardingLayout';
import { useLeaveGuard } from '../navigation/useLeaveGuard';
import { fileToLogoDataUrl } from '../profile/logo';
import { useNumbering, useProfile } from '../profile/useProfile';

type Form = Record<
  'tradeName' | 'ownerName' | 'activityLine' | 'street' | 'postalCode' | 'city' | 'siret' | 'phone' | 'email' | 'insurer' | 'insurancePolicy' | 'insuranceArea' |
  'defaultQuoteValidityDays' | 'defaultPaymentDelayDays' | 'latePenaltyText' | 'paymentDetails' | 'prefixQuote' | 'prefixInvoice' | 'prefixCredit' | 'units',
  string
> & { logoDataUrl: string | null };

const DEFAULT_PENALTY = 'En cas de retard de paiement, pénalités au taux d’intérêt appliqué par la BCE à son opération de refinancement la plus récente, majoré de 10 points de pourcentage.';

function toForm(p: ProfileData | null): Form {
  return {
    tradeName: p?.tradeName ?? '', ownerName: p?.ownerName ?? '', activityLine: p?.activityLine ?? '',
    street: p?.street ?? '', postalCode: p?.postalCode ?? '', city: p?.city ?? '', siret: p?.siret ?? '',
    phone: p?.phone ?? '', email: p?.email ?? '', logoDataUrl: p?.logoDataUrl ?? null,
    insurer: p?.insurer ?? '', insurancePolicy: p?.insurancePolicy ?? '', insuranceArea: p?.insuranceArea ?? '',
    defaultQuoteValidityDays: String(p?.defaultQuoteValidityDays ?? 30), defaultPaymentDelayDays: String(p?.defaultPaymentDelayDays ?? 30),
    latePenaltyText: p?.latePenaltyText || DEFAULT_PENALTY, paymentDetails: p?.paymentDetails ?? '',
    prefixQuote: p?.prefixQuote ?? 'D', prefixInvoice: p?.prefixInvoice ?? 'F', prefixCredit: p?.prefixCredit ?? 'A',
    units: (p?.units ?? DEFAULT_UNITS).join(', '),
  };
}

function toPayload(f: Form) {
  return {
    ...f,
    defaultQuoteValidityDays: Number.parseInt(f.defaultQuoteValidityDays, 10),
    defaultPaymentDelayDays: Number.parseInt(f.defaultPaymentDelayDays, 10),
    units: f.units.split(',').map((u) => u.trim()).filter(Boolean),
  };
}

export function ProfilePage({ mode }: { mode: 'onboarding' | 'settings' }) {
  const profile = useProfile();
  const numbering = useNumbering();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(toForm(null));
  const [saved, setSaved] = useState<Form>(form); // dernières valeurs chargées ou enregistrées
  const [logoError, setLogoError] = useState<string | null>(null);
  const [starts, setStarts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!profile.data) return;
    const loaded = toForm(profile.data.profile);
    setForm(loaded);
    setSaved(loaded);
  }, [profile.data]);
  const { prompt, bypass } = useLeaveGuard({ dirty: JSON.stringify(form) !== JSON.stringify(saved) });

  const save = useMutation({
    mutationFn: (f: Form) => api('PUT', '/api/profile', toPayload(f)),
    onSuccess: async (_, f) => {
      setSaved(f);
      await Promise.all(['me', 'profile', 'numbering'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      if (mode === 'onboarding') { bypass(); navigate('/'); }
    },
  });
  const setStart = useMutation({
    mutationFn: (s: { series: string; startNumber: number }) => api('PUT', '/api/numbering/start', s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['numbering'] }),
  });

  const issues = save.error instanceof ApiError && Array.isArray(save.error.issues) ? (save.error.issues as { path: string[]; message: string }[]) : [];
  const errorOf = (k: string) => issues.find((i) => i.path[0] === k)?.message;
  const field = (k: keyof Form, label: string, opts: { hint?: string; span?: boolean; type?: string } = {}) => (
    <label className={opts.span ? 'field span-all' : 'field'}>
      <span>{label}{opts.hint && <span className="field-hint"> {opts.hint}</span>}</span>
      <input className="input" type={opts.type ?? 'text'} aria-label={label} aria-invalid={errorOf(k) ? true : undefined}
        value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      {errorOf(k) && <span className="field-error">{errorOf(k)}</span>}
    </label>
  );
  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    try { setLogoError(null); setForm({ ...form, logoDataUrl: await fileToLogoDataUrl(file) }); }
    catch (e) { setLogoError((e as Error).message); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(form); };

  const content = (
    <form className="page" style={{ maxWidth: 980, gap: 22 }} onSubmit={submit}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="page-title">Votre entreprise</h1>
        <p className="page-intro">Ces informations s’ajoutent à chaque nouveau devis et à chaque facture. Une modification ne touche pas les documents déjà émis.</p>
      </div>

      <section className="card form-grid" aria-labelledby="h-id">
        <h2 id="h-id" className="card-title span-all">Identité</h2>
        <div className="span-all" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="logo-slot">{form.logoDataUrl ? <img src={form.logoDataUrl} alt="Logo" /> : 'Logo'}</div>
          <label className="btn btn-secondary" style={{ height: 42 }}>
            Importer un logo
            <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
          </label>
          {form.logoDataUrl && <button type="button" className="btn btn-secondary" style={{ height: 42 }} onClick={() => setForm({ ...form, logoDataUrl: null })}>Retirer</button>}
          <span className="field-hint" style={{ fontSize: 13 }}>PNG ou JPG, facultatif</span>
          {logoError && <span className="field-error">{logoError}</span>}
        </div>
        {field('tradeName', 'Nom commercial')}
        {field('ownerName', 'Prénom et nom')}
        {field('activityLine', 'Ligne d’activité', { hint: 'affichée sous votre nom sur les documents', span: true })}
        {field('siret', 'SIRET')}
        <div className="field">Statut<div className="input" style={{ background: 'var(--c-bg)', border: 'none', display: 'flex', alignItems: 'center', fontWeight: 500 }}>Entrepreneur individuel (EI)</div></div>
      </section>

      <section className="card form-grid" aria-labelledby="h-coord">
        <h2 id="h-coord" className="card-title span-all">Coordonnées</h2>
        {field('street', 'Adresse', { span: true })}
        {field('postalCode', 'Code postal')}
        {field('city', 'Ville')}
        {field('phone', 'Téléphone', { type: 'tel' })}
        {field('email', 'E-mail', { type: 'email' })}
      </section>

      <section className="card form-grid" aria-labelledby="h-reg">
        <h2 id="h-reg" className="card-title span-all">Mentions et assurance</h2>
        <div className="notice span-all">Franchise en base de TVA : vos documents portent « TVA non applicable, art. 293 B du CGI ».</div>
        {field('insurer', 'Assureur', { hint: 'obligatoire pour la décennale' })}
        {field('insurancePolicy', 'N° de contrat')}
        {field('insuranceArea', 'Zone couverte')}
        {field('defaultPaymentDelayDays', 'Délai de paiement par défaut (jours)', { type: 'number' })}
        {field('defaultQuoteValidityDays', 'Validité des devis (jours)', { type: 'number' })}
        {field('paymentDetails', 'IBAN ou coordonnées de paiement', { hint: 'facultatif' })}
        <label className="field span-all">Pénalités de retard
          <textarea className="input" rows={2} value={form.latePenaltyText} onChange={(e) => setForm({ ...form, latePenaltyText: e.target.value })} />
        </label>
        {field('units', 'Unités proposées dans les lignes', { hint: 'séparées par des virgules', span: true })}
      </section>

      <section className="card form-grid" aria-labelledby="h-num">
        <h2 id="h-num" className="card-title span-all">Numérotation</h2>
        {numbering.data?.series.map((s) => {
          const key = s.series === 'D' ? 'prefixQuote' : s.series === 'F' ? 'prefixInvoice' : 'prefixCredit';
          const title = s.series === 'D' ? 'Devis' : s.series === 'F' ? 'Factures' : 'Avoirs';
          return (
            <div key={s.series} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{s.next}</span>
              <span className="field-hint" style={{ fontSize: 13 }}>prochain numéro{s.series === 'F' ? ' (acomptes et soldes)' : ''}</span>
              {field(key, 'Préfixe')}
              {s.startEditable && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <label className="field" style={{ flex: 1, minWidth: 0 }}>Reprendre à partir du n°
                    <input className="input" type="number" min={1} value={starts[s.series] ?? ''} onChange={(e) => setStarts({ ...starts, [s.series]: e.target.value })} />
                  </label>
                  <button type="button" className="btn btn-secondary" disabled={!starts[s.series]}
                    onClick={() => window.confirm('Ce numéro de départ ne pourra plus être modifié. Confirmer ?') && setStart.mutate({ series: s.series, startNumber: Number(starts[s.series]) })}>
                    Fixer
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {setStart.error && <p className="field-error span-all">{setStart.error.message}</p>}
      </section>

      {save.error && issues.length === 0 && <p className="notice notice-error" role="alert">{save.error.message}</p>}
      {save.isSuccess && mode === 'settings' && <p className="notice" role="status">Profil enregistré.</p>}
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        {mode === 'settings' && <Link className="btn btn-secondary" to="/profil/modele">Changer de modèle</Link>}
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>Enregistrer</button>
      </div>
      {prompt}
    </form>
  );
  return mode === 'onboarding' ? <OnboardingLayout step={2}>{content}</OnboardingLayout> : content;
}
