/**
 * @module server/services/test-transfer/plan
 *
 * Renumbering: turns a package written by one installation into the graph a DIFFERENT one
 * can store. Pure — no database, no filesystem, no clock — so the hard part is testable on
 * its own.
 *
 * **Replacement is a sweep, not a checklist.** The plan walks the whole tree and swaps any
 * string found in the substitution map — values AND object keys alike. A list of "fields
 * that hold a
 * reference" would have to be maintained, and the one nobody remembered would keep
 * pointing at the source's id: the import succeeds, and the test is quietly broken. The
 * sweep needs no maintenance and already follows references the schema does not declare,
 * such as the question ids inside `test_sections.form_set_json.forms[].questionIds` and
 * the topic ids used as KEYS of `questionsByTopic`.
 *
 * WHICH identifiers change is decided outside, by the caller's map. The `copy` mode replaces
 * every one of them (a second, independent copy of the source). The `preserve` mode replaces
 * only genuine collisions, keeping the source identifiers so a repeat import recognises what
 * it wrote last time — see `identity.ts`.
 *
 * What deliberately does NOT change: everything addressed by KEY rather than by id. A
 * result-variable formula names scales by `key` (`topScale(['vdo'],1)`), the per-scale
 * appearance in a results page is keyed by scale key, and a topic is named in formulas by
 * its `code`. Those keys are the author's stable handles and must survive the move —
 * renumbering them would break the very formulas the transfer exists to preserve.
 *
 * Ownership is reassigned to the importer and folders are dropped: an owner id and a folder
 * id belong to the installation, and carrying them over would point at a user or a folder
 * that does not exist here.
 */
import { collectMediaRefs, mediaAddressPattern } from "../media/media-refs";
import type { TestSnapshotContent } from "../test-snapshot";
import { TRANSFER_FORMAT_VERSION, type TestTransferPackage } from "./package";

/** Thrown when the package cannot be read by this version of the application. */
export class UnsupportedPackageError extends Error {
  constructor(readonly formatVersion: number) {
    super(
      `Пакет версии ${formatVersion} не поддерживается: эта версия приложения читает формат ${TRANSFER_FORMAT_VERSION}`,
    );
    this.name = "UnsupportedPackageError";
  }
}

export interface PlanImportOptions {
  /** Identifier factory; injected so tests can predict the result. */
  newId: () => string;
  /**
   * Ready-made substitution map, listing ONLY the identifiers that must change.
   *
   * Supplied by the `preserve` import mode (see `identity.ts`), where the source ids are
   * kept and only genuine collisions are renumbered. Absent means the `copy` mode: every
   * identifier is replaced, which is what makes a second independent copy possible.
   */
  idMap?: Map<string, string>;
  /** Who will own the imported test and its topics on this installation. */
  ownerId: string;
  /**
   * Media addresses of the source mapped to addresses valid here. Absent entries are left
   * as they are — a stale address is visibly broken, while an erased one looks intentional.
   */
  mediaAddressMap?: Map<string, string>;
}

/** Every entity list in the snapshot that carries its own `id`. */
export function collectSourceIds(content: TestSnapshotContent): string[] {
  const ids: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === "string" && value) ids.push(value);
  };

  push(content.test?.id);
  for (const topic of content.topics ?? []) push(topic.id);
  for (const section of content.sections ?? []) push(section.id);
  for (const list of Object.values(content.questionsByTopic ?? {})) {
    for (const question of list ?? []) push(question.id);
  }
  for (const scale of content.scales ?? []) push(scale.id);
  for (const measurement of content.measurements ?? []) push(measurement.id);
  for (const variable of content.resultVariables ?? []) push(variable.id);
  for (const page of content.contentPages ?? []) push(page.id);
  for (const scoring of content.questionScoring ?? []) push(scoring.id);
  for (const setting of content.adaptiveSettings ?? []) push(setting.id);
  for (const level of content.adaptiveLevels ?? []) push(level.id);
  for (const links of Object.values(content.adaptiveLevelLinksByLevel ?? {})) {
    for (const link of links ?? []) push(link.id);
  }

  return ids;
}

/** Applies the media map to one string, matching on a boundary rather than by substring. */
function rewriteAddresses(value: string, mediaAddressMap: Map<string, string>): string {
  let out = value;
  for (const [from, to] of mediaAddressMap) {
    if (!out.includes(from.slice(0, 12))) continue; // cheap reject before the regex
    out = out.replace(mediaAddressPattern(from), to);
  }
  return out;
}

/**
 * Deep copy with substitution.
 *
 * Object KEYS are substituted too: `questionsByTopic` and `adaptiveLevelLinksByLevel` are
 * keyed by identifiers, and a copy that renumbered only the values would leave the graph
 * addressed by ids that no longer exist.
 */
function substitute(
  node: unknown,
  idMap: Map<string, string>,
  mediaAddressMap: Map<string, string>,
): unknown {
  if (typeof node === "string") {
    const renamed = idMap.get(node);
    if (renamed) return renamed;
    return mediaAddressMap.size ? rewriteAddresses(node, mediaAddressMap) : node;
  }
  if (Array.isArray(node)) return node.map((item) => substitute(item, idMap, mediaAddressMap));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[idMap.get(key) ?? key] = substitute(value, idMap, mediaAddressMap);
    }
    return out;
  }
  return node;
}

/**
 * Builds the graph to be written on this installation.
 *
 * The result has the SAME shape as the snapshot it came from, so the writer stores it with
 * no further translation — and so a future field travels through this function untouched
 * instead of being dropped by it.
 */
export function planImport(
  pkg: TestTransferPackage,
  opts: PlanImportOptions,
): TestSnapshotContent {
  if (pkg.formatVersion !== TRANSFER_FORMAT_VERSION) {
    throw new UnsupportedPackageError(pkg.formatVersion);
  }

  let idMap = opts.idMap;
  if (!idMap) {
    idMap = new Map<string, string>();
    for (const sourceId of collectSourceIds(pkg.content)) {
      if (!idMap.has(sourceId)) idMap.set(sourceId, opts.newId());
    }
  }

  const plan = substitute(
    pkg.content,
    idMap,
    opts.mediaAddressMap ?? new Map(),
  ) as TestSnapshotContent;

  // Installation-scoped fields: reassign rather than carry over.
  const claim = (row: Record<string, unknown> | undefined): void => {
    if (!row) return;
    if ("ownerId" in row) row.ownerId = opts.ownerId;
    if ("folderId" in row) row.folderId = null;
    if ("createdBy" in row) row.createdBy = opts.ownerId;
  };

  claim(plan.test as unknown as Record<string, unknown>);
  for (const topic of plan.topics ?? []) claim(topic as unknown as Record<string, unknown>);
  for (const list of Object.values(plan.questionsByTopic ?? {})) {
    for (const question of list ?? []) claim(question as unknown as Record<string, unknown>);
  }
  for (const page of plan.contentPages ?? []) claim(page as unknown as Record<string, unknown>);

  return plan;
}

/** Distinct media addresses the package's content references, for the media pass. */
export function referencedAddresses(pkg: TestTransferPackage): string[] {
  const seen = new Set<string>();
  for (const found of collectMediaRefs(pkg.content)) {
    const address =
      found.ref.kind === "canonical"
        ? `/api/media/${found.ref.id}`
        : `/uploads/${found.ref.storageKey}`;
    seen.add(address);
  }
  return [...seen];
}
