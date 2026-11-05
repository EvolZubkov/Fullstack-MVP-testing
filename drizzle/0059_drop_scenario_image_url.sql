-- The picture of a router hub card is a DESIGN property of the router page (owner's decision
-- 2026-10-15), stored in the router variant's `cardImages` setting keyed by item key
-- (`shared/template/router-card-images`). The column below was the earlier idea of keeping it on
-- the scenario item: nothing ever read it, and the editor overwrote it with NULL on every save.
-- DESTRUCTIVE: `npm run dev` will not apply it to the shared dev DB; run `npm run db:migrate`.
ALTER TABLE "test_scenarios" DROP COLUMN "image_url";
