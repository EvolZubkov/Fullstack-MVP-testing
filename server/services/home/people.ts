/**
 * @module server/services/home/people
 *
 * PRD-25 FR-11: the «Люди и назначения» counters. Deliberately counters and not a
 * list — the manager's working surface is the users and assignments screens; the
 * home page only tells them whether anything is stalled.
 *
 * `test_assignments` has no state column (an assignment either exists or is
 * deleted), so «active» here means «not past its due date»: `dueDate === null` or
 * a due date in the future. «Not started» counts PERSONAL assignments ONLY — a
 * group assignment carries a NULL `userId`, and expanding groups into their
 * members would cost a query per group on every landing, which is not a price a
 * counter is worth. The number is therefore a lower bound on the real backlog,
 * and the section labels it as a nudge, not as a report.
 */
import { storage } from "../../storage";

/** Window for «new users», in days (FR-11). */
const NEW_USER_WINDOW_DAYS = 7;

/**
 * The three counters of the «Люди и назначения» section.
 *
 * @returns active assignments, personal assignments without a single attempt,
 *   and users created within the last {@link NEW_USER_WINDOW_DAYS} days.
 */
export async function buildPeople(): Promise<{
  activeAssignments: number;
  notStarted: number;
  newUsers7d: number;
}> {
  const assignments = await storage.getAllAssignments();
  const now = Date.now();
  const active = assignments.filter(
    (a) => a.dueDate === null || new Date(a.dueDate).getTime() >= now,
  );

  const personal = active.filter((a) => a.userId !== null);
  const started = await Promise.all(
    personal.map(
      async (a) => (await storage.getAttemptsByUserAndTest(a.userId as string, a.testId)).length > 0,
    ),
  );
  const notStarted = started.filter((hasAttempt) => !hasAttempt).length;

  const cutoff = now - NEW_USER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const users = await storage.getUsers();
  const newUsers7d = users.filter((u) => new Date(u.createdAt).getTime() >= cutoff).length;

  return { activeAssignments: active.length, notStarted, newUsers7d };
}
