/**
 * @module server/services/home/my-tests
 *
 * PRD-25: the authoring home section «Мои тесты» (FR-09). Visibility comes from
 * the EXISTING scope service (`readableTestScope`) and the publication state from
 * the EXISTING snapshot service — the home page owns no visibility or publication
 * logic of its own (FR-16, spec section 5).
 */
import { storage } from "../../storage";
import { readableTestScope } from "../test-access";
import { getPublicationState } from "../test-snapshot";
import { hasPermission, type Role } from "@shared/access";
import type { AttentionKind, HomeTestStatus, MyTestItem } from "@shared/home/contract";

/**
 * How many tests the section shows before «показать все» (FR-09). It is also the
 * hard bound on how many publication states are computed per page load — see the
 * R-3 note below.
 */
const MY_TESTS_LIMIT = 6;

/** Newest first by the working copy's modification time (FR-09). */
function byUpdatedDesc(a: { updatedAt: Date }, b: { updatedAt: Date }): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

/**
 * The tests the user may read, newest first, capped at {@link MY_TESTS_LIMIT},
 * with flagged cards raised to the top of that window. `total` reports the true
 * number of visible tests so the UI can label the «показать все» link.
 *
 * @param userId - the current user.
 * @param roles - the user's effective role set.
 */
export async function buildMyTests(
  userId: string,
  roles: readonly Role[],
): Promise<{ items: MyTestItem[]; total: number }> {
  const scope = await readableTestScope(roles, userId);
  const all = await storage.getTests();
  const visible = all.filter((test) => scope.all || scope.ids.has(test.id));

  // R-3: `getPublicationState` costs a query PER TEST (snapshot + live pool of
  // every topic it draws from). The window is therefore cut BEFORE the state is
  // asked for, so the cost of the home page is constant (at most
  // MY_TESTS_LIMIT states) instead of linear in the size of the test bank. Never
  // move this slice below the enrichment loop.
  const window = [...visible].sort(byUpdatedDesc).slice(0, MY_TESTS_LIMIT);

  const mayEdit = hasPermission(roles, "tests.edit");
  const mayPublish = hasPermission(roles, "tests.publish");
  const mayExport = hasPermission(roles, "tests.export.scorm");
  const mayDebug = hasPermission(roles, "tests.debug.play");

  const items = await Promise.all(
    window.map(async (test) => {
      const sections = await storage.getTestSections(test.id);
      const questionCount = sections.reduce((sum, s) => sum + (s.drawCount ?? 0), 0);
      const publication = await getPublicationState(test.id);

      const flags: AttentionKind[] = [];
      if (publication.state === "draft" && questionCount === 0) flags.push("test-empty-draft");
      // Publication drift is only actionable for a user who may publish; showing
      // it to anyone else would be a dead end (spec section 5).
      if (mayPublish && publication.editedAfterPublish) flags.push("test-edited-after-publish");
      if (mayPublish && publication.poolDrift) flags.push("test-pool-drift");

      const item: MyTestItem = {
        testId: test.id,
        title: test.title,
        status: publication.state as HomeTestStatus,
        sectionCount: sections.length,
        questionCount,
        updatedAt: new Date(test.updatedAt).toISOString(),
        owned: test.ownerId === userId,
        flags,
        canEdit: mayEdit,
        // The debug player follows the same SCOPE as SCORM export (PRD-18 D-2) but
        // has its own capability: the author debugs, the developer also exports.
        canDebug: mayDebug,
        canExport: mayExport,
      };
      return item;
    }),
  );

  // Cards that need attention float to the top of the window; the rest keep the
  // recency order.
  const ordered = [
    ...items.filter((i) => i.flags.length > 0),
    ...items.filter((i) => i.flags.length === 0),
  ];
  return { items: ordered, total: visible.length };
}
