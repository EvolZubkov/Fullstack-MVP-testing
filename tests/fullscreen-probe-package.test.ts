/**
 * @module tests/fullscreen-probe-package
 * @description Пакет-зонд «сценарий на весь экран» — состав, манифест и связность страниц.
 *
 * Зонд загружают на живой стенд WebTutor, и цена ошибки там — не упавший тест, а потраченное
 * время на стенде. Поэтому проверяется то, из-за чего LMS обычно отвергает пакет (версия
 * схемы, ссылки манифеста на файлы, тип ресурса), и то, без чего зонд ничего не измерит:
 * обе страницы подключают общий модуль, отдельное окно открывает файл, который есть в пакете,
 * а сессия SCORM закрывается штатно.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";

const OUT = resolve(process.cwd(), "out", "sim-fullscreen-probe.zip");

let files: Record<string, string>;

beforeAll(async () => {
  // Пакет собирается заново: тест судит о том, что соберётся сегодня.
  if (existsSync(OUT)) rmSync(OUT);
  execFileSync("npx", ["tsx", "scripts/scorm/generate-fullscreen-probe-scorm.ts"], { cwd: process.cwd(), shell: true });
  const zip = await JSZip.loadAsync(readFileSync(OUT));
  files = {};
  for (const name of Object.keys(zip.files)) files[name] = await zip.files[name].async("string");
}, 120_000);

describe("состав пакета", () => {
  it("манифест, страница SCO, страница отдельного окна и общий модуль", () => {
    expect(Object.keys(files).sort()).toEqual(["fs-probe.js", "imsmanifest.xml", "index.html", "sim.html"]);
  });

  it("общего рантайма в пакете нет", () => {
    for (const name of ["index.html", "sim.html"]) {
      expect(files[name]).not.toContain("TBTemplate");
      expect(files[name]).not.toContain("shared-runtime");
    }
  });
});

describe("манифест", () => {
  it("объявляет SCORM 2004 4th Edition", () => {
    expect(files["imsmanifest.xml"]).toContain("<schema>ADL SCORM</schema>");
    expect(files["imsmanifest.xml"]).toContain("2004 4th Edition");
  });

  it("ресурс объявлен как SCO с точкой входа index.html", () => {
    expect(files["imsmanifest.xml"]).toContain('adlcp:scormType="sco"');
    expect(files["imsmanifest.xml"]).toContain('href="index.html"');
  });

  it("перечисляет каждый файл пакета: незаявленный файл LMS может не развернуть", () => {
    for (const name of ["index.html", "sim.html", "fs-probe.js"]) {
      expect(files["imsmanifest.xml"]).toContain(`<file href="${name}"/>`);
    }
  });
});

describe("страницы", () => {
  it("обе страницы подключают общий модуль файлом", () => {
    expect(files["index.html"]).toContain('<script src="fs-probe.js"></script>');
    expect(files["sim.html"]).toContain('<script src="fs-probe.js"></script>');
  });

  it("отдельное окно открывает страницу, которая есть в пакете", () => {
    expect(files["index.html"]).toContain('window.open("sim.html"');
  });

  it("страница отдельного окна берёт прогресс из окна пакета", () => {
    expect(files["index.html"]).toContain("window.TBFSHost");
    expect(files["sim.html"]).toContain("window.opener.TBFSHost");
  });

  it("сессия SCORM завершается штатно", () => {
    expect(files["index.html"]).toContain('api.Terminate("")');
    expect(files["index.html"]).toContain('addEventListener("pagehide"');
  });
});

describe("общий модуль", () => {
  it("исполняется как ES5-скрипт и отдаёт сценарий из трёх шагов", () => {
    // Модуль кладётся в SCO как есть; здесь он исполняется как текст, без DOM.
    const TBFS = new Function(`${files["fs-probe.js"]}; return TBFS;`)() as {
      STEPS: unknown[];
      fsEnabled: (doc: object) => boolean;
    };
    expect(TBFS.STEPS).toHaveLength(3);
    expect(TBFS.fsEnabled({ fullscreenEnabled: false })).toBe(false);
    expect(TBFS.fsEnabled({ webkitFullscreenEnabled: true })).toBe(true);
    expect(TBFS.fsEnabled({})).toBe(false);
  });
});
