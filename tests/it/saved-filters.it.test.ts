/**
 * @module tests/it/saved-filters.it.test
 * @description Сохранённые фильтры списков на настоящей базе: набор виден только владельцу и
 * только на своём экране, имя уникально у владельца в пределах экрана, неизвестный экран база
 * не принимает, чужой набор нельзя ни поправить, ни удалить.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { users } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";
import { isUniqueViolation } from "../../server/utils/pg-error";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { DatabaseStorage } from "../../server/storage";

let storage: DatabaseStorage;
let owner: string;
let other: string;

beforeAll(async () => {
  h.current = await createHarness();
  storage = new DatabaseStorage();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  owner = randomUUID();
  other = randomUUID();
  for (const [id, email] of [[owner, "owner@x.y"], [other, "other@x.y"]]) {
    await h.current!.db.insert(users).values({ id, email, passwordHash: "x", name: email } as never);
  }
});

const save = (createdBy: string, scope: string, name: string) =>
  storage.createSavedFilter({ createdBy, scope, name, conditionsJson: { statuses: ["published"] } });

describe("saved_list_filters", () => {
  it("список — наборы владельца одного экрана, по имени", async () => {
    await save(owner, "tests", "Черновики");
    await save(owner, "tests", "Адаптивные");
    await save(owner, "content", "Без медиа");
    await save(other, "tests", "Чужой");

    const rows = await storage.getSavedFilters(owner, "tests");
    expect(rows.map(r => r.name)).toEqual(["Адаптивные", "Черновики"]);
  });

  it("имя уникально у владельца в пределах экрана — и только там", async () => {
    await save(owner, "tests", "Мои");
    // Drizzle заворачивает ошибку драйвера: код ищется по цепочке причин, как это делает ручка.
    const duplicate = await save(owner, "tests", "Мои").catch((error: unknown) => error);
    expect(isUniqueViolation(duplicate)).toBe(true);
    // Тот же экран у другого владельца и тот же владелец на другом экране — можно.
    await expect(save(other, "tests", "Мои")).resolves.toBeTruthy();
    await expect(save(owner, "users", "Мои")).resolves.toBeTruthy();
  });

  it("неизвестный экран база не принимает", async () => {
    await expect(save(owner, "analytics", "Набор")).rejects.toBeTruthy();
  });

  it("чужой набор нельзя поправить и удалить; свой — можно", async () => {
    const row = await save(owner, "tests", "Мои");

    expect(await storage.updateSavedFilter(row.id, other, { name: "Взлом" })).toBeUndefined();
    expect(await storage.deleteSavedFilter(row.id, other)).toBe(false);

    const updated = await storage.updateSavedFilter(row.id, owner, { conditionsJson: { statuses: ["draft"] } });
    expect(updated?.conditionsJson).toEqual({ statuses: ["draft"] });
    expect(await storage.deleteSavedFilter(row.id, owner)).toBe(true);
    expect(await storage.getSavedFilters(owner, "tests")).toEqual([]);
  });
});
