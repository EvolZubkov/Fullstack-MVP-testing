/**
 * @module shared/report/__tests__/report-variants.blocks
 *
 * PRD-51, задача 3 — ОБЪЯВЛЕНИЕ БЛОКОВ документа в манифесте шаблона.
 *
 * Проверяются три границы, которые задаёт §3.2 спеки:
 *
 * 1. Вид `report.block` — раскладка ОДНОГО блока, и он обязан назвать, какого именно;
 * 2. `placeholders[]` разрешены варианту БЛОКА и по-прежнему запрещены ОБОЛОЧКЕ:
 *    у оболочки авторского содержимого нет, оно переехало в блоки;
 * 3. документ по умолчанию (`reportDocument`) ссылается только на объявленные блоки —
 *    иначе шаблон обещает документ, который не из чего собрать.
 *
 * Проверки идут на объявлениях, без чтения файлов: `readFile` не передаётся, поэтому
 * замечания о макетах и стилях в этот набор не попадают (тот же режим, что у
 * активационного гейта).
 */
import { describe, expect, it } from "vitest";
import { validateReportVariants, resolveReportDocumentDecl } from "../report-variants";

const shell = {
  key: "report.standard",
  kind: "report",
  layoutFile: "layouts/report/shell.html",
  isDefault: true,
};

const topics = {
  key: "report.block.topics",
  kind: "report.block",
  block: "topics",
  layoutFile: "layouts/report/topics.html",
  isDefault: true,
};

const page = {
  key: "report.block.page.text",
  kind: "report.block",
  block: "page",
  layoutFile: "layouts/report/page-text.html",
  isDefault: true,
  placeholders: [{ key: "body", type: "richText", label: "Текст" }],
};

const messages = (manifest: unknown): string =>
  validateReportVariants(manifest)
    .map((i) => i.message)
    .join(" | ");

describe("объявление блоков отчёта", () => {
  it("принимает вариант блока с placeholders", () => {
    expect(validateReportVariants({ contentTemplates: [shell, topics, page] })).toEqual([]);
  });

  it("отвергает вариант блока без ключа блока", () => {
    const bad = { ...topics, block: undefined };
    expect(messages({ contentTemplates: [shell, bad] })).toContain("не назвал блок");
  });

  it("отвергает неизвестный ключ блока", () => {
    const bad = { ...topics, block: "нет-такого" };
    expect(messages({ contentTemplates: [shell, bad] })).toContain("неизвестный блок");
  });

  it("отвергает раскладку у разрыва листа", () => {
    const bad = { ...topics, key: "report.block.brk", block: "page-break" };
    expect(messages({ contentTemplates: [shell, bad] })).toContain("разрыв листа");
  });

  it("требует ровно один isDefault на блок", () => {
    const second = { ...topics, key: "report.block.topics.b" };
    expect(messages({ contentTemplates: [shell, topics, second] })).toContain("isDefault");
  });

  it("не требует isDefault у РАЗНЫХ блоков", () => {
    const scales = { ...topics, key: "report.block.scales", block: "scales" };
    expect(validateReportVariants({ contentTemplates: [shell, topics, scales] })).toEqual([]);
  });

  it("оставляет запрет placeholders на ОБОЛОЧКЕ", () => {
    const bad = { ...shell, placeholders: [{ key: "x", type: "richText", label: "X" }] };
    expect(messages({ contentTemplates: [bad, topics] })).toContain("placeholders неприменимы");
  });

  it("отвергает ключ, объявленный и в placeholders, и в settings варианта", () => {
    const bad = { ...page, settings: [{ key: "body", type: "text", label: "Текст" }] };
    expect(messages({ contentTemplates: [shell, bad] })).toContain("объявлен дважды");
  });

  it("читает документ по умолчанию для вида", () => {
    const manifest = {
      contentTemplates: [shell, topics],
      reportDocument: { report: ["header", "topics"] },
    };
    expect(resolveReportDocumentDecl(manifest, "report")).toEqual(["header", "topics"]);
  });

  it("у шаблона без reportDocument документ по умолчанию пуст", () => {
    expect(resolveReportDocumentDecl({ contentTemplates: [shell] }, "report")).toEqual([]);
  });

  it("отвергает документ по умолчанию с неизвестным блоком", () => {
    const manifest = {
      contentTemplates: [shell, topics],
      reportDocument: { report: ["header", "нет-такого"] },
    };
    expect(messages(manifest)).toContain("неизвестный блок");
  });

  it("отвергает повтор блока в документе по умолчанию", () => {
    const manifest = {
      contentTemplates: [shell, topics],
      reportDocument: { report: ["topics", "topics"] },
    };
    expect(messages(manifest)).toContain("дважды");
  });

  it("отвергает системный блок документа, у которого нет варианта", () => {
    const manifest = {
      contentTemplates: [shell, topics],
      reportDocument: { report: ["topics", "scales"] },
    };
    expect(messages(manifest)).toContain("scales");
  });
});

describe("разрыв листа в документе по умолчанию (PRD-51 Э4)", () => {
  const withDoc = (report: string[]) => ({
    contentTemplates: [
      { key: "b.header", kind: "report.block", block: "header", isDefault: true, layoutFile: "l/h.html" },
      { key: "b.topics", kind: "report.block", block: "topics", isDefault: true, layoutFile: "l/t.html" },
    ],
    reportDocument: { report },
  });

  it("повторяется столько раз, сколько листов открывает автор", () => {
    // Документ из трёх листов ставит ДВА разрыва. Запрет повтора ломал бы ровно тот
    // документ, ради которого разрыв и заведён — пойман загрузкой шаблона «Сертификация».
    const issues = validateReportVariants(withDoc(["header", "page-break", "topics", "page-break"]));
    expect(issues.filter((i) => i.message.includes("дважды"))).toEqual([]);
  });

  it("а блок с данными повторяться по-прежнему не вправе", () => {
    const issues = validateReportVariants(withDoc(["header", "topics", "topics"]));
    expect(issues.map((i) => i.message)).toContain('блок "topics" указан в документе дважды');
  });
});
