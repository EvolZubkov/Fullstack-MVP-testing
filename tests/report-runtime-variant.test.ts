// @vitest-environment jsdom
/**
 * @module tests/report-runtime-variant
 *
 * PRD-27 Фаза 5 — рантайм ПАКЕТА выбирает макет отчёта по запеканию (FR-22).
 *
 * Функции `pdfExport.js` компилируются как есть (не исполняя модуль целиком) и
 * прогоняются на подставленных `TEST_DATA`/`state`. Пиннится то, что иначе всплывает
 * только в LMS: пакет собран с одним вариантом, а рисует другой — либо, для пакета
 * СТАРОЙ сборки, где запекания нет, вообще перестаёт собирать отчёт.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "server/scorm/template/app/utils/pdfExport.js"),
  "utf8",
);

/**
 * Поднять две функции выбора макета на заданном окружении пакета.
 *
 * @param env `TEST_DATA` и `state`, какими их видит рантайм.
 */
function runtime(env: { TEST_DATA: unknown; state: unknown; systemLayout?: (k: string) => string }) {
  const factory = new Function(
    "TEST_DATA",
    "state",
    "systemLayout",
    `${SRC}\nreturn { pdfReportBake: pdfReportBake, pdfReportLayout: pdfReportLayout };`,
  );
  return factory(env.TEST_DATA, env.state, env.systemLayout) as {
    pdfReportBake: () => { layoutKey?: string; values?: Record<string, unknown> } | null;
    pdfReportLayout: (key: string) => string;
  };
}

const LAYOUTS = {
  report: "<div class=\"tb-report\">канонический</div>",
  "layouts/report.certificate.html": "<div class=\"tb-report\">сертификат</div>",
};

describe("выбор макета отчёта в пакете", () => {
  it("читает запекание из TEST_DATA", () => {
    const bake = { variantKey: "report.certificate", layoutKey: "layouts/report.certificate.html", values: { a: 1 } };
    const rt = runtime({
      TEST_DATA: { mode: "standard", designSettings: { report: bake } },
      state: { templateLayouts: LAYOUTS },
    });
    expect(rt.pdfReportBake()).toEqual(bake);
    expect(rt.pdfReportLayout(bake.layoutKey)).toContain("сертификат");
  });

  it("пакет СТАРОЙ сборки (запекания нет) отчёта не лишается", () => {
    // FR-28: до этого PRD в TEST_DATA не было `designSettings.report`. Такой пакет
    // обязан продолжать собирать отчёт по каноническому виду.
    const rt = runtime({
      TEST_DATA: { mode: "standard", designSettings: { templateId: "default" } },
      state: { templateLayouts: LAYOUTS },
    });
    expect(rt.pdfReportBake()).toBeNull();
    expect(rt.pdfReportLayout("report")).toContain("канонический");
  });

  it("пакет вообще без designSettings не падает", () => {
    const rt = runtime({ TEST_DATA: { mode: "standard" }, state: { templateLayouts: LAYOUTS } });
    expect(rt.pdfReportBake()).toBeNull();
  });

  it("деградация: канонический ключ уходит в systemLayout, а не в макеты шаблона", () => {
    // Шаблон вида не объявил — макет лежит в ЗАПАСНЫХ, и достать его может только
    // `systemLayout`. Если рантайм полезет прямо в `templateLayouts`, отчёта не будет.
    const seen: string[] = [];
    const rt = runtime({
      TEST_DATA: { mode: "standard", designSettings: { report: { layoutKey: "report" }, fallbackLayoutKeys: ["report"] } },
      state: { templateLayouts: {} },
      systemLayout: (k: string) => {
        seen.push(k);
        return k === "report" ? "<div class=\"tb-report\">из стандартного</div>" : "";
      },
    });
    expect(rt.pdfReportLayout("report")).toContain("из стандартного");
    expect(seen).toContain("report");
  });

  it("нет ни того ни другого — пустая строка, а не исключение", () => {
    const rt = runtime({
      TEST_DATA: { mode: "standard", designSettings: { report: { layoutKey: "layouts/нет.html" } } },
      state: { templateLayouts: {} },
    });
    expect(rt.pdfReportLayout("layouts/нет.html")).toBe("");
  });
});

/**
 * Источники консолидированного блока на стороне ПАКЕТА. Экран итогов берёт их из
 * `TEST_DATA` через `vr*`-читатели рантайма; отчёт обязан брать ровно те же, иначе
 * ученик читает на экране одно, а уносит в PDF другое.
 */
describe("вход отчёта пакета несёт источники блока", () => {
  const SECTION_TEXTS = ["Текст темы", "Текст раздела"];
  const SECTION_ASSETS = [{ title: "Разбор темы", url: "assets/media/topic.pdf" }];
  const TEST_FEEDBACK = { text: "Разберите ошибки.", links: [], events: [], assets: [] };

  /** Поднять сборщики входа с подставленными читателями `viewResults.js`. */
  function inputs() {
    const factory = new Function(
      "TEST_DATA",
      "vrTopicFeedbackTexts",
      "vrTopicAssets",
      "vrTestFeedback",
      "vrHasPassThreshold",
      `${SRC}\nreturn { std: pdfStandardInput, adaptive: pdfAdaptiveInput, meta: pdfReportMeta };`,
    );
    return factory(
      { mode: "standard", sections: [{ topicId: "t1", topicName: "Тема 1" }] },
      () => SECTION_TEXTS,
      () => SECTION_ASSETS,
      () => TEST_FEEDBACK,
      () => true,
    ) as {
      std: (r: unknown) => { topicResults: Array<Record<string, unknown>> };
      adaptive: (r: unknown) => { topicResults: Array<Record<string, unknown>> };
      meta: () => Record<string, unknown>;
    };
  }

  const runtimeResult = {
    passed: false,
    percent: 60,
    totalQuestions: 5,
    totalCorrect: 3,
    earnedPoints: 3,
    possiblePoints: 5,
    topicResults: [
      { topicId: "t1", topicName: "Тема 1", correct: 3, total: 5, percent: 60, earnedPoints: 3, possiblePoints: 5, passed: false },
    ],
  };

  it("стандартный вход несёт тексты и вложения темы под именами общего сборщика", () => {
    const topic = inputs().std(runtimeResult).topicResults[0];
    expect(topic.feedbackTexts).toEqual(SECTION_TEXTS);
    expect(topic.recommendedAssets).toEqual(SECTION_ASSETS);
  });

  it("адаптивный вход несёт их же", () => {
    const topic = inputs().adaptive({
      topicResults: [{ topicId: "t1", topicName: "Тема 1", achievedLevelIndex: null }],
    }).topicResults[0];
    expect(topic.feedbackTexts).toEqual(SECTION_TEXTS);
    expect(topic.recommendedAssets).toEqual(SECTION_ASSETS);
  });

  it("признак порога уходит вместе с входом, обратной связи теста в нём больше нет", () => {
    // PRD-61 §10: `pdfReportMeta` перестал читать обратную связь ТЕСТА — её сняли целиком.
    expect(inputs().meta()).toEqual({ hasPassThreshold: true });
  });
});

/**
 * ТОЛКОВАНИЯ в отчёте ПАКЕТА (PRD-51 §5.2).
 *
 * Экран итогов дописывает их в строку темы читателем `vrWithInterpretations`
 * (`viewResults.js`), и отчёт обязан звать ТОТ ЖЕ читатель: собранный своим набором полей,
 * он молча печатал компетенцию с пустой правой колонкой — при заполненном толковании в
 * базе. Проверяется на настоящем читателе рантайма, а не на двойнике: подмена читателя
 * здесь означала бы проверку той самой копии правила, которой быть не должно.
 */
describe("вход отчёта пакета несёт толкования", () => {
  const VIEW_SRC = fs.readFileSync(
    path.resolve(process.cwd(), "server/scorm/template/app/render/viewResults.js"),
    "utf8",
  );

  const TOPIC = { format: "plain", text: "Толкование самой темы" };
  const SECTION = { format: "html", text: "<p>Толкование этого теста</p>" };
  const KEYS = { "ПДн": { format: "plain", text: "Толкование подтемы" } };

  const TEST_DATA = {
    mode: "standard",
    sections: [
      {
        topicId: "t1",
        topicName: "Тема 1",
        interpretation: TOPIC,
        sectionInterpretation: SECTION,
        breakdownInterpretation: KEYS,
      },
    ],
  };

  /** Настоящий читатель экрана итогов на этих же `TEST_DATA`. */
  function liftWithInterpretations() {
    const match = VIEW_SRC.match(/function vrWithInterpretations\([\s\S]*?\n\}/);
    if (!match) throw new Error("vrWithInterpretations not found in viewResults.js");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function("TEST_DATA", `${match[0]}\n;return vrWithInterpretations;`)(TEST_DATA) as (
      row: Record<string, unknown>,
      tr: unknown,
    ) => Record<string, unknown>;
  }

  /** Сборщики входа с подставленным читателем толкований. */
  function inputs() {
    const factory = new Function(
      "TEST_DATA",
      "vrWithInterpretations",
      `${SRC}\nreturn { std: pdfStandardInput, adaptive: pdfAdaptiveInput };`,
    );
    return factory(TEST_DATA, liftWithInterpretations()) as {
      std: (r: unknown) => { topicResults: Array<Record<string, unknown>> };
      adaptive: (r: unknown) => { topicResults: Array<Record<string, unknown>> };
    };
  }

  const result = {
    passed: false,
    percent: 60,
    totalQuestions: 5,
    totalCorrect: 3,
    topicResults: [
      { topicId: "t1", topicName: "Тема 1", correct: 3, total: 5, percent: 60, passed: false },
    ],
  };

  it("стандартный вход несёт все три поля под именами общего построителя", () => {
    const topic = inputs().std(result).topicResults[0];
    expect(topic.interpretation).toEqual(TOPIC);
    expect(topic.sectionInterpretation).toEqual(SECTION);
    expect(topic.breakdownInterpretation).toEqual(KEYS);
  });

  it("раздел без толкований оставляет строку прежней — полей не появляется", () => {
    const factory = new Function(
      "TEST_DATA",
      "vrWithInterpretations",
      `${SRC}\nreturn pdfStandardInput;`,
    );
    const bare = { mode: "standard", sections: [{ topicId: "t1", topicName: "Тема 1" }] };
    const match = VIEW_SRC.match(/function vrWithInterpretations\([\s\S]*?\n\}/)!;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const reader = new Function("TEST_DATA", `${match[0]}\n;return vrWithInterpretations;`)(bare);
    const std = factory(bare, reader) as (r: unknown) => { topicResults: Array<Record<string, unknown>> };
    const topic = std(result).topicResults[0];
    expect(topic).not.toHaveProperty("interpretation");
    expect(topic).not.toHaveProperty("sectionInterpretation");
    expect(topic).not.toHaveProperty("breakdownInterpretation");
  });

  it("пакет СТАРОЙ сборки без читателя не падает", () => {
    // `vrWithInterpretations` появился вместе с толкованиями; отчёт пакета, собранного до
    // них, обязан собираться прежним — без полей и без исключения.
    const factory = new Function("TEST_DATA", `${SRC}\nreturn pdfStandardInput;`);
    const std = factory(TEST_DATA) as (r: unknown) => { topicResults: Array<Record<string, unknown>> };
    expect(() => std(result)).not.toThrow();
    expect(std(result).topicResults[0]).not.toHaveProperty("interpretation");
  });
});

describe("исходник экспорта", () => {
  it("значения полей варианта уходят в построитель контекста", () => {
    // Иначе автор задаёт параметры вида, а в PDF они не приезжают — и понять это
    // можно только скачав файл.
    expect(SRC).toMatch(/values:\s*pdfImageValues/);
  });

  it("картинки варианта инлайнятся общим модулем, а не грузятся по зашитым путям", () => {
    // FR-05: пакет не знает ни имён файлов подложки и логотипа, ни каталога, где они
    // лежали до PRD-27 — пути приходят от сборщика вместе с ключами полей.
    expect(SRC).toContain("TB.inlineReportImageValues(");
    expect(SRC).toMatch(/bake && bake\.imageKeys \? bake\.imageKeys : \[\]/);
    expect(SRC).not.toContain("assets/media/");
    expect(SRC).not.toContain("loadReportAssets");
  });

  it("источники блока обратной связи прицеплены к мета-части входа", () => {
    // Сами поля проверены выше на выходе `pdfReportMeta`; здесь караулится, что они
    // действительно уезжают в построитель, а не остаются в неиспользуемой функции.
    expect(SRC).toContain("}, pdfReportMeta());");
  });

  it("сначала пробуется макет варианта, потом канонический вид", () => {
    expect(SRC).toContain("pdfReportLayout(bake.layoutKey)");
    expect(SRC).toContain("if (!layout) layout = pdfReportLayout(kind);");
  });
});
