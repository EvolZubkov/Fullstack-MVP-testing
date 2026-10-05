/**
 * @module server/services/analytics/question-bank-quality
 * @description PRD-70 FR-13, FR-14: ось банка вопросов — свод качества вопроса по тестам.
 *
 * Свод не усредняет (решение К1): «на ревизии» — признак хотя бы в одном тесте, у вопроса
 * называется самый важный из них и в скольких тестах он сработал; «переэкспонирован» — по тесту
 * с наибольшим превышением; «не выдавался» — нигде за окно. Все три — только по тестам, доступным
 * читателю (§3.5): один и тот же вопрос у двух читателей может выглядеть по-разному.
 *
 * Единственное усреднение — ориентир сложности для ящика вопроса (исключение из К1, §3.4): он
 * описывает вопрос, а не тесты, поэтому берёт все тесты (решение О2) и названий их не раскрывает.
 *
 * Чистые функции: качество каждого теста посчитано фоновым пересчётом, здесь оно только сводится.
 */
import type { QuestionFlag } from "@shared/psychometrics/question-flag";
import type { QuestionInTest, TestQuality } from "./question-quality";

/** Признак ревизии вопроса банка. */
export interface BankReview {
  /** Самый важный признак среди тестов. */
  tone: QuestionFlag["tone"];
  title: string;
  /** В скольких тестах вопрос под подозрением. */
  tests: number;
  /** Из скольких тестов, где о нём можно судить. */
  of: number;
  /** Сколько других признаков сработало в тестах — «ещё K признаков». */
  more: number;
}

/** Переэкспонированность вопроса банка — по тесту с наибольшим превышением. */
export interface BankOverexposure {
  sharePercent: number;
  expectedPercent: number;
  /** В скольких тестах переэкспонирован. */
  tests: number;
  /** Из скольких тестов, в пул которых входит. */
  of: number;
}

/** Качество вопроса банка в глазах читателя. */
export interface BankQuestionQuality {
  questionId: string;
  review: BankReview | null;
  overexposure: BankOverexposure | null;
  /** В пуле хотя бы одного теста и не выдан ни в одном за окно (§3.3). */
  neverDelivered: boolean;
  /** Тесты, где вопрос выдавался за окно: «Тестов» у вопроса, у темы и папки — без повторов. */
  testIds: string[];
}

/** Ориентир сложности «По ответам» (§3.4). */
export interface DifficultyLandmark {
  /** Наблюдаемая сложность в шкале редактора 0–100. */
  hardness: number;
  /** Сколько тестов вошло. */
  tests: number;
  /** Сколько наблюдений за ним. */
  observations: number;
}

/** Мутируемая заготовка свода по вопросу. */
interface Draft {
  suspicious: Array<{ flag: QuestionFlag; rank: number }>;
  judged: number;
  over: Array<{ sharePercent: number; expectedPercent: number }>;
  delivered: Set<string>;
}

/**
 * Свести качество вопросов по тестам, доступным читателю.
 *
 * @param qualities качество тестов с прохождениями (фоновый пересчёт)
 * @param pools пулы выдачи всех известных тестов
 * @param inScope доступен ли тест читателю
 * @returns вопрос -> его качество; в карте только вопросы, о которых есть что сказать
 */
export function bankQuality(
  qualities: readonly TestQuality[],
  pools: ReadonlyMap<string, readonly string[]>,
  inScope: (testId: string) => boolean,
): Map<string, BankQuestionQuality> {
  const drafts = new Map<string, Draft>();
  const draftOf = (questionId: string): Draft => {
    let draft = drafts.get(questionId);
    if (!draft) {
      draft = { suspicious: [], judged: 0, over: [], delivered: new Set() };
      drafts.set(questionId, draft);
    }
    return draft;
  };

  for (const quality of qualities) {
    if (!inScope(quality.testId)) continue;
    for (const item of quality.items) {
      const draft = draftOf(item.questionId);
      if (item.enoughData || item.suspicious) draft.judged += 1;
      if (item.suspicious && item.flag) draft.suspicious.push({ flag: item.flag, rank: item.rank });
      if (item.overexposure) draft.over.push(item.overexposure);
      if (item.delivered > 0 || item.observations > 0) draft.delivered.add(quality.testId);
    }
  }

  // Знаменатель переэкспонированности и сырьё «не выдавался» — пулы тестов читателя.
  const poolTests = new Map<string, number>();
  for (const [testId, questionIds] of pools) {
    if (!inScope(testId)) continue;
    for (const questionId of questionIds) {
      poolTests.set(questionId, (poolTests.get(questionId) ?? 0) + 1);
      draftOf(questionId);
    }
  }

  const result = new Map<string, BankQuestionQuality>();
  for (const [questionId, draft] of drafts) {
    const main = [...draft.suspicious].sort((a, b) => a.rank - b.rank)[0];
    const titles = new Set(draft.suspicious.map(s => s.flag.title));
    const worst = [...draft.over].sort((a, b) =>
      b.sharePercent / b.expectedPercent - a.sharePercent / a.expectedPercent)[0];
    result.set(questionId, {
      questionId,
      review: main
        ? {
          tone: main.flag.tone,
          title: main.flag.title,
          tests: draft.suspicious.filter(s => s.flag.title === main.flag.title).length,
          of: Math.max(draft.judged, draft.suspicious.length),
          more: titles.size - 1,
        }
        : null,
      overexposure: worst
        ? {
          sharePercent: worst.sharePercent,
          expectedPercent: worst.expectedPercent,
          tests: draft.over.length,
          of: Math.max(poolTests.get(questionId) ?? 0, draft.over.length),
        }
        : null,
      neverDelivered: (poolTests.get(questionId) ?? 0) > 0 && draft.delivered.size === 0,
      testIds: [...draft.delivered].sort(),
    });
  }
  return result;
}

/**
 * Ориентир сложности вопроса: среднее наблюдаемой сложности по тестам, взвешенное числом
 * наблюдений; тесты с недостаточными данными не входят (§3.4). По ВСЕМ тестам (решение О2).
 *
 * @param qualities качество тестов с прохождениями
 * @param questionId вопрос
 * @returns ориентир; `null` — ни одного теста с достаточными данными
 */
export function difficultyLandmark(
  qualities: readonly TestQuality[],
  questionId: string,
): DifficultyLandmark | null {
  const rows: QuestionInTest[] = [];
  for (const quality of qualities) {
    const item = quality.items.find(i => i.questionId === questionId);
    if (item && item.hardness !== null && item.observations > 0) rows.push(item);
  }
  if (rows.length === 0) return null;
  const observations = rows.reduce((sum, row) => sum + row.observations, 0);
  const weighted = rows.reduce((sum, row) => sum + (row.hardness as number) * row.observations, 0);
  return { hardness: Math.round(weighted / observations), tests: rows.length, observations };
}
