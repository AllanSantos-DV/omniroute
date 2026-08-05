/**
 * Steady-free candidate filter for `auto/*:free` pools.
 *
 * The category/tier narrowing for `:free` (`suffixComposition.buildAutoCandidateFilter`)
 * decides "free" purely by price via `classifyTier` (tierResolver.ts → providerCostData),
 * so models the documented free catalog flags as needing a signup deposit or a credit
 * plan — `one-time-initial` (e.g. nvidia, deepseek) and `recurring-credit` — can slip
 * into an `auto/*:free` pool and then 402/403/404 at request time because the account
 * has no balance. That is exactly the "false free" failure mode.
 *
 * This adds a catalog-driven pass: when a `:free` pool is being materialized, drop any
 * candidate whose `provider/model` is documented in `FREE_MODEL_BUDGETS` with a
 * non-steady `freeType`. Models the catalog never documents (custom/synced rows, brand
 * new providers) pass through — fail-open, mirroring the credential-health and paid-only
 * filters, so a zero-setup pool is never emptied just because a provider is not listed.
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

// provider::model → non-steady freeType, built once at module load.
const NON_STEADY_MODEL_KEYS: ReadonlySet<string> = (() => {
  const set = new Set<string>();
  for (const m of FREE_MODEL_BUDGETS) {
    if (NON_STEADY_FREE_TYPES.has(m.freeType) && m.modelId) {
      set.add(`${m.provider}::${m.modelId}`);
    }
  }
  return set;
})();

/**
 * Drop candidates whose provider/model the documented free catalog marks as requiring a
 * signup deposit or a credit plan. Returns the pool unchanged (identity) when nothing is
 * excluded; candidates never documented by the catalog always pass through (fail-open).
 */
export function filterNonSteadyFreeCandidates<T extends FreeTypeCandidate>(pool: T[]): T[] {
  if (pool.length === 0) return pool;
  const kept = pool.filter((c) => !NON_STEADY_MODEL_KEYS.has(`${c.provider}::${c.model}`));
  return kept.length === pool.length ? pool : kept;
}
