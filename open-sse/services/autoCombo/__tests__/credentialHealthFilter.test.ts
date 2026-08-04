/**
 * Regression guard for excluding connections the CredentialHealth
 * scheduler proved broken from `auto/*` candidate pools.
 *
 * Tests the pure `filterCredentialUnhealthyCandidates` helper wired into
 * `open-sse/services/autoCombo/virtualFactory.ts::createVirtualAutoCombo`.
 * The health verdict is injected (not the global cache) so fail-open behavior
 * and allowlist trimming are testable in isolation.
 */
import { test } from "vitest";
import assert from "node:assert/strict";

import { filterCredentialUnhealthyCandidates } from "../credentialHealthFilter.ts";

// Health verdicts
const HEALTHY = () => true;
const UNKNOWN = () => undefined; // never tested / cache expired
// Distinguishes the two fixture connection ids (bad one is known-broken).
const isHealthy = (connectionId: string) => connectionId === OK_CONN;

const OK_CONN = "conn-good";
const BAD_CONN = "conn-billing-broken";

const LOGICAL_OK = {
  provider: "groq",
  connectionId: null,
  allowedConnectionIds: [OK_CONN],
  model: "llama-3.3-70b-versatile",
};
const LOGICAL_BAD = {
  provider: "sambanova",
  connectionId: null,
  allowedConnectionIds: [BAD_CONN],
  model: "MiniMax-M2.7",
};
const LOGICAL_MIXED = {
  provider: "x",
  connectionId: null,
  allowedConnectionIds: [OK_CONN, BAD_CONN],
  model: "m",
};
const DIRECT_BAD = { provider: "deepseek", connectionId: BAD_CONN, model: "deepseek-v4-flash" };
const DIRECT_OK = { provider: "openrouter", connectionId: OK_CONN, model: "auto" };

test("unknown health (fail-open) returns the pool UNCHANGED (identity, regression guard)", () => {
  const pool = [LOGICAL_OK, LOGICAL_BAD, DIRECT_BAD];
  const result = filterCredentialUnhealthyCandidates(pool, UNKNOWN);
  assert.equal(result, pool, "must return the exact same array reference when nothing is known");
  assert.deepEqual(result, [LOGICAL_OK, LOGICAL_BAD, DIRECT_BAD], "nothing is filtered");
});

test("healthy connections keep the pool unchanged", () => {
  const pool = [LOGICAL_OK, DIRECT_OK];
  const result = filterCredentialUnhealthyCandidates(pool, HEALTHY);
  assert.equal(result, pool, "all-healthy pool must be the identity");
});

test("known-bad connection drops the credentialed candidate entirely", () => {
  const result = filterCredentialUnhealthyCandidates([LOGICAL_OK, LOGICAL_BAD], isHealthy);
  assert.deepEqual(
    result,
    [LOGICAL_OK],
    "SambaNova (billing broken) must be dropped; healthy Groq kept"
  );
});

test("mixed allowlist trims the broken connection, keeps the candidate", () => {
  const result = filterCredentialUnhealthyCandidates([LOGICAL_MIXED], isHealthy);
  assert.deepEqual(
    result,
    [{ ...LOGICAL_MIXED, allowedConnectionIds: [OK_CONN] }],
    "bad connection removed from allowlist, candidate survives with the healthy one"
  );
});

test("direct connection-id candidate with known-bad health is dropped", () => {
  const result = filterCredentialUnhealthyCandidates([DIRECT_BAD, DIRECT_OK], isHealthy);
  assert.deepEqual(
    result,
    [DIRECT_OK],
    "direct DeepSeek candidate (insufficient balance) dropped, healthy one kept"
  );
});

test("all-broken pool degrades to an empty pool", () => {
  const result = filterCredentialUnhealthyCandidates([LOGICAL_BAD, DIRECT_BAD], isHealthy);
  assert.deepEqual(result, [], "all-broken pool becomes empty — the graceful empty-pool path");
});

test("preserves extra candidate fields on kept entries", () => {
  const enriched = { ...LOGICAL_MIXED, extra: 1 };
  const result = filterCredentialUnhealthyCandidates([enriched], isHealthy);
  assert.deepEqual(
    result,
    [{ ...LOGICAL_MIXED, allowedConnectionIds: [OK_CONN], extra: 1 }],
    "generic <T> filter must not strip candidate fields"
  );
});
