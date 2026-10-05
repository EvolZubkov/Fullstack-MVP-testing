/**
 * @module server/services/analytics/question-quality
 * @description PRD-70 FR-03, FR-04: качество вопросов ОДНОГО теста — сырьё оси банка вопросов.
 *
 * Психометрику нельзя считать по банку целиком: оценщик привязан к цене и правилам теста, а
 * дискриминативность — к сумме баллов внутри его выборки. Поэтому ось банка — это расчёты «по
 * тесту», выложенные рядом (решение К1): здесь считается один тест, а сводит их по вопросу тот,
 * кто читает готовое (`question-bank-quality.ts`).
 *
 * По каждому вопросу теста — признак правилом `question-flag` с эвристиками ревизии (FR-03),
 * наблюдаемая сложность в шкале редактора, выдачи за окно счётчика и переэкспонированность
 * (§3.2). Плюс пул выдачи теста: «не выдавался» (§3.3) судится по нему.
 */
import { config } from "../../config";
import { storage } from "../../storage";
import { expectedExposure } from "@shared/draw/expected-exposure";
import {
  isSuspicious,
  isThin,
  questionFlag,
  suspicionRank,
  type QuestionFlag,
  type ReviewHeuristic,
} from "@shared/psychometrics/question-flag";
import { loadDeliveryPool } from "../delivery-pool";
import { loadObservations } from "./observations";
import { exposureWindowStart, reviewHeuristicsOfTest } from "./review-inputs";
import { testPsychometrics } from "./test-psychometrics";

/** Сколько прохождений за окно нужно, чтобы доля выдачи что-то утверждала (§3.2). */
export const OVEREXPOSURE_MIN_ATTEMPTS = 10;

/** Переэкспонированность вопроса в тесте: доля прохождений с ним и ожидаемая доля. */
export interface Overexposure {
  sharePercent: number;
  expectedPercent: number;
}

/** Вопрос в одном тесте — как его видит ось банка. */
export interface QuestionInTest {
  questionId: string;
  /** Признак правилом `question-flag`; `null` — ничего не сошлось. */
  flag: QuestionFlag | null;
  /** «Под подозрением»: признак есть, и это не «мало данных». */
  suspicious: boolean;
  /** Порядок признака (FR-48): меньше — важнее. */
  rank: number;
  /** Данных хватает для суждения: не «мало данных» и вопрос выдавался. */
  enoughData: boolean;
  /** Наблюдений в психометрике теста. */
  observations: number;
  /** Наблюдаемая сложность в шкале редактора 0–100; `null` — данных мало. */
  hardness: number | null;
  /** Выдач в этом тесте за окно счётчика. */
  delivered: number;
  /** Переэкспонирован ли (§3.2); `null` — нет или признак к разделу неприменим. */
  overexposure: Overexposure | null;
}

/** Качество вопросов одного теста. */
export interface TestQuality {
  testId: string;
  items: QuestionInTest[];
  /** Пул выдачи теста: вопросы, которые тест сейчас может выдать. */
  pool: string[];
  /** Сколько вопросов под подозрением — для карточки «Тесты с вопросами под подозрением». */
  suspicious: number;
  /** Сколько вопросов в расчёте — «8 из 42». */
  itemCount: number;
}

/** Множитель переэкспонированности из конфига; в заглушках конфига его может не быть. */
function overexposureRatio(): number {
  return config.analytics.overexposureRatio ?? 1.5;
}

/**
 * Переэкспонированность вопросов разделов со случайной выборкой (§3.2).
 *
 * Раздел «весь банк», варианты и адаптив признака не дают: ожидаемой доли там нет (решение
 * владельца О1 — адаптиву он не нужен).
 */
function overexposureOf(
  mode: string | null | undefined,
  sections: Awaited<ReturnType<typeof loadDeliveryPool>>["sections"],
  delivered: ReadonlyMap<string, number>,
  attemptsInWindow: number,
): Map<string, Overexposure> {
  const result = new Map<string, Overexposure>();
  if (mode === "adaptive" || attemptsInWindow < OVEREXPOSURE_MIN_ATTEMPTS) return result;
  for (const { section, pool } of sections) {
    const hasForms = (section.formSetJson?.forms?.length ?? 0) > 0;
    if (hasForms || section.drawAll || !section.drawCount) continue;
    const expected = expectedExposure({ drawCount: section.drawCount, poolSize: pool.length });
    if (!expected) continue;
    for (const question of pool) {
      const count = delivered.get(question.id) ?? 0;
      const sharePercent = (count / attemptsInWindow) * 100;
      if (sharePercent >= overexposureRatio() * expected.percent) {
        result.set(question.id, { sharePercent, expectedPercent: expected.percent });
      }
    }
  }
  return result;
}

/**
 * Посчитать качество вопросов теста.
 *
 * Выборка психометрики — та, что у «Качества вопросов» без условий: весь тест, только первая
 * попытка участника (FR-51), и тем же кэшем (FR-02). Эвристики — по всем завершённым
 * прохождениям, как у таблицы теста без условий.
 *
 * @param testId тест
 * @returns качество; `null` — теста нет
 */
export async function evaluateTestQuality(testId: string): Promise<TestQuality | null> {
  const test = await storage.getTest(testId);
  if (!test) return null;

  const [{ psychometrics }, heuristics, pool] = await Promise.all([
    testPsychometrics(test, { testIds: [testId] }, true),
    reviewHeuristicsOfTest(testId),
    loadDeliveryPool(testId),
  ]);

  const windowStart = exposureWindowStart();
  const { rows: passages } = await loadObservations({ testIds: [testId] }, { all: true, ids: new Set([testId]) });
  const attemptsInWindow = passages.filter(o => o.startedAt >= windowStart).length;
  const questionIds = [...new Set([...pool.questionIds, ...psychometrics.items.map(i => i.questionId)])];
  let delivered = new Map<string, number>();
  if (questionIds.length > 0) {
    delivered = await storage.getDeliveryCountsForTest(questionIds, testId, windowStart);
  }
  const overexposed = overexposureOf(test.mode, pool.sections, delivered, attemptsInWindow);

  const items: QuestionInTest[] = psychometrics.items.map(item => {
    const heuristic: ReviewHeuristic | undefined = heuristics.get(item.questionId);
    const fewForDifficulty = item.difficulty === null || item.difficultyConfidence === "insufficient";
    return {
      questionId: item.questionId,
      flag: questionFlag(item, heuristic),
      suspicious: isSuspicious(item, heuristic),
      rank: suspicionRank(item, heuristic),
      enoughData: !isThin(item),
      observations: item.observations,
      // То же преобразование, что у колонки «Сложность: задана → по ответам».
      hardness: fewForDifficulty ? null : Math.round((1 - (item.difficulty as number)) * 100),
      delivered: delivered.get(item.questionId) ?? 0,
      overexposure: overexposed.get(item.questionId) ?? null,
    };
  });

  return {
    testId,
    items,
    pool: pool.questionIds,
    suspicious: items.filter(item => item.suspicious).length,
    itemCount: items.length,
  };
}
