/**
 * @module tests/it/report-document-save
 * @description PRD-51, задача 3 плана Э3 — ДОКУМЕНТ СОХРАНЯЕТСЯ ОДНОЙ ТРАНЗАКЦИЕЙ с
 * остальным ящиком настроек.
 *
 * Предмет проверки — не «строки записались», а АТОМАРНОСТЬ: документ и прочие настройки
 * применяются вместе или не применяются вовсе. Документ, уехавший в базу без настроек,
 * под которые автор его собирал, — это отчёт, которого автор не собирал.
 *
 * Проверить это можно только на настоящей базе: транзакция — свойство SQL, и мок её не
 * воспроизводит. Отсюда pglite, а не юнит.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- только ПОСЛЕ vi.mock
import { TestSettingsService, VersionConflictError } from "../../server/services/test-settings";
// eslint-disable-next-line import/first
import { ReportBlocksRepository } from "../../server/storage/report-blocks-repository";
// eslint-disable-next-line import/first
import { tests } from "@shared/schema";

let service: TestSettingsService;
let repo: ReportBlocksRepository;
let testId: string;

beforeAll(async () => {
  h.current = await createHarness();
  service = new TestSettingsService();
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

/** Строка документа в том виде, в каком её принимает служба. */
function block(over: Record<string, unknown> = {}) {
  return {
    block: "header",
    templateKey: null,
    enabled: true,
    values: {},
    settings: {},
    ...over,
  };
}

describe("сохранение документа отчёта", () => {
  it("записывает документ вместе с настройками теста", async () => {
    await service.save(testId, {
      test: { title: "Новое название" },
      reportBlocks: [block(), block({ block: "topics" })],
    } as never);

    const rows = await repo.listReportBlocks(testId, "standard");
    expect(rows.map((r) => r.block)).toEqual(["header", "topics"]);
    const [row] = await h.current!.db.select().from(tests);
    expect(row.title).toBe("Новое название");
  });

  it("выводит порядок из позиции, а не берёт его от клиента", async () => {
    await service.save(testId, {
      test: {},
      // Клиент прислал бы sortOrder — он игнорируется: два источника истины о порядке
      // разошлись бы, и спорить с ними было бы нечем.
      reportBlocks: [block({ block: "topics", sortOrder: 99 }), block({ block: "header", sortOrder: 0 })],
    } as never);

    const rows = await repo.listReportBlocks(testId, "standard");
    expect(rows.map((r) => [r.block, r.sortOrder])).toEqual([
      ["topics", 0],
      ["header", 1],
    ]);
  });

  it("заменяет документ ЦЕЛИКОМ, а не дополняет", async () => {
    await service.save(testId, { test: {}, reportBlocks: [block(), block({ block: "topics" })] } as never);
    await service.save(testId, { test: {}, reportBlocks: [block({ block: "summary" })] } as never);
    expect((await repo.listReportBlocks(testId, "standard")).map((r) => r.block)).toEqual(["summary"]);
  });

  it("пустой список стирает документ — это осознанное «печатать нечего»", async () => {
    await service.save(testId, { test: {}, reportBlocks: [block()] } as never);
    await service.save(testId, { test: {}, reportBlocks: [] } as never);
    expect(await repo.listReportBlocks(testId, "standard")).toEqual([]);
  });

  it("отсутствие поля документ НЕ трогает: это частичное сохранение другого экрана", async () => {
    await service.save(testId, { test: {}, reportBlocks: [block()] } as never);
    await service.save(testId, { test: { title: "Только название" } } as never);
    expect((await repo.listReportBlocks(testId, "standard")).map((r) => r.block)).toEqual(["header"]);
  });

  it("ОТКАТ ящика откатывает и документ", async () => {
    await service.save(testId, { test: {}, reportBlocks: [block()] } as never);
    const [before] = await h.current!.db.select().from(tests);

    // Конфликт версий роняет сохранение ПОСЛЕ проверки, но до конца транзакции.
    await expect(
      service.save(testId, {
        test: { title: "Не должно примениться" },
        reportBlocks: [block({ block: "topics" }), block({ block: "scales" })],
        expectedVersion: before.version + 100,
      } as never),
    ).rejects.toBeInstanceOf(VersionConflictError);

    // Документ остался прежним: транзакция откатила ОБЕ записи, а не одну.
    expect((await repo.listReportBlocks(testId, "standard")).map((r) => r.block)).toEqual(["header"]);
    const [after] = await h.current!.db.select().from(tests);
    expect(after.title).toBe(before.title);
  });

  it("очищает разметку области: скрипт и обработчик не доезжают до базы", async () => {
    await service.save(testId, {
      test: {},
      reportBlocks: [
        block({
          block: "page",
          values: { body: '<p onclick="steal()">Текст</p><script>alert(1)</script>' },
        }),
      ],
    } as never);

    const [row] = await repo.listReportBlocks(testId, "standard");
    const body = String((row.valuesJson as Record<string, unknown>).body);
    expect(body).not.toContain("<script");
    expect(body).not.toContain("onclick");
    expect(body).toContain("Текст");
  });

  it("запирает авторский CSS в область поля, а не даёт красить плеер", async () => {
    await service.save(testId, {
      test: {},
      reportBlocks: [
        block({ block: "page", values: { body: "<style>body { background: red; }</style><p>Текст</p>" } }),
      ],
    } as never);

    const [row] = await repo.listReportBlocks(testId, "standard");
    const body = String((row.valuesJson as Record<string, unknown>).body);
    expect(body).toContain('[data-placeholder="body"]');
  });

  it("документ адаптивной ветви не задевает обычную", async () => {
    await service.save(testId, { test: {}, reportBlocks: [block()] } as never);

    // Режим меняется ПРЯМОЙ записью, а не сохранением: смена режима через службу ловится
    // гардом сценария прохождения (адаптивный несовместим с линейным), и это правило
    // здесь не предмет проверки — предмет в том, что ветви документа независимы.
    await h.current!.db
      .update(tests)
      .set({ mode: "adaptive" } as never)
      .where(eq(tests.id, testId));

    await service.save(testId, { test: {}, reportBlocks: [block({ block: "topics" })] } as never);

    expect((await repo.listReportBlocks(testId, "adaptive")).map((r) => r.block)).toEqual(["topics"]);
    expect((await repo.listReportBlocks(testId, "standard")).map((r) => r.block)).toEqual(["header"]);
  });
});
