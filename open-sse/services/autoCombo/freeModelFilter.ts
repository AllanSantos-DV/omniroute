/**
 * Steady-free candidate filter for `auto/*:free` pools.
 *
 * The category/tier narrowing for `:free` (`suffixComposition.buildAutoCandidateFilter`)
 * decides "free" purely by price via `classifyTier` (tierResolver.ts → providerCostData),
 * so models the documented free catalog flags as needing a signup deposit or a credit
 * plan — `one-time-initial` (e.g. deepseek, agentrouter) and `recurring-credit` — can slip
 * into an `auto/*:free` pool and then 402/403/404 at request time because the account
 * has no balance. That is exactly the "false free" failure mode.
 *
 * This adds a catalog-driven pass: when a `:free` pool is being materialized, drop any
 * candidate whose `provider/model` is documented in `FREE_MODEL_BUDGETS` with a
 * non-steady `freeType`. Models the catalog never documents (custom/synced rows, brand
 * new providers) pass through — fail-open, mirroring the credential-health and paid-only
 * filters, so a zero-setup pool is never emptied just because a provider is not listed.
 *
 * The compiled catalog is the source of truth, but an optional `overrides` map (populated
 * by the DB-aware caller from `free_model_type_overrides`, migration 134) lets an operator
 * reclassify a model's freeType at runtime — e.g. promoting nvidia to recurring-uncapped
 * after it removed its signup credit cap — without rebuilding the catalog.
 *
 * Kept pure and dependency-light so it is unit-testable in isolation.
 */
import { FREE_MODEL_BUDGETS } from "../../config/freeModelCatalog";
import type { FreeModelFreeType } from "../../config/freeModelCatalog";

/** freeTypes that require a signup deposit / recurring credit to actually serve — NOT "free on arrival". */
const NON_STEADY_FREE_TYPES: ReadonlySet<FreeModelFreeType> = new Set([
  "one-time-initial",
  "recurring-credit",
]);

export interface FreeTypeCandidate {
  provider: string;
  model: string;
}

/**
 * Runtime override of each model's effective freeType, keyed by `provider::model`.
 * Usually populated from `free_model_type_overrides` by the (DB-aware) caller so an
 * operator can reclassify a model's freeType without rebuilding the compiled catalog.
 * When present for a candidate, the override value REPLACES the compiled catalog's
 * freeType for the non-steady decision. Absent → compiled value applies.
 */
export type FreeTypeOverrideMap = ReadonlyMap<string, string>;

// provider::model → compiled freeType, built once at module load.
const COMPILED_FREE_TYPES: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const m of FREE_MODEL_BUDGETS) {
    if (m.modelId) map.set(`${m.provider}::${m.modelId}`, m.freeType);
  }
  return map;
})();

/** The effective freeType for one candidate: runtime override wins over the compiled catalog. */
export function isNonSteadyFreeCandidate(
  provider: string,
  model: string,
  overrides: FreeTypeOverrideMap | undefined,
  nonSteadyTypes: ReadonlySet<FreeModelFreeType>
): boolean {
  let freeType: string | undefined;
  if (overrides) {
    const key = `${provider}::${model}`;
    freeType = overrides.get(key);
  }
  if (freeType === undefined) {
    freeType = COMPILED_FREE_TYPES.get(`${provider}::${model}`);
  }
  // Absent from both the catalog and overrides → not flagged (fail-open): undocumented
  // candidates pass through, mirroring the credential-health and paid-only filters.
  return freeType !== undefined && nonSteadyTypes.has(freeType as FreeModelFreeType);
}

/**
 * Drop candidates whose documented free type is non-steady (requires a signup deposit or
 * a credit plan to actually serve). An optional `overrides` map lets the caller reclassify
 * specific `provider::model` entries at runtime (e.g. promote nvidia to recurring-uncapped)
 * WITHOUT editing the compiled catalog. Returns the pool unchanged (identity) when nothing
 * is excluded; candidates never documented AND never overridden always pass through
 * (fail-open).
 */
export function filterNonSteadyFreeCandidates<T extends FreeTypeCandidate>(
  pool: T[],
  overrides?: FreeTypeOverrideMap
): T[] {
  if (pool.length === 0) return pool;
  const kept = pool.filter(
    (c) => !isNonSteadyFreeCandidate(c.provider, c.model, overrides, NON_STEADY_FREE_TYPES)
  );
  return kept.length === pool.length ? pool : kept;
}
