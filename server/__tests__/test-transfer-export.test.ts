/**
 * @module server/__tests__/test-transfer-export
 *
 * The transfer package must be COMPLETE by construction: it carries the snapshot content
 * whole, so a column added to `tests` travels without anyone remembering to list it. These
 * tests pin that property, plus the media manifest that keeps pictures from arriving broken.
 */
import { describe, it, expect } from "vitest";
import { buildTransferPackage, TRANSFER_FORMAT_VERSION } from "../services/test-transfer/export";
import type { TestSnapshotContent } from "../services/test-snapshot";

/** A snapshot with one canonical media address and one legacy one. */
function snapshotFixture(): TestSnapshotContent {
  return {
    test: {
      id: "test-1",
      title: "Опросник",
      introJson: { results: { text: "<p>Об отчёте</p>" } },
      designSettingsJson: { params: { scaleRenderKind: "gradient_bar" } },
      reportSettingsJson: { standard: { values: { scalesChartKind: "rose" } } },
    },
    sections: [],
    topics: [],
    questionsByTopic: {
      "topic-1": [{ id: "q-1", mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111" }],
    },
    topicCoursesByTopic: {},
    topicEventsByTopic: {},
    adaptiveSettings: [],
    adaptiveLevels: [],
    adaptiveLevelLinksByLevel: {},
    scales: [{ id: "s-1", key: "vdo", configJson: { domainMax: 98 } }],
    measurements: [],
    resultVariables: [{ id: "v-1", name: "lead_style", configJson: { outcomes: [{ code: "vdo" }] } }],
    contentPages: [
      { id: "p-1", kind: "results", settingsJson: { scalesChartKind: "rose" }, valuesJson: {} },
      { id: "p-2", kind: "content", valuesJson: { body: '<img src="/uploads/media/old.png">' } },
    ],
    questionScoring: [],
  } as unknown as TestSnapshotContent;
}

/** Resolves both fixture addresses to distinct bytes. */
const resolveRef = async (ref: { kind: string; id?: string; storageKey?: string }) => {
  if (ref.kind === "canonical") {
    return { buffer: Buffer.from("canonical-bytes"), mimeType: "image/png", originalName: "a.png" };
  }
  return { buffer: Buffer.from("legacy-bytes"), mimeType: "image/png", originalName: "old.png" };
};

describe("buildTransferPackage", () => {
  it("carries the snapshot content whole, including fields nobody enumerated", async () => {
    const content = snapshotFixture();
    const { pkg } = await buildTransferPackage("test-1", { loadContent: async () => content, resolveRef });

    // The point of the format: the test row travels as a row, not as a hand-picked list.
    expect(pkg.content.test).toEqual(content.test);
    expect(pkg.content.resultVariables[0].configJson).toEqual({ outcomes: [{ code: "vdo" }] });
    expect(pkg.content.contentPages[0].settingsJson).toEqual({ scalesChartKind: "rose" });
    expect(pkg.formatVersion).toBe(TRANSFER_FORMAT_VERSION);
  });

  it("lists every media address in the manifest and packs its bytes", async () => {
    const { pkg, files } = await buildTransferPackage("test-1", {
      loadContent: snapshotFixture,
      resolveRef,
    });

    const addresses = pkg.media.map((m) => m.address).sort();
    expect(addresses).toEqual([
      "/api/media/11111111-1111-1111-1111-111111111111",
      "/uploads/media/old.png",
    ]);

    for (const entry of pkg.media) {
      expect(files[entry.path]).toBeInstanceOf(Buffer);
      expect(entry.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("packs one file for an address used twice", async () => {
    const content = snapshotFixture();
    // The same picture referenced from a second place.
    (content.contentPages as unknown as Array<Record<string, unknown>>).push({
      id: "p-3",
      kind: "content",
      valuesJson: { body: '<img src="/api/media/11111111-1111-1111-1111-111111111111">' },
    });

    const { pkg } = await buildTransferPackage("test-1", { loadContent: async () => content, resolveRef });

    const canonical = pkg.media.filter((m) => m.address.startsWith("/api/media/"));
    expect(canonical).toHaveLength(1);
  });

  it("reports an unresolvable address instead of dropping it silently", async () => {
    const { pkg } = await buildTransferPackage("test-1", {
      loadContent: snapshotFixture,
      resolveRef: async () => null,
    });

    expect(pkg.media).toHaveLength(0);
    expect(pkg.missingMedia.sort()).toEqual([
      "/api/media/11111111-1111-1111-1111-111111111111",
      "/uploads/media/old.png",
    ]);
  });

  it("fails loudly when the test does not exist", async () => {
    await expect(
      buildTransferPackage("nope", { loadContent: async () => null, resolveRef }),
    ).rejects.toThrow(/nope/);
  });
});
