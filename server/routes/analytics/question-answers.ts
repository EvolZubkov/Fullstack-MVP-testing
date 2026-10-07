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
import { pickAttemptIds, type AttemptPick } from "@shared/analytics/attempt-pick";
import { buildSimulationStats } from "../../services/analytics/simulation-stats";
import { isSimulation } from "@shared/questions/question-type";
import type { Scenario } from "@shared/sim/contract";

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
 * психометрики (`readTestFilterQuery`), но правило выбора попытки действует, лишь когда его
 * назвали явно: молчаливое умолчание сузило бы прежний ответ.
 *
 * @param req запрос
 * @param testId тест маршрута
 * @returns отбор и режим попыток; `null` — условий нет
 */
function readSelection(req: Request, testId: string): { filter: ObservationFilter; attempts: AttemptPick } | null {
  const paging = new Set(["offset", "limit"]);
  const named = Object.keys(req.query).some(name => !paging.has(name));
  return named ? readTestFilterQuery(req, testId, "all") : null;
}

/**
 * Попытки, выбранные правилом, — среди тех, где на тест вообще отвечали.
 *
 * Правило психометрики (FR-51): «первая» и «последняя» — по дате начала, «лучшая» — по проценту
 * результата; участник без опознания (ни учётной записи, ни псевдонима, ни идентификатора LMS) в
 * выборку не входит, потому что одной его попытки не выбрать. Отсчёт идёт по прохождениям С
 * ОТВЕТАМИ, как в матрице откликов: начатая и брошенная попытка без ответов не должна заслонять
 * следующую.
 *
 * @param observations прохождения выборки
 * @param answered идентификаторы прохождений, в которых есть хотя бы один ответ
 * @param attempts правило выбора попытки
 * @returns идентификаторы оставленных прохождений; `null` — правило «все», отбора нет
 */
function pickAnswered(
  observations: ReadonlyArray<{ id: string; participantId: string | null; startedAt: Date; percent: number | null }>,
  answered: ReadonlySet<string>,
  attempts: AttemptPick,
): Set<string> | null {
  return pickAttemptIds(
    observations
      .filter(observation => answered.has(observation.id))
      .map(observation => ({
        id: observation.id,
        participantId: observation.participantId,
        at: observation.startedAt.getTime(),
        percent: observation.percent,
      })),
    attempts,
  );
}

/**
 * Собрать список ответов задания; `null` — задания в этом тесте нет.
 *
 * @param testId тест
 * @param questionId задание
 * @param selection условия страницы; `null` — все прохождения теста
 */
async function selectFacts(
  testId: string,
  questionId: string,
  selection: { filter: ObservationFilter; attempts: AttemptPick } | null,
) {
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
    const ids = pickAnswered(observations.rows, new Set(facts.map((fact) => fact.attemptId)), selection.attempts)
      ?? new Set(observations.rows.map((row) => row.id));
    selected = facts.filter((fact) => ids.has(fact.attemptId));
  }

  return { question, selected: selected.filter((fact) => fact.questionId === questionId), observations };
}

/**
 * Ответы задания строками — для списка и выгрузки.
 */
async function collect(
  testId: string,
  questionId: string,
  selection: { filter: ObservationFilter; attempts: AttemptPick } | null,
): Promise<{
  question: { id: string; type: string; prompt: string };
  rows: QuestionAnswerRow[];
} | null> {
  const found = await selectFacts(testId, questionId, selection);
  if (!found) return null;
  const { question, selected, observations } = found;
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
// «Сценарий в ИС» (Э5б): аналитика вопроса-сценария — исходы, разбор по сценам, типичные ошибки,
// карта промахов. Те же условия страницы и та же выборка фактов, что у ответов задания.
router.get(
  "/tests/:testId/questions/:questionId/simulation",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId, questionId } = req.params;
      const found = await selectFacts(testId, questionId, readSelection(req, testId));
      if (!found) return res.status(404).json({ error: "Задание не входит в этот тест" });
      const scenario = (found.question.dataJson as { scenario?: Scenario } | null)?.scenario;
      if (!isSimulation(found.question.type) || !scenario) {
        return res.status(422).json({ error: "Задание не сценарий" });
      }
      res.json(buildSimulationStats(scenario, found.selected));
    } catch (error) {
      logger.error("GET question simulation error: " + (error as Error).message);
      res.status(500).json({ error: "Не удалось собрать аналитику сценария" });
    }
  },
);

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
