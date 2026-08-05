/**
 * Steady-free (catalog freeType) candidate filter for `auto/*:free` pools.
 *
 * Regression guard for the "false free" failure mode: `:free` narrowing decides free by
 * price (`classifyTier`), so models the documented catalog flags as needing a signup
 * deposit / credit plan (`one-time-initial` like nvidia/deepseek, and `recurring-credit`)
 * can slip into an `auto/*:free` pool and 402/403/404 because the account has no balance.
 * Tests the pure `filterNonSteadyFreeCandidates` wired into
 * `open-sse/services/autoCombo/virtualFactory.ts::createVirtualAutoCombo` for `spec.tier === "free"`.
 */
import { test } from "vitest";
import assert from "node:assert/strict";

import { filterNonSteadyFreeCandidates } from "../../../open-sse/services/autoCombo/freeModelFilter.ts";

// Real documented catalog shapes:
//   nvidia          → one-time-initial (needs signup deposit)
//   deepseek        → one-time-initial
//   groq llama-3.3  → recurring-daily  (steady free on arrival)
//   mistral medium  → recurring-monthly (steady free on arrival)
const NVIDIA_DEPOSIT = { provider: "nvidia", model: "z-ai/glm-5.1" };
const DEEPSEEK_DEPOSIT = { provider: "deepseek", model: "deepseek-v4-flash" };
const GROQ_STEADY = { provider: "groq", model: "llama-3.3-70b-versatile" };
const MISTRAL_STEADY = { provider: "mistral", model: "mistral-medium-3-5" };

test("drops one-time-initial (deposit) providers from a free pool", () => {
  const result = filterNonSteadyFreeCandidates([NVIDIA_DEPOSIT, GROQ_STEADY]);
  assert.deepEqual(result, [GROQ_STEADY], "nvidia (one-time-initial) must be excluded");
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
  const result = filterNonSteadyFreeCandidates([unknown, NVIDIA_DEPOSIT]);
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
  const result = filterNonSteadyFreeCandidates([enriched, NVIDIA_DEPOSIT]);
  assert.deepEqual(result, [enriched], "generic <T> filter must not strip candidate fields");
});
