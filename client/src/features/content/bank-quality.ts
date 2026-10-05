/**
 * @module features/content/bank-quality
 * @description PRD-70 FR-20 - FR-23: ось банка вопросов в дереве «Темы и вопросы» — что делать
 * с качеством вопросов, которое отдаёт `GET /api/analytics/bank/quality`.
 *
 * Сервер сводит качество вопроса по тестам читателя; здесь — суммы для тем и папок, подписи
 * ячеек набора «Качество» и отбор фильтра «Состояние». Средних по тестам нет нигде (К1): у темы
 * и папки — КОЛИЧЕСТВА вопросов, у «Тестов» — число разных тестов без повторов.
 */

/** Признак ревизии вопроса банка (как его сводит сервер). */
export interface BankReview {
  tone: "error" | "warning" | "info";
  title: string;
  tests: number;
  of: number;
  more: number;
}

/** Переэкспонированность вопроса банка. */
export interface BankOverexposure {
  sharePercent: number;
  expectedPercent: number;
  tests: number;
  of: number;
}

/** Качество вопроса банка в глазах читателя. */
export interface BankQuestionQuality {
  questionId: string;
  review: BankReview | null;
  overexposure: BankOverexposure | null;
  neverDelivered: boolean;
  testIds: string[];
}

/** Состояние вопроса для фильтра «Состояние» (FR-23). */
export type ContentState = "review" | "overexposed" | "never";

export const STATE_OPTS: { value: ContentState; label: string }[] = [
  { value: "review", label: "Требуют ревизии" },
  { value: "overexposed", label: "Переэкспонированы" },
  { value: "never", label: "Не выдавались" },
];

/** Суммы темы или папки: сколько вопросов в каждом состоянии и в скольких тестах выдавались. */
export interface QualityTotals {
  review: number;
  overexposed: number;
  never: number;
  /** Разных тестов, где выдавался хоть один вопрос. */
  tests: number;
}

/** Русская форма числительного: «1 тест», «2 теста», «5 тестов». */
function plural(n: number, [one, few, many]: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const TESTS: [string, string, string] = ["теста", "тестов", "тестов"];
const SIGNS: [string, string, string] = ["признак", "признака", "признаков"];

/** Процент целым с неразрывным пробелом. */
function percent(value: number): string {
  return `${Math.round(value)} %`;
}

/**
 * Суммы по набору вопросов — для темы (её вопросы) и папки (вопросы всего поддерева).
 *
 * @param questionIds вопросы темы или папки
 * @param byId качество вопросов банка
 */
export function totalsOf(
  questionIds: Iterable<string>,
  byId: ReadonlyMap<string, BankQuestionQuality>,
): QualityTotals {
  const totals = { review: 0, overexposed: 0, never: 0 };
  const tests = new Set<string>();
  for (const id of questionIds) {
    const quality = byId.get(id);
    if (!quality) continue;
    if (quality.review) totals.review += 1;
    if (quality.overexposure) totals.overexposed += 1;
    if (quality.neverDelivered) totals.never += 1;
    for (const testId of quality.testIds) tests.add(testId);
  }
  return { ...totals, tests: tests.size };
}

/** Подпись под признаком ревизии: «в 1 из 2 тестов · ещё 1 признак». */
export function reviewSub(review: BankReview): string {
  const base = `в ${review.tests} из ${review.of} ${plural(review.of, TESTS)}`;
  return review.more > 0 ? `${base} · ещё ${review.more} ${plural(review.more, SIGNS)}` : base;
}

/** Подпись под переэкспонированностью: «82 % при 40 % · 1 из 3 тестов». */
export function overexposureSub(over: BankOverexposure): string {
  return `${percent(over.sharePercent)} при ${percent(over.expectedPercent)} · ${over.tests} из ${over.of} ${plural(over.of, TESTS)}`;
}

/**
 * Проходит ли вопрос фильтр «Состояние»: отмеченные состояния — через «или»; ничего не
 * отмечено — фильтра нет.
 *
 * @param quality качество вопроса; нет — о вопросе сказать нечего, ни одному состоянию он не отвечает
 * @param states отмеченные состояния
 */
export function matchesStates(quality: BankQuestionQuality | undefined, states: readonly ContentState[]): boolean {
  if (states.length === 0) return true;
  if (!quality) return false;
  return states.some(state =>
    state === "review" ? quality.review !== null
      : state === "overexposed" ? quality.overexposure !== null
        : quality.neverDelivered);
}
