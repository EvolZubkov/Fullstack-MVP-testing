/**
 * @module server/__tests__/config-lms-import
 * @description PRD-54 раздел 4: параметр обезличивания импорта выгрузок LMS.
 */
import { describe, it, expect } from "vitest";
import { shape } from "../config";

describe("analytics.lmsImport.anonymizeParticipants", () => {
  it("по умолчанию включено", () => {
    expect(shape({}).analytics.lmsImport.anonymizeParticipants).toBe(true);
  });

  it("выключается значением из файла", () => {
    const raw = { analytics: { lmsImport: { anonymizeParticipants: false } } };
    expect(shape(raw).analytics.lmsImport.anonymizeParticipants).toBe(false);
  });

  it("мусор вместо секции не роняет конфигурацию", () => {
    expect(shape({ analytics: "нет" }).analytics.lmsImport.anonymizeParticipants).toBe(true);
  });
});
