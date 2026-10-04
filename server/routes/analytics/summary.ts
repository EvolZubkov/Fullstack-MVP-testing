/**
 * @module server/routes/analytics/summary
 * @description Сводка по прохождениям в рамке одного отбора.
 *
 * Здесь же раньше жили `GET /combined` и `GET /combined-full` — источник «Обзора» с его средним
 * баллом и pass rate ПО ВСЕМ тестам, трендами и проблемными темами вне контекста теста. PRD-56
 * FR-12 снял их: такие величины складывают разные пороги, разные шкалы и разные популяции, и
 * получившееся число нельзя ни объяснить, ни применить. Их место заняли срезы (`slices.ts`) и
 * очередь дел (`attention.ts`) — те всегда называют выборку, которую описывают.
 *
 * Уцелевшая сводка считается по общему слою наблюдений, как и страница теста: расхождение чисел
 * между экранами — дефект, а не особенность (FR-25).
 *
 * `GET /tests` (Э3.0) — сводка ПО КАЖДОМУ тесту: строка вкладки «Тесты» общего уровня, вход в
 * аналитику теста. Это не сумма по тестам: каждая строка — своя выборка со своим порогом.
 */
import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { loadObservations } from "../../services/analytics/observations";
import { summariseObservations } from "../../services/analytics/test-summary";
import { analyticsScope } from "./helpers";
import { storage } from "../../storage";
import { suspiciousEntry } from "./suspicious-refresh";

const router = Router();

// GET /api/analytics/summary - Только сводка (быстрый запрос)
router.get("/summary", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const source = (req.query.source as string) || "all";
    const testIdFilter = req.query.testId as string | undefined;
    // PRD-15 FR-08 (audit F-5): aggregates only over readable tests.
    const scope = await analyticsScope(req);

    // PRD-56 FR-33: сводка считается по общему слою наблюдений — тому же, по которому
    // считает страница теста. Иначе два экрана снова начинают отвечать на один вопрос
    // разными числами (FR-25).
    const { rows } = await loadObservations(
      {
        ...(testIdFilter ? { testIds: [testIdFilter] } : {}),
        ...(source === "web" ? { sources: ["web"] as const } : {}),
        ...(source === "lms" ? { sources: ["telemetry", "import"] as const } : {}),
      },
      scope,
    );

    // Брошенные прохождения в сводку не входят: она отвечает на «как прошли», а не «сколько
    // начинали». Это же правило действовало и до перехода на общий слой.
    const completed = rows.filter(o => o.outcome !== "incomplete");
    const stats = summariseObservations(completed);
    const web = completed.filter(o => o.source === "web");
    const lms = completed.filter(o => o.source !== "web");

    /** Участники источника: человек, псевдоним импорта или идентификатор из LMS (PRD-54). */
    const participantsOf = (list: typeof completed) =>
      new Set(list.map(o => o.participantId).filter(Boolean)).size;

    res.json({
      totalAttempts: stats.completedAttempts,
      passedAttempts: completed.filter(o => o.passed === true).length,
      passRate: stats.passRate ?? 0,
      avgPercent: stats.avgPercent ?? 0,
      webAttempts: web.length,
      lmsAttempts: lms.length,
      uniqueWebUsers: participantsOf(web),
      uniqueLmsUsers: participantsOf(lms),
      adaptiveAttempts: stats.adaptiveAttempts,
      adaptivePassed: stats.adaptivePassed,
    });
  } catch (error) {
    logger.error("Summary analytics error: " + (error as Error).message, "analytics");
    res.status(500).json({ error: "Failed to get summary" });
  }
});

/** Строка вкладки «Тесты» общего уровня (Э3.0). */
export interface TestSummaryRow {
  testId: string;
  title: string;
  /** Завершённые прохождения — брошенные в сводку не входят, как и в `/summary`. */
  completedAttempts: number;
  /** Доля сдавших; `null`, когда вердикт не выносился (измерительный тест). */
  passRate: number | null;
  /** Средний результат; `null`, когда оценивать было нечего. */
  avgPercent: number | null;
  /** Последнее завершённое прохождение — по дате окончания, без неё — начала. */
  lastAttemptAt: string | null;
  /**
   * Э3.4: вопросов под подозрением — из фонового пересчёта; `null` — ещё не посчитано.
   * Время расчёта рядом: число может отставать от последних прохождений.
   */
  suspicious: { count: number; computedAt: string } | null;
}

// GET /api/analytics/tests - Э3.0: тесты с прохождениями и их сводка — единая точка входа в
// аналитику теста. Считается по тому же слою наблюдений, что страница теста (FR-25): число
// в строке и плитка на уровне теста обязаны совпадать.
router.get("/tests", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const scope = await analyticsScope(req);
    const { rows } = await loadObservations({}, scope);

    const byTest = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!row.testId || row.outcome === "incomplete") continue;
      const list = byTest.get(row.testId) ?? [];
      list.push(row);
      byTest.set(row.testId, list);
    }

    const ids = [...byTest.keys()];
    const tests = await Promise.all(ids.map(id => storage.getTest(id)));
    const titles = new Map(ids.map((id, i) => [id, tests[i]?.title ?? "Удалённый тест"]));

    const result: TestSummaryRow[] = ids.map(testId => {
      const list = byTest.get(testId)!;
      const stats = summariseObservations(list);
      const last = list.reduce<Date | null>((latest, o) => {
        const at = o.finishedAt ?? o.startedAt;
        return latest === null || at > latest ? at : latest;
      }, null);
      return {
        testId,
        title: titles.get(testId)!,
        completedAttempts: stats.completedAttempts,
        passRate: stats.passRate,
        avgPercent: stats.avgPercent,
        lastAttemptAt: last ? last.toISOString() : null,
        suspicious: (() => {
          const entry = suspiciousEntry(testId);
          return entry ? { count: entry.count, computedAt: entry.computedAt } : null;
        })(),
      };
    });
    // Свежие — сверху: вкладка отвечает «где сейчас идёт работа».
    result.sort((a, b) => (b.lastAttemptAt ?? "").localeCompare(a.lastAttemptAt ?? ""));

    res.json({ tests: result });
  } catch (error) {
    logger.error("Tests summary error: " + (error as Error).message, "analytics");
    res.status(500).json({ error: "Failed to get tests summary" });
  }
});

export default router;
