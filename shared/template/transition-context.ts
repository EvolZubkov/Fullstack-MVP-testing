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
  isCorrect: boolean;
  /** Level change: `up` (advanced), `down` (dropped), anything else = `complete`. */
  levelTransition?: { type: string; message: string } | null;
  topicTransition?: { toTopic: string } | null;
  /** SCORM renders an explicit "Продолжить"; the web auto-advances on a timer. */
  showContinue?: boolean;
}

/** Build the `{ transition }` context for the transition layout. */
export function buildTransitionContext(input: TransitionInput): { transition: CtxTransition } {
  const ok = !!input.isCorrect;
  const t: CtxTransition = {
    isCorrect: ok,
    iconClass: ok ? "is-pass" : "is-fail",
    title: ok ? "Правильно!" : "Неправильно",
    showContinue: !!input.showContinue,
  };
  if (input.levelTransition) {
    const type = input.levelTransition.type;
    const isUp = type === "up";
    const isDown = type === "down";
    t.level = {
      class: isUp ? "is-up" : isDown ? "is-down" : "is-complete",
      isUp,
      isDown,
      isComplete: !isUp && !isDown,
      message: input.levelTransition.message,
    };
  }
  if (input.topicTransition) t.topic = { toTopic: input.topicTransition.toTopic };
  return { transition: t };
}
