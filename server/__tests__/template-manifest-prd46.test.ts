/**
 * @module server/__tests__/template-manifest-prd46
 *
 * PRD-46 §4. Выбор вида диаграммы объявляется МАНИФЕСТОМ и рисуется обобщённым контролом
 * настроек, поэтому единственное, что нужно проверить, — что объявление на месте, одинаково у
 * обоих шаблонов и умалчивает в «нет».
 *
 * Умолчание сторожится отдельно: «авто» РИСУЕТ, и умолчание, которое рисует, поставило бы
 * диаграмму каждому существующему тесту, автор которого её не просил.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Field {
  key: string;
  type: string;
  default?: unknown;
  options?: string[];
  optionLabels?: Record<string, string>;
}

interface ContentTemplate {
  key: string;
  kind?: string;
  settings?: Field[];
}

const TEMPLATES = {
  "Стандартный": "server/scorm/templates/default/manifest.json",
  "Сертификация": "templates/certification/manifest.json",
};

function variants(path: string): ContentTemplate[] {
  const manifest = JSON.parse(readFileSync(resolve(path), "utf-8")) as {
    contentTemplates: ContentTemplate[];
  };
  return manifest.contentTemplates.filter((c) => c.settings?.some((s) => s.key === "scalesChartKind"));
}

describe.each(Object.entries(TEMPLATES))("манифест «%s»: выбор вида диаграммы", (_name, path) => {
  it("объявлен там же, где жила галочка радара", () => {
    const withKind = variants(path);
    expect(withKind.length).toBeGreaterThan(0);
    for (const variant of withKind) {
      expect(variant.settings!.some((s) => s.key === "showCompetencyRadar")).toBe(true);
    }
  });

  it("несёт четыре значения с русскими подписями и умалчивает в «нет»", () => {
    for (const variant of variants(path)) {
      const field = variant.settings!.find((s) => s.key === "scalesChartKind")!;
      expect(field.type).toBe("select");
      expect(field.options).toEqual(["none", "auto", "radar", "rose"]);
      expect(Object.keys(field.optionLabels ?? {})).toEqual(["none", "auto", "radar", "rose"]);
      expect(field.default).toBe("none");
    }
  });
});

/**
 * PRD-46 §7. Оформление шкал — цвет и пиктограмма — приносит ШАБЛОН, поэтому объявляется
 * рядом с выбором вида, а не в форме шкалы. Проверяется ровно то, чего нельзя увидеть из
 * кода: объявление стоит у экрана итогов обоих поставляемых шаблонов, умалчивает в пустой
 * карте и заявляет свой тип из закрытого реестра — незнакомый тип редактор встретит
 * диагностикой вместо контрола.
 */
describe.each(Object.entries(TEMPLATES))("манифест «%s»: оформление шкал", (_name, path) => {
  function resultsVariants(): ContentTemplate[] {
    return variants(path).filter((c) => c.kind === "results");
  }

  it("объявлено у экрана итогов рядом с выбором вида", () => {
    const results = resultsVariants();
    expect(results.length).toBeGreaterThan(0);
    for (const variant of results) {
      expect(variant.settings!.some((s) => s.key === "scaleAppearance")).toBe(true);
    }
  });

  it("несёт свой тип поля и умалчивает в пустой карте", () => {
    for (const variant of resultsVariants()) {
      const field = variant.settings!.find((s) => s.key === "scaleAppearance")!;
      expect(field.type).toBe("scaleAppearance");
      expect(field.default).toEqual({});
    }
  });
});

/**
 * PRD-46 §6. Предел оси — свойство ФИГУРЫ, поэтому объявляется у каждого варианта, который
 * рисует диаграмму, а не только у экрана итогов: отчёт уносят специалисту, и у него свой
 * переключатель вида.
 *
 * Умолчание сторожится отдельно: любое значение, кроме «домена», перерисовало бы диаграмму
 * каждому существующему тесту в другом масштабе, и на экране ничто бы об этом не сказало.
 */
describe.each(Object.entries(TEMPLATES))("манифест «%s»: предел оси радара", (_name, path) => {
  it("объявлен везде, где объявлен выбор вида", () => {
    const withKind = variants(path);
    expect(withKind.length).toBeGreaterThan(0);
    for (const variant of withKind) {
      expect(variant.settings!.some((s) => s.key === "radarAxisLimit"), variant.key).toBe(true);
    }
  });

  it("несёт три значения с русскими подписями и умалчивает в «домене»", () => {
    for (const variant of variants(path)) {
      const field = variant.settings!.find((s) => s.key === "radarAxisLimit")!;
      expect(field.type).toBe("select");
      expect(field.options).toEqual(["domain", "declared", "attempt"]);
      expect(Object.keys(field.optionLabels ?? {})).toEqual(["domain", "declared", "attempt"]);
      expect(field.default).toBe("domain");
    }
  });
});
