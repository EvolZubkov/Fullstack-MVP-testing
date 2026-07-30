/**
 * @module tests/report-variants
 *
 * PRD-27 Фаза 1: контракт вида отчёта в манифесте (`shared/report/report-variants`).
 *
 * Главное, что здесь пиннится, — статические проверки §6.3. CSS шаблона в SCORM-пакете
 * лежит в главном документе, а на вебе внедряется внутрь Shadow DOM экрана, тогда как
 * отчёт рендерится вне сцены. Поэтому макет отчёта, опирающийся на слой сцены или на
 * селекторы документа, ВЫГЛЯДИТ рабочим в LMS и ломается в браузере — ревью такое не
 * ловит, ловит только проверка при активации (FR-25, риск R-1a).
 */

import { describe, it, expect } from "vitest";
import {
  REPORT_KINDS,
  REPORT_ROOT_CLASS,
  isReportKind,
  reportKindForMode,
  reportVariants,
  resolveReportVariant,
  resolveReportValues,
  carriedOverSettingKeys,
  validateReportVariants,
} from "../shared/report/report-variants";

const LAYOUT_OK = `<div class="tb-report"><h1 data-path="course.title"></h1></div>`;

/** Манифест с одним видом отчёта и одним вариантом. */
function manifest(over: Record<string, unknown> = {}) {
  return {
    contentTemplates: [
      { key: "results.standard", kind: "results", layoutFile: "layouts/results.html" },
      {
        key: "report.standard",
        label: "Сертификат",
        kind: "report",
        layoutFile: "layouts/report.html",
        isDefault: true,
        settings: [{ key: "headline", type: "text", default: "Итоги" }],
        ...over,
      },
    ],
  };
}

const reader = (files: Record<string, string>) => (path: string) => files[path] ?? null;
const FILES_OK = { "layouts/report.html": LAYOUT_OK };

describe("виды отчёта", () => {
  it("обычный и адаптивный — РАЗНЫЕ виды", () => {
    expect(REPORT_KINDS).toEqual(["report", "report.adaptive"]);
    expect(reportKindForMode("standard")).toBe("report");
    expect(reportKindForMode("adaptive")).toBe("report.adaptive");
    // Режим не задан = обычный: так ведут себя и остальные экраны.
    expect(reportKindForMode(null)).toBe("report");
    expect(isReportKind("report.adaptive")).toBe(true);
    expect(isReportKind("results")).toBe(false);
  });

  it("возвращает варианты только запрошенного вида, в порядке объявления", () => {
    const m = {
      contentTemplates: [
        { key: "report.b", kind: "report" },
        { key: "adaptive.a", kind: "report.adaptive" },
        { key: "report.a", kind: "report" },
        // Без key вариант выбрать нельзя — резолвер его не отдаёт, о нём сообщает валидация.
        { kind: "report" },
      ],
    };
    expect(reportVariants(m, "report").map((v) => v.key)).toEqual(["report.b", "report.a"]);
    expect(reportVariants(m, "report.adaptive").map((v) => v.key)).toEqual(["adaptive.a"]);
  });

  it("варианты без contentTemplates не роняют резолвер", () => {
    expect(reportVariants(null, "report")).toEqual([]);
    expect(reportVariants({}, "report")).toEqual([]);
    expect(resolveReportVariant({}, "report")).toBeNull();
  });
});

describe("выбор варианта", () => {
  const m = {
    contentTemplates: [
      { key: "a", kind: "report" },
      { key: "b", kind: "report", isDefault: true },
    ],
  };

  it("выбранный автором побеждает", () => {
    expect(resolveReportVariant(m, "report", "a")?.key).toBe("a");
  });

  it("без выбора берётся isDefault", () => {
    expect(resolveReportVariant(m, "report")?.key).toBe("b");
  });

  it("выбор, которого шаблон больше не объявляет, откатывается на isDefault", () => {
    // Так ведёт себя тест, переведённый на другой шаблон: молча ломаться нельзя.
    expect(resolveReportVariant(m, "report", "исчез")?.key).toBe("b");
  });

  it("без isDefault берётся первый объявленный", () => {
    const noDefault = { contentTemplates: [{ key: "x", kind: "report" }, { key: "y", kind: "report" }] };
    expect(resolveReportVariant(noDefault, "report")?.key).toBe("x");
  });

  it("вид не объявлен — null, хост деградирует на «Стандартный»", () => {
    expect(resolveReportVariant(m, "report.adaptive")).toBeNull();
  });
});

describe("значения полей варианта", () => {
  const variant = {
    key: "v",
    kind: "report" as const,
    settings: [
      { key: "headline", type: "text", default: "Итоги" },
      { key: "showRecs", type: "boolean", default: true },
      { key: "bg", type: "image" },
    ],
  };

  it("правки автора накладываются на default манифеста", () => {
    expect(resolveReportValues(variant, { headline: "Аттестация" })).toEqual({
      headline: "Аттестация",
      showRecs: true,
      bg: "",
    });
  });

  it("поле без значения и без default приходит пустым, а не undefined", () => {
    // Макет обязан выдержать пустое значение (FR-04); undefined в DSL — дыра в разметке.
    expect(resolveReportValues(variant, {}).bg).toBe("");
  });

  it("значение поля, которого вариант не объявляет, отбрасывается", () => {
    const out = resolveReportValues(variant, { headline: "X", чужое: "Y" });
    expect(out).not.toHaveProperty("чужое");
  });

  it("без варианта значений нет", () => {
    expect(resolveReportValues(null, { headline: "X" })).toEqual({});
  });

  it("false и 0 сохраняются, а не подменяются default", () => {
    expect(resolveReportValues(variant, { showRecs: false }).showRecs).toBe(false);
  });
});

describe("перенос значений при смене варианта (FR-14)", () => {
  const from = {
    key: "a",
    kind: "report" as const,
    settings: [
      { key: "headline", type: "text" },
      { key: "bg", type: "image" },
      { key: "sign", type: "text" },
    ],
  };
  const to = {
    key: "b",
    kind: "report" as const,
    settings: [
      { key: "headline", type: "text" },
      // тот же ключ, ДРУГОЙ тип — переносить нельзя
      { key: "bg", type: "text" },
    ],
  };

  it("переносится совпадающее по ключу И типу", () => {
    expect(carriedOverSettingKeys(from, to)).toEqual(["headline"]);
  });

  it("без вариантов переносить нечего", () => {
    expect(carriedOverSettingKeys(null, to)).toEqual([]);
    expect(carriedOverSettingKeys(from, null)).toEqual([]);
  });
});

describe("валидация вариантов отчёта (FR-25)", () => {
  const msgs = (m: unknown, files: Record<string, string>) =>
    validateReportVariants(m, reader(files)).map((i) => i.message);

  it("корректный вариант замечаний не даёт", () => {
    expect(validateReportVariants(manifest(), reader(FILES_OK))).toEqual([]);
  });

  it("манифест без вариантов отчёта проверку не трогает", () => {
    expect(validateReportVariants({ contentTemplates: [{ key: "x", kind: "info" }] }, reader({}))).toEqual([]);
    expect(validateReportVariants(null, reader({}))).toEqual([]);
  });

  it("требует layoutFile: общего макета у отчёта нет", () => {
    const m = manifest({ layoutFile: undefined });
    expect(msgs(m, FILES_OK).join(" ")).toContain("обязан объявить layoutFile");
  });

  it("сообщает про макет, которого нет в пакете", () => {
    expect(msgs(manifest(), {}).join(" ")).toContain("макет не найден в пакете");
  });

  it("требует корневой класс tb-report", () => {
    const files = { "layouts/report.html": '<div class="my-report"></div>' };
    expect(msgs(manifest(), files).join(" ")).toContain(`нести класс "${REPORT_ROOT_CLASS}"`);
  });

  it("запрещает слой сцены — он заработал бы в пакете и сломался в браузере", () => {
    const files = { "layouts/report.html": '<div class="tb-report"><div class="tb-scene__foot"></div></div>' };
    const joined = msgs(manifest(), files).join(" ");
    expect(joined).toContain("классы слоя сцены");
    expect(joined).toContain("в браузере — нет");
  });

  it("требует, чтобы CSS варианта был скоуплен в .tb-report", () => {
    const m = manifest({ styleFile: "styles/report.css" });
    const files = { ...FILES_OK, "styles/report.css": ".tb-report__row { color: red } .loose { color: blue }" };
    const joined = msgs(m, files).join(" ");
    expect(joined).toContain('".loose"');
    expect(joined).toContain("не вложен");
    // Скоупленный селектор замечаний не вызывает.
    expect(joined).not.toContain('".tb-report__row"');
  });

  it("запрещает в CSS варианта селекторы документа", () => {
    const m = manifest({ styleFile: "styles/report.css" });
    for (const bad of [":root { --x: 1 }", "body { margin: 0 }", "html { font-size: 10px }"]) {
      const joined = msgs(m, { ...FILES_OK, "styles/report.css": bad }).join(" ");
      expect(joined, bad).toContain("адресует документ");
    }
  });

  it("не путает `body` внутри имени класса с селектором документа", () => {
    const m = manifest({ styleFile: "styles/report.css" });
    const files = { ...FILES_OK, "styles/report.css": ".tb-report .card__body { padding: 0 }" };
    expect(msgs(m, files)).toEqual([]);
  });

  it("сообщает про таблицу стилей, которой нет в пакете", () => {
    const m = manifest({ styleFile: "styles/missing.css" });
    expect(msgs(m, FILES_OK).join(" ")).toContain("таблица стилей не найдена");
  });

  it("отклоняет тип поля sequence: у отчёта нет последовательностей", () => {
    const m = manifest({ settings: [{ key: "seq", type: "sequence" }] });
    expect(msgs(m, FILES_OK).join(" ")).toContain('тип "sequence" неприменим к отчёту');
  });

  it("отклоняет неизвестный тип поля через общий реестр", () => {
    const m = manifest({ settings: [{ key: "x", type: "wat" }] });
    expect(msgs(m, FILES_OK).join(" ")).toContain("неизвестный тип");
  });

  it("отклоняет placeholders: у отчёта нет читаемого содержимого", () => {
    const m = manifest({ placeholders: [{ key: "body", type: "text" }] });
    expect(msgs(m, FILES_OK).join(" ")).toContain("placeholders неприменимы");
  });

  it("требует ровно один isDefault на вид", () => {
    const none = { contentTemplates: [{ key: "a", kind: "report", layoutFile: "layouts/report.html" }] };
    expect(msgs(none, FILES_OK).join(" ")).toContain("ни один вариант не помечен isDefault");

    const two = {
      contentTemplates: [
        { key: "a", kind: "report", layoutFile: "layouts/report.html", isDefault: true },
        { key: "b", kind: "report", layoutFile: "layouts/report.html", isDefault: true },
      ],
    };
    expect(msgs(two, FILES_OK).join(" ")).toContain("isDefault помечены 2 варианта");
  });

  it("считает isDefault по каждому виду отдельно", () => {
    const m = {
      contentTemplates: [
        { key: "a", kind: "report", layoutFile: "layouts/report.html", isDefault: true },
        { key: "b", kind: "report.adaptive", layoutFile: "layouts/report.html", isDefault: true },
      ],
    };
    expect(validateReportVariants(m, reader(FILES_OK))).toEqual([]);
  });

  it("замечание указывает на место в манифесте", () => {
    const issues = validateReportVariants(manifest({ layoutFile: undefined }), reader({}));
    expect(issues[0].variantKey).toBe("report.standard");
    expect(issues[0].ref).toBe("contentTemplates.report.standard.layoutFile");
  });

  it("вариант без key всё равно проверяется и называется по позиции", () => {
    const m = { contentTemplates: [{ kind: "report", layoutFile: "layouts/report.html", isDefault: true }] };
    const issues = validateReportVariants(m, reader(FILES_OK));
    expect(issues.map((i) => i.message).join(" ")).toContain("обязан иметь key");
    expect(issues[0].variantKey).toBe("#1");
  });

  it("без доступа к файлам проверяет ТОЛЬКО объявления (режим активационного гейта)", () => {
    // Гейт активации файлов пакета не открывает. Отсутствие файлов — не улика:
    // проверки макета и CSS пропускаются, объявленческие остаются.
    const declOnly = validateReportVariants(manifest({ styleFile: "styles/report.css" }));
    expect(declOnly).toEqual([]);

    const bad = validateReportVariants(manifest({ settings: [{ key: "seq", type: "sequence" }] }));
    expect(bad.map((i) => i.message).join(" ")).toContain("неприменим к отчёту");

    const noLayout = validateReportVariants(manifest({ layoutFile: undefined }));
    expect(noLayout.map((i) => i.message).join(" ")).toContain("обязан объявить layoutFile");
  });

  it("не спотыкается о комментарии и @-правила в CSS варианта", () => {
    const m = manifest({ styleFile: "styles/report.css" });
    const css = "/* .loose {} */\n@media print { .tb-report { color: black } }\n.tb-report h1 { margin: 0 }";
    expect(msgs(m, { ...FILES_OK, "styles/report.css": css })).toEqual([]);
  });
});
