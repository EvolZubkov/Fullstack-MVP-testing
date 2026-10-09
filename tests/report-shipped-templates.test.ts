/**
 * @module tests/report-shipped-templates
 *
 * PRD-51 §5.4 — ПОСТАВЛЯЕМЫЙ ШАБЛОН ВСЕГДА ДАЁТ, ЧЕМ ПЕЧАТАТЬ.
 *
 * Инвариант, а не снимок состояния: для каждого поставляемого шаблона и каждого вида
 * отчёта разрешение обязано вернуть ЛИБО цельную раскладку (`document === null` и
 * непустой `layoutKey`), ЛИБО непустой документ из блоков. Третьего — «ни того, ни
 * другого» — быть не может: это отчёт, которого слушатель не получит.
 *
 * Тест намеренно не проверяет, КАКОЙ из двух путей выбран сегодня: шаблоны переезжают на
 * блоки поэтапно, и проверка на конкретный путь краснела бы при каждом переезде, ничего
 * не защищая. Манифесты читаются С ДИСКА — предмет проверки именно поставляемые файлы.
 */
import fs from "node:fs";
import { templateManifest } from "./helpers/template-roots";
import { describe, expect, it } from "vitest";
import { resolveReportBundle, resolveReportDocument } from "@shared/report/report-document";
import { REPORT_KINDS } from "@shared/report/report-variants";

/** Поставляемые шаблоны: встроенный «Стандартный» и внешний «Сертификация». */
const TEMPLATES: Array<{ name: string; manifestPath: string }> = [
  {
    name: "default",
    manifestPath: templateManifest("default"),
  },
  {
    name: "certification",
    manifestPath: templateManifest("certification"),
  },
];

describe("поставляемые шаблоны: отчёт всегда есть чем печатать", () => {
  for (const tpl of TEMPLATES) {
    for (const kind of REPORT_KINDS) {
      it(`${tpl.name} / ${kind}`, () => {
        const manifest = JSON.parse(fs.readFileSync(tpl.manifestPath, "utf8"));
        const bundle = resolveReportBundle(manifest, kind, null, []);

        if (bundle.document === null) {
          // Путь совместимости: цельная раскладка. Ключ обязан быть непустым, иначе
          // печатать нечего и хост отдаст слушателю пустой файл.
          expect(bundle.layoutKey.length).toBeGreaterThan(0);
          return;
        }

        // Путь блоков: документ не бывает пустым (§3.1, минимальный документ).
        expect(bundle.document.blocks.length).toBeGreaterThan(0);
        // Раскладка есть у каждого блока, кроме разрыва листа: блок без раскладки
        // напечатал бы пустоту на месте раздела.
        for (const block of bundle.document.blocks) {
          if (block.nature === "page-break") continue;
          expect(block.layoutFile.length).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe("«Сертификация» кладёт документ в сборку", () => {
  const manifest = JSON.parse(
    fs.readFileSync(templateManifest("certification"), "utf8"),
  );

  for (const kind of ["report", "report.adaptive"] as const) {
    it(`${kind}: у каждого блока документа есть раскладка`, () => {
      const bundle = resolveReportBundle(manifest, kind, null, []);
      expect(bundle.document, "документ не разрешился — шаблон объявил блоки?").not.toBeNull();
      for (const b of bundle.document!.blocks) {
        if (b.nature === "page-break") continue;
        expect(b.layoutFile, `у блока ${b.block} нет раскладки`).not.toBe("");
      }
    });
  }

  it("документ начинается титулом и разбит двумя разрывами на три листа", () => {
    const doc = resolveReportDocument(manifest, "report", []);
    expect(doc.blocks[0].block).toBe("header");
    expect(doc.blocks.filter((b) => b.nature === "page-break")).toHaveLength(2);
  });
});
