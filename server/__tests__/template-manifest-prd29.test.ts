import { describe, it, expect } from "vitest";
import manifest from "../scorm/templates/default/manifest.json";

const params = manifest.params as Array<Record<string, unknown>>;
const byKey = (key: string) => params.find((p) => p.key === key);

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

  it("объявляет виды рендера для шкал и показателей", () => {
    for (const key of ["scaleRenderKind", "indicatorRenderKind"]) {
      const p = byKey(key);
      expect(p?.type).toBe("select");
      expect(p?.options).toEqual([
        "label",
        "value",
        "value_of_max",
        "ring",
        "band_ruler",
        "gradient_bar",
      ]);
      expect(p?.optionLabels).toBeTruthy();
    }
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
