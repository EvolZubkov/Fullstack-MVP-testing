/**
 * @module tests/helpers/template-roots.test
 *
 * Проверяет реестр корней шаблонов — единственное место, которое знает, где лежит
 * каждый из трёх шаблонов после выноса двух из них в собственные репозитории.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  TEMPLATE_IDS,
  templateRoot,
  templateLayouts,
  templateManifest,
  templateStyles,
  externalTemplatesDir,
  externalTemplatesCandidates,
} from "./template-roots";

describe("реестр корней шаблонов", () => {
  it("знает все три шаблона", () => {
    expect(TEMPLATE_IDS).toEqual(["default", "certification", "standard-rt"]);
  });

  it("встроенный шаблон лежит в дереве продукта", () => {
    expect(templateRoot("default")).toBe(
      path.join(process.cwd(), "server", "scorm", "templates", "default"),
    );
  });

  it("вынесенные шаблоны адресуются от общего каталога репозиториев", () => {
    expect(templateRoot("certification")).toBe(
      path.join(externalTemplatesDir(), "skillum-template-certification", "template"),
    );
    expect(templateRoot("standard-rt")).toBe(
      path.join(externalTemplatesDir(), "skillum-template-standard-rt", "template"),
    );
  });

  it("каталог репозиториев переопределяется переменной окружения", () => {
    const prev = process.env.SKILLUM_TEMPLATES_DIR;
    process.env.SKILLUM_TEMPLATES_DIR = path.join("D:", "шаблоны");
    try {
      expect(externalTemplatesDir()).toBe(path.join("D:", "шаблоны"));
    } finally {
      if (prev === undefined) delete process.env.SKILLUM_TEMPLATES_DIR;
      else process.env.SKILLUM_TEMPLATES_DIR = prev;
    }
  });

  it("без переменной окружения ищет рядом с продуктом, а не только на диске C:", () => {
    const candidates = externalTemplatesCandidates();
    expect(candidates[0]).toBe(path.resolve(process.cwd(), ".."));
    expect(candidates).toContain(path.join("C:", "Repositories", "skill'um", "templates"));
  });

  it("подкаталоги собираются от корня шаблона", () => {
    expect(templateLayouts("default")).toBe(path.join(templateRoot("default"), "layouts"));
    expect(templateStyles("certification")).toBe(path.join(templateRoot("certification"), "styles"));
    expect(templateManifest("standard-rt")).toBe(
      path.join(templateRoot("standard-rt"), "manifest.json"),
    );
  });

  // Тесты паритета обязаны ПАДАТЬ, а не тихо пропускаться, если вынесенного шаблона
  // нет на месте: молчаливый пропуск превращает зелёный прогон в ничего не значащий.
  it("каждый шаблон действительно доступен по своему пути", () => {
    // Где искали — в сообщении: без этого падение на чужой машине указывало на диск C:.
    const where = process.env.SKILLUM_TEMPLATES_DIR
      ? `SKILLUM_TEMPLATES_DIR=${process.env.SKILLUM_TEMPLATES_DIR}`
      : `искали в: ${externalTemplatesCandidates().join("; ")}; или задайте SKILLUM_TEMPLATES_DIR`;
    for (const id of TEMPLATE_IDS) {
      expect(fs.existsSync(templateManifest(id)), `манифест шаблона «${id}» не найден (${where})`).toBe(true);
      expect(fs.existsSync(templateLayouts(id)), `макеты шаблона «${id}» не найдены`).toBe(true);
    }
  });

  /**
   * Никто, кроме реестра, не адресует вынесенный шаблон вручную.
   *
   * Так уже случилось: вынос «Сертификации» в свой репозиторий (`391996fa`) удалил
   * `templates/certification/` из дерева продукта, а десять наборов продолжили читать
   * шаблон по этому пути. Они падали на ИМПОРТЕ — то есть 183 проверки макетов отчёта
   * и экрана итогов просто перестали исполняться, и увидеть это можно было лишь в
   * полном прогоне. Дешевле поймать возврат здесь, чем ещё раз обнаружить пропажу
   * покрытия задним числом.
   */
  it("ни один тест не адресует вынесенный шаблон мимо реестра", () => {
    const externalIds = TEMPLATE_IDS.filter((id) => id !== "default");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || full === __filename) continue;
        const text = fs.readFileSync(full, "utf8");
        for (const id of externalIds) {
          // Ровно та форма, в какой путь и собирали: `path.join(..., "templates", "<id>", ...)`.
          if (new RegExp(`["']templates["'],\\s*["']${id}["']`).test(text)) {
            offenders.push(`${path.relative(process.cwd(), full)} → ${id}`);
          }
        }
      }
    };
    walk(path.join(process.cwd(), "tests"));
    expect(offenders, "адресуйте шаблон через templateRoot/templateFile").toEqual([]);
  });
});
