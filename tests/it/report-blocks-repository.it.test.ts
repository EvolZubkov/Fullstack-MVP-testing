/**
 * @module tests/it/report-blocks-repository.it.test
 * @description PRD-51 §4 — ДОКУМЕНТ ОТЧЁТА в базе.
 *
 * Проверяется то, ради чего документ хранится строками, а не одним JSON: порядок читается
 * из базы, а не восстанавливается кодом; замена документа атомарна и не задевает ветвь
 * другого режима; удаление теста уносит документ каскадом. Ни одно из этих свойств
 * мок-набор не покрывает — они принадлежат SQL.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- только ПОСЛЕ vi.mock
import { ReportBlocksRepository, type ReportBlockInput } from "../../server/storage/report-blocks-repository";
// eslint-disable-next-line import/first
import { tests } from "@shared/schema";

let repo: ReportBlocksRepository;
let testId: string;

beforeAll(async () => {
  h.current = await createHarness();
  repo = new ReportBlocksRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  testId = randomUUID();
  await h.current!.db.insert(tests).values({
    id: testId,
    title: "Сертификация",
    overallPassRuleJson: { type: "percent", value: 80 },
  } as never);
});

/** Строка документа: меняется только то, что важно проверке. */
function block(over: Partial<ReportBlockInput> = {}): ReportBlockInput {
  return {
    block: "header",
    sortOrder: 0,
    enabled: true,
    templateKey: null,
    valuesJson: {},
    settingsJson: {},
    ...over,
  } as ReportBlockInput;
}

describe("ReportBlocksRepository", () => {
  it("у нового теста документа нет — печатается умолчание шаблона", async () => {
    expect(await repo.listReportBlocks(testId, "standard")).toEqual([]);
  });

  it("читает документ в порядке sortOrder, а не вставки", async () => {
    await repo.replaceReportBlocks(testId, "standard", [
      block({ block: "topics", sortOrder: 1 }),
      block({ block: "header", sortOrder: 0 }),
    ]);
    const rows = await repo.listReportBlocks(testId, "standard");
    expect(rows.map((r) => r.block)).toEqual(["header", "topics"]);
  });

  it("сохраняет выключенный блок, вариант и значения", async () => {
    await repo.replaceReportBlocks(testId, "standard", [
      block({
        block: "page",
        templateKey: "report.block.page.text",
        enabled: false,
        valuesJson: { body: "<p>О тесте</p>" },
        settingsJson: { align: "left" },
      }),
    ]);
    const [row] = await repo.listReportBlocks(testId, "standard");
    expect(row.enabled).toBe(false);
    expect(row.templateKey).toBe("report.block.page.text");
    expect(row.valuesJson).toEqual({ body: "<p>О тесте</p>" });
    expect(row.settingsJson).toEqual({ align: "left" });
  });

  it("замена документа вытесняет прежние строки целиком", async () => {
    await repo.replaceReportBlocks(testId, "standard", [
      block({ block: "header", sortOrder: 0 }),
      block({ block: "summary", sortOrder: 1 }),
    ]);
    await repo.replaceReportBlocks(testId, "standard", [block({ block: "topics", sortOrder: 0 })]);
    const rows = await repo.listReportBlocks(testId, "standard");
    expect(rows.map((r) => r.block)).toEqual(["topics"]);
  });

  it("пустой список стирает документ и возвращает тест к умолчанию", async () => {
    await repo.replaceReportBlocks(testId, "standard", [block()]);
    await repo.replaceReportBlocks(testId, "standard", []);
    expect(await repo.listReportBlocks(testId, "standard")).toEqual([]);
  });

  it("замена документа одного режима не трогает другой", async () => {
    await repo.replaceReportBlocks(testId, "adaptive", [block({ block: "topics" })]);
    await repo.replaceReportBlocks(testId, "standard", []);
    const adaptive = await repo.listReportBlocks(testId, "adaptive");
    expect(adaptive.map((r) => r.block)).toEqual(["topics"]);
  });

  it("документы двух тестов не смешиваются", async () => {
    const other = randomUUID();
    await h.current!.db.insert(tests).values({
      id: other,
      title: "Второй",
      overallPassRuleJson: { type: "percent", value: 80 },
    } as never);
    await repo.replaceReportBlocks(testId, "standard", [block({ block: "header" })]);
    await repo.replaceReportBlocks(other, "standard", [block({ block: "topics" })]);
    expect((await repo.listReportBlocks(testId, "standard")).map((r) => r.block)).toEqual(["header"]);
    expect((await repo.listReportBlocks(other, "standard")).map((r) => r.block)).toEqual(["topics"]);
  });

  it("удаление теста уносит его документ каскадом", async () => {
    await repo.replaceReportBlocks(testId, "standard", [block()]);
    await h.current!.client.exec(`DELETE FROM tests WHERE id = '${testId}'`);
    expect(await repo.listReportBlocks(testId, "standard")).toEqual([]);
  });
});
