/**
 * @module tests/scorm-review-finish
 *
 * Завершение попытки с экрана «Обзор теста» в SCORM-пакете (техдолг ROADMAP §0.3,
 * вскрыт приёмкой консолидации текстов 2026-08-03).
 *
 * Подтверждение в модальном окне вызывало `submit()` без принудительного режима, и гейт
 * «сначала ответьте на вопрос» возвращал ученика назад: с экрана обзора выхода не было,
 * хотя веб-хост тот же сценарий завершает штатно. Гейт на обзоре не к месту по существу —
 * «текущего вопроса» там нет, на экране список всех.
 *
 * Проверяется и сама механика `submit(force)`, и КАЖДЫЙ путь завершения экрана обзора:
 * механика без места вызова ничего не гарантирует — ровно на этом дефект и держался.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const answersSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/actions/answers.js"),
  "utf8",
);
const mainRenderSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/mainRender.js"),
  "utf8",
);

/** A top-level `function name(...) { ... }` — declared and closed at column 0. */
function extractTopLevel(src: string, name: string): string {
  const m = src.match(new RegExp(`^function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "m"));
  if (!m) throw new Error(`${name} не найдена среди функций верхнего уровня`);
  return m[0];
}

/** `submit` over stubs, with a gate that REFUSES — the unanswered-question case. */
function makeSubmit() {
  const calls = { gate: 0, saved: 0, rendered: 0, timerStopped: 0 };
  const state = {
    submitted: false,
    flatQuestions: [{}, {}],
    pageSequence: null as unknown[] | null,
    currentIndex: 0,
    currentPageIndex: 0,
    phase: "review",
  };
  const submit = new Function(
    "state",
    "calls",
    `
    function requireAnswerOrToast() { calls.gate++; return false; }
    function saveSessionState() { calls.saved++; }
    function stopTestTimer() { calls.timerStopped++; }
    function render() { calls.rendered++; }
    ${extractTopLevel(answersSrc, "submit")}
    return submit;`,
  )(state, calls) as (force?: boolean) => void;
  return { submit, state, calls };
}

/**
 * The body of the review screen's action wiring, where «Завершить» is bound — bounded by the
 * branch's own closing brace rather than by a character count, so a comment cannot move the
 * window off the code it is meant to measure.
 */
function reviewFinishHandler(): string {
  const at = mainRenderSrc.indexOf("'finish-review'");
  if (at < 0) throw new Error("обработчик 'finish-review' не найден в mainRender.js");
  const end = mainRenderSrc.indexOf("\n        }", at);
  if (end < 0) throw new Error("конец ветки 'finish-review' не найден");
  return mainRenderSrc.slice(at, end);
}

/** The «no review layout» fall-through, up to its own `return`. */
function noLayoutFallThrough(): string {
  const at = mainRenderSrc.indexOf("No review layout");
  if (at < 0) throw new Error("ветка «No review layout» не найдена в mainRender.js");
  const end = mainRenderSrc.indexOf("return;", at);
  if (end < 0) throw new Error("конец ветки «No review layout» не найден");
  return mainRenderSrc.slice(at, end);
}

describe("механика submit(force)", () => {
  it("без принуждения запертый гейт не даёт завершить попытку", () => {
    const { submit, state, calls } = makeSubmit();
    submit();
    expect(calls.gate).toBe(1);
    expect(state.submitted).toBe(false);
  });

  it("с принуждением попытка завершается, гейт не спрашивают вовсе", () => {
    const { submit, state, calls } = makeSubmit();
    submit(true);
    expect(calls.gate).toBe(0);
    expect(state.submitted).toBe(true);
  });

  it("завершение сохраняет состояние и останавливает таймер", () => {
    const { submit, calls } = makeSubmit();
    submit(true);
    expect(calls.saved).toBe(1);
    expect(calls.timerStopped).toBe(1);
  });
});

describe("завершение с экрана обзора", () => {
  it("подтверждение в модальном окне завершает принудительно", () => {
    // Ровно дефект: ученик подтвердил «Завершить», а гейт вернул его назад.
    expect(reviewFinishHandler()).toContain("showFinishConfirm");
    expect(reviewFinishHandler()).not.toMatch(/submit\(\s*\)/);
  });

  it("ни один путь обзора не зовёт submit без принуждения", () => {
    const paths = reviewFinishHandler().match(/submit\([^)]*\)/g) || [];
    expect(paths.length).toBeGreaterThan(0);
    for (const call of paths) expect(call).toBe("submit(true)");
  });

  it("отсутствие макета обзора тоже завершает принудительно", () => {
    // Ветка «No review layout — fall through to finishing»: обзора нет, а решение уже принято.
    expect(noLayoutFallThrough()).toContain("submit(true)");
    expect(noLayoutFallThrough()).not.toMatch(/submit\(\s*\)/);
  });
});
