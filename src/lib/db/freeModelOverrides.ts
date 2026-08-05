/**
 * db/freeModelOverrides.ts — Operator-set freeType overrides for the documented
 * free-model catalog (migration 134).
 *
 * The compiled `FREE_MODEL_BUDGETS` (open-sse/config/freeModelCatalog.data.ts) classifies
 * every free model with a `freeType` (one-time-initial, recurring-uncapped, ...). The
 * steady-free pool filter (`open-sse/services/autoCombo/freeModelFilter.ts`) drops
 * non-steady freeTypes from `auto/*:free` pools, so a stale classification (e.g. nvidia
 * still marked one-time-initial after removing its signup credit cap) wrongly excludes an
 * otherwise-serving provider — and, because the catalog is compiled TypeScript, correcting
 * it required a rebuild + redeploy.
 *
 * This module lets an operator override the freeType for an exact (provider, model_id) at
 * runtime, without rebuilding. Rows here take precedence over the compiled catalog; when
 * no row exists, the compiled value applies. Relational row-per-override, mirroring the
 * style of `autoCandidateOverrides.ts` rather than a JSON-blob key_value entry.
 *
 * The override map is consumed by `freeModelFilter.ts` (via `virtualFactory.ts`, which is
 * already DB-aware and async) — the pure filter function stays dependency-light and
 * unit-testable by receiving the overrides as a parameter.
 */
import { getDbInstance } from "./core";

export interface FreeModelTypeOverride {
  provider: string;
  modelId: string;
  freeType: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

type OverrideRow = {
  provider: string;
  model_id: string;
  free_type: string;
  note: string;
  created_at: string;
  updated_at: string;
};

function rowToOverride(row: OverrideRow): FreeModelTypeOverride {
  return {
    provider: row.provider,
    modelId: row.model_id,
    freeType: row.free_type,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FIELDS = `provider, model_id, free_type, note, created_at, updated_at`;

/** Returns every override row as a map keyed by `provider::model_id`. */
export function getFreeModelTypeOverrides(): Map<string, string> {
  const db = getDbInstance();
  const rows = db.prepare(`SELECT ${FIELDS} FROM free_model_type_overrides`).all() as OverrideRow[];
  const map = new Map<string, string>();
  for (const row of rows) map.set(`${row.provider}::${row.model_id}`, row.free_type);
  return map;
}

/** Returns the override freeType for one (provider, model_id), or null if none set. */
export function getFreeModelTypeOverride(provider: string, modelId: string): string | null {
  if (!provider || !modelId) return null;
  const db = getDbInstance();
  const row = db
    .prepare(`SELECT ${FIELDS} FROM free_model_type_overrides WHERE provider = ? AND model_id = ?`)
    .get(provider, modelId) as OverrideRow | undefined;
  return row?.free_type ?? null;
}

/**
 * Upserts (or, with `freeType` empty, deletes) the freeType override for an exact
 * (provider, model_id). Passing null/empty `freeType` removes the override so the compiled
 * catalog value applies again. Idempotent — overwriting the same value is a no-op-ish UPSERT.
 */
export function setFreeModelTypeOverride(
  provider: string,
  modelId: string,
  freeType: string | null,
  note = ""
): FreeModelTypeOverride | null {
  if (!provider || !modelId) throw new Error("provider and modelId are required");
  const db = getDbInstance();

  if (!freeType) {
    db.prepare(`DELETE FROM free_model_type_overrides WHERE provider = ? AND model_id = ?`).run(
      provider,
      modelId
    );
    return null;
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO free_model_type_overrides (provider, model_id, free_type, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, model_id) DO UPDATE SET
       free_type = excluded.free_type,
       note = excluded.note,
       updated_at = excluded.updated_at`
  ).run(provider, modelId, freeType, note, now, now);

  const row = db
    .prepare(`SELECT ${FIELDS} FROM free_model_type_overrides WHERE provider = ? AND model_id = ?`)
    .get(provider, modelId) as OverrideRow;
  return rowToOverride(row);
}

/** Lists all override rows, newest first (rowid tiebreaks same-millisecond inserts). */
export function listFreeModelTypeOverrides(): FreeModelTypeOverride[] {
  const db = getDbInstance();
  const rows = db
    .prepare(`SELECT ${FIELDS} FROM free_model_type_overrides ORDER BY updated_at DESC, rowid DESC`)
    .all() as OverrideRow[];
  return rows.map(rowToOverride);
}
