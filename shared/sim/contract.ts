/**
 * @module shared/sim/contract
 *
 * The contract of the «Сценарий в ИС» question type, version 2: what a scenario IS
 * (`scenario.json` of the exchange archive) and what the player RETURNS (the result).
 *
 * A scenario is a COMMON part — kind, task, media library, fields, goal checks, stages — and
 * VARIANTS by device (`docs/specs/sim-scenario/v2-design.md`, section 1). A variant is a graph of
 * SCENES. A scene is a stage of a fixed size with ordered image ELEMENTS from the library (the
 * last one is on top), field placements, action ZONES and key bindings. A zone's EFFECTS move the
 * run to another scene, show or hide an element of the current scene, or write a field. Entering a
 * scene with an END finishes the run: `success` is judged by the common goal checks, `fail` is a
 * dead end, `finale` closes a research scenario.
 *
 * Version 1 — one graph, goal checks on the scene — is `./contract-v1`; `./upgrade` turns it into
 * this version, and every entry point of `shared/sim` accepts both.
 *
 * These types mirror `docs/specs/sim-scenario/scenario.schema.json` and
 * `docs/specs/sim-scenario/result.schema.json` one to one: a field added here without the schema
 * (or the other way round) is the «silent erasure» class of bug — an editor writing what the
 * exchange format drops.
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
/** Scenario contract version this module implements. */
export const CONTRACT_VERSION = 2;
/** Result document version the engine writes. */
export const RESULT_VERSION = 2;

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

/** What a scenario is for: judging a skill, or studying behaviour without a verdict. */
export type ScenarioKind = "control" | "research";

/** The device a variant is laid out for. */
export type Device = "desktop" | "phone";

/** Mouse actions of a desktop variant. */
export type MouseAction = "click" | "dblclick" | "rightclick" | "hover" | "drag";

/** Gestures of a phone variant. */
export type Gesture = "tap" | "doubletap" | "longpress" | "swipe-left" | "swipe-right" | "swipe-up" | "swipe-down";

/** What a zone reacts to. */
export type ZoneAction = MouseAction | Gesture;

/** Kinds of action a cost is set for: zone actions, key bindings, field commits. */
export type ActionKind = ZoneAction | "key" | "field";

/** Cost of an action by its kind, in steps; absent kinds take the system default. */
export type ActionCosts = Partial<Record<ActionKind, number>>;

/** An image of the scenario's library. */
export interface MediaItem {
  id: string;
  title?: string;
  /** Path inside the exchange archive, `media/<name>`; a media-library address once stored. */
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
 * mistake with consequences, named by `error`; `neutral` is neither an action nor a miss. A
 * control scenario sets a role on every action; in a research scenario an action without a role
 * is simply an action.
 */
export type Role = "path" | "alt" | "detour" | "trap" | "neutral";

/** What zones and key bindings share. */
export interface ActionBase {
  id: string;
  title?: string;
  /** Required in a control scenario, optional in a research one. */
  role?: Role;
  /** Only for `trap`: the name of the mistake, for the protocol and analytics. */
  error?: string;
  when?: Condition;
  effects?: Effect[];
  /** Applied when `when` does not hold; doing that is a miss («the system refused»). */
  otherwise?: Effect[];
  hint?: string;
  /** Cost of this action in steps; absent — the scenario's or the system's default for its kind. */
  cost?: number;
}

/** What a zone has besides its role, effects and shape. */
export interface ZoneExtras {
  /** Mouse actions on a desktop variant, gestures on a phone one; default `click`. */
  action?: ZoneAction;
  hoverMs?: number;
  drop?: Box;
  /** A scrolling element whose image coordinates the zone uses. */
  in?: string;
  /** Copyable text of a neutral zone. */
  copyText?: string;
}

/**
 * A place on a scene where an action does something.
 *
 * Shape (see `shared/sim/geometry`): a rectangle `x, y, w, h` by default, with optional rounded
 * corners `radius`; `shape: "ellipse"` — the ellipse inscribed in that rectangle (a circle when
 * `w === h`); `shape: "polygon"` — `points` in stage pixels, no rectangle stored.
 */
export type Zone = ActionBase & ZoneExtras & ZoneShape;

/** A keyboard shortcut working on a scene. */
export interface KeyBinding extends ActionBase {
  /** Normalised combination: `Ctrl+S`, `Shift+F10`, `Escape`. Letters are physical keys. */
  keys: string;
}

/** A field check of the goal. */
export interface GoalCheck {
  field: string;
  /** Defaults to the field's own check. */
  check?: AnswerRuleSet;
  /** Defaults to `true`: a failed critical check fails the goal whatever else passed. */
  critical?: boolean;
  /** Defaults to 1. */
  weight?: number;
}

/** The goal of a control scenario — common to every variant, so outcomes compare across devices. */
export interface Goal {
  checks: GoalCheck[];
}

/**
 * Entering a scene with an end finishes the run.
 *
 * `success` — judged by the scenario's goal checks (control only); `fail` — a dead end, usually
 * after a trap; `finale` — a named end of a research scenario, `target` marks the ones efficiency
 * is measured to.
 */
export type SceneEnd =
  | { outcome: "success"; message?: string }
  | { outcome: "fail"; message?: string }
  | { outcome: "finale"; title: string; message?: string; target?: boolean };

/** A stage of the task: a named group of scenes, the same across variants. */
export interface StageDef {
  id: string;
  title: string;
}

/** A key action of a route: the zone or key binding `action` of scene `scene`. */
export interface RouteKey {
  scene: string;
  action: string;
}

/** A declared way to the goal with the author's rating of how good it is. */
export interface Route {
  id: string;
  title: string;
  /** In (0; 1]: 1 — the best way. */
  rating: number;
  /** Key actions in order; other actions between them do not break the route. */
  keys: RouteKey[];
}

/** A node of the scenario graph. */
export interface Scene {
  id: string;
  title: string;
  /** Defaults to the variant's stage size. */
  size?: Size;
  elements: SceneElement[];
  fields?: FieldPlacement[];
  zones?: Zone[];
  keys?: KeyBinding[];
  /** A click past every zone is a miss AND moves here — this is how an open menu closes. */
  onMissGoto?: string;
  /** The stage of the task this scene belongs to. */
  stage?: string;
  end?: SceneEnd;
}

/** Scenario-wide settings, common to every variant. */
export interface Settings {
  normSeconds?: number;
  limitSeconds?: number | null;
  hints?: { enabled?: boolean; afterMisses?: number };
  counters?: { actions?: boolean; misses?: boolean; detours?: boolean };
  /** Research only: the participant may finish by «Я закончил»; default `true`. */
  finishButton?: boolean;
  /** Default costs by action kind. */
  costs?: ActionCosts;
  /** Rating of a run outside every declared route; absent — judged against the optimum. */
  otherRouteRating?: number;
}

/** One device's graph of the scenario. */
export interface Variant {
  device: Device;
  /** Default scene size. */
  stage?: Size;
  /** Narrowest participant window the variant plays in; default 1280 on desktop. */
  minViewportWidth?: number;
  start: string;
  scenes: Scene[];
  routes?: Route[];
}

/** The task text and the facts about a scenario. */
export interface ScenarioMeta {
  title: string;
  task: string;
  language?: string;
  system?: string;
  createdAt?: string;
  tool?: { name?: string; version?: string };
}

/** The whole `scenario.json`. */
export interface Scenario {
  format: typeof SCENARIO_FORMAT;
  version: typeof CONTRACT_VERSION;
  kind: ScenarioKind;
  meta: ScenarioMeta;
  settings?: Settings;
  media: MediaItem[];
  fields?: FieldDef[];
  /** Control only. */
  goal?: Goal;
  stages?: StageDef[];
  variants: Variant[];
}

// ── Result ──────────────────────────────────────────────────────────────────

/**
 * How the run ended.
 *
 * `success` — the goal with every check passed; `partial` — every critical check passed, some
 * others did not; `fail` — a fail end, or a critical check failed; `finale` — a research finale;
 * `declared` — the participant said «Я закончил»; `exited` — left early; `timeout` — the
 * scenario's own limit ran out.
 */
export type Outcome = "success" | "partial" | "fail" | "finale" | "declared" | "exited" | "timeout";

/** One entry of the protocol. `t` is milliseconds since the run started. */
export type SimEvent =
  | { t: number; type: "enter"; scene: string }
  | { t: number; type: "action"; scene: string; id: string; role?: Exclude<Role, "neutral">; error?: string }
  | { t: number; type: "blocked"; scene: string; id: string }
  | { t: number; type: "miss"; scene: string; x: number; y: number }
  | { t: number; type: "value"; scene: string; field: string; value: string; correct: boolean | null }
  | { t: number; type: "hint"; scene: string; target: string }
  | { t: number; type: "copy"; scene: string; id: string }
  | { t: number; type: "goal"; scene: string; outcome: Outcome; finale?: string }
  | { t: number; type: "declare" }
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
  version: number;
  scenario: { title: string };
  /** The device variant that was played; absent in results of version 1 — desktop. */
  variant?: Device;
  startedAt: string;
  durationMs: number;
  outcome: Outcome;
  /** The success or fail end reached, if any. */
  goal: {
    scene: string;
    message?: string;
    checks: CheckResult[];
    /** Weight of passed checks over all checks; 1 when there are none. */
    share: number;
  } | null;
  /** The research finale reached, if any. */
  finale?: { scene: string; title: string; target: boolean } | null;
  counts: {
    actions: number;
    misses: number;
    blocked: number;
    wrongValues: number;
    detours: number;
    traps: number;
    hints: number;
  };
  /** Sum of the costs of accepted actions; absent in results of version 1. */
  cost?: number;
  /** Traps fallen into, in order. */
  traps: { id: string; error: string; t: number }[];
  /** Final field values. */
  fields: Record<string, string>;
  events: SimEvent[];
}
