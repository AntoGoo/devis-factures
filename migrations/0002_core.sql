-- Liste d'accès (adresses en minuscules)
CREATE TABLE allowed_emails (
  email TEXT PRIMARY KEY,
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL
);

-- Dernière connexion, y compris celle du superadmin (absent de allowed_emails)
CREATE TABLE login_activity (
  email TEXT PRIMARY KEY,
  last_login_at TEXT NOT NULL
);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES "user" (id),
  template_ref TEXT NOT NULL,
  trade_name TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  activity_line TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  siret TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  logo_data_url TEXT,
  vat_regime TEXT NOT NULL DEFAULT 'franchise',          -- pas de CHECK : d'autres régimes viendront
  insurer TEXT NOT NULL DEFAULT '',
  insurance_policy TEXT NOT NULL DEFAULT '',
  insurance_area TEXT NOT NULL DEFAULT '',
  default_quote_validity_days INTEGER NOT NULL DEFAULT 30,
  default_payment_delay_days INTEGER NOT NULL DEFAULT 30,
  late_penalty_text TEXT NOT NULL DEFAULT 'En cas de retard de paiement, pénalités au taux d''intérêt appliqué par la BCE à son opération de refinancement la plus récente, majoré de 10 points de pourcentage.',
  payment_details TEXT NOT NULL DEFAULT '',
  prefix_quote TEXT NOT NULL DEFAULT 'D',
  prefix_invoice TEXT NOT NULL DEFAULT 'F',
  prefix_credit TEXT NOT NULL DEFAULT 'A',
  units_json TEXT NOT NULL DEFAULT '["u","h","jour","forfait","lot","m²","ml"]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id),
  type TEXT NOT NULL,                       -- 'individual' | 'business'
  name TEXT NOT NULL,
  street TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'FR',
  siren TEXT NOT NULL DEFAULT '',           -- 9 chiffres (SIREN) ou 14 (SIRET)
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX clients_user_name ON clients (user_id, name);

CREATE TABLE line_presets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id),
  designation TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  vat_rate REAL,                            -- toujours NULL en V1
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX line_presets_user ON line_presets (user_id, designation);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id),
  client_id TEXT REFERENCES clients (id),
  number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | sent | accepted | refused
  object TEXT NOT NULL DEFAULT '',
  intervention_address TEXT,
  lines_json TEXT NOT NULL DEFAULT '[]',
  total_ht_cents INTEGER NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL,
  planned_start TEXT NOT NULL DEFAULT '',
  estimated_duration TEXT NOT NULL DEFAULT '',
  payment_terms TEXT NOT NULL DEFAULT '',
  planned_deposit_bp INTEGER,
  quote_date TEXT,                          -- date du devis, fixée à l'envoi
  sent_at TEXT,
  accepted_at TEXT,
  refused_at TEXT,
  snapshot_json TEXT,                       -- instantané figé à l'acceptation
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX quotes_number ON quotes (user_id, number) WHERE number IS NOT NULL;
CREATE INDEX quotes_user_status ON quotes (user_id, status, updated_at);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id),
  kind TEXT NOT NULL,                       -- deposit | final | standalone | credit
  quote_id TEXT REFERENCES quotes (id),
  credited_invoice_id TEXT REFERENCES invoices (id),  -- sur un avoir : la facture annulée
  credited_by_id TEXT,                      -- sur une facture annulée : son avoir
  client_id TEXT REFERENCES clients (id),
  number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | issued | cancelled
  object TEXT NOT NULL DEFAULT '',
  intervention_address TEXT,
  lines_json TEXT NOT NULL DEFAULT '[]',
  deposit_bp INTEGER,                       -- acompte en pourcentage, sinon NULL
  total_ht_cents INTEGER NOT NULL DEFAULT 0,
  amount_due_cents INTEGER NOT NULL DEFAULT 0,  -- montant à payer de CE document (négatif pour un avoir)
  service_date TEXT,
  due_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  issue_date TEXT,
  paid_at TEXT,
  cancelled_at TEXT,
  snapshot_json TEXT,                       -- instantané figé à l'émission
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX invoices_number ON invoices (user_id, number) WHERE number IS NOT NULL;
CREATE UNIQUE INDEX invoices_one_active_final ON invoices (quote_id) WHERE kind = 'final' AND status != 'cancelled';
CREATE INDEX invoices_user_status ON invoices (user_id, status, updated_at);
CREATE INDEX invoices_quote ON invoices (quote_id, kind, status);

CREATE TABLE counters (
  user_id TEXT NOT NULL REFERENCES "user" (id),
  series TEXT NOT NULL,                     -- 'D' | 'F' | 'A'
  year INTEGER NOT NULL,
  last_value INTEGER NOT NULL,
  PRIMARY KEY (user_id, series, year)
);
