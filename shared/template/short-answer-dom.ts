/**
 * @module shared/template/short-answer-dom
 *
 * Wires the typed-answer field (PRD-57 §6.5) to its host, on BOTH hosts — the web
 * question screen and the in-package renderer (PRD-12 FR-30).
 *
 * Interaction everywhere else in the unified renderer is delegated through a click on
 * `data-action`, but a text field is different in kind: the answer changes on every
 * keystroke, not on a choice, so the field is subscribed to directly. The contract
 * mirrors {@link module:shared/template/allocation-dom} — the host supplies the
 * accessors, this module returns the unsubscribe function.
 *
 * The RAW string is handed over, untrimmed: what the learner typed is what travels to
 * the LMS report and to the attempt review, and folding it would show them something
 * they did not write. Normalisation belongs to the comparison alone
 * ({@link module:shared/answer-check/normalize}).
 */

import { parseNumericAnswer } from "../answer-check/number";

/** Minimal element shape used here — keeps the module free of `lib.dom` assumptions. */
type El = {
  value?: string;
  className?: string;
  /** `until-found` is the DOM's own third state; this module only ever writes booleans. */
  hidden?: boolean | string;
  matches?(sel: string): boolean;
  closest?(sel: string): El | null;
  querySelector?(sel: string): El | null;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  addEventListener(type: string, cb: (e: never) => void): void;
  removeEventListener(type: string, cb: (e: never) => void): void;
};

/** The `input` event as this module reads it. */
type InputEvent = { target: El | null };

/** What the field needs from the screen that owns the answer. */
export interface ShortAnswerHost {
  /** Current answer as the host stores it. */
  getAnswer(): string;
  /** Called with the raw field value on every change. */
  setAnswer(value: string): void;
  /**
   * PRD-57 FR-24: поле ПРОПУСКА отдаёт пару «имя — значение», а не одну строку. Ответ
   * задания с пропусками — словарь, и привязка к позиции поля поехала бы вся, стоило бы
   * автору переставить пропуски в тексте.
   */
  setBlank?(id: string, value: string): void;
  /** True while the answer is read-only (feedback shown, section frozen, review). */
  isLocked?(): boolean;
}

/** Detaches every listener {@link attachShortAnswer} installed. */
export type DetachShortAnswer = () => void;

/**
 * Subscribe to the typed-answer field inside `root`.
 *
 * DELEGATED, not bound to the element: `input` bubbles, and the field is replaced on
 * every re-render — the package binds its interaction ONCE at start-up, long before any
 * question exists, so grabbing the element at attach time would leave the learner typing
 * into a field nobody listens to. That is exactly how it failed on the package host while
 * the web host, which re-attaches after each render, looked fine.
 *
 * Attaching twice to the same root is harmless: the second call installs its own listener
 * and its own detach, and both write the same value.
 *
 * @param root Container that holds the rendered question (document, shadow root, element).
 * @param host The screen that owns the answer.
 * @returns The unsubscribe function.
 */
export function attachShortAnswer(root: El, host: ShortAnswerHost): DetachShortAnswer {
  const onInput = (event: InputEvent): void => {
    const field = event?.target;
    if (!field || !field.matches?.('[data-action="short-answer"]')) return;
    if (host.isLocked?.()) return;
    const value = typeof field.value === "string" ? field.value : "";
    const blank = field.getAttribute?.("data-blank");
    if (blank) host.setBlank?.(blank, value);
    else host.setAnswer(value);
    markNumberFormat(field, value);
  };
  root.addEventListener("input", onInput as (e: never) => void);
  return () => root.removeEventListener("input", onInput as (e: never) => void);
}

/** Add a class to a class list that is a plain string — no `classList` assumed. */
function withClass(className: string, add: boolean): string {
  const classes = className.split(/\s+/).filter((name) => name !== "" && name !== ERROR_CLASS);
  if (add) classes.push(ERROR_CLASS);
  return classes.join(" ");
}

/** DS marker of a field whose content the form could not accept. */
const ERROR_CLASS = "ou-field--error";

/**
 * Say «ожидается число» while the typed text is not one (FR-28z1).
 *
 * Called on every keystroke rather than at render time because the package assembles the
 * question screen ONCE: re-rendering it per character would take the focus away from the
 * field the learner is typing into. The renderer prints the same state for the answer it
 * is given, so the two agree after any re-render.
 *
 * Silent for a text answer and for an empty field: «не число» is a remark about what was
 * written, and nothing has been written yet.
 */
function markNumberFormat(field: El, value: string): void {
  if (field.getAttribute?.("data-answer-kind") !== "number") return;
  const wrap = field.closest?.(".tb-answer-field");
  const message = wrap?.querySelector?.('[data-role="nan"]');
  const bad = value.trim() !== "" && parseNumericAnswer(value) === null;
  if (message) message.hidden = !bad;
  if (wrap && typeof wrap.className === "string") wrap.className = withClass(wrap.className, bad);
  if (bad) field.setAttribute?.("aria-invalid", "true");
  else field.removeAttribute?.("aria-invalid");
}
