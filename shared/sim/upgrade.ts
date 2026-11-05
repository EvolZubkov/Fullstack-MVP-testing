/**
 * @module shared/sim/upgrade
 *
 * One door into the scenario model: whatever version a scenario was written in, the code past
 * this module sees version 2 (`docs/specs/sim-scenario/v2-design.md`, section 1, «Перевод v1 в v2»).
 *
 * Why at READ time and not once in the database: publication snapshots are immutable and keep
 * version 1 for good, and the dev database is shared by every worktree — rewriting it would break
 * sessions still running version 1 code. New content is written as version 2 (archive import,
 * question save); old content is upgraded when read.
 *
 * The upgrade is mechanical and lossless for everything version 1 could express except `views`, a
 * phone layout that was reserved but never authored: it is dropped and named in the notes.
 *
 * Pure and framework-free: the SCORM runtime gets it through the `TBTemplate` bundle.
 */
import { CONTRACT_VERSION, SCENARIO_FORMAT, type Scenario } from "./contract";
import { CONTRACT_V1, type ScenarioV1 } from "./contract-v1";

/** A scenario of any version the module reads. */
export type ScenarioInput = Scenario | ScenarioV1;

/** A scenario that cannot be read as the current version. */
export class ScenarioUpgradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioUpgradeError";
  }
}

/** What an upgrade produced. */
export interface UpgradeOutcome {
  scenario: Scenario;
  /** What was not carried over, in words for the author; empty for a clean upgrade. */
  notes: string[];
}

/** What {@link liftV1} produced from a document of unknown quality. */
export interface LiftedV1 {
  /** The version 2 shape; invalid parts are carried over as they were, for the checks to name. */
  doc: Record<string, unknown>;
  notes: string[];
  /** Why the upgrade is impossible; `null` — it is possible. */
  conflict: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const upgraded = new WeakMap<object, Scenario>();

/**
 * Move a version 1 document into the version 2 shape without trusting it.
 *
 * The import checks run on what this returns, so a broken version 1 archive is reported in the
 * same words as a broken version 2 one. Nothing is validated or dropped here except `views`.
 *
 * @param raw A parsed `scenario.json` whose `version` is 1.
 */
export function liftV1(raw: Obj): LiftedV1 {
  const notes: string[] = [];
  const sceneList = Array.isArray(raw.scenes) ? raw.scenes : null;
  const success = (sceneList ?? []).filter(
    (s): s is Obj => isObj(s) && isObj(s.goal) && s.goal.outcome === "success",
  );
  const checkSets = new Set(success.map((s) => JSON.stringify((s.goal as Obj).checks ?? [])));
  const conflict = checkSets.size > 1
    ? `Сцены-цели ${success.map((s) => `«${String(s.title || s.id)}»`).join(", ")} проверяют разные поля: в версии 2 у сценария одна цель — оставьте у них одинаковые проверки`
    : null;

  const scenes = sceneList
    ? sceneList.map((s) => {
      if (!isObj(s)) return s;
      const { goal, views, ...rest } = s;
      if (Array.isArray(views) && views.length > 0) {
        notes.push(`Сцена «${String(s.title || s.id)}»: раскладка views версии 1 не переносится — телефон задаётся отдельным вариантом`);
      }
      if (goal === undefined) return rest;
      const { checks: _checks, ...end } = isObj(goal) ? goal : {};
      return { ...rest, end };
    })
    : raw.scenes;

  const { version: _version, scenes: _scenes, start, settings, ...common } = raw;
  const variant: Obj = { device: "desktop", start, scenes };
  let commonSettings: Obj | undefined;
  if (isObj(settings)) {
    const { stage, minViewportWidth, ...rest } = settings;
    if (stage !== undefined) variant.stage = stage;
    if (minViewportWidth !== undefined) variant.minViewportWidth = minViewportWidth;
    commonSettings = rest;
  } else if (settings !== undefined) {
    commonSettings = settings as Obj;
  }
  const doc: Obj = {
    ...common,
    version: CONTRACT_VERSION,
    kind: "control",
    ...(commonSettings !== undefined ? { settings: commonSettings } : {}),
    ...(success.length ? { goal: { checks: (success[0].goal as Obj).checks ?? [] } } : {}),
    variants: [variant],
  };
  return { doc, notes, conflict };
}

/**
 * Upgrade a version 1 scenario.
 *
 * @throws ScenarioUpgradeError when success scenes carry different checks — version 2 has one goal.
 */
export function upgradeV1(v1: ScenarioV1): UpgradeOutcome {
  const { doc, notes, conflict } = liftV1(v1 as unknown as Obj);
  if (conflict) throw new ScenarioUpgradeError(conflict);
  return { scenario: doc as unknown as Scenario, notes };
}

/**
 * Upgrade a scenario of any known version to the current one.
 *
 * @throws ScenarioUpgradeError on an unknown version or an upgrade that cannot be done.
 */
export function upgradeScenario(input: ScenarioInput): UpgradeOutcome {
  if (input.version === CONTRACT_VERSION) return { scenario: input as Scenario, notes: [] };
  if (input.version === CONTRACT_V1) return upgradeV1(input as ScenarioV1);
  throw new ScenarioUpgradeError(`Неизвестная версия формата ${String((input as { version?: unknown }).version)}`);
}

/**
 * The scenario in the current version. The upgrade of a given input object is done once.
 *
 * @throws ScenarioUpgradeError as {@link upgradeScenario}.
 */
export function asScenario(input: ScenarioInput): Scenario {
  if (input.version === CONTRACT_VERSION) return input as Scenario;
  const known = upgraded.get(input);
  if (known) return known;
  const { scenario } = upgradeScenario(input);
  upgraded.set(input, scenario);
  return scenario;
}

/**
 * The scenario of a question's content (`questions.dataJson`), in the current version.
 *
 * @returns `null` when there is no scenario or it cannot be read — the caller treats the question
 *   as having no playable scenario, as it did before.
 */
export function scenarioOf(dataJson: unknown): Scenario | null {
  const raw = isObj(dataJson) ? dataJson.scenario : undefined;
  if (!isObj(raw) || raw.format !== SCENARIO_FORMAT) return null;
  try {
    return asScenario(raw as unknown as ScenarioInput);
  } catch {
    return null;
  }
}

/**
 * Question content with its scenario in the current version — what is written back. Content
 * without a readable scenario is returned as it is.
 */
export function withCurrentScenario<T>(dataJson: T): T {
  const scenario = scenarioOf(dataJson);
  if (!scenario || (dataJson as Obj).scenario === scenario) return dataJson;
  return { ...(dataJson as Obj), scenario } as T;
}
