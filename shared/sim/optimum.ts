/**
 * @module shared/sim/optimum
 *
 * The cheapest way through a scenario (`docs/specs/sim-scenario/v2-design.md`, section 2.2): the
 * optimum `C*` efficiency is measured against, and the cost of a declared route.
 *
 * The search is Dijkstra over run STATES, not scenes: a state is the scene, the visibility of
 * elements, the values of fields and how many route keys are passed. So conditions of zones
 * («Сохранить» opens only with filled fields) are honoured. Assumptions:
 * - a keyboard field is filled correctly by one action, its commit cost;
 * - a field filled by effects gets only the values effects write;
 * - traps are never taken; detours are, unless excluded;
 * - misses and refusals are errors, never moves of a cheapest path.
 *
 * The target is a `success` end with every goal check passed (control) or a target finale
 * (research). The search stops after {@link MAX_STATES} expanded states and says so: the optimum
 * is then unknown, not guessed.
 *
 * Pure and framework-free.
 */
import { checkRuleSet, type AnswerRuleSet } from "@shared/answer-check";
import type { Condition, Effect, KeyBinding, RouteKey, Scene, Zone } from "./contract";
import { actionCost, fieldCost } from "./costs";
import type { PlayableScenario } from "./variant";

/** Most states a search expands before giving up. */
export const MAX_STATES = 100_000;

/** Prefix of a step that commits a field: `field:<id>`. */
export const FIELD_STEP = "field:";

/** The value of a keyboard field the search «typed»: correct by assumption. */
const TYPED = "\u0000typed";

/** One move of a path: an action of a scene, or `field:<id>` — committing that field. */
export interface PathStep {
  scene: string;
  action: string;
}

/** What a search found. */
export type PathSearch =
  | { status: "found"; cost: number; steps: PathStep[]; scenes: string[] }
  | { status: "none" }
  | { status: "limit" };

/** Options of {@link cheapestPath}. */
export interface PathOptions {
  /** Key actions to pass in order — a declared route. */
  keys?: RouteKey[];
  /** Allow detour actions; default `true`. */
  detours?: boolean;
  /** Most states to expand; default {@link MAX_STATES}. */
  maxStates?: number;
}

interface State {
  scene: string;
  key: number;
  visible: Map<string, boolean>;
  values: Map<string, string>;
}

type Verdict = "target" | "dead" | null;

/** A binary min-heap; equal costs leave in insertion order, so results are deterministic. */
class Heap<T> {
  private items: { cost: number; seq: number; value: T }[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(cost: number, value: T): void {
    const items = this.items;
    items.push({ cost, seq: this.seq++, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  pop(): { cost: number; value: T } | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(l, m)) m = l;
        if (r < items.length && this.less(r, m)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        i = m;
      }
    }
    return { cost: top.cost, value: top.value };
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a];
    const y = this.items[b];
    return x.cost < y.cost || (x.cost === y.cost && x.seq < y.seq);
  }
}

const sorted = (m: Map<string, unknown>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

function keyOf(s: State): string {
  const vis = sorted(s.visible).map(([k, v]) => `${k}=${v ? 1 : 0}`).join(",");
  const val = sorted(s.values).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join(",");
  return `${s.scene}|${s.key}|${vis}|${val}`;
}

const clone = (s: State): State => ({ scene: s.scene, key: s.key, visible: new Map(s.visible), values: new Map(s.values) });

function passes(check: AnswerRuleSet | undefined, value: string): boolean {
  if (value === TYPED) return true;
  if (!check) return value.trim() !== "";
  return checkRuleSet(check, value).passed;
}

/**
 * The cheapest path from the start to the target.
 *
 * @param play The scenario as one device plays it.
 * @param options Route keys, detours, the state limit.
 */
export function cheapestPath(play: PlayableScenario, options: PathOptions = {}): PathSearch {
  const scenes = new Map(play.scenes.map((s) => [s.id, s]));
  const defs = new Map(play.fields.map((f) => [f.id, f]));
  const keys = options.keys ?? [];
  const detours = options.detours !== false;
  const limit = options.maxStates ?? MAX_STATES;

  const isVisible = (s: State, id: string): boolean => {
    const own = s.visible.get(id);
    if (own !== undefined) return own;
    return !(scenes.get(s.scene)?.elements.find((e) => e.id === id)?.hidden ?? false);
  };

  const holds = (c: Condition, s: State): boolean => {
    if ("filled" in c) return c.filled.every((f) => (s.values.get(f) ?? "").trim() !== "");
    if ("field" in c) return passes(c.check, s.values.get(c.field) ?? "");
    if ("visible" in c) return isVisible(s, c.visible);
    if ("all" in c) return c.all.every((x) => holds(x, s));
    if ("any" in c) return c.any.some((x) => holds(x, s));
    return !holds(c.not, s);
  };

  const verdictOf = (scene: Scene, s: State): Verdict => {
    const end = scene.end;
    if (!end) return null;
    if (s.key < keys.length) return "dead";
    if (end.outcome === "success") {
      if (play.kind !== "control") return "dead";
      const ok = (play.goal?.checks ?? []).every((c) =>
        passes(c.check ?? defs.get(c.field)?.check, s.values.get(c.field) ?? ""));
      return ok ? "target" : "dead";
    }
    if (end.outcome === "finale") return play.kind === "research" && end.target === true ? "target" : "dead";
    return "dead";
  };

  /** Apply effects like the engine does; answers the verdict of the scene entered last. */
  const apply = (effects: Effect[] | undefined, s: State): Verdict => {
    let verdict: Verdict = null;
    for (const e of effects ?? []) {
      if (verdict) break;
      if ("goto" in e) {
        s.scene = e.goto;
        const scene = scenes.get(e.goto);
        verdict = scene ? verdictOf(scene, s) : "dead";
      } else if ("show" in e) s.visible.set(e.show, true);
      else if ("hide" in e) s.visible.set(e.hide, false);
      else if ("toggle" in e) s.visible.set(e.toggle, !isVisible(s, e.toggle));
      else if ("set" in e) s.values.set(e.set, e.value);
      else if ("clear" in e) s.values.delete(e.clear);
    }
    return verdict;
  };

  const initial: State = {
    scene: play.start,
    key: 0,
    visible: new Map(),
    values: new Map(play.fields.filter((f) => f.initial).map((f) => [f.id, f.initial as string])),
  };
  const startScene = scenes.get(play.start);
  if (!startScene) return { status: "none" };
  const startVerdict = verdictOf(startScene, initial);
  if (startVerdict === "target") return { status: "found", cost: 0, steps: [], scenes: [play.start] };
  if (startVerdict === "dead") return { status: "none" };

  const best = new Map<string, number>();
  const parent = new Map<string, { prev: string; step: PathStep; scene: string } | null>();
  const targets = new Set<string>();
  const heap = new Heap<{ key: string; state: State }>();
  const startKey = keyOf(initial);
  best.set(startKey, 0);
  parent.set(startKey, null);
  heap.push(0, { key: startKey, state: initial });
  let expanded = 0;

  const relax = (from: string, cost: number, step: PathStep, next: State, verdict: Verdict): void => {
    if (verdict === "dead") return;
    const key = verdict === "target" ? `target|${keyOf(next)}` : keyOf(next);
    const known = best.get(key);
    if (known !== undefined && known <= cost) return;
    best.set(key, cost);
    parent.set(key, { prev: from, step, scene: next.scene });
    if (verdict === "target") targets.add(key);
    heap.push(cost, { key, state: next });
  };

  while (heap.size > 0) {
    const { cost, value } = heap.pop()!;
    if (cost > (best.get(value.key) ?? Infinity)) continue;
    if (targets.has(value.key)) return { status: "found", cost, ...trace(value.key, parent, play.start) };
    if (++expanded > limit) return { status: "limit" };
    const state = value.state;
    const scene = scenes.get(state.scene);
    if (!scene) continue;

    const actions: Array<Zone | KeyBinding> = [...(scene.zones ?? []), ...(scene.keys ?? [])];
    for (const a of actions) {
      if (a.role === "neutral" || a.role === "trap") continue;
      if (!detours && a.role === "detour") continue;
      if (a.when && !holds(a.when, state)) continue;
      const next = clone(state);
      const nextKey = keys[state.key];
      if (nextKey && nextKey.scene === state.scene && nextKey.action === a.id) next.key += 1;
      const verdict = apply(a.effects, next);
      relax(value.key, cost + actionCost(a, play.settings.costs), { scene: state.scene, action: a.id }, next, verdict);
    }
    for (const p of scene.fields ?? []) {
      const def = defs.get(p.field);
      if (!p.editable || def?.fill !== "keyboard" || state.values.get(p.field) === TYPED) continue;
      const next = clone(state);
      next.values.set(p.field, TYPED);
      relax(value.key, cost + fieldCost(play.settings.costs), { scene: state.scene, action: `${FIELD_STEP}${p.field}` }, next, null);
    }
  }
  return { status: "none" };
}

/** Steps and visited scenes from the start to a target, read back through the parent links. */
function trace(
  key: string,
  parent: Map<string, { prev: string; step: PathStep; scene: string } | null>,
  start: string,
): { steps: PathStep[]; scenes: string[] } {
  const steps: PathStep[] = [];
  const entered: string[] = [];
  let at: string | undefined = key;
  while (at !== undefined) {
    const link = parent.get(at);
    if (!link) break;
    steps.push(link.step);
    entered.push(link.scene);
    at = link.prev;
  }
  steps.reverse();
  entered.reverse();
  const scenes = [start];
  for (const s of entered) if (scenes[scenes.length - 1] !== s) scenes.push(s);
  return { steps, scenes };
}
