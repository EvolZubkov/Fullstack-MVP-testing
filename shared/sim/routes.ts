/**
 * @module shared/sim/routes
 *
 * Declared routes of a variant (`docs/specs/sim-scenario/v2-design.md`, section 2.3): which route a
 * run took, and what is wrong with the routes an author declared.
 *
 * A run follows a route when its accepted actions contain the route's key actions in order; other
 * actions between the keys do not break it. Of the routes a run follows, the best rating wins,
 * then the cheaper route, then the earlier one.
 *
 * Pure and framework-free.
 */
import type { Route, SimEvent, SimResult } from "./contract";
import { cheapestPath } from "./optimum";
import type { PlayableScenario } from "./variant";

/** An accepted action of a run: the action `action` of scene `scene`. */
export interface ActedStep {
  scene: string;
  action: string;
}

/** A route a run was recognized as, with the route's cost (`null` — unknown). */
export interface RecognizedRoute {
  route: Route;
  cost: number | null;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Accepted actions of a run, in order. */
export function actedSteps(result: Pick<SimResult, "events">): ActedStep[] {
  return result.events
    .filter((e): e is Extract<SimEvent, { type: "action" }> => e.type === "action")
    .map((e) => ({ scene: e.scene, action: e.id }));
}

/** Does a run, given by its accepted actions, follow the route? */
export function followsRoute(steps: readonly ActedStep[], route: Route): boolean {
  let i = 0;
  for (const step of steps) {
    const key = route.keys[i];
    if (!key) break;
    if (key.scene === step.scene && key.action === step.action) i += 1;
  }
  return route.keys.length > 0 && i === route.keys.length;
}

/**
 * The route a run took.
 *
 * @param play The scenario as the run's device plays it.
 * @param result The run.
 * @param costs Cost of each route by id; a route of unknown cost loses ties.
 * @returns The route, or `null` when the run follows none.
 */
export function recognizeRoute(
  play: PlayableScenario,
  result: Pick<SimResult, "events">,
  costs: ReadonlyMap<string, number | null>,
): RecognizedRoute | null {
  const steps = actedSteps(result);
  let best: RecognizedRoute | null = null;
  for (const route of play.routes) {
    if (!followsRoute(steps, route)) continue;
    const cost = costs.get(route.id) ?? null;
    const better = !best
      || route.rating > best.route.rating
      || (route.rating === best.route.rating && (cost ?? Infinity) < (best.cost ?? Infinity));
    if (better) best = { route, cost };
  }
  return best;
}

/** Cost of each declared route: the cheapest path through its keys; `null` — none or unknown. */
export function routeCosts(play: PlayableScenario): Map<string, number | null> {
  return new Map(play.routes.map((r) => {
    const found = cheapestPath(play, { keys: r.keys });
    return [r.id, found.status === "found" ? found.cost : null];
  }));
}

/**
 * What is wrong with the declared routes (v2-design.md section 2.6).
 *
 * @param play A variant that passed the structural checks: scenes and actions exist.
 */
export function routeProblems(play: PlayableScenario): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const scenes = new Map(play.scenes.map((s) => [s.id, s]));
  const sceneName = (id: string) => `«${scenes.get(id)?.title || id}»`;
  const seenIds = new Set<string>();
  const seenKeys = new Map<string, string>();

  for (const route of play.routes) {
    const name = `«${route.title || route.id}»`;
    if (!ID.test(route.id)) errors.push(`Маршрут ${name}: недопустимый id`);
    if (seenIds.has(route.id)) errors.push(`Маршрут ${name}: id ${route.id} уже занят`);
    seenIds.add(route.id);
    if (!route.title?.trim()) errors.push(`Маршрут ${route.id}: нет названия`);
    if (!(typeof route.rating === "number" && route.rating > 0 && route.rating <= 1)) {
      errors.push(`Маршрут ${name}: оценка должна быть больше 0 и не больше 1`);
    }
    if (!Array.isArray(route.keys) || route.keys.length === 0) {
      errors.push(`Маршрут ${name}: нет ключевых действий`);
      continue;
    }
    let broken = false;
    for (const key of route.keys) {
      const scene = scenes.get(key.scene);
      if (!scene) { errors.push(`Маршрут ${name}: сцены ${key.scene} нет`); broken = true; continue; }
      const action = [...(scene.zones ?? []), ...(scene.keys ?? [])].find((a) => a.id === key.action);
      if (!action) { errors.push(`Маршрут ${name}: на сцене ${sceneName(key.scene)} нет действия ${key.action}`); broken = true; }
      else if (action.role === "neutral") { errors.push(`Маршрут ${name}: ${key.action} на сцене ${sceneName(key.scene)} — нейтральная зона`); broken = true; }
    }
    const signature = JSON.stringify(route.keys.map((k) => [k.scene, k.action]));
    const twin = seenKeys.get(signature);
    if (twin) errors.push(`Маршруты ${twin} и ${name}: одинаковые ключевые действия`);
    else seenKeys.set(signature, name);
    if (broken) continue;
    const found = cheapestPath(play, { keys: route.keys });
    if (found.status === "none") errors.push(`Маршрут ${name}: до цели нельзя дойти через его ключевые действия по порядку`);
    if (found.status === "limit") warnings.push(`Маршрут ${name}: сценарий слишком велик, стоимость маршрута не посчитана`);
  }
  if (play.routes.length > 0 && !play.routes.some((r) => r.rating === 1)) {
    warnings.push("Ни у одного маршрута нет оценки 1: максимум балла меньше 100%");
  }
  return { errors, warnings };
}
