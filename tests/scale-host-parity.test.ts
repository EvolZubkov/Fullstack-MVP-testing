/**
 * @module tests/scale-host-parity
 *
 * PRD-26 host parity for the scale interaction. Two things can silently diverge and
 * both are pinned here:
 *
 *  1. The MARKUP. The package must not carry its own scale renderer: its
 *     `render/questions/scale.js` is a thin wrapper over the shared
 *     `TBTemplate.renderScale`, so the HTML the LMS shows is byte-identical to the
 *     web run. The wrapper is evaluated straight from the shipped source with a
 *     stubbed `window.TBTemplate` wired to the real shared function.
 *
 *  2. The TYPE TRAITS. The runtime cannot import TypeScript, so
 *     `app/utils/qtype.js` duplicates `shared/questions/question-type.ts`. The two
 *     are compared over the full type list, so a trait added on one side and
 *     forgotten on the other fails here instead of in an LMS.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderScale } from "../shared/template/question-interaction";
import {
  QUESTION_TYPES,
  isSingleIndexChoice,
  hasOptionList,
  hasFixedOptionOrder,
  isMeasurementOnly,
} from "../shared/questions/question-type";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const scaleWrapperSrc = read("server/scorm/template/app/render/questions/scale.js");
const qTypeSrc = read("server/scorm/template/app/utils/qtype.js");
const dispatcherSrc = read("server/scorm/template/app/render/questions/index.js");
const answersSrc = read("server/scorm/template/app/actions/answers.js");

const GRADES = ["Никогда", "Очень редко", "Редко", "Часто", "Очень часто", "Постоянно"];

/**
 * The package wrapper, evaluated from the shipped source with `window.TBTemplate`
 * pointing at the real shared renderer — exactly the wiring the package has at run
 * time (the shared bundle is prepended as the `TBTemplate` global).
 */
function packageRenderScale(
  q: { id: string; type: string; data: unknown; correct?: unknown },
  answer: unknown,
  showReview: boolean,
  correct: unknown,
): string {
  const fn = new Function(
    "window",
    `${scaleWrapperSrc}\n;return renderScaleQuestionInput;`,
  )({ TBTemplate: { renderScale } }) as (
    q: unknown,
    answer: unknown,
    showReview: boolean,
    correct: unknown,
  ) => string;
  return fn(q, answer, showReview, correct);
}

describe("scale markup parity: the package delegates to the shared renderer", () => {
  const q = { id: "q1", type: "scale", data: { options: GRADES }, correct: { correctIndex: 3 } };

  it("emits exactly the web markup for an unanswered scale", () => {
    expect(packageRenderScale(q, undefined, false, q.correct)).toBe(
      renderScale({ type: "scale", dataJson: q.data }, undefined),
    );
  });

  it("emits exactly the web markup for an answered scale", () => {
    expect(packageRenderScale(q, 2, false, q.correct)).toBe(
      renderScale({ type: "scale", dataJson: q.data }, 2),
    );
  });

  it("passes the answer key through only when review is shown", () => {
    // showReview off: no verdict, even though the key was handed in.
    const hidden = packageRenderScale(q, 2, false, q.correct);
    expect(hidden).not.toContain("is-success");
    expect(hidden).toBe(renderScale({ type: "scale", dataJson: q.data }, 2));
    // showReview on: the verdict appears, identical to the web review render.
    const shown = packageRenderScale(q, 2, true, q.correct);
    expect(shown).toContain("is-success");
    expect(shown).toBe(renderScale({ type: "scale", dataJson: q.data }, 2, q.correct));
  });

  it("carries no scale markup of its own", () => {
    // Every class comes from the shared renderer, so the wrapper's CODE may not name
    // a DS class — a literal `ou-stepper` there would be a second source of markup.
    // Comments are stripped first: the JSDoc legitimately explains which markup the
    // shared renderer emits.
    const code = scaleWrapperSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("ou-stepper");
    expect(code).not.toContain("<");
    expect(code).toContain("TB.renderScale");
  });

  it("is reachable: the dispatcher routes the scale type to the wrapper", () => {
    expect(dispatcherSrc).toMatch(/q\.type === 'scale'[\s\S]*?renderScaleQuestionInput/);
  });

  it("wires the shared keyboard helper rather than its own index maths", () => {
    expect(answersSrc).toContain("TB.nextScaleIndex");
    expect(answersSrc).toContain("ou-stepper--choice");
  });
});

describe("type-trait parity: the ES5 mirror matches the shared module", () => {
  const mirror = new Function(`${qTypeSrc}\n;return TBQType;`)() as {
    isSingleIndexChoice: (t: string) => boolean;
    hasOptionList: (t: string) => boolean;
    hasFixedOptionOrder: (t: string) => boolean;
    isMeasurementOnly: (q: { type: string; correct?: unknown }) => boolean;
  };

  it("agrees on every trait for every question type", () => {
    for (const type of QUESTION_TYPES) {
      expect(mirror.isSingleIndexChoice(type)).toBe(isSingleIndexChoice(type));
      expect(mirror.hasOptionList(type)).toBe(hasOptionList(type));
      expect(mirror.hasFixedOptionOrder(type)).toBe(hasFixedOptionOrder(type));
    }
  });

  it("agrees on an unknown type (defensive: neither side may throw)", () => {
    expect(mirror.isSingleIndexChoice("nonsense")).toBe(isSingleIndexChoice("nonsense"));
    expect(mirror.hasOptionList("")).toBe(hasOptionList(""));
    expect(mirror.hasFixedOptionOrder("")).toBe(hasFixedOptionOrder(""));
  });

  it("agrees on the measurement-only rule, reading each host's answer-key field", () => {
    // The key is `correctJson` on the server and `correct` in the baked payload.
    const cases: { correct: unknown; measurement: boolean }[] = [
      { correct: { correctIndex: 0 }, measurement: false },
      { correct: { correctIndex: 3 }, measurement: false },
      { correct: {}, measurement: true },
      { correct: null, measurement: true },
      { correct: undefined, measurement: true },
      { correct: { correctIndex: null }, measurement: true },
      { correct: { correctIndex: "2" }, measurement: true },
    ];
    for (const c of cases) {
      expect(isMeasurementOnly({ type: "scale", correctJson: c.correct })).toBe(c.measurement);
      expect(mirror.isMeasurementOnly({ type: "scale", correct: c.correct })).toBe(c.measurement);
    }
  });

  it("оба хоста считают распределение измерительным БЕЗУСЛОВНО (PRD-44 FR-09)", () => {
    // У метода нет эталонного распределения ни в каком виде, поэтому случайный
    // `correctIndex`, оставшийся от смены типа в редакторе, не должен делать вопрос
    // проверяемым — в отличие от шкалы, где ключ и есть переключатель автора.
    for (const correct of [{}, null, undefined, { correctIndex: 1 }]) {
      expect(isMeasurementOnly({ type: "allocation", correctJson: correct })).toBe(true);
      expect(mirror.isMeasurementOnly({ type: "allocation", correct })).toBe(true);
    }
  });

  it("прочие типы измерительными не становятся", () => {
    for (const type of QUESTION_TYPES.filter((t) => t !== "scale" && t !== "allocation")) {
      expect(isMeasurementOnly({ type, correctJson: {} })).toBe(false);
      expect(mirror.isMeasurementOnly({ type, correct: {} })).toBe(false);
    }
  });
});
