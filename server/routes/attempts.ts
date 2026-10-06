import { Router } from "express";
import path from "node:path";
import { logger } from "../logger";
import { config } from "../config";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { checkAnswer } from "../utils/check-answer";
import { withEffectiveMaxLength } from "@shared/questions/short-answer";
import { resolvePsychoHash } from "@shared/questions/psycho-hash";
import {
  aggregateStandardResult,
  aggregateAdaptiveResult,
  adaptiveResultAsStandard,
  type AggregateSection,
} from "@shared/scoring/aggregate";
import type { CorrectData, Answer } from "@shared/scoring/engine";
import { resolveOverallRule, resolveTopicRule, type ResolvedRule } from "@shared/scoring/pass-rule";
import { drawSection } from "@shared/draw/blueprint";
import { computeWeights, weightedPick } from "@shared/draw/exposure";
import { selectForm } from "@shared/draw/forms";
import { orderQuestions } from "@shared/draw/order-questions";
import {
  assembleDelivery,
  effectiveSectionOrder,
  type DeliverySection,
} from "@shared/draw/assemble-delivery";
import { ipsativeScalesForDelivery } from "../services/scale-composition";
import { loadScoringConfig } from "../services/scoring-config";
import { attachRegexVerdicts } from "../services/answer-check-verdicts";
import { promptHtmlOf } from "../services/prompt-html";
import { loadTestScoringContext } from "../services/effective-scoring";
import { computeAttemptResult } from "../services/result-compute";
import { decideRetake, countAttemptsInAssignment } from "../services/retake-gate";
import {
  readResultsRenderPayload,
  readReportRenderPayload,
  completeMeasuresSource,
  readResultsDeclarations,
} from "../services/template-render";
import { reportKindForMode, type ReportLabelLayers } from "@shared/report/report-variants";
import {
  buildReportInput,
  buildAdaptiveReportInput,
  buildMeasuresInput,
  resolveScreenLabels,
  type MeasuresSource,
  type TopicInterpretations,
} from "../services/result-context";
import type { MeasuresInput } from "@shared/template/result-context";
import type { ResultsBlockSettings } from "@shared/template/results-blocks";
import type { ResultHeadings } from "@shared/template/result-context";
import type { ChartKindSettings } from "@shared/template/scales-chart";
import type { ReportInput, AdaptiveReportInput } from "@shared/report/report-html";
import {
  pingSection,
  buildLeavePolicy,
  freezeLockedAnswers,
  type LeavePolicy,
} from "../services/section-timer";
import { buildResultsNav, RESULTS_NAV_ACTIONS } from "@shared/template/results-nav";
import { resolveSystemScreenDir, resolveTemplateDir } from "../services/template-dir";
import {
  liveDataSource,
  snapshotDataSource,
  dataSourceForAttempt,
  type TestDataSource,
  type TestSnapshotContent,
} from "../services/test-snapshot";
import type { QuestionType } from "@shared/scales/engine";
import { resolveAnswerCommitScope } from "@shared/flow/answer-commit-scope";
import { resolveFlowPolicy } from "@shared/flow/flow-policy";
import { buildAfterZone, type FlowContentPage } from "@shared/flow/page-sequence";
import { isMeasurementOnly } from "@shared/questions/question-type";
// PRD-50 FR-17: элементы разреза адаптивного прогона собирает хост — движок их вывести не может.
import type { BreakdownItem } from "@shared/breakdown/types";
// PRD-32: ONE address rule for a feedback attachment, and ONE source-priority rule for
// the topic's feedback text — the same helpers the SCORM bake runs.
import { feedbackAssets, normalizeFeedback, topicFeedbackTexts } from "@shared/template/result-context";
import type { FeedbackBlock } from "@shared/scales/interpretation";
// issue #34: общий/условный режим обратной связи вопроса — одно правило на оба хоста.
import { feedbackTextFor } from "@shared/template/feedback-banner";
import { isReportEnabled } from "@shared/schema";
import type {
  Test,
  Question,
  TestVariant,
  AttemptResult,
  TopicResult,
  PassRule,
  RetakePolicy,
  ReportSettings,
  DesignSettings,
  TestIntro,
  FeedbackContent,
  QuestionScoring,
} from "@shared/schema";
// Brings the `SessionData.magic` augmentation (PRD magic-link scope) into scope.
import "../middleware/magic-scope";

const router = Router();

/**
 * PRD-19 (Block B): the runtime navigation settings the web learner host reads
 * from the attempt start / resume responses (the web analogue of TEST_DATA in
 * the SCORM package). `answerCommitScope` is resolved here from mode + flow mode
 * through the SAME shared resolver the SCORM exporter uses, so both hosts agree.
 */
function prd19RuntimeSettings(test: Test) {
  return {
    allowReturnToUnanswered: test.allowReturnToUnanswered ?? true,
    allowAnswerChange: test.allowAnswerChange ?? false,
    // PRD-19 (FR-11a/FR-11b): free navigation inside the section. Resolved here rather than
    // read raw, because an adaptive test IGNORES it — there the ladder of levels decides the
    // order, and the author's value must not leak into a run it does not govern. Absence in
    // an OLD publication snapshot reads as «off», i.e. today's frontier.
    allowFreeSectionNavigation:
      test.mode === "adaptive" ? false : (test.allowFreeSectionNavigation ?? false),
    // PRD-43: independent of allowReturnToUnanswered.
    quickAdvance: test.quickAdvance ?? false,
    showSectionResults: test.showSectionResults ?? true,
    // Отсутствие в СТАРОМ снимке публикации = прежнее поведение, обзор показывается.
    skipReviewWhenComplete: test.skipReviewWhenComplete ?? false,
    // PRD-67: absence in an OLD publication snapshot = the pre-PRD-67 freeze-on-leave.
    closeSectionOnLeave: test.closeSectionOnLeave ?? false,
    // PRD-34 (FR-01, FR-05): настройки защиты. Отсутствие поля в СТАРОМ снимке
    // публикации читается как умолчание — тест, опубликованный до PRD-34, получает защиту.
    copyProtection: test.copyProtection ?? true,
    protectionWatermark: test.protectionWatermark ?? false,
    protectionHideOnBlur: test.protectionHideOnBlur ?? false,
    // The flow mode goes in RESOLVED, exactly as the bake feeds it
    // (`builders/test-json.ts`): a mode this build does not know reads as
    // `linear_flat` in the package, and the web host must not scope answers by a
    // mode the package never saw.
    answerCommitScope: resolveAnswerCommitScope({
      mode: test.mode,
      flowMode: resolveFlowPolicy(test.flowPolicyJson).mode,
    }),
  };
}

/**
 * PRD-66 FR-09b: карта «задание -> отпечаток редакции» по фактически выданному составу.
 *
 * Отпечаток берётся со строки задания, а если его там нет — считается по содержанию:
 * снимок публикации, замороженный до появления колонки, и строка, не прошедшая засыпку,
 * несут полное содержание, и терять на них серию наблюдений незачем.
 */
function stampsOfDelivery(questions: Question[]): Record<string, string> {
  const stamps: Record<string, string> = {};
  for (const question of questions) stamps[question.id] = resolvePsychoHash(question);
  return stamps;
}

/**
 * PRD-66 FR-37a: карта «задание -> миллисекунды», очищенная от того, что измерением быть не может.
 *
 * Значение приходит от клиента — как и у пакета, другого источника времени на задании нет.
 * Подделка чисел в ту или другую сторону этим не лечится и лечиться здесь не должна; отсекается
 * мусор — строки, отрицательные величины, `NaN`, — который отравил бы медиану времени молча.
 *
 * `null` означает «клиент времени не прислал»: молчание старого клиента не должно стирать уже
 * измеренное.
 */
function sanitizeLatency(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const clean: Record<string, number> = {};
  for (const [questionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) clean[questionId] = value;
  }
  return clean;
}

/**
 * PRD-66 FR-09b: штампы выдачи, сверенные с редакцией на момент завершения.
 *
 * Расхождение значит, что задание правили ПОСРЕДИ прохождения. Такое наблюдение не
 * принадлежит чисто ни одной редакции: приписать его новой — испортить её статистику
 * ответами, которых по ней не давали; оставить за старой — сделать вид, что правки не
 * было. Штамп становится `null`, и наблюдение уходит в серию «версия неизвестна»
 * (FR-09c). Обе серии его теряют, и это честнее, чем приписать его одной из них.
 *
 * Попытка, начатая до появления штампа, его не выдумывает: что видел участник, никто не
 * знает, и нынешняя редакция была бы догадкой, выданной за факт.
 */
function reconcileStamps(
  delivered: Record<string, string | null> | undefined,
  atFinish: Record<string, string>,
): Record<string, string | null> | undefined {
  if (!delivered) return undefined;
  const reconciled: Record<string, string | null> = {};
  for (const [questionId, stamp] of Object.entries(delivered)) {
    const now = atFinish[questionId];
    // Задание, которого к завершению уже нет (удалено из банка), сверить не с чем —
    // штамп выдачи остаётся: он и есть то, что участник видел.
    reconciled[questionId] = now === undefined || now === stamp ? stamp : null;
  }
  return reconciled;
}

/**
 * PRD-67: the attempt's leave policy — does leaving a section close it, and what unit a
 * leave closes (the topic, or the whole test when it has no sections). Read from the SAME
 * version the attempt plays: a snapshot published before the setting carries none and
 * reads as «off», the pre-PRD-67 freeze.
 */
async function leavePolicyForAttempt(snapshotId: string | null, testId: string): Promise<LeavePolicy> {
  const src = await dataSourceForAttempt(snapshotId);
  const test = await src.getTest(testId);
  if (!test) return buildLeavePolicy({ closeSectionOnLeave: false, testLimitMinutes: null, sectionLimits: new Map(), flat: false });
  const sections = await src.getTestSections(testId);
  return buildLeavePolicy({
    closeSectionOnLeave: test.closeSectionOnLeave ?? false,
    testLimitMinutes: test.timeLimitMinutes,
    sectionLimits: new Map(sections.map((s) => [s.topicId, s.timeLimitMinutes])),
    flat: resolveFlowPolicy(test.flowPolicyJson).mode === "linear_flat",
  });
}

/**
 * The questions of a standard run as the web learner host receives them.
 *
 * The answer key ships ONLY for a test that shows correctness («показывать
 * правильность ответа»); otherwise `correctJson` is stripped and the run carries
 * no key at all.
 *
 * PRD-10 (FR-12): the EFFECTIVE graded config rides on exactly the same gate. The
 * instant per-answer verdict is computed in the browser (no round trip, like the
 * package's), so without this field every question resolved to the system default
 * `exact` and a weighted/tiered question could never report partial credit live —
 * even though the results screen scored it correctly through
 * `shared/scoring/aggregate`. The field is named `scoring` and the system default
 * is omitted, mirroring the SCORM bake (`builders/test-json.ts`), so both hosts
 * read one shape.
 *
 * Resolved through `src` (live storage or a publication snapshot, PRD-15 block B),
 * so a pinned attempt is graded live by the config it was published with.
 */
async function questionsForClient(
  src: TestDataSource,
  test: Test,
  questions: Question[],
): Promise<Array<Question & { scoring?: QuestionScoring }>> {
  // PRD-57 FR-28v: действующий предел длины подставляется ЗДЕСЬ, а не на клиенте:
  // настройку инстанса знает только сервер, а рендер поля общий с пакетом.
  const withLimit = (q: Question): Question =>
    ({
      ...q,
      dataJson: withEffectiveMaxLength(q.type, q.dataJson, config.limits.shortAnswerMaxLength),
      // PRD-57 FR-03a: подсветка листинга печётся ЗДЕСЬ. Библиотека серверная, и ни в
      // клиентский бандл, ни в пакет она не попадает — хост получает готовую разметку.
      ...promptHtmlOf(q),
    }) as Question;

  if (!test.showCorrectAnswers) {
    return questions.map((q) => ({ ...withLimit(q), correctJson: undefined })) as Question[];
  }
  const scoring = await loadTestScoringContext(test.id, src);
  return questions.map((q) => {
    const effective = scoring.resolve(q);
    const base = withLimit(q);
    return effective.source.scoring === "system" ? base : { ...base, scoring: effective.scoring };
  });
}

/**
 * PRD-12 FR-6: the author's structure — content pages in all four placements
 * («До теста» / «После теста» / перед темой / после темы) plus the flow mode —
 * delivered to the web learner host so it can build the SAME run as the SCORM
 * package (`shared/flow/page-sequence`). Without this the web host only ever saw
 * the drawn questions, and every content page the author placed was silently
 * skipped at run time while «Структура» kept promising it.
 *
 * Read through `src`, not `storage`, so a snapshot-pinned attempt (PRD-15 block B)
 * gets the PUBLISHED structure rather than today's live edits.
 */
async function flowPayload(src: TestDataSource, test: Test) {
  const contentPages = await src.getContentPages(test.id);
  // PRD-4 v1.1 §4.7: the router's gating travels with the structure, resolved by the
  // SAME shared normaliser the package bake runs. Before this the payload carried the
  // raw `mode` and nothing else, so the web hub was built with no unlock rules and no
  // completion policy: a section locked behind a prerequisite in the LMS was open on
  // the web, and «Завершить» under `all_required_passed` unlocked as soon as the
  // required sections were merely finished. The fields are absent outside router mode.
  const flowPolicy = resolveFlowPolicy(test.flowPolicyJson);
  return {
    flowMode: flowPolicy.mode,
    ...(flowPolicy.mode === "router_by_topics"
      ? {
          routerPolicy: {
            completionPolicy: flowPolicy.routerCompletionPolicy ?? null,
            sectionUnlockRules: flowPolicy.sectionUnlockRules ?? {},
          },
        }
      : {}),
    contentPages: contentPages.map((p) => ({
      id: p.id,
      kind: p.kind,
      type: p.type,
      topicId: p.topicId,
      position: p.position,
      sortOrder: p.sortOrder,
      mode: p.mode,
      templateKey: p.templateKey,
      valuesJson: p.valuesJson,
      // PRD-22: page PROPERTIES (sequence identifier, «Далее» caption, background).
      // The SCORM package has shipped them since FR-20; without them here the web
      // run computed no sequence at all, so a gallery lost its indicator.
      settingsJson: p.settingsJson,
      autoAdvance: p.autoAdvance,
      autoAdvanceDelayMs: p.autoAdvanceDelayMs,
      // «Экран есть, но ученику не выдаётся»: общее правило порядка (`contentPagesFor`)
      // отбрасывает такие страницы, но только если признак до него доехал.
      hidden: p.hidden === true,
    })),
  };
}

/**
 * The pass condition of each delivered section, for the «Введение раздела» screen of the
 * web run: the topic rule resolved against the overall one and the DELIVERED variant, the
 * Σ prices of the delivered graded questions, and the obligation. The same resolution the
 * grader runs at finish (`aggregateStandardResult`), so the intro promises exactly the
 * threshold the verdict will apply. Computed here because the learner host receives no
 * prices unless the test shows correctness.
 *
 * Read through `src`, so a snapshot-pinned attempt states the PUBLISHED thresholds.
 */
async function sectionConditionsPayload(
  src: TestDataSource,
  testId: string,
  variant: { sections?: Array<{ topicId: string; questionIds?: string[]; formId?: string }> } | null,
  questions: Question[],
): Promise<Record<string, { passRule: ResolvedRule | null; possiblePoints: number; required: boolean }>> {
  // A line on an intro screen must never cost the learner the attempt start: on any
  // failure the intro simply renders without a condition, as it did before.
  try {
    return await resolveSectionConditions(src, testId, variant, questions);
  } catch (error) {
    logger.warn("Условия прохождения разделов не рассчитаны — " + (error as Error).message);
    return {};
  }
}

/** The body of {@link sectionConditionsPayload}, without the failure guard. */
async function resolveSectionConditions(
  src: TestDataSource,
  testId: string,
  variant: { sections?: Array<{ topicId: string; questionIds?: string[]; formId?: string }> } | null,
  questions: Question[],
): Promise<Record<string, { passRule: ResolvedRule | null; possiblePoints: number; required: boolean }>> {
  const test = await src.getTest(testId);
  if (!test || !Array.isArray(variant?.sections)) return {};
  const sections = await src.getTestSections(testId);
  const scoring = await loadTestScoringContext(testId, src);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const overall = resolveOverallRule(test.overallPassRuleJson);
  const out: Record<string, { passRule: ResolvedRule | null; possiblePoints: number; required: boolean }> = {};
  for (const vs of variant!.sections!) {
    const section = sections.find((s) => s.topicId === vs.topicId);
    let possiblePoints = 0;
    for (const id of vs.questionIds ?? []) {
      const q = byId.get(id);
      // A measurement-only question brings no points to the grader, so none here either.
      if (q && !isMeasurementOnly(q)) possiblePoints += scoring.resolve(q).points;
    }
    out[vs.topicId] = {
      passRule: resolveTopicRule(section?.topicPassRuleJson ?? null, overall, { formId: vs.formId ?? null }),
      possiblePoints,
      required: section?.required ?? true,
    };
  }
  return out;
}

/**
 * Страницы «После теста», стоящие ЗА «Итогами теста», — в той версии теста, которую
 * выдали этой попытке.
 *
 * Отбирает их ТО ЖЕ общее правило, что строит прохождение (`buildAfterZone`), поэтому
 * экран итогов предлагает «Далее» ровно тогда, когда пакет, и к тем же страницам. Раньше
 * веб их не показывал вовсе: экран итогов живёт на своём маршруте, а прохождение с этими
 * страницами к тому моменту уже закончено.
 *
 * @param attempt Попытка: тест и приколотый снимок.
 * @returns Страницы в порядке показа; пусто, если их нет или структура не прочиталась.
 */
async function postResultsPagesForAttempt(attempt: { testId: string; snapshotId: string | null }) {
  try {
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const test = await src.getTest(attempt.testId);
    if (!test) return [];
    const flow = await flowPayload(src, test);
    const pages = buildAfterZone(flow.contentPages as FlowContentPage[]).postResultsPages;
    return pages as typeof flow.contentPages;
  } catch {
    return [];
  }
}

/**
 * Resolves the data source for STARTING an attempt (PRD-15 block B). A published
 * test with a snapshot is delivered frozen — the attempt is pinned to that
 * snapshot and every read (sections, questions, scales, ...) comes from it.
 * Drafts, preview and published tests without a snapshot (transitional) fall
 * back to live storage with no pin.
 */
async function sourceForStart(
  testId: string,
): Promise<{ src: TestDataSource; snapshotId: string | null; test: Test } | null> {
  const liveTest = await storage.getTest(testId);
  if (!liveTest) return null;
  if (liveTest.status === "published") {
    const snap = await storage.getLatestSnapshot(testId);
    if (snap) {
      const src = snapshotDataSource(snap.contentJson as TestSnapshotContent);
      const test = (await src.getTest(testId)) ?? liveTest;
      return { src, snapshotId: snap.id, test };
    }
  }
  return { src: liveDataSource(), snapshotId: null, test: liveTest };
}

/**
 * The material the results screen is built from beyond the saved result itself — the
 * test's scale and indicator ROWS (PRD-29), the settings of its «Итоги» variant,
 * whether the test has a pass threshold at all, and the test's OWN feedback block
 * (PRD-32).
 *
 * Rows are read through the SAME source the attempt was graded against (the one
 * `loadScoringConfig` takes): an attempt pinned to a snapshot (PRD-15 block B) reads
 * the FROZEN scales and indicators, so an interpretation edited today cannot rewrite
 * the verdict of an attempt taken yesterday. The measured VALUES are deliberately NOT
 * gathered here — they are already in the saved `AttemptResult` and must never be
 * recomputed.
 *
 * Gathered for EVERY standard attempt, including a test with neither scales nor
 * indicators. It used to bail out early in that case, and the test's feedback block —
 * read further down, in the same function — was lost with it: the commonest
 * configuration in the product showed no recommendations at all. Whether the screen
 * gets measurement blocks is decided in ONE place, `buildResultContext`
 * (`server/services/result-context.ts`), off the emptiness of these two arrays; this
 * function only reads. `undefined` therefore means «could not be read», nothing else.
 */
/**
 * PRD-50 FR-50: карта «раздел -> (подтема -> её текст)» по разделам ВЫДАННОЙ версии.
 *
 * Ключ карты — `topicId`, а не идентификатор раздела: сохранённый результат попытки
 * знает тему, и по ней же общий построитель находит свои записи разреза. Раздел без
 * текстов в карту не попадает — отсутствие ключа и означает «текстов нет».
 */
async function readBreakdownFeedback(
  src: { getTestSections(testId: string): Promise<Array<{ topicId: string; breakdownFeedbackJson?: unknown }>> },
  testId: string,
): Promise<Record<string, Record<string, FeedbackBlock>>> {
  try {
    return breakdownFeedbackByTopic(await src.getTestSections(testId));
  } catch (error) {
    logger.warn("PRD-50 FR-50: тексты подтем не прочитаны — " + (error as Error).message);
    return {};
  }
}

function breakdownFeedbackByTopic(
  sections: Array<{ topicId: string; breakdownFeedbackJson?: unknown }>,
): Record<string, Record<string, FeedbackBlock>> {
  const out: Record<string, Record<string, FeedbackBlock>> = {};
  for (const section of sections) {
    const declared = section.breakdownFeedbackJson as
      | { keys?: Record<string, Partial<FeedbackContent>> }
      | null
      | undefined;
    const keys = declared?.keys;
    if (!keys) continue;
    const byKey: Record<string, FeedbackBlock> = {};
    for (const [key, content] of Object.entries(keys)) {
      // Через тот же нормализатор, что и обратная связь темы и теста: адреса вложений
      // и формат текста разрешаются в ОДНОМ месте, иначе подтема печаталась бы иначе,
      // чем соседний источник того же блока.
      const block = normalizeFeedback(content);
      if (block) byKey[key] = block;
    }
    if (Object.keys(byKey).length > 0) out[section.topicId] = byKey;
  }
  return out;
}

/**
 * Толкования по разделам ВЫДАННОЙ версии — `topicId` -> текст темы, текст этого теста и
 * тексты подтем.
 *
 * Тема читается своим запросом на раздел, а не общим `getTopics()`: живое хранилище отдало
 * бы им ВСЕ темы инстанса ради двух-трёх нужных, а снимок и так держит их списком.
 *
 * Раздел без единого написанного текста в карту не попадает: отсутствие ключа и означает
 * «толкований нет», и тест, не пользовавшийся ими, идёт прежним путём до поля.
 */
async function readInterpretations(
  src: TestDataSource,
  testId: string,
): Promise<Record<string, TopicInterpretations>> {
  try {
    const sections = await src.getTestSections(testId);
    const topics = await Promise.all(sections.map((section) => src.getTopic(section.topicId)));
    const out: Record<string, TopicInterpretations> = {};
    sections.forEach((section, i) => {
      const topic = topics[i];
      const texts: TopicInterpretations = {
        ...(topic?.interpretationJson ? { topic: topic.interpretationJson } : {}),
        ...(section.interpretationJson ? { section: section.interpretationJson } : {}),
        ...(section.breakdownInterpretationJson?.keys
          ? { breakdown: section.breakdownInterpretationJson.keys }
          : {}),
      };
      if (Object.keys(texts).length > 0) out[section.topicId] = texts;
    });
    return out;
  } catch (error) {
    // Своим `try`, как и у текстов подтем: не прочитались толкования — нет только их,
    // а балл, темы и обратная связь обязаны дойти до экрана.
    logger.warn("Толкования не прочитаны — " + (error as Error).message);
    return {};
  }
}

/**
 * Заголовки итога из свойств узла «Итоги теста».
 *
 * Ключи те же, что объявляет манифест шаблона (`settings[]` варианта `results.*`). Пустые
 * и незаполненные не кладутся вовсе: отсутствие поля и есть «печатать умолчание», и
 * тест, ничего не заполнивший, отдаёт `null` — материал экрана остаётся прежним до ключа.
 */
function readResultHeadings(settings: Record<string, unknown>): ResultHeadings | null {
  const pick = (key: string) => {
    const value = settings[key];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  };
  const headings: ResultHeadings = {
    ...(pick("headingDocument") ? { document: pick("headingDocument") } : {}),
    ...(pick("headingPassed") ? { passed: pick("headingPassed") } : {}),
    ...(pick("headingFailed") ? { failed: pick("headingFailed") } : {}),
  };
  return Object.keys(headings).length > 0 ? headings : null;
}

async function resultsMaterialForAttempt(
  attempt: { testId: string; snapshotId: string | null },
  liveTest: Test | undefined,
): Promise<MeasuresSource | undefined> {
  try {
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const [scales, variables] = await Promise.all([
      src.getScales(attempt.testId),
      src.getResultVariables(attempt.testId),
    ]);
    const deliveredTest = (await src.getTest(attempt.testId)) ?? liveTest;
    const pages = await src.getContentPages(attempt.testId);
    // No `results` page, or a page with no settings: all three blocks stay on
    // «Автоматически» and the state of the test decides.
    const resultsSettings = (pages.find((p) => p.kind === "results")?.settingsJson ?? {}) as Record<string, unknown>;
    const blockSettings = resultsSettings as ResultsBlockSettings;
    const passRule = deliveredTest?.overallPassRuleJson as PassRule | null | undefined;
    // PRD-47 §5.3: у отчёта свой переключатель вида, и «авто» в нём требует того же
    // признака. `tests.report_settings_json` ветвится по РЕЖИМУ теста, а не по виду
    // манифеста, поэтому берётся ветка своего режима. Отсутствие ветки означает вариант
    // по умолчанию, а на «авто» умолчания манифеста не ставятся.
    const reportBranch =
      deliveredTest?.mode === "adaptive"
        ? deliveredTest?.reportSettingsJson?.adaptive
        : deliveredTest?.reportSettingsJson?.standard;
    const reportChartSettings = (reportBranch?.values ?? {}) as ChartKindSettings;
    // PRD-49: надписи и порядок подблоков — свойство ТЕСТА (`design_settings_json`), а не
    // страницы итогов: одна формулировка обслуживает экран итогов, адаптивные итоги, итоги
    // раздела и отчёт. Берутся из ВЫДАННОЙ версии, как и всё остальное здесь: снапшот
    // замораживает ряд теста вместе с настройками дизайна (спека §8), поэтому завершённая
    // попытка печатает те заголовки, с которыми её проходили.
    const design = (deliveredTest?.designSettingsJson as DesignSettings | null) ?? null;
    // Объявления — из манифеста АКТИВНОГО шаблона: против них автор и правил формулировки,
    // и против них же их разрешает сборка пакета SCORM (`build-export-data`), поэтому оба
    // хоста печатают одно и то же. Шаблон, не объявивший надписей, отдаёт пустой список —
    // и его макеты печатают свои жёсткие строки, как до этого PRD (спека §9).
    const declarations = readResultsDeclarations(
      await resolveTemplateDir(design?.templateId, { activeOnly: true }),
    );
    return {
      scales,
      variables,
      blockSettings,
      design,
      labelDeclarations: declarations.labels,
      templateBlockOrder: declarations.blockOrder,
      // PRD-46 §5: read from the SAME delivered source as the scales, so a finished attempt
      // is judged on the content it was taken on. Costs nothing unless the author left the
      // choice of the diagram to the system — on the screen or in the report.
      ipsativeScales: await ipsativeScalesForDelivery(
        src,
        attempt.testId,
        scales,
        blockSettings,
        reportChartSettings,
      ),
      hasPassThreshold: !!passRule && passRule.type !== "none",
      // PRD-50 FR-50: САМО правило, а не только признак — тексты подтем выдаются
      // сравнением их результата с ЭТИМ порогом.
      overallPassRule: passRule ?? null,
      // PRD-50 FR-50: тексты подтем разделов ВЫДАННОЙ версии. Раздел без текстов ключа
      // ничего в карту не кладёт, поэтому тест, не пользовавшийся настройкой, идёт по
      // прежнему пути до байта.
      //
      // Своим `try` — не общим: не прочитались тексты ПОДТЕМ, значит нет только их, а
      // шкалы, показатели и обратная связь теста обязаны дойти. Общий `catch` ниже
      // обнулил бы весь материал экрана из-за необязательной его части.
      breakdownFeedbackByTopic: await readBreakdownFeedback(src, attempt.testId),
      // Толкования темы и её подтем — из той же ВЫДАННОЙ версии. Правило «текст теста
      // заменяет текст темы» здесь не применяется: его применит общий построитель, тот же,
      // что и у пакета SCORM.
      interpretationsByTopic: await readInterpretations(src, attempt.testId),
      testFeedback: (deliveredTest?.feedbackJson as Partial<FeedbackContent> | null) ?? null,
      // Вводные блоки: экрана и отчёта. Берутся из ВЫДАННОЙ версии теста, как и всё
      // остальное здесь, — попытка показывает то содержание, на котором её проходили.
      intro: (deliveredTest?.introJson as TestIntro | null) ?? null,
      // PRD-50 FR-13: subtotal-by-key display setting, read from the SAME delivered
      // version as everything else here. Absent (test predates PRD-50, or the column
      // was never set) leaves it `null`, which `buildResultContext` resolves to
      // «hidden» — the byte-identical results screen this test has always shown.
      breakdownDisplayJson: deliveredTest?.breakdownDisplayJson ?? null,
      // PRD-50 FR-11: блоки разделов теста, из той же ВЫДАННОЙ версии, что и всё
      // остальное здесь. Отсутствие (тест блоков не заводил) оставляет `null`, и экран
      // печатает плоский список тем — ровно тот, что печатал до этого PRD (FR-27).
      sectionGroupsJson: deliveredTest?.sectionGroupsJson ?? null,
      // Заголовки итога — свойства того же узла «Итоги теста», из которого читаются
      // переключатели блоков выше. Пустые строки отбрасывает общий построитель, здесь
      // только доставка написанного.
      resultHeadings: readResultHeadings(resultsSettings),
    };
  } catch (error) {
    // The results screen must not fail because this material could not be read: the
    // score, the per-topic rows and the report do not depend on it. The learner then
    // sees the screen a test without measurements and without feedback would produce.
    logger.warn("PRD-29: results material unavailable — " + (error as Error).message);
    return undefined;
  }
}

/** Fisher-Yates in-place shuffle for the server-side variant draw (PRD-11). */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// GET /api/learner/tests - Тесты для ученика
router.get("/learner/tests", requirePermission("attempts.self.read"), async (req, res) => {
  try {
    const allAssigned = await storage.getAssignedTestsForUser(req.session.userId!);
    // A magic-link session sees ONE test: the list is the start screen's data
    // source, and it must not enumerate the learner's other assignments.
    const magic = req.session.magic;
    const assignedTests = magic ? allAssigned.filter((t) => t.id === magic.testId) : allAssigned;

    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));

    const testsWithSections = await Promise.all(
      assignedTests.map(async (test) => {
        const sections = await storage.getTestSections(test.id);
        const sectionsWithNames = sections.map((s) => ({
          ...s,
          topicName: topicMap.get(s.topicId) || "Unknown",
        }));

        const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
        const completed = userAttempts.filter((a) => a.finishedAt !== null);
        const inProgressAttempt = userAttempts.find((a) => a.finishedAt === null);
        // PRD-31 (FR-07): the attempt counter belongs to the ASSIGNMENT, so a
        // re-assignment hands out a fresh set — the start screen must count the same
        // way the start route does, or it would offer a run the server then refuses.
        const currentAssignmentId = await storage.getCurrentAssignmentId(req.session.userId!, test.id);
        const attemptFacts = userAttempts.map((a) => ({
          assignmentId: a.assignmentId,
          finishedAt: a.finishedAt,
          // PRD-40: outcome of THIS attempt, for barrier A's outcome-split cooldown.
          passed: (a.resultJson as AttemptResult | null)?.overallPassed ?? null,
        }));
        const completedAttempts = countAttemptsInAssignment(attemptFacts, currentAssignmentId);

        // Resume position from the in-progress variant (PRD-12 §10 start parity):
        // index = saved currentIndex, total = drawn question count.
        let resumeIndex: number | null = null;
        let resumeTotal: number | null = null;
        if (inProgressAttempt) {
          const v = inProgressAttempt.variantJson as { currentIndex?: number; sections?: Array<{ questionIds?: string[] }> } | null;
          resumeIndex = v?.currentIndex || 0;
          resumeTotal = Array.isArray(v?.sections)
            ? v!.sections.reduce((n, s) => n + (s.questionIds?.length || 0), 0)
            : 0;
        }
        // Most recent completed attempt — target of the start screen's "Мой результат".
        const lastCompleted = completed
          .slice()
          .sort((a, b) => new Date(b.finishedAt as Date).getTime() - new Date(a.finishedAt as Date).getTime())[0];

        // PRD-19 Block F (FR-19/20) + PRD-31: resolve the access decision up front so
        // the START screen can render the blocked state (moment + disabled button +
        // prior summary) ON the standard start page — parity with the SCORM gate's
        // `renderCooldownStart`, no separate block-wall. Facts are scoped to the
        // current assignment; inert unless a barrier is configured, so legacy tests
        // carry `retakeGate: null`.
        const retakePolicy = test.retakePolicyJson as RetakePolicy | null;
        const gate = decideRetake(retakePolicy, {
          currentAssignmentId,
          attempts: attemptFacts,
          now: new Date(),
        });
        const retakeGate =
          gate.allowed
            ? null
            : {
                blockedBy: gate.blockedBy ?? null,
                cooldownPeriodDays: gate.cooldownPeriodDays ?? null,
                intervalHours: gate.intervalHours ?? null,
                availableDate: gate.availableDate ?? null,
                availableAt: gate.availableAt ?? null,
                daysUntil: gate.daysUntil ?? null,
              };

        // PRD-19 Block F (FR-19/20): prior-attempt summary for the start screen.
        // The web uses the MOST RECENT completed attempt — the same one
        // `lastCompletedAttemptId` ("Мой результат") points at, so the shown
        // percent and the linked result agree. Present whenever a completed
        // attempt exists (eligible «повтор: можно» AND cooldown).
        const lastResult = lastCompleted?.resultJson as AttemptResult | null | undefined;
        const priorResult =
          lastResult && typeof lastResult.overallPercent === "number"
            ? {
                percent: lastResult.overallPercent,
                passed: lastResult.overallPassed ?? null,
                // PRD-31: «попытка K из M» counts inside the assignment, so it may only
                // label a result that belongs to the CURRENT one. A result carried over
                // from a previous assignment keeps its percent but loses the number —
                // otherwise a fresh assignment would caption it «попытка 0 из 3».
                attemptNumber:
                  lastCompleted?.assignmentId === currentAssignmentId ? completedAttempts : null,
                maxAttempts: test.maxAttempts ?? null,
              }
            : null;

        // Скрытый стартовый экран (решение владельца 2026-09-20): ученику не показывают
        // страницу с кнопкой «Начать» — попытка начинается сразу. Знать об этом надо ДО
        // старта, а страницы теста приезжают только вместе с попыткой, поэтому признак
        // резолвится здесь, на том же экране, где живут остальные факты о запуске.
        const startPage = (await storage.getContentPages(test.id)).find((p) => p.kind === "start");

        return {
          ...test,
          sections: sectionsWithNames,
          completedAttempts,
          inProgressAttemptId: inProgressAttempt?.id || null,
          resumeIndex,
          resumeTotal,
          lastCompletedAttemptId: lastCompleted?.id || null,
          retakeGate,
          priorResult,
          startHidden: startPage?.hidden === true,
        };
      })
    );

    // Does each test GRADE at all? The start screen drops «проходной балл» when it
    // does not (a measurement method — see `shared/template/start-state`). Resolved
    // for the whole list in ONE query over the topics it draws from, since the answer
    // is a property of the content, not of the learner's attempts.
    const gradedTopics = new Set<string>();
    const listedTopicIds = Array.from(
      new Set(testsWithSections.flatMap((t) => t.sections.map((s) => s.topicId))),
    );
    for (const q of await storage.getGradingTraitsByTopics(listedTopicIds)) {
      if (!isMeasurementOnly(q)) gradedTopics.add(q.topicId);
    }

    res.json(
      testsWithSections.map((t) => ({
        ...t,
        hasGradedContent: t.sections.some((s) => gradedTopics.has(s.topicId)),
      })),
    );
  } catch (error) {
    logger.error("Get learner tests error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch tests" });
  }
});

/**
 * The delivered set of an abandoned run, stripped of its progress. `sections`
 * (composition, PRD-17 variant pins, PRD-4 per-topic budgets) and `deliveryOrder`
 * (the PRD-30 stream) are exactly what was handed out; `currentIndex`,
 * `questionStatus` and `sectionPositions` are progress the runtime wrote on top,
 * and a restart drops them. Returns null when the stored variant holds no
 * questions — there is then nothing to carry and the caller draws anew.
 */
function carryOverVariant(v: TestVariant | null): TestVariant | null {
  const sections = v?.sections;
  if (!Array.isArray(sections) || sections.length === 0) return null;
  if (!sections.some((s) => (s.questionIds?.length ?? 0) > 0)) return null;
  return {
    sections: sections.map((s) => ({
      topicId: s.topicId,
      topicName: s.topicName,
      questionIds: [...s.questionIds],
      ...(s.formId ? { formId: s.formId } : {}),
      timeLimitMinutes: s.timeLimitMinutes ?? null,
    })),
    ...(v?.deliveryOrder ? { deliveryOrder: [...v.deliveryOrder] } : {}),
  };
}

// POST /api/tests/:testId/attempts/start - Начать обычный тест
router.post("/tests/:testId/attempts/start", requirePermission("attempts.take"), async (req, res) => {
  try {
    // PRD-15 block B: a published test is delivered from its snapshot; the
    // attempt is pinned to it so later bank edits do not change this attempt.
    const resolved = await sourceForStart(req.params.testId);
    if (!resolved) {
      return res.status(404).json({ error: "Test not found" });
    }
    const { src, snapshotId, test } = resolved;

    // Attempt gates (PRD-6 barrier A + PRD-31 barrier B) and the attempt counter,
    // all scoped to the CURRENT ASSIGNMENT — the unit of access (PRD-31 §3). The
    // assignment is resolved unconditionally because a started attempt is pinned to
    // it even when no barrier is configured.
    const retakePolicy = test.retakePolicyJson as RetakePolicy | null;
    const currentAssignmentId = await storage.getCurrentAssignmentId(req.session.userId!, test.id);
    // Loaded ONCE: the barriers, the PRD-17 rotation history and the abandoned-run
    // lookup below all read the learner's attempts of this test.
    const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
    const barriersOn =
      retakePolicy?.enabled === true || retakePolicy?.attemptInterval?.enabled === true;
    if (barriersOn || test.maxAttempts !== null) {
      const attemptFacts = userAttempts.map((a) => ({
        assignmentId: a.assignmentId,
        finishedAt: a.finishedAt,
        // PRD-40: outcome of THIS attempt, for barrier A's outcome-split cooldown.
        passed: (a.resultJson as AttemptResult | null)?.overallPassed ?? null,
      }));

      const gate = decideRetake(retakePolicy, {
        currentAssignmentId,
        attempts: attemptFacts,
        now: new Date(),
      });
      if (!gate.allowed) {
        const interval = gate.blockedBy === "attemptInterval";
        return res.status(403).json({
          error: interval ? "Attempt interval active" : "Retake cooldown active",
          code: interval ? "ATTEMPT_INTERVAL" : "RETAKE_COOLDOWN",
          ...gate,
        });
      }

      // FR-07: the limit belongs to the assignment, so a re-assignment hands out a
      // fresh set of attempts — the same rule the SCORM package has always had.
      if (
        test.maxAttempts !== null &&
        countAttemptsInAssignment(attemptFacts, currentAssignmentId) >= test.maxAttempts
      ) {
        return res.status(403).json({ error: "Attempts exhausted", code: "ATTEMPTS_EXHAUSTED" });
      }
    }

    const sections = await src.getTestSections(test.id);
    const topics = await src.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));

    // PRD-17 (FR-07): variants rotation needs the variant ids the learner already
    // saw per topic, in prior COMPLETED attempts.
    const completedAttempts = userAttempts.filter((a) => a.finishedAt !== null);
    const previousFormIdsForTopic = (topicId: string): string[] => {
      const out: string[] = [];
      for (const a of completedAttempts) {
        const v = a.variantJson as TestVariant | null;
        for (const s of v?.sections ?? []) {
          if (s.topicId === topicId && s.formId) out.push(s.formId);
        }
      }
      return out;
    };

    // The learner's own abandoned run, newest first. A restart must NOT hand out a
    // fresh draw: both barriers and the attempt counter read FINISHED attempts only,
    // so starting and abandoning costs nothing — and a new draw each time turns that
    // into a way to leaf through the whole question pool. The delivered set is carried
    // over instead, and only the progress is dropped.
    const openAttempt = userAttempts
      .filter((a) => a.finishedAt === null)
      .sort((a, b) => new Date(b.startedAt as Date).getTime() - new Date(a.startedAt as Date).getTime())[0];
    // Only from the SAME content: a republished test has a new snapshot and a new
    // pool, where carried ids could deliver questions the test no longer contains.
    const carried =
      openAttempt && (openAttempt.snapshotId ?? null) === (snapshotId ?? null)
        ? carryOverVariant(openAttempt.variantJson as TestVariant | null)
        : null;

    let variant: TestVariant;
    let allQuestionIds: string[];

    if (carried) {
      variant = carried;
      allQuestionIds = carried.sections.flatMap((s) => s.questionIds);
    } else {
    variant = { sections: [] };
    allQuestionIds = [];
    // PRD-30 раздел 14: selection happens per topic (below), the delivery ORDER
    // of the whole test is decided once, by `assembleDelivery`, after the loop.
    const drawnSections: DeliverySection<Question>[] = [];

    // PRD-55 (FR-26): банки разделов читаются ДО отбора, чтобы счётчики экспозиции ушли ОДНИМ
    // запросом на попытку, а не по запросу на раздел. Индексы массива соответствуют `sections`:
    // два раздела могут стоять на одной теме, и ключ по `topicId` их бы схлопнул.
    const sectionBanks: Question[][] = [];
    for (const section of sections) {
      sectionBanks.push(await src.getQuestionsByTopic(section.topicId));
    }

    /**
     * PRD-56 FR-17a: задания, исключённые из выдачи ЭТОГО теста.
     *
     * Фильтр применяется только к ЖИВОЙ выдаче. Прохождение по снимку состав не меняет
     * (PRD-15): опубликованная версия — это обещание, данное тем, кто уже её проходит, и
     * исключение задания сегодня не имеет права переписать вчерашнюю публикацию.
     */
    if (snapshotId === null) {
      const excluded = new Set(
        (await storage.getTestQuestionScoring(test.id))
          .filter(row => row.excludedFromDelivery)
          .map(row => row.questionId),
      );
      if (excluded.size > 0) {
        for (const [index, bank] of sectionBanks.entries()) {
          sectionBanks[index] = bank.filter(question => !excluded.has(question.id));
        }
      }
    }

    // Веса считаются ВНУТРИ каждого пула отдельно (FR-12), поэтому здесь достаточно собрать
    // счётчики по всем заданиям теста. Сбой чтения не имеет права ронять старт попытки: без
    // счётчиков веса выходят равными, то есть выдача просто остаётся сегодняшней (FR-17).
    let exposureCounts = new Map<string, number>();
    try {
      const windowStart = new Date();
      windowStart.setMonth(windowStart.getMonth() - config.delivery.exposureWindowMonths);
      exposureCounts = await storage.getDeliveryCounts(
        sectionBanks.flat().map((q) => q.id),
        windowStart,
      );
    } catch (error) {
      logger.warn("PRD-55: счётчики выдач не прочитаны — " + (error as Error).message);
    }

    /** Отбор, взвешенный по экспозиции; нормировка — по переданному пулу (FR-12/FR-18). */
    const exposurePick = <T extends { id: string }>(pool: T[], k: number): T[] =>
      weightedPick(pool, k, computeWeights(pool.map((q) => q.id), exposureCounts), Math.random);

    for (const [sectionIndex, section] of sections.entries()) {
      const questions = sectionBanks[sectionIndex];
      const byId = new Map(questions.map((q) => [q.id, q]));
      let qIds: string[];
      let formId: string | undefined;

      if (section.formSetJson) {
        // PRD-17 (BR-12): variants mode — pick one author-curated variant, deliver
        // it WHOLE in random order, rotating away from variants seen in prior
        // completed attempts. draw_count/draw_all/quotas are not applied here.
        const picked = selectForm(section.formSetJson.forms, {
          // PRD-30 FR-07: in `fixed` the variant's own list is the order.
          order: effectiveSectionOrder(test.questionOrder, section.questionOrder),
          previousFormIds: previousFormIdsForTopic(section.topicId),
          availableIds: new Set(questions.map((q) => q.id)),
          shuffle: shuffleInPlace,
        });
        qIds = picked.questionIds;
        formId = picked.formId;
        // The variant's list IS the order — `assembleDelivery` must not re-sort it.
        drawnSections.push({
          questions: qIds.map((id) => byId.get(id)!).filter(Boolean),
          questionOrder: section.questionOrder,
          preordered: true,
        });
      } else {
        // PRD-11: stratified draw by tag quotas when a blueprint is set; otherwise
        // a uniform draw (FR-02). Shared with the SCORM runtime via shared/draw.
        const { selected } = drawSection(
          questions,
          section.drawCount,
          section.drawBlueprintJson,
          exposurePick,
        );
        // PRD-30 (FR-06): selection stays as it was — quotas and the random pick
        // are untouched; the ORDER is decided for the whole test below.
        qIds = selected.map((q) => q.id);
        drawnSections.push({ questions: selected, questionOrder: section.questionOrder });
      }

      variant.sections.push({
        topicId: section.topicId,
        topicName: topicMap.get(section.topicId) || "Unknown",
        questionIds: qIds,
        // PRD-17 (FR-08): pin the chosen variant id for rotation history (omitted
        // for non-variant sections).
        ...(formId ? { formId } : {}),
        // PRD-4 v1.1 §3.2: carry the per-topic time budget so the web runtime
        // can run a per-topic timer (parity with the SCORM package).
        timeLimitMinutes: section.timeLimitMinutes ?? null,
        // PRD-4 v1.1 §4.7: and the obligation, for the same reason. It is what the
        // router's «all_required_*» policy counts, and the package has always baked
        // it (`builders/test-json.ts`); without it here an OPTIONAL section blocked
        // «Завершить» on the web while the LMS let the learner through. Absent in an
        // attempt started before this reads as `true` — the old behaviour.
        required: section.required ?? true,
      });

      allQuestionIds.push(...qIds);
    }

    // PRD-30 раздел 14: ONE place decides the order. Topics stay blocks unless
    // the test asks for «полное перемешивание» in the flat flow, and then a topic
    // left on `fixed` travels as an unbroken block (FR-19/FR-20). The per-section
    // lists keep the composition; `deliveryOrder` carries the stream when it no
    // longer follows from concatenating them.
    const assembled = assembleDelivery(
      drawnSections,
      test.questionOrder,
      // Resolved, like every other read of the column: «полное перемешивание» is a
      // property of the FLAT flow, and an unrecognised mode is a flat flow.
      resolveFlowPolicy(test.flowPolicyJson).mode,
      shuffleInPlace,
    );
    assembled.sections.forEach((questions, i) => {
      variant.sections[i].questionIds = questions.map((q) => q.id);
    });
    // Written whenever the test MIXES across topics — a property of the settings,
    // not of the draw: a shuffle can land on the section order by chance, and a
    // field that appeared only then would make the attempt shape random.
    if (assembled.mixed) variant.deliveryOrder = assembled.flat.map((q) => q.id);
    }

    const allQuestions = await src.getQuestionsByIds(allQuestionIds);
    // PRD-66 FR-09b: запоминаем, КАКУЮ РЕДАКЦИЮ заданий увидел участник. Именно здесь, а не в
    // момент ответа: содержание веб отдаёт один раз, и правка задания посреди прохождения не
    // меняет того, что уже на экране у отвечающего.
    variant.psychoHashes = stampsOfDelivery(allQuestions);

    // The carried-over run is now superseded, and an abandoned row left behind would
    // both pile up orphans and give the resume lookup (`find(finishedAt === null)`) an
    // arbitrary one to return. Unfinished attempts never counted toward the limit, so
    // dropping them consumes nothing (PRD-15 FR-14).
    if (openAttempt) await storage.annulInProgressAttempts(test.id, req.session.userId!);

    const attempt = await storage.createAttempt({
      userId: req.session.userId!,
      testId: test.id,
      testVersion: test.version || 1,
      snapshotId,
      // PRD-31 (FR-12): pin the attempt to the assignment it was taken under, so the
      // access barriers and the attempt counter can be scoped to it later.
      assignmentId: currentAssignmentId,
      variantJson: variant,
      answersJson: null,
      resultJson: null,
      startedAt: new Date(),
      finishedAt: null,
    });

    // PRD-55 (FR-01/FR-02): выдачей считается НАЧАТАЯ попытка — состав формы уже зафиксирован,
    // и ответы для учёта не нужны: брошенная попытка показала содержание так же, как доведённая
    // до конца. Счётчик не имеет права ронять старт попытки, поэтому сбой уходит в лог: это
    // статистика качества банка, а не условие прохождения.
    try {
      await storage.recordDeliveries(allQuestionIds, test.id, new Date());
    } catch (error) {
      logger.warn("PRD-55: выдача заданий не записана — " + (error as Error).message);
    }

    res.status(201).json({
      ...attempt,
      testTitle: test.title,
      showCorrectAnswers: test.showCorrectAnswers || false,
      timeLimitMinutes: test.timeLimitMinutes || null,
      // PRD-19 (Block B): runtime navigation settings for the web host.
      ...prd19RuntimeSettings(test),
      // PRD-12 (FR-6): the author's content pages + flow mode, so the web run
      // follows the same structure as the SCORM package.
      ...(await flowPayload(src, test)),
      questions: await questionsForClient(src, test, allQuestions),
      // The threshold each section intro states (and the «Обязательная тема» mark).
      sectionConditions: await sectionConditionsPayload(src, test.id, variant, allQuestions),
      passDecisionPolicy: test.passDecisionPolicy ?? null,
    });
  } catch (error) {
    logger.error("Start attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to start attempt" });
  }
});

// POST /api/tests/:testId/attempts/start-adaptive - Начать адаптивный тест
router.post("/tests/:testId/attempts/start-adaptive", requirePermission("attempts.take"), async (req, res) => {
  try {
    // PRD-15 block B: published adaptive tests are delivered from their snapshot.
    const resolved = await sourceForStart(req.params.testId);
    if (!resolved) {
      return res.status(404).json({ error: "Test not found" });
    }
    const { src, snapshotId, test } = resolved;

    // Attempt gates (PRD-6 barrier A + PRD-31 barrier B) and the attempt counter,
    // scoped to the CURRENT ASSIGNMENT. Deliberately identical to the standard
    // start above — the two paths deciding differently is what produced the defect
    // PRD-31 fixes, so they must stay word-for-word the same.
    const retakePolicy = test.retakePolicyJson as RetakePolicy | null;
    const currentAssignmentId = await storage.getCurrentAssignmentId(req.session.userId!, test.id);
    // Loaded ONCE: the barriers and the abandoned-run cleanup below both read the
    // learner's attempts of this test.
    const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
    const barriersOn =
      retakePolicy?.enabled === true || retakePolicy?.attemptInterval?.enabled === true;
    if (barriersOn || test.maxAttempts !== null) {
      const attemptFacts = userAttempts.map((a) => ({
        assignmentId: a.assignmentId,
        finishedAt: a.finishedAt,
        // PRD-40: outcome of THIS attempt, for barrier A's outcome-split cooldown.
        passed: (a.resultJson as AttemptResult | null)?.overallPassed ?? null,
      }));

      const gate = decideRetake(retakePolicy, {
        currentAssignmentId,
        attempts: attemptFacts,
        now: new Date(),
      });
      if (!gate.allowed) {
        const interval = gate.blockedBy === "attemptInterval";
        return res.status(403).json({
          error: interval ? "Attempt interval active" : "Retake cooldown active",
          code: interval ? "ATTEMPT_INTERVAL" : "RETAKE_COOLDOWN",
          ...gate,
        });
      }

      if (
        test.maxAttempts !== null &&
        countAttemptsInAssignment(attemptFacts, currentAssignmentId) >= test.maxAttempts
      ) {
        return res.status(403).json({ error: "Attempts exhausted", code: "ATTEMPTS_EXHAUSTED" });
      }
    }

    if (test.mode !== "adaptive") {
      return res.status(400).json({ error: "This is not an adaptive test" });
    }

    const adaptiveSettings = await src.getAdaptiveTopicSettingsByTest(test.id);
    const adaptiveLevels = await src.getAdaptiveLevelsByTest(test.id);
    const topics = await src.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));
    // PRD-4 v1.1 §3.2: per-topic time budgets live on test_sections; join them
    // onto the adaptive topics by topicId so the runtime can run a topic timer.
    const adaptiveSections = await src.getTestSections(test.id);
    const sectionLimitMap = new Map(
      adaptiveSections.map((s) => [s.topicId, s.timeLimitMinutes ?? null]),
    );
    // PRD-30 §6.3: the ordering setting lives on the section; adaptive delivery
    // joins it by topicId exactly like the per-topic time budget above.
    // The topic's own value is an override, so the effective mode is resolved
    // against the test's default here as everywhere else (FR-18).
    const sectionOrderMap = new Map(
      adaptiveSections.map((s) => [s.topicId, effectiveSectionOrder(test.questionOrder, s.questionOrder)]),
    );

    if (adaptiveSettings.length === 0) {
      return res.status(400).json({ error: "Adaptive test has no settings configured" });
    }

    // PRD-15 block D (FR-34): level matching uses the EFFECTIVE difficulty —
    // the per-test override wins over the question's base value.
    const scoring = await loadTestScoringContext(test.id, src);

    /**
     * PRD-56 FR-17a: задания, исключённые из выдачи ЭТОГО теста.
     *
     * То же правило и с той же оговоркой, что у обычной выдачи выше: фильтр применяется
     * только к ЖИВОЙ выдаче, потому что прохождение по снимку состав не меняет (PRD-15).
     * Уровни собираются здесь, мимо `drawSection`, — и правило сюда сначала не доехало
     * вовсе: у опубликованного теста его выполнял снимок, а черновик выдавал снятое
     * задание. Дефект найден 2026-09-14 разбором техдолга.
     */
    const excludedFromDelivery = new Set<string>();
    if (snapshotId === null) {
      for (const row of await storage.getTestQuestionScoring(test.id)) {
        if (row.excludedFromDelivery) excludedFromDelivery.add(row.questionId);
      }
    }

    /**
     * PRD-55 (FR-26): накопленные выдачи за окно наблюдения.
     *
     * Читаются ОДНИМ запросом на попытку — как в обычной выдаче: тем у адаптивного теста
     * бывает несколько, и запрос на тему превратил бы старт в пачку обращений к базе. Сбой
     * чтения не имеет права ронять старт: без счётчиков веса равны, то есть выдача
     * деградирует до прежней случайной (FR-17).
     */
    const topicIds = adaptiveSettings.map((settings) => settings.topicId);
    const questionsByTopic = new Map<string, Question[]>();
    for (const topicId of topicIds) {
      questionsByTopic.set(
        topicId,
        (await src.getQuestionsByTopic(topicId))
          .filter((question) => !excludedFromDelivery.has(question.id)),
      );
    }

    let exposureCounts = new Map<string, number>();
    try {
      const windowStart = new Date();
      windowStart.setMonth(windowStart.getMonth() - config.delivery.exposureWindowMonths);
      exposureCounts = await storage.getDeliveryCounts(
        [...questionsByTopic.values()].flat().map((question) => question.id),
        windowStart,
      );
    } catch (error) {
      logger.warn("PRD-55: счётчики выдач не прочитаны — " + (error as Error).message);
    }

    // Build adaptive variant
    const adaptiveTopics: any[] = [];

    for (const topicSettings of adaptiveSettings) {
      const topicLevels = adaptiveLevels
        .filter((l) => l.topicId === topicSettings.topicId)
        .sort((a, b) => a.levelIndex - b.levelIndex);

      if (topicLevels.length === 0) continue;

      const allQuestions = questionsByTopic.get(topicSettings.topicId) ?? [];
      const levelsState: any[] = [];

      for (const level of topicLevels) {
        const levelQuestions = allQuestions.filter((q) => {
          const difficulty = scoring.difficultyOf(q);
          // PRD-16: a question with no difficulty («не задано») can't be placed in a level band.
          if (difficulty == null) return false;
          return difficulty >= level.minDifficulty && difficulty <= level.maxDifficulty;
        });

        /**
         * PRD-55 (FR-12): вес считается ВНУТРИ пула отбора — здесь это полоса трудности
         * уровня. Шкала сравнительная: она отвечает на «какое из ЭТИХ заданий выдавалось
         * реже», и горячее задание лёгкого уровня не имеет права отодвинуть свежее задание
         * сложного — они никогда не конкурируют между собой.
         *
         * До этого уровень отбирался `sort(() => Math.random() - 0.5)`: и поправки не знал,
         * и перестановку давал неравномерную. Банк уровня узок — полоса трудности отсекает
         * большую часть темы, — поэтому выработка головы здесь заметнее, чем в обычной выдаче.
         */
        const selected = weightedPick(
          levelQuestions,
          level.questionsCount,
          computeWeights(levelQuestions.map((q) => q.id), exposureCounts),
          Math.random,
        );
        // PRD-30 §6.3: ordering applies INSIDE the level — which questions the
        // level got (the random pick above) and the order of the levels
        // themselves are not touched.
        const questionIds = orderQuestions(
          selected,
          sectionOrderMap.get(topicSettings.topicId) ?? "random",
          shuffleInPlace,
        ).map((q) => q.id);

        levelsState.push({
          levelIndex: level.levelIndex,
          levelName: level.levelName,
          minDifficulty: level.minDifficulty,
          maxDifficulty: level.maxDifficulty,
          questionsCount: level.questionsCount,
          passThreshold: level.passThreshold,
          passThresholdType: level.passThresholdType,
          questionIds,
          answeredQuestionIds: [],
          correctCount: 0,
          status: "pending",
        });
      }

      const startLevelIndex = Math.floor(topicLevels.length / 2);

      adaptiveTopics.push({
        topicId: topicSettings.topicId,
        topicName: topicMap.get(topicSettings.topicId) || "Unknown",
        currentLevelIndex: startLevelIndex,
        levelsState,
        finalLevelIndex: null,
        status: "in_progress",
        // Per-topic time budget (null = no limit); read by the topic timer.
        timeLimitMinutes: sectionLimitMap.get(topicSettings.topicId) ?? null,
      });
    }

    if (adaptiveTopics.length === 0) {
      return res.status(400).json({ error: "No valid adaptive topics configured" });
    }

    const firstTopic = adaptiveTopics[0];
    const firstLevel = firstTopic.levelsState[firstTopic.currentLevelIndex];
    firstLevel.status = "in_progress";
    const firstQuestionId = firstLevel.questionIds[0] || null;

    const variant = {
      mode: "adaptive",
      topics: adaptiveTopics,
      currentTopicIndex: 0,
      currentQuestionId: firstQuestionId,
    };

    // An abandoned adaptive run is superseded by this one; leaving it behind would
    // pile up orphan rows and give the resume lookup an arbitrary one to return.
    // Its questions are NOT carried over the way the standard start carries them:
    // the adaptive variant is a level state machine drawn as the run progresses, so
    // there is no fixed delivered set to hand back. Unfinished attempts never counted
    // toward the limit, so dropping them consumes nothing (PRD-15 FR-14).
    if (userAttempts.some((a) => a.finishedAt === null)) {
      await storage.annulInProgressAttempts(test.id, req.session.userId!);
    }

    const attempt = await storage.createAttempt({
      userId: req.session.userId!,
      testId: test.id,
      testVersion: test.version || 1,
      snapshotId,
      // PRD-31 (FR-12): pin the attempt to the assignment it was taken under.
      assignmentId: currentAssignmentId,
      variantJson: variant,
      answersJson: {},
      resultJson: null,
      startedAt: new Date(),
      finishedAt: null,
    });

    let firstQuestion = null;
    if (firstQuestionId) {
      const questions = await src.getQuestionsByIds([firstQuestionId]);
      firstQuestion = questions[0] || null;
      await recordAdaptiveDelivery(firstQuestionId, test.id);
    }

    res.status(201).json({
      attemptId: attempt.id,
      testTitle: test.title,
      showDifficultyLevel: test.showDifficultyLevel,
      showCorrectAnswers: test.showCorrectAnswers,
      timeLimitMinutes: test.timeLimitMinutes || null,
      currentQuestion: firstQuestion
        ? {
            id: firstQuestion.id,
            question: firstQuestion,
            topicName: firstTopic.topicName,
            topicId: firstTopic.topicId,
            sectionTimeLimitMinutes: firstTopic.timeLimitMinutes ?? null,
            levelName: firstLevel.levelName,
            questionNumber: 1,
            totalInLevel: firstLevel.questionIds.length,
          }
        : null,
      totalTopics: adaptiveTopics.length,
      currentTopicIndex: 0,
    });
  } catch (error) {
    logger.error("Start adaptive attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to start adaptive attempt" });
  }
});

// POST /api/attempts/:attemptId/answer-adaptive - Ответить на вопрос адаптивного теста
router.post("/attempts/:attemptId/answer-adaptive", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (attempt.finishedAt) {
      return res.status(400).json({ error: "Attempt already finished" });
    }

    const { questionId, answer } = req.body;
    const variant = attempt.variantJson as any;

    if (variant.mode !== "adaptive") {
      return res.status(400).json({ error: "This is not an adaptive attempt" });
    }

    // PRD-15 block B: grade against the pinned snapshot, not the live bank.
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const test = await src.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const currentTopic = variant.topics[variant.currentTopicIndex];
    const currentLevel = currentTopic.levelsState[currentTopic.currentLevelIndex];

    if (variant.currentQuestionId !== questionId) {
      return res.status(400).json({ error: "Unexpected question ID" });
    }

    // PRD-67 FR-10: a topic whose time ran out or that was closed by a leave takes no
    // more answers. The client moves on via `expire-topic-adaptive`; this refuses a
    // request that did not.
    const timerLocked = freezeLockedAnswers(
      { [questionId]: answer },
      {},
      [{ topicId: currentTopic.topicId, questionIds: [questionId] }],
      attempt.sectionTimerJson,
    );
    if (!Object.prototype.hasOwnProperty.call(timerLocked, questionId)) {
      return res.status(409).json({ error: "section_locked", topicId: currentTopic.topicId });
    }

    const questions = await src.getQuestionsByIds([questionId]);
    const question = questions[0];
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    // PRD-15 block D (FR-32): grade with the test-effective graded config.
    const scoring = await loadTestScoringContext(test.id, src);
    const isCorrect = checkAnswer(question, answer, scoring.resolve(question).scoring) === 1;
    const updatedAnswers = { ...((attempt.answersJson as any) || {}), [questionId]: answer };
    // PRD-66 FR-09b: в адаптивном прохождении задание выдаётся по одному и читается прямо
    // здесь, поэтому штамп снимается в момент ответа — он и есть момент выдачи.
    variant.psychoHashes = { ...(variant.psychoHashes || {}), [questionId]: resolvePsychoHash(question) };
    // PRD-66 FR-37a: время на задании приходит той же точкой — другой у адаптива нет.
    const adaptiveLatency = sanitizeLatency(req.body?.latencyMs);
    if (adaptiveLatency) variant.latencyMs = adaptiveLatency;

    currentLevel.answeredQuestionIds.push(questionId);
    if (isCorrect) {
      currentLevel.correctCount++;
    }

    const answeredCount = currentLevel.answeredQuestionIds.length;
    const remainingQuestions = currentLevel.questionIds.length - answeredCount;
    const correctCount = currentLevel.correctCount;

    let requiredCorrect: number;
    if (currentLevel.passThresholdType === "percent") {
      requiredCorrect = Math.ceil((currentLevel.questionIds.length * currentLevel.passThreshold) / 100);
    } else {
      requiredCorrect = currentLevel.passThreshold;
    }

    const canStillPass = correctCount + remainingQuestions >= requiredCorrect;
    const alreadyPassed = correctCount >= requiredCorrect;
    const alreadyFailed = !canStillPass;
    const allAnswered = remainingQuestions === 0;

    let levelTransition: any = null;
    let topicTransition: any = null;
    let isFinished = false;
    let nextQuestionData: any = null;

    // Логика переходов между уровнями (сокращённая версия)
    if (alreadyPassed || (allAnswered && correctCount >= requiredCorrect)) {
      currentLevel.status = "passed";
      currentTopic.finalLevelIndex = currentTopic.currentLevelIndex;

      const nextLevelIndex = currentTopic.currentLevelIndex + 1;
      if (nextLevelIndex < currentTopic.levelsState.length) {
        const nextLevel = currentTopic.levelsState[nextLevelIndex];
        if (nextLevel.status === "pending") {
          levelTransition = {
            type: "up",
            fromLevel: currentLevel.levelName,
            toLevel: nextLevel.levelName,
            message: `Уровень "${currentLevel.levelName}" пройден! Переход на уровень "${nextLevel.levelName}"`,
          };
          currentTopic.currentLevelIndex = nextLevelIndex;
          nextLevel.status = "in_progress";
          variant.currentQuestionId = nextLevel.questionIds[0];
          nextQuestionData = await getNextQuestionData(nextLevel, currentTopic, 0, src);
        } else {
          ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
            variant,
            currentTopic,
            currentLevel,
            src
          ));
        }
      } else {
        ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
          variant,
          currentTopic,
          currentLevel,
          src
        ));
      }
    } else if (alreadyFailed || (allAnswered && correctCount < requiredCorrect)) {
      currentLevel.status = "failed";

      if (currentTopic.finalLevelIndex !== null) {
        ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
          variant,
          currentTopic,
          currentLevel,
          src
        ));
      } else {
        const prevLevelIndex = currentTopic.currentLevelIndex - 1;
        if (prevLevelIndex >= 0) {
          const prevLevel = currentTopic.levelsState[prevLevelIndex];
          if (prevLevel.status === "pending") {
            levelTransition = {
              type: "down",
              fromLevel: currentLevel.levelName,
              toLevel: prevLevel.levelName,
              message: `Уровень "${currentLevel.levelName}" не пройден. Переход на уровень "${prevLevel.levelName}"`,
            };
            currentTopic.currentLevelIndex = prevLevelIndex;
            prevLevel.status = "in_progress";
            variant.currentQuestionId = prevLevel.questionIds[0];
            nextQuestionData = await getNextQuestionData(prevLevel, currentTopic, 0, src);
          } else {
            currentTopic.finalLevelIndex = null;
            ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
              variant,
              currentTopic,
              currentLevel,
              src
            ));
          }
        } else {
          currentTopic.finalLevelIndex = null;
          ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
            variant,
            currentTopic,
            currentLevel,
            src
          ));
        }
      }
    } else {
      const currentQuestionIndex = currentLevel.questionIds.indexOf(questionId);
      const nextQuestionId = currentLevel.questionIds[currentQuestionIndex + 1];
      variant.currentQuestionId = nextQuestionId;
      nextQuestionData = await getNextQuestionData(currentLevel, currentTopic, currentQuestionIndex + 1, src);
    }

    let result: any = null;
    if (isFinished) {
      result = await buildAdaptiveResult(variant, test.id, src, updatedAnswers);
    }

    await storage.updateAttempt(attempt.id, {
      variantJson: variant,
      answersJson: updatedAnswers,
      resultJson: isFinished ? result : null,
      finishedAt: isFinished ? new Date() : null,
    });

    if (nextQuestionData?.id) await recordAdaptiveDelivery(nextQuestionData.id, test.id);

    const response: any = {
      isCorrect,
      nextQuestion: nextQuestionData,
      levelTransition,
      topicTransition,
      isFinished,
      result,
    };

    if (test.showCorrectAnswers) {
      response.correctAnswer = question.correctJson;
      // issue #34: ветку общего/условного режима выбирает ОБЩЕЕ правило — то же, что
      // у стандартного режима и у рантайма пакета. Отдавать один `feedback` было
      // нельзя: у вопроса с условной обратной связью редактор обнуляет это поле, и
      // ученик на вебе получал вердикт без пояснения.
      response.feedback = feedbackTextFor(question, isCorrect, answer);
    }

    res.json(response);
  } catch (error) {
    logger.error("Answer adaptive error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to process answer" });
  }
});

// POST /api/attempts/:attemptId/expire-topic-adaptive - PRD-4 v1.1 §3.2:
// the per-topic timer ran out. Force-complete the current adaptive topic (with
// whatever was answered) and move to the next topic or finish. Idempotent: a
// retried/duplicate request whose `topicId` no longer matches the current topic
// (the move already happened — e.g. the first response was lost) re-syncs the
// client to the current question instead of advancing again.
router.post("/attempts/:attemptId/expire-topic-adaptive", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }
    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { topicId } = req.body;
    const variant = attempt.variantJson as any;
    if (variant.mode !== "adaptive") {
      return res.status(400).json({ error: "This is not an adaptive attempt" });
    }

    // PRD-15 block B: this transition reads questions/adaptive config; source
    // from the pinned snapshot.
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const test = await src.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    // Already finished (possibly by a prior expiry) — idempotent finished state.
    if (attempt.finishedAt) {
      return res.json({
        nextQuestion: null,
        levelTransition: null,
        topicTransition: null,
        isFinished: true,
        result: attempt.resultJson ?? null,
      });
    }

    const currentTopic = variant.topics[variant.currentTopicIndex];
    // Idempotent: the expired topic was already advanced past. Re-send the
    // current question so a lost-response retry re-syncs without double-advancing.
    if (!currentTopic || currentTopic.topicId !== topicId) {
      const cur = await currentAdaptiveQuestion(variant, src);
      return res.json({
        nextQuestion: cur,
        levelTransition: null,
        topicTransition: null,
        isFinished: false,
        result: null,
      });
    }

    const currentLevel = currentTopic.levelsState[currentTopic.currentLevelIndex];
    const { levelTransition, topicTransition, nextQuestionData, isFinished } =
      await moveToNextTopicOrFinish(variant, currentTopic, currentLevel, src);

    let result: any = null;
    if (isFinished) {
      // The timer closed the topic, so nothing new was answered: the attempt's stored
      // answers ARE the input the measurements are computed from.
      result = await buildAdaptiveResult(
        variant,
        test.id,
        src,
        (attempt.answersJson ?? {}) as Record<string, unknown>,
      );
    }

    await storage.updateAttempt(attempt.id, {
      variantJson: variant,
      resultJson: isFinished ? result : null,
      finishedAt: isFinished ? new Date() : null,
    });

    res.json({
      nextQuestion: nextQuestionData,
      levelTransition,
      topicTransition,
      isFinished,
      result,
    });
  } catch (error) {
    logger.error("Expire adaptive topic error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to expire topic" });
  }
});

// POST /api/attempts/:attemptId/finish-adaptive — the WHOLE-TEST timer ran out.
//
// The standard flow ends such a run through `/finish`; the adaptive flow had no
// server-side counterpart at all, so the host finished the run in its own state and
// walked the learner to the result page of an attempt that was still open —
// `finished_at` and `result_json` NULL, «Результаты не найдены», the run lost.
//
// Unlike `expire-topic-adaptive` this does NOT advance anything: the run is over, so
// whatever topics and levels were not reached simply stay unplayed, and the result is
// computed from the answers already stored (nothing new can arrive after the buzzer).
// Idempotent: a duplicate/retried request on a finished attempt returns the stored result.
router.post("/attempts/:attemptId/finish-adaptive", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }
    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const variant = attempt.variantJson as any;
    if (variant?.mode !== "adaptive") {
      return res.status(400).json({ error: "This is not an adaptive attempt" });
    }

    if (attempt.finishedAt) {
      return res.json({ isFinished: true, result: attempt.resultJson ?? null });
    }

    // PRD-15 block B: measurements read questions/adaptive config from the pinned
    // snapshot, the same source the attempt was delivered from.
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const test = await src.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const result = await buildAdaptiveResult(
      variant,
      test.id,
      src,
      (attempt.answersJson ?? {}) as Record<string, unknown>,
    );

    await storage.updateAttempt(attempt.id, {
      resultJson: result,
      finishedAt: new Date(),
    });

    res.json({ isFinished: true, result });
  } catch (error) {
    logger.error("Finish adaptive attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to finish attempt" });
  }
});

// POST /api/attempts/:attemptId/section-timer — пинг «я в этом разделе».
//
// The SERVER owns the remaining time of a section (see services/section-timer):
// the host reports where the learner is, the server credits the elapsed active
// time (capped by the grace window) and answers with what is left and what is
// locked. Keeping this off the browser is what makes «закрыл вкладку — вернулся с
// полным лимитом» impossible.
router.post("/attempts/:attemptId/section-timer", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) return res.status(404).json({ error: "Attempt not found" });
    if (attempt.userId !== req.session.userId) return res.status(403).json({ error: "Forbidden" });
    if (attempt.finishedAt) return res.status(400).json({ error: "Attempt already finished" });

    const topicId = typeof req.body?.topicId === "string" ? req.body.topicId : null;
    // PRD-67: identity of the page run. A different one while a section is open is how
    // the server learns the page was reloaded or reopened. Bounded so a forged body cannot
    // bloat the attempt row.
    const rawRunId = req.body?.runId;
    const runId = typeof rawRunId === "string" && rawRunId.length > 0 && rawRunId.length <= 64
      ? rawRunId
      : null;
    // The limit comes from the TEST, never from the client: a forged body must not
    // be able to widen a section's budget.
    const sections = await storage.getTestSections(attempt.testId);
    const limitMinutes = topicId
      ? (sections.find((s) => s.topicId === topicId)?.timeLimitMinutes ?? null)
      : null;
    // PRD-67: the leave policy is read from the version the attempt plays (snapshot or
    // live), like every other runtime setting of the attempt.
    const policy = await leavePolicyForAttempt(attempt.snapshotId, attempt.testId);

    const view = await pingSection(attempt.id, topicId, limitMinutes, runId, policy);
    if (!view) return res.status(400).json({ error: "Attempt already finished" });
    res.json(view);
  } catch (error) {
    logger.error("Section timer ping error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update section timer" });
  }
});

// POST /api/attempts/:attemptId/save-progress - Сохранить прогресс
router.post("/attempts/:attemptId/save-progress", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (attempt.finishedAt) {
      return res.status(400).json({ error: "Attempt already finished" });
    }

    const { answers, currentIndex, shuffleMappings, questionStatus, sectionPositions, latencyMs } = req.body;

    const updatedVariant: any = {
      ...(attempt.variantJson as any),
      currentIndex,
    };

    // PRD-66 FR-37a: время, проведённое на каждом задании, — материал анализа пунктов: оно
    // отличает задание, над которым думают, от того, что пролистывают не читая. Живёт рядом с
    // составом выдачи, а не в карте ответов: та плоская, «задание -> значение ответа», и второй
    // величине в ней места нет. Клиент, который поля не шлёт, прежде измеренное НЕ стирает.
    const measured = sanitizeLatency(latencyMs);
    if (measured) updatedVariant.latencyMs = measured;

    if (shuffleMappings) {
      updatedVariant.shuffleMappings = shuffleMappings;
    }

    // PRD-19 (Block B): per-question navigation status travels with the variant
    // (web analogue of suspend_data.currentSession.questionStatuses). Absent =
    // legacy progress (treated as all-'unanswered' on resume).
    if (questionStatus) {
      updatedVariant.questionStatus = questionStatus;
    }

    // Per-section resume position: re-entering a section continues from the question
    // the learner stopped on (the web twin of the package's currentRouterTopic +
    // currentPageIndex checkpoint), instead of restarting the section.
    if (sectionPositions && typeof sectionPositions === "object") {
      updatedVariant.sectionPositions = sectionPositions;
    }

    // PRD-67 FR-10: a locked section (time spent or closed by a leave) keeps the answers
    // stored before the lock — the lock is enforced here, not only painted by the client.
    const frozenAnswers = freezeLockedAnswers(
      answers,
      attempt.answersJson as Record<string, unknown> | null,
      ((attempt.variantJson as TestVariant | null)?.sections ?? []),
      attempt.sectionTimerJson,
    );

    await storage.updateAttempt(attempt.id, {
      answersJson: frozenAnswers,
      variantJson: updatedVariant,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("Save progress error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to save progress" });
  }
});

// GET /api/tests/:testId/resume - Возобновить попытку
router.get("/tests/:testId/resume", requirePermission("attempts.take"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
    const inProgressAttempt = userAttempts.find((a) => a.finishedAt === null);

    if (!inProgressAttempt) {
      return res.json({ hasInProgress: false });
    }

    // PRD-15 block B: resume the in-progress attempt from its pinned snapshot,
    // so the questions match exactly what was started.
    const src = await dataSourceForAttempt(inProgressAttempt.snapshotId);
    const variant = inProgressAttempt.variantJson as any;
    const allQuestionIds = variant.sections.flatMap((s: any) => s.questionIds);
    const allQuestions = await src.getQuestionsByIds(allQuestionIds);

    res.json({
      hasInProgress: true,
      attempt: {
        ...inProgressAttempt,
        testTitle: test.title,
        showCorrectAnswers: test.showCorrectAnswers || false,
        timeLimitMinutes: test.timeLimitMinutes || null,
        // PRD-19 (Block B): runtime navigation settings for the web host.
        ...prd19RuntimeSettings(test),
        // PRD-12 (FR-6): structure (content pages + flow mode) for the resumed run.
        ...(await flowPayload(src, test)),
        questions: await questionsForClient(src, test, allQuestions),
        sectionConditions: await sectionConditionsPayload(src, test.id, variant, allQuestions),
        passDecisionPolicy: test.passDecisionPolicy ?? null,
      },
      savedAnswers: inProgressAttempt.answersJson || {},
      currentIndex: variant.currentIndex || 0,
      // PRD-19 (Block B): restore per-question statuses; absent = all-'unanswered'.
      questionStatus: variant.questionStatus || {},
      sectionPositions: variant.sectionPositions || {},
    });
  } catch (error) {
    logger.error("Resume attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to resume attempt" });
  }
});

// POST /api/attempts/:attemptId/section-result - PRD-19 D5 (FR-05a): grade ONE
// section's answers-so-far through the SAME shared engine the final results use
// (`aggregateStandardResult` + the test-side effective scoring), so the web
// section-results screen (итоги раздела) matches the SCORM-baked
// `computeSectionResult` (parity, PRD-12). Read-only — it neither finishes nor
// persists the attempt; the web host calls it when a section is committed.
router.post("/attempts/:attemptId/section-result", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) return res.status(404).json({ error: "Attempt not found" });
    if (attempt.userId !== req.session.userId) return res.status(403).json({ error: "Forbidden" });

    const { topicId, answers } = req.body as { topicId?: string; answers?: Record<string, unknown> };
    if (!topicId) return res.status(400).json({ error: "topicId required" });

    const variant = attempt.variantJson as TestVariant;
    const variantSection = variant.sections.find((s) => s.topicId === topicId);
    if (!variantSection) return res.status(404).json({ error: "Section not found in attempt" });

    // PRD-15 block B: grade against the pinned snapshot, like /finish.
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const test = await src.getTest(attempt.testId);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const sections = await src.getTestSections(test.id);
    const section = sections.find((s) => s.topicId === topicId);
    const scoring = await loadTestScoringContext(test.id, src);
    const questions = await src.getQuestionsByIds(variantSection.questionIds);

    const aggSection: AggregateSection = {
      topicId: variantSection.topicId,
      topicName: variantSection.topicName,
      topicPassRule: section?.topicPassRuleJson ?? null,
      // PRD-24: the variant delivered for this topic decides which threshold gates it.
      formId: variantSection.formId ?? null,
      questions: questions.map((q) => {
        const effective = scoring.resolve(q);
        return {
          id: q.id,
          type: q.type as QuestionType,
          correct: (q.correctJson ?? {}) as CorrectData,
          scoring: effective.scoring,
          points: effective.points,
          answer: (answers ?? {})[q.id] as Answer,
          // PRD-50 FR-15: ключи разреза этого вопроса. Пустой список не кладём,
          // чтобы результат теста без тегов не менялся ни на байт.
          ...(Array.isArray(q.tags) && q.tags.length ? { axisKeys: { tag: q.tags } } : {}),
        };
      }),
    };
    // Same overall pass rule as /finish so a topic with an inherit/none rule
    // resolves its verdict identically (resolveTopicRule -> overall).
    // PRD-50 FR-53: гейт подтем передаётся и сюда — иначе вердикт темы на экране итогов
    // раздела разошёлся бы с тем же вердиктом на экране итогов теста.
    const agg = aggregateStandardResult({
      sections: [aggSection],
      overallPassRule: test.overallPassRuleJson,
      breakdownGateEnabled: test.breakdownGateEnabled === true,
    });
    const tr = agg.topicResults[0];
    // PRD-49: надписи ЭТОГО экрана (`section.eyebrow`, `facts.*`). Разрешает СЕРВЕР — тем
    // же адаптером и против того же манифеста, что и надписи экрана итогов, — а браузер
    // отдаёт готовую плоскую карту ядру: дерево строит только оно. Настройки берутся из
    // ВЫДАННОЙ версии теста (`src`), на которой попытка и идёт. Пустая карта (шаблон
    // надписей не объявлял) в ответ не кладётся: экран тогда печатает свои строки, как до
    // этого PRD.
    const design = (test.designSettingsJson as DesignSettings | null) ?? null;
    const declarations = readResultsDeclarations(
      await resolveTemplateDir(design?.templateId, { activeOnly: true }),
    );
    const labels = resolveScreenLabels(declarations.labels, design, "section-results");
    res.json({
      topicId: tr.topicId,
      topicName: tr.topicName,
      correct: tr.correct,
      total: tr.total,
      percent: tr.percent,
      passed: tr.passed,
      earnedPoints: tr.earnedPoints,
      possiblePoints: tr.possiblePoints,
      ...(Object.keys(labels).length ? { labels } : {}),
    });
  } catch (error) {
    logger.error("Section result error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to compute section result" });
  }
});

// POST /api/attempts/:attemptId/finish - Завершить попытку
router.post("/attempts/:attemptId/finish", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const variant = attempt.variantJson as TestVariant;
    // PRD-67 FR-10: grade the answers a locked section had BEFORE its lock, whatever the
    // finishing request carries for it.
    const answers = freezeLockedAnswers<Answer>(
      req.body?.answers,
      attempt.answersJson as Record<string, Answer> | null,
      variant?.sections ?? [],
      attempt.sectionTimerJson,
    );
    // PRD-15 block B: grade against the pinned snapshot, not the live bank.
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const test = await src.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const sections = await src.getTestSections(test.id);
    const sectionMap = new Map(sections.map((s) => [s.topicId, s]));
    // PRD-15 block D (FR-32): price and graded config come from the test-side
    // chain (override -> section default -> test default -> system), resolved
    // against the SAME source as delivery (snapshot or live).
    const scoring = await loadTestScoringContext(test.id, src);

    // PRD-12 §3.5: question types for the scale engine's percent-normalization.
    const questionTypes: Record<string, QuestionType> = {};

    // PRD-18: result aggregation + pass-rule evaluation run through the SINGLE
    // shared engine (`aggregateStandardResult`, the SAME one the SCORM runtime
    // runs). Effective price / graded config (block D) is resolved here; the engine
    // owns per-answer scoring, per-topic/overall percent and pass-rule resolution
    // (inherit_overall -> overall, none -> no gate, count basis = Σ earned points).
    const aggSections: AggregateSection<{
      recommendedCourses: { title: string; url: string }[];
      recommendedEvents: { title: string }[];
      recommendedAssets: { title: string; url: string }[];
      feedbackTexts: string[];
    }>[] = [];
    // PRD-66 FR-09b: редакция заданий НА МОМЕНТ ЗАВЕРШЕНИЯ — для сверки с той, что была
    // выдана. Собирается попутно: вопросы всё равно читаются здесь, отдельного запроса
    // сверка не стоит.
    const stampsAtFinish: Record<string, string> = {};
    for (const variantSection of variant.sections) {
      const section = sectionMap.get(variantSection.topicId);
      const questions = await src.getQuestionsByIds(variantSection.questionIds);
      Object.assign(stampsAtFinish, stampsOfDelivery(questions));
      const courses = await src.getTopicCourses(variantSection.topicId);
      const events = await src.getTopicEvents(variantSection.topicId);
      // PRD-32: PDF attachments of the topic AND of this test's section over it — two
      // different storage points, both authored through the same feedback editor, both
      // due to the learner. Read from the SAME source the attempt is graded against, so
      // a snapshot-pinned attempt hands out the materials that were published with it.
      const topic = await src.getTopic(variantSection.topicId);
      const feedbackAttachments = feedbackAssets(topic?.feedbackJson, section?.feedbackJson);
      aggSections.push({
        topicId: variantSection.topicId,
        topicName: variantSection.topicName,
        topicPassRule: section?.topicPassRuleJson ?? null,
        // PRD-24: the variant delivered for this topic decides which threshold gates it.
        formId: variantSection.formId ?? null,
        // «Тест пройден, если»: the `*_required_topics*` policies gate on this flag.
        required: section?.required ?? true,
        // Пороги подтем в расчёт не идут: вердикт темы — её собственное правило
        // (решение владельца 2026-09-03). Сохранённые пороги остаются легаси-данными.
        // PRD-50 FR-11: блок разделов, в котором раздел был ВЫДАН. Из того же источника,
        // что и порог раздела: попытка обязана помнить принадлежность, с которой её
        // оценивали, даже если автор перегруппирует тест завтра.
        groupKey: section?.groupKey ?? null,
        questions: questions.map((q) => {
          questionTypes[q.id] = q.type as QuestionType;
          const effective = scoring.resolve(q);
          return {
            id: q.id,
          type: q.type as QuestionType,
            correct: (q.correctJson ?? {}) as CorrectData,
            scoring: effective.scoring,
            points: effective.points,
            answer: answers?.[q.id] as Answer,
            // PRD-50 FR-15: ключи разреза этого вопроса. Пустой список не кладём,
            // чтобы результат теста без тегов не менялся ни на байт.
            ...(Array.isArray(q.tags) && q.tags.length ? { axisKeys: { tag: q.tags } } : {}),
          };
        }),
        extra: {
          recommendedCourses: courses.map((c) => ({ title: c.title, url: c.url })),
          recommendedEvents: events.map((e) => ({ title: e.title })),
          recommendedAssets: feedbackAttachments.map((a) => ({ title: a.title, url: a.url ?? "" })),
          // Same two blocks, same source: the text an author wrote for the topic and for
          // this test's section over it travels WITH the attempt, so a snapshot-pinned
          // attempt keeps the wording it was published with.
          feedbackTexts: topicFeedbackTexts(topic, section?.feedbackJson),
        },
      });
    }

    // PRD-57 FR-28q: авторские выражения считаются ДО оценки, в рабочем потоке с
    // бюджетом. Node однопоточен: без этого одно плохое выражение останавливает
    // обслуживание всех, а не одну попытку.
    await attachRegexVerdicts(
      aggSections.flatMap((section) => section.questions),
      config.limits.answerCheckBudgetMs,
    );

    const agg = aggregateStandardResult({
      sections: aggSections,
      overallPassRule: test.overallPassRuleJson,
      // «Тест пройден, если» — read from the SAME source the attempt is graded
      // against (snapshot or live), so a pinned attempt keeps the policy it was
      // published with. A snapshot taken before the column existed carries none,
      // and the engine then falls back to the pre-policy verdict.
      passDecisionPolicy: test.passDecisionPolicy,
      // PRD-50 FR-53: учитывать ли подтемы в вердикте темы. Читается из ТОЙ ЖЕ версии
      // теста, против которой попытка и оценивается (снимок или живая): попытка,
      // приколотая к снимку без этого поля, судится как судилась.
      breakdownGateEnabled: test.breakdownGateEnabled === true,
    });
    const totalCorrect = agg.correct;
    const totalQuestions = agg.totalQuestions;
    const totalEarnedPoints = agg.earnedPoints;
    const totalPossiblePoints = agg.possiblePoints;
    const overallPercent = agg.percent;
    let overallPassed = agg.passed;
    const topicResults: TopicResult[] = agg.topicResults.map((t) => ({
      topicId: t.topicId,
      topicName: t.topicName,
      correct: t.correct,
      total: t.total,
      percent: t.percent,
      earnedPoints: t.earnedPoints,
      possiblePoints: t.possiblePoints,
      passed: t.passed,
      passRule: t.passRule as PassRule | null,
      recommendedCourses: t.extra!.recommendedCourses,
      recommendedEvents: t.extra!.recommendedEvents,
      recommendedAssets: t.extra!.recommendedAssets,
      feedbackTexts: t.extra!.feedbackTexts,
      breakdown: t.breakdown,
      // PRD-50 FR-11: ключ блока ставится ТОЛЬКО у раздела, который в блок попал —
      // `aggregateStandardResult` возвращает поле лишь тогда. Результат теста без блоков
      // поэтому остаётся прежним, вплоть до отсутствия ключа в JSON.
      ...(t.groupKey ? { groupKey: t.groupKey } : {}),
    }));

    // PRD-50 FR-35/FR-36: both scopes in ONE flat array — the engine returns the
    // test-scope records on `breakdowns` and the section-scope ones on each topic
    // result, and `tag()` needs to reach either.
    const allBreakdowns = [...agg.breakdowns, ...agg.topicResults.flatMap((t) => t.breakdown)];

    // PRD-12: graded namespaces (scales PRD-5 + result variables PRD-2) via the
    // shared engines, mirroring the SCORM runtime. No-op when the test has none.
    const scoringConfig = await loadScoringConfig(test.id, src);
    let scaleResults: AttemptResult["scaleResults"];
    let resultVariables: AttemptResult["resultVariables"];
    let status: AttemptResult["status"];
    if (scoringConfig.scales.length > 0 || scoringConfig.resultVariables.length > 0) {
      // Topic codes enable `topicById("<code>")` (readable id); names already on
      // topicResults enable `topicByName("<name>")` (PRD-2 §4.2).
      const topicCodeById = new Map(
        (await src.getTopics()).map((t) => [t.id, t.code ?? null] as const),
      );
      const computation = computeAttemptResult(
        scoringConfig,
        answers ?? {},
        questionTypes,
        {
          percent: overallPercent,
          topicResults: topicResults.map((t) => ({ ...t, code: topicCodeById.get(t.topicId) ?? null })),
          breakdowns: allBreakdowns,
        },
      );
      if (Object.keys(computation.scaleResults).length > 0) scaleResults = computation.scaleResults;
      if (Object.keys(computation.resultVariables).length > 0) resultVariables = computation.resultVariables;
      if (computation.status.success !== undefined || computation.status.completion !== undefined) {
        status = computation.status;
      }
      // A boolean controls_status="success" variable overrides the pass flag
      // (parity with the SCORM runtime, resultsPage.js).
      if (typeof computation.status.success === "boolean") {
        overallPassed = computation.status.success;
      }
    }

    const result: AttemptResult = {
      totalCorrect,
      totalQuestions,
      overallPercent,
      totalEarnedPoints,
      totalPossiblePoints,
      overallPassed,
      topicResults,
      ...(scaleResults ? { scaleResults } : {}),
      ...(resultVariables ? { resultVariables } : {}),
      ...(status ? { status } : {}),
      // PRD-50 FR-39: records of the TEST scope travel with the attempt. Section-scope
      // ones already live on the topics (`topicResults[].breakdown`), so only the test
      // scope goes here — an empty list is not stored at all, so a tag-less test's result
      // does not change by a single byte.
      ...(agg.breakdowns.length ? { breakdowns: agg.breakdowns } : {}),
      // PRD-57 (#43): исходы ответов сохраняются вместе со сводкой — ради них аналитика
      // и перестаёт пересчитывать верность по живым вопросам. Поля здесь перечислены
      // поимённо, поэтому незаявленное срезается молча: ровно так это поле и потерялось
      // при первой приёмке.
      ...(agg.questionOutcomes?.length ? { questionOutcomes: agg.questionOutcomes } : {}),
      // PRD-57 FR-36: признак завершённости оценки хранится ВМЕСТЕ с результатом. Поле,
      // посчитанное агрегатом, но не перенесённое сюда, срезается без единой ошибки —
      // `AttemptResult` перечисляет поля поимённо, и это уже подводило на Э3.
      gradingComplete: agg.gradingComplete,
    };

    // PRD-66 FR-09b: правка задания посреди прохождения обесценивает штамп выдачи —
    // сверка отмечает это до того, как наблюдение уйдёт в статистику.
    const reconciled = reconcileStamps(variant.psychoHashes, stampsAtFinish);
    // PRD-66 FR-37a: попытку часто завершают прямо с вопроса, и последний заход приходит
    // именно здесь — без него время этого задания осталось бы недосчитанным.
    const measured = sanitizeLatency(req.body?.latencyMs);
    const variantChanged = reconciled || measured;

    await storage.updateAttempt(attempt.id, {
      answersJson: answers,
      resultJson: result,
      ...(variantChanged
        ? {
            variantJson: {
              ...variant,
              ...(reconciled ? { psychoHashes: reconciled } : {}),
              ...(measured ? { latencyMs: measured } : {}),
            },
          }
        : {}),
      finishedAt: new Date(),
    });

    res.json({ success: true, result });
  } catch (error) {
    logger.error("Finish attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to finish attempt" });
  }
});

// GET /api/attempts/:attemptId/result - Результат попытки
router.get("/attempts/:attemptId/result", requirePermission("attempts.self.read"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const test = await storage.getTest(attempt.testId);

    const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, attempt.testId);
    // PRD-31 (FR-07): «Пройти ещё раз» and «попытка K из M» count inside the CURRENT
    // assignment — the same scope the start route enforces, so the results screen
    // cannot offer a retry the server would refuse (or hide one it would allow).
    const currentAssignmentId = await storage.getCurrentAssignmentId(req.session.userId!, attempt.testId);
    const attemptFacts = userAttempts.map((a) => ({
      assignmentId: a.assignmentId,
      finishedAt: a.finishedAt,
      // PRD-40: outcome of THIS attempt, for barrier A's outcome-split cooldown.
      passed: (a.resultJson as AttemptResult | null)?.overallPassed ?? null,
    }));
    const completedAttempts = countAttemptsInAssignment(attemptFacts, currentAssignmentId);
    const maxAttempts = test?.maxAttempts || null;
    // PRD-31 (FR-10): a CLOSED barrier withdraws «Пройти ещё раз» here as well — the
    // start route would refuse the click anyway, and an offered button that bounces
    // reads as a broken screen. This is the same rule the package applies on its own
    // results screen (`viewResults.js` / `adaptiveRender.js` consult
    // `attemptIntervalState()`), and without it the web offered a retry the barriers
    // had already closed. Deliberately NOT folded into an "exhausted" state: a wait of
    // a few hours is not a terminal one.
    const retakeGate = decideRetake(test?.retakePolicyJson as RetakePolicy | null, {
      currentAssignmentId,
      attempts: attemptFacts,
      now: new Date(),
    });
    const canRetake = (maxAttempts === null || completedAttempts < maxAttempts) && retakeGate.allowed;
    // NB: the attempt counter is deliberately NOT put in the header subtitle any
    // more — the scene header carries the test's identity, not run parameters.

    // PRD-12 web-host: render payload (template layout + css + context) for the
    // results screen. Covers BOTH standard (results.html) and adaptive
    // (results.adaptive.html) — readResultsRenderPayload branches on result.mode.
    // Null only when the layout is missing or the result lacks topic rows, in which
    // case the client falls back to its React markup.
    const resultJson = attempt.resultJson as (AttemptResult & { mode?: string }) | null;
    let render = null;
    let report: ReportInput | AdaptiveReportInput | null = null;
    let reportRender: ReturnType<typeof readReportRenderPayload> = null;
    // PRD-35: измерения нужны не только экрану, но и ОТЧЁТУ, который собирается на
    // клиенте. Объявлены здесь, а не внутри ветки экрана, чтобы уехать в ответ.
    //
    // Уезжает НОРМАЛИЗОВАННЫЙ вид (`MeasuresInput`), а не сырьё, из которого экран его
    // получает: правила разрешения — рампа, виды отображения шкал и показателей — живут
    // в параметрах шаблона, которые есть только здесь. Клиент отдаёт это поле общему
    // сборщику отчёта как есть, и раньше сюда клалось сырьё (строки БД `scales` и
    // `variables`): у сборщика в нём не было `indicators`, и скачивание отчёта у теста
    // со шкалами или показателями падало.
    let measures: MeasuresInput | undefined;
    let postResultsPages: Awaited<ReturnType<typeof postResultsPagesForAttempt>> = [];
    if (resultJson && Array.isArray(resultJson.topicResults)) {
      const templateId = ((test?.designSettingsJson as any)?.templateId as string) || "default";
      // Learner-facing render: never serve a non-active template, and when the
      // active template declares no `results` contentTemplate, render the results
      // screen from `default` (same fallback as «Структура» / the preview).
      const dir = await resolveSystemScreenDir(templateId, "results", { activeOnly: true });
      // Branding/cssVars resolve against the ACTIVE template manifest even when the
      // results layout falls back to `default` (active template owns no `results`).
      const paramsDir = await resolveTemplateDir(templateId, { activeOnly: true });
      // Материал экрана итогов: шкалы/показатели (PRD-29) И обратная связь теста
      // (PRD-32). Собирается для ЛЮБОГО теста, в том числе без измерений: обратная связь
      // теста ему положена ровно так же, а решение «есть ли что показывать из измерений»
      // принимает `buildResultContext` — одно, в одном месте.
      //
      // АДАПТИВНЫЙ результат материал тоже берёт: раньше эта ветка получала `undefined`,
      // и вместе с измерениями (которых у адаптивного теста и нет) терялась обратная
      // связь ТЕСТА — источник блока рекомендаций, никакого отношения к режиму не
      // имеющий. Из материала адаптивная ветка читает только её (см. `readResultsRenderPayload`).
      const material = await resultsMaterialForAttempt(attempt, test);
      render = readResultsRenderPayload(
        dir,
        resultJson,
        test?.title || "",
        test?.designSettingsJson as any,
        paramsDir,
        undefined,
        material,
      );
      // File-level fallback (PRD-1 §4.3.2, PRD-3 NFR-06): a template that declares a
      // `results` variant but ships no results layout still renders — from the
      // standard template — instead of dropping to the legacy React markup.
      if (!render) {
        const fallbackDir = await resolveTemplateDir("default", { activeOnly: false });
        if (path.resolve(fallbackDir) !== path.resolve(dir)) {
          render = readResultsRenderPayload(
            fallbackDir,
            resultJson,
            test?.title || "",
            test?.designSettingsJson as any,
            paramsDir,
            undefined,
            material,
          );
        }
      }
      // В ОТВЕТ едут только настоящие измерения: по ним клиент печатает шкалы, показатели
      // и радар в отчёте, и пустой набор заставил бы его рисовать блок измерений у теста,
      // который их не объявляет. С issue #33 они едут ОБОИМ режимам: шкалу питают вклады,
      // навешенные на вопросы, а адаптивный тест задаёт вопросы, как любой другой —
      // значения по нему считались и уезжали в LMS ещё до этой работы, не доходя только
      // до экрана и до отчёта.
      //
      // Нормализуется ЗДЕСЬ, после разрешения макета: рампу и виды отображения задают
      // параметры того самого экрана (`render.params`) — ровно те, с которыми
      // `readResultsRenderPayload` только что собрал контекст итогов, — поэтому отчёт не
      // может разойтись с экраном, с которого его скачали. Макета нет вовсе (клиент
      // рисует свою разметку) — остаются значения по умолчанию из манифеста.
      measures =
        material && (material.scales.length > 0 || material.variables.length > 0)
          ? buildMeasuresInput(completeMeasuresSource(material, render?.params, resultJson))
          : undefined;
      // Footer state for the layout-drawn results row (the package fills the same
      // block). «Скачать отчёт» is on now that the web host produces the report from
      // the SHARED generator (shared/report/*) — the same PDF the package hands out,
      // unless the author switched the report off for this test (`report.enabled`).
      // Страницы «После теста» за «Итогами теста»: экран итогов ведёт к ним «Далее».
      // Только у обычного итога — адаптивный экран пакета их тоже не предлагает.
      if (resultJson.mode !== "adaptive") postResultsPages = await postResultsPagesForAttempt(attempt);
      if (render?.context && typeof render.context === "object") {
        const ctx = render.context as { result?: Record<string, unknown> };
        if (ctx.result) {
          ctx.result.nav = buildResultsNav({
            canReport: isReportEnabled(test?.reportSettingsJson as ReportSettings | null),
            canRetry: !resultJson?.overallPassed && canRetake,
            // Attempts alone — the adaptive footer re-runs the test rather than
            // offering a remedy, so a pass does not close it (see results-nav).
            canRetake,
            hasPostPages: postResultsPages.length > 0,
            finishLabel: "К списку тестов",
          });
        }
      }

      // Input for the shared PDF report the browser builds on demand. Assembled here
      // because the report needs the RAW per-topic numbers and the learner's name,
      // neither of which the presentational render context carries.
      const learner = await storage.getUser(req.session.userId!);
      const reportMeta = {
        learnerName: learner?.name || null,
        timestamp: (attempt.finishedAt ?? attempt.startedAt)?.toISOString() ?? null,
        attemptsCount: completedAttempts || 1,
      };
      // `material` уходит и сюда: консолидированный блок обратной связи отчёта собирает
      // ТОТ ЖЕ сборщик, что рисует экран, и ему нужны те же два факта, которых нет в
      // результате попытки, — обратная связь теста и наличие порога. Отчёт строит
      // браузер, поэтому они едут с ВХОДОМ отчёта, а не параметром сборки.
      //
      // Материал дополняется параметрами оформления ЭТОГО экрана (`render.params`, уже с
      // умолчаниями манифеста) — тем же правилом, что и измерения выше: окраску полос подтем
      // документ обязан взять ту же, что у экрана, с которого его скачали.
      const reportMaterial = material ? completeMeasuresSource(material, render?.params, resultJson) : material;
      report =
        resultJson.mode === "adaptive"
          ? buildAdaptiveReportInput(resultJson, test?.title || "", reportMeta, reportMaterial)
          : buildReportInput(resultJson, test?.title || "", reportMeta, reportMaterial);

      // PRD-27 Фаза 2: страницу отчёта рисует МАКЕТ шаблона. Активный шаблон, не
      // объявивший нужного вида, отчёта не лишает: макет берётся из «Стандартного», а
      // брендинг остаётся этого теста (FR-10) — то же правило, что у системных экранов.
      const reportKind = reportKindForMode(resultJson.mode);
      const activeDir = await resolveTemplateDir(templateId, { activeOnly: true });
      // PRD-27 FR-24: вариант и значения полей берутся из теста, КОТОРЫЙ ВЫДАВАЛСЯ.
      // Попытка, приколотая к снапшоту (PRD-15), обязана собрать отчёт тем макетом и
      // теми параметрами, что действовали на момент выдачи: иначе автор меняет вид
      // отчёта — и документы по старым попыткам задним числом становятся другими.
      // Живой тест остаётся источником всего остального (название, счётчик попыток).
      // Читается ОДНА строка снапшота, а не собирается целый источник данных: попытке
      // здесь нужен только выбор варианта, а сборка источника тянет весь замороженный
      // пул вопросов.
      const deliveredTest = attempt.snapshotId
        ? ((await storage.getSnapshot(attempt.snapshotId))?.contentJson as
            | { test?: Test }
            | undefined)?.test ?? test
        : test;
      // Выбор автора хранится по РЕЖИМУ теста (PRD-27 §4.1); его отсутствие означает
      // вариант с `isDefault`.
      const authoredReport =
        (deliveredTest?.reportSettingsJson as ReportSettings | null)?.[
          resultJson.mode === "adaptive" ? "adaptive" : "standard"
        ] ?? null;
      // PRD-49: словарь надписей документа. Общий слой — ЖИВЫЕ `design_settings_json` теста
      // (та же ветка, что несёт брендинг чуть выше), а не снапшот: слова экрана итогов и
      // отчёта берутся из одного места, а `deliveredTest` фиксирует только выбор ВАРИАНТА и
      // его поля (FR-24). Слой отчёта — общая настройка теста вне ветки режима, поэтому
      // читается с того же `deliveredTest`, откуда пришёл `authoredReport`.
      const reportLabelLayers: ReportLabelLayers = {
        values: (test?.designSettingsJson as DesignSettings | null)?.labels ?? null,
        overrides: (deliveredTest?.reportSettingsJson as ReportSettings | null)?.labels ?? null,
      };
      // PRD-51 §5.3: документ отчёта для ВЕБ-выдачи. Строки берутся из того же источника,
      // что и остальная выдача попытки: у попытки, прикреплённой к снапшоту, — из него.
      // Иначе слушатель, скачавший документ спустя месяц, получил бы состав, собранный
      // автором уже после его попытки.
      const documentMode = resultJson.mode === "adaptive" ? "adaptive" : "standard";
      const snapshotRows = attempt.snapshotId
        ? ((await storage.getSnapshot(attempt.snapshotId))?.contentJson as
            | { reportBlocks?: Array<Record<string, unknown>> }
            | undefined)?.reportBlocks
        : undefined;
      const rawRows =
        snapshotRows ?? (await storage.listReportBlocks(attempt.testId, documentMode));
      const documentRows = (rawRows as Array<Record<string, unknown>>)
        .filter((r) => !r.mode || r.mode === documentMode)
        .map((r) => ({
          block: String(r.block ?? ""),
          sortOrder: Number(r.sortOrder ?? 0),
          enabled: r.enabled !== false,
          templateKey: typeof r.templateKey === "string" ? r.templateKey : null,
          valuesJson: (r.valuesJson ?? {}) as Record<string, unknown>,
          settingsJson: (r.settingsJson ?? {}) as Record<string, unknown>,
        }))
        .filter((r) => r.block.length > 0);
      reportRender = readReportRenderPayload(
        activeDir,
        reportKind,
        authoredReport,
        test?.designSettingsJson as any,
        activeDir,
        templateId,
        reportLabelLayers,
        documentRows,
      );
      if (!reportRender) {
        const fallbackDir = await resolveTemplateDir("default", { activeOnly: false });
        if (path.resolve(fallbackDir) !== path.resolve(activeDir)) {
          // Деградация на «Стандартный»: выбранного варианта там нет, поэтому берётся
          // его `isDefault`, а значения полей чужого варианта не переносятся. Картинки
          // приезжают оттуда же, откуда макет, — из «Стандартного» (FR-05).
          reportRender = readReportRenderPayload(
            fallbackDir,
            reportKind,
            null,
            test?.designSettingsJson as any,
            activeDir,
            "default",
            reportLabelLayers,
            documentRows,
          );
        }
      }
    }

    res.json({
      ...attempt,
      testTitle: test?.title || "Unknown Test",
      // PRD-34 (FR-16): экран итогов несёт водяной знак, хотя от копирования по FR-09
      // не защищается. Настройка нужна клиенту здесь, а не только на старте попытки.
      protectionWatermark: test?.protectionWatermark ?? false,
      result: attempt.resultJson as AttemptResult,
      canRetake,
      render,
      report,
      reportRender,
      // PRD-35: те же измерения, что у экрана. Клиент печатает по ним шкалы и радар
      // в отчёте; включает ли он диаграмму — решает СВОЙ переключатель варианта
      // отчёта, который лежит в `reportRender.values`.
      measures,
      // Страницы «После теста» за «Итогами теста»: «Далее» экрана итогов ведёт к ним.
      postResultsPages,
      attemptsInfo:
        maxAttempts !== null
          ? {
              completed: completedAttempts,
              max: maxAttempts,
            }
          : null,
    });
  } catch (error) {
    logger.error("Get result error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch result" });
  }
});

// GET /api/learner/attempts - История попыток ученика
router.get("/learner/attempts", requirePermission("attempts.self.read"), async (req, res) => {
  try {
    const attempts = await storage.getAttemptsByUser(req.session.userId!);
    const tests = await storage.getTests();
    const testMap = new Map(tests.map((t) => [t.id, t]));

    const completedAttempts = attempts
      .filter((a) => a.finishedAt !== null)
      .sort((a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime());

    const groupedByTest: Record<string, {
      testId: string;
      testTitle: string;
      currentVersion: number;
      attempts: any[];
    }> = {};

    for (const attempt of completedAttempts) {
      const test = testMap.get(attempt.testId);
      const result = attempt.resultJson as AttemptResult | null;

      if (!groupedByTest[attempt.testId]) {
        groupedByTest[attempt.testId] = {
          testId: attempt.testId,
          testTitle: test?.title || "Unknown Test",
          currentVersion: test?.version || 1,
          attempts: [],
        };
      }

      const isAdaptive = (result as any)?.mode === "adaptive";
      const adaptiveResult = isAdaptive ? (result as any) : null;
      const achievedCount = adaptiveResult
        ? adaptiveResult.topicResults.filter((tr: any) => tr.achievedLevelIndex !== null).length
        : null;
      const totalTopics = adaptiveResult ? adaptiveResult.topicResults.length : null;

      groupedByTest[attempt.testId].attempts.push({
        id: attempt.id,
        testVersion: attempt.testVersion,
        finishedAt: attempt.finishedAt,
        overallPercent: result?.overallPercent || 0,
        overallPassed: result?.overallPassed || false,
        totalEarnedPoints: result?.totalEarnedPoints || 0,
        totalPossiblePoints: result?.totalPossiblePoints || 0,
        isAdaptive,
        achievedCount,
        totalTopics,
      });
    }

    const testGroups = Object.values(groupedByTest).map((group) => {
      const attemptsWithComparison = group.attempts.map((attempt, index) => {
        const prevAttempt = group.attempts[index + 1];
        const delta = prevAttempt ? attempt.overallPercent - prevAttempt.overallPercent : null;
        const isOutdated = attempt.testVersion < group.currentVersion;

        return { ...attempt, delta, isOutdated };
      });

      const latestAttempt = group.attempts[0];
      const firstAttempt = group.attempts[group.attempts.length - 1];
      const overallImprovement =
        group.attempts.length > 1 ? latestAttempt.overallPercent - firstAttempt.overallPercent : null;

      return {
        testId: group.testId,
        testTitle: group.testTitle,
        currentVersion: group.currentVersion,
        attemptCount: group.attempts.length,
        overallImprovement,
        attempts: attemptsWithComparison,
      };
    });

    res.json(testGroups);
  } catch (error) {
    logger.error("Fetch learner attempts error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch attempt history" });
  }
});

// ===== Helper Functions =====

/**
 * PRD-55 / PRD-56 FR-20: записать выдачу вопроса адаптивного прогона.
 *
 * У адаптива нет состава, зафиксированного на старте: уровень решает, какой вопрос будет
 * следующим, и большая часть вопросов уровня так и не показывается. Поэтому выдачей здесь
 * считается ПОКАЗ — первый вопрос на старте и каждый следующий, отданный в ответе. Вопрос
 * показывается один раз за прогон, так что пара «попытка × задание» и здесь даёт одну выдачу
 * (FR-03). Сбой счётчика не роняет прохождение — как и у обычного старта.
 *
 * @param questionId показанный вопрос
 * @param testId тест прогона
 */
async function recordAdaptiveDelivery(questionId: string, testId: string): Promise<void> {
  try {
    await storage.recordDeliveries([questionId], testId, new Date());
  } catch (error) {
    logger.warn("PRD-55: выдача адаптивного вопроса не записана — " + (error as Error).message);
  }
}

async function getNextQuestionData(level: any, topic: any, questionIndex: number, storage: any) {
  const questionId = level.questionIds[questionIndex];
  if (!questionId) return null;

  const questions = await storage.getQuestionsByIds([questionId]);
  if (!questions[0]) return null;

  return {
    id: questionId,
    question: questions[0],
    topicName: topic.topicName,
    topicId: topic.topicId,
    // PRD-4 v1.1 §3.2: carry the topic's time budget so the runtime can run a
    // per-topic timer for the topic that owns this question.
    sectionTimeLimitMinutes: topic.timeLimitMinutes ?? null,
    levelName: level.levelName,
    questionNumber: questionIndex + 1,
    totalInLevel: level.questionIds.length,
  };
}

/**
 * Build the question-data payload for the variant's CURRENT position (the
 * `currentQuestionId` within the current topic/level). Used by the idempotent
 * branch of expire-topic-adaptive to re-sync a client after a lost response.
 */
async function currentAdaptiveQuestion(variant: any, storage: any) {
  const topic = variant.topics?.[variant.currentTopicIndex];
  if (!topic) return null;
  const level = topic.levelsState[topic.currentLevelIndex];
  const idx = level.questionIds.indexOf(variant.currentQuestionId);
  return getNextQuestionData(level, topic, idx >= 0 ? idx : 0, storage);
}

async function moveToNextTopicOrFinish(variant: any, currentTopic: any, currentLevel: any, storage: any) {
  currentTopic.status = "completed";

  const levelTransition = {
    type: "complete",
    fromLevel: currentLevel.levelName,
    toLevel: null,
    message:
      currentTopic.finalLevelIndex !== null
        ? `Тема завершена. Достигнутый уровень: "${currentTopic.levelsState[currentTopic.finalLevelIndex].levelName}"`
        : `К сожалению, уровень "${currentLevel.levelName}" не пройден.`,
  };

  const nextTopicIndex = variant.currentTopicIndex + 1;
  if (nextTopicIndex < variant.topics.length) {
    const topicTransition = {
      fromTopic: currentTopic.topicName,
      toTopic: variant.topics[nextTopicIndex].topicName,
    };

    variant.currentTopicIndex = nextTopicIndex;
    const nextTopic = variant.topics[nextTopicIndex];
    const startLevel = nextTopic.levelsState[nextTopic.currentLevelIndex];
    startLevel.status = "in_progress";

    variant.currentQuestionId = startLevel.questionIds[0];
    const nextQuestionData = await getNextQuestionData(startLevel, nextTopic, 0, storage);

    return { levelTransition, topicTransition, nextQuestionData, isFinished: false };
  }

  variant.currentQuestionId = null;
  return { levelTransition, topicTransition: null, nextQuestionData: null, isFinished: true };
}

// PRD-18 «ВСЕ РАСЧЕТЫ ПО ЕДИНОМУ АЛГОРИТМУ»: thin host adapter over the shared
// `aggregateAdaptiveResult`. This side's only job is to normalize DB-backed data
// (per-level feedback + links from separate tables, topic failure feedback) into
// the engine's input. `levels` is sorted by `levelIndex` ascending — the SAME order
// `levelsState` was built in — so the engine's POSITIONAL `finalLevelIndex` lookup
// aligns. `failureLinks` mirrors the SCORM failure branch (lowest level's links).
//
// issue #33: it also computes the graded namespaces — scales (PRD-5) and result
// variables (PRD-2) — and stores them WITH the attempt, exactly as the standard
// `/finish` does. A scale is fed by the measurements an author hung on questions, and
// an adaptive test asks questions like any other; the package had been computing them
// for an adaptive run all along (and shipping them to the LMS), while the web computed
// nothing at all, so the adaptive results screen had nothing to show even after the
// layout learned to show it.
//
// @param answers The attempt's answers — the ONE input the values depend on besides the
//   test's own configuration. Values are computed ONCE, here, and never recomputed on
//   read: regrading a finished attempt against today's interpretation would change what
//   the learner already scored (PRD-29, the same rule the standard mode follows).
async function buildAdaptiveResult(
  variant: any,
  testId: string,
  storage: any,
  answers: Record<string, unknown> = {},
) {
  const adaptiveSettings = await storage.getAdaptiveTopicSettingsByTest(testId);
  const adaptiveLevels = await storage.getAdaptiveLevelsByTest(testId);
  // Sections of THIS test: the section over a topic is the second authoring point of
  // the topic's feedback, exactly as in the standard mode (`/finish`). An adaptive test
  // has sections too — the start route already reads them for the per-topic timer and
  // the delivery order.
  const sections = (await storage.getTestSections(testId)) ?? [];

  const topics = await Promise.all(
    variant.topics.map(async (topic: any) => {
      const topicSettings = adaptiveSettings.find((s: any) => s.topicId === topic.topicId);
      const section = sections.find((s: any) => s.topicId === topic.topicId);
      // The topic row itself — read through the SAME source the attempt is delivered
      // from, so an attempt pinned to a snapshot (PRD-15 block B) hands out the texts
      // and files that were published with it.
      const topicRow = await storage.getTopic(topic.topicId);
      const topicLevels = adaptiveLevels
        .filter((l: any) => l.topicId === topic.topicId)
        .sort((a: any, b: any) => a.levelIndex - b.levelIndex);

      const levels = await Promise.all(
        topicLevels.map(async (l: any) => ({
          levelName: l.levelName,
          feedback: l.feedback ?? null,
          links: ((await storage.getAdaptiveLevelLinks(l.id)) || []).map((x: any) => ({ title: x.title, url: x.url })),
        })),
      );

      const levelsState = (topic.levelsState as any[]).map((ls) => ({
        levelIndex: ls.levelIndex,
        levelName: ls.levelName,
        status: ls.status,
        answeredCount: ls.answeredQuestionIds.length,
        correctCount: ls.correctCount,
      }));

      return {
        topicId: topic.topicId,
        topicName: topic.topicName,
        finalLevelIndex: topic.finalLevelIndex,
        levelsState,
        levels,
        failureFeedback: topicSettings?.failureFeedback || null,
        failureLinks: levels[0]?.links ?? [],
        // What the author wrote and attached for this topic, gathered through the SAME
        // two shared rules the standard `/finish` runs — source priority, the
        // topic-before-section order and the address rule included. The engine echoes
        // `extra` verbatim, so it lands on the stored topic result below.
        extra: {
          feedbackTexts: topicFeedbackTexts(topicRow, section?.feedbackJson),
          recommendedAssets: feedbackAssets(topicRow?.feedbackJson, section?.feedbackJson).map(
            (a) => ({ title: a.title, url: a.url ?? "" }),
          ),
        },
      };
    }),
  );

  const aggregated = aggregateAdaptiveResult<{
    feedbackTexts: string[];
    recommendedAssets: { title: string; url: string }[];
  }>({ topics });

  // PRD-50 FR-17: выданные элементы адаптивного прогона — каждый вопрос, который лестница
  // действительно задала, отнесённый к теме, которая его задала. Читаются БЕЗУСЛОВНО, а не
  // только под шкалы: записи сохраняются вместе с попыткой (FR-39), а экран итогов рисуется
  // из сохранённого результата.
  const answeredIds = Object.keys(answers);
  const answeredQuestions = answeredIds.length > 0 ? await storage.getQuestionsByIds(answeredIds) : [];
  const questionById = new Map<string, any>(answeredQuestions.map((q: any) => [q.id, q]));
  // PRD-15 block D: тем же разрешением цены/ступеней, что и стандартная выдача, — иначе
  // «верно» здесь и «верно» в счётчике уровня разошлись бы на ступенчатом вопросе.
  const adaptiveScoring = await loadTestScoringContext(testId, storage);
  const breakdownItems: BreakdownItem[] = [];
  for (const topic of variant.topics as any[]) {
    for (const level of topic.levelsState as any[]) {
      for (const qId of level.answeredQuestionIds as string[]) {
        const q = questionById.get(qId);
        if (!q || !Array.isArray(q.tags) || q.tags.length === 0) continue;
        // Цена вопроса в адаптиве равна единице — тот же пересказ, что делает
        // `adaptiveResultAsStandard` для итогов (earnedPoints = correct), и тот же
        // двоичный признак, каким лестница наращивает `correctCount`.
        const correct = checkAnswer(q, (answers as Record<string, unknown>)[qId], adaptiveScoring.resolve(q).scoring) === 1;
        breakdownItems.push({
          sectionId: topic.topicId,
          axisKeys: { tag: q.tags },
          earned: correct ? 1 : 0,
          possible: 1,
          answered: true,
        });
      }
    }
  }
  // PRD-50 §16: общее правило прохождения теста — ЕДИНСТВЕННЫЙ порог, которым адаптив может
  // судить подтемы: у ступени лестницы своего порога нет. Тот же столбец, что читает
  // стандартная ветка (`tests.overall_pass_rule_json`); нет правила — подтемы молчат.
  const adaptiveTest = await storage.getTest(testId);
  const flat = adaptiveResultAsStandard(
    aggregated,
    breakdownItems,
    adaptiveTest?.overallPassRuleJson ?? null,
  );
  const breakdownByTopic = new Map(flat.topicResults.map((t) => [t.topicId, t.breakdown]));

  // issue #33: scales and indicators of THIS attempt, through the SAME shared engines the
  // standard `/finish` runs. No-op for a test that declares neither — an adaptive result
  // then keeps exactly the shape it has always had, and attempts finished before this
  // work stay valid (both fields are optional in `adaptiveAttemptResultSchema`).
  const scoringConfig = await loadScoringConfig(testId, storage);
  let scaleResults: Record<string, unknown> | undefined;
  let resultVariables: Record<string, unknown> | undefined;
  if (scoringConfig.scales.length > 0 || scoringConfig.resultVariables.length > 0) {
    // Types of the questions actually ANSWERED: the scale engine needs them to decide
    // which measurement units fired, and it bounds `percent` normalization by the
    // DELIVERED set — which in the adaptive mode is precisely what the ladder asked.
    // The rows themselves are the ones already read above for the breakdown items.
    const questionTypes: Record<string, QuestionType> = {};
    for (const q of answeredQuestions) questionTypes[q.id] = q.type as QuestionType;
    // The formulas of PRD-2 speak percent / score / topicById(...).passed — words the
    // level ladder does not have. The shared restatement gives them those words, and it
    // is the very one the package feeds them through (`getAdaptiveResultForScorm`) — see
    // `flat` above, computed once with the breakdown items.
    const topicCodeById = new Map(
      ((await storage.getTopics()) as Array<{ id: string; code?: string | null }>).map(
        (t) => [t.id, t.code ?? null] as const,
      ),
    );
    const computation = computeAttemptResult(scoringConfig, answers as Record<string, Answer>, questionTypes, {
      percent: flat.percent,
      topicResults: flat.topicResults.map((t) => ({ ...t, code: topicCodeById.get(t.topicId) ?? null })),
      // PRD-50 FR-35/FR-36: обе области одним массивом, как в стандартной ветке.
      breakdowns: [...flat.breakdowns, ...flat.topicResults.flatMap((t) => t.breakdown)],
    });
    if (Object.keys(computation.scaleResults).length > 0) scaleResults = computation.scaleResults;
    if (Object.keys(computation.resultVariables).length > 0) resultVariables = computation.resultVariables;
    // `controls_status` is deliberately NOT applied here, unlike in the standard mode.
    // An adaptive verdict is pronounced by the LADDER — `overallPassed` means «every
    // topic confirmed a level» — and letting a formula overwrite it would make the
    // level tags on the screen and the verdict above them state opposite things.
  }

  // Hoist the passthrough onto the topic result itself: `adaptiveTopicResultSchema`
  // spells these two out (and the shared results builder reads them by those names), so
  // an `extra` envelope would only be a second spelling of the same fact.
  return {
    ...aggregated,
    topicResults: aggregated.topicResults.map(({ extra, ...t }) => ({
      ...t,
      feedbackTexts: extra?.feedbackTexts ?? [],
      recommendedAssets: extra?.recommendedAssets ?? [],
      // PRD-50 FR-17/FR-39: записи области этой темы — тем же путём, каким сюда попадают
      // тексты и вложения: они едут ВМЕСТЕ с попыткой, потому что экран рисуется из
      // сохранённого результата.
      breakdown: breakdownByTopic.get(t.topicId) ?? [],
    })),
    ...(scaleResults ? { scaleResults } : {}),
    ...(resultVariables ? { resultVariables } : {}),
    ...(flat.breakdowns.length ? { breakdowns: flat.breakdowns } : {}),
  };
}

export default router;