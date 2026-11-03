import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const now = '2026-11-03T10:00:00.000Z';

async function insertUser(id: string, email: string) {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  ).bind(id, 'Test', email, now, now).run();
}

async function insertInvoice(id: string, userId: string, extra: Record<string, string | number | null> = {}) {
  const row = { id, user_id: userId, kind: 'standalone', status: 'draft', created_at: now, updated_at: now, ...extra };
  const cols = Object.keys(row);
  await env.DB.prepare(
    `INSERT INTO invoices (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).bind(...Object.values(row)).run();
}

describe('schéma D1', () => {
  it('crée toutes les tables', async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const t of ['user', 'session', 'account', 'verification', 'allowed_emails', 'login_activity', 'profiles', 'clients', 'line_presets', 'quotes', 'invoices', 'counters']) {
      expect(names).toContain(t);
    }
  });

  it('refuse deux compteurs pour le même utilisateur, la même série et la même année', async () => {
    await insertUser('u2', 'counters@example.test');
    await env.DB.prepare("INSERT INTO counters (user_id, series, year, last_value) VALUES ('u2', 'F', 2026, 1)").run();
    await expect(
      env.DB.prepare("INSERT INTO counters (user_id, series, year, last_value) VALUES ('u2', 'F', 2026, 2)").run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY/);
  });

  it('autorise le même numéro pour deux utilisateurs différents, pas pour le même', async () => {
    await insertUser('u3', 'invoice1@example.test');
    await insertUser('u4', 'invoice2@example.test');
    await insertInvoice('i1', 'u3', { number: 'F-2026-001', status: 'issued' });
    await insertInvoice('i2', 'u4', { number: 'F-2026-001', status: 'issued' });
    await expect(insertInvoice('i3', 'u3', { number: 'F-2026-001', status: 'issued' })).rejects.toThrow(/UNIQUE/);
  });

  it('autorise une seule facture de solde non annulée par devis', async () => {
    await insertUser('u5', 'quote@example.test');
    await env.DB.prepare(
      "INSERT INTO quotes (id, user_id, status, validity_days, created_at, updated_at) VALUES ('q1', 'u5', 'accepted', 30, ?, ?)",
    ).bind(now, now).run();
    await insertInvoice('f1', 'u5', { kind: 'final', quote_id: 'q1', status: 'cancelled' });
    await insertInvoice('f2', 'u5', { kind: 'final', quote_id: 'q1', status: 'draft' });
    await expect(insertInvoice('f3', 'u5', { kind: 'final', quote_id: 'q1', status: 'draft' })).rejects.toThrow(/UNIQUE/);
  });

  it('prévoit vat_regime sans contrainte CHECK et la franchise par défaut', async () => {
    await insertUser('u6', 'profile@example.test');
    await env.DB.prepare("INSERT INTO profiles (user_id, template_ref, created_at, updated_at) VALUES ('u6', 'modele-01@1', ?, ?)").bind(now, now).run();
    const row = await env.DB.prepare("SELECT vat_regime FROM profiles WHERE user_id = 'u6'").first<{ vat_regime: string }>();
    expect(row?.vat_regime).toBe('franchise');
    await env.DB.prepare("UPDATE profiles SET vat_regime = 'reel' WHERE user_id = 'u6'").run();
  });
});
