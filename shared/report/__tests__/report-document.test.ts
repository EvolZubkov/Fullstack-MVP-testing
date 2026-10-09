/**
 * @module shared/report/__tests__/report-document
 *
 * PRD-51 §5.1 — РАЗРЕШЕНИЕ ДОКУМЕНТА: манифест шаблона плюс строки теста дают список
 * блоков, готовый к печати.
 *
 * Предмет проверки — четыре правила, каждое из которых защищает автора от молчаливой
 * потери его работы при смене шаблона: блок, которого шаблон больше не знает, пропускается,
 * но строка остаётся; блок, появившийся позже, дописывается в конец ВЫКЛЮЧЕННЫМ; исчезнувший
 * вариант деградирует к умолчанию своего блока; шаблон без блоков вовсе объявляет документ
 * цельным, и хост печатает старую раскладку.
 */
import { describe, expect, it } from "vitest";
import {
  resolveReportDocument,
  resolveReportBundle,
  type ReportBlockRowInput,
} from "../report-document";

const manifest = {
  contentTemplates: [
    { key: "report.standard", kind: "report", layoutFile: "shell.html", isDefault: true },
    { key: "b.header", kind: "report.block", block: "header", layoutFile: "header.html", isDefault: true },
    { key: "b.topics", kind: "report.block", block: "topics", layoutFile: "topics.html", isDefault: true },
    { key: "b.topics.wide", kind: "report.block", block: "topics", layoutFile: "topics-wide.html" },
    {
      key: "b.page",
      kind: "report.block",
      block: "page",
      layoutFile: "page.html",
      isDefault: true,
      placeholders: [{ key: "body", type: "richText", label: "Текст" }],
    },
  ],
  reportDocument: { report: ["header", "topics"] },
};

/** Строка документа: меняется только то, что важно проверке. */
function row(over: Partial<ReportBlockRowInput> = {}): ReportBlockRowInput {
  return {
    block: "header",
    sortOrder: 0,
    enabled: true,
    templateKey: null,
    valuesJson: {},
    settingsJson: {},
    ...over,
  };
}

describe("разрешение документа отчёта", () => {
  it("без строк теста отдаёт документ по умолчанию, всё включено", () => {
    const doc = resolveReportDocument(manifest, "report", []);
    expect(doc.blocks.map((b) => b.block)).toEqual(["header", "topics"]);
    expect(doc.blocks.every((b) => b.enabled)).toBe(true);
    expect(doc.blocks[0].layoutFile).toBe("header.html");
    expect(doc.monolithic).toBe(false);
  });

  it("со строками теста берёт их порядок и признак показа", () => {
    const doc = resolveReportDocument(manifest, "report", [
      row({ block: "topics", sortOrder: 0 }),
      row({ block: "header", sortOrder: 1, enabled: false }),
    ]);
    expect(doc.blocks.map((b) => b.block)).toEqual(["topics", "header"]);
    expect(doc.blocks[1].enabled).toBe(false);
  });

  // Документ намеренно содержит ОБА объявленных блока: иначе сработало бы правило
  // «недостающий блок дописывается в конец», и проверка говорила бы сразу о двух
  // правилах — а падение не отвечало бы, какое из них сломано.
  it("блок, которого шаблон не объявляет, пропускается, но строка не теряется", () => {
    const doc = resolveReportDocument(manifest, "report", [
      row({ block: "scales", sortOrder: 0 }),
      row({ block: "header", sortOrder: 1 }),
      row({ block: "topics", sortOrder: 2 }),
    ]);
    expect(doc.blocks.map((b) => b.block)).toEqual(["header", "topics"]);
    expect(doc.skipped).toEqual(["scales"]);
  });

  it("блок, появившийся в шаблоне позже, дописывается в конец выключенным", () => {
    const doc = resolveReportDocument(manifest, "report", [row({ block: "header", sortOrder: 0 })]);
    expect(doc.blocks.map((b) => b.block)).toEqual(["header", "topics"]);
    expect(doc.blocks[1].enabled).toBe(false);
  });

  it("выбранный вариант побеждает умолчание блока", () => {
    const doc = resolveReportDocument(manifest, "report", [
      row({ block: "topics", templateKey: "b.topics.wide" }),
    ]);
    expect(doc.blocks[0].layoutFile).toBe("topics-wide.html");
  });

  it("исчезнувший вариант деградирует к умолчанию своего блока", () => {
    const doc = resolveReportDocument(manifest, "report", [
      row({ block: "topics", templateKey: "нет-такого" }),
    ]);
    expect(doc.blocks[0].layoutFile).toBe("topics.html");
  });

  it("разрыв листа проходит без раскладки", () => {
    const doc = resolveReportDocument(manifest, "report", [row({ block: "page-break" })]);
    expect(doc.blocks[0].nature).toBe("page-break");
    expect(doc.blocks[0].layoutFile).toBe("");
  });

  it("страница несёт объявление полей и значения строки", () => {
    const doc = resolveReportDocument(manifest, "report", [
      row({ block: "page", valuesJson: { body: "<p>О тесте</p>" } }),
    ]);
    expect(doc.blocks[0].nature).toBe("page");
    expect(doc.blocks[0].placeholders).toEqual([{ key: "body", type: "richText" }]);
    expect(doc.blocks[0].values).toEqual({ body: "<p>О тесте</p>" });
  });

  it("шаблон без объявлений отдаёт пустой документ — признак цельной раскладки", () => {
    const doc = resolveReportDocument({ contentTemplates: [] }, "report", []);
    expect(doc.blocks).toEqual([]);
    expect(doc.monolithic).toBe(true);
  });

  it("адаптивный вид берёт свой список, а не список обычного", () => {
    const m = {
      ...manifest,
      reportDocument: { report: ["header", "topics"], "report.adaptive": ["topics"] },
    };
    expect(resolveReportDocument(m, "report.adaptive", []).blocks.map((b) => b.block)).toEqual(["topics"]);
  });
});

describe("сборка для хоста", () => {
  it("отдаёт оболочку и документ одним вызовом", () => {
    const bundle = resolveReportBundle(manifest, "report", null, []);
    expect(bundle.layoutKey).toBe("shell.html");
    expect(bundle.document?.blocks.map((b) => b.block)).toEqual(["header", "topics"]);
  });

  it("у шаблона без блоков документ равен null, а раскладка остаётся цельной", () => {
    const legacy = {
      contentTemplates: [
        { key: "report.standard", kind: "report", layoutFile: "layouts/report.html", isDefault: true },
      ],
    };
    const bundle = resolveReportBundle(legacy, "report", null, []);
    expect(bundle.document).toBeNull();
    expect(bundle.layoutKey).toBe("layouts/report.html");
  });

  it("документ из нуля включённых блоков — не то же самое, что отсутствие документа", () => {
    const bundle = resolveReportBundle(manifest, "report", null, [
      row({ block: "header", enabled: false }),
      row({ block: "topics", sortOrder: 1, enabled: false }),
    ]);
    expect(bundle.document).not.toBeNull();
    expect(bundle.document?.blocks.every((b) => !b.enabled)).toBe(true);
  });
});

describe("минимальный документ", () => {
  /** Состав объявлен, но целиком из блоков, которых шаблон не знает. */
  const unknownOnly = {
    contentTemplates: manifest.contentTemplates,
    reportDocument: { report: ["scales", "indicators"] },
  };

  it("состав из одних неизвестных блоков вырождается в титул с вердиктом, а не в пустоту", () => {
    const doc = resolveReportDocument(unknownOnly, "report", []);
    expect(doc.monolithic).toBe(false);
    expect(doc.blocks.map((b) => b.block)).toEqual(["header"]);
    expect(doc.blocks[0].enabled).toBe(true);
  });

  it("но выключить титул автору не запрещено: его строка уважается как есть", () => {
    const doc = resolveReportDocument(unknownOnly, "report", [
      row({ block: "header", enabled: false }),
    ]);
    expect(doc.blocks.map((b) => b.block)).toEqual(["header"]);
    expect(doc.blocks[0].enabled).toBe(false);
  });

  it("вид без объявленного состава остаётся на цельной раскладке, даже если соседний переехал", () => {
    const halfMigrated = {
      contentTemplates: manifest.contentTemplates,
      reportDocument: { report: ["header", "topics"] },
    };
    expect(resolveReportDocument(halfMigrated, "report").monolithic).toBe(false);
    expect(resolveReportDocument(halfMigrated, "report.adaptive").monolithic).toBe(true);
  });
});
