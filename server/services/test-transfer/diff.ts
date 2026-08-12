/**
 * @module server/services/test-transfer/diff
 *
 * The decision core of a selective import: (package, target, options) -> the list of rows
 * that will be created, updated and DELETED.
 *
 * Everything the form means lives here — the five parts, the two modes and the three topic
 * policies — and it lives in a PURE function on purpose. The dangerous half of an import is
 * the deletion, and a rule that needs a database to exercise is a rule nobody exercises: here
 * every case is a table row (`server/__tests__/test-transfer-diff.test.ts`).
 *
 * Two rules run through all of it:
 *
 * 1. **A deletion only where a mode can genuinely erase something.** `replace` of a part, or
 *    the "full replacement" policy of a topic. Results, appearance and media never delete —
 *    which is why they are offered without a mode at all (PRD-48 §3).
 * 2. **Matching by identifier first, by the author's handle second.** The import keeps source
 *    identifiers (PRD-48 §2.4), so a package that came from here matches exactly. A test
 *    assembled by hand has no such identifiers, and then the stable handle decides: a scale
 *    by `key`, an indicator by `name`, a content page by `kind` — the very handles the
 *    formulas and the renderer address. Question text is NEVER a handle: `content_hash` is
 *    absent on a quarter of the questions in dev and not unique among the rest.
 *
 * What is NOT decided here: the payload of a row. The rows travel whole from the package
 * (see `storage/test-transfer-repository`), so a column added tomorrow needs no edit in this
 * file. The single exception is the test row itself — one row that three parts write into —
 * and its carve-outs are named in {@link TEST_FIELDS_BY_PART}.
 */
import { randomUUID } from "node:crypto";
import { freeTopicName, normalizeTopicName } from "@shared/topics/naming";
import type { TestTransferPackage } from "./package";

/** The five parts of the form (PRD-48 §3). */
export type PartName = "structure" | "scoring" | "scales" | "results" | "media";

/** What a part does with what the package does not carry. */
export type PartMode = "upsert" | "replace";

/**
 * What to do with ONE topic of the package (PRD-48 §4).
 *
 * - `merge` — update the questions matched by identifier, add the missing ones, keep the rest;
 * - `new` — leave the existing topic alone and create another one under a free name;
 * - `replace` — bring the topic to the package's state, DELETING the questions it lacks.
 */
export type TopicPolicy = "merge" | "new" | "replace";

/** Row kinds an import touches. */
export type EntityKind =
  | "test"
  | "topic"
  | "section"
  | "question"
  | "scale"
  | "measurement"
  | "resultVariable"
  | "contentPage"
  | "questionScoring"
  | "adaptiveSetting"
  | "adaptiveLevel"
  | "adaptiveLevelLink";

/** One row's fate, as the plan screen shows it. */
export interface TransferOperation {
  kind: "create" | "update" | "delete";
  entity: EntityKind;
  /** The identifier ON THIS INSTALLATION: the row to write, to update, or to remove. */
  id: string;
  /** The package row it comes from; absent on a deletion, which has no source. */
  sourceId?: string;
  /** Human-readable: a scale's name, the beginning of a question. Goes straight to the screen. */
  title: string;
  /** Deletions only: the answer history that goes with the row (a warning, not a veto). */
  usedInAttempts?: boolean;
  /**
   * The test row only: fields NOT to write, because the part that owns them was not taken.
   * Everything else travels — a new column belongs to the test by default, and forgetting
   * it here is impossible.
   */
  omitFields?: string[];
}

/** What the author chose in the form. */
export interface TransferOptions {
  parts: Record<PartName, boolean>;
  /** Modes for the two parts where replacement can erase something. */
  modes: { scoring: PartMode; scales: PartMode };
  /** Policy per SOURCE topic id; an unlisted topic is merged. */
  topics: Record<string, TopicPolicy>;
  /** Identifier factory for rows created under the "new topic" policy. */
  newId?: () => string;
}

/** The receiving installation, reduced to what a decision needs. */
export interface TargetSnapshot {
  /** The test carrying the package's identifier, if it is here at all. */
  test: { id: string } | null;
  sections: Array<{ id: string; topicId: string }>;
  /** The package's topics as they exist here, each with its FULL question pool. */
  topics: Array<{ id: string; name: string; questions: Array<{ id: string; prompt: string }> }>;
  scales: Array<{ id: string; key: string; label: string }>;
  measurements: Array<{ id: string; questionId: string; scaleId: string }>;
  resultVariables: Array<{ id: string; name: string }>;
  contentPages: Array<{ id: string; kind: string }>;
  questionScoring: Array<{ id: string; questionId: string }>;
  /** Adaptive configuration here, matched by identifier alone — it has no author handle. */
  adaptiveSettings: Array<{ id: string }>;
  adaptiveLevels: Array<{ id: string }>;
  adaptiveLevelLinks: Array<{ id: string }>;
  /** Questions here that already carry answers: deleting one throws away history. */
  questionsUsedInAttempts: Set<string>;
  /** Topic names the importer already owns — `(owner_id, name_normalized)` is unique. */
  takenTopicNames: string[];
}

/**
 * The carve-outs of the test row.
 *
 * The row belongs to the test as a whole, but two groups of its columns belong to parts the
 * author may decline: the pass rule and the default price are "Оценивание", the intro block,
 * appearance and report settings are "Итоги и оформление". Unchecking a part must leave the
 * receiver's own values alone, so those columns are withheld. Anything not listed travels —
 * the default is to carry, not to drop.
 */
export const TEST_FIELDS_BY_PART: Partial<Record<PartName, string[]>> = {
  scoring: ["overallPassRuleJson", "defaultQuestionPoints"],
  results: ["introJson", "designSettingsJson", "reportSettingsJson"],
};

/** The beginning of a question's prompt, for the plan screen. */
function questionTitle(prompt: unknown): string {
  const plain = String(prompt ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 80 ? `${plain.slice(0, 80)}…` : plain;
}

/** Matches by identifier first, then by the author's stable handle. */
function matchBy<T extends { id: string }>(
  rows: T[],
  sourceId: string,
  handle: ((row: T) => boolean) | null,
): T | undefined {
  const byId = rows.find((row) => row.id === sourceId);
  if (byId) return byId;
  return handle ? rows.find(handle) : undefined;
}

/** Collects one entity: what to write, and (in `replace`) what the package does not carry. */
function reconcile<S, T extends { id: string }>(params: {
  entity: EntityKind;
  sources: S[];
  targets: T[];
  sourceId: (row: S) => string;
  title: (row: S) => string;
  handle: (row: S) => ((target: T) => boolean) | null;
  /** Deletions are emitted only when the part's mode allows erasing. */
  deletes: boolean;
  /** Narrows WHICH leftovers may go; absent means all of them. */
  deletable?: (row: T) => boolean;
  deleteTitle?: (row: T) => string;
  usedInAttempts?: (row: T) => boolean;
}): TransferOperation[] {
  const ops: TransferOperation[] = [];
  const claimed = new Set<string>();

  for (const source of params.sources) {
    const id = params.sourceId(source);
    const target = matchBy(params.targets.filter((t) => !claimed.has(t.id)), id, params.handle(source));
    if (target) claimed.add(target.id);

    ops.push({
      kind: target ? "update" : "create",
      entity: params.entity,
      id: target ? target.id : id,
      sourceId: id,
      title: params.title(source),
    });
  }

  if (params.deletes) {
    for (const target of params.targets) {
      if (claimed.has(target.id)) continue;
      if (params.deletable && !params.deletable(target)) continue;
      ops.push({
        kind: "delete",
        entity: params.entity,
        id: target.id,
        title: params.deleteTitle?.(target) ?? target.id,
        usedInAttempts: params.usedInAttempts?.(target) ?? false,
      });
    }
  }

  return ops;
}

/** A content page matched by kind, but only where the kind identifies ONE page here. */
function pageHandle(
  targets: TargetSnapshot["contentPages"],
  kind: string,
): ((row: { kind: string }) => boolean) | null {
  const sameKind = targets.filter((page) => page.kind === kind);
  // `sort_order` is not an identity: a workbook import leaves every page at 0 while the
  // editor spreads them 0/2/4/6. With several author pages of one kind there is nothing left
  // to match on, so they are created rather than paired at random.
  return sameKind.length === 1 ? (row) => row.kind === kind : null;
}

/** Rows matched by identifier alone and never deleted; `label` names the column to show. */
function upsertById(
  entity: EntityKind,
  sources: unknown[],
  targets: Array<{ id: string }>,
  label: string,
): TransferOperation[] {
  return reconcile({
    entity,
    sources: sources as Array<Record<string, unknown>>,
    targets,
    sourceId: (row) => String(row.id),
    title: (row) => String(row[label] ?? ""),
    handle: () => null,
    deletes: false,
  });
}

/** Rows of the test's own composition: sections, topics and questions. */
function diffStructure(
  pkg: TestTransferPackage,
  target: TargetSnapshot,
  options: TransferOptions,
): TransferOperation[] {
  const newId = options.newId ?? randomUUID;
  const ops: TransferOperation[] = [];
  const content = pkg.content;

  const taken = new Set(target.takenTopicNames.map(normalizeTopicName));
  const targetTopics = new Map(target.topics.map((t) => [t.id, t]));

  for (const topic of content.topics ?? []) {
    const policy = options.topics[topic.id] ?? "merge";
    const here = targetTopics.get(topic.id);
    const questions = content.questionsByTopic?.[topic.id] ?? [];

    // A topic that is not here, or that the author chose to keep aside, is created. Under the
    // "new" policy its questions are created too, with fresh identifiers: the copy belongs to
    // the new topic, and reusing the source ids would collide with the topic left untouched.
    if (!here || policy === "new") {
      const name = freeTopicName(topic.name, taken);
      taken.add(normalizeTopicName(name));
      const topicId = here ? newId() : topic.id;

      ops.push({ kind: "create", entity: "topic", id: topicId, sourceId: topic.id, title: name });
      for (const question of questions) {
        ops.push({
          kind: "create",
          entity: "question",
          id: here ? newId() : question.id,
          sourceId: question.id,
          title: questionTitle((question as unknown as { prompt?: unknown }).prompt),
        });
      }
      continue;
    }

    ops.push({ kind: "update", entity: "topic", id: here.id, sourceId: topic.id, title: topic.name });
    ops.push(
      ...reconcile({
        entity: "question",
        sources: questions,
        targets: here.questions,
        sourceId: (q) => (q as unknown as { id: string }).id,
        title: (q) => questionTitle((q as unknown as { prompt?: unknown }).prompt),
        // Never by text: see the module note on `content_hash`.
        handle: () => null,
        deletes: policy === "replace",
        deleteTitle: (q) => questionTitle(q.prompt),
        usedInAttempts: (q) => target.questionsUsedInAttempts.has(q.id),
      }),
    );
  }

  // Adaptive configuration travels with the structure and is never removed: it belongs to
  // the test rather than to the content the topic policy governs, so no policy can erase it.
  // It has no author handle either — a level is addressed by identifier and nothing else.
  ops.push(
    ...upsertById("adaptiveSetting", content.adaptiveSettings ?? [], target.adaptiveSettings, "topicId"),
    ...upsertById("adaptiveLevel", content.adaptiveLevels ?? [], target.adaptiveLevels, "title"),
    ...upsertById(
      "adaptiveLevelLink",
      Object.values(content.adaptiveLevelLinksByLevel ?? {}).flat(),
      target.adaptiveLevelLinks,
      "levelId",
    ),
  );

  // Sections obey the same rule as everything else: an upsert never deletes. The only
  // "replace" a section can be governed by is the policy of ITS topic — the part has no
  // switch of its own (PRD-48 §4: two switches must not exist). A section whose topic the
  // package does not carry at all therefore survives: the package says nothing about it,
  // and silence is not an instruction to remove.
  ops.push(
    ...reconcile({
      entity: "section",
      sources: content.sections ?? [],
      targets: target.sections,
      sourceId: (s) => (s as unknown as { id: string }).id,
      title: (s) => `Раздел ${(s as unknown as { topicId: string }).topicId}`,
      handle: (s) => {
        const topicId = (s as unknown as { topicId: string }).topicId;
        return (row) => row.topicId === topicId;
      },
      deletes: true,
      deletable: (row) => options.topics[row.topicId] === "replace",
      deleteTitle: (s) => `Раздел ${s.topicId}`,
    }),
  );

  return ops;
}

/**
 * Decides what a selective import will do, without touching anything.
 *
 * The result is the whole truth of the coming write: the plan screen shows it, and `apply`
 * executes exactly it.
 */
export function diffTransfer(
  pkg: TestTransferPackage,
  target: TargetSnapshot,
  options: TransferOptions,
): TransferOperation[] {
  const content = pkg.content;
  const ops: TransferOperation[] = [];

  const test = content.test as unknown as { id: string; title?: string };
  const omitFields = (Object.keys(TEST_FIELDS_BY_PART) as PartName[])
    .filter((part) => !options.parts[part])
    .flatMap((part) => TEST_FIELDS_BY_PART[part] ?? []);

  ops.push({
    kind: target.test ? "update" : "create",
    entity: "test",
    id: target.test?.id ?? test.id,
    sourceId: test.id,
    title: test.title ?? "",
    ...(omitFields.length ? { omitFields } : {}),
  });

  if (options.parts.structure) ops.push(...diffStructure(pkg, target, options));

  if (options.parts.scales) {
    const replace = options.modes.scales === "replace";
    ops.push(
      ...reconcile({
        entity: "scale",
        sources: content.scales ?? [],
        targets: target.scales,
        sourceId: (s) => s.id,
        // The key is what a result-variable formula names a scale by, so it survives the move
        // and is the handle a hand-built test can still be matched on.
        handle: (s) => (row) => row.key === s.key,
        title: (s) => String((s as unknown as { label?: string }).label ?? s.key),
        deletes: replace,
        deleteTitle: (s) => s.label || s.key,
      }),
      ...reconcile({
        entity: "measurement",
        sources: content.measurements ?? [],
        targets: target.measurements,
        sourceId: (m) => m.id,
        handle: (m) => (row) => row.questionId === m.questionId && row.scaleId === m.scaleId,
        title: (m) => `Вклад вопроса ${m.questionId}`,
        deletes: replace,
        deleteTitle: (m) => `Вклад вопроса ${m.questionId}`,
      }),
      ...reconcile({
        entity: "resultVariable",
        sources: content.resultVariables ?? [],
        targets: target.resultVariables,
        sourceId: (v) => v.id,
        handle: (v) => (row) => row.name === v.name,
        title: (v) => v.name,
        deletes: replace,
        deleteTitle: (v) => v.name,
      }),
    );
  }

  if (options.parts.scoring) {
    ops.push(
      ...reconcile({
        entity: "questionScoring",
        sources: content.questionScoring ?? [],
        targets: target.questionScoring,
        sourceId: (s) => s.id,
        // One override per (test, question): the question identifies it.
        handle: (s) => (row) => row.questionId === s.questionId,
        title: (s) => `Оценка вопроса ${s.questionId}`,
        deletes: options.modes.scoring === "replace",
        deleteTitle: (s) => `Оценка вопроса ${s.questionId}`,
      }),
    );
  }

  if (options.parts.results) {
    ops.push(
      ...reconcile({
        entity: "contentPage",
        sources: content.contentPages ?? [],
        targets: target.contentPages,
        sourceId: (p) => p.id,
        handle: (p) => pageHandle(target.contentPages, p.kind),
        title: (p) => p.kind,
        // Results and appearance NEVER delete (PRD-48 §3): the pages are system ones and
        // always present, so replacing a value IS the upsert.
        deletes: false,
      }),
    );
  }

  // Media produces no operations: files are registered by the media pass and addresses are
  // rewritten in the rows that travel. Nothing is ever removed from the library here.
  return ops;
}
