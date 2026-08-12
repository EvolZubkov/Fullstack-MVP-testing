/**
 * PRD-27 FR-05 — ассеты отчёта приходят ИЗ ШАБЛОНА.
 *
 * Проверяется контракт разрешения значений: путь файла шаблона превращается в адрес
 * ХОСТА, авторская картинка остаётся собой, а мусор не превращается в битую ссылку.
 * Пути к `pdf-bg-*.png` из кода продукта удалены — здесь их и не должно быть.
 */

import { describe, it, expect } from "vitest";
import {
  reportImageKeys,
  resolveReportImageValue,
  resolveReportImageValues,
} from "@shared/report/report-assets";
import type { ReportVariantDecl } from "@shared/report/report-variants";

const VARIANT: ReportVariantDecl = {
  key: "report.standard",
  kind: "report",
  layoutFile: "layouts/report.html",
  settings: [
    { key: "headline", type: "text", label: "Заголовок" },
    { key: "backgroundImage", type: "image", label: "Подложка", default: "assets/report/bg.png" },
    { key: "logoImage", type: "image", label: "Логотип", default: "assets/report/logo.png" },
  ],
};

describe("reportImageKeys", () => {
  it("отбирает только поля-картинки, в порядке объявления", () => {
    expect(reportImageKeys(VARIANT)).toEqual(["backgroundImage", "logoImage"]);
  });

  it("вариант без полей и отсутствующий вариант дают пустой список", () => {
    expect(reportImageKeys({ key: "r", kind: "report" })).toEqual([]);
    expect(reportImageKeys(null)).toEqual([]);
  });
});

describe("resolveReportImageValue", () => {
  it("путь файла шаблона резолвится против базы хоста", () => {
    expect(resolveReportImageValue("assets/report/bg.png", "template/")).toBe("template/assets/report/bg.png");
    expect(resolveReportImageValue("assets/report/bg.png", "/api/templates/default/assets/")).toBe(
      "/api/templates/default/assets/assets/report/bg.png",
    );
  });

  it("медиа-конверт автора берётся как есть — это не файл шаблона", () => {
    expect(resolveReportImageValue({ url: "/uploads/media/x.png" }, "template/")).toBe("/uploads/media/x.png");
  });

  it("уже адресуемое значение не трогается", () => {
    expect(resolveReportImageValue("/uploads/media/x.png", "template/")).toBe("/uploads/media/x.png");
    expect(resolveReportImageValue("https://cdn.example/x.png", "template/")).toBe("https://cdn.example/x.png");
    expect(resolveReportImageValue("data:image/png;base64,AAA", "template/")).toBe("data:image/png;base64,AAA");
  });

  it("пустое значение остаётся пустым: отсутствие картинки — не ошибка", () => {
    expect(resolveReportImageValue(undefined, "template/")).toBe("");
    expect(resolveReportImageValue(null, "template/")).toBe("");
    expect(resolveReportImageValue("   ", "template/")).toBe("");
    expect(resolveReportImageValue({}, "template/")).toBe("");
  });

  it("выход за пределы шаблона отбрасывается, а не передаётся хосту", () => {
    expect(resolveReportImageValue("../../etc/passwd", "template/")).toBe("");
    expect(resolveReportImageValue("assets/../../secret.png", "template/")).toBe("");
  });

  it("ведущее ./ — шум, а не часть пути", () => {
    expect(resolveReportImageValue("./assets/report/bg.png", "template/")).toBe("template/assets/report/bg.png");
  });
});

describe("resolveReportImageValues", () => {
  it("трогает только объявленные поля-картинки", () => {
    const resolved = resolveReportImageValues(
      { headline: "Итоги", backgroundImage: "assets/report/bg.png", logoImage: { url: "/uploads/media/l.png" } },
      reportImageKeys(VARIANT),
      "template/",
    );
    expect(resolved).toEqual({
      headline: "Итоги",
      backgroundImage: "template/assets/report/bg.png",
      logoImage: "/uploads/media/l.png",
    });
  });

  it("незаполненное поле-картинка становится пустой строкой, а не остаётся undefined", () => {
    const resolved = resolveReportImageValues({}, ["backgroundImage"], "template/");
    expect(resolved.backgroundImage).toBe("");
  });
});
