/**
 * @module features/tests/editor/__tests__/use-report-document
 *
 * PRD-51, задача 2 плана Э3 — ЧЕРНОВИК ДОКУМЕНТА в редакторе.
 *
 * Проверяются чистые операции над списком блоков. Они чистые не ради удобства теста:
 * их зовёт и компонент списка, и сохранение, и — в будущем — импорт книги, а порядок в
 * массиве И ЕСТЬ порядок печати, поэтому операция, забывшая про соседей, ломает документ
 * молча.
 */
import { describe, expect, it } from "vitest";
import {
  moveBlock,
  toggleBlock,
  insertBlock,
  removeBlock,
  toRowInputs,
  type DraftBlock,
} from "../use-report-document";

const draft = (): DraftBlock[] => [
  { block: "header", templateKey: null, enabled: true, values: {}, settings: {} },
  { block: "topics", templateKey: null, enabled: true, values: {}, settings: {} },
  {
    block: "page",
    templateKey: "report.block.page.text",
    enabled: true,
    values: { body: "текст" },
    settings: {},
  },
];

describe("черновик документа отчёта", () => {
  it("перемещает блок вверх, сохраняя остальные на местах", () => {
    expect(moveBlock(draft(), 1, -1).map((b) => b.block)).toEqual(["topics", "header", "page"]);
  });

  it("перемещает блок вниз", () => {
    expect(moveBlock(draft(), 0, 1).map((b) => b.block)).toEqual(["topics", "header", "page"]);
  });

  it("не двигает первый блок выше начала и последний ниже конца", () => {
    expect(moveBlock(draft(), 0, -1).map((b) => b.block)).toEqual(["header", "topics", "page"]);
    expect(moveBlock(draft(), 2, 1).map((b) => b.block)).toEqual(["header", "topics", "page"]);
  });

  it("гасит системный блок, НЕ удаляя его", () => {
    const next = toggleBlock(draft(), 0);
    expect(next[0].enabled).toBe(false);
    expect(next).toHaveLength(3);
  });

  it("вставляет блок НА МЕСТО, откуда его добавили", () => {
    const next = insertBlock(draft(), 1, {
      block: "page-break",
      templateKey: null,
      enabled: true,
      values: {},
      settings: {},
    });
    expect(next.map((b) => b.block)).toEqual(["header", "page-break", "topics", "page"]);
  });

  it("удаляет страницу вместе с её текстом", () => {
    expect(removeBlock(draft(), 2).map((b) => b.block)).toEqual(["header", "topics"]);
  });

  it("не меняет исходный массив: черновик редактора сравнивается по ссылке", () => {
    const original = draft();
    moveBlock(original, 1, -1);
    toggleBlock(original, 0);
    removeBlock(original, 0);
    expect(original.map((b) => b.block)).toEqual(["header", "topics", "page"]);
    expect(original[0].enabled).toBe(true);
  });

  it("порядок печати выводится из ПОЗИЦИИ, а не хранится отдельно", () => {
    const rows = toRowInputs(moveBlock(draft(), 1, -1));
    expect(rows.map((r) => [r.block, r.sortOrder])).toEqual([
      ["topics", 0],
      ["header", 1],
      ["page", 2],
    ]);
  });

  it("значения строки доезжают до формы, которую понимает разрешение документа", () => {
    const [, , page] = toRowInputs(draft());
    expect(page.valuesJson).toEqual({ body: "текст" });
    expect(page.templateKey).toBe("report.block.page.text");
    expect(page.enabled).toBe(true);
  });
});
