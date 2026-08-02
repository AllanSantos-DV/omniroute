/**
 * Shared provider-credential checks for the Vision Bridge guardrail.
 * Extracted from visionBridge.ts so visionBridgeRouter.ts can reuse the same
 * "is this connection actually usable" logic without a circular import
 * (visionBridge.ts already imports getBestVisionModel from visionBridgeRouter.ts).
 */

import {
  isAccountUnavailable,
  isModelLocked,
} from "@omniroute/open-sse/services/accountFallback.ts";

/**
 * True when a provider connection can actually authenticate upstream.
 * `noauth` with no real API key is NOT usable (opencode-zen free tier often
 * surfaces as noauth and then 401 "Missing API key").
 */
export type ProviderConnectionLike = {
  id?: string | null;
  authType?: string | null;
  apiKey?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  testStatus?: string | null;
  rateLimitedUntil?: string | null;
};

const TERMINAL_CONNECTION_STATUSES = new Set(["disabled", "banned", "expired"]);
// Free/noauth only counts when a real key is still present; apikey/cookie need the same.
const KEY_ONLY_AUTH_TYPES = new Set(["noauth", "none", "", "apikey", "cookie"]);
const TOKEN_AUTH_TYPES = new Set(["oauth", "access_token", "external_idp"]);

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOAuthCredential(connection: ProviderConnectionLike): boolean {
  return (
    hasNonEmptyString(connection.refreshToken) ||
    hasNonEmptyString(connection.accessToken) ||
    hasNonEmptyString(connection.idToken)
  );
}

export function isProviderConnectionUsable(connection: ProviderConnectionLike): boolean {
  const status = String(connection.testStatus || "").toLowerCase();
  if (TERMINAL_CONNECTION_STATUSES.has(status)) {
    return false;
  }

  // A connection still inside its rate-limit cooldown cannot serve a describe
  // call either — without this check the Vision Bridge could keep selecting a
  // cooling model (e.g. a rate-limited Gemini account) and surface 429
  // "All credentials ... cooling down" to the chat handler.
  if (isAccountUnavailable(connection.rateLimitedUntil)) {
    return false;
  }

  const auth = String(connection.authType || "").toLowerCase();
  const hasKey = hasNonEmptyString(connection.apiKey);

  if (KEY_ONLY_AUTH_TYPES.has(auth)) {
    return hasKey;
  }
  if (TOKEN_AUTH_TYPES.has(auth)) {
    return hasOAuthCredential(connection) || hasKey;
  }
  return hasKey;
}

// Memoize the dynamic import itself (not just call it inline per-invocation).
// getVisionCapableModels() fans out to this function once per vision-capable
// catalog entry via Promise.all — tens of concurrent calls on every
// getBestVisionModel()/getFallbackModels() invocation. Issuing a fresh
// `await import(...)` per call means dozens of concurrent first-resolution
// import() calls for the *same* specifier land in the module loader at once;
// under Vitest/vite-node this observably races (some callers resolve against
// the mocked module, others against a real one loaded via a different
// resolution path such as readCache.ts's own relative `./providers` import —
// see tests/unit/guardrails/visionBridgeRouter.test.tsx). Resolving the
// import exactly once and reusing the settled module for every subsequent
// call removes the concurrent-first-load race entirely (and is strictly
// cheaper at runtime too — one module resolution instead of N).
let providersModulePromise: Promise<typeof import("@/lib/db/providers")> | null = null;
function loadProvidersModule(): Promise<typeof import("@/lib/db/providers")> {
  if (!providersModulePromise) {
    providersModulePromise = import("@/lib/db/providers");
  }
  return providersModulePromise;
}

/**
 * Resolve whether `provider/model` has at least one usable active connection.
 * Returns `null` when the credential store is unavailable (unit tests / early boot).
 *
 * A connection counts as usable only when it can authenticate upstream AND is
 * not currently cooling down (`rateLimitedUntil` in the future) AND the
 * specific model is not under a model-level lockout. This mirrors the
 * credential-selection predicates in auth.ts / accountFallback.ts so the
 * Vision Bridge never picks a model whose only accounts are rate-limited —
 * previously that selected a cooling model, the describe call 429'd with
 * `model_cooldown`, and the guardrail's fallback forwarded the raw image to a
 * text-only backend, which rejected it with an opaque upstream error.
 */
export async function hasUsableCredentialsForModel(model: string): Promise<boolean | null> {
  const parts = typeof model === "string" ? model.split("/") : [];
  const provider = parts[0]?.trim() ?? "";
  const modelId = parts.slice(1).join("/").trim();
  if (!provider) return null;
  try {
    const { getProviderConnections } = await loadProvidersModule();
    const connections = await getProviderConnections({ provider, isActive: true });
    if (!Array.isArray(connections)) return null;
    // Empty active set is a definitive "no" only when the table is readable.
    if (connections.length === 0) return false;
    return connections.some(
      (c: any) => isProviderConnectionUsable(c) && !isModelLocked(provider, c.id, modelId || null)
    );
  } catch {
    return null;
  }
}
