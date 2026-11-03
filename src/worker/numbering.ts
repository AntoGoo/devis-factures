import type { Series } from '../shared/numbering';
import { HttpError } from './errors';

export type IssueTarget = {
  table: 'quotes' | 'invoices';
  docId: string;
  userId: string;
  series: Series;
  year: number;
  prefix: string;
  /** Colonnes modifiées dans la même instruction que l'attribution du numéro. */
  set: Record<string, string | number | null>;
  /** Instantané JSON : son champ $.number reçoit le numéro attribué. */
  snapshotJson?: string;
  /** Condition SQL supplémentaire sur la ligne du document (alias d), commençant par AND. */
  guard?: { sql: string; params: (string | number | null)[] };
};

const COLUMN = /^[a-z_]+$/;

export function issueStatements(db: D1Database, t: IssueTarget): [D1PreparedStatement, D1PreparedStatement] {
  const guardSql = t.guard?.sql ?? '';
  const guardParams = t.guard?.params ?? [];

  // 1. Incrémente le compteur seulement si le document est un brouillon de cet utilisateur.
  const counter = db
    .prepare(
      `INSERT INTO counters (user_id, series, year, last_value)
       SELECT ?, ?, ?, 1
       WHERE EXISTS (SELECT 1 FROM ${t.table} AS d WHERE d.id = ? AND d.user_id = ? AND d.status = 'draft' ${guardSql})
       ON CONFLICT (user_id, series, year) DO UPDATE SET last_value = counters.last_value + 1`,
    )
    .bind(t.userId, t.series, t.year, t.docId, t.userId, ...guardParams);

  // 2. Pose le numéro (lu dans le compteur) et les autres colonnes, sous la même condition.
  const numberSql = `(SELECT printf('%s-%d-%03d', ?, c.year, c.last_value) FROM counters AS c WHERE c.user_id = ? AND c.series = ? AND c.year = ?)`;
  const numberParams = [t.prefix, t.userId, t.series, t.year];
  const assignments = [`number = ${numberSql}`];
  const params: (string | number | null)[] = [...numberParams];
  for (const [col, value] of Object.entries(t.set)) {
    if (!COLUMN.test(col)) throw new Error(`Colonne refusée : ${col}`);
    assignments.push(`${col} = ?`);
    params.push(value);
  }
  if (t.snapshotJson !== undefined) {
    assignments.push(`snapshot_json = json_set(?, '$.number', ${numberSql})`);
    params.push(t.snapshotJson, ...numberParams);
  }
  const update = db
    .prepare(`UPDATE ${t.table} AS d SET ${assignments.join(', ')} WHERE d.id = ? AND d.user_id = ? AND d.status = 'draft' ${guardSql}`)
    .bind(...params, t.docId, t.userId, ...guardParams);

  return [counter, update];
}

export async function runIssue(
  db: D1Database,
  t: IssueTarget,
  opts: { before?: D1PreparedStatement[] } = {},
): Promise<{ issued: boolean; number: string | null }> {
  const before = opts.before ?? [];
  const [counter, update] = issueStatements(db, t);
  const read = db.prepare(`SELECT number FROM ${t.table} WHERE id = ? AND user_id = ?`).bind(t.docId, t.userId);
  let results: D1Result[];
  try {
    results = await db.batch([...before, counter, update, read]);
  } catch (e) {
    // Numéro déjà pris (préfixe réutilisé d'une autre série) : le batch est annulé en entier.
    if (String(e).includes('UNIQUE') && String(e).includes('.number')) {
      throw new HttpError(409, 'number_conflict', 'Ce numéro existe déjà : vérifiez les préfixes de numérotation dans votre profil.');
    }
    throw e;
  }
  const updated = results[before.length + 1]!;
  const row = results[before.length + 2]!.results[0] as { number: string | null } | undefined;
  return { issued: updated.meta.changes === 1, number: row?.number ?? null };
}
