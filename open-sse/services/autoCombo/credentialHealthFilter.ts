/**
 * Credential-health-aware pool filter — exclude connections the
 * CredentialHealth scheduler already proved broken from `auto/*` candidate pools.
 *
 * The background CredentialHealth scheduler (`src/lib/credentialHealth/scheduler.ts`)
 * tests every provider connection every 5min and records the verdict in an
 * in-memory cache (`src/lib/credentialHealth/cache.ts`). The auto-combo pool
 * builder only checked `isActive` + circuit breakers, so a dead account
 * (e.g. SambaNova "A payment method is required", DeepSeek "Insufficient
 * Balance", NVIDIA kimi-k2.6 `not_found`) stayed in the pool and the LKGP kept
 * probing it at request time — surfacing as the "model not found" symptoms
 * observed on `auto/best-free`.
 *
 * Pure, dependency-light filter kept separate from `virtualFactory.ts` so it is
 * unit-testable in isolation, mirroring `paidModelFilter.ts` /
 * `resilienceCandidateFilter.ts` in this directory. Fail-open by design:
 * connections with `undefined` health (never tested / cache expired) pass
 * through — only a definite `false` is removed.
 */
import { isCredentialHealthy } from "@/lib/credentialHealth/cache";

interface HealthFilterCandidate {
  connectionId: string | null;
  allowedConnectionIds?: string[];
}

export type ConnectionHealthCheck = (connectionId: string) => boolean | undefined;

function isKnownBad(
  connectionId: string | null | undefined,
  isHealthy: ConnectionHealthCheck
): boolean {
  if (typeof connectionId !== "string" || connectionId.length === 0) return false;
  return isHealthy(connectionId) === false;
}

/**
 * Return the candidate pool with known-broken connections removed (both from a
 * credentialed candidate's allowlist and from direct connection-id candidates).
 * A credentialed candidate whose allowlist becomes empty is dropped. Returns
 * the SAME array reference (identity) when nothing changed, so callers can
 * cheaply detect "unchanged" like the other autoCombo filters.
 */
export function filterCredentialUnhealthyCandidates<T extends HealthFilterCandidate>(
  pool: T[],
  isHealthy: ConnectionHealthCheck = isCredentialHealthy
): T[] {
  if (!Array.isArray(pool) || pool.length === 0) return pool;

  let changed = false;
  const filtered = pool.flatMap((candidate) => {
    if (Array.isArray(candidate.allowedConnectionIds)) {
      const allowedConnectionIds = candidate.allowedConnectionIds.filter(
        (connectionId) => !isKnownBad(connectionId, isHealthy)
      );
      if (allowedConnectionIds.length === 0) {
        changed = true;
        return [];
      }
      if (allowedConnectionIds.length === candidate.allowedConnectionIds.length) {
        return [candidate];
      }
      changed = true;
      return [{ ...candidate, allowedConnectionIds }];
    }

    if (isKnownBad(candidate.connectionId, isHealthy)) {
      changed = true;
      return [];
    }

    return [candidate];
  });

  return changed ? filtered : pool;
}
