/**
 * @module shared/template/transition-context
 *
 * Browser-safe builder for the adaptive inter-level/topic TRANSITION interstitial
 * (PRD-12 §10): the brief "Правильно/Неправильно + смена уровня/темы" screen shown
 * between adaptive questions when difficulty levels are visible. Maps a host's
 * transition facts into the `{ transition }` context the `system.transition` layout
 * consumes (Core-prepared icon/level classes + labels). Pure — no DOM, no Node.
 */

import type { CtxTransition } from "./context";

/** Normalized transition facts (host adapts its own shape into this). */
export interface TransitionInput {
  /** The topic whose difficulty level changed (named on the screen). */
  topicName?: string;
  /** Level change: `up` (advanced), `down` (dropped), anything else = `complete`. */
  levelTransition?: { type: string; message?: string } | null;
  /** SCORM renders an explicit "Продолжить"; the web auto-advances on a timer. */
  showContinue?: boolean;
}

/** Default supporting line per level direction (when the host gives no message). */
function defaultMessage(isUp: boolean, isDown: boolean): string {
  if (isUp) return "Следующие вопросы будут сложнее";
  if (isDown) return "Следующие вопросы будут проще";
  return "Ваш уровень по теме определён";
}

/**
 * Build the `{ transition }` context. This interstitial is a LEVEL CHANGE within the
 * current topic (spec §3.2 / plan 6.2): the title states the level change, the eyebrow
 * names the topic the level is for. It is NOT a per-answer verdict («Правильно») and
 * NOT a topic move (flat adaptive is a deferred future PRD).
 */
export function buildTransitionContext(input: TransitionInput): { transition: CtxTransition } {
  const type = input.levelTransition?.type;
  const isUp = type === "up";
  const isDown = type === "down";
  const isComplete = !isUp && !isDown;
  const transition: CtxTransition = {
    topicName: input.topicName || "",
    title: isUp ? "Сложность повышена" : isDown ? "Сложность понижена" : "Уровень зафиксирован",
    level: {
      class: isUp ? "is-up" : isDown ? "is-down" : "is-complete",
      isUp,
      isDown,
      isComplete,
      message: (input.levelTransition?.message || "").trim() || defaultMessage(isUp, isDown),
    },
    showContinue: !!input.showContinue,
  };
  return { transition };
}
