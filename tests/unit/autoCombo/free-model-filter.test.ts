/**
 * Steady-free (catalog freeType) candidate filter for `auto/*:free` pools.
 *
 * Regression guard for the "false free" failure mode: `:free` narrowing decides free by
 * price (`classifyTier`), so models the documented catalog flags as needing a signup
 * deposit / credit plan (`one-time-initial` like deepseek, and `recurring-credit`)
 * can slip into an `auto/*:free` pool and 402/403/404 because the account has no balance.
 * Tests the pure `filterNonSteadyFreeCandidates` wired into
 * `open-sse/services/autoCombo/virtualFactory.ts::createVirtualAutoCombo` for `spec.tier === "free"`.
 *
 * Also covers the runtime override path (`free_model_type_overrides`, migration 134): an
 * operator can reclassify a model's freeType without rebuilding the compiled catalog, and
 * the override REPLACES the catalog value for the affected candidates.
 */
import { test } from "vitest";
import assert from "node:assert/strict";

import { filterNonSteadyFreeCandidates } from "../../../open-sse/services/autoCombo/freeModelFilter.ts";

// Real documented catalog shapes:
//   nvidia          → recurring-uncapped (free unlimited, rate-limited on arrival)
//   deepseek        → one-time-initial (needs signup deposit)
//   groq llama-3.3  → recurring-daily  (steady free on arrival)
//   mistral medium  → recurring-monthly (steady free on arrival)
const NVIDIA_STEADY = { provider: "nvidia", model: "z-ai/glm-5.1" };
const DEEPSEEK_DEPOSIT = { provider: "deepseek", model: "deepseek-v4-flash" };
const GROQ_STEADY = { provider: "groq", model: "llama-3.3-70b-versatile" };
const MISTRAL_STEADY = { provider: "mistral", model: "mistral-medium-3-5" };

test("drops one-time-initial (deposit) providers from a free pool", () => {
  // deepseek still requires a signup balance; nvidia is now steady (uncapped).
  const result = filterNonSteadyFreeCandidates([DEEPSEEK_DEPOSIT, GROQ_STEADY]);
  assert.deepEqual(result, [GROQ_STEADY], "deepseek (one-time-initial) must be excluded");
});

test("keeps nvidia in a free pool (recurring-uncapped, free on arrival)", () => {
  const result = filterNonSteadyFreeCandidates([NVIDIA_STEADY, GROQ_STEADY]);
  assert.deepEqual(
    result,
    [NVIDIA_STEADY, GROQ_STEADY],
    "nvidia (recurring-uncapped) is steady and must NOT be excluded"
  );
});

test("drops recurring-credit candidates and keeps steady-free ones", () => {
  // agentrouter is documented one-time-initial (needs load); mistral is recurring-monthly.
  const result = filterNonSteadyFreeCandidates([
    MISTRAL_STEADY,
    { provider: "agentrouter", model: "claude-opus-4-8" },
  ]);
  assert.deepEqual(
    result,
    [MISTRAL_STEADY],
    "recurring-credit/one-time must be excluded; recurring kept"
  );
});

test("keeps a mixed steady pool unchanged (identity) when nothing is non-steady", () => {
  const pool = [
    GROQ_STEADY,
    MISTRAL_STEADY,
    { provider: "opencode", model: "deepseek-v4-flash-free" },
  ];
  const result = filterNonSteadyFreeCandidates(pool);
  assert.equal(result, pool, "no exclusions → same reference");
  assert.deepEqual(result, pool);
});

test("fail-open: candidates the catalog never documents always pass through", () => {
  const unknown = { provider: "moonshot", model: "kimi-k3" }; // not in FREE_MODEL_BUDGETS
  const result = filterNonSteadyFreeCandidates([unknown, DEEPSEEK_DEPOSIT]);
  assert.deepEqual(
    result,
    [unknown],
    "undocumented provider is kept even alongside a deposit-required one"
  );
});

test("empty pool returns unchanged (identity)", () => {
  const empty: Array<{ provider: string; model: string }> = [];
  assert.equal(
    filterNonSteadyFreeCandidates(empty),
    empty,
    "empty pool returns the same reference"
  );
});

test("preserves extra candidate fields on kept entries", () => {
  const enriched = {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    connectionId: "abc",
    allowedConnectionIds: ["abc"],
    extra: 1,
  };
  const result = filterNonSteadyFreeCandidates([enriched, DEEPSEEK_DEPOSIT]);
  assert.deepEqual(result, [enriched], "generic <T> filter must not strip candidate fields");
});

test("runtime override promoting a deposit model to steady keeps it (no rebuild)", () => {
  // deepseek is compiled one-time-initial; an override map effectively reclassifies it
  // to recurring-uncapped — the equivalent of an operator row in free_model_type_overrides.
  const overrides = new Map<string, string>([
    ["deepseek::deepseek-v4-flash", "recurring-uncapped"],
  ]);
  const result = filterNonSteadyFreeCandidates([DEEPSEEK_DEPOSIT, GROQ_STEADY], overrides);
  assert.deepEqual(
    result,
    [DEEPSEEK_DEPOSIT, GROQ_STEADY],
    "overridden freeType must replace the compiled catalog value"
  );
});

test("runtime override demoting a steady model removes it even if catalog says steady", () => {
  // nvidia is compiled recurring-uncapped; an override row marking it one-time-initial
  // must now exclude it, proving the override REPLACES (not merely supplements) catalog data.
  const overrides = new Map<string, string>([["nvidia::z-ai/glm-5.1", "one-time-initial"]]);
  const result = filterNonSteadyFreeCandidates([NVIDIA_STEADY, GROQ_STEADY], overrides);
  assert.deepEqual(result, [GROQ_STEADY], "override wins over the compiled steady classification");
});

test("overrides for unrelated keys leave catalog behavior unchanged", () => {
  const overrides = new Map<string, string>([["opencode::some-other-model", "recurring-uncapped"]]);
  const result = filterNonSteadyFreeCandidates([DEEPSEEK_DEPOSIT, GROQ_STEADY], overrides);
  assert.deepEqual(
    result,
    [GROQ_STEADY],
    "irrelevant override keys must not affect other candidates"
  );
});

test("empty map behaves exactly like no overrides (identity preserved)", () => {
  const pool = [GROQ_STEADY, MISTRAL_STEADY];
  assert.equal(
    filterNonSteadyFreeCandidates(pool, new Map<string, string>()),
    pool,
    "empty override map → compiled catalog only, same reference"
  );
});
