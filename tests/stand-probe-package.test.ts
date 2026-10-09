/**
 * @module tests/stand-probe-package
 * @description Пакет-зонд PRD-57 (задача #51) — состав и манифест.
 *
 * Зонд загружают на ЖИВОЙ стенд, и цена ошибки там — не упавший тест, а потраченное чужое
 * время и повторное согласование доступа. Поэтому проверяется то, из-за чего LMS обычно
 * отвергает пакет: версия схемы, ссылки манифеста на файлы, тип ресурса.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";

const OUT = resolve(process.cwd(), "out", "prd57-stand-probe.zip");

let files: Record<string, string>;

beforeAll(async () => {
  // Пакет собирается ЗАНОВО: тест обязан судить о том, что соберётся сегодня, а не о
  // файле, оставшемся от прошлого запуска.
  if (existsSync(OUT)) rmSync(OUT);
  execFileSync("npx", ["tsx", "scripts/scorm/generate-probe-scorm.ts"], { cwd: process.cwd(), shell: true });
  const zip = await JSZip.loadAsync(readFileSync(OUT));
  const entries = Object.keys(zip.files);
  files = {};
  for (const name of entries) files[name] = await zip.files[name].async("string");
}, 120_000);

describe("состав пакета", () => {
  it("ровно три файла: манифест, страница и замерный модуль", () => {
    expect(Object.keys(files).sort()).toEqual(["imsmanifest.xml", "index.html", "probe-runner.js"]);
  });

  it("общего рантайма в пакете нет: между SetValue и ответом LMS только зонд", () => {
    expect(files["index.html"]).not.toContain("TBTemplate");
    expect(files["index.html"]).not.toContain("shared-runtime");
  });
});

describe("манифест", () => {
  it("объявляет SCORM 2004 4th Edition", () => {
    expect(files["imsmanifest.xml"]).toContain("<schema>ADL SCORM</schema>");
    expect(files["imsmanifest.xml"]).toContain("2004 4th Edition");
  });

  it("ресурс объявлен как SCO с точкой входа", () => {
    expect(files["imsmanifest.xml"]).toContain('adlcp:scormType="sco"');
    expect(files["imsmanifest.xml"]).toContain('href="index.html"');
  });

  it("перечисляет каждый файл пакета: незаявленный файл LMS может не развернуть", () => {
    for (const name of ["index.html", "probe-runner.js"]) {
      expect(files["imsmanifest.xml"]).toContain(`<file href="${name}"/>`);
    }
  });
});

describe("страница", () => {
  it("подключает замерный модуль файлом, а не копией", () => {
    expect(files["index.html"]).toContain('<script src="probe-runner.js"></script>');
    expect(files["index.html"]).not.toContain("var TBProbe = (function");
  });

  it("ищет API по стандартному правилу и не падает без него", () => {
    expect(files["index.html"]).toContain("API_1484_11");
    expect(files["index.html"]).toContain("API LMS не найден");
  });

  it("даёт человеку унести отчёт: кнопка копирования и сам JSON на странице", () => {
    expect(files["index.html"]).toContain("Скопировать отчёт");
    expect(files["index.html"]).toContain("JSON.stringify(report");
  });

  it("показывает формулу тремя способами — инлайн, картинкой с размерами и без", () => {
    expect((files["index.html"].match(/data:image\/svg\+xml/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(files["index.html"]).toContain("инлайн");
    expect(files["index.html"]).toContain("без размеров");
  });
});
