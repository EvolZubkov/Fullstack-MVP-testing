/**
 * @module server/services/home/summary
 *
 * PRD-25 FR-12: four numbers over the last 30 days. No charts, no series and no
 * trends — the home page must not become a second analytics screen (spec risk
 * R-1); the section's link leads there instead. Visibility reuses the EXISTING
 * scope service (`readableTestScope`, FR-16), so the numbers agree with what the
 * «Аналитика» section would show the same user.
 */
import { storage } from "../../storage";
import { readableTestScope } from "../test-access";
import type { Role } from "@shared/access";
import type { AttemptResult } from "@shared/schema";

/** Reporting window, in days (FR-12). */
const WINDOW_DAYS = 30;

/**
 * The four numbers of the «Сводка» section.
 *
 * @param userId - the current user.
 * @param roles - the user's effective role set.
 * @returns finished attempts in the window, the pass rate and the average
 *   percent as whole percents, and the number of distinct users behind them.
 *   An empty selection yields zeros rather than a division by zero.
 */
export async function buildSummary(
  userId: string,
  roles: readonly Role[],
): Promise<{ attempts30d: number; passRate: number; avgPercent: number; activeUsers: number }> {
  const scope = await readableTestScope(roles, userId);
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const all = await storage.getAllAttempts();
  const relevant = all.filter((a) => {
    if (a.finishedAt === null) return false;
    if (new Date(a.finishedAt).getTime() < cutoff) return false;
    return scope.all || (a.testId !== null && scope.ids.has(a.testId));
  });

  if (relevant.length === 0) {
    return { attempts30d: 0, passRate: 0, avgPercent: 0, activeUsers: 0 };
  }

  let passed = 0;
  let percentSum = 0;
  const users = new Set<string>();
  for (const attempt of relevant) {
    const result = attempt.resultJson as AttemptResult | null;
    if (result?.overallPassed) passed += 1;
    percentSum += typeof result?.overallPercent === "number" ? result.overallPercent : 0;
    if (attempt.userId) users.add(attempt.userId);
  }

  return {
    attempts30d: relevant.length,
    passRate: Math.round((passed / relevant.length) * 100),
    avgPercent: Math.round(percentSum / relevant.length),
    activeUsers: users.size,
  };
}
