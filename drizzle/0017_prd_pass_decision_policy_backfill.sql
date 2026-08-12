-- Custom SQL migration file, put your code below! --
-- Backfill `tests.pass_decision_policy` with the value the editor DERIVED while the
-- column did not exist (client/src/features/tests/editor/test-editor.mappers.ts,
-- readPassDecisionPolicyFromApi): a test whose topics carry an own rule
-- (`custom`/`none`) displayed «общий порог и обязательные темы», every other test
-- displayed «только общий порог». Reproducing that derivation means no author finds
-- a different radio button selected than the one they last saw.
UPDATE "tests" AS t
SET "pass_decision_policy" = 'overall_and_required_topics'
WHERE EXISTS (
  SELECT 1 FROM "test_sections" AS s
  WHERE s."test_id" = t."id"
    AND s."topic_pass_rule_json" ->> 'source' IN ('custom', 'none')
);
