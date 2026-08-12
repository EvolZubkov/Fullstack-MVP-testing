/**
 * @module server/services/test-transfer/apply
 *
 * Executes a selective import: rights, media, decisions, one transaction.
 *
 * The plan is RECOMPUTED here from the package and a freshly read target — never taken from
 * the client. What the author saw is an argument for their consent, not an instruction the
 * server obeys: between the plan screen and the button the receiver may have changed, and a
 * list of operations arriving over HTTP is a list somebody can edit.
 *
 * The order is the point:
 *
 * 1. **Rights first.** A topic policy other than "create a new topic" touches an EXISTING
 *    topic, and the answer must be a refusal BEFORE anything is written (PRD-48 §4). Hiding
 *    the option in the form is not a check.
 * 2. **Media next.** The addresses valid here must exist before the rows that point at them
 *    are rewritten.
 * 3. **Decisions** — the pure `diffTransfer`.
 * 4. **Renumbering** — the same sweep the whole-copy import uses, driven by the map the
 *    operations imply: a row matched by the author's handle lives here under a different
 *    identifier, and every reference to it must follow.
 * 5. **One transaction.** A half-applied import is worse than none.
 */
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { storage } from "../../storage";
import { normalizeTopicName } from "@shared/topics/naming";
import { planImport } from "./plan";
import { diffTransfer, type TargetSnapshot, type TransferOperation, type TransferOptions, type TopicPolicy } from "./diff";
import { registerPackageMedia, registryMediaRegistrar, type MediaRegistrar } from "./import";
import { InvalidPackageError } from "./inspect";
import type { TestTransferPackage } from "./package";
import type { TransferWriteBatch, TransferWriteCounts } from "../../storage/test-transfer-repository";
import type { TestSnapshotContent } from "../test-snapshot";

/** Thrown when a chosen topic policy needs rights the importer does not hold. */
export class TransferForbiddenError extends Error {
  constructor(readonly topicId: string, readonly policy: TopicPolicy) {
    super(`Нет прав управления темой ${topicId}: политика «${policy}» недоступна`);
    this.name = "TransferForbiddenError";
  }
}

export interface ApplyParams {
  /** The uploaded bytes: the media still lives in the ZIP. */
  archive: Buffer;
  pkg: TestTransferPackage;
  target: TargetSnapshot;
  options: TransferOptions;
  /** Who is importing: the owner of everything created. */
  ownerId: string;
  /** REQUIRED port, so no route can forget the check (PRD-48 §4). */
  canManageTopic: (topicId: string) => Promise<boolean>;
  registerMedia?: MediaRegistrar;
  write?: (batch: TransferWriteBatch) => Promise<TransferWriteCounts>;
  newId?: () => string;
}

/** What the author is told about an import that ran. */
export interface ApplyReport {
  testId: string;
  created: Record<string, number>;
  updated: Record<string, number>;
  deleted: Record<string, number>;
  /** Topics created under a name freed of a collision, as `было -> стало`. */
  renamedTopics: string[];
  mediaReused: number;
  mediaCreated: number;
  /** Addresses the SOURCE could not resolve: those links arrive broken. */
  missingMedia: string[];
}

/** Installation-scoped columns of a row that already exists here: the receiver keeps its own. */
const TARGET_OWNED = ["ownerId", "folderId", "createdBy"] as const;

/** Every planned row of one entity, keyed by the identifier it will have HERE. */
function indexPlanned(planned: TestSnapshotContent): Map<string, Map<string, Record<string, unknown>>> {
  const rows = (list: unknown[]): Map<string, Record<string, unknown>> =>
    new Map(
      (list as Array<Record<string, unknown>>).map((row) => [String(row.id), row]),
    );

  return new Map([
    ["test", rows([planned.test])],
    ["topic", rows(planned.topics ?? [])],
    ["question", rows(Object.values(planned.questionsByTopic ?? {}).flat())],
    ["section", rows(planned.sections ?? [])],
    ["scale", rows(planned.scales ?? [])],
    ["measurement", rows(planned.measurements ?? [])],
    ["resultVariable", rows(planned.resultVariables ?? [])],
    ["contentPage", rows(planned.contentPages ?? [])],
    ["questionScoring", rows(planned.questionScoring ?? [])],
    ["adaptiveSetting", rows(planned.adaptiveSettings ?? [])],
    ["adaptiveLevel", rows(planned.adaptiveLevels ?? [])],
    ["adaptiveLevelLink", rows(Object.values(planned.adaptiveLevelLinksByLevel ?? {}).flat())],
  ]);
}

/** Turns the decided operations into the rows the writer takes. */
function buildBatch(
  operations: TransferOperation[],
  planned: TestSnapshotContent,
): { batch: TransferWriteBatch; renamedTopics: string[] } {
  const index = indexPlanned(planned);
  const batch: TransferWriteBatch = { creates: {}, updates: {}, deletes: {} };
  const renamedTopics: string[] = [];
  const push = (bucket: Record<string, Array<Record<string, unknown>>>, entity: string, row: Record<string, unknown>) => {
    (bucket[entity] ??= []).push(row);
  };

  for (const op of operations) {
    if (op.kind === "delete") {
      (batch.deletes[op.entity] ??= []).push(op.id);
      continue;
    }

    const row = index.get(op.entity)?.get(op.id);
    if (!row) continue;

    if (op.kind === "create") {
      // The NAME a created topic gets was decided by the plan, and the plan showed it: it is
      // written here, not recomputed, so the two cannot drift apart.
      if (op.entity === "topic" && op.title && op.title !== row.name) {
        renamedTopics.push(`${String(row.name)} -> ${op.title}`);
        push(batch.creates, op.entity, { ...row, name: op.title, nameNormalized: normalizeTopicName(op.title) });
        continue;
      }
      push(batch.creates, op.entity, row);
      continue;
    }

    // An update writes the package's content into the receiver's row, but never takes it
    // over: ownership, the folder and the authorship audit belong to this installation.
    const update: Record<string, unknown> = { ...row };
    for (const key of TARGET_OWNED) delete update[key];
    for (const key of op.omitFields ?? []) delete update[key];
    push(batch.updates, op.entity, update);
  }

  return { batch, renamedTopics };
}

/** Refuses before writing anything when a policy needs rights the importer lacks. */
async function assertTopicRights(params: ApplyParams): Promise<void> {
  const here = new Set(params.target.topics.map((t) => t.id));
  for (const topic of params.pkg.content.topics ?? []) {
    const policy = params.options.topics[topic.id] ?? "merge";
    // Creating a topic of one's own needs no rights; only touching an existing one does.
    if (policy === "new" || !here.has(topic.id)) continue;
    if (!(await params.canManageTopic(topic.id))) {
      throw new TransferForbiddenError(topic.id, policy);
    }
  }
}

/** Runs a selective import and reports what it did. */
export async function applyTransfer(params: ApplyParams): Promise<ApplyReport> {
  const newId = params.newId ?? randomUUID;
  const registerMedia = params.registerMedia ?? registryMediaRegistrar;
  const write = params.write ?? ((batch: TransferWriteBatch) => storage.applyTransferBatch(batch));

  await assertTopicRights(params);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(params.archive);
  } catch {
    throw new InvalidPackageError("Файл не является ZIP-архивом");
  }

  const media = params.options.parts.media
    ? await registerPackageMedia(zip, params.pkg, params.ownerId, registerMedia)
    : { mediaAddressMap: new Map<string, string>(), mediaReused: 0, mediaCreated: 0 };

  const operations = diffTransfer(params.pkg, params.target, { ...params.options, newId });

  // Only what actually moves goes into the map: a row matched by handle, and a row created
  // afresh under the "new topic" policy.
  const idMap = new Map<string, string>();
  for (const op of operations) {
    if (op.sourceId && op.sourceId !== op.id) idMap.set(op.sourceId, op.id);
  }

  const planned = planImport(params.pkg, {
    newId,
    idMap,
    ownerId: params.ownerId,
    mediaAddressMap: media.mediaAddressMap,
  });

  const { batch, renamedTopics } = buildBatch(operations, planned);
  const counts = await write(batch);

  const testOp = operations.find((op) => op.entity === "test");
  return {
    testId: testOp?.id ?? (params.pkg.content.test as unknown as { id: string }).id,
    created: counts.created,
    updated: counts.updated,
    deleted: counts.deleted,
    renamedTopics,
    mediaReused: media.mediaReused,
    mediaCreated: media.mediaCreated,
    missingMedia: params.pkg.missingMedia ?? [],
  };
}
