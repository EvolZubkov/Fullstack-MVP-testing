/**
 * @module shared/template/__tests__/preview-context
 *
 * PRD-47 §5.4: демо-набор шаблона — ЕДИНСТВЕННЫЙ источник измерений для обоих
 * предпросмотров, страничного и отчётного. Вторая выдумка специально для отчёта
 * разошлась бы с первой, и автор сверял бы два разных вымысла.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { PreviewDemoDataset } from "../preview-context";

/** Демо-набор поставляемого шаблона — тот же файл, что читает предпросмотр страниц. */
function demoDataset(): PreviewDemoDataset {
  return JSON.parse(
    readFileSync("server/scorm/templates/default/demo/course.json", "utf8"),
  ) as PreviewDemoDataset;
}

describe("демо-набор шаблона", () => {
  it("несёт измерения для экрана итогов и отчёта (PRD-47 §5.4)", () => {
    const demo = demoDataset();

    expect(demo.runtime?.measures?.scales?.length).toBeGreaterThanOrEqual(2);
    expect(demo.runtime?.measures?.scales?.[0]).toHaveProperty("interpretation");
  });

  it("даёт шкалам домен и значение, иначе линейка и диаграмма выйдут пустыми", () => {
    const first = demoDataset().runtime!.measures!.scales[0];

    expect(first.interpretation.domainMax).toBeGreaterThan(0);
    expect(first.value).not.toBeNull();
  });

  it("показывает шкалы ученику — иначе предпросмотр покажет пустой блок", () => {
    // `hidden` гасит карточку и убирает шкалу с диаграммы: демо-набор, собранный из
    // скрытых шкал, выглядел бы как поломка рендерера.
    for (const scale of demoDataset().runtime!.measures!.scales) {
      expect(scale.visibility).not.toBe("hidden");
    }
  });
});
