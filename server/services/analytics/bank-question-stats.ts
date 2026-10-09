/**
 * @module server/services/analytics/bank-question-stats
 * @description PRD-70 FR-10 - FR-12: статистика вопроса банка — строка на каждый тест читателя,
 * где вопрос выдавался, и версии содержания вопроса.
 *
 * Числа каждой строки — по выборке и правилам оценки СВОЕГО теста: разбор вопроса строится тем
 * же движком, что карточка «вопрос в тесте» (`computeItemBreakdown`), на ответах из общего кэша
 * расчёта теста (FR-02). Итоговой строки и средних по тестам нет (К1, FR-12).
 *
 * Выдача, доля и признак берутся из фонового пересчёта — теми же числами, что в дереве банка:
 * страница и дерево не должны расходиться.
 */
import { config } from "../../config";
import { storage } from "../../storage";
import type { QuestionFlag } from "@shared/psychometrics/question-flag";
import { loadTestScoringContext } from "../effective-scoring";
import { computeItemBreakdown, type ItemBreakdown } from "./psychometrics";
import type { DrawMode, TestQuality } from "./question-quality";
import { exposureWindowStart } from "./review-inputs";
import { variantQuestionIds } from "./test-answer-facts";
import { correctIndexesOf, cutRatioOf, testPsychometrics } from "./test-psychometrics";

/** Мёртвый вариант ответа: его не выбирает почти никто. */
export interface DeadOption {
  label: string;
  chosen: number;
  of: number;
}

/** Строка «По тестам»: вопрос в одном тесте. */
export interface BankQuestionTestRow {
  testId: string;
  title: string;
  /** Выдан за окно счётчика. */
  delivered: number;
  drawMode: DrawMode | null;
  sharePercent: number | null;
  expectedPercent: number | null;
  /** Наблюдений выбранной редакции. */
  observations: number;
  difficulty: number | null;
  difficultyConfidence: string;
  /** Корреляция вопрос-остаток (дискриминативность). */
  itemRest: number | null;
  coefficientConfidence: string;
  /** Сложность, заданная в этом тесте (переопределение или банк); `null` — не задана. */
  declared: number | null;
  /** Наблюдаемая сложность в шкале редактора; `null` — данных мало. */
  hardness: number | null;
  /** Доля пропусков среди выдач в веб-попытках; `null` — веб-выдач нет. */
  skipShare: number | null;
  latencyMedianMs: number | null;
  /** Признак «под подозрением» (по всей выборке теста, как в таблице теста); `null` — нет. */
  flag: QuestionFlag | null;
  deadOptions: DeadOption[];
}

/** Версия содержания вопроса по всем его тестам читателя. */
export interface BankQuestionVersion {
  psychoHash: string | null;
  firstAt: string;
  lastAt: string;
  tests: number;
  observations: number;
  current: boolean;
}

export interface BankQuestionStats {
  question: {
    id: string;
    prompt: string;
    type: string;
    topicId: string;
    topicName: string;
    tags: string[];
  };
  /** Редакция, по которой посчитаны строки; `undefined` — редакция одна, считается всё. */
  selectedVersion?: string | null;
  rows: BankQuestionTestRow[];
  versions: BankQuestionVersion[];
  minObservations: number;
}

/** Выбрать редакцию: запрошенную, иначе текущую, иначе самую позднюю; одна — не выбирать. */
function chooseVersion(
  versions: readonly BankQuestionVersion[],
  requested: string | null | undefined,
  currentHash: string | null,
): string | null | undefined {
  if (requested !== undefined) return requested;
  if (versions.length <= 1) return undefined;
  if (versions.some(v => v.psychoHash === currentHash)) return currentHash;
  return [...versions].sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0].psychoHash;
}

/**
 * Статистика вопроса банка.
 *
 * @param questionId вопрос
 * @param qualities качество тестов из фонового пересчёта
 * @param inScope доступен ли тест читателю
 * @param requested редакция из адреса: строка — отпечаток, `null` — «версия неизвестна»,
 *   `undefined` — по умолчанию (текущая)
 * @returns статистика; `null` — вопроса нет
 */
export async function bankQuestionStats(
  questionId: string,
  qualities: readonly TestQuality[],
  inScope: (testId: string) => boolean,
  requested?: string | null,
): Promise<BankQuestionStats | null> {
  const [question] = await storage.getQuestionsByIds([questionId]);
  if (!question) return null;
  const topics = await storage.getTopics();
  const minObservations = config.analytics.minObservations;
  const windowStart = exposureWindowStart();

  // Тесты читателя, где вопрос выдавался (за окно или есть наблюдения).
  const entries = qualities
    .filter(q => inScope(q.testId))
    .map(q => ({ quality: q, item: q.items.find(i => i.questionId === questionId) }))
    .filter((e): e is { quality: TestQuality; item: NonNullable<typeof e.item> } =>
      !!e.item && (e.item.delivered > 0 || e.item.observations > 0));

  const loaded = [];
  for (const { quality, item } of entries) {
    const test = await storage.getTest(quality.testId);
    if (!test) continue;
    const core = await testPsychometrics(test, { testIds: [test.id] }, "first");
    const ctx = { questionById: core.questionById, minObservations, cutRatio: cutRatioOf(test.overallPassRuleJson) };
    const all = computeItemBreakdown(core.responses, ctx, questionId, correctIndexesOf(question.correctJson), undefined);
    loaded.push({ test, item, core, ctx, all });
  }

  // Версии содержания — свойство вопроса: сводятся по тестам (FR-43).
  const byHash = new Map<string, BankQuestionVersion>();
  for (const { all } of loaded) {
    for (const version of all?.versions ?? []) {
      const key = version.psychoHash ?? "";
      const known = byHash.get(key);
      if (!known) {
        byHash.set(key, {
          psychoHash: version.psychoHash,
          firstAt: version.firstAt,
          lastAt: version.lastAt,
          tests: 1,
          observations: version.observations,
          current: version.psychoHash === (question.psychoHash ?? null),
        });
      } else {
        known.tests += 1;
        known.observations += version.observations;
        if (version.firstAt < known.firstAt) known.firstAt = version.firstAt;
        if (version.lastAt > known.lastAt) known.lastAt = version.lastAt;
      }
    }
  }
  const versions = [...byHash.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const selected = chooseVersion(versions, requested, question.psychoHash ?? null);

  const rows: BankQuestionTestRow[] = [];
  for (const { test, item, core, ctx, all } of loaded) {
    const breakdown: ItemBreakdown | null = selected === undefined
      ? all
      : computeItemBreakdown(core.responses, ctx, questionId, correctIndexesOf(question.correctJson), selected);
    const psycho = breakdown?.item;
    const [scoring, attempts, latency] = await Promise.all([
      loadTestScoringContext(test.id, storage),
      storage.getAttemptsByTests([test.id]),
      storage.getLatencyStats([questionId], test.id, windowStart),
    ]);
    let delivered = 0;
    let skipped = 0;
    for (const attempt of attempts) {
      if (attempt.resultJson === null || !variantQuestionIds(attempt.variantJson).includes(questionId)) continue;
      delivered += 1;
      if (!(questionId in ((attempt.answersJson ?? {}) as Record<string, unknown>))) skipped += 1;
    }
    const fewForDifficulty = !psycho || psycho.difficulty === null || psycho.difficultyConfidence === "insufficient";
    rows.push({
      testId: test.id,
      title: test.title,
      delivered: item.delivered,
      drawMode: item.drawMode,
      sharePercent: item.sharePercent,
      expectedPercent: item.expectedPercent,
      observations: psycho?.observations ?? 0,
      difficulty: psycho?.difficulty ?? null,
      difficultyConfidence: psycho?.difficultyConfidence ?? "insufficient",
      itemRest: psycho?.itemRest ?? null,
      coefficientConfidence: psycho?.coefficientConfidence ?? "insufficient",
      declared: scoring.difficultyOf(question),
      hardness: fewForDifficulty ? null : Math.round((1 - (psycho.difficulty as number)) * 100),
      skipShare: delivered > 0 ? (skipped / delivered) * 100 : null,
      // Время — из разбора вопроса (ответы выборки, как плитка «Время, медиана» на странице вопроса
      // в тесте); счётчик телеметрии — запасной источник, когда разбор времени не знает.
      latencyMedianMs: psycho?.timing?.medianMs ?? latency.get(questionId)?.medianMs ?? null,
      flag: item.suspicious ? item.flag : null,
      deadOptions: (breakdown?.options ?? [])
        .filter(option => option.dead)
        .map(option => ({
          label: option.label,
          chosen: Math.round(option.share * (psycho?.observations ?? 0)),
          of: psycho?.observations ?? 0,
        })),
    });
  }
  // Порядок — по числу выдач: где вопрос живёт чаще, там и смотреть первым.
  rows.sort((a, b) => b.delivered - a.delivered);

  return {
    question: {
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      topicId: question.topicId,
      topicName: topics.find(topic => topic.id === question.topicId)?.name ?? "",
      tags: Array.isArray(question.tags) ? question.tags : [],
    },
    ...(selected !== undefined ? { selectedVersion: selected } : {}),
    rows,
    versions,
    minObservations,
  };
}
