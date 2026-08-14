/**
 * @module server/__tests__/test-transfer-inspect
 *
 * Reading a package WITHOUT writing anything: what the author is shown before choosing what
 * to accept. Two things are proved here — the inventory of the five parts is counted off the
 * package itself, and the state of every topic is resolved against THIS installation
 * (`new` / `existing` / `foreign`), because the policy offered for a topic depends on it.
 *
 * The receiving installation enters through ports, so the whole inventory is testable without
 * a database.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildTransferZip } from "../services/test-transfer/export";
import {
  inspectPackage,
  readTransferPackage,
  InvalidPackageError,
  type InspectPorts,
} from "../services/test-transfer/inspect";
import { UnsupportedPackageError } from "../services/test-transfer/plan";
import {
  createTransferSession,
  getTransferSession,
  dropTransferSession,
  __clearTransferSessions,
} from "../services/test-transfer/session-store";
import type { TestSnapshotContent } from "../services/test-snapshot";
import type { TestTransferPackage } from "../services/test-transfer/package";

const PRESENT = "/api/media/11111111-1111-1111-1111-111111111111";
const LOST = "/api/media/22222222-2222-2222-2222-222222222222";

/** Three topics, so that all three states can be told apart in one package. */
function sourceContent(): TestSnapshotContent {
  return {
    test: {
      id: "src-test",
      title: "Опросник",
      ownerId: "author-there",
      overallPassRuleJson: { type: "percent", value: 55 },
    },
    topics: [
      { id: "topic-known", name: "Лидерство", ownerId: "author-there" },
      { id: "topic-fresh", name: "Этика", ownerId: "author-there" },
      { id: "topic-foreign", name: "Чужая тема", ownerId: "someone-else" },
    ],
    sections: [
      { id: "src-section-1", testId: "src-test", topicId: "topic-known" },
      { id: "src-section-2", testId: "src-test", topicId: "topic-fresh" },
      { id: "src-section-3", testId: "src-test", topicId: "topic-foreign" },
    ],
    questionsByTopic: {
      "topic-known": [
        { id: "q-1", topicId: "topic-known", text: "Первый", mediaUrl: PRESENT },
        { id: "q-2", topicId: "topic-known", text: "Второй", mediaUrl: LOST },
      ],
      "topic-fresh": [{ id: "q-3", topicId: "topic-fresh", text: "Третий" }],
      "topic-foreign": [{ id: "q-4", topicId: "topic-foreign", text: "Четвёртый" }],
    },
    scales: [{ id: "src-scale", testId: "src-test", key: "vdo" }],
    measurements: [
      { id: "src-m1", testId: "src-test", questionId: "q-1", scaleId: "src-scale", value: 1 },
      { id: "src-m2", testId: "src-test", questionId: "q-2", scaleId: "src-scale", value: 1 },
    ],
    resultVariables: [{ id: "src-v", testId: "src-test", name: "lead_style", formula: "1" }],
    contentPages: [
      { id: "src-page-1", testId: "src-test", kind: "intro" },
      { id: "src-page-2", testId: "src-test", kind: "results" },
    ],
    questionScoring: [{ id: "src-sc", testId: "src-test", questionId: "q-1", points: 2 }],
    topicCoursesByTopic: {},
    topicEventsByTopic: {},
    adaptiveSettings: [],
    adaptiveLevels: [],
    adaptiveLevelLinksByLevel: {},
  } as unknown as TestSnapshotContent;
}

/** The bytes an export would produce; one of the two pictures cannot be resolved. */
function exportPackage(content = sourceContent()) {
  return buildTransferZip("src-test", {
    loadContent: async () => content,
    resolveRef: async (ref) =>
      ref.kind === "canonical" && ref.id === "22222222-2222-2222-2222-222222222222"
        ? null
        : { buffer: Buffer.from("picture-bytes"), mimeType: "image/png", originalName: "pic.png" },
  });
}

/** A receiving installation that knows nothing, unless the case says otherwise. */
function ports(overrides: Partial<InspectPorts> = {}): InspectPorts {
  return {
    testExists: async () => false,
    existingTopics: async () => [],
    canManageTopic: async () => true,
    ...overrides,
  };
}

describe("transfer inspect", () => {
  it("counts what the package carries, part by part", async () => {
    const { buffer } = await exportPackage();

    const inspection = await inspectPackage(buffer, ports());

    expect(inspection.test.title).toBe("Опросник");
    expect(inspection.test.id).toBe("src-test");
    expect(inspection.parts.structure).toEqual({ sections: 3, topics: 3, questions: 4 });
    expect(inspection.parts.scoring).toEqual({ overrides: 1, hasPassRule: true });
    expect(inspection.parts.scales).toEqual({ scales: 1, measurements: 2, resultVariables: 1 });
    expect(inspection.parts.results).toEqual({ contentPages: 2 });
    expect(inspection.parts.media).toEqual({ files: 1 });
  });

  it("reports the pictures the source could not resolve", async () => {
    const { buffer } = await exportPackage();

    const inspection = await inspectPackage(buffer, ports());

    expect(inspection.missingMedia).toEqual([LOST]);
  });

  it("calls a topic the receiver does not have new", async () => {
    const { buffer } = await exportPackage();

    const inspection = await inspectPackage(buffer, ports());

    expect(inspection.topics.map((t) => t.state)).toEqual(["new", "new", "new"]);
    expect(inspection.topics[0]).toEqual({
      id: "topic-known",
      name: "Лидерство",
      questions: 2,
      state: "new",
    });
  });

  it("calls a topic the importer may manage existing", async () => {
    const { buffer } = await exportPackage();

    const inspection = await inspectPackage(
      buffer,
      ports({
        existingTopics: async () => [
          { id: "topic-known", ownerId: "author-here", visibility: "private" },
        ],
      }),
    );

    const known = inspection.topics.find((t) => t.id === "topic-known");
    expect(known?.state).toBe("existing");
  });

  it("calls a topic the importer may not manage foreign", async () => {
    const { buffer } = await exportPackage();

    const inspection = await inspectPackage(
      buffer,
      ports({
        existingTopics: async () => [
          { id: "topic-foreign", ownerId: "someone-here", visibility: "shared" },
        ],
        canManageTopic: async () => false,
      }),
    );

    const foreign = inspection.topics.find((t) => t.id === "topic-foreign");
    expect(foreign?.state).toBe("foreign");
  });

  it("says whether the test itself is already on this installation", async () => {
    const { buffer } = await exportPackage();

    const inspection = await inspectPackage(buffer, ports({ testExists: async (id) => id === "src-test" }));

    expect(inspection.test.exists).toBe(true);
  });

  it("refuses a file that is not a package", async () => {
    await expect(inspectPackage(Buffer.from("не архив"), ports())).rejects.toThrow(
      InvalidPackageError,
    );
  });

  it("refuses a package written by a newer application", async () => {
    const { buffer } = await exportPackage();
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const manifest = JSON.parse(await zip.file("test.json")!.async("string"));
    manifest.formatVersion = 99;
    zip.file("test.json", JSON.stringify(manifest));
    const tampered = await zip.generateAsync({ type: "nodebuffer" });

    await expect(inspectPackage(tampered, ports())).rejects.toThrow(UnsupportedPackageError);
  });

  it("hands the parsed package back, so the caller stores it instead of parsing twice", async () => {
    const { buffer } = await exportPackage();

    const { pkg } = await readTransferPackage(buffer);

    expect(pkg.content.test.id).toBe("src-test");
    expect(pkg.media).toHaveLength(1);
  });
});

describe("transfer session store", () => {
  const pkg = { formatVersion: 1, content: { test: { id: "src-test" } } } as unknown as TestTransferPackage;

  beforeEach(() => {
    __clearTransferSessions();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands the package back to the user who put it there", () => {
    const token = createTransferSession("author-here", Buffer.from("zip"), pkg);

    const session = getTransferSession(token, "author-here");

    expect(session).not.toBe("expired");
    expect((session as { pkg: TestTransferPackage }).pkg).toBe(pkg);
    expect((session as { archive: Buffer }).archive.toString()).toBe("zip");
  });

  it("hides a session from another user, exactly as it hides an unknown token", () => {
    const token = createTransferSession("author-here", Buffer.from("zip"), pkg);

    expect(getTransferSession(token, "someone-else")).toBeUndefined();
    expect(getTransferSession("no-such-token", "author-here")).toBeUndefined();
  });

  it("drops a session on request", () => {
    const token = createTransferSession("author-here", Buffer.from("zip"), pkg);

    expect(dropTransferSession(token, "author-here")).toBe(true);
    expect(getTransferSession(token, "author-here")).toBeUndefined();
  });

  it("expires a session past the window", () => {
    vi.useFakeTimers();
    const token = createTransferSession("author-here", Buffer.from("zip"), pkg);

    vi.advanceTimersByTime(31 * 60 * 1000);

    expect(getTransferSession(token, "author-here")).toBe("expired");
  });

  it("evicts the oldest session past the cap", () => {
    const first = createTransferSession("author-here", Buffer.from("zip"), pkg);
    for (let i = 0; i < 50; i++) createTransferSession("author-here", Buffer.from("zip"), pkg);

    expect(getTransferSession(first, "author-here")).toBeUndefined();
  });
});
