/**
 * @module shared/sim/contract-v1
 *
 * Version 1 of the scenario contract, kept only to READ what was written in it: exchange archives
 * made before version 2, questions saved before it and — for good — publication snapshots, which
 * are immutable. `./upgrade` turns it into the current contract; nothing writes version 1.
 *
 * Only what differs from version 2 is declared here; the rest is shared with `./contract`.
 */
import type { FieldDef, GoalCheck, MediaItem, SCENARIO_FORMAT, Scene, ScenarioMeta, Settings, Size } from "./contract";

/** `version` of a version 1 scenario. */
export const CONTRACT_V1 = 1;

/** Version 1 kept the goal, checks included, on the scene. */
export interface GoalV1 {
  outcome: "success" | "fail";
  message?: string;
  checks?: GoalCheck[];
}

/** A version 1 scene: `goal` instead of `end`, no stage of the task, reserved `views`. */
export interface SceneV1 extends Omit<Scene, "end" | "stage"> {
  goal?: GoalV1;
  /** Reserved for a phone layout; never authored, dropped by the upgrade. */
  views?: unknown[];
}

/** Version 1 settings also held the stage size and the narrowest window. */
export interface SettingsV1 extends Settings {
  stage?: Size;
  minViewportWidth?: number;
}

/** The whole version 1 `scenario.json`. */
export interface ScenarioV1 {
  format: typeof SCENARIO_FORMAT;
  version: typeof CONTRACT_V1;
  meta: ScenarioMeta;
  settings?: SettingsV1;
  media: MediaItem[];
  fields?: FieldDef[];
  start: string;
  scenes: SceneV1[];
}
