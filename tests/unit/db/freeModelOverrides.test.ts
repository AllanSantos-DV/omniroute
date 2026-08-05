/**
 * Unit tests for src/lib/db/freeModelOverrides.ts — runtime freeType overrides
 * for the steady-free pool filter (migration 134).
 *
 * Uses isolated DATA_DIR per run; each test gets a fresh DB.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-free-model-overrides-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../../src/lib/db/core.ts");
const fmo = await import("../../../src/lib/db/freeModelOverrides.ts");
const { getDbInstance } = await import("../../../src/lib/db/core.ts");

function resetDb() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(() => {
  resetDb();
});

test.after(() => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("migration 134 creates the free_model_type_overrides table", () => {
  const db = getDbInstance();
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'free_model_type_overrides'"
    )
    .get();
  assert.ok(row, "table free_model_type_overrides should exist after migrations run");
});

test("empty table yields an empty map and null lookups", () => {
  assert.equal(fmo.getFreeModelTypeOverrides().size, 0);
  assert.equal(fmo.getFreeModelTypeOverride("nvidia", "nvidia/llama-3.1-8b-instruct"), null);
  assert.deepEqual(fmo.listFreeModelTypeOverrides(), []);
});

test("set then get an override returns the stored freeType", () => {
  const created = fmo.setFreeModelTypeOverride(
    "nvidia",
    "nvidia/llama-3.1-8b-instruct",
    "recurring-uncapped",
    "nvidia removed signup credit caps"
  );
  assert.ok(created);
  assert.equal(created.provider, "nvidia");
  assert.equal(created.modelId, "nvidia/llama-3.1-8b-instruct");
  assert.equal(created.freeType, "recurring-uncapped");

  assert.equal(
    fmo.getFreeModelTypeOverride("nvidia", "nvidia/llama-3.1-8b-instruct"),
    "recurring-uncapped"
  );

  const map = fmo.getFreeModelTypeOverrides();
  assert.equal(map.size, 1);
  assert.equal(map.get("nvidia::nvidia/llama-3.1-8b-instruct"), "recurring-uncapped");
});

test("upsert overwrites freeType and note but keeps the same single row", () => {
  fmo.setFreeModelTypeOverride(
    "nvidia",
    "nvidia/llama-3.1-8b-instruct",
    "one-time-initial",
    "first"
  );
  fmo.setFreeModelTypeOverride(
    "nvidia",
    "nvidia/llama-3.1-8b-instruct",
    "recurring-uncapped",
    "corrected"
  );

  const rows = fmo.listFreeModelTypeOverrides();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].freeType, "recurring-uncapped");
  assert.equal(rows[0].note, "corrected");
});

test("overrides are keyed per (provider, model_id) — same provider, different models coexist", () => {
  fmo.setFreeModelTypeOverride("nvidia", "nvidia/llama-3.1-8b-instruct", "recurring-uncapped");
  fmo.setFreeModelTypeOverride("nvidia", "nvidia/llama-3.1-405b-instruct", "recurring-uncapped");
  fmo.setFreeModelTypeOverride("deepseek", "deepseek-chat", "recurring-uncapped");

  assert.equal(fmo.getFreeModelTypeOverrides().size, 3);
  assert.equal(
    fmo.getFreeModelTypeOverride("nvidia", "nvidia/llama-3.1-405b-instruct"),
    "recurring-uncapped"
  );
  assert.equal(fmo.getFreeModelTypeOverride("deepseek", "deepseek-chat"), "recurring-uncapped");
});

test("set with null freeType removes the override (compiled catalog applies again)", () => {
  fmo.setFreeModelTypeOverride("nvidia", "nvidia/llama-3.1-8b-instruct", "recurring-uncapped");
  assert.equal(
    fmo.getFreeModelTypeOverride("nvidia", "nvidia/llama-3.1-8b-instruct"),
    "recurring-uncapped"
  );

  const removed = fmo.setFreeModelTypeOverride("nvidia", "nvidia/llama-3.1-8b-instruct", null);
  assert.equal(removed, null);
  assert.equal(fmo.getFreeModelTypeOverride("nvidia", "nvidia/llama-3.1-8b-instruct"), null);
  assert.equal(fmo.getFreeModelTypeOverrides().size, 0);
});

test("list returns rows newest first", () => {
  fmo.setFreeModelTypeOverride("a", "m1", "recurring-uncapped");
  fmo.setFreeModelTypeOverride("b", "m2", "recurring-uncapped");

  const rows = fmo.listFreeModelTypeOverrides();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].provider, "b");
});

test("empty provider/modelId is rejected", () => {
  assert.throws(() => fmo.setFreeModelTypeOverride("", "m", "recurring-uncapped"), /required/i);
  assert.throws(() => fmo.setFreeModelTypeOverride("p", "", "recurring-uncapped"), /required/i);
});
