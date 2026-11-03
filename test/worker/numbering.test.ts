import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { formatDocumentNumber } from '../../src/shared/numbering';
import { runIssue, type IssueTarget } from '../../src/worker/numbering';
import { createUser } from './helpers';

const now = '2026-11-03T10:00:00.000Z';

async function draft(userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO invoices (id, user_id, kind, status, created_at, updated_at) VALUES (?, ?, 'standalone', 'draft', ?, ?)")
    .bind(id, userId, now, now).run();
  return id;
}

const target = (userId: string, docId: string, extra: Partial<IssueTarget> = {}): IssueTarget => ({
  table: 'invoices', docId, userId, series: 'F', year: 2026, prefix: 'F', set: { status: 'issued', issue_date: '2026-11-03' }, ...extra,
});

async function counter(userId: string, series = 'F', year = 2026): Promise<number | null> {
  const row = await env.DB.prepare('SELECT last_value FROM counters WHERE user_id = ? AND series = ? AND year = ?').bind(userId, series, year).first<{ last_value: number }>();
  return row?.last_value ?? null;
}

describe('numérotation', () => {
  it('attribue F-2026-001 puis des numéros continus', async () => {
    const u = await createUser('a@example.test');
    const numbers = [];
    for (let i = 0; i < 3; i++) numbers.push((await runIssue(env.DB, target(u.id, await draft(u.id)))).number);
    expect(numbers).toEqual(['F-2026-001', 'F-2026-002', 'F-2026-003']);
    expect(await counter(u.id)).toBe(3);
  });

  it('ne consomme aucun numéro pour un document déjà émis (vigilance n° 3)', async () => {
    const u = await createUser('a@example.test');
    const id = await draft(u.id);
    expect(await runIssue(env.DB, target(u.id, id))).toEqual({ issued: true, number: 'F-2026-001' });
    expect(await runIssue(env.DB, target(u.id, id))).toEqual({ issued: false, number: 'F-2026-001' });
    expect(await counter(u.id)).toBe(1);
    expect((await runIssue(env.DB, target(u.id, await draft(u.id)))).number).toBe('F-2026-002');
  });

  it('résiste à deux émissions simultanées du même brouillon', async () => {
    const u = await createUser('a@example.test');
    const id = await draft(u.id);
    const results = await Promise.all([runIssue(env.DB, target(u.id, id)), runIssue(env.DB, target(u.id, id))]);
    expect(results.filter((r) => r.issued)).toHaveLength(1);
    expect(await counter(u.id)).toBe(1);
  });

  it('donne des numéros distincts et sans trou à des émissions simultanées', async () => {
    const u = await createUser('a@example.test');
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => draft(u.id)));
    const results = await Promise.all(ids.map((id) => runIssue(env.DB, target(u.id, id))));
    expect(results.map((r) => r.number).sort()).toEqual(['F-2026-001', 'F-2026-002', 'F-2026-003', 'F-2026-004', 'F-2026-005']);
  });

  it('repart à 001 chaque année civile sans toucher l’année précédente', async () => {
    const u = await createUser('a@example.test');
    await runIssue(env.DB, target(u.id, await draft(u.id)));
    await runIssue(env.DB, target(u.id, await draft(u.id)));
    expect((await runIssue(env.DB, target(u.id, await draft(u.id), { year: 2027 }))).number).toBe('F-2027-001');
    expect(await counter(u.id, 'F', 2026)).toBe(2);
  });

  it('tient une suite par utilisateur et par série', async () => {
    const a = await createUser('a@example.test');
    const b = await createUser('b@example.test');
    expect((await runIssue(env.DB, target(a.id, await draft(a.id)))).number).toBe('F-2026-001');
    expect((await runIssue(env.DB, target(b.id, await draft(b.id)))).number).toBe('F-2026-001');
    expect((await runIssue(env.DB, target(a.id, await draft(a.id), { series: 'A', prefix: 'A' }))).number).toBe('A-2026-001');
  });

  it('reprend après un numéro de départ et suit un changement de préfixe', async () => {
    const u = await createUser('a@example.test');
    await env.DB.prepare("INSERT INTO counters (user_id, series, year, last_value) VALUES (?, 'F', 2026, 41)").bind(u.id).run();
    expect((await runIssue(env.DB, target(u.id, await draft(u.id)))).number).toBe('F-2026-042');
    expect((await runIssue(env.DB, target(u.id, await draft(u.id), { prefix: 'FA' }))).number).toBe('FA-2026-043');
  });

  it('refuse un document d’un autre utilisateur sans toucher aux compteurs', async () => {
    const a = await createUser('a@example.test');
    const b = await createUser('b@example.test');
    const id = await draft(a.id);
    expect((await runIssue(env.DB, target(b.id, id))).issued).toBe(false);
    expect(await counter(b.id)).toBeNull();
    expect(await counter(a.id)).toBeNull();
  });

  it('n’incrémente rien si la condition supplémentaire est fausse', async () => {
    const u = await createUser('a@example.test');
    const id = await draft(u.id);
    expect((await runIssue(env.DB, target(u.id, id, { guard: { sql: 'AND d.total_ht_cents > ?', params: [0] } }))).issued).toBe(false);
    expect(await counter(u.id)).toBeNull();
  });

  it('annule tout si une instruction du batch échoue (atomicité)', async () => {
    const u = await createUser('a@example.test');
    const id = await draft(u.id);
    await expect(runIssue(env.DB, target(u.id, id, { snapshotJson: '{ pas du json' }))).rejects.toThrow();
    expect(await counter(u.id)).toBeNull();
    const row = await env.DB.prepare('SELECT status, number FROM invoices WHERE id = ?').bind(id).first();
    expect(row).toEqual({ status: 'draft', number: null });
  });

  it('écrit le numéro dans l’instantané et applique les colonnes demandées', async () => {
    const u = await createUser('a@example.test');
    const id = await draft(u.id);
    await runIssue(env.DB, target(u.id, id, { snapshotJson: JSON.stringify({ schemaVersion: 1, number: null }) }));
    const row = await env.DB.prepare("SELECT number, status, issue_date, json_extract(snapshot_json, '$.number') AS snap FROM invoices WHERE id = ?").bind(id).first();
    expect(row).toEqual({ number: 'F-2026-001', status: 'issued', issue_date: '2026-11-03', snap: 'F-2026-001' });
  });

  it('produit le même format que formatDocumentNumber', async () => {
    const u = await createUser('a@example.test');
    await env.DB.prepare("INSERT INTO counters (user_id, series, year, last_value) VALUES (?, 'F', 2026, 1233)").bind(u.id).run();
    expect((await runIssue(env.DB, target(u.id, await draft(u.id)))).number).toBe(formatDocumentNumber('F', 2026, 1234));
  });
});
