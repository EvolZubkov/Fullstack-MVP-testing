/**
 * @module shared/access/__tests__/analytics-import
 * @description PRD-54 раздел 9: право `analytics.import`.
 */
import { describe, it, expect } from "vitest";
import { ROLE_PERMISSIONS } from "../permissions";
import { ROLES, type Role } from "../roles";

describe("analytics.import", () => {
  it("есть у всех, у кого есть analytics.export", () => {
    // Правило отдельное от экспорта, но выдаётся вместе с ним: кто вправе выгружать данные о
    // прохождениях, тот вправе их и загружать. Разойдись эти два множества — и появился бы человек,
    // который видит аналитику, но не может пополнить её тем же файлом, который сам же выгрузил.
    for (const role of Object.values(ROLES) as Role[]) {
      if (ROLE_PERMISSIONS[role].has("analytics.export")) {
        expect(ROLE_PERMISSIONS[role].has("analytics.import")).toBe(true);
      }
    }
  });

  it("нет у ученика", () => {
    expect(ROLE_PERMISSIONS[ROLES.LEARNER].has("analytics.import")).toBe(false);
  });

  it("не подменяет собой право на чтение аналитики", () => {
    // Импорт — отдельное действие: право на него не должно автоматически открывать экран аналитики.
    expect(ROLE_PERMISSIONS[ROLES.LEARNER].has("analytics.read")).toBe(false);
  });
});
