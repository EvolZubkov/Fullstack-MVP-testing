/**
 * @module shared/sim/variant
 *
 * The scenario as ONE device plays it: the common part merged with one variant into a flat view —
 * what the engine, the player, the cover and the analytics read.
 *
 * The view keeps the names the single-graph version 1 had (`start`, `scenes`, `settings.stage`,
 * `settings.minViewportWidth`), so code that walks a graph does not care that a scenario has
 * several. The view is derived, never stored and never sent anywhere.
 *
 * Pure and framework-free.
 */
import type {
  Device, FieldDef, Goal, MediaItem, Route, Scenario, ScenarioKind, ScenarioMeta, Scene, Settings, Size, StageDef,
} from "./contract";
import { asScenario, ScenarioUpgradeError, type ScenarioInput } from "./upgrade";

/** The device a scenario plays on when none is named. */
export const DEFAULT_DEVICE: Device = "desktop";

/** Common settings plus what the variant sets for its device. */
export interface PlayableSettings extends Settings {
  stage?: Size;
  minViewportWidth?: number;
}

/** One device's view of a scenario. */
export interface PlayableScenario {
  kind: ScenarioKind;
  device: Device;
  meta: ScenarioMeta;
  settings: PlayableSettings;
  media: MediaItem[];
  fields: FieldDef[];
  goal: Goal | null;
  stages: StageDef[];
  start: string;
  scenes: Scene[];
  routes: Route[];
}

const views = new WeakMap<Scenario, Map<Device, PlayableScenario>>();

/** Is the value already a device view? A stored scenario never is: it has no `device`. */
export function isPlayable(value: unknown): value is PlayableScenario {
  return typeof value === "object" && value !== null
    && typeof (value as { device?: unknown }).device === "string"
    && Array.isArray((value as { scenes?: unknown }).scenes);
}

/**
 * The view of a scenario for a device.
 *
 * @param input A scenario of any version, or a view already built (returned as it is).
 * @param device The device; desktop by default.
 * @throws ScenarioUpgradeError when the scenario cannot be read or has no variant for the device.
 */
export function playable(input: ScenarioInput | PlayableScenario, device: Device = DEFAULT_DEVICE): PlayableScenario {
  if (isPlayable(input)) return input;
  const scenario = asScenario(input);
  let byDevice = views.get(scenario);
  const known = byDevice?.get(device);
  if (known) return known;
  const variant = scenario.variants.find((v) => v.device === device);
  if (!variant) throw new ScenarioUpgradeError(`В сценарии нет варианта для устройства ${device}`);
  const view: PlayableScenario = {
    kind: scenario.kind,
    device,
    meta: scenario.meta,
    settings: {
      ...scenario.settings,
      ...(variant.stage ? { stage: variant.stage } : {}),
      ...(variant.minViewportWidth !== undefined ? { minViewportWidth: variant.minViewportWidth } : {}),
    },
    media: scenario.media,
    fields: scenario.fields ?? [],
    goal: scenario.goal ?? null,
    stages: scenario.stages ?? [],
    start: variant.start,
    scenes: variant.scenes,
    routes: variant.routes ?? [],
  };
  if (!byDevice) {
    byDevice = new Map();
    views.set(scenario, byDevice);
  }
  byDevice.set(device, view);
  return view;
}
