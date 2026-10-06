/**
 * @module shared/sim/browser-entry
 *
 * Entry of the browser bundle of the scenario player. esbuild turns it into an IIFE that
 * exposes `window.TBSim`; the dev player page uses it today, the SCORM package will use the
 * same bundle tomorrow.
 */
export { createRun } from "./engine";
export { mountPlayer, comboOf } from "./player";
export { diffScenes, appearSchedule } from "./diff";
export { SCENARIO_FORMAT, RESULT_FORMAT, CONTRACT_VERSION } from "./contract";
