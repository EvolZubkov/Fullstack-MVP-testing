/**
 * @module server/services/delivery-pool
 * @description Пул выдачи теста — ОДНО определение того, какие вопросы тест может выдать.
 *
 * Решение владельца 2026-09-26: вопросы теста — это пул выдачи, а не «на что уже отвечали».
 * Правило по разделу:
 *
 * - доступный банк раздела — вопросы темы раздела за вычетом исключённых из выдачи ЭТОГО
 *   теста (PRD-56 FR-17a, `test_question_scoring.excludedFromDelivery`);
 * - раздел с набором фиксированных вариантов (PRD-17, `form_set_json`) выдаёт только вопросы
 *   вариантов — из доступного банка, как и старт попытки (`selectForm` с `availableIds`);
 * - адаптивный тест выдаёт вопросы уровней: вопрос темы, чья ДЕЙСТВУЮЩАЯ трудность (PRD-15
 *   блок D, FR-34) попадает в полосу хотя бы одного уровня. Материалы уровня
 *   (`adaptive_level_links`) — ссылки на курсы, а не вопросы, и в пул не входят;
 * - во всех прочих случаях пул — весь доступный банк раздела.
 *
 * Пользуются им три места, и третьего определения заводиться не должно: профиль экспозиции
 * вкладки «Выдача» (`neverDelivered`, размер банка), список «Качество вопросов» (строки «Вопрос
 * ещё не выдавался») и проверка выполнимости публикации (`assessTestPublish`), которой нужен
 * доступный банк — варианты и уровни она проверяет сама поверх него.
 */

import type { AdaptiveLevel, Question, Test, TestQuestionScoring, TestSection } from "@shared/schema";

import { storage } from "../storage";
import { buildTestScoringContext } from "./effective-scoring";

/** Чтения, которых требует пул; по умолчанию — живое хранилище. */
export interface DeliveryPoolSource {
  getTest(testId: string): Promise<Test | undefined>;
  getTestSections(testId: string): Promise<TestSection[]>;
  getQuestionsByTopic(topicId: string): Promise<Question[]>;
  getTestQuestionScoring(testId: string): Promise<TestQuestionScoring[]>;
  getAdaptiveLevelsByTest(testId: string): Promise<AdaptiveLevel[]>;
}

/** Пул одного раздела. */
export interface SectionPool {
  section: TestSection;
  /** Весь банк темы раздела — как он есть, с исключёнными. */
  bank: Question[];
  /** Банк без исключённых из выдачи: из него отбирает старт попытки. */
  available: Question[];
  /** Что раздел действительно может выдать: варианты, уровни или весь доступный банк. */
  pool: Question[];
}

export interface DeliveryPool {
  sections: SectionPool[];
  /** Вопросы, исключённые из выдачи этого теста. */
  excluded: Set<string>;
  /** Идентификаторы пула всего теста, без повторов, в порядке разделов. */
  questionIds: string[];
}

/**
 * Вопросы, исключённые из выдачи ЭТОГО теста (PRD-56 FR-17a).
 *
 * Признак живёт в настройках вопроса внутри теста: исключение в другом тесте пул этого не трогает.
 */
export function excludedFromDelivery(rows: readonly TestQuestionScoring[]): Set<string> {
  return new Set(rows.filter(row => row.excludedFromDelivery).map(row => row.questionId));
}

/** Банк без исключённых — то, из чего отбирает старт попытки. */
export function availableOf<T extends { id: string }>(bank: readonly T[], excluded: ReadonlySet<string>): T[] {
  return bank.filter(question => !excluded.has(question.id));
}

/** Входные данные правила пула одного раздела. */
export interface SectionPoolInput {
  section: Pick<TestSection, "topicId" | "formSetJson">;
  available: readonly Question[];
  /** Режим теста: у адаптивного пул — вопросы уровней. */
  mode: string | null | undefined;
  /** Уровни адаптивного теста (всех тем); у прочих режимов не читаются. */
  levels?: readonly Pick<AdaptiveLevel, "topicId" | "minDifficulty" | "maxDifficulty">[];
  /** Действующая трудность вопроса в этом тесте; `null` — «не задано» (PRD-16). */
  difficultyOf?: (question: Question) => number | null;
}

/**
 * Правило пула одного раздела — чистая функция, без базы.
 *
 * Порядок проверок повторяет старт попытки: адаптивная выдача идёт мимо разделов и их
 * вариантов, поэтому режим теста проверяется первым.
 */
export function sectionPoolOf(input: SectionPoolInput): Question[] {
  const { section, available, mode } = input;
  if (mode === "adaptive") {
    const bands = (input.levels ?? []).filter(level => level.topicId === section.topicId);
    return available.filter(question => {
      const difficulty = input.difficultyOf ? input.difficultyOf(question) : question.difficulty;
      // PRD-16: вопрос без трудности в полосу уровня не встаёт — выдать его адаптив не может.
      if (difficulty === null || difficulty === undefined) return false;
      return bands.some(level => difficulty >= level.minDifficulty && difficulty <= level.maxDifficulty);
    });
  }
  if (section.formSetJson) {
    const inForms = new Set(section.formSetJson.forms.flatMap(form => form.questionIds));
    return available.filter(question => inForms.has(question.id));
  }
  return [...available];
}

/**
 * Собрать пул выдачи теста.
 *
 * @param testId тест
 * @param options `alsoExcluded` — вопросы, которые ещё не исключены, но будут (FR-17b: окно
 *   подтверждения спрашивает о будущем состоянии); `src` — источник чтений
 */
export async function loadDeliveryPool(
  testId: string,
  options: { alsoExcluded?: readonly string[]; src?: DeliveryPoolSource } = {},
): Promise<DeliveryPool> {
  const src = options.src ?? storage;
  const [test, sections, scoringRows] = await Promise.all([
    src.getTest(testId),
    src.getTestSections(testId),
    src.getTestQuestionScoring(testId),
  ]);
  const excluded = excludedFromDelivery(scoringRows ?? []);
  for (const questionId of options.alsoExcluded ?? []) excluded.add(questionId);

  const mode = test?.mode;
  // Уровни и действующая трудность нужны только адаптиву: у прочих режимов их не читаем вовсе.
  const levels = mode === "adaptive" ? await src.getAdaptiveLevelsByTest(testId) : [];
  const scoring = mode === "adaptive"
    ? buildTestScoringContext(test, sections ?? [], scoringRows ?? [])
    : null;

  const pools: SectionPool[] = [];
  for (const section of sections ?? []) {
    const bank = await src.getQuestionsByTopic(section.topicId);
    const available = availableOf(bank, excluded);
    pools.push({
      section,
      bank,
      available,
      pool: sectionPoolOf({
        section,
        available,
        mode,
        levels,
        difficultyOf: scoring ? question => scoring.difficultyOf(question) : undefined,
      }),
    });
  }

  const seen = new Set<string>();
  const questionIds: string[] = [];
  for (const { pool } of pools) {
    for (const question of pool) {
      if (seen.has(question.id)) continue;
      seen.add(question.id);
      questionIds.push(question.id);
    }
  }

  return { sections: pools, excluded, questionIds };
}
