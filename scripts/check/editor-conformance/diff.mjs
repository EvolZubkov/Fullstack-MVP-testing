/**
 * @module scripts/check/editor-conformance/diff
 * @description Pure comparison of two structural inventories against a baseline.
 *
 * Why the baseline exists. A checker that simply prints its differences is ignored the day it
 * prints two hundred of them, and this drawer starts with exactly that many. The baseline
 * turns the backlog into a ratchet: known divergences are listed, anything else fails the run,
 * and entries that stop occurring are reported so they can be struck off. That makes "the
 * batch is done" a machine verdict rather than an opinion — which is the whole reason this
 * effort exists.
 */

/**
 * Stable identity of one inventory item, as a JSON triple.
 *
 * The index is deliberately excluded so that a moved element is reported once as an order
 * change rather than twice as a removal and an addition. The variant IS included: «Отменить»
 * as a secondary button and as a ghost button are different contracts, and the report has
 * findings that turn on exactly that.
 *
 * JSON rather than a joined string: captions contain spaces, quotes and punctuation, so any
 * hand-picked separator either collides with the text or has to be an unprintable character —
 * and an unprintable one makes git treat the source as binary and drop its line history.
 *
 * @param {{role: string, text: string, variant?: string}} item
 * @returns {string}
 */
const keyOf = (item) => JSON.stringify([item.role, item.text, item.variant ?? ""]);

/**
 * @param {Array<object>} wireframe Inventory taken on the wireframe.
 * @param {Array<object>} implementation Inventory taken on the live drawer.
 * @returns {Array<{op: "missing"|"extra"|"order", role: string, text: string, index: number}>}
 */
export function diffInventories(wireframe, implementation) {
  const out = [];
  const wfKeys = wireframe.map(keyOf);
  const implKeys = implementation.map(keyOf);
  const wfSet = new Set(wfKeys);
  const implSet = new Set(implKeys);

  wireframe.forEach((item, index) => {
    if (!implSet.has(keyOf(item))) {
      out.push({ op: "missing", role: item.role, text: item.text, index });
    }
  });
  implementation.forEach((item, index) => {
    if (!wfSet.has(keyOf(item))) {
      out.push({ op: "extra", role: item.role, text: item.text, index });
    }
  });

  // Order is compared over the elements both sides have: reporting an order change on top of a
  // missing element would blame the sequence for a hole somebody else already reported.
  const commonWf = wfKeys.filter((k) => implSet.has(k));
  const commonImpl = implKeys.filter((k) => wfSet.has(k));
  for (let i = 0; i < commonWf.length; i += 1) {
    if (commonWf[i] !== commonImpl[i]) {
      const [role, text] = JSON.parse(commonWf[i]);
      out.push({ op: "order", role, text, index: i });
      break;
    }
  }
  return out;
}

/**
 * Matches a run's divergences against the accepted ones.
 *
 * The `state` field takes part in matching when both sides carry it: the same caption occurs on
 * several tabs, and a baseline entry recorded for one tab must not silently excuse the same
 * problem appearing on another.
 *
 * @param {Array<object>} diff Result of {@link diffInventories}, optionally carrying `state`.
 * @param {Array<object>} baseline Accepted divergences.
 * @returns {{unexpected: Array<object>, stale: Array<object>}}
 */
export function applyBaseline(diff, baseline) {
  const matched = new Set();
  const unexpected = [];

  // One diff item consumes one baseline entry. Matching every occurrence to the FIRST equal
  // entry leaves the duplicates unmatched, and they are then reported as "stopped occurring" —
  // a green run that claims ninety-two things were fixed teaches everyone to ignore the line.
  for (const item of diff) {
    const index = baseline.findIndex(
      (b, i) =>
        !matched.has(i) &&
        b.op === item.op &&
        b.role === item.role &&
        b.text === item.text &&
        (b.state === undefined || item.state === undefined || b.state === item.state),
    );
    if (index >= 0) matched.add(index);
    else unexpected.push(item);
  }

  const stale = baseline.filter((_, index) => !matched.has(index));
  return { unexpected, stale };
}
