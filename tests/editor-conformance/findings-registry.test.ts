import { describe, expect, it } from "vitest";

import { assignBatches, parseFindings } from "../../scripts/dev/findings-registry";

const SAMPLE = [
  "### A. Хром ящика и вкладка «Основное»",
  "",
  "| № | Место | Эскиз | Реализация | Тип | Важность | Ссылка на код |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| A-1 | Поповер изменений | Ширина 420 px | Токен не объявлен | нарушение фиксированного размера | блокирующее | `tb-components.css:1055` |",
  "| A-3 | Вкладка «Основное», раздел «О тесте» | Раздел с заголовком | Разделов нет | отсутствующий элемент | существенное | `basic-settings-section.tsx:111` |",
  "",
  "### G. Сетка и оболочка: замеры",
  "",
  "| № | Селектор | Свойство | Эскиз | Реализация | Где найдено | Важность |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| G-1 | `.ou-drawer__head` | `padding` | 24 px | 20 px | шапка ящика | Существенное |",
  "",
  "| № | Место | Эскиз | Реализация | Важность |",
  "| --- | --- | --- | --- | --- |",
  "| G-7 | Сворачиваемые карточки тем | DS-аккордеон `ou-acc` | примитив `Collapsible` | существенное |",
  "",
  "| Ширина окна | Ширина ящика | Переполнение |",
  "| --- | --- | --- |",
  "| 1600 | 1040 | нет |",
].join("\n");

describe("parseFindings", () => {
  it("собирает строки таблицы в записи реестра", () => {
    const rows = parseFindings(SAMPLE);

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      id: "A-1",
      area: "A",
      severity: "блокирующее",
      place: "Поповер изменений",
      status: "open",
      batch: null,
    });
  });

  it("не теряет ни одной строки и сохраняет порядок отчёта", () => {
    expect(parseFindings(SAMPLE).map((r) => r.id)).toEqual(["A-1", "A-3", "G-1", "G-7"]);
  });

  it("приводит важность к одному регистру: участки писали её по-разному", () => {
    const rows = parseFindings(SAMPLE);

    expect(rows.find((r) => r.id === "G-1")?.severity).toBe("существенное");
    expect(rows.every((r) => r.severity === r.severity.toLowerCase())).toBe(true);
    expect(rows.every((r) => r.severity !== "")).toBe(true);
  });

  it("читает вторую таблицу участка G по её собственной раскладке колонок", () => {
    const g7 = parseFindings(SAMPLE).find((r) => r.id === "G-7");

    expect(g7).toMatchObject({
      place: "Сворачиваемые карточки тем",
      severity: "существенное",
      kind: "не тот тип контрола",
    });
  });

  it("вынимает файлы находки — единицей работы будет файл, а не партия", () => {
    const rows = parseFindings(SAMPLE);

    expect(rows.find((r) => r.id === "A-1")?.files).toEqual(["tb-components.css"]);
    expect(rows.find((r) => r.id === "A-3")?.files).toEqual(["basic-settings-section.tsx"]);
  });

  it("не оставляет без файла строки участка G: там ссылка на код идёт прозой", () => {
    const rows = parseFindings(SAMPLE);

    expect(rows.find((r) => r.id === "G-1")?.files).toEqual(["tb-components.css"]);
    expect(rows.every((r) => r.files.length > 0)).toBe(true);
  });

  it("не принимает за находку строку таблицы без идентификатора", () => {
    expect(parseFindings(SAMPLE).some((r) => r.place === "1040")).toBe(false);
  });

  it("помечает дубликаты участка G, повторяющие находки участка A", () => {
    const rows = parseFindings(SAMPLE);
    const g1 = rows.find((r) => r.id === "G-1");

    expect(g1).toMatchObject({ status: "duplicate", duplicateOf: "A-7" });
  });
});

describe("assignBatches", () => {
  it("разводит находки по партиям и не оставляет ни одной без партии", () => {
    const rows = assignBatches(parseFindings(SAMPLE));

    expect(rows.every((r) => r.batch !== null)).toBe(true);
    expect(rows.find((r) => r.id === "A-1")?.batch).toBe("grid");
    expect(rows.find((r) => r.id === "A-3")?.batch).toBe("sections");
    expect(rows.find((r) => r.id === "G-7")?.batch).toBe("components");
  });

  it("держит нарушения дизайн-системы в самих эскизах отдельным участком", () => {
    const wireframeTable = [
      "| № | Место (файл эскиза) | Эскиз (выдуманный класс) | Реализация (класс ДС) | Тип | Важность | Ссылка на код |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| W-1 | editor-settings-target.html | `ou-drawer-root--right` | Модификатора нет | выдуманный класс ДС | существенное | `docs/wireframes/editor-settings-target.html:493` |",
    ].join("\n");

    const rows = assignBatches(parseFindings(wireframeTable));

    expect(rows[0]).toMatchObject({ id: "W-1", area: "W", batch: "owner", status: "open" });
  });

  it("не перетирает уже проставленную партию", () => {
    const rows = parseFindings(SAMPLE);
    rows[0].batch = "owner";

    expect(assignBatches(rows).find((r) => r.id === "A-1")?.batch).toBe("owner");
  });
});
