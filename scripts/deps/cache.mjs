/**
 * @module scripts/deps/cache
 * @description On-disk cache of findArtifacts answers, one file per package version.
 *
 * The cache is what makes the timid pace affordable: a full run costs minutes, a repeat run
 * costs only the packages whose version changed. A corrupt or torn file is treated as a miss
 * rather than an error — a cache that can break the tool is worse than no cache.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Cache defaults, mirroring spec section 5 (`tmp/deps-cache/`, a 7-day TTL) the same way
 * `PACE` in pace.mjs mirrors its own section: a single frozen object, so a "just keep it
 * around longer" edit has one place to hit a red test instead of drifting past review.
 * `dir` stays a required parameter below rather than a default — unlike a numeric pace
 * value, a wrong path has a real filesystem side effect, so nothing here silently resolves
 * one; `CACHE.dir` exists for callers (the CLI, the future `repo-client.mjs`) to read.
 */
export const CACHE = Object.freeze({
  dir: "tmp/deps-cache",
  ttlMs: 7 * 24 * 60 * 60 * 1000,
});

/**
 * Percent-encodes one name/scope/version component for use inside a cache file name.
 *
 * `encodeURIComponent` alone is not enough: per its spec, it leaves `! ~ * ' ( )`
 * untouched (verified directly — `encodeURIComponent("a!b") === "a!b"`) while it does
 * escape `@`, `/`, `+` and everything else this function needs gone. `!` is exactly the
 * separator `cacheFileName` inserts between components, so the one character
 * `encodeURIComponent` refuses to touch is the one that matters most here — hence the
 * explicit `%21` pass after it.
 *
 * @param {string} value
 * @returns {string} `value` with every `!`, `@`, `/` (and anything else URI-unsafe)
 *   replaced by a `%XX` escape, so none of them can appear literally in the result.
 */
function encodePart(value) {
  return encodeURIComponent(value).replace(/!/g, "%21");
}

/**
 * Cache file name for a package.
 *
 * Scope, name and version are each percent-encoded on their own (see `encodePart`) before
 * being joined with literal `!` and `@`. That is what makes the split unambiguous, and it no
 * longer depends on knowing npm's naming rules — a dependency this project has already got
 * wrong twice (assuming a name/version charset that does not exist, then assuming
 * `encodeURIComponent` alone strips `!`). After encoding, NEITHER `!` NOR `@` can occur
 * inside an encoded scope/name/version — every literal `!` or `@` gets replaced by its
 * `%XX` escape. So the only `!` and `@` characters anywhere in the final file name are the
 * ones this function inserts itself: one `!` between an encoded scope and the encoded name
 * (scoped packages only), and one `@` before the encoded version. A scoped file name always
 * starts with a literal `@` (scope keeps its own, unencoded, leading `@` as the "this is
 * scoped" marker); an unscoped one, built purely from encoded parts, can never contain a
 * literal `@` at all — so the two families can never collide. And because a literal `!`
 * inside a scope or name is now impossible (it became `%21`), two DIFFERENT scoped packages
 * can no longer collide either: scope `@a` name `b!c` and scope `@a!b` name `c` used to both
 * flatten to `@a!b!c` (see the earlier revision of this comment, which only argued the
 * scoped/unscoped case and left this one open); they now encode to `@a!b%21c@…` and
 * `@a%21b!c@…`, which are different strings.
 *
 * Do not "clean up" this back to raw concatenation (`__`, unencoded `!`, or anything else
 * that skips `encodePart`): every earlier version of this function that skipped encoding a
 * component reopened a real collision, found by review rather than by any test that existed
 * at the time.
 *
 * @param {{name: string, scope: string, version: string}} pkg
 * @returns {string}
 */
export function cacheFileName(pkg) {
  const scope = pkg.scope ? `@${encodePart(pkg.scope.slice(1))}!` : "";
  return `${scope}${encodePart(pkg.name)}@${encodePart(pkg.version)}.json`;
}

/**
 * Reads a cached findArtifacts answer for a package, if one exists and has not expired. A
 * stale entry is deleted as it is found — free housekeeping, since the file is already open
 * and about to be re-fetched anyway. There is no separate `existsSync` check: a missing file
 * fails `readFileSync` the same way a corrupt one fails `JSON.parse`, and the `catch` below
 * already treats both as a miss.
 *
 * @param {string} dir Cache directory.
 * @param {{name: string, scope: string, version: string}} pkg
 * @param {{now: number, ttlMs?: number}} options `ttlMs` defaults to `CACHE.ttlMs`.
 * @returns {Array<object>|null} Cached artifacts, or null on a miss, a stale or a broken entry.
 */
export function readCached(dir, pkg, { now, ttlMs = CACHE.ttlMs }) {
  const file = join(dir, cacheFileName(pkg));
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (typeof saved.savedAt !== "number" || now - saved.savedAt > ttlMs) {
      rmSync(file, { force: true });
      return null;
    }
    return saved.artifacts ?? null;
  } catch {
    return null;
  }
}

/**
 * Writes a findArtifacts answer to the cache, tagged with the time it was saved. Written to a
 * sibling `.tmp` file first and moved into place with `renameSync`, which is atomic on both
 * Windows and POSIX: a run interrupted mid-write leaves no half-written file for the next run
 * to trip over. This tool never runs more than one request at a time (spec §5), so a single
 * fixed `.tmp` name per target file is not a collision risk.
 *
 * @param {string} dir Cache directory; created when missing.
 * @param {{name: string, scope: string, version: string}} pkg
 * @param {Array<object>} artifacts
 * @param {{now: number}} options
 */
export function writeCached(dir, pkg, artifacts, { now }) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, cacheFileName(pkg));
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ savedAt: now, artifacts }), "utf8");
  renameSync(tmp, file);
}
