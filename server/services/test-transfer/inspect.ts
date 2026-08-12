/**
 * @module server/services/test-transfer/inspect
 *
 * Step one of the import: read the package, write NOTHING, and tell the author what is in it
 * and how it meets this installation.
 *
 * The step exists because the choice cannot be made blind. The form offers five parts and a
 * policy per topic, and both the counters and the available policies depend on what the
 * receiver already has — a topic that is not here can only be created, a topic that is here
 * but belongs to someone else may not be touched at all.
 *
 * Topic rights are RESOLVED, not guessed: the caller binds `canManageTopic` to
 * `services/topic-access.canManageTopicContent`, the same rule the questions API obeys, so
 * the form cannot offer what `apply` will refuse (PRD-48 §4).
 *
 * The receiving installation enters through ports, so the inventory is a pure walk over data
 * in tests: no database, no session, no HTTP.
 */
import JSZip from "jszip";
import type { Topic } from "@shared/schema";
import {
  TRANSFER_FORMAT_VERSION,
  TRANSFER_MANIFEST_NAME,
  type TestTransferPackage,
} from "./package";
import { UnsupportedPackageError } from "./plan";

/** Thrown when the uploaded file is not a package this application can read. */
export class InvalidPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPackageError";
  }
}

/** A topic reduced to what the access rule needs, mirroring `topic-access`. */
export type TopicRef = Pick<Topic, "id" | "ownerId" | "visibility">;

/**
 * How a topic of the package meets this installation.
 *
 * - `new` — nothing here holds that identifier: the topic will be created;
 * - `existing` — it is here and the importer may manage its content: all three policies apply;
 * - `foreign` — it is here but the importer may not manage it: only "create a new topic" is
 *   available, and any other policy is refused by the server.
 */
export type TransferTopicState = "new" | "existing" | "foreign";

/** One topic of the package, as the form lists it. */
export interface TransferTopicSummary {
  id: string;
  name: string;
  /** How many questions the PACKAGE carries for this topic. */
  questions: number;
  state: TransferTopicState;
}

/** The inventory of the five parts, in the order the form shows them. */
export interface TransferParts {
  structure: { sections: number; topics: number; questions: number };
  scoring: { overrides: number; hasPassRule: boolean };
  scales: { scales: number; measurements: number; resultVariables: number };
  results: { contentPages: number };
  media: { files: number };
}

/** What the author is shown before choosing anything. */
export interface TransferInspection {
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  test: { id: string; title: string; exists: boolean };
  parts: TransferParts;
  topics: TransferTopicSummary[];
  /** Addresses the SOURCE could not resolve: those links arrive broken, and the author must
   *  learn it BEFORE the import, not from a learner afterwards. */
  missingMedia: string[];
}

/** Everything the inventory needs to know about the receiving installation. */
export interface InspectPorts {
  /** Is a test with this identifier already stored here? */
  testExists(id: string): Promise<boolean>;
  /** The topic rows already here among the given identifiers (one query, not one per id). */
  existingTopics(ids: string[]): Promise<TopicRef[]>;
  /** May the importer manage this topic's content? */
  canManageTopic(topic: TopicRef): Promise<boolean>;
}

/**
 * Opens a `.tbtest` and validates that this application can read it.
 *
 * The ZIP is returned beside the manifest because the bytes are needed later, by the media
 * pass of `apply`; reopening the archive there would parse the same file twice.
 */
export async function readTransferPackage(
  archive: Buffer,
): Promise<{ zip: JSZip; pkg: TestTransferPackage }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archive);
  } catch {
    throw new InvalidPackageError("Файл не является ZIP-архивом");
  }

  const file = zip.file(TRANSFER_MANIFEST_NAME);
  if (!file) {
    throw new InvalidPackageError(`В пакете нет файла ${TRANSFER_MANIFEST_NAME}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.async("string"));
  } catch {
    throw new InvalidPackageError(`${TRANSFER_MANIFEST_NAME} не является корректным JSON`);
  }

  const pkg = parsed as TestTransferPackage;
  if (!pkg?.content?.test) {
    throw new InvalidPackageError("Пакет не содержит теста");
  }
  if (pkg.formatVersion !== TRANSFER_FORMAT_VERSION) {
    throw new UnsupportedPackageError(pkg.formatVersion);
  }

  return { zip, pkg };
}

/** Counts the five parts off the package alone — nothing here depends on the receiver. */
function countParts(pkg: TestTransferPackage): TransferParts {
  const content = pkg.content;
  const questions = Object.values(content.questionsByTopic ?? {}).reduce(
    (total, list) => total + (list?.length ?? 0),
    0,
  );

  return {
    structure: {
      sections: content.sections?.length ?? 0,
      topics: content.topics?.length ?? 0,
      questions,
    },
    scoring: {
      overrides: content.questionScoring?.length ?? 0,
      hasPassRule: Boolean((content.test as unknown as { overallPassRuleJson?: unknown })
        ?.overallPassRuleJson),
    },
    scales: {
      scales: content.scales?.length ?? 0,
      measurements: content.measurements?.length ?? 0,
      resultVariables: content.resultVariables?.length ?? 0,
    },
    results: { contentPages: content.contentPages?.length ?? 0 },
    media: { files: pkg.media?.length ?? 0 },
  };
}

/** Resolves each topic of the package against the receiver, keeping the package's order. */
async function inventoryTopics(
  pkg: TestTransferPackage,
  ports: InspectPorts,
): Promise<TransferTopicSummary[]> {
  const topics = pkg.content.topics ?? [];
  const existing = new Map(
    (await ports.existingTopics(topics.map((t) => t.id))).map((row) => [row.id, row]),
  );

  const summaries: TransferTopicSummary[] = [];
  for (const topic of topics) {
    const here = existing.get(topic.id);
    let state: TransferTopicState = "new";
    if (here) state = (await ports.canManageTopic(here)) ? "existing" : "foreign";

    summaries.push({
      id: topic.id,
      name: topic.name,
      questions: pkg.content.questionsByTopic?.[topic.id]?.length ?? 0,
      state,
    });
  }
  return summaries;
}

/** Reads a package and inventories it against this installation, writing nothing. */
export async function inspectPackage(
  archive: Buffer,
  ports: InspectPorts,
): Promise<TransferInspection> {
  const { pkg } = await readTransferPackage(archive);
  return inspectParsedPackage(pkg, ports);
}

/** The inventory of an already-parsed package, for callers holding one (the plan step). */
export async function inspectParsedPackage(
  pkg: TestTransferPackage,
  ports: InspectPorts,
): Promise<TransferInspection> {
  const test = pkg.content.test as unknown as { id: string; title?: string };

  return {
    formatVersion: pkg.formatVersion,
    exportedAt: pkg.exportedAt,
    appVersion: pkg.appVersion,
    test: {
      id: test.id,
      title: test.title ?? "",
      exists: await ports.testExists(test.id),
    },
    parts: countParts(pkg),
    topics: await inventoryTopics(pkg, ports),
    missingMedia: pkg.missingMedia ?? [],
  };
}
