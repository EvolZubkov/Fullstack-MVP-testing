-- Topic readable id (2026-06-30): optional author-defined slug for a topic.
-- When set, result-variable formulas (PRD-2) address the topic via
-- `topicById("<code>")` instead of the opaque UUID; absent (NULL) → the UUID is
-- used. Also enables `topicByName("<name>")`. Uniqueness is NOT enforced at the
-- DB level — topic references resolve per-test (the editor warns on within-test
-- collisions). Additive, nullable: existing rows keep UUID addressing.
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "code" text;
