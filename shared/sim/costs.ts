/**
 * @module shared/sim/costs
 *
 * What an action costs, in steps (`docs/specs/sim-scenario/v2-design.md`, section 2.1). The run
 * cost and the optimum are sums of these: efficiency compares them.
 *
 * Resolution: the action's own `cost`, else the scenario's `settings.costs` for the action's kind,
 * else the system default. A negative or non-finite number is ignored at every level.
 *
 * Pure and framework-free.
 */
import type { ActionBase, ActionCosts, ActionKind, ZoneAction } from "./contract";

/** System defaults by kind. */
export const DEFAULT_ACTION_COSTS: Readonly<Record<ActionKind, number>> = Object.freeze({
  click: 1,
  dblclick: 1,
  rightclick: 1,
  hover: 0.5,
  drag: 1.5,
  tap: 1,
  doubletap: 1,
  longpress: 1,
  "swipe-left": 1,
  "swipe-right": 1,
  "swipe-up": 1,
  "swipe-down": 1,
  key: 0.5,
  field: 1,
});

const usable = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** An action as the cost reads it: a zone has `action`, a key binding has `keys`. */
export type CostedAction = ActionBase & { action?: ZoneAction; keys?: string };

/**
 * Cost of a zone or key binding.
 *
 * @param action The zone or key binding.
 * @param costs The scenario's defaults (`settings.costs`).
 */
export function actionCost(action: CostedAction, costs?: ActionCosts): number {
  if (usable(action.cost)) return action.cost;
  const kind: ActionKind = typeof action.keys === "string" ? "key" : (action.action ?? "click");
  const own = costs?.[kind];
  return usable(own) ? own : DEFAULT_ACTION_COSTS[kind];
}

/** Cost of committing a field value. */
export function fieldCost(costs?: ActionCosts): number {
  return usable(costs?.field) ? costs!.field! : DEFAULT_ACTION_COSTS.field;
}
