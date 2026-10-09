/**
 * @module shared/sim/contract
 *
 * The contract of the «Сценарий в ИС» question type, version 1: what a scenario IS
 * (`scenario.json` of the exchange archive) and what the player RETURNS (the result).
 *
 * The scenario is a graph of SCENES. A scene is a stage of a fixed size with ordered image
 * ELEMENTS from the scenario's media library (the last one is on top), field placements,
 * action ZONES and key bindings. A zone's EFFECTS move the run to another scene, show or hide
 * an element of the current scene, or write a field. Reaching a scene with a GOAL ends the
 * run; a `fail` goal is a dead end, a `success` goal is judged by its field checks.
 *
 * These types mirror `docs/specs/sim-scenario/scenario.schema.json` and
 * `docs/specs/sim-scenario/result.schema.json` one to one: a field added here without the
 * schema (or the other way round) is the «silent erasure» class of bug — an editor writing
 * what the exchange format drops.
 *
 * Pure types, framework-free — safe to bundle into the SCORM runtime.
 */
import type { AnswerRuleSet } from "@shared/answer-check";
import type { ZoneShape } from "./geometry";

export type { Point, ZoneShape } from "./geometry";

/** `format` value of a scenario file. */
export const SCENARIO_FORMAT = "skillum.sim-scenario";
/** `format` value of a result document. */
export const RESULT_FORMAT = "skillum.sim-result";
/** Contract version this module implements. */
export const CONTRACT_VERSION = 1;

/** A rectangle in stage pixels; `x`, `y` is the top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixel size of a stage or an image. */
export interface Size {
  w: number;
  h: number;
}

/** An image of the scenario's library. */
export interface MediaItem {
  id: string;
  title?: string;
  /** Path inside the exchange archive, `media/<name>`. */
  file: string;
  w: number;
  h: number;
}

/** How an element appears when a scene introduces it. Only plain effects, by design. */
export interface Appear {
  mode?: "with-previous" | "after-previous";
  delayMs?: number;
  effect?: "none" | "fade";
  durationMs?: number;
}

/** An image placed on a scene. Array order is z-order: later is on top. */
export interface SceneElement {
  id: string;
  media: string;
  x: number;
  y: number;
  /** Defaults to the image's own width. */
  w?: number;
  h?: number;
  /** Hidden when the element first appears; shown by `show` or `toggle`. */
  hidden?: boolean;
  /** A shown element hides itself after this delay — system messages. */
  autoHideMs?: number;
  appear?: Appear;
  /** The element scrolls inside its own box; zones with `in` use image coordinates. */
  scroll?: { direction?: "vertical" | "horizontal" | "both" };
}

/** A value the participant types or chooses; values are global for the run. */
export interface FieldDef {
  id: string;
  title?: string;
  /** `keyboard` — typed by the participant; `effect` — written by a `set` effect. */
  fill: "keyboard" | "effect";
  initial?: string;
  check?: AnswerRuleSet;
  /** `input` — a wrong value is a miss as soon as it is committed; `goal` — judged only at the goal. */
  checkWhen?: "input" | "goal";
  tabIndex?: number;
  allowPaste?: boolean;
  hint?: string;
}

/** Where a field sits on a scene and whether it can be typed into there. */
export interface FieldPlacement extends Box {
  field: string;
  editable?: boolean;
}

/** One effect of an action, applied in order. */
export type Effect =
  | { goto: string }
  | { show: string }
  | { hide: string }
  | { toggle: string }
  | { set: string; value: string }
  | { clear: string };

/** A condition over field values and element visibility. */
export type Condition =
  | { filled: string[] }
  | { field: string; check: AnswerRuleSet }
  | { visible: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/**
 * The role of an action — what doing it MEANS.
 *
 * `path` and `alt` lead to the goal; `detour` is a harmless extra move; `trap` is a plausible
 * mistake with consequences, named by `error`; `neutral` is neither an action nor a miss.
 */
export type Role = "path" | "alt" | "detour" | "trap" | "neutral";

/** What zones and key bindings share. */
export interface ActionBase {
  id: string;
  title?: string;
  role: Role;
  /** Only for `trap`: the name of the mistake, for the protocol and analytics. */
  error?: string;
  when?: Condition;
  effects?: Effect[];
  /** Applied when `when` does not hold; doing that is a miss («the system refused»). */
  otherwise?: Effect[];
  hint?: string;
}

/** What a zone has besides its role, effects and shape. */
export interface ZoneExtras {
  action?: "click" | "dblclick" | "rightclick" | "hover" | "drag";
  hoverMs?: number;
  drop?: Box;
  /** A scrolling element whose image coordinates the zone uses. */
  in?: string;
  /** Copyable text of a neutral zone. */
  copyText?: string;
}

/**
 * A place on a scene where a mouse action does something.
 *
 * Shape (see `shared/sim/geometry`): a rectangle `x, y, w, h` by default, with optional rounded
 * corners `radius`; `shape: "ellipse"` —
 * the ellipse inscribed in that rectangle (a circle when `w === h`); `shape: "polygon"` —
 * `points` in stage pixels, no rectangle stored.
 */
export type Zone = ActionBase & ZoneExtras & ZoneShape;

/** A keyboard shortcut working on a scene. */
export interface KeyBinding extends ActionBase {
  /** Normalised combination: `Ctrl+S`, `Shift+F10`, `Escape`. Letters are physical keys. */
  keys: string;
}

/** A field check of a success goal. */
export interface GoalCheck {
  field: string;
  /** Defaults to the field's own check. */
  check?: AnswerRuleSet;
  /** Defaults to `true`: a failed critical check fails the goal whatever else passed. */
  critical?: boolean;
  /** Defaults to 1. */
  weight?: number;
}

/** Entering a scene with a goal ends the run. */
export interface Goal {
  outcome: "success" | "fail";
  message?: string;
  checks?: GoalCheck[];
}

/** Reserved for the next stage: a phone or tablet layout of the same scene. */
export interface SceneView {
  device: "phone" | "tablet";
  size: Size;
  elements?: Record<string, Partial<SceneElement>>;
  geometry?: Record<string, Box>;
  gestures?: Record<string, "tap" | "doubletap" | "longpress" | "swipe-left" | "swipe-right" | "swipe-up" | "swipe-down">;
}

/** A node of the scenario graph. */
export interface Scene {
  id: string;
  title: string;
  /** Defaults to `settings.stage`. */
  size?: Size;
  elements: SceneElement[];
  fields?: FieldPlacement[];
  zones?: Zone[];
  keys?: KeyBinding[];
  /** A click past every zone is a miss AND moves here — this is how an open menu closes. */
  onMissGoto?: string;
  goal?: Goal;
  views?: SceneView[];
}

/** Scenario-wide settings. */
export interface Settings {
  stage?: Size;
  normSeconds?: number;
  limitSeconds?: number | null;
  minViewportWidth?: number;
  hints?: { enabled?: boolean; afterMisses?: number };
  counters?: { actions?: boolean; misses?: boolean; detours?: boolean };
}

/** The whole `scenario.json`. */
export interface Scenario {
  format: typeof SCENARIO_FORMAT;
  version: typeof CONTRACT_VERSION;
  meta: {
    title: string;
    task: string;
    language?: string;
    system?: string;
    createdAt?: string;
    tool?: { name?: string; version?: string };
  };
  settings?: Settings;
  media: MediaItem[];
  fields?: FieldDef[];
  start: string;
  scenes: Scene[];
}

// ── Result ──────────────────────────────────────────────────────────────────

/**
 * How the run ended.
 *
 * `success` — a success goal with every check passed; `partial` — every critical check
 * passed, some others did not; `fail` — a fail goal, or a critical check failed; `exited` —
 * the participant left early; `timeout` — the scenario's own limit ran out.
 */
export type Outcome = "success" | "partial" | "fail" | "exited" | "timeout";

/** One entry of the protocol. `t` is milliseconds since the run started. */
export type SimEvent =
  | { t: number; type: "enter"; scene: string }
  | { t: number; type: "action"; scene: string; id: string; role: Exclude<Role, "neutral">; error?: string }
  | { t: number; type: "blocked"; scene: string; id: string }
  | { t: number; type: "miss"; scene: string; x: number; y: number }
  | { t: number; type: "value"; scene: string; field: string; value: string; correct: boolean | null }
  | { t: number; type: "hint"; scene: string; target: string }
  | { t: number; type: "copy"; scene: string; id: string }
  | { t: number; type: "goal"; scene: string; outcome: Outcome }
  | { t: number; type: "exit" }
  | { t: number; type: "timeout" };

/** One field check of the reached goal. */
export interface CheckResult {
  field: string;
  passed: boolean;
  critical: boolean;
  weight: number;
}

/** The result document the player returns. */
export interface SimResult {
  format: typeof RESULT_FORMAT;
  version: typeof CONTRACT_VERSION;
  scenario: { title: string };
  startedAt: string;
  durationMs: number;
  outcome: Outcome;
  /** The goal scene reached, if any. */
  goal: {
    scene: string;
    message?: string;
    checks: CheckResult[];
    /** Weight of passed checks over all checks; 1 when there are none. */
    share: number;
  } | null;
  counts: {
    actions: number;
    misses: number;
    blocked: number;
    wrongValues: number;
    detours: number;
    traps: number;
    hints: number;
  };
  /** Traps fallen into, in order. */
  traps: { id: string; error: string; t: number }[];
  /** Final field values. */
  fields: Record<string, string>;
  events: SimEvent[];
}
