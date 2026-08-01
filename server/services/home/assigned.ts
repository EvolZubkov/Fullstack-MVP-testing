/**
 * @module server/services/home/assigned
 *
 * PRD-25: the two learner-facing home sections — «Мне назначено» (FR-07) and
 * «Мои результаты» (FR-08). The cooldown decision reuses the SAME pure helpers as
 * `/api/learner/tests` (`decideRetake` / `lastCompletedAttemptDate`), so the home
 * page and the start screen can never disagree about whether a retake is open.
 */
import { storage } from "../../storage";
import { decideRetake, countAttemptsInAssignment } from "../retake-gate";
import type { RetakePolicy, AttemptResult } from "@shared/schema";
import type { AssignedTestItem, RecentResultItem } from "@shared/home/contract";

/** How many assigned tests the section shows before «показать все» (FR-07). */
const ASSIGNED_LIMIT = 4;
/** How many finished attempts the results section shows (FR-08). */
const RESULTS_LIMIT = 3;
/** Stand-in title when the attempt outlives its test (deleted bank entry). */
const DELETED_TEST_TITLE = "Тест удалён";

/**
 * A test that can no longer be taken: the attempt cap is spent and nothing is
 * running. The section drops it entirely — the only action it could offer is the
 * one the server refuses (`ATTEMPTS_EXHAUSTED`, `POST /api/attempts`), and a row
 * whose button leads nowhere is worse than no row. The finished run is not lost:
 * it stays in «Мои результаты» and in the attempt history.
 *
 * A CLOSED COOLDOWN is deliberately not spent: that test is takeable again, just
 * later, and its row carries the date instead of a button (PRD-6).
 */
function isSpent(item: AssignedTestItem): boolean {
  return (
    item.inProgressAttemptId === null &&
    item.maxAttempts !== null &&
    item.completedAttempts >= item.maxAttempts
  );
}

/**
 * Assigned tests for the learner, in-progress first, capped at {@link ASSIGNED_LIMIT}.
 * `total` reports the true assignment count so the UI can label the «показать все» link.
 */
export async function buildAssigned(
  userId: string,
): Promise<{ items: AssignedTestItem[]; total: number }> {
  const assigned = await storage.getAssignedTestsForUser(userId);

  const built = await Promise.all(
    assigned.map(async (test) => {
      const sections = await storage.getTestSections(test.id);
      const questionCount = sections.reduce((sum, s) => sum + (s.drawCount ?? 0), 0);
      const attempts = await storage.getAttemptsByUserAndTest(userId, test.id);
      const inProgress = attempts.find((a) => a.finishedAt === null) ?? null;
      // PRD-31: the assignment is the unit of access, so both the counter and the
      // barriers are scoped to it — the card must agree with the start screen and
      // with the start route, which now count the same way.
      const currentAssignmentId = await storage.getCurrentAssignmentId(userId, test.id);
      const attemptFacts = attempts.map((a) => ({
        assignmentId: a.assignmentId,
        finishedAt: a.finishedAt,
      }));

      const gate = decideRetake(test.retakePolicyJson as RetakePolicy | null, {
        currentAssignmentId,
        attempts: attemptFacts,
        now: new Date(),
      });

      const item: AssignedTestItem = {
        testId: test.id,
        title: test.title,
        description: test.description ?? null,
        questionCount,
        completedAttempts: countAttemptsInAssignment(attemptFacts, currentAssignmentId),
        maxAttempts: test.maxAttempts ?? null,
        inProgressAttemptId: inProgress?.id ?? null,
        // Barrier A opens on a DATE, barrier B at an INSTANT; the card shows a date
        // either way, so the instant is trimmed to its calendar day.
        blockedUntil: gate.allowed
          ? null
          : (gate.availableDate ?? (gate.availableAt ? gate.availableAt.slice(0, 10) : null)),
      };
      return item;
    }),
  );

  // Only what the learner can still take (FR-07); `total` counts the same list, so
  // «Показаны N из M» never promises rows the full list will not show either.
  const playable = built.filter((i) => !isSpent(i));

  // In-progress first (FR-07); the rest keep the assignment order.
  const ordered = [
    ...playable.filter((i) => i.inProgressAttemptId !== null),
    ...playable.filter((i) => i.inProgressAttemptId === null),
  ];
  return { items: ordered.slice(0, ASSIGNED_LIMIT), total: ordered.length };
}

/** The learner's most recent finished attempts, newest first (FR-08). */
export async function buildRecentResults(userId: string): Promise<{ items: RecentResultItem[] }> {
  const attempts = await storage.getAttemptsByUser(userId);
  const finished = attempts
    .filter((a) => a.finishedAt !== null)
    .sort(
      (a, b) => new Date(b.finishedAt as Date).getTime() - new Date(a.finishedAt as Date).getTime(),
    )
    .slice(0, RESULTS_LIMIT);

  const items = await Promise.all(
    finished.map(async (attempt) => {
      // The test may have been deleted since the attempt was taken — the section
      // still shows the row rather than failing the whole home page (FR-15).
      const test = attempt.testId ? await storage.getTest(attempt.testId) : undefined;
      const result = attempt.resultJson as AttemptResult | null;
      const item: RecentResultItem = {
        attemptId: attempt.id,
        testTitle: test?.title ?? DELETED_TEST_TITLE,
        finishedAt: new Date(attempt.finishedAt as Date).toISOString(),
        percent: typeof result?.overallPercent === "number" ? result.overallPercent : 0,
        passed: result?.overallPassed ?? null,
      };
      return item;
    }),
  );
  return { items };
}
