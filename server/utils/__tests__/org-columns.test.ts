/**
 * @module server/utils/__tests__/org-columns.test
 * @description Reading org-structure and LMS-id columns from a workbook row
 * (org-structure plan, task 2): the headers are typed by people, so both the
 * template spelling and the Russian one must be read, and every value goes
 * through the shared normalisation.
 */
import { describe, it, expect } from "vitest";
import { readOrgColumns, readLmsLearnerIdColumn } from "../org-columns";

describe("readOrgColumns", () => {
  it("reads the template headers", () => {
    expect(readOrgColumns({ organization: "АО «Ромашка»", unit: "Отдел продаж", position: "Менеджер" }))
      .toEqual({ organization: "АО «Ромашка»", unit: "Отдел продаж", position: "Менеджер" });
  });

  it("reads the Russian headers in either case", () => {
    expect(readOrgColumns({ "Организация": "АО", "подразделение": "Логистика", "Должность": "Кладовщик" }))
      .toEqual({ organization: "АО", unit: "Логистика", position: "Кладовщик" });
  });

  it("normalises values and turns empty cells into null", () => {
    expect(readOrgColumns({ unit: "  Отдел   продаж ", position: "  " }))
      .toEqual({ organization: null, unit: "Отдел продаж", position: null });
  });
});

describe("readLmsLearnerIdColumn", () => {
  it("reads the template, Russian and LMS spellings of the header", () => {
    expect(readLmsLearnerIdColumn({ lms_learner_id: " petrov_i " })).toBe("petrov_i");
    expect(readLmsLearnerIdColumn({ "Идентификатор в LMS": "p1" })).toBe("p1");
    expect(readLmsLearnerIdColumn({ learner_id: "p2" })).toBe("p2");
  });

  it("returns null for a missing or empty column", () => {
    expect(readLmsLearnerIdColumn({})).toBeNull();
    expect(readLmsLearnerIdColumn({ lms_learner_id: "" })).toBeNull();
  });
});
