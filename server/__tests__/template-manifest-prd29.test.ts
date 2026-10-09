import fs from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";
import manifest from "../scorm/templates/default/manifest.json";

const params = manifest.params as Array<Record<string, unknown>>;
const byKey = (key: string) => params.find((p) => p.key === key);

/**
 * Виды рендера, которые умеет ядро — из союза `RenderKind`.
 *
 * Читаются ИЗ ИСХОДНИКА, потому что тип к прогону не доживает, а копия списка в тесте
 * отстаёт молча: она и отстала, когда PRD-46 добавил `bars`.
 */
const RENDER_KINDS: string[] = (() => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../shared/template/measure-view.ts"),
    "utf8",
  );
  const union = src.match(/export type RenderKind =([\s\S]*?);/);
  expect(union, "не найден союз RenderKind").toBeTruthy();
  return [...union![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
})();

describe("manifest params (PRD-29)", () => {
  it("объявляет схему уровней списком строк с подписями", () => {
    const p = byKey("levelScheme");
    expect(p?.type).toBe("select");
    expect(p?.options).toEqual(["traffic", "neutral", "custom"]);
    expect(Object.keys(p?.optionLabels as Record<string, string>)).toEqual([
      "traffic",
      "neutral",
      "custom",
    ]);
  });

  it("объявляет три цвета рампы с пустым значением по умолчанию", () => {
    for (const key of ["levelColorFavorable", "levelColorMid", "levelColorUnfavorable"]) {
      const p = byKey(key);
      expect(p?.type).toBe("color");
      expect(p?.default).toBeNull();
      expect(typeof p?.cssVar).toBe("string");
    }
  });

  it("шкале предлагаются ВСЕ виды рендера, которые умеет ядро", () => {
    // Список читается из союза `RenderKind`, а не хранится копией: копия однажды отстанет,
    // и автор не увидит вида, который рантайм уже умеет рисовать. Ровно это и случилось с
    // `bars` (PRD-46): вид приехал в манифест, а тест сверял его с прежней шестёркой.
    const p = byKey("scaleRenderKind");
    expect(p?.type).toBe("select");
    expect(p?.options).toEqual(RENDER_KINDS);
    expect(Object.keys(p?.optionLabels as Record<string, string>)).toEqual(RENDER_KINDS);
  });

  it("показателю не предлагается линейчатая диаграмма: она про НАБОР шкал", () => {
    // `bars` — вид, который рисует шкалы одну под другой и сравнивает их между собой.
    // У показателя сравнивать нечего: он один, и предлагать автору такой вид значило бы
    // обещать картинку, которой не из чего собраться.
    const p = byKey("indicatorRenderKind");
    expect(p?.type).toBe("select");
    expect(p?.options).toEqual(RENDER_KINDS.filter(kind => kind !== "bars"));
    expect(p?.optionLabels).toBeTruthy();
  });
});

describe("manifest contentTemplates (PRD-29)", () => {
  it("вид итогов получает три настройки блоков с русскими подписями", () => {
    const results = (manifest.contentTemplates as Array<Record<string, unknown>>)
      .find((c) => c.kind === "results");
    const settings = results?.settings as Array<Record<string, unknown>>;
    // Проверяем ПРИСУТСТВИЕ своих трёх настроек, а не то, что других нет: вид «Итоги»
    // общий, и соседние работы законно добавляют к нему свои (например радар PRD-35).
    // Утверждение о точном составе делало наш тест сторожем чужой области.
    const keys = settings.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["scoreSummary", "indicators", "scales"]));
    settings
      .filter((s) => ["scoreSummary", "indicators", "scales"].includes(s.key as string))
      .forEach((s) => {
      expect(s.type).toBe("select");
      expect(s.default).toBe("auto");
      expect(s.options).toEqual(["auto", "show", "hide"]);
      expect(s.optionLabels).toEqual({
        auto: "Автоматически",
        show: "Показывать",
        hide: "Скрывать",
      });
    });
  });
});
