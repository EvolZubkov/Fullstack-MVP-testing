/**
 * @module tests/it/exposure-repository
 * @description PRD-55 (FR-05, FR-07): счётчик выдач копится по корзинам-месяцам и читается
 * суммой за окно.
 *
 * Круглый рейс на настоящей базе здесь обязателен, а не избыточен. Инкремент держится на
 * составном первичном ключе и `onConflictDoUpdate` — объектах, которые существуют ТОЛЬКО в базе.
 * Ошибка в них не уронит ни одного запроса: она проявится позже, неверными весами выдачи, то
 * есть тем, что никакой юнит-тест над моком не поймает.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { ExposureRepository } from "../../server/storage/exposure-repository";

let repo: ExposureRepository;

beforeAll(async () => {
  h.current = await createHarness();
  repo = new ExposureRepository();
});

afterAll(async () => {
  await h.current?.close();
  h.current = null;
});

beforeEach(async () => {
  await h.current!.reset();
});

describe("счётчик выдач", () => {
  it("складывает выдачи одного месяца в одну корзину", async () => {
    await repo.recordDeliveries(["q1", "q2"], "t1", new Date("2026-09-12"));
    await repo.recordDeliveries(["q1"], "t1", new Date("2026-09-20"));

    const counts = await repo.getDeliveryCounts(["q1", "q2"], new Date("2026-01-01"));
    expect(counts.get("q1")).toBe(2);
    expect(counts.get("q2")).toBe(1);
  });

  it("не берёт корзины старше окна", async () => {
    await repo.recordDeliveries(["q1"], "t1", new Date("2024-01-15"));
    await repo.recordDeliveries(["q1"], "t1", new Date("2026-09-01"));

    const counts = await repo.getDeliveryCounts(["q1"], new Date("2026-01-01"));
    expect(counts.get("q1")).toBe(1);
  });

  it("суммирует выдачи задания по РАЗНЫМ тестам", async () => {
    await repo.recordDeliveries(["q1"], "t1", new Date("2026-09-12"));
    await repo.recordDeliveries(["q1"], "t2", new Date("2026-09-12"));

    const counts = await repo.getDeliveryCounts(["q1"], new Date("2026-01-01"));
    expect(counts.get("q1")).toBe(2);
  });

  it("задание без выдач в карте отсутствует", async () => {
    await repo.recordDeliveries(["q1"], "t1", new Date("2026-09-12"));

    const counts = await repo.getDeliveryCounts(["q1", "q2"], new Date("2026-01-01"));
    expect(counts.has("q2")).toBe(false);
  });

  it("пустой список заданий не ходит в базу и даёт пустую карту", async () => {
    await repo.recordDeliveries([], "t1", new Date("2026-09-12"));

    const counts = await repo.getDeliveryCounts([], new Date("2026-01-01"));
    expect(counts.size).toBe(0);
  });
});

/**
 * PRD-55 FR-08: вклад импортированных выгрузок — ПЕРЕСЧЁТ среза теста по выданному составу
 * прохождений. Проверяется на базе: идемпотентность держится на том, что пересчёт заменяет
 * строки `import`, а живые строки `live` не трогает, — это свойство запроса и ключа таблицы.
 */
describe("экспозиция импорта (FR-08)", () => {
  /** Месяц назад: внутри окна наблюдения при любом дне запуска. */
  const recent = () => {
    const at = new Date();
    at.setMonth(at.getMonth() - 1);
    return at;
  };

  async function importedAttempt(id: string, testId: string, delivered: string[] | null, startedAt = recent()) {
    const { scormAttempts } = await import("@shared/schema");
    await h.current!.db.insert(scormAttempts).values({
      id,
      testId,
      origin: "import",
      participantKey: id.padEnd(64, "0"),
      startedAt,
      finishedAt: startedAt,
      lastActivityAt: startedAt,
      deliveredQuestionIds: delivered,
    });
  }

  it("считает выдачи по выданному составу, по одной на прохождение", async () => {
    await importedAttempt("a1", "t1", ["q1", "q2"]);
    await importedAttempt("a2", "t1", ["q1"]);

    await repo.rebuildImportExposure("t1");

    const counts = await repo.getDeliveryCountsForTest(["q1", "q2"], "t1", new Date("2000-01-01"));
    expect(counts.get("q1")).toBe(2);
    expect(counts.get("q2")).toBe(1);
  });

  it("повторный пересчёт не удваивает счётчик", async () => {
    await importedAttempt("a1", "t1", ["q1"]);

    await repo.rebuildImportExposure("t1");
    await repo.rebuildImportExposure("t1");

    const counts = await repo.getDeliveryCountsForTest(["q1"], "t1", new Date("2000-01-01"));
    expect(counts.get("q1")).toBe(1);
  });

  it("живые выдачи пересчёт не трогает, а читатель складывает оба источника", async () => {
    await repo.recordDeliveries(["q1"], "t1", recent());
    await importedAttempt("a1", "t1", ["q1"]);

    await repo.rebuildImportExposure("t1");

    const counts = await repo.getDeliveryCountsForTest(["q1"], "t1", new Date("2000-01-01"));
    expect(counts.get("q1")).toBe(2);
  });

  it("исчезнувшее прохождение (откат партии) вычитается следующим пересчётом", async () => {
    const { scormAttempts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await importedAttempt("a1", "t1", ["q1"]);
    await importedAttempt("a2", "t1", ["q1"]);
    await repo.rebuildImportExposure("t1");

    await h.current!.db.delete(scormAttempts).where(eq(scormAttempts.id, "a2"));
    await repo.rebuildImportExposure("t1");

    const counts = await repo.getDeliveryCountsForTest(["q1"], "t1", new Date("2000-01-01"));
    expect(counts.get("q1")).toBe(1);
  });

  it("прохождение без выданного состава и чужой тест не считаются", async () => {
    await importedAttempt("a1", "t1", null);
    await importedAttempt("a2", "t2", ["q1"]);

    await repo.rebuildImportExposure("t1");

    const counts = await repo.getDeliveryCounts(["q1"], new Date("2000-01-01"));
    expect(counts.has("q1")).toBe(false);
  });
});
