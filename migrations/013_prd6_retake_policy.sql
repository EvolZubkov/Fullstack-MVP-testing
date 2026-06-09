-- PRD-6 (2026-06-04): retake gate / cooldown. Adds the optional per-test
-- `retake_policy_json` column — a policy that gates a new attempt before the
-- SCORM `Initialize` (FR-01/02). NULL = legacy behaviour (no gate; existing
-- tests unaffected). Eligibility is decided by a pluggable rule (PRD-6 §3.4);
-- the policy only stores the chosen plugin key + config id + parameters.
--
-- The detailed shape (enabled/cooldownPeriodDays/eligibilityPlugin/...) is
-- validated by Zod (`retakePolicySchema`); the CHECK only asserts it is a JSON
-- object when present. Idempotent (IF NOT EXISTS column, guarded constraint).

BEGIN;

ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "retake_policy_json" jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tests_retake_policy_check'
  ) THEN
    ALTER TABLE "tests"
      ADD CONSTRAINT "tests_retake_policy_check"
      CHECK (
        "retake_policy_json" IS NULL
        OR jsonb_typeof("retake_policy_json") = 'object'
      );
  END IF;
END $$;

COMMIT;
