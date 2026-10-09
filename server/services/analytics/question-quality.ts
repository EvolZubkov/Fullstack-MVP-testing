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

/** Способ выдачи раздела — как во вкладке «Выдача» (`ExposureDrawMode`). */
export type DrawMode = "quota" | "all" | "forms" | "adaptive";

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
  /** Как раздел выдаёт вопрос; `null` — вопроса нет в пуле теста (выдавался раньше). */
  drawMode: DrawMode | null;
  /** Доля прохождений за окно, где вопрос выдан; `null` — прохождений за окно не было. */
  sharePercent: number | null;
  /** Ожидаемая доля (квота / пул); `null` — у раздела её нет: весь банк, варианты, адаптив. */
  expectedPercent: number | null;
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

/** Как вопрос выдаётся в тесте и с какой долей. */
interface ExposureOfQuestion {
  drawMode: DrawMode;
  sharePercent: number | null;
  expectedPercent: number | null;
  overexposure: Overexposure | null;
}

/**
 * Экспозиция вопросов теста по разделам: способ выдачи, доля прохождений с вопросом, ожидаемая
 * доля и переэкспонированность (§3.2).
 *
 * Ожидаемая доля есть только у раздела со случайной выборкой (квота / размер пула); «весь банк»,
 * варианты и адаптив признака не дают — ожидаемой доли там нет (решение владельца О1).
 */
function exposureOf(
  mode: string | null | undefined,
  sections: Awaited<ReturnType<typeof loadDeliveryPool>>["sections"],
  delivered: ReadonlyMap<string, number>,
  attemptsInWindow: number,
): Map<string, ExposureOfQuestion> {
  const result = new Map<string, ExposureOfQuestion>();
  for (const { section, pool } of sections) {
    const hasForms = (section.formSetJson?.forms?.length ?? 0) > 0;
    const drawMode: DrawMode = mode === "adaptive" ? "adaptive" : hasForms ? "forms" : section.drawAll ? "all" : "quota";
    const expected = drawMode === "quota" && section.drawCount
      ? expectedExposure({ drawCount: section.drawCount, poolSize: pool.length })
      : null;
    for (const question of pool) {
      const count = delivered.get(question.id) ?? 0;
      const sharePercent = attemptsInWindow > 0 ? (count / attemptsInWindow) * 100 : null;
      const over = expected !== null && sharePercent !== null && attemptsInWindow >= OVEREXPOSURE_MIN_ATTEMPTS
        && sharePercent >= overexposureRatio() * expected.percent;
      result.set(question.id, {
        drawMode,
        sharePercent,
        expectedPercent: expected?.percent ?? null,
        overexposure: over ? { sharePercent: sharePercent as number, expectedPercent: (expected as { percent: number }).percent } : null,
      });
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
    testPsychometrics(test, { testIds: [testId] }, "first"),
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
  const exposure = exposureOf(test.mode, pool.sections, delivered, attemptsInWindow);

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
      drawMode: exposure.get(item.questionId)?.drawMode ?? null,
      sharePercent: exposure.get(item.questionId)?.sharePercent ?? null,
      expectedPercent: exposure.get(item.questionId)?.expectedPercent ?? null,
      overexposure: exposure.get(item.questionId)?.overexposure ?? null,
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
