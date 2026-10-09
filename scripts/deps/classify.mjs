/**
 * @module scripts/deps/classify
 * @description Turns one findArtifacts response into a verdict about one package.
 *
 * The API matches a version as a SUBSTRING, not a prefix and not an exact value. A recorded
 * request for `zod@4.4` came back with eight records, one of them `0.4.42` — a version that
 * does not even START with `4.4`, it only contains that sequence somewhere inside. A substring
 * match is more dangerous than a prefix match would have been: the hit can come from anywhere
 * in the candidate string, so nothing about record order, or even about how narrow the query
 * looked, can be trusted. The verdict is therefore only ever read off a record whose version
 * matches ours with strict equality.
 *
 * An empty answer means the package is absent from the corporate base and has to be requested.
 * A non-empty answer that still has no exact match is a different situation for a human reading
 * the report: neighbouring versions exist, and one of them may already be permitted, so the
 * action is "take the neighbour" rather than "file a request". Both cases keep the same
 * `ABSENT` status and `block` outcome (a build cannot ship either way), but the second one lists
 * the neighbours it found in `comment`.
 */

/** @enum {string} */
export const OUTCOME = { OK: "ok", WARN: "warn", BLOCK: "block", ERROR: "error" };

/**
 * How each known status maps onto an outcome. A status missing from this table is NOT treated
 * as permission: the vocabulary was recovered from the client bundle, not from documentation,
 * so an unfamiliar value means we learned something, and the report must show it.
 */
const STATUS_OUTCOME = {
  PERMITTED: OUTCOME.OK,
  RESTRICTED: OUTCOME.BLOCK,
  PARTIALLY_PERMITTED: OUTCOME.WARN,
  REQUESTED: OUTCOME.WARN,
  VERIFICATION: OUTCOME.WARN,
  NOTFOUND: OUTCOME.WARN,
  UNCHECKABLE: OUTCOME.WARN,
  UNDEFINED: OUTCOME.WARN,
};

/** How many neighbouring versions go into the ABSENT comment before it is cut off. */
const MAX_NEIGHBOURS = 5;

/**
 * @typedef {Object} Verdict
 * @property {string} id Lockfile identity, e.g. "express@5.2.1".
 * @property {string} name Package name without scope.
 * @property {string} scope Package scope, or "" when unscoped.
 * @property {string} version
 * @property {boolean} dev Whether the package is dev-only (drives the exit-code policy).
 * @property {string[]} requiredBy The "who pulls it in" chain the report prints.
 * @property {string} outcome One of {@link OUTCOME}.
 * @property {string} status The system's status string, or a synthetic one ("ABSENT",
 *   "UNDEFINED", "ERROR") when the system did not supply one.
 * @property {boolean} known Whether `status` is a value this module recognises. False for a
 *   status the vocabulary does not list, and false when the response had no status at all — the
 *   two are different findings and must not collapse into the same flag.
 * @property {string|null} zone "MAIN" / "ISOLATED" from the matched record, or null when there
 *   is no matched record.
 * @property {string} comment Free text: the system's own comment, or (for ABSENT with
 *   neighbours) a client-built summary of the near-miss versions.
 * @property {object[]} alerts Vulnerability alerts from the matched record, or [].
 */

/**
 * The passport fields every verdict carries regardless of outcome — pulled from the package,
 * never invented.
 *
 * @param {object} pkg Package as produced by `parseLockfile`.
 * @returns {{id: string, name: string, scope: string, version: string, dev: boolean,
 *   requiredBy: string[]}}
 */
function passport(pkg) {
  return {
    id: pkg.id,
    name: pkg.name,
    scope: pkg.scope,
    version: pkg.version,
    dev: pkg.dev,
    requiredBy: pkg.requiredBy ?? [],
  };
}

/**
 * Finds the record that is exactly this package, or null.
 *
 * A missing scope is normalised to "" on both sides as a defensive measure: the recorded HAR
 * session never actually returned `scope: null` (every record used "" or a real scope), but
 * nothing documents the API well enough to rule it out, and treating an unseen `null` as a
 * mismatch would risk a false "not in the base" for an unscoped package.
 *
 * @param {Array<object>|null|undefined} artifacts Records from `findArtifacts`.
 * @param {{name: string, scope: string, version: string}} pkg
 * @returns {object|null} The first exact match, or null when none exists.
 */
export function matchArtifact(artifacts, pkg) {
  const wanted = pkg.scope ?? "";
  return (
    (artifacts ?? []).find(
      (a) => a?.npm?.name === pkg.name && (a?.npm?.scope ?? "") === wanted && a?.npm?.version === pkg.version,
    ) ?? null
  );
}

/**
 * Renders the near-miss versions of an ABSENT verdict, so a human can consider "take the
 * neighbour" instead of "file a request". Only records for the same name+scope count as
 * neighbours; the substring search can in principle return noise, and this module does not
 * trust the network layer to have filtered it.
 *
 * @param {Array<object>|null|undefined} artifacts Records from `findArtifacts`.
 * @param {{name: string, scope: string}} pkg
 * @returns {string} "" when there is nothing to show.
 */
function describeNeighbours(artifacts, pkg) {
  const wanted = pkg.scope ?? "";
  const neighbours = (artifacts ?? []).filter((a) => a?.npm?.name === pkg.name && (a?.npm?.scope ?? "") === wanted);
  if (neighbours.length === 0) {
    return "";
  }
  const list = neighbours
    .slice(0, MAX_NEIGHBOURS)
    .map((a) => `${a.npm.version} (${a.state?.status ?? "UNDEFINED"})`)
    .join(", ");
  return `в базе есть ${list}`;
}

/**
 * @param {object} pkg Package as produced by `parseLockfile`.
 * @param {Array<object>|null|undefined} artifacts Records from `findArtifacts`.
 * @returns {Verdict}
 */
export function classify(pkg, artifacts) {
  const base = passport(pkg);
  const matched = matchArtifact(artifacts, pkg);
  if (!matched) {
    return {
      ...base,
      outcome: OUTCOME.BLOCK,
      status: "ABSENT",
      known: true,
      zone: null,
      comment: describeNeighbours(artifacts, pkg),
      alerts: [],
    };
  }
  // A status is only "known" when the response actually supplied one: a record with no
  // `state.status` at all is a different finding from the system explicitly answering
  // "UNDEFINED", and collapsing them into the same flag would hide that we learned nothing.
  const hasStatus = typeof matched.state?.status === "string";
  const status = hasStatus ? matched.state.status : "UNDEFINED";
  return {
    ...base,
    outcome: STATUS_OUTCOME[status] ?? OUTCOME.WARN,
    status,
    known: hasStatus && Object.hasOwn(STATUS_OUTCOME, status),
    zone: matched.state?.zone ?? null,
    comment: matched.state?.comment ?? "",
    alerts: matched.alerts ?? [],
  };
}

/**
 * Verdict for a package this module's caller failed to even ask about (network error, or 5xx
 * after retries) — kept separate from `classify`'s outcomes so the report can tell "the system
 * spoke and we didn't like the answer" from "the system never answered".
 *
 * @param {object} pkg Package as produced by `parseLockfile`.
 * @param {Error} error The error that ended the attempt.
 * @returns {Verdict}
 */
export function failed(pkg, error) {
  return {
    ...passport(pkg),
    outcome: OUTCOME.ERROR,
    status: "ERROR",
    known: true,
    zone: null,
    comment: error.message,
    alerts: [],
  };
}
