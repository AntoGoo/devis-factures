import type { PresetData, PresetInput } from '../../shared/preset';
import { notFound } from '../errors';

type Row = { id: string; designation: string; unit: string; unit_price_cents: number };
const toPreset = (r: Row): PresetData => ({ id: r.id, designation: r.designation, unit: r.unit, unitPriceCents: r.unit_price_cents, vatRate: null });

export async function listPresets(db: D1Database, userId: string): Promise<PresetData[]> {
  const { results } = await db.prepare('SELECT id, designation, unit, unit_price_cents FROM line_presets WHERE user_id = ? ORDER BY designation COLLATE NOCASE').bind(userId).all<Row>();
  return results.map(toPreset);
}

export async function insertPreset(db: D1Database, userId: string, input: PresetInput, nowIso: string): Promise<PresetData> {
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO line_presets (id, user_id, designation, unit, unit_price_cents, vat_rate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)')
    .bind(id, userId, input.designation, input.unit, input.unitPriceCents, nowIso, nowIso).run();
  return { id, ...input };
}

export async function updatePreset(db: D1Database, userId: string, id: string, input: PresetInput, nowIso: string): Promise<PresetData> {
  const res = await db.prepare('UPDATE line_presets SET designation = ?, unit = ?, unit_price_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(input.designation, input.unit, input.unitPriceCents, nowIso, id, userId).run();
  if (res.meta.changes === 0) throw notFound('Ligne type introuvable.');
  return { id, ...input };
}

export async function deletePreset(db: D1Database, userId: string, id: string): Promise<void> {
  const res = await db.prepare('DELETE FROM line_presets WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (res.meta.changes === 0) throw notFound('Ligne type introuvable.');
}
