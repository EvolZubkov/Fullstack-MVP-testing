/**
 * @module server/__tests__/test-transfer-roundtrip
 *
 * The property the whole feature exists for: what goes out comes back, on a DIFFERENT
 * installation. The suite therefore exports a package and imports it with every identifier
 * and every media asset unknown to the receiving side — the case a round trip through ONE
 * database cannot test, and the case the workbook silently failed.
 */
import { describe, it, expect } from "vitest";
import { buildTransferZip } from "../services/test-transfer/export";
import { importTestPackage, InvalidPackageError } from "../services/test-transfer/import";
import { UnsupportedPackageError } from "../services/test-transfer/plan";
import type { TestSnapshotContent } from "../services/test-snapshot";

/** A test whose every interesting field is filled in. */
function sourceContent(): TestSnapshotContent {
  return {
    test: {
      id: "src-test",
      title: "Опросник",
      ownerId: "author-there",
      folderId: "folder-there",
      introJson: { results: { text: "<p>Об отчёте</p>" } },
      reportSettingsJson: { standard: { values: { scalesChartKind: "rose" } } },
      designSettingsJson: { params: { scaleRenderKind: "gradient_bar" } },
      overallPassRuleJson: { type: "percent", value: 55 },
      maxAttempts: 3,
      copyProtection: false,
    },
    topics: [{ id: "src-topic", name: "Лидерство", ownerId: "author-there", folderId: "f" }],
    sections: [
      {
        id: "src-section",
        testId: "src-test",
        topicId: "src-topic",
        formSetJson: { forms: [{ id: "f1", label: "A", questionIds: ["src-q"] }] },
      },
    ],
    questionsByTopic: {
      "src-topic": [
        {
          id: "src-q",
          topicId: "src-topic",
          text: "Вопрос",
          mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111",
        },
      ],
    },
    scales: [{ id: "src-scale", testId: "src-test", key: "vdo", configJson: { domainMax: 98 } }],
    measurements: [
      { id: "src-m", testId: "src-test", questionId: "src-q", scaleId: "src-scale", value: 1 },
    ],
    resultVariables: [
      {
        id: "src-v",
        testId: "src-test",
        name: "lead_style",
        formula: "topScale(['vdo'],1).key",
        configJson: { outcomes: [{ code: "vdo", label: "Вдохновляющий", text: "Описание" }] },
      },
    ],
    contentPages: [
      {
        id: "src-page",
        testId: "src-test",
        topicId: "src-topic",
        kind: "results",
        settingsJson: { scalesChartKind: "rose", scoreSummary: "hide" },
        valuesJson: {},
      },
    ],
    questionScoring: [{ id: "src-sc", testId: "src-test", questionId: "src-q", points: 2 }],
    topicCoursesByTopic: {},
    topicEventsByTopic: {},
    adaptiveSettings: [],
    adaptiveLevels: [],
    adaptiveLevelLinksByLevel: {},
  } as unknown as TestSnapshotContent;
}

/** Builds the `.tbtest` bytes the way the export route would. */
function exportPackage(content = sourceContent()) {
  return buildTransferZip("src-test", {
    loadContent: async () => content,
    resolveRef: async () => ({
      buffer: Buffer.from("picture-bytes"),
      mimeType: "image/png",
      originalName: "pic.png",
    }),
  });
}

/** Captures what the receiving installation would have written. */
function captureWriter() {
  const captured: { content?: TestSnapshotContent } = {};
  const write = async (content: TestSnapshotContent) => {
    captured.content = content;
    return {
      testId: String((content.test as unknown as { id: string }).id),
      renamedTopics: [],
      counts: { topics: content.topics.length },
    };
  };
  return { captured, write };
}

describe("transfer round trip", () => {
  it("delivers the fields the workbook loses", async () => {
    const { buffer } = await exportPackage();
    const { captured, write } = captureWriter();

    await importTestPackage(buffer, {
      ownerId: "author-here",
      write,
      registerMedia: async () => ({ address: "/api/media/22222222-2222-2222-2222-222222222222", reused: false }),
    });

    const test = captured.content!.test as unknown as Record<string, unknown>;
    expect(test.introJson).toEqual({ results: { text: "<p>Об отчёте</p>" } });
    expect(test.reportSettingsJson).toEqual({ standard: { values: { scalesChartKind: "rose" } } });
    expect(test.overallPassRuleJson).toEqual({ type: "percent", value: 55 });
    expect(test.maxAttempts).toBe(3);
    expect(test.copyProtection).toBe(false);

    expect(captured.content!.resultVariables[0].configJson).toEqual({
      outcomes: [{ code: "vdo", label: "Вдохновляющий", text: "Описание" }],
    });
    expect(captured.content!.contentPages[0].settingsJson).toEqual({
      scalesChartKind: "rose",
      scoreSummary: "hide",
    });
  });

  it("renumbers into the receiving installation and reassigns ownership", async () => {
    const { buffer } = await exportPackage();
    const { captured, write } = captureWriter();

    await importTestPackage(buffer, {
      ownerId: "author-here",
      write,
      registerMedia: async () => ({ address: "/api/media/22222222-2222-2222-2222-222222222222", reused: false }),
    });

    const serialized = JSON.stringify(captured.content);
    for (const stale of ["src-test", "src-topic", "src-q", "src-scale", "src-page", "src-v"]) {
      expect(serialized).not.toContain(stale);
    }
    expect((captured.content!.test as unknown as { ownerId: string }).ownerId).toBe("author-here");
    expect((captured.content!.test as unknown as { folderId: unknown }).folderId).toBeNull();
  });

  it("re-registers media and points content at the NEW address", async () => {
    const { buffer } = await exportPackage();
    const { captured, write } = captureWriter();

    const report = await importTestPackage(buffer, {
      ownerId: "author-here",
      write,
      registerMedia: async (entry, bytes) => {
        expect(bytes.toString()).toBe("picture-bytes");
        expect(entry.checksum).toMatch(/^[0-9a-f]{64}$/);
        return { address: "/api/media/22222222-2222-2222-2222-222222222222", reused: false };
      },
    });

    const topicId = captured.content!.topics[0].id;
    const question = captured.content!.questionsByTopic[topicId][0] as unknown as { mediaUrl: string };
    expect(question.mediaUrl).toBe("/api/media/22222222-2222-2222-2222-222222222222");
    expect(report.mediaCreated).toBe(1);
    expect(report.mediaReused).toBe(0);
  });

  it("keeps question ids inside form_set_json in step with the questions", async () => {
    const { buffer } = await exportPackage();
    const { captured, write } = captureWriter();

    await importTestPackage(buffer, {
      ownerId: "author-here",
      write,
      registerMedia: async () => ({ address: "/api/media/x", reused: true }),
    });

    const topicId = captured.content!.topics[0].id;
    const questionId = captured.content!.questionsByTopic[topicId][0].id;
    const forms = (captured.content!.sections[0].formSetJson as { forms: Array<{ questionIds: string[] }> }).forms;
    expect(forms[0].questionIds).toEqual([questionId]);
  });

  it("keeps the source identifiers when told what is occupied (preserve mode)", async () => {
    const { buffer } = await exportPackage();
    const { captured, write } = captureWriter();

    await importTestPackage(buffer, {
      ownerId: "author-here",
      // Nothing is occupied here, so every source id must survive untouched.
      takenIds: new Set<string>(),
      write,
      registerMedia: async () => ({ address: "/api/media/x", reused: true }),
    });

    expect((captured.content!.test as unknown as { id: string }).id).toBe("src-test");
    expect(captured.content!.topics[0].id).toBe("src-topic");
    expect(captured.content!.scales[0].id).toBe("src-scale");
    expect(captured.content!.questionsByTopic["src-topic"][0].id).toBe("src-q");
  });

  it("renumbers only what collides (preserve mode)", async () => {
    const { buffer } = await exportPackage();
    const { captured, write } = captureWriter();

    await importTestPackage(buffer, {
      ownerId: "author-here",
      takenIds: new Set(["src-q"]),
      newId: () => "fresh-q",
      write,
      registerMedia: async () => ({ address: "/api/media/x", reused: true }),
    });

    // The question moved; everything else kept its identifier, and the reference inside
    // form_set_json followed the question.
    expect(captured.content!.questionsByTopic["src-topic"][0].id).toBe("fresh-q");
    expect((captured.content!.test as unknown as { id: string }).id).toBe("src-test");
    const forms = (captured.content!.sections[0].formSetJson as { forms: Array<{ questionIds: string[] }> }).forms;
    expect(forms[0].questionIds).toEqual(["fresh-q"]);
  });

  it("refuses a file that is not a package", async () => {
    await expect(
      importTestPackage(Buffer.from("не архив"), { ownerId: "author-here" }),
    ).rejects.toThrow(InvalidPackageError);
  });

  it("refuses a package written by a newer application", async () => {
    const { buffer } = await exportPackage();
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const manifest = JSON.parse(await zip.file("test.json")!.async("string"));
    manifest.formatVersion = 99;
    zip.file("test.json", JSON.stringify(manifest));
    const tampered = await zip.generateAsync({ type: "nodebuffer" });

    await expect(
      importTestPackage(tampered, {
        ownerId: "author-here",
        write: async () => ({ testId: "x", renamedTopics: [], counts: {} }),
        registerMedia: async () => ({ address: "/api/media/x", reused: true }),
      }),
    ).rejects.toThrow(UnsupportedPackageError);
  });
});
