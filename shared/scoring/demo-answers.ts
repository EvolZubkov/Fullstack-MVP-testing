/**
 * @module shared/scoring/demo-answers
 *
 * Demo answers for the «Предпросмотр балла» modal (PRD-10 §7, issue #31): the
 * hypothetical answers an author can score their «цена ответа» config against
 * without leaving the constructor.
 *
 * The set is DERIVED from the question's answer key rather than typed by the
 * author. Two things follow. Every entry is a well-formed answer in the runtime
 * encoding {@link Answer}, so it can be fed straight to
 * {@link module:shared/scoring/engine.scoreAnswer} — the preview reuses the
 * product's own scoring rather than a second implementation of it. And a case a
 * key cannot produce is ABSENT, not present-and-broken: there is no «лишний
 * вариант» when every option is correct, no «часть верных» behind a single
 * correct option, and no wrong pairing when a matching question has one pair.
 *
 * Pure and framework-free (no DOM, no React) so the generator can be unit-tested
 * on its own and, if the debug player ever wants the same list, reused as is.
 */

import type { Answer, CorrectData } from "./engine";
import { distributesBudget, isSingleIndexChoice, type QuestionType } from "../questions/question-type";

/** One entry of the «Демо-ответ» select. */
export interface DemoAnswer {
  /** Stable identifier — the select value; also what tests assert on. */
  id: string;
  /** Human label: what the answer IS, and for option types which options it picks. */
  label: string;
  /** The answer itself, in the runtime encoding the scoring engine expects. */
  answer: Answer;
}

export interface DemoAnswerInput {
  type: QuestionType;
  correct: CorrectData;
  /** Answer options (single/scale/multiple); absent for matching/ranking. */
  options?: string[];
}

/** At most this many wrong options are listed — the point is the tally, not the length. */
const MAX_EXTRA = 2;

/** Labels list two or three options at once, so a full option text does not fit. */
const MAX_NAME = 32;

/**
 * Option name for a label: the option's own text, cut to something a one-line
 * label can carry, or a positional name when the option has no text yet.
 * Shared with the preview modal so the key summary and the demo labels name the
 * same option the same way.
 */
export function optionName(options: string[], index: number): string {
  const raw = (options[index] ?? "").trim();
  if (raw === "") return `Вариант ${index + 1}`;
  return raw.length > MAX_NAME ? `${raw.slice(0, MAX_NAME - 1).trimEnd()}…` : raw;
}

/** «Полностью верный (Москва, Тула)» — the label plus the options it picks. */
function withOptions(label: string, options: string[], picked: number[]): string {
  if (picked.length === 0) return label;
  return `${label} (${picked.map((i) => optionName(options, i)).join(", ")})`;
}

/** The empty answer — always offered: an unanswered question must score 0 (FR-07). */
function emptyAnswer(type: QuestionType): DemoAnswer {
  if (isSingleIndexChoice(type)) return { id: "empty", label: "Пустой ответ", answer: null };
  if (type === "matching") return { id: "empty", label: "Пустой ответ", answer: {} };
  return { id: "empty", label: "Пустой ответ", answer: [] };
}

/** single / scale — one demo per option, so every weight in the table is reachable. */
function singleDemos(input: DemoAnswerInput): DemoAnswer[] {
  const options = input.options ?? [];
  const correctIndex = input.correct.correctIndex;
  const demos = options.map((_, i) => ({
    id: `option-${i}`,
    label: i === correctIndex ? `${optionName(options, i)} (верный)` : optionName(options, i),
    answer: i as Answer,
  }));
  return [...demos, emptyAnswer(input.type)];
}

/** multiple — the four shapes the counters can take, plus the empty answer. */
function multipleDemos(input: DemoAnswerInput): DemoAnswer[] {
  const options = input.options ?? [];
  const correct = (input.correct.correctIndices ?? []).slice().sort((a, b) => a - b);
  if (correct.length === 0) return [emptyAnswer("multiple")];

  const extras = options.map((_, i) => i).filter((i) => correct.indexOf(i) === -1);
  const half = correct.slice(0, Math.ceil(correct.length / 2));
  const demos: DemoAnswer[] = [
    { id: "all-correct", label: withOptions("Полностью верный", options, correct), answer: correct },
  ];
  if (correct.length > 1) {
    demos.push({ id: "some-correct", label: withOptions("Часть верных", options, half), answer: half });
  }
  if (extras.length > 0) {
    const plusExtra = [...correct, extras[0]];
    const onlyExtra = extras.slice(0, MAX_EXTRA);
    demos.push({
      id: "correct-plus-extra",
      label: withOptions("Все верные и лишний", options, plusExtra),
      answer: plusExtra,
    });
    demos.push({
      id: "only-extra",
      label: withOptions("Только лишние", options, onlyExtra),
      answer: onlyExtra,
    });
  }
  return [...demos, emptyAnswer("multiple")];
}

/** matching — the learner's answer is a `{left: right}` map. */
function matchingDemos(input: DemoAnswerInput): DemoAnswer[] {
  const pairs = input.correct.pairs ?? [];
  if (pairs.length === 0) return [emptyAnswer("matching")];

  const exact: Record<string, number> = {};
  for (const p of pairs) exact[p.left] = p.right;

  const demos: DemoAnswer[] = [
    { id: "all-correct", label: "Все пары верно", answer: { ...exact } },
  ];
  if (pairs.length > 1) {
    const half = pairs.slice(0, Math.ceil(pairs.length / 2));
    const partial: Record<string, number> = {};
    for (const p of half) partial[p.left] = p.right;
    demos.push({ id: "some-correct", label: "Часть пар верно, остальные не заполнены", answer: partial });

    // Two pairs traded: the smallest possible mistake that still costs two units.
    const swapped = { ...exact };
    swapped[pairs[0].left] = pairs[1].right;
    swapped[pairs[1].left] = pairs[0].right;
    demos.push({ id: "one-swapped", label: "Две пары перепутаны местами", answer: swapped });

    // Every right-hand side shifted by one — nothing lands where it belongs.
    const shifted: Record<string, number> = {};
    pairs.forEach((p, i) => {
      shifted[p.left] = pairs[(i + 1) % pairs.length].right;
    });
    demos.push({ id: "all-shuffled", label: "Все пары перепутаны", answer: shifted });
  }
  return [...demos, emptyAnswer("matching")];
}

/** ranking — the answer is the ordered list of item indices. */
function rankingDemos(input: DemoAnswerInput): DemoAnswer[] {
  const order = input.correct.correctOrder ?? [];
  if (order.length === 0) return [emptyAnswer("ranking")];

  const demos: DemoAnswer[] = [
    { id: "all-correct", label: "Точный порядок", answer: order.slice() },
  ];
  if (order.length > 1) {
    const swapped = order.slice();
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    demos.push({ id: "one-swapped", label: "Соседние элементы переставлены", answer: swapped });

    // With two items the reversed order IS the swap — one entry, not two identical ones.
    const reversed = order.slice().reverse();
    if (order.length > 2) {
      demos.push({ id: "reversed", label: "Обратный порядок", answer: reversed });
    }
  }
  return [...demos, emptyAnswer("ranking")];
}

/**
 * Build the demo-answer list for a question. Empty for a type that has no answer
 * price at all — an allocation is never checked (PRD-44 FR-10), so there is
 * nothing for a preview to score.
 */
export function buildDemoAnswers(input: DemoAnswerInput): DemoAnswer[] {
  if (distributesBudget(input.type)) return [];
  if (isSingleIndexChoice(input.type)) return singleDemos(input);
  if (input.type === "multiple") return multipleDemos(input);
  if (input.type === "matching") return matchingDemos(input);
  if (input.type === "ranking") return rankingDemos(input);
  return [];
}
