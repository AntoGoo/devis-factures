import type { ClientData, ClientInput } from '../../shared/client';
import { notFound } from '../errors';

type Row = { id: string; type: ClientInput['type']; name: string; street: string; postal_code: string; city: string; country: string; siren: string; email: string; phone: string };

const COLS = 'id, type, name, street, postal_code, city, country, siren, email, phone';

const toClient = (r: Row): ClientData => ({
  id: r.id, type: r.type, name: r.name, street: r.street, postalCode: r.postal_code, city: r.city,
  country: r.country, siren: r.siren, email: r.email, phone: r.phone,
});

export async function getClient(db: D1Database, userId: string, id: string): Promise<ClientData | null> {
  const r = await db.prepare(`SELECT ${COLS} FROM clients WHERE id = ? AND user_id = ?`).bind(id, userId).first<Row>();
  return r ? toClient(r) : null;
}

export async function requireClient(db: D1Database, userId: string, id: string): Promise<ClientData> {
  const c = await getClient(db, userId, id);
  if (!c) throw notFound('Client introuvable.');
  return c;
}

export async function listClients(db: D1Database, userId: string): Promise<ClientData[]> {
  const { results } = await db.prepare(`SELECT ${COLS} FROM clients WHERE user_id = ? ORDER BY name COLLATE NOCASE`).bind(userId).all<Row>();
  return results.map(toClient);
}

export async function insertClient(db: D1Database, userId: string, input: ClientInput, nowIso: string): Promise<ClientData> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO clients (id, user_id, type, name, street, postal_code, city, country, siren, email, phone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, userId, input.type, input.name, input.street, input.postalCode, input.city, input.country, input.siren, input.email, input.phone, nowIso, nowIso).run();
  return { id, ...input };
}

export async function updateClient(db: D1Database, userId: string, id: string, input: ClientInput, nowIso: string): Promise<ClientData> {
  const res = await db.prepare(
    `UPDATE clients SET type = ?, name = ?, street = ?, postal_code = ?, city = ?, country = ?, siren = ?, email = ?, phone = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(input.type, input.name, input.street, input.postalCode, input.city, input.country, input.siren, input.email, input.phone, nowIso, id, userId).run();
  if (res.meta.changes === 0) throw notFound('Client introuvable.');
  return { id, ...input };
}
