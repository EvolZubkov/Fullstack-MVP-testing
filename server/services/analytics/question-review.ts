/**
 * @module server/services/analytics/question-review
 * @description PRD-56 FR-16: предустановленный вид «требуют ревизии».
 *
 * Вид не выносит приговор заданию — он показывает, где СОШЛИСЬ признаки проблемы. Один признак
 * ничего не значит: трудный вопрос законен (он и должен отсеивать), редкий законен, быстрый
 * ответ законен (лёгкое задание решают быстро). Подозрительно совпадение: задание, которое
 * видели почти все и почти все провалили, либо на которое отвечают быстрее, чем его можно
 * прочитать, и при этом мимо.
 *
 * Каждый признак назван словами и несёт свои числа: вид без объяснения читается как приговор,
 * а автору нужно понять, что именно сошлось, чтобы решить — чинить задание или оставить.
 */

/** Величины задания, по которым ищутся признаки. Все могут быть не измерены. */
export interface ReviewCandidate {
  questionId: string;
  /** Сколько ответов оценивалось: знаменатель доли верных. */
  gradedAnswers: number;
  /** Доля верных; `null` — оценивать было нечего. */
  correctPercent: number | null;
  /** Доля прохождений, в которых задание выдавалось; `null` — экспозиция не считалась. */
  exposurePercent: number | null;
  /** Медиана времени на задание; `null` — время не измерялось (PRD-55). */
  latencyMedianMs: number | null;
  /** Сколько замеров времени за этим медианой. */
  latencySampleSize: number;
}

export interface ReviewOptions {
  /** Порог наблюдений (FR-06d): ниже него числа задания ничего не утверждают. */
  minObservations: number;
}

/** Вид признака — по нему экран группирует и фильтрует. */
export type ReviewFlagKind = "hard-and-frequent" | "fast-and-wrong";

export interface ReviewFlag {
  kind: ReviewFlagKind;
  /** Признак словами, с числами, которые его вызвали. */
  reason: string;
}

/**
 * Доля выдачи, с которой задание считается частым.
 *
 * Половина прохождений: такое задание попадает в исход теста для половины людей, и его
 * трудность перестаёт быть свойством одного варианта — она становится свойством теста.
 */
const FREQUENT_EXPOSURE = 50;

/**
 * Доля верных, ниже которой задание считается тяжёлым.
 *
 * Сорок процентов — заметно хуже случайного выбора из трёх вариантов: на этом уровне речь уже
 * не о трудности, а о том, что задание понимают неправильно.
 */
const HARD_CORRECT = 40;

/**
 * Медиана времени, ниже которой ответ считается аномально быстрым.
 *
 * Пять секунд — меньше, чем нужно, чтобы прочитать условие и варианты: столько занимает
 * угадывание или узнавание «того самого длинного варианта».
 */
const FAST_MS = 5_000;

/** Сколько замеров нужно, чтобы медиана времени что-то значила. */
const MIN_LATENCY_SAMPLE = 10;

/** Процент для подписи: без десятых, которых в таких числах всё равно нет. */
function percent(value: number): string {
  return `${Math.round(value)} %`;
}

/** Секунды для подписи времени. */
function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} с`;
}

/**
 * Признаки, по которым задание попадает в вид «требуют ревизии».
 *
 * Пустой список — «ничего не сошлось», а не «задание в порядке»: отсутствие признака не
 * является утверждением о качестве.
 */
export function reviewFlags(
  question: ReviewCandidate,
  { minObservations }: ReviewOptions,
): ReviewFlag[] {
  // Ниже порога наблюдений числа задания ничего не утверждают: «20 % верных» на пяти ответах
  // — это один человек, нажавший не туда.
  if (question.gradedAnswers < minObservations) return [];
  if (question.correctPercent === null) return [];

  const flags: ReviewFlag[] = [];

  if (
    question.exposurePercent !== null
    && question.exposurePercent >= FREQUENT_EXPOSURE
    && question.correctPercent <= HARD_CORRECT
  ) {
    flags.push({
      kind: "hard-and-frequent",
      reason: `Выдаётся в ${percent(question.exposurePercent)} прохождений, верно отвечают `
        + `${percent(question.correctPercent)}: трудность задания решает исход теста для большинства`,
    });
  }

  if (
    question.latencyMedianMs !== null
    && question.latencySampleSize >= MIN_LATENCY_SAMPLE
    && question.latencyMedianMs <= FAST_MS
    && question.correctPercent <= HARD_CORRECT
  ) {
    flags.push({
      kind: "fast-and-wrong",
      reason: `Отвечают за ${seconds(question.latencyMedianMs)} и мимо `
        + `(${percent(question.correctPercent)} верных): условие, похоже, не читают`,
    });
  }

  return flags;
}
