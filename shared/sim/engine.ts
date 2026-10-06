/**
 * @module shared/sim/engine
 *
 * The state machine of one scenario run — framework-free and DOM-free, so the web host, the
 * SCORM package and the tests drive the very same logic (the PRD-12 rule: one engine, no
 * per-host copies).
 *
 * The host translates what the participant does into calls — `click`, `key`, `commitField`,
 * `exit`, `timeout`, `expire` — and redraws from the run's state after each one. Coordinates
 * are STAGE pixels: the host divides pointer coordinates by its scale before calling.
 *
 * Rules (the contract's execution semantics, exchange-format §5):
 * - a click is resolved against the zones of the current scene, first match in array order;
 * - a neutral zone absorbs the click; a click on a double-click zone waits for the double click;
 * - a click past every zone is a miss, and on a scene with `onMissGoto` also moves there;
 * - an action whose `when` does not hold applies `otherwise` and counts as «blocked» (a miss);
 * - effects run in order; entering a scene with a goal ends the run;
 * - after `hints.afterMisses` consecutive errors on a scene the run raises a hint;
 * - element visibility is kept per element id across scenes, like field values.
 */
import { checkRuleSet, type AnswerRuleSet } from "@shared/answer-check";
import {
  CONTRACT_VERSION,
  RESULT_FORMAT,
  type ActionBase,
  type Box,
  type CheckResult,
  type Condition,
  type Effect,
  type FieldDef,
  type FieldPlacement,
  type Outcome,
  type Scenario,
  type Scene,
  type SceneElement,
  type SimEvent,
  type SimResult,
  type Size,
  type Zone,
} from "./contract";
import { boundsOf, contains, type ZoneShape } from "./geometry";

/** Default number of consecutive errors on a scene before a hint shows. */
export const DEFAULT_HINT_AFTER = 3;

/** What a call did — the host uses it for feedback (the miss ring, the copy flash). */
export type Reaction =
  | { kind: "none" }
  | { kind: "action"; id: string; role: ActionBase["role"]; sceneChanged: boolean }
  | { kind: "blocked"; id: string }
  | { kind: "miss"; x: number; y: number; sceneChanged: boolean }
  | { kind: "value"; field: string; correct: boolean | null }
  | { kind: "select"; id: string; text: string }
  | { kind: "copy"; text: string }
  | { kind: "done"; outcome: Outcome };

/** The mouse actions the host reports. */
export type ClickKind = "click" | "dblclick" | "rightclick";

/** Where the hint points and what it says. */
export interface Hint {
  target: string;
  /** Bounding box of the target, where the hint text is placed. */
  box: Box;
  /** Outline of the target: a field is a rectangle, a zone keeps its own shape. */
  shape: ZoneShape;
  text: string;
}

/** The geometry part of a zone, without its role and effects. */
function shapeOf(z: Zone): ZoneShape {
  if (z.shape === "polygon") return { shape: "polygon", points: z.points.map((p) => [p[0], p[1]]) };
  if (z.shape === "ellipse") return { shape: "ellipse", x: z.x, y: z.y, w: z.w, h: z.h };
  return z.radius ? { x: z.x, y: z.y, w: z.w, h: z.h, radius: z.radius } : { x: z.x, y: z.y, w: z.w, h: z.h };
}

/** Options of a run. */
export interface RunOptions {
  /** Clock, injectable for tests. */
  now?: () => number;
}

/** One live run of a scenario. */
export interface SimRun {
  readonly scenario: Scenario;
  /** The current scene. */
  scene(): Scene;
  /** Stage size of the current scene. */
  stage(): Size;
  /** Is the element of the current scene shown right now? */
  isVisible(elementId: string): boolean;
  /** Current value of a field ('' when empty). */
  value(fieldId: string): string;
  /** Did the last committed value of the field fail its check? */
  isWrong(fieldId: string): boolean;
  /** The selected copyable zone, if any. */
  selection(): string | null;
  /** The active hint, if any. */
  hint(): Hint | null;
  /** Has the run ended? */
  done(): boolean;
  click(x: number, y: number, kind?: ClickKind): Reaction;
  key(combo: string): Reaction;
  commitField(fieldId: string, value: string): Reaction;
  /** An auto-hiding element ran out its time. */
  expire(elementId: string): void;
  exit(): Reaction;
  timeout(): Reaction;
  result(): SimResult;
}

function passes(check: AnswerRuleSet | undefined, value: string): boolean {
  if (!check) return value.trim() !== "";
  return checkRuleSet(check, value).passed;
}

/**
 * Start a run of a scenario.
 *
 * @param scenario A scenario that already passed the import checks.
 * @param options  Clock override for tests.
 * @returns The live run.
 */
export function createRun(scenario: Scenario, options: RunOptions = {}): SimRun {
  const now = options.now ?? (() => Date.now());
  const t0 = now();
  const startedAt = new Date().toISOString();
  const scenes = new Map(scenario.scenes.map((s) => [s.id, s]));
  const fieldDefs = new Map<string, FieldDef>((scenario.fields ?? []).map((f) => [f.id, f]));
  const hintsOn = scenario.settings?.hints?.enabled !== false;
  const hintAfter = scenario.settings?.hints?.afterMisses ?? DEFAULT_HINT_AFTER;

  let current = scenes.get(scenario.start) as Scene;
  const values: Record<string, string> = {};
  const wrong: Record<string, boolean> = {};
  for (const f of fieldDefs.values()) if (f.initial) values[f.id] = f.initial;
  const visibility = new Map<string, boolean>();
  const events: SimEvent[] = [];
  const counts = { actions: 0, misses: 0, blocked: 0, wrongValues: 0, detours: 0, traps: 0, hints: 0 };
  const traps: SimResult["traps"] = [];
  let localErrors = 0;
  let hintOn: Hint | null = null;
  let selected: string | null = null;
  let finished: { outcome: Outcome; at: number; goal: SimResult["goal"] } | null = null;

  const t = () => now() - t0;
  const elementOf = (id: string): SceneElement | undefined => current.elements.find((e) => e.id === id);
  const isVisible = (id: string): boolean => {
    const own = visibility.get(id);
    if (own !== undefined) return own;
    return !(elementOf(id)?.hidden ?? false);
  };

  function evaluate(c: Condition): boolean {
    if ("filled" in c) return c.filled.every((f) => (values[f] ?? "").trim() !== "");
    if ("field" in c) return checkRuleSet(c.check, values[c.field] ?? "").passed;
    if ("visible" in c) return isVisible(c.visible);
    if ("all" in c) return c.all.every(evaluate);
    if ("any" in c) return c.any.some(evaluate);
    return !evaluate(c.not);
  }

  function finish(outcome: Outcome, goal: SimResult["goal"]): void {
    if (finished) return;
    finished = { outcome, at: t(), goal };
    hintOn = null;
  }

  function judgeGoal(scene: Scene): void {
    const g = scene.goal!;
    if (g.outcome === "fail") {
      events.push({ t: t(), type: "goal", scene: scene.id, outcome: "fail" });
      finish("fail", { scene: scene.id, message: g.message, checks: [], share: 0 });
      return;
    }
    const checks: CheckResult[] = (g.checks ?? []).map((c) => ({
      field: c.field,
      passed: passes(c.check ?? fieldDefs.get(c.field)?.check, values[c.field] ?? ""),
      critical: c.critical !== false,
      weight: c.weight ?? 1,
    }));
    const total = checks.reduce((s, c) => s + c.weight, 0);
    const got = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
    const outcome: Outcome = checks.every((c) => c.passed)
      ? "success"
      : checks.some((c) => c.critical && !c.passed) ? "fail" : "partial";
    events.push({ t: t(), type: "goal", scene: scene.id, outcome });
    finish(outcome, { scene: scene.id, message: g.message, checks, share: total ? got / total : 1 });
  }

  function enter(id: string): void {
    const next = scenes.get(id);
    if (!next) return;
    current = next;
    selected = null;
    localErrors = 0;
    hintOn = null;
    events.push({ t: t(), type: "enter", scene: id });
    if (next.goal) judgeGoal(next);
  }

  /** Apply effects; returns whether the scene changed. */
  function apply(effects: Effect[] | undefined): boolean {
    let moved = false;
    for (const e of effects ?? []) {
      if (finished) break;
      if ("goto" in e) { enter(e.goto); moved = true; }
      else if ("show" in e) visibility.set(e.show, true);
      else if ("hide" in e) visibility.set(e.hide, false);
      else if ("toggle" in e) visibility.set(e.toggle, !isVisible(e.toggle));
      else if ("set" in e) {
        values[e.set] = e.value;
        const def = fieldDefs.get(e.set);
        wrong[e.set] = !!def?.check && !passes(def.check, e.value);
      } else if ("clear" in e) { delete values[e.clear]; wrong[e.clear] = false; }
    }
    return moved;
  }

  function raiseError(): void {
    localErrors += 1;
    if (hintsOn && !hintOn && localErrors >= hintAfter) {
      hintOn = findHint();
      if (hintOn) {
        counts.hints += 1;
        events.push({ t: t(), type: "hint", scene: current.id, target: hintOn.target });
      }
    }
  }

  function act(a: ActionBase): Reaction {
    const allowed = !a.when || evaluate(a.when);
    if (!allowed) {
      counts.blocked += 1;
      events.push({ t: t(), type: "blocked", scene: current.id, id: a.id });
      apply(a.otherwise);
      raiseError();
      return { kind: "blocked", id: a.id };
    }
    if (a.role !== "neutral") {
      counts.actions += 1;
      if (a.role === "detour") counts.detours += 1;
      if (a.role === "trap") {
        counts.traps += 1;
        traps.push({ id: a.id, error: a.error ?? a.id, t: t() });
      }
      events.push({ t: t(), type: "action", scene: current.id, id: a.id, role: a.role, ...(a.role === "trap" ? { error: a.error } : {}) });
      localErrors = 0;
      hintOn = null;
    }
    const moved = apply(a.effects);
    if (finished) return { kind: "done", outcome: finished.outcome };
    return { kind: "action", id: a.id, role: a.role, sceneChanged: moved };
  }

  /** Is a path zone still worth pointing at — does it not just re-do what is done? */
  function useful(z: Zone): boolean {
    if (z.when && !evaluate(z.when)) return false;
    const sets = (effects: Effect[] | undefined) =>
      (effects ?? []).filter((e): e is { set: string; value: string } => "set" in e).map((e) => e.set);
    const direct = sets(z.effects);
    if (direct.length && direct.every((f) => values[f] && !wrong[f])) return false;
    const target = (z.effects ?? []).find((e): e is { goto: string } => "goto" in e)?.goto;
    const via = target ? (scenes.get(target)?.zones ?? []).filter((x) => x.role === "path").flatMap((x) => sets(x.effects)) : [];
    if (via.length && via.every((f) => values[f] && !wrong[f])) return false;
    return true;
  }

  function findHint(): Hint | null {
    for (const p of current.fields ?? []) {
      const def = fieldDefs.get(p.field);
      if (p.editable && def?.hint && (!(values[p.field] ?? "").trim() || wrong[p.field])) {
        const box = { x: p.x, y: p.y, w: p.w, h: p.h };
        return { target: p.field, box, shape: { ...box }, text: def.hint };
      }
    }
    const zones = current.zones ?? [];
    const pick = zones.find((z) => z.role === "path" && z.hint && useful(z))
      ?? zones.find((z) => z.role === "alt" && z.hint && useful(z));
    return pick ? { target: pick.id, box: boundsOf(pick), shape: shapeOf(pick), text: pick.hint! } : null;
  }

  function miss(x: number, y: number): Reaction {
    counts.misses += 1;
    events.push({ t: t(), type: "miss", scene: current.id, x: Math.round(x), y: Math.round(y) });
    selected = null;
    raiseError();
    if (current.onMissGoto) {
      enter(current.onMissGoto);
      if (finished) return { kind: "done", outcome: finished.outcome };
      return { kind: "miss", x, y, sceneChanged: true };
    }
    return { kind: "miss", x, y, sceneChanged: false };
  }

  const run: SimRun = {
    scenario,
    scene: () => current,
    stage: () => current.size ?? scenario.settings?.stage ?? { w: 1920, h: 1080 },
    isVisible,
    value: (id) => values[id] ?? "",
    isWrong: (id) => !!wrong[id],
    selection: () => selected,
    hint: () => hintOn,
    done: () => !!finished,

    click(x, y, kind = "click") {
      if (finished) return { kind: "none" };
      const zone = (current.zones ?? []).find((z) => contains(z, x, y));
      if (zone) {
        const wants = zone.action ?? "click";
        if (zone.copyText) {
          if (kind === "dblclick") {
            selected = zone.id;
            return { kind: "select", id: zone.id, text: zone.copyText };
          }
          return kind === "rightclick" ? (selected = zone.id, { kind: "select", id: zone.id, text: zone.copyText }) : { kind: "none" };
        }
        if (zone.role === "neutral") return { kind: "none" };
        if (wants === "dblclick") return kind === "dblclick" ? act(zone) : { kind: "none" };
        // The two clicks of a double click were already judged one by one.
        if (kind === "dblclick") return { kind: "none" };
        if (wants === kind) return act(zone);
        if (wants === "hover" || wants === "drag") return { kind: "none" };
      }
      if (kind === "dblclick") return { kind: "none" };
      return miss(x, y);
    },

    key(combo) {
      if (finished) return { kind: "none" };
      const binding = (current.keys ?? []).find((k) => k.keys === combo);
      if (binding) return act(binding);
      if ((combo === "Ctrl+C" || combo === "Meta+C") && selected) {
        const zone = (current.zones ?? []).find((z) => z.id === selected);
        if (zone?.copyText) {
          events.push({ t: t(), type: "copy", scene: current.id, id: zone.id });
          return { kind: "copy", text: zone.copyText };
        }
      }
      // An undescribed combination does nothing: it may have been pressed out of habit.
      return { kind: "none" };
    },

    commitField(fieldId, value) {
      if (finished) return { kind: "none" };
      const placement: FieldPlacement | undefined = (current.fields ?? []).find((p) => p.field === fieldId && p.editable);
      const def = fieldDefs.get(fieldId);
      if (!placement || !def) return { kind: "none" };
      values[fieldId] = value;
      const judged = !!def.check && (def.checkWhen ?? "input") === "input" && value.trim() !== "";
      const correct = judged ? passes(def.check, value) : null;
      wrong[fieldId] = correct === false;
      events.push({ t: t(), type: "value", scene: current.id, field: fieldId, value, correct });
      if (correct === false) {
        counts.wrongValues += 1;
        raiseError();
      } else if (correct === true && hintOn?.target === fieldId) {
        hintOn = null;
        localErrors = 0;
      }
      return { kind: "value", field: fieldId, correct };
    },

    expire(elementId) {
      visibility.set(elementId, false);
    },

    exit() {
      if (finished) return { kind: "none" };
      events.push({ t: t(), type: "exit" });
      finish("exited", null);
      return { kind: "done", outcome: "exited" };
    },

    timeout() {
      if (finished) return { kind: "none" };
      events.push({ t: t(), type: "timeout" });
      finish("timeout", null);
      return { kind: "done", outcome: "timeout" };
    },

    result() {
      return {
        format: RESULT_FORMAT,
        version: CONTRACT_VERSION,
        scenario: { title: scenario.meta.title },
        startedAt,
        durationMs: finished ? finished.at : t(),
        outcome: finished?.outcome ?? "exited",
        goal: finished?.goal ?? null,
        counts: { ...counts },
        traps: traps.slice(),
        fields: { ...values },
        events: events.slice(),
      };
    },
  };

  events.push({ t: 0, type: "enter", scene: current.id });
  if (current.goal) judgeGoal(current);
  return run;
}
