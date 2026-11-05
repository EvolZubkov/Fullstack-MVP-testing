/**
 * @module shared/sim/analysis
 *
 * What a run says beyond its outcome (`docs/specs/sim-scenario/v2-design.md`, sections 2.4, 2.5,
 * 4.2): its cost against the optimum, the route taken, efficiency, lostness — and the four axes of
 * the `axes` scoring model.
 *
 * Two layers. {@link analyzeRun} depends on the scenario and the run only: the analytics of a
 * research scenario reads it as is. {@link axesOf} adds what the TEST decides — partial credit,
 * penalties, which axes take part. The axes multiply: a missed goal is 0, a flawless run on the best
 * route is 1.
 *
 * Pure and framework-free.
 */
import type { SimResult } from "./contract";
import { cheapestPath, type PathSearch } from "./optimum";
import { recognizeRoute, routeCosts } from "./routes";
import { goalShare, penaltyShare, type SimPenalties } from "./scoring";
import type { ScenarioInput } from "./upgrade";
import { playable, type PlayableScenario } from "./variant";

/** The scenario-and-run facts of one run. */
export interface RunAnalysis {
  /** Cost of the accepted actions. */
  cost: number;
  /** Cost of the cheapest way; `null` — none, or the scenario is too large to search. */
  optimum: number | null;
  route: { id: string; title: string; rating: number; cost: number | null } | null;
  /** In [0; 1]; `null` — cannot be judged: no optimum and no route. */
  efficiency: number | null;
  /** Smith's lostness; `null` — no optimum or no scenes entered. */
  lostness: number | null;
}

/** The four axes of the `axes` model, each in [0; 1]. */
export interface SimAxes {
  result: number;
  efficiency: number;
  accuracy: number;
  time: number;
}

/** What the test sets for the axes. */
export interface AxesSettings {
  countPartial: boolean;
  penalties: SimPenalties;
  efficiency: boolean;
  time: boolean;
}

interface Paths {
  best: PathSearch;
  routes: Map<string, number | null>;
}

const paths = new WeakMap<PlayableScenario, Paths>();

/** The searches of a scenario, done once per device view. */
function pathsOf(play: PlayableScenario): Paths {
  let known = paths.get(play);
  if (!known) {
    known = { best: cheapestPath(play), routes: routeCosts(play) };
    paths.set(play, known);
  }
  return known;
}

/**
 * Efficiency of a run (v2-design.md section 2.4).
 *
 * @param cost Cost of the run.
 * @param optimum Cost of the cheapest way; `null` — unknown.
 * @param route The route recognized: its rating and cost; `null` — none.
 * @param otherRouteRating Rating of a run outside the declared routes; absent — judged by the optimum.
 */
export function efficiency(
  cost: number,
  optimum: number | null,
  route: { rating: number; cost: number | null } | null,
  otherRouteRating: number | undefined,
): number | null {
  const cleanness = (best: number | null): number | null =>
    best === null ? null : cost <= 0 ? 1 : Math.min(1, best / cost);
  if (route) return route.rating * (cleanness(route.cost) ?? 1);
  const byOptimum = cleanness(optimum);
  if (otherRouteRating !== undefined) return otherRouteRating * (byOptimum ?? 1);
  return byOptimum;
}

/**
 * Smith's lostness `√((N/S − 1)² + (R/N − 1)²)`: S — scenes entered, N — distinct of them, R —
 * scenes on the optimal path. 0 — went straight, the larger the more lost.
 */
export function lostness(result: Pick<SimResult, "events">, optimalScenes: number | null): number | null {
  const entered = result.events.filter((e) => e.type === "enter").map((e) => (e as { scene: string }).scene);
  const s = entered.length;
  const n = new Set(entered).size;
  if (s === 0 || n === 0 || optimalScenes === null) return null;
  return Math.sqrt((n / s - 1) ** 2 + (optimalScenes / n - 1) ** 2);
}

/** The time axis: the norm over the duration, at most 1; no norm — 1. */
export function timeAxis(durationMs: number, normSeconds: number | undefined): number {
  if (!normSeconds || normSeconds <= 0 || durationMs <= 0) return 1;
  return Math.min(1, (normSeconds * 1000) / durationMs);
}

/**
 * The facts of a run.
 *
 * @param scenario The scenario of any version, or a device view.
 * @param result The run — a replayed one, so its events are the engine's.
 */
export function analyzeRun(scenario: ScenarioInput | PlayableScenario, result: SimResult): RunAnalysis {
  const play = playable(scenario, result.variant ?? "desktop");
  const { best, routes } = pathsOf(play);
  const optimum = best.status === "found" ? best.cost : null;
  const recognized = recognizeRoute(play, result, routes);
  const cost = typeof result.cost === "number" ? result.cost : 0;
  const route = recognized
    ? { id: recognized.route.id, title: recognized.route.title, rating: recognized.route.rating, cost: recognized.cost }
    : null;
  return {
    cost,
    optimum,
    route,
    efficiency: efficiency(cost, optimum, route, play.settings.otherRouteRating),
    lostness: lostness(result, best.status === "found" ? new Set(best.scenes).size : null),
  };
}

/**
 * The four axes of a run under the test's settings.
 *
 * Accuracy leaves the detour penalty out: a detour already made the run dearer, and the efficiency
 * axis counts it.
 */
export function axesOf(result: SimResult, analysis: RunAnalysis, settings: AxesSettings, normSeconds?: number): SimAxes {
  return {
    result: goalShare(result, settings.countPartial),
    efficiency: settings.efficiency ? (analysis.efficiency ?? 1) : 1,
    accuracy: Math.max(0, 1 - penaltyShare(result, { ...settings.penalties, detour: 0 })),
    time: settings.time ? timeAxis(result.durationMs, normSeconds) : 1,
  };
}

/** The share of the price the axes give: their product, in [0; 1]. */
export function axesRatio(axes: SimAxes): number {
  return Math.max(0, Math.min(1, axes.result * axes.efficiency * axes.accuracy * axes.time));
}
