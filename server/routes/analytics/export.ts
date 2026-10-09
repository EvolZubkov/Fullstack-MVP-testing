/**
 * @module server/routes/analytics/export
 * @description Workbook exports of analytics.
 *
 * `POST /api/export/excel` — ONE book for both levels: the registry selection and one test
 * (`testIds: [testId]` plus the page conditions). The rows are chosen by the registry conditions
 * through the observations layer (PRD-56 FR-04), so the book holds exactly the passages the
 * export window counted — web, LMS telemetry and imported LMS exports.
 *
 * The test-level book (`GET /api/analytics/tests/:testId/export/excel`) used to be a separate
 * handler with its own selection; what it gave a single test — measurement columns per scale and
 * indicator, the achieved levels of an adaptive test, the per-answer scale contribution and
 * level, the item statistics sorted worst first — lives here now, so nothing is lost by the
 * test page exporting through the general book.
 */
import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import ExcelJS from "exceljs";
import { addAoaSheet, workbookToBuffer } from "../../utils/excel";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { loadObservations, type Observation } from "../../services/analytics/observations";
import { summariseObservations } from "../../services/analytics/test-summary";
import { summariseAnswers, type AnswerFact } from "../../services/analytics/answers";
import { loadTestAnswerFacts, type TestAnswerFacts } from "../../services/analytics/test-answer-facts";
import {
  analyticsScope,
  formatQuestionType,
  formatAllOptions,
  formatCorrectAnswerText,
  formatUserAnswerText,
  formatContributions,
  buildIndicatorViews,
  hasMeasures,
  lmsStoredResult,
  loadMeasureCatalogue,
  loadMeasureDefinitions,
  measureCells,
  measureHeaders,
  NOT_APPLICABLE,
  type MeasureCatalogue,
  type MeasureDefinitions,
} from "./helpers";
import { buildObservationFilter, conditionsFromBody } from "./observation-query";
import { isMeasurementOnly } from "@shared/questions/question-type";
import { loadScoringConfig } from "../../services/scoring-config";
import {
  computeAnswerContributions,
  type Answer,
  type MeasurementSpec,
  type QuestionType,
} from "@shared/scales/engine";
import { plainPromptOf } from "@shared/questions/prompt-format";

/** Scale key -> label, for the per-answer contribution cell. */
const scaleLabelsOf = (measures: MeasureCatalogue) =>
  new Map(measures.scales.map((s) => [s.key, s.label]));

const router = Router();

/** Как источник прохождения подписывается в книге. */
const SOURCE_TITLE: Record<string, string> = {
  web: "Веб",
  telemetry: "Телеметрия LMS",
  import: "Импорт",
};

/** Which sheets the registry export window may ask for. */
interface IncludeSheets {
  summary?: boolean;
  attempts?: boolean;
  answers?: boolean;
  questionStats?: boolean;
  levelStats?: boolean;
  recommendations?: boolean;
}

/** What makes an attempt the best one (adaptive tests may judge by levels). */
type BestAttemptCriteria = "percent" | "level_sum" | "level_count";

const ALL_SHEETS: IncludeSheets = {
  summary: true, attempts: true, answers: true, questionStats: true, levelStats: true, recommendations: true,
};

/** The stored result of a web attempt, as far as the workbook reads it. */
interface WebResult {
  mode?: string;
  topicResults?: Array<{
    topicName?: string;
    passed?: boolean;
    achievedLevelIndex?: number | null;
    achievedLevelName?: string | null;
    recommendedLinks?: Array<{ title: string }>;
    recommendedCourses?: Array<{ title: string }>;
  }>;
  scaleResults?: Record<string, { raw?: number; label?: string; level?: string } | undefined>;
  resultVariables?: Record<string, unknown>;
}

/** A web attempt row as the workbook needs it. */
interface WebAttemptRaw {
  id: string;
  testId: string;
  userId: string;
  variantJson?: unknown;
  answersJson?: unknown;
  resultJson?: unknown;
}

/**
 * Keep one passage per participant and test — the best one (`bestAttemptOnly`).
 *
 * Works on observations, so a participant of the LMS is judged exactly like a web one: the
 * participant is `participantId` (account, import pseudonym or LMS id). A passage nobody can be
 * identified by is kept as is — there is nothing to compare it with. A finished passage beats an
 * unfinished one; among finished ones the criterion decides, then the later finish.
 *
 * @param observations selected passages
 * @param webById raw web attempts — the level criteria of adaptive tests read their result
 * @param criteria what «best» means
 * @returns the kept passages in the original order
 */
function bestPerParticipant(
  observations: readonly Observation[],
  webById: ReadonlyMap<string, WebAttemptRaw>,
  criteria: BestAttemptCriteria,
): Observation[] {
  const scoreOf = (o: Observation): [number, number, number, number] => {
    const finished = o.outcome === "incomplete" ? 0 : 1;
    const percent = o.percent ?? -1;
    const time = (o.finishedAt ?? o.startedAt).getTime();
    const result = (webById.get(o.id)?.resultJson ?? null) as WebResult | null;
    if (!o.adaptive || !result) return [finished, percent, 0, time];

    const topics = result.topicResults ?? [];
    const levelSum = topics.reduce(
      (sum, tr) => sum + (typeof tr.achievedLevelIndex === "number" ? tr.achievedLevelIndex : -1),
      0,
    );
    const levelCount = topics.filter(tr => tr.achievedLevelIndex !== null && tr.achievedLevelIndex !== undefined).length;
    if (criteria === "level_sum") return [finished, levelSum, percent, time];
    if (criteria === "level_count") return [finished, levelCount, percent, time];
    return [finished, percent, levelSum, time];
  };

  const best = new Map<string, Observation>();
  const kept: Observation[] = [];
  for (const o of observations) {
    if (!o.participantId) { kept.push(o); continue; }
    const key = `${o.testId ?? ""}\u0000${o.participantId}`;
    const prev = best.get(key);
    if (!prev) { best.set(key, o); continue; }
    const a = scoreOf(o);
    const b = scoreOf(prev);
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      if (a[i] > b[i]) best.set(key, o);
      break;
    }
  }
  const winners = new Set([...best.values(), ...kept].map(o => o.id));
  return observations.filter(o => winners.has(o.id));
}

/**
 * The adaptive level an answer was given on (PRD-16): the level whose answered questions hold it.
 *
 * @param variantJson the attempt's delivered form
 * @param questionId the answered question
 * @returns the level name; empty when the attempt is not adaptive or the question is not found
 */
function adaptiveLevelOf(variantJson: unknown, questionId: string): string {
  const topics = (variantJson as {
    topics?: Array<{ levelsState?: Array<{ levelName?: string; answeredQuestionIds?: string[] }> }>;
  } | null)?.topics ?? [];
  for (const topic of topics) {
    for (const level of topic.levelsState ?? []) {
      if (level.answeredQuestionIds?.includes(questionId)) return level.levelName ?? "";
    }
  }
  return "";
}

/** Outcome of an observation in words — the column «Статус». */
function outcomeTitle(outcome: Observation["outcome"]): string {
  if (outcome === "passed") return "Сдан";
  if (outcome === "failed") return "Не сдан";
  if (outcome === "incomplete") return "Не завершено";
  return NOT_APPLICABLE;
}

/** Result of one answer in words; a partially credited answer is not «Неверно». */
function answerResultTitle(fact: AnswerFact): string {
  if (fact.result === "neutral") return NOT_APPLICABLE;
  if (fact.result === "correct") return "Верно";
  return (fact.earnedPoints ?? 0) > 0 ? "Частично" : "Неверно";
}

/**
 * A level of an LMS passage: `{ topicName, levelName }` per topic. Telemetry gets it from the
 * package's `finish`, an import from the `topic_<id>_level` blocks of the report export.
 */
interface ReportedLevel { topicName?: string | null; levelName?: string | null }
/** A course the package recommends for a failed topic: `{ title, url }`. */
interface ReportedCourse { title?: string | null }

/** A JSON column that may arrive as a string (older rows) or as an array. */
function jsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// POST /api/export/excel - книга по выборке реестра
//
// PRD-56 FR-04: книга выгружает ТО, ЧТО ОТФИЛЬТРОВАНО. Окно выгрузки называет число прохождений
// по `/api/analytics/registry`, поэтому строки книги отбираются ТЕМ ЖЕ разбором условий
// (`observation-query`) и тем же слоем наблюдений с той же областью видимости: веб, телеметрия
// и импортированные выгрузки, все условия реестра. Иначе книга молча расходится с обещанием окна.
router.post("/export/excel", requirePermission("analytics.export"), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const conditions = conditionsFromBody(body);
    // `userIds` — дополнительное сужение прежнего API, реестр его не знает.
    const userIds = Array.isArray(body.userIds)
      ? body.userIds.filter((id): id is string => typeof id === "string" && id !== "")
      : [];
    const bestAttemptOnly = !!body.bestAttemptOnly;
    const bestAttemptCriteria: BestAttemptCriteria =
      body.bestAttemptCriteria === "level_sum" || body.bestAttemptCriteria === "level_count"
        ? body.bestAttemptCriteria
        : "percent";
    const includeSheets = (body.includeSheets && typeof body.includeSheets === "object"
      ? body.includeSheets
      : ALL_SHEETS) as IncludeSheets;

    // PRD-15 FR-08 (audit F-5): export only the tests within the actor's scope.
    const scope = await analyticsScope(req);
    const tests = await storage.getTests();
    const requestedTestIds = conditions.testIds ?? [];
    // Без условия «Тест» реестр показывает прохождения ВСЕХ доступных тестов — и книга берёт их же.
    const selectedTests = tests.filter(t =>
      (requestedTestIds.length === 0 || requestedTestIds.includes(t.id)) && scope.has(t.id));
    if (selectedTests.length === 0) {
      return requestedTestIds.length > 0
        ? res.status(403).json({ error: "Forbidden" })
        : res.status(400).json({ error: "Нет доступных тестов для выгрузки" });
    }
    const testById = new Map(tests.map(t => [t.id, t]));
    const titleOf = (testId: string | null) =>
      (testId ? testById.get(testId)?.title : undefined) ?? "Удалённый тест";

    // Отбор — слово в слово как у реестра: те же условия, та же область видимости, без порции.
    let observed = (await loadObservations(buildObservationFilter(conditions), scope)).rows;
    if (userIds.length > 0) {
      const wanted = new Set(userIds);
      observed = observed.filter(o =>
        (o.userId !== null && wanted.has(o.userId)) || (o.participantId !== null && wanted.has(o.participantId)));
    }

    // Сырые веб-попытки выборки: ответы, уровни, рекомендации и измерения живут в их итоге.
    const webIds = new Set(observed.filter(o => o.source === "web").map(o => o.id));
    const webTestIds = [...new Set(
      observed.filter(o => o.source === "web" && o.testId).map(o => o.testId as string),
    )];
    const webRows = webTestIds.length
      ? (await storage.getAttemptsByTests(webTestIds)).filter(a => webIds.has(a.id))
      : [];
    const webById = new Map<string, WebAttemptRaw>(webRows.map(a => [a.id, a as WebAttemptRaw]));

    if (bestAttemptOnly) {
      observed = bestPerParticipant(observed, webById, bestAttemptCriteria);
    }

    const observedIds = new Set(observed.map(o => o.id));
    const observationById = new Map(observed.map(o => [o.id, o]));
    const completedWeb = observed
      .filter(o => o.source === "web" && o.outcome !== "incomplete")
      .map(o => webById.get(o.id))
      .filter((a): a is WebAttemptRaw => !!a && a.resultJson !== null && a.resultJson !== undefined);
    // Уровни и курсы проваленных тем прохождений LMS — телеметрия получает их от пакета при
    // завершении, импорт — из блоков `topic_*` выгрузки отчёта; обе пишут их в одни колонки.
    // Слой наблюдений их не несёт: дочитываются одним запросом по выборке.
    const completedLms = observed.filter(o => (o.source === "telemetry" || o.source === "import") && o.outcome !== "incomplete");
    const lmsOutcomes = (includeSheets.levelStats || includeSheets.recommendations) && completedLms.length
      ? new Map((await storage.getScormAttemptOutcomes(completedLms.map(o => o.id))).map(row => [row.id, row]))
      : new Map<string, { achievedLevelsJson: unknown; failedTopicCoursesJson: unknown }>();
    // PRD-56 FR-21h: scale and indicator values the LMS runs REPORTED (telemetry, or the
    // `scale_*` / `var_*` blocks of an imported export). Read once over the selection, like the
    // outcomes above, and brought into the web shape so every sheet reads all sources alike.
    const lmsMeasures = includeSheets.attempts && completedLms.length
      ? new Map((await storage.getScormAttemptMeasures(completedLms.map(o => o.id))).map(row => [row.id, row]))
      : new Map<string, { scalesJson: unknown; variablesJson: unknown }>();
    const definitionsByTest = new Map<string, MeasureDefinitions>();
    const definitionsOf = async (testId: string): Promise<MeasureDefinitions> => {
      let definitions = definitionsByTest.get(testId);
      if (!definitions) {
        definitions = await loadMeasureDefinitions(testId);
        definitionsByTest.set(testId, definitions);
      }
      return definitions;
    };
    /** Stored measurements of a run in the web shape, whichever source it came from. */
    const storedOf = async (o: Observation): Promise<WebResult | null> => {
      if (o.source === "web") return (webById.get(o.id)?.resultJson ?? null) as WebResult | null;
      const measures = lmsMeasures.get(o.id);
      if (!measures || !o.testId) return null;
      return lmsStoredResult(await definitionsOf(o.testId), measures);
    };

    // Тесты выборки — в порядке справочника. Удалённый тест (строки LMS без теста) остаётся
    // в листах строк, но в разрезе по тестам ему нечего сказать о вопросах.
    const testIdsInSelection = new Set(observed.map(o => o.testId).filter((id): id is string => !!id));
    const testsInSelection = tests.filter(t => testIdsInSelection.has(t.id));
    // В сводке — названные тесты, даже без прохождений: «по этому тесту ничего» — тоже ответ.
    const summaryTests = requestedTestIds.length > 0 ? selectedTests : testsInSelection;
    /**
     * The book of ONE test (the test page exports through here): only then may the passages
     * sheet grow per-scale and per-indicator columns and the achieved levels — across several
     * tests those columns would differ per row (the long «Измерения» sheet covers that case).
     */
    const singleTest = summaryTests.length === 1 ? summaryTests[0] : null;
    const singleMeasures = singleTest ? await loadMeasureCatalogue(singleTest.id) : null;

    const wb = new ExcelJS.Workbook();

    // Sheet: Summary — по тем же наблюдениям, что лист прохождений.
    if (includeSheets.summary) {
      const total = summariseObservations(observed);
      const bySource = (source: Observation["source"]) => observed.filter(o => o.source === source).length;
      const rows: unknown[][] = [
        ["Отчёт по аналитике"],
        ["Дата экспорта", new Date().toLocaleString("ru-RU")],
        ["Тестов", summaryTests.length],
        ["Прохождений", total.totalAttempts],
        ["Завершённых", total.completedAttempts],
        ["Участников", total.uniqueParticipants],
        ["Источники", `${SOURCE_TITLE.web}: ${bySource("web")}; ${SOURCE_TITLE.telemetry}: ${bySource("telemetry")}; ${SOURCE_TITLE.import}: ${bySource("import")}`],
        ["Только лучшая попытка участника", bestAttemptOnly ? "Да" : "Нет"],
        ["Период", `${conditions.from || "—"} .. ${conditions.to || "—"}`],
        // PRD-29 §6.7: average and pass rate only over the runs those numbers apply to. A
        // questionnaire prints the dash, not «0.0%» beside «100.0%».
        ["Средний результат", total.avgPercent === null ? NOT_APPLICABLE : `${total.avgPercent.toFixed(1)}%`],
        ["Процент прохождения", total.passRate === null ? NOT_APPLICABLE : `${total.passRate.toFixed(1)}%`],
        [],
        ["Тест", "Прохождений", "Завершённых", "Средний %", "Процент сдачи"],
      ];

      for (const t of summaryTests) {
        const stats = summariseObservations(observed.filter(o => o.testId === t.id));
        rows.push([
          t.title,
          stats.totalAttempts,
          stats.completedAttempts,
          // PRD-29 §6.7: среднее и доля сдачи — только там, где они применимы.
          stats.avgPercent === null ? NOT_APPLICABLE : `${stats.avgPercent.toFixed(1)}%`,
          stats.passRate === null ? NOT_APPLICABLE : `${stats.passRate.toFixed(1)}%`,
        ]);
      }

      addAoaSheet(wb, "Сводка", rows);
    }

    // Sheet: Attempts — строка на прохождение любого источника.
    if (includeSheets.attempts) {
      // Оргколонки — сразу за участником (план оргструктуры): книгу по срезу «Отдел продаж»
      // открывают, чтобы увидеть, кто в нём. Значения — по правилу оси (OQ-04): своё у
      // прохождения, иначе профиль. Участник — по правилу PRD-54 раздела 12: связанный
      // пользователь, имя из LMS либо псевдоним (это решает слой наблюдений).
      const rows: unknown[][] = [[
        "Тест", "ID прохождения", "Участник", "Организация", "Подразделение", "Должность",
        "Дата начала", "Дата завершения",
        "Время (сек)", "Результат (%)", "Баллы", "Макс. баллы", "Статус", "Источник",
      ]];
      // One test: its achieved levels (adaptive) and one column per scale and indicator —
      // what a measurement run actually produced. Values are what was STORED at finish, by the
      // web attempt or reported by the LMS (FR-21h); a run without a value gets the
      // «неприменимо» dash, never a recompute.
      const adaptiveColumn = singleTest?.mode === "adaptive";
      if (adaptiveColumn) rows[0].push("Достигнутые уровни");
      if (singleMeasures) rows[0].push(...measureHeaders(singleMeasures));

      for (const o of observed) {
        const stored = await storedOf(o);
        const extra: unknown[] = [];
        if (adaptiveColumn) {
          extra.push((stored?.topicResults ?? [])
            .map(tr => `${tr.topicName}: ${tr.achievedLevelName || "—"}`)
            .join("; "));
        }
        if (singleMeasures) extra.push(...measureCells(singleMeasures, stored));
        rows.push([
          titleOf(o.testId),
          o.id,
          o.participant,
          o.organization ?? "",
          o.unit ?? "",
          o.position ?? "",
          o.startedAt ? new Date(o.startedAt).toLocaleString("ru-RU") : "",
          o.finishedAt ? new Date(o.finishedAt).toLocaleString("ru-RU") : "",
          o.durationMs === null ? "" : Math.round(o.durationMs / 1000),
          o.percent === null ? NOT_APPLICABLE : o.percent.toFixed(1),
          o.earnedPoints === null ? NOT_APPLICABLE : o.earnedPoints,
          o.possiblePoints === null ? NOT_APPLICABLE : o.possiblePoints,
          outcomeTitle(o.outcome),
          SOURCE_TITLE[o.source],
          ...extra,
        ]);
      }

      addAoaSheet(wb, "Прохождения", rows, [24, 36, 22, 22, 22, 22, 18, 18, 12, 12, 10, 12, 12, 14]);
    }

    // Ответы обоих источников — общим сбором (`loadTestAnswerFacts`), тем же, что у страницы
    // вопроса и психометрики, и только по прохождениям выборки.
    const answersByTest = new Map<string, { data: TestAnswerFacts; facts: AnswerFact[] }>();
    if (includeSheets.answers || includeSheets.questionStats) {
      for (const t of testsInSelection) {
        const data = await loadTestAnswerFacts(t.id, completedWeb.filter(a => a.testId === t.id));
        answersByTest.set(t.id, { data, facts: data.facts.filter(f => observedIds.has(f.attemptId)) });
      }
    }

    // Sheet: Answers — строка на ответ, в порядке листа прохождений.
    if (includeSheets.answers) {
      const rows: unknown[][] = [[
        "Тест", "ID прохождения", "Участник", "Источник", "Время начала", "Вопрос", "Тема", "Тип",
        "Сложность", "Варианты ответа", "Правильный ответ", "Ответ участника", "Результат", "Баллы",
        "Время на ответ, с",
      ]];

      // PRD-16: the level an adaptive answer was given on — only when the selection has an
      // adaptive test, so a control test grows no empty column.
      const levelColumn = testsInSelection.some(t => t.mode === "adaptive");
      if (levelColumn) rows[0].push("Уровень");
      // PRD-5: what an answer DID — the only outcome a measurement answer has. Without it a
      // questionnaire's answers stood beside nothing but a dash. Loaded only for tests that
      // define scales: a control test makes no extra queries and grows no extra column.
      const contributionsByTest = new Map<string, { specs: MeasurementSpec[]; labels: Map<string, string> }>();
      for (const t of testsInSelection) {
        const catalogue = await loadMeasureCatalogue(t.id);
        if (catalogue.scales.length === 0) continue;
        const config = await loadScoringConfig(t.id, storage);
        contributionsByTest.set(t.id, { specs: config.measurements, labels: scaleLabelsOf(catalogue) });
      }
      const contributionColumn = contributionsByTest.size > 0;
      if (contributionColumn) rows[0].push("Вклад в шкалы");

      const factsByAttempt = new Map<string, Array<{ fact: AnswerFact; data: TestAnswerFacts }>>();
      for (const { data, facts } of answersByTest.values()) {
        for (const fact of facts) {
          const list = factsByAttempt.get(fact.attemptId) ?? [];
          list.push({ fact, data });
          factsByAttempt.set(fact.attemptId, list);
        }
      }

      for (const o of observed) {
        for (const { fact, data } of factsByAttempt.get(o.id) ?? []) {
          const q = data.questionById.get(fact.questionId);
          const dataJson = q?.dataJson as any;
          const correctJson = q?.correctJson as any;
          const row: unknown[] = [
            titleOf(o.testId),
            o.id,
            o.participant,
            SOURCE_TITLE[o.source],
            o.startedAt ? new Date(o.startedAt).toLocaleString("ru-RU") : "",
            // Задание, удалённое из банка, всё равно было отвечено: строку не теряем.
            q ? plainPromptOf(q) : "(вопрос удалён)",
            q ? data.topicNameById.get(q.topicId) ?? "—" : "—",
            q ? formatQuestionType(q.type) : "—",
            q ? data.difficultyOf(q) ?? "" : "",
            q ? formatAllOptions(q.type, dataJson, correctJson) : "",
            q ? formatCorrectAnswerText(q.type, dataJson, correctJson) : "",
            q ? formatUserAnswerText(q.type, dataJson, fact.answer) : String(fact.answer ?? ""),
            answerResultTitle(fact),
            fact.result === "neutral" ? NOT_APPLICABLE : fact.earnedPoints ?? 0,
            fact.latencyMs === null ? "" : Math.round(fact.latencyMs / 1000),
          ];
          if (levelColumn) {
            row.push(o.source === "web" ? adaptiveLevelOf(webById.get(o.id)?.variantJson, fact.questionId) : "");
          }
          if (contributionColumn) {
            const scales = o.testId ? contributionsByTest.get(o.testId) : undefined;
            row.push(scales && q
              ? formatContributions(
                computeAnswerContributions(scales.specs, fact.questionId, fact.answer as Answer, q.type as QuestionType),
                scales.labels,
              )
              : "");
          }
          rows.push(row);
        }
      }

      addAoaSheet(wb, "Ответы", rows, [24, 36, 22, 14, 18, 50, 20, 15, 10, 50, 30, 30, 10, 8, 14, 15, 30]);
    }

    // Sheet: Измерения — PRD-5 scales and PRD-2 indicators, per finished run of ANY source.
    //
    // LONG format here, and WIDE columns on the passages sheet only for a one-test book: a
    // selection may span several tests, whose scales have nothing in common, so a column per
    // scale would be a sparse matrix where most cells cannot apply. One row per (run, measure)
    // pivots cleanly and stays readable however many tests were selected. The values are the
    // STORED ones: a web attempt's result, or what the LMS reported (PRD-56 FR-21h).
    const completedWebIds = new Set(completedWeb.map(a => a.id));
    const measuredRuns = observed.filter(o =>
      !!o.testId && (o.source === "web" ? completedWebIds.has(o.id) : lmsMeasures.has(o.id)));
    if (includeSheets.attempts && measuredRuns.length > 0) {
      const measuresByTest = new Map<string, MeasureCatalogue>();
      for (const testId of new Set(measuredRuns.map(o => o.testId!))) {
        measuresByTest.set(testId, await loadMeasureCatalogue(testId));
      }

      const rows: unknown[][] = [[
        "Тест", "ID попытки", "Пользователь", "Дата завершения",
        "Вид", "Ключ", "Название", "Значение", "Уровень",
      ]];

      for (const o of measuredRuns) {
        const catalogue = measuresByTest.get(o.testId!);
        if (!catalogue || !hasMeasures(catalogue)) continue;

        const r = (await storedOf(o)) ?? {};
        const head = [
          titleOf(o.testId),
          o.id,
          o.participant ?? "—",
          o.finishedAt ? new Date(o.finishedAt).toLocaleString("ru-RU") : "",
        ];

        for (const sc of catalogue.scales) {
          const v = r.scaleResults?.[sc.key];
          rows.push([
            ...head, "Шкала", sc.key, sc.label,
            typeof v?.raw === "number" ? v.raw : NOT_APPLICABLE,
            v?.label || v?.level || NOT_APPLICABLE,
          ]);
        }
        // The level of an indicator is its band or outcome LABEL, resolved the way the attempt
        // window resolves it (`buildIndicatorViews`).
        const views = new Map(
          buildIndicatorViews((await definitionsOf(o.testId!)).indicators, r.resultVariables)
            .map(view => [view.name, view]),
        );
        for (const i of catalogue.indicators) {
          const view = views.get(i.name);
          const v = view?.value;
          rows.push([
            ...head, "Показатель", i.name, i.label,
            v === undefined || v === null ? NOT_APPLICABLE : String(v),
            view?.interpretation || NOT_APPLICABLE,
          ]);
        }
      }

      if (rows.length > 1) {
        addAoaSheet(wb, "Измерения", rows, [24, 36, 18, 18, 12, 16, 24, 12, 16]);
      }
    }

    // Sheet: Question stats — ответы всех источников выборки, внутри теста худшие сверху.
    if (includeSheets.questionStats) {
      const rows: unknown[][] = [[
        "Тест", "Вопрос", "Тема", "Тип", "Сложность", "Варианты ответа", "Правильный ответ",
        "Всего ответов", "Правильных", "% правильных",
      ]];
      for (const t of testsInSelection) {
        const entry = answersByTest.get(t.id);
        if (!entry) continue;
        const testRows: Array<{ share: number; cells: unknown[] }> = [];
        for (const stat of summariseAnswers(entry.facts)) {
          const q = entry.data.questionById.get(stat.questionId);
          // Измерительный вопрос не проверяется: «0 правильных» было бы вердиктом там, где
          // его нет. Число ОТВЕТОВ остаётся — оно настоящее.
          const graded = stat.graded > 0 && !(q && isMeasurementOnly(q)) && stat.correctPercent !== null;
          const dataJson = q?.dataJson as any;
          const correctJson = q?.correctJson as any;
          testRows.push({
            // Unchecked questions have no place on a «worst first» axis: they sort last rather
            // than tying with a genuinely failed question at 0%.
            share: graded ? stat.correctPercent! : Number.POSITIVE_INFINITY,
            cells: [
              t.title,
              q ? plainPromptOf(q) : "(вопрос удалён)",
              q ? entry.data.topicNameById.get(q.topicId) ?? "—" : "—",
              q ? formatQuestionType(q.type) : "—",
              q ? entry.data.difficultyOf(q) ?? "" : "",
              q ? formatAllOptions(q.type, dataJson, correctJson) : "",
              q ? formatCorrectAnswerText(q.type, dataJson, correctJson) : "",
              stat.answered,
              graded ? stat.correct : NOT_APPLICABLE,
              graded ? `${stat.correctPercent!.toFixed(1)}%` : NOT_APPLICABLE,
            ],
          });
        }
        testRows.sort((x, y) => (x.share === y.share ? 0 : x.share < y.share ? -1 : 1));
        rows.push(...testRows.map(r => r.cells));
      }

      addAoaSheet(wb, "Статистика вопросов", rows, [24, 50, 20, 15, 10, 50, 30, 12, 12, 12]);
    }

    // Sheet: Level stats — кто какой уровень достиг: веб — из итога попытки, LMS — из телеметрии.
    if (includeSheets.levelStats) {
      const rows: unknown[][] = [["Участник", "Тест", "Тема", "Достигнутый уровень", "Дата"]];

      for (const a of completedWeb) {
        const result = a.resultJson as WebResult;
        if (result?.mode !== "adaptive") continue;
        const o = observationById.get(a.id);
        const date = o?.finishedAt ? new Date(o.finishedAt).toLocaleDateString("ru-RU") : "—";

        for (const tr of result.topicResults ?? []) {
          rows.push([
            o?.participant ?? "—",
            titleOf(a.testId),
            tr.topicName || "—",
            tr.achievedLevelName || "Не достигнут",
            date,
          ]);
        }
      }

      for (const o of completedLms) {
        const levels = jsonArray<ReportedLevel>(lmsOutcomes.get(o.id)?.achievedLevelsJson);
        if (levels.length === 0) continue;
        const date = o.finishedAt ? new Date(o.finishedAt).toLocaleDateString("ru-RU") : "—";
        for (const level of levels) {
          rows.push([o.participant ?? "—", o.testId ? titleOf(o.testId) : "—", level.topicName || "—", level.levelName || "Не достигнут", date]);
        }
      }

      if (rows.length > 1) {
        addAoaSheet(wb, "Статистика уровней", rows, [30, 30, 25, 20, 15]);
      }
    }

    // Sheet: Recommendations — веб из итога попытки (адаптивной и стандартной), LMS из телеметрии.
    if (includeSheets.recommendations) {
      const userCourses = new Map<string, Set<string>>();
      const add = (participant: string, title: string) => {
        if (!userCourses.has(participant)) userCourses.set(participant, new Set());
        userCourses.get(participant)!.add(title);
      };

      for (const a of completedWeb) {
        const result = a.resultJson as WebResult;
        const participant = observationById.get(a.id)?.participant ?? "—";
        for (const tr of result?.topicResults ?? []) {
          if (result.mode === "adaptive") {
            // Адаптивный — рекомендованные ссылки каждой темы.
            for (const link of tr.recommendedLinks ?? []) add(participant, link.title);
          } else if (tr.passed === false) {
            // Стандартный — курсы проваленных тем.
            for (const course of tr.recommendedCourses ?? []) add(participant, course.title);
          }
        }
      }

      // LMS (телеметрия и импорт): курсы только проваленных тем и без повторов уже собраны.
      for (const o of completedLms) {
        for (const course of jsonArray<ReportedCourse>(lmsOutcomes.get(o.id)?.failedTopicCoursesJson)) {
          if (course?.title) add(o.participant ?? "—", course.title);
        }
      }

      const rows: unknown[][] = [["Участник", "Рекомендуемый курс"]];
      for (const [participant, courses] of userCourses.entries()) {
        for (const course of courses) rows.push([participant, course]);
      }
      if (rows.length > 1) {
        addAoaSheet(wb, "Рекомендации", rows, [30, 50]);
      }
    }

    const buffer = await workbookToBuffer(wb);

    const filename = `report_${new Date().toISOString().split("T")[0]}.xlsx`;
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);

  } catch (e) {
    logger.error("POST /api/export/excel error: " + (e as Error).message);
    res.status(500).json({ error: "Failed to export Excel" });
  }
});

export default router;