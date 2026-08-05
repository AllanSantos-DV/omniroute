-- free_model_type_overrides: operator-set freeTier overrides per (provider, model_id).
-- Lets an operator reclassify a documented free model's freeType (e.g. promoting a
-- one-time-initial signup credit to recurring-uncapped) at runtime, WITHOUT rebuilding
-- the compiled FREE_MODEL_BUDGETS catalog or redeploying. Rows here OVERRIDE the
-- compiled catalog's freeType for that exact (provider, model_id); when no row exists,
-- the compiled catalog value applies. Empty by default (zero overrides = compiled behavior).
CREATE TABLE IF NOT EXISTS free_model_type_overrides (
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  free_type TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, model_id)
);