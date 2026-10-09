/**
 * @module scripts/check/editor-conformance/expectations
 * @description Reads the spacing contract straight out of the approved wireframe.
 *
 * Why this exists. The target wireframe `docs/wireframes/editor-settings-target.html` carries
 * its own `<style>` block in which every deliberate deviation from the design system is
 * written down as `selector { prop: var(--ou-space-N) } /* ui-kit: 20 -> 24 *\/`. That comment
 * IS the contract for the 4/16/24 modular grid — there is no other place it is recorded.
 * Re-typing those rules into a checker would reintroduce exactly the transcription step that
 * lost six of them during the editor restructure (acceptance 2026-09-04, findings G-1..G-6),
 * so the checker parses them instead: edit the wireframe and the expectations move with it.
 *
 * Deliberate under-capture: rules that pack two declarations into one line (`.page-row__meta`
 * sets `gap` and `padding-top` together) are skipped rather than half-parsed. Missing an
 * expectation only weakens the guard; inventing one would make it fail on correct code, which
 * is far worse — a guard nobody trusts gets switched off.
 */

import { readFileSync } from "node:fs";

/** Design-system spacing scale, in px, indexed by the `--ou-space-N` token number. */
const SPACE_SCALE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 32, 8: 40, 9: 48, 10: 56 };

/**
 * One overriding rule: a single selector, a single spacing declaration, and a comment stating
 * the value it overrides to. The trailing `(\d+)` is the TARGET of the comment arrow, which is
 * compared against the token so a stale comment cannot pass silently.
 */
const RULE =
  /^\s*(\.[^{}]+?)\s*\{\s*([a-z-]+)\s*:\s*var\(--ou-space-(\d+)\)\s*;?\s*\}\s*\/\*\s*(?:ui-kit|проектный слой)\s*:[^*]*?->\s*(\d+)/;

/**
 * Splits the wireframe's overrides into expectations the guard can enforce and rules where the
 * wireframe disagrees with itself.
 *
 * A contradiction is a defect OF THE WIREFRAME — the token and the comment state different
 * values — and only the owner may resolve it, so the guard reports it and moves on instead of
 * throwing. Throwing would make the whole guard unusable until an owner decision arrives, and
 * a guard that cannot run protects nothing. Such rules are also kept OUT of the expectations:
 * enforcing a value the wireframe is not sure about would fail the build on correct code.
 *
 * @param {string} css Contents of the wireframe's inline style block.
 * @returns {{expectations: Array<{selector: string, property: string, expected: string}>,
 *            contradictions: Array<{selector: string, property: string, token: number, stated: number}>}}
 */
export function parseOverrides(css) {
  const expectations = [];
  const contradictions = [];
  for (const line of css.split(/\r?\n/)) {
    const m = RULE.exec(line);
    if (!m) continue;
    const [, rawSelector, property, token, stated] = m;
    const selector = rawSelector.trim();
    const fromToken = SPACE_SCALE[Number(token)];
    if (fromToken === undefined) continue;
    if (fromToken !== Number(stated)) {
      contradictions.push({ selector, property, token: fromToken, stated: Number(stated) });
      continue;
    }
    expectations.push({ selector, property, expected: `${fromToken}px` });
  }
  return { expectations, contradictions };
}

/**
 * @param {string} wireframePath Absolute path to the target wireframe.
 * @returns {{expectations: Array<{selector: string, property: string, expected: string}>,
 *            contradictions: Array<{selector: string, property: string, token: number, stated: number}>}}
 */
export function readExpectations(wireframePath) {
  const html = readFileSync(wireframePath, "utf8");
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  return parseOverrides(styles);
}
