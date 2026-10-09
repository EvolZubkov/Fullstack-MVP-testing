/**
 * @module scripts/deps/lockfile
 * @description Turns an npm lockfile (lockfileVersion 3) into the flat list of distinct
 * packages the allowance check asks about, each carrying the chain that pulls it in.
 *
 * Two things here are not decoration. Scope is split off the name because the corporate API
 * takes it as a SEPARATE field — `@electric-sql/pglite` searched as one string finds nothing,
 * which reads exactly like "forbidden". And the reverse graph exists because a forbidden
 * transitive dependency cannot simply be removed: the report has to name who pulls it.
 */

const NM = "node_modules/";

/** Package name as written in the manifest, taken off a lockfile key. */
export function packageNameFromKey(key) {
  const at = key.lastIndexOf(NM);
  return at === -1 ? key : key.slice(at + NM.length);
}

/**
 * The name a package is actually published under. An aliased install
 * (`npm:real-name@range`) keys the tree by the ALIAS but carries the real name in
 * `entry.name` — reading the name off the key would ask the corporate API about a package
 * that never existed under that name and get an empty answer back, which reads exactly like
 * "forbidden".
 */
function effectiveName(key, entry) {
  return entry.name ?? packageNameFromKey(key);
}

/**
 * Whether a lockfile entry is an actual installed package, as opposed to a workspace/local
 * `link` entry or a placeholder npm left behind for a dependency it did not install on this
 * platform (present in the lockfile, but with no `version`).
 */
function isRealPackage(entry) {
  return entry.link !== true && typeof entry.version === "string" && entry.version !== "";
}

/**
 * Splits `@scope/name` into its parts.
 * @param {string} fullName Name as npm writes it.
 * @returns {{scope: string, name: string}} Scope keeps its `@`; it is empty for plain packages.
 */
export function splitScope(fullName) {
  if (!fullName.startsWith("@")) return { scope: "", name: fullName };
  const slash = fullName.indexOf("/");
  if (slash === -1) return { scope: "", name: fullName };
  return { scope: fullName.slice(0, slash), name: fullName.slice(slash + 1) };
}

/**
 * Finds which lockfile entry a dependency of `parentKey` resolves to, following npm's own
 * rule: the nested copy wins, otherwise walk up towards the root.
 *
 * @param {Record<string, object>} packages The lockfile `packages` map.
 * @param {string} parentKey Key of the dependent entry (`""` for the project root).
 * @param {string} depName Dependency name, scope included.
 * @returns {string|null} Key of the resolved entry, or null when the lockfile has no such copy.
 */
export function resolveDependencyKey(packages, parentKey, depName) {
  let prefix = parentKey;
  for (;;) {
    const candidate = prefix ? `${prefix}/${NM}${depName}` : `${NM}${depName}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
    if (!prefix) return null;
    const cut = prefix.lastIndexOf(NM);
    prefix = cut <= 0 ? "" : prefix.slice(0, cut - 1);
  }
}

/** Stable identifier of a lockfile entry: `@scope/name@version`. */
function idOf(key, entry) {
  return `${effectiveName(key, entry)}@${entry.version}`;
}

/**
 * Every dependency name an entry declares that actually becomes an edge in the install tree.
 *
 * `peerDependencies` is deliberately left out: it states a compatibility requirement, not
 * something this entry pulls in. Including it invents an edge to a package the entry does not
 * actually depend on — and "who pulls this in" is the one part of the report a person acts on,
 * so pointing at the wrong package there is worse than not pointing at all.
 */
function declaredDependencies(entry) {
  return [
    ...Object.keys(entry.dependencies ?? {}),
    ...Object.keys(entry.devDependencies ?? {}),
    ...Object.keys(entry.optionalDependencies ?? {}),
  ];
}

/**
 * Reads the lockfile into distinct packages.
 *
 * A package installed both as a dependency and a devDependency counts as production: the
 * stricter reading is the safe one, because that copy does ship.
 *
 * Both passes below apply the SAME "is this a real package" test. The first pass builds the
 * package list off it; the second walks the very same entries to build edges, and a phantom
 * entry (no `version`, not a link — npm left it behind for a platform-skipped optional
 * dependency) must be excluded there too, or its own dependencies get attributed to a
 * "parent" whose id is literally `name@undefined`.
 *
 * @param {object} lock Parsed `package-lock.json`.
 * @param {{rootName?: string}} [options] What to call the project itself in `requiredBy`.
 * @returns {Array<{id: string, name: string, scope: string, version: string, dev: boolean,
 *   requiredBy: string[]}>}
 */
export function parseLockfile(lock, { rootName = "проект" } = {}) {
  if (lock?.lockfileVersion !== 3) {
    throw new Error(`Ожидается package-lock.json версии 3, получено: ${lock?.lockfileVersion}`);
  }
  const packages = lock.packages;
  if (!packages || Object.keys(packages).length === 0) {
    throw new Error("В package-lock.json нет раздела packages — разбирать нечего");
  }

  const byId = new Map();

  for (const [key, entry] of Object.entries(packages)) {
    if (key === "" || !isRealPackage(entry)) continue;
    const { scope, name } = splitScope(effectiveName(key, entry));
    const id = idOf(key, entry);
    const seen = byId.get(id);
    if (seen) {
      if (entry.dev !== true) seen.dev = false;
      continue;
    }
    byId.set(id, { id, name, scope, version: entry.version, dev: entry.dev === true, requiredBy: [] });
  }

  for (const [key, entry] of Object.entries(packages)) {
    if (key !== "" && !isRealPackage(entry)) continue;
    const parentId = key === "" ? rootName : idOf(key, entry);
    for (const depName of declaredDependencies(entry)) {
      const depKey = resolveDependencyKey(packages, key, depName);
      if (!depKey) continue;
      const dep = byId.get(idOf(depKey, packages[depKey]));
      if (dep && dep.id !== parentId && !dep.requiredBy.includes(parentId)) dep.requiredBy.push(parentId);
    }
  }

  return [...byId.values()];
}
