/**
 * @module tests/services.design-fields
 *
 * PRD-48 Э5: приведение значений оформления и полей отчёта к типам, объявленным манифестом
 * ПРИЁМНИКА. Из ячейки Excel всё приходит строкой, а модель ждёт булево, число, массив и
 * медиа-конверт; вид отчёта, которого приёмник не объявляет, продукт молча подменяет — здесь
 * это ошибка. Проверяются: приведение каждого типа, отказ незаявленному ключу, правила
 * переопределения по палитрам и обе ветви отчёта.
 */
import { describe, it, expect } from "vitest";
import { normalizeDesignParams, normalizeReportBranch } from "../server/services/design-fields";

/** Манифест приёмника: две палитры, параметры всех типов, два вида отчёта. */
const MANIFEST = {
  id: "corporate",
  themes: [
    { id: "light", label: "Светлая" },
    { id: "dark", label: "Тёмная" },
  ],
  params: [
    { key: "primaryColor", type: "color" },
    { key: "cardColor", type: "color" },
    { key: "showProgressBar", type: "boolean" },
    { key: "cardRadius", type: "number" },
    { key: "fontFamily", type: "select", options: ["Inter", "Roboto"] },
    {
      key: "progress.mode",
      type: "select",
      options: ["questions", "pages"],
      optionLabels: { questions: "По вопросам", pages: "По страницам" },
    },
    { key: "hiddenBlocks", type: "multiselect", options: ["timer", "map"] },
    { key: "logoUrl", type: "image" },
    { key: "manual", type: "downloadLink" },
    { key: "caption", type: "text" },
  ],
  contentTemplates: [
    {
      key: "report.default",
      kind: "report",
      isDefault: true,
      settings: [
        { key: "showScales", type: "boolean" },
        { key: "title", type: "text" },
        { key: "copies", type: "number" },
        { key: "background", type: "image" },
      ],
    },
    { key: "report.compact", kind: "report", settings: [{ key: "showScales", type: "boolean" }] },
    {
      key: "report.adaptive.default",
      kind: "report.adaptive",
      isDefault: true,
      settings: [{ key: "showLevels", type: "boolean" }],
    },
  ],
};

/** Шаблон без палитр — по нему проверяются отказы переопределению по теме. */
const FLAT_MANIFEST = { id: "default", params: [{ key: "primaryColor", type: "color" }] };

describe("нормализация оформления по манифесту", () => {
  it("значения из ячеек приводятся к объявленным типам", () => {
    const out = normalizeDesignParams(
      {
        params: {
          primaryColor: " #ff0000 ",
          showProgressBar: "false",
          cardRadius: "12",
          fontFamily: "Roboto",
          "progress.mode": "По страницам",
          hiddenBlocks: "timer, map",
          logoUrl: "/api/media/abc/logo.png",
          caption: "Итоги",
        },
      },
      MANIFEST,
    );

    expect(out.errors).toEqual([]);
    expect(out.params).toEqual({
      primaryColor: "#ff0000",
      showProgressBar: false,
      cardRadius: 12,
      fontFamily: "Roboto",
      // Подпись из манифеста принимается наравне со значением.
      "progress.mode": "pages",
      hiddenBlocks: ["timer", "map"],
      logoUrl: { url: "/api/media/abc/logo.png", name: "logo.png" },
      caption: "Итоги",
    });
  });

  it("строка «false» без приведения была бы истиной — этого не происходит", () => {
    const out = normalizeDesignParams({ params: { showProgressBar: "false" } }, MANIFEST);
    expect(out.params.showProgressBar).toBe(false);
  });

  it("массив и конверт из ячейки-JSON доходят объектами", () => {
    const out = normalizeDesignParams(
      {
        params: {
          hiddenBlocks: ["map"],
          manual: { url: "/api/media/x", name: "Инструкция.pdf", mime: "application/pdf", junk: 1 },
        },
      },
      MANIFEST,
    );
    expect(out.errors).toEqual([]);
    expect(out.params.hiddenBlocks).toEqual(["map"]);
    // В конверте остаются только поля модели: «junk» не хранится.
    expect(out.params.manual).toEqual({
      url: "/api/media/x",
      name: "Инструкция.pdf",
      mime: "application/pdf",
    });
  });

  it("незаявленный ключ не пишется, а называется", () => {
    const out = normalizeDesignParams(
      { params: { primaryColor: "#fff", неведомый: "1" } },
      MANIFEST,
    );
    expect(out.params).toEqual({ primaryColor: "#fff" });
    expect(out.dropped).toEqual(["неведомый"]);
    expect(out.errors).toEqual([]);
  });

  it("значение, которое не приводится к типу, — ошибка с внятным текстом", () => {
    const out = normalizeDesignParams(
      {
        params: {
          showProgressBar: "иногда",
          cardRadius: "много",
          fontFamily: "Comic Sans",
          hiddenBlocks: "timer, часы",
          logoUrl: { name: "без адреса" },
          primaryColor: "#00ff00",
        },
      },
      MANIFEST,
    );

    expect(out.errors).toHaveLength(5);
    expect(out.errors.join("\n")).toContain("showProgressBar");
    expect(out.errors.join("\n")).toContain("Comic Sans");
    expect(out.errors.join("\n")).toContain("Inter, Roboto");
    // Ошибка ключа не отменяет остальных: применяется всё, что приводится.
    expect(out.params).toEqual({ primaryColor: "#00ff00" });
  });

  it("пустой цвет не пишется: отсутствие параметра и есть «берётся из шаблона»", () => {
    // Цвет отпускается кнопкой «Вернуть из шаблона», а она УДАЛЯЕТ ключ; то же у select
    // и медиа. Пустая ячейка таких типов — не значение.
    const out = normalizeDesignParams(
      { params: { primaryColor: "", fontFamily: "  ", logoUrl: "" } },
      MANIFEST,
    );
    expect(out.params).toEqual({});
    expect(out.errors).toEqual([]);
  });

  it("пустой текст параметра сохраняется: именно его кладёт редактор стёртым полем", () => {
    // У `text`/`url` кнопки сброса нет — автор стирает поле, и в модель уходит пустая
    // строка. Отбросив её, круг «выгрузка → загрузка» вернул бы умолчание манифеста.
    const out = normalizeDesignParams({ params: { caption: "" } }, MANIFEST);
    expect(out.params).toEqual({ caption: "" });
    expect(out.errors).toEqual([]);
  });

  it("по палитре настраивается только цвет и только объявленной палитрой", () => {
    const out = normalizeDesignParams(
      {
        theme: "dark",
        paramsByTheme: {
          light: { primaryColor: "#111", showProgressBar: "true", неведомый: "1" },
          sepia: { primaryColor: "#222" },
        },
      },
      MANIFEST,
    );

    expect(out.theme).toBe("dark");
    expect(out.paramsByTheme).toEqual({ light: { primaryColor: "#111" } });
    expect(out.dropped).toEqual(["неведомый"]);
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0]).toContain("только цвет");
    expect(out.errors[1]).toContain("sepia");
  });

  it("шаблон без палитр отвергает и переопределение, и выбор палитры", () => {
    const out = normalizeDesignParams(
      { theme: "dark", paramsByTheme: { light: { primaryColor: "#111" } } },
      FLAT_MANIFEST,
    );
    expect(out.theme).toBeUndefined();
    expect(out.paramsByTheme).toEqual({});
    expect(out.errors).toHaveLength(2);
  });

  it("«Авто» на шаблоне без палитр — не ошибка: таким тест и был", () => {
    const out = normalizeDesignParams({ theme: "auto" }, FLAT_MANIFEST);
    expect(out.errors).toEqual([]);
    expect(out.theme).toBeUndefined();
  });

  it("неизвестная палитра теста — ошибка", () => {
    const out = normalizeDesignParams({ theme: "сумерки" }, MANIFEST);
    expect(out.theme).toBeUndefined();
    expect(out.errors[0]).toContain("сумерки");
  });
});

describe("нормализация полей отчёта по манифесту", () => {
  it("поля выбранного вида приводятся к типам", () => {
    const out = normalizeReportBranch(
      { variantKey: "report.default", values: { showScales: "true", copies: "2", title: "Отчёт" } },
      MANIFEST,
      "standard",
    );
    expect(out.errors).toEqual([]);
    expect(out.branch).toEqual({
      variantKey: "report.default",
      values: { showScales: true, copies: 2, title: "Отчёт" },
    });
  });

  it("вид отчёта, которого приёмник не объявляет, — ошибка, а не молчаливая подмена", () => {
    const out = normalizeReportBranch(
      { variantKey: "report.чужой", values: { showScales: "true" } },
      MANIFEST,
      "standard",
    );
    expect(out.branch).toBeUndefined();
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain("report.чужой");
    expect(out.errors[0]).toContain("report.default");
  });

  it("вид другого режима не годится: виды отчёта разные, а не варианты одного", () => {
    const out = normalizeReportBranch({ variantKey: "report.compact" }, MANIFEST, "adaptive");
    expect(out.branch).toBeUndefined();
    expect(out.errors[0]).toContain("report.compact");
  });

  it("ветвь без вида остаётся без вида, но её поля типизируются по виду по умолчанию", () => {
    const out = normalizeReportBranch({ values: { showScales: "false" } }, MANIFEST, "standard");
    expect(out.errors).toEqual([]);
    expect(out.branch).toEqual({ variantKey: undefined, values: { showScales: false } });
  });

  it("поле, которого вид не объявляет, не пишется, а называется", () => {
    const out = normalizeReportBranch(
      { variantKey: "report.compact", values: { showScales: "true", title: "Лишнее" } },
      MANIFEST,
      "standard",
    );
    expect(out.branch?.values).toEqual({ showScales: true });
    expect(out.dropped).toEqual(["title"]);
  });

  it("пустой текст поля отчёта сохраняется: автор мог стереть заголовок намеренно", () => {
    const out = normalizeReportBranch(
      { variantKey: "report.default", values: { title: "", copies: "" } },
      MANIFEST,
      "standard",
    );
    // Пустое число — не значение: у него нет прочтения, кроме «не задано».
    expect(out.branch?.values).toEqual({ title: "" });
  });

  it("непреобразуемое поле отчёта — ошибка, остальные поля применяются", () => {
    const out = normalizeReportBranch(
      { variantKey: "report.default", values: { copies: "две", showScales: "Да" } },
      MANIFEST,
      "standard",
    );
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain("copies");
    expect(out.branch?.values).toEqual({ showScales: true });
  });

  it("адаптивная ветвь типизируется своим видом", () => {
    const out = normalizeReportBranch(
      { variantKey: "report.adaptive.default", values: { showLevels: "нет" } },
      MANIFEST,
      "adaptive",
    );
    expect(out.errors).toEqual([]);
    expect(out.branch).toEqual({ variantKey: "report.adaptive.default", values: { showLevels: false } });
  });

  it("отсутствующая ветвь ничего не даёт и ни на что не жалуется", () => {
    const out = normalizeReportBranch(undefined, MANIFEST, "standard");
    expect(out).toEqual({ dropped: [], errors: [] });
  });

  it("шаблон без видов отчёта: ветвь без ключа переносится, поля отбрасываются", () => {
    const out = normalizeReportBranch({ values: { showScales: "true" } }, FLAT_MANIFEST, "standard");
    expect(out.branch).toEqual({ variantKey: undefined, values: {} });
    expect(out.dropped).toEqual(["showScales"]);
  });
});
