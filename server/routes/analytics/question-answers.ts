/**
 * @module server/routes/analytics/question-answers
 * @description PRD-57 FR-32: ответы одного задания списком и выгрузкой.
 *
 * Свободный текст участника — самое личное, что есть в прохождении, поэтому маршрут закрыт
 * тем же гейтом, что и вся аналитика теста: право плюс область видимости теста. Выгрузка
 * требует отдельного права (`analytics.export`) — как и всякий файл, который уносят из
 * системы.
 *
 * Данные берутся общим сбором ответов (`test-answer-facts`) и слоем наблюдений: свой запрос
 * к таблицам означал бы второе мнение о том, что такое ответ на задание.
 *
 * Список и книга понимают фильтр страницы теста — те же условия, что у психометрики, вместе с
 * «только первой попыткой». Страница вопроса показывает разбор по отобранной выборке, и список
 * ответов под ним не может говорить о других прохождениях.
 */
import { Router, type Request, type Response } from "express";
import ExcelJS from "exceljs";

import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { storage } from "../../storage";
import { addAoaSheet, workbookToBuffer } from "../../utils/excel";
import { loadObservations, type ObservationFilter } from "../../services/analytics/observations";
import { loadTestAnswerFacts } from "../../services/analytics/test-answer-facts";
import {
  buildQuestionAnswerRows,
  type AnswerObservation,
  type QuestionAnswerRow,
} from "../../services/analytics/question-answers";
import { readTestFilterQuery } from "./observation-query";

const router = Router();

/** Как источник прохождения подписывается человеку. */
const SOURCE_TITLE: Record<string, string> = {
  web: "Веб",
  telemetry: "Телеметрия LMS",
  import: "Импорт",
};

/** Исход ответа словами: у неоценённого ответа «неверно» было бы ложью. */
const RESULT_TITLE: Record<string, string> = {
  correct: "Верно",
  partial: "Частично",
  incorrect: "Неверно",
  neutral: "Без оценки",
};

/**
 * Условия страницы, если они переданы в адресе.
 *
 * Без единого параметра отбора ответ — прежний: все прохождения теста, все попытки. Так старые
 * ссылки и прежние читатели получают то же, что получали. С параметрами — разбор тот же, что у
 * психометрики (`readTestFilterQuery`), но «только первая попытка» действует, лишь когда её
 * назвали явно: молчаливое умолчание сузило бы прежний ответ.
 *
 * @param req запрос
 * @param testId тест маршрута
 * @returns отбор и режим попыток; `null` — условий нет
 */
function readSelection(req: Request, testId: string): { filter: ObservationFilter; onlyFirst: boolean } | null {
  const paging = new Set(["offset", "limit"]);
  const named = Object.keys(req.query).some(name => !paging.has(name));
  return named ? readTestFilterQuery(req, testId, false) : null;
}

/**
 * Только первая попытка каждого участника — среди тех, где на тест вообще отвечали.
 *
 * Правило психометрики (FR-51): первая — по дате начала, участник без опознания (ни учётной
 * записи, ни псевдонима, ни идентификатора LMS) в выборку не входит, потому что «первой» у него
 * не бывает. Отсчёт идёт по прохождениям С ОТВЕТАМИ, как в матрице откликов: начатая и брошенная
 * попытка без ответов не должна заслонять следующую.
 *
 * @param observations прохождения выборки
 * @param answered идентификаторы прохождений, в которых есть хотя бы один ответ
 * @returns идентификаторы оставленных прохождений
 */
function firstAnsweredOnly(
  observations: ReadonlyArray<{ id: string; participantId: string | null; startedAt: Date }>,
  answered: ReadonlySet<string>,
): Set<string> {
  const first = new Map<string, { id: string; at: number }>();
  for (const observation of observations) {
    if (!observation.participantId || !answered.has(observation.id)) continue;
    const at = observation.startedAt.getTime();
    const seen = first.get(observation.participantId);
    if (!seen || at < seen.at) first.set(observation.participantId, { id: observation.id, at });
  }
  return new Set([...first.values()].map(item => item.id));
}

/**
 * Собрать список ответов задания; `null` — задания в этом тесте нет.
 *
 * @param testId тест
 * @param questionId задание
 * @param selection условия страницы; `null` — все прохождения теста
 */
async function collect(
  testId: string,
  questionId: string,
  selection: { filter: ObservationFilter; onlyFirst: boolean } | null,
): Promise<{
  question: { id: string; type: string; prompt: string };
  rows: QuestionAnswerRow[];
} | null> {
  // Область видимости уже проверена гейтом маршрута, поэтому здесь она открыта — ровно как
  // на странице теста.
  const observations = await loadObservations(
    selection?.filter ?? { testIds: [testId] },
    { all: true, ids: new Set([testId]) },
  );

  // PRD-70 FR-01: the test by query, not the whole table filtered in memory.
  const attempts = (await storage.getAttemptsByTests([testId]))
    .filter((attempt) => attempt.resultJson !== null);

  const { facts, questionById } = await loadTestAnswerFacts(testId, attempts);
  const question = questionById.get(questionId);
  if (!question) return null;

  // С условиями страницы ответы ограничены отобранными прохождениями — веб, телеметрия и импорт
  // одинаково. Без условий — прежнее поведение: все ответы теста.
  let selected = facts;
  if (selection) {
    let ids = new Set(observations.rows.map((row) => row.id));
    if (selection.onlyFirst) {
      ids = firstAnsweredOnly(observations.rows, new Set(facts.map((fact) => fact.attemptId)));
    }
    selected = facts.filter((fact) => ids.has(fact.attemptId));
  }

  const byAttempt = new Map<string, AnswerObservation>(
    observations.rows.map((row) => [row.id, {
      participant: row.participant,
      finishedAt: row.finishedAt,
      startedAt: row.startedAt,
      source: row.source,
    }]),
  );

  return {
    question: { id: question.id, type: question.type, prompt: question.prompt },
    rows: buildQuestionAnswerRows({ questionId, question, facts: selected, observations: byAttempt }),
  };
}

// GET /api/analytics/tests/:testId/questions/:questionId/answers — ответы задания списком
router.get(
  "/tests/:testId/questions/:questionId/answers",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId, questionId } = req.params;
      const found = await collect(testId, questionId, readSelection(req, testId));
      if (!found) return res.status(404).json({ error: "Задание не входит в этот тест" });
      // Э4а: страница вопроса читает ответы порциями при прокрутке. Без `limit` — все разом,
      // как раньше: так ответ остаётся совместимым с прежними читателями.
      const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0);
      const limitRaw = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : null;
      res.json({
        questionId,
        questionType: found.question.type,
        total: found.rows.length,
        offset,
        rows: limit === null ? found.rows.slice(offset) : found.rows.slice(offset, offset + limit),
      });
    } catch (error) {
      logger.error("GET question answers error: " + (error as Error).message);
      res.status(500).json({ error: "Не удалось собрать ответы задания" });
    }
  },
);

// GET .../answers/export/excel — та же выборка книгой, по тем же условиям страницы
router.get(
  "/tests/:testId/questions/:questionId/answers/export/excel",
  requirePermission("analytics.export"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId, questionId } = req.params;
      const found = await collect(testId, questionId, readSelection(req, testId));
      if (!found) return res.status(404).json({ error: "Задание не входит в этот тест" });

      const data: unknown[][] = [
        ["Участник", "Источник", "Когда", "Ответ", "Длина", "Исход", "Время на задании, с"],
        ...found.rows.map((row) => [
          row.participant,
          SOURCE_TITLE[row.source] ?? row.source,
          row.at ? new Date(row.at).toLocaleString("ru-RU") : "—",
          row.answer,
          row.length,
          RESULT_TITLE[row.outcome] ?? row.outcome,
          row.latencyMs === null ? "—" : Math.round(row.latencyMs / 1000),
        ]),
      ];

      const workbook = new ExcelJS.Workbook();
      addAoaSheet(workbook, "Ответы задания", data, [28, 18, 20, 80, 10, 14, 20]);
      const buffer = await workbookToBuffer(workbook);

      const filename = `answers_${questionId}_${new Date().toISOString().split("T")[0]}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(buffer);
    } catch (error) {
      logger.error("Excel export of question answers error: " + (error as Error).message);
      res.status(500).json({ error: "Не удалось выгрузить ответы задания" });
    }
  },
);

export default router;
