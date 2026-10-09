/**
 * @module shared/psychometrics/units
 *
 * Э4а UX-аудита аналитики: распределение ответов у заданий, где ответ складывается из ЕДИНИЦ, —
 * сопоставления (единица — пара), ранжирования (единица — элемент на своём месте) и заполнения
 * пропусков (единица — пропуск).
 *
 * Вариантов у таких заданий нет, и «что выбирали» сказать нельзя; можно сказать другое — какая
 * единица даётся и какая нет. Задание, которое решают на 72 %, может держаться на трёх лёгких
 * парах и одной, которую путают все, и без разреза по единицам автор этого не увидит.
 *
 * Сжатый вид (таблица «Вопросы») берёт из расчёта долю верных единиц и строку на единицу;
 * полный вид (страница вопроса) — ещё разрез по крайним группам. Группы — те же 27 %, что у
 * индекса дискриминации и анализа вариантов (`distractors.ts`): два разных деления выборки дали
 * бы два ответа на один вопрос «кто здесь сильный».
 *
 * Доли считаются от ответивших на задание: единица, которую участник оставил пустой, — не
 * верная. Иначе пара, которую половина просто не трогала, выглядела бы решённой.
 */
import { checkRuleSet, normalizeForCompare, type AnswerRuleSet } from "../answer-check";
import { parseBlanks } from "../questions/blanks";
import { referenceAnswer, renderBlanksText } from "../questions/blanks-render";
import { stripMarkdown } from "../text/plain";
import type { AbilityByRespondent } from "./item-metrics";

/** Какие задания разбираются по единицам. */
export type UnitQuestionType = "matching" | "ranking" | "blanks";

/** Ответ одного респондента на задание. */
export interface UnitResponse {
  respondentId: string;
  /** Сырой ответ: пары `{левый: правый}`, порядок `[элементы]` или `{пропуск: написанное}`. */
  answer: unknown;
}

/** Задание, как его видит расчёт. */
export interface UnitQuestion {
  type: UnitQuestionType;
  /** Текст задания — у пропусков из него берётся фраза вокруг пропуска. */
  prompt: string;
  /** `data_json`: `left`/`right` у сопоставления, `items` у ранжирования. */
  data: unknown;
  /** `correct_json`: `pairs`, `correctOrder` или `blanks`. */
  correct: unknown;
}

/** Самая частая ошибка в единице. */
export interface UnitMistake {
  /** Что поставили вместо верного: правый элемент, место («2-е») или написание. */
  label: string;
  /** Доля ответивших на задание, давших именно эту ошибку, 0–1. */
  share: number;
}

/** Одна единица задания. */
export interface UnitStats {
  index: number;
  /** Левый элемент пары, элемент порядка или «1-й пропуск». */
  label: string;
  /** Верный ответ единицы: правый элемент, место или эталон пропуска; `null` — эталона строкой нет. */
  reference: string | null;
  /** У пропуска — фраза вокруг него, пропуски в ней заменены прочерком. */
  context?: string;
  /** Доля ответивших на задание, у кого единица верна, 0–1. */
  share: number;
  /** Та же доля внутри слабой и сильной крайних групп; `null` — групп нет (без способностей или мала выборка). */
  bottomShare: number | null;
  topShare: number | null;
  mistake: UnitMistake | null;
  /** Ранжирование: верное место (с единицы), среднее место и средний сдвиг от верного. */
  place?: number;
  meanPlace?: number | null;
  meanShift?: number | null;
}

/** Разбор задания по единицам. */
export interface UnitAnalysis {
  type: UnitQuestionType;
  units: UnitStats[];
  /** Сколько ответов вошло в разбор. */
  observations: number;
  /** Доля верных единиц по всем ответам, 0–1. */
  share: number;
  /** Ранжирование: средний сдвиг элемента от верного места по всем элементам. */
  meanShift?: number | null;
}

/** Порядковое числительное места или пропуска: «1-й», «2-й». */
function ordinal(n: number): string {
  return `${n}-й`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => (typeof item === "string" ? item : String(item ?? ""))) : [];
}

/** Пустой ли ответ: такой в разбор не входит — задание видели, но не ответили. */
function isEmpty(type: UnitQuestionType, answer: unknown): boolean {
  if (type === "ranking") return !Array.isArray(answer) || answer.length === 0;
  const record = asRecord(answer);
  if (!record) return true;
  if (type === "blanks") return !Object.values(record).some(v => typeof v === "string" && v.trim() !== "");
  return Object.keys(record).length === 0;
}

/**
 * Единица ответа в одном ответе: верна ли и что поставлено вместо.
 *
 * `null` во втором поле — единица пуста или верна; ошибкой считается только то, что участник
 * действительно поставил.
 */
type Judge = (answer: unknown) => { correct: boolean; given: string | null };

interface UnitSpec {
  label: string;
  reference: string | null;
  context?: string;
  place?: number;
  judge: Judge;
  /** Ранжирование: место, на которое поставили элемент (с единицы); `null` — не поставили. */
  placeOf?: (answer: unknown) => number | null;
}

function matchingSpecs(question: UnitQuestion): UnitSpec[] {
  const data = asRecord(question.data) ?? {};
  const left = stringsOf(data.left);
  const right = stringsOf(data.right);
  const pairs = Array.isArray(asRecord(question.correct)?.pairs)
    ? (asRecord(question.correct)!.pairs as Array<{ left: number; right: number }>)
    : [];
  return pairs.map(pair => ({
    label: left[pair.left] ?? `${ordinal(pair.left + 1)} элемент`,
    reference: right[pair.right] ?? null,
    judge: (answer) => {
      const got = asRecord(answer)?.[String(pair.left)];
      const index = typeof got === "number" ? got : Number(got);
      if (got === undefined || got === null || !Number.isInteger(index)) return { correct: false, given: null };
      if (index === pair.right) return { correct: true, given: null };
      return { correct: false, given: right[index] ?? `${ordinal(index + 1)} ответ` };
    },
  }));
}

function rankingSpecs(question: UnitQuestion): UnitSpec[] {
  const items = stringsOf(asRecord(question.data)?.items);
  const order = Array.isArray(asRecord(question.correct)?.correctOrder)
    ? (asRecord(question.correct)!.correctOrder as number[])
    : [];
  return order.map((item, position) => {
    const placeOf = (answer: unknown) => {
      if (!Array.isArray(answer)) return null;
      const at = answer.findIndex(value => Number(value) === item);
      return at === -1 ? null : at + 1;
    };
    return {
      label: items[item] ?? `${ordinal(item + 1)} элемент`,
      reference: String(position + 1),
      place: position + 1,
      placeOf,
      judge: (answer) => {
        const place = placeOf(answer);
        if (place === null) return { correct: false, given: null };
        if (place === position + 1) return { correct: true, given: null };
        return { correct: false, given: `${place}-е место` };
      },
    };
  });
}

/** Фраза вокруг пропуска: от конца предыдущего предложения до конца своего. */
function blankContext(prompt: string, start: number, end: number): string {
  const before = prompt.slice(0, start);
  const after = prompt.slice(end);
  const from = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "), before.lastIndexOf("\n"));
  const stops = [after.indexOf(". "), after.indexOf("! "), after.indexOf("? "), after.indexOf("\n")].filter(i => i !== -1);
  const to = stops.length ? end + Math.min(...stops) + 1 : prompt.length;
  const sentence = prompt.slice(from === -1 ? 0 : from + 1, to);
  return stripMarkdown(renderBlanksText(sentence, { mode: "dash" })).replace(/\s+/g, " ").trim();
}

function blankSpecs(question: UnitQuestion): UnitSpec[] {
  const sets = Array.isArray(asRecord(question.correct)?.blanks)
    ? (asRecord(question.correct)!.blanks as Array<AnswerRuleSet & { id: string }>)
    : [];
  const occurrences = parseBlanks(question.prompt).filter(blank => !blank.duplicate);
  // Пропуск без правил в счёт не идёт — так же, как у движка оценивания (`blankTallies`).
  const checked = sets.filter(set => set && Array.isArray(set.rules) && set.rules.length > 0);
  return checked.map((set) => {
    const at = occurrences.findIndex(blank => blank.id === set.id);
    const occurrence = occurrences[at];
    return {
      label: `${ordinal((at === -1 ? checked.indexOf(set) : at) + 1)} пропуск`,
      reference: referenceAnswer(set),
      context: occurrence ? blankContext(question.prompt, occurrence.start, occurrence.end) : undefined,
      judge: (answer) => {
        const written = asRecord(answer)?.[set.id];
        if (typeof written !== "string" || written.trim() === "") return { correct: false, given: null };
        if (checkRuleSet(set, written).passed) return { correct: true, given: null };
        return { correct: false, given: written.trim() };
      },
    };
  });
}

/** Крайние 27 % по способности — тем же правилом, что в `analyseOptions`. */
function extremeGroups(responses: readonly UnitResponse[], ability?: AbilityByRespondent) {
  if (!ability) return { bottom: null, top: null };
  const ranked = responses
    .map(response => ({ response, ability: ability.get(response.respondentId) }))
    .filter((row): row is { response: UnitResponse; ability: number } => row.ability !== undefined)
    .sort((a, b) => a.ability - b.ability);
  const size = Math.floor(ranked.length * 0.27);
  if (size < 1) return { bottom: null, top: null };
  return {
    bottom: ranked.slice(0, size).map(row => row.response),
    top: ranked.slice(ranked.length - size).map(row => row.response),
  };
}

/**
 * Разобрать задание по единицам.
 *
 * @param question задание: тип, текст, данные и эталон
 * @param responses ответы респондентов; пустые в разбор не входят
 * @param ability способности респондентов — для разреза по крайним группам; без них разрез `null`
 * @returns разбор либо `null`, когда разбирать нечего: у задания нет единиц или никто не ответил
 */
export function analyseUnits(
  question: UnitQuestion,
  responses: readonly UnitResponse[],
  ability?: AbilityByRespondent,
): UnitAnalysis | null {
  const specs = question.type === "matching"
    ? matchingSpecs(question)
    : question.type === "ranking" ? rankingSpecs(question) : blankSpecs(question);
  const answered = responses.filter(response => !isEmpty(question.type, response.answer));
  if (specs.length === 0 || answered.length === 0) return null;

  const { bottom, top } = extremeGroups(answered, ability);
  const shareIn = (list: readonly UnitResponse[] | null, spec: UnitSpec) =>
    list && list.length > 0 ? list.filter(r => spec.judge(r.answer).correct).length / list.length : null;

  let correctUnits = 0;
  const shifts: number[] = [];
  const units = specs.map((spec, index) => {
    const mistakes = new Map<string, { label: string; times: number }>();
    let correct = 0;
    const places: number[] = [];
    for (const response of answered) {
      const verdict = spec.judge(response.answer);
      if (verdict.correct) correct += 1;
      else if (verdict.given !== null) {
        // Написания пропуска сводятся по форме сравнения, как в разбросе короткого ответа.
        const key = question.type === "blanks" ? normalizeForCompare(verdict.given) : verdict.given;
        const entry = mistakes.get(key) ?? { label: verdict.given, times: 0 };
        entry.times += 1;
        mistakes.set(key, entry);
      }
      const place = spec.placeOf?.(response.answer) ?? null;
      if (place !== null) places.push(place);
    }
    correctUnits += correct;
    const top1 = [...mistakes.values()].sort((a, b) => b.times - a.times)[0];
    const stats: UnitStats = {
      index,
      label: spec.label,
      reference: spec.reference,
      share: correct / answered.length,
      bottomShare: shareIn(bottom, spec),
      topShare: shareIn(top, spec),
      mistake: top1 ? { label: top1.label, share: top1.times / answered.length } : null,
    };
    if (spec.context !== undefined) stats.context = spec.context;
    if (spec.place !== undefined) {
      const placeShifts = places.map(place => Math.abs(place - spec.place!));
      shifts.push(...placeShifts);
      stats.place = spec.place;
      stats.meanPlace = places.length ? places.reduce((s, p) => s + p, 0) / places.length : null;
      stats.meanShift = placeShifts.length ? placeShifts.reduce((s, p) => s + p, 0) / placeShifts.length : null;
    }
    return stats;
  });

  const analysis: UnitAnalysis = {
    type: question.type,
    units,
    observations: answered.length,
    share: correctUnits / (answered.length * specs.length),
  };
  if (question.type === "ranking") {
    analysis.meanShift = shifts.length ? shifts.reduce((s, p) => s + p, 0) / shifts.length : null;
  }
  return analysis;
}
