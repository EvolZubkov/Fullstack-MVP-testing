/**
 * @module tests/workbook-design
 *
 * PRD-48 Э5: лист «Оформление». Проверяются свойства контракта: круг для плоского
 * параметра и для переопределения по палитре; обе ветви отчёта переносятся независимо от
 * режима теста; ветвь без вида отчёта переживает перенос; «Выдавать отчёт» живёт в трёх
 * состояниях, и пустая ячейка не читается как «выключено».
 */
import { describe, it, expect } from "vitest";
import {
  DESIGN_HEADERS,
  DESIGN_MODE_CHOICES,
  DESIGN_PALETTE_CHOICES,
  DESIGN_SHEET_NAME,
  DESIGN_THEME_CHOICES,
  DESIGN_WHAT_CHOICES,
  REPORT_ENABLED_KEY,
  REPORT_VARIANT_KEY,
  parseDesignSheet,
  serializeDesignRows,
  type DesignSource,
  type ReportSource,
} from "../server/utils/workbook-design";

/** Оформление теста с темами: часть цветов переопределена по палитрам. */
const DESIGN: DesignSource = {
  templateId: "corporate",
  theme: "dark",
  params: {
    fontFamily: "Inter",
    showProgressBar: true,
    logoUrl: { url: "/api/media/abc", name: "logo.png" },
    primaryColor: "#ff0000",
    hiddenBlocks: ["timer", "map"],
  },
  paramsByTheme: {
    light: { primaryColor: "#112233" },
    dark: { primaryColor: "#ddeeff" },
  },
};

/** Настройки отчёта: обе ветви, у адаптивной — вид и поля. */
const REPORT: ReportSource = {
  enabled: true,
  standard: { variantKey: "report.compact", values: { showScales: true, note: "Спасибо" } },
  adaptive: { variantKey: "report.adaptive.default", values: { showLevels: false } },
};

/** Строки листа как словарь «что/режим/тема/ключ» → значение — так их читает автор. */
function cell(rows: Record<string, unknown>[], what: string, key: string, opts: { mode?: string; theme?: string } = {}) {
  const found = rows.filter(
    (r) => r["Что"] === what
      && r["Ключ"] === key
      && r["Режим"] === (opts.mode ?? "")
      && r["Тема"] === (opts.theme ?? ""),
  );
  return found.length === 1 ? String(found[0]["Значение"]) : undefined;
}

describe("лист «Оформление»", () => {
  it("заголовки и словари закрытых колонок", () => {
    expect(DESIGN_SHEET_NAME).toBe("Оформление");
    expect(DESIGN_HEADERS).toEqual(["Что", "Режим", "Тема", "Ключ", "Значение"]);
    expect(DESIGN_WHAT_CHOICES).toEqual(["Шаблон", "Тема теста", "Параметр", "Отчёт"]);
    expect(DESIGN_MODE_CHOICES).toEqual(["Стандартный", "Адаптивный"]);
    expect(DESIGN_THEME_CHOICES).toEqual(["Светлая", "Тёмная", "Авто"]);
    // «Авто» — выбор теста, но не палитра: переопределять по ней нечего.
    expect(DESIGN_PALETTE_CHOICES).toEqual(["Светлая", "Тёмная"]);
  });

  it("оформление и отчёт ходят по кругу", () => {
    const rows = serializeDesignRows(DESIGN, REPORT);
    const parsed = parseDesignSheet(rows);

    expect(parsed.errors).toEqual([]);
    expect(parsed.templateId).toBe("corporate");
    expect(parsed.theme).toBe("dark");
    expect(parsed.params).toEqual({
      fontFamily: "Inter",
      // Скаляры возвращаются литералами: типизирует их манифест, а не лист.
      showProgressBar: "true",
      logoUrl: { url: "/api/media/abc", name: "logo.png" },
      primaryColor: "#ff0000",
      hiddenBlocks: ["timer", "map"],
    });
    expect(parsed.paramsByTheme).toEqual({
      light: { primaryColor: "#112233" },
      dark: { primaryColor: "#ddeeff" },
    });
    expect(parsed.reportEnabled).toBe(true);
    expect(parsed.report.standard).toEqual({
      variantKey: "report.compact",
      values: { showScales: "true", note: "Спасибо" },
    });
    expect(parsed.report.adaptive).toEqual({
      variantKey: "report.adaptive.default",
      values: { showLevels: "false" },
    });
  });

  it("версии шаблона на лист не попадают: чужая версия поднимет баннер «Шаблон обновлён»", () => {
    const rows = serializeDesignRows(
      { ...DESIGN, templateVersion: "9.9.9", templateApiVersion: "1.0" } as DesignSource,
      null,
    );
    const values = rows.map((r) => String(r["Значение"]));
    expect(values).not.toContain("9.9.9");
    expect(rows.some((r) => String(r["Ключ"]).toLowerCase().includes("version"))).toBe(false);
  });

  it("плоский цвет и переопределение по палитре не смешиваются", () => {
    const rows = serializeDesignRows(DESIGN, null);
    expect(cell(rows, "Параметр", "primaryColor")).toBe("#ff0000");
    expect(cell(rows, "Параметр", "primaryColor", { theme: "Светлая" })).toBe("#112233");
    expect(cell(rows, "Параметр", "primaryColor", { theme: "Тёмная" })).toBe("#ddeeff");

    const parsed = parseDesignSheet(rows);
    expect(parsed.params.primaryColor).toBe("#ff0000");
    expect(parsed.paramsByTheme.light).toEqual({ primaryColor: "#112233" });
  });

  it("оформление без палитр остаётся плоским: пустая «Тема» не создаёт ветви", () => {
    const rows = serializeDesignRows({ templateId: "default", params: { fontFamily: "Roboto" } }, null);
    const parsed = parseDesignSheet(rows);
    expect(parsed.paramsByTheme).toEqual({});
    expect(parsed.theme).toBeUndefined();
    expect(parsed.params).toEqual({ fontFamily: "Roboto" });
  });

  it("обе ветви отчёта переносятся независимо от режима теста", () => {
    const rows = serializeDesignRows(null, REPORT);
    expect(cell(rows, "Отчёт", REPORT_VARIANT_KEY, { mode: "Стандартный" })).toBe("report.compact");
    expect(cell(rows, "Отчёт", REPORT_VARIANT_KEY, { mode: "Адаптивный" })).toBe("report.adaptive.default");

    const parsed = parseDesignSheet(rows);
    expect(Object.keys(parsed.report).sort()).toEqual(["adaptive", "standard"]);
  });

  it("ветвь без вида отчёта переживает перенос и вида не получает", () => {
    const rows = serializeDesignRows(null, { standard: { values: { note: "Итог" } } });
    const parsed = parseDesignSheet(rows);

    expect(parsed.report.standard).toEqual({ variantKey: undefined, values: { note: "Итог" } });
    expect(parsed.report.standard && "variantKey" in parsed.report.standard).toBe(true);
    expect(parsed.report.standard?.variantKey).toBeUndefined();
    expect(parsed.report.adaptive).toBeUndefined();
  });

  it("пустая ветвь названа строкой вида: иначе перенос потерял бы сам факт ветви", () => {
    const rows = serializeDesignRows(null, { adaptive: { values: {} } });
    const parsed = parseDesignSheet(rows);
    expect(parsed.report.adaptive).toEqual({ variantKey: undefined, values: {} });
  });

  it("«Выдавать отчёт» живёт в трёх состояниях", () => {
    const yes = parseDesignSheet(serializeDesignRows(null, { enabled: true }));
    expect(yes.reportEnabled).toBe(true);

    const no = parseDesignSheet(serializeDesignRows(null, { enabled: false }));
    expect(no.reportEnabled).toBe(false);

    // Отсутствие настройки означает «выдавать» — так её читает продукт.
    const absent = parseDesignSheet(serializeDesignRows(null, {}));
    expect(absent.reportEnabled).toBe(true);

    // Пустая ячейка — «оставить как есть», а не «выключено».
    const blank = parseDesignSheet([
      { "Что": "Отчёт", "Режим": "", "Тема": "", "Ключ": REPORT_ENABLED_KEY, "Значение": "" },
    ]);
    expect(blank.reportEnabled).toBeUndefined();
    expect(blank.errors).toEqual([]);
  });

  it("«Выдавать отчёт» с режимом и с посторонним значением — ошибки своих строк", () => {
    const parsed = parseDesignSheet([
      { "Что": "Отчёт", "Режим": "Стандартный", "Ключ": REPORT_ENABLED_KEY, "Значение": "Да" },
      { "Что": "Отчёт", "Режим": "", "Ключ": REPORT_ENABLED_KEY, "Значение": "иногда" },
    ]);
    expect(parsed.reportEnabled).toBeUndefined();
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]).toContain("общая настройка");
    expect(parsed.errors[1]).toContain("иногда");
  });

  it("отчёт без шаблона выгружается: настройки отчёта живут своей колонкой", () => {
    const rows = serializeDesignRows({}, REPORT);
    expect(rows.every((r) => r["Что"] === "Отчёт")).toBe(true);
  });

  it("без настроек отчёта лист о нём молчит, а не пишет сегодняшние умолчания", () => {
    const rows = serializeDesignRows(DESIGN, null);
    expect(rows.some((r) => r["Что"] === "Отчёт")).toBe(false);
  });

  it("оформление без шаблона не выгружается: параметры без манифеста применять некуда", () => {
    const rows = serializeDesignRows({ params: { fontFamily: "Inter" } }, null);
    expect(rows).toEqual([]);
  });

  it("значение null не пишется: отсутствие параметра и есть «берётся из шаблона»", () => {
    const rows = serializeDesignRows(
      { templateId: "default", params: { primaryColor: null, fontFamily: "Inter" } },
      { standard: { variantKey: "r", values: { note: null } } },
    );
    expect(cell(rows, "Параметр", "primaryColor")).toBeUndefined();
    expect(cell(rows, "Параметр", "fontFamily")).toBe("Inter");
    expect(cell(rows, "Отчёт", "note", { mode: "Стандартный" })).toBeUndefined();
  });

  it("пустая строка — не то же, что отсутствие: она доезжает своей строкой", () => {
    // Стёртое текстовое поле хранится пустой строкой, и круг обязан вернуть её, а не
    // умолчание манифеста. Типизацию делает импорт: лист манифеста не знает.
    const rows = serializeDesignRows({ templateId: "default", params: { caption: "" } }, null);
    expect(cell(rows, "Параметр", "caption")).toBe("");

    const parsed = parseDesignSheet(rows);
    expect(parsed.params).toEqual({ caption: "" });
    expect(parsed.errors).toEqual([]);
  });

  it("неизвестные «Что» и «Режим» — ошибки своих строк, остальные строки применяются", () => {
    const parsed = parseDesignSheet([
      { "Что": "Обложка", "Ключ": "x", "Значение": "1" },
      { "Что": "Отчёт", "Режим": "Полуадаптивный", "Ключ": "showScales", "Значение": "true" },
      { "Что": "Шаблон", "Значение": "corporate" },
    ]);
    expect(parsed.templateId).toBe("corporate");
    expect(parsed.report).toEqual({});
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]).toContain("Обложка");
    expect(parsed.errors[1]).toContain("Полуадаптивный");
  });

  it("строка «Параметр» без ключа и строка отчёта без ключа — ошибки своих строк", () => {
    const parsed = parseDesignSheet([
      { "Что": "Параметр", "Ключ": "", "Значение": "#fff" },
      { "Что": "Отчёт", "Режим": "Стандартный", "Ключ": "", "Значение": "x" },
    ]);
    expect(parsed.params).toEqual({});
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]).toContain("строка 2");
    expect(parsed.errors[1]).toContain("строка 3");
  });

  it("строка «Шаблон» без значения и неизвестная «Тема теста» — ошибки своих строк", () => {
    const parsed = parseDesignSheet([
      { "Что": "Шаблон", "Значение": "" },
      { "Что": "Тема теста", "Значение": "Сумеречная" },
    ]);
    expect(parsed.templateId).toBeUndefined();
    expect(parsed.theme).toBeUndefined();
    expect(parsed.errors).toHaveLength(2);
  });

  it("отброшенные строки оформления считаются, а строки отчёта — нет", () => {
    // Набор параметров уходит приёмнику ЦЕЛИКОМ, поэтому импорту нужно отличать
    // «книга не называла параметра» от «строку не удалось прочитать». Строка с
    // непонятным «Что» считается тоже: чему она принадлежала, сказать нечем.
    const parsed = parseDesignSheet([
      { "Что": "Обложка", "Ключ": "x", "Значение": "1" },
      { "Что": "Параметр", "Ключ": "", "Значение": "#fff" },
      { "Что": "Отчёт", "Режим": "Полуадаптивный", "Ключ": "showScales", "Значение": "true" },
      { "Что": "Отчёт", "Режим": "", "Ключ": "showScales", "Значение": "true" },
    ]);
    expect(parsed.errors).toHaveLength(4);
    expect(parsed.designRowsDropped).toBe(2);
  });

  it("прочитанный лист не сообщает об отброшенных строках оформления", () => {
    const parsed = parseDesignSheet([
      { "Что": "Шаблон", "Значение": "corporate" },
      { "Что": "Параметр", "Ключ": "fontFamily", "Значение": "Inter" },
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.designRowsDropped).toBe(0);
  });

  it("строка отчёта без режима — ошибка: непонятно, к какой ветви её отнести", () => {
    const parsed = parseDesignSheet([
      { "Что": "Отчёт", "Режим": "", "Ключ": "showScales", "Значение": "true" },
    ]);
    expect(parsed.report).toEqual({});
    expect(parsed.errors[0]).toContain("Режим");
  });

  it("«Авто» в колонке «Тема» — ошибка: это не палитра", () => {
    const parsed = parseDesignSheet([
      { "Что": "Параметр", "Тема": "Авто", "Ключ": "primaryColor", "Значение": "#fff" },
    ]);
    expect(parsed.paramsByTheme).toEqual({});
    expect(parsed.errors[0]).toContain("Авто");
  });

  it("сырые значения модели принимаются наравне с подписями", () => {
    const parsed = parseDesignSheet([
      { "Что": "template", "Значение": "corporate" },
      { "Что": "theme", "Значение": "light" },
      { "Что": "param", "Тема": "dark", "Ключ": "primaryColor", "Значение": "#000" },
      { "Что": "report", "Режим": "adaptive", "Ключ": REPORT_VARIANT_KEY, "Значение": "r.a" },
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.templateId).toBe("corporate");
    expect(parsed.theme).toBe("light");
    expect(parsed.paramsByTheme).toEqual({ dark: { primaryColor: "#000" } });
    expect(parsed.report.adaptive?.variantKey).toBe("r.a");
  });

  it("незаявленный манифестом ключ проходит как есть: фильтрация — забота импорта", () => {
    const parsed = parseDesignSheet([
      { "Что": "Параметр", "Ключ": "неведомыйКлюч", "Значение": "1" },
      { "Что": "Отчёт", "Режим": "Стандартный", "Ключ": REPORT_VARIANT_KEY, "Значение": "нет-такого-вида" },
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.params["неведомыйКлюч"]).toBe("1");
    expect(parsed.report.standard?.variantKey).toBe("нет-такого-вида");
  });

  it("повторённый ключ берётся из последней строки: лист читают сверху вниз", () => {
    const parsed = parseDesignSheet([
      { "Что": "Параметр", "Ключ": "fontFamily", "Значение": "Inter" },
      { "Что": "Параметр", "Ключ": "fontFamily", "Значение": "Roboto" },
    ]);
    expect(parsed.params).toEqual({ fontFamily: "Roboto" });
  });

  it("пустые строки в конце листа пропускаются", () => {
    const parsed = parseDesignSheet([
      { "Что": "Шаблон", "Значение": "default" },
      { "Что": "", "Режим": "", "Тема": "", "Ключ": "", "Значение": "" },
      {},
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.templateId).toBe("default");
  });

  it("пустой лист ничего не сообщает: импорту нечего применять", () => {
    const parsed = parseDesignSheet();
    expect(parsed).toEqual({
      params: {},
      paramsByTheme: {},
      report: {},
      designRowsDropped: 0,
      errors: [],
    });
  });
});
