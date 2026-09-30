/**
 * @module tests/workbook-settings
 *
 * PRD-48 stage 1: the parameter registry of the «Настройки» sheet. What is checked is not the
 * list of names (it is long and will grow) but the PROPERTIES of the registry: every parameter
 * is read and written under one and the same name, an empty cell changes nothing, and «Да»/«Нет»
 * and «0» are parsed by the rules of spec §4.4.
 *
 * Two properties carry most of the weight. The workbook is never stricter than the editor
 * (spec §9): out-of-range numbers clamp and unknown vocabulary values survive, so the export
 * can never produce a cell its own import refuses. And the round-trip fixture is tied to the
 * registry by a guard, so a parameter added without a fixture value fails the suite instead of
 * quietly going untested.
 */
import { describe, it, expect } from "vitest";
import {
  SETTING_PARAMS,
  SETTING_PARAM_NAMES,
  emptySettingsDraft,
  normalizeCell,
  parseSettingsSheet,
  serializeSettingsRows,
  type SettingsSource,
} from "../server/utils/workbook-settings";

/** A sheet row addressed by parameter name. */
function row(name: string, value: unknown) {
  return { "Параметр": name, "Значение": value };
}

/** The cell of one parameter in an exported sheet. */
function cellOf(rows: Record<string, unknown>[], name: string) {
  return rows.find((r) => r["Параметр"] === name)?.["Значение"];
}

/**
 * The fixture of the round-trip test: a test with EVERY parameter set to a value that differs
 * from what an empty source exports. The guard below keeps it honest as the registry grows.
 */
const ROUND_TRIP_SOURCE = {
  title: "Аттестация",
  description: "Годовая",
  descriptionFormat: "richText" as const,
  mode: "adaptive" as const,
  questionOrder: "fixed" as const,
  showCorrectAnswers: true,
  showDifficultyLevel: false,
  overallPassRuleJson: { type: "percent", value: 70 },
  maxAttempts: 3,
  timeLimitMinutes: 45,
  defaultQuestionPoints: 2,
  allowReturnToUnanswered: true,
  allowFreeSectionNavigation: true,
  allowAnswerChange: false,
  quickAdvance: true,
  showSectionResults: false,
  skipReviewWhenComplete: true,
  closeSectionOnLeave: true,
  copyProtection: false,
  protectionWatermark: true,
  protectionHideOnBlur: false,
  telemetryEnabled: true,
  flowPolicyJson: { mode: "linear_by_topics", router: { completionPolicy: "all_required_passed" } },
  retakePolicyJson: {
    enabled: true,
    cooldownPeriodDays: 30,
    cooldownByOutcome: true,
    cooldownPeriodDaysPassed: 60,
    cooldownPeriodDaysFailed: 10,
    eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failClosed" },
    attemptInterval: { enabled: true, hours: 24 },
  },
  introJson: {
    results: {
      format: "html" as const,
      text: "<p>Итоги</p>",
      // PRD-61: тексты по исходу. Все четыре заведены здесь, потому что гвард реестра ниже
      // требует, чтобы фикстура ЗАДЕЛА каждый параметр листа — иначе новая строка прошла бы
      // круг непроверенной.
      passed: { format: "plain" as const, text: "Итоги: прошёл" },
      failed: { format: "richText" as const, text: "<b>Итоги: не прошёл</b>" },
    },
    report: {
      format: "plain" as const,
      text: "Отчёт",
      passed: { format: "html" as const, text: "<p>Отчёт: прошёл</p>" },
      failed: { format: "plain" as const, text: "Отчёт: не прошёл" },
    },
    reportSameAsResults: false,
  },
  // Четыре настройки, которых у листа не было до 2026-09-04: смысл вердикта, результат для
  // LMS, показ подытогов и блоки итогов.
  passDecisionPolicy: "required_topics_only" as const,
  lmsAttemptResult: "best" as const,
  // PRD-50 §16 (FR-53): учитывать ли подтемы в вердикте темы.
  breakdownGateEnabled: true,
  breakdownDisplayJson: {
    visibility: "bar_and_value" as const,
    basis: "points" as const,
    placement: "both" as const,
    showInterpretation: true,
  },
  sectionGroupsJson: [
    { key: "block-1", label: "Теория", order: 0 },
    { key: "block-2", label: "Практика", order: 1 },
  ],
  folderPath: "Аттестация / 2026",
};

describe("реестр листа «Настройки»", () => {
  it("возит формат описания рядом с самим описанием (PRD-59 FR-04)", () => {
    const param = SETTING_PARAMS.find((p) => p.name === "Формат описания");
    expect(param).toBeDefined();
    expect(param!.read({ descriptionFormat: "richText" } as SettingsSource)).toBe("Форматированный");
    const draft = emptySettingsDraft();
    param!.write("HTML", draft);
    expect(draft.test.descriptionFormat).toBe("html");
  });

  it("не содержит двух параметров с одним именем", () => {
    const names = SETTING_PARAMS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("экспортирует по строке на каждый параметр", () => {
    const rows = serializeSettingsRows({});
    expect(rows).toHaveLength(SETTING_PARAMS.length);
    expect(rows[0]).toHaveProperty("Параметр");
    expect(rows[0]).toHaveProperty("Значение");
  });

  it("логический параметр читается и пишется как «Да»/«Нет»", () => {
    const on = serializeSettingsRows({ copyProtection: true });
    expect(cellOf(on, "Защищать текст задания от копирования")).toBe("Да");

    const { draft, errors } = parseSettingsSheet([
      row("Защищать текст задания от копирования", "нет"),
    ]);
    expect(errors).toEqual([]);
    expect(draft.test.copyProtection).toBe(false);
  });

  // PRD-50 §16 (FR-53): гейт подтем — свойство ТЕСТА, и перенос теста книгой обязан его
  // забирать: без строки книга молча возвращала бы вердикт к «подтемы не в счёт».
  it("несёт строку гейта подтем", () => {
    const on = serializeSettingsRows({ breakdownGateEnabled: true });
    expect(cellOf(on, "Учитывать подтемы в вердикте темы")).toBe("Да");
    const off = serializeSettingsRows({ breakdownGateEnabled: false });
    expect(cellOf(off, "Учитывать подтемы в вердикте темы")).toBe("Нет");

    const { draft, errors } = parseSettingsSheet([
      row("Учитывать подтемы в вердикте темы", "да"),
    ]);
    expect(errors).toEqual([]);
    expect(draft.test.breakdownGateEnabled).toBe(true);
  });

  it("отвергает логическое значение, которое не «Да» и не «Нет»", () => {
    const { errors } = parseSettingsSheet([row("Показывать итоги раздела", "ага")]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Показывать итоги раздела");
  });

  it("ноль в ограничении означает «без ограничения»", () => {
    const { draft } = parseSettingsSheet([row("Максимум попыток", 0)]);
    expect(draft.test.maxAttempts).toBeNull();

    const rows = serializeSettingsRows({ maxAttempts: null });
    expect(cellOf(rows, "Максимум попыток")).toBe("0");
  });

  it("ноль без ограничения действует и для лимита времени", () => {
    const { draft, errors } = parseSettingsSheet([row("Лимит времени теста", 0)]);
    expect(errors).toEqual([]);
    expect(draft.test.timeLimitMinutes).toBeNull();

    expect(cellOf(serializeSettingsRows({ timeLimitMinutes: null }), "Лимит времени теста")).toBe("0");
  });

  it("пустая ячейка не меняет ничего", () => {
    const { draft, errors } = parseSettingsSheet([
      row("Максимум попыток", ""),
      row("Описание", "   "),
    ]);
    expect(errors).toEqual([]);
    expect(draft).toEqual(emptySettingsDraft());
  });

  it("строка без имени параметра — ошибка своей строки", () => {
    const { draft, errors } = parseSettingsSheet([row("", "Да"), row("   ", 5)]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("не указан");
    expect(draft).toEqual(emptySettingsDraft());
  });

  it("неизвестный параметр даёт ошибку своей строки, остальные применяются", () => {
    const { draft, errors } = parseSettingsSheet([
      row("Цвет фона", "синий"),
      row("Максимум попыток", 3),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Цвет фона");
    expect(draft.test.maxAttempts).toBe(3);
  });

  it("ошибка перечисления называет допустимые значения", () => {
    const { draft, errors } = parseSettingsSheet([row("Режим теста", "полуадаптивный")]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Режим теста");
    expect(errors[0]).toContain("Стандартный");
    expect(errors[0]).toContain("Адаптивный");
    expect(draft.test.mode).toBeUndefined();
  });

  it("тип сценария ходит по кругу", () => {
    const rows = serializeSettingsRows({ flowPolicyJson: { mode: "router_by_topics" } });
    const cell = rows.find((r) => r["Параметр"] === "Тип сценария");
    expect(cell?.["Значение"]).toBe("Через страницу-маршрутизатор");

    const { draft } = parseSettingsSheet([cell as Record<string, unknown>]);
    expect(draft.flowMode).toBe("router_by_topics");
  });

  it("сценарий по умолчанию — «Линейный»", () => {
    const rows = serializeSettingsRows({ flowPolicyJson: null });
    expect(cellOf(rows, "Тип сценария")).toBe("Линейный");
  });

  it("повторное прохождение собирается в свой черновик, а не в колонки теста", () => {
    const { draft } = parseSettingsSheet([
      row("Ограничить повторное прохождение", "да"),
      row("Период охлаждения, календарных дней", 30),
      row("Интервал, часов", 24),
    ]);
    expect(draft.retake).toEqual({ enabled: true, cooldownPeriodDays: 30 });
    expect(draft.attemptInterval).toEqual({ hours: 24 });
    expect(draft.test).toEqual({});
  });

  it("вводные блоки пишутся в свои ветви", () => {
    const { draft } = parseSettingsSheet([
      row("Вводный текст на экране итогов", "Здравствуйте"),
      row("Формат вводного текста на экране итогов", "Форматированный"),
      row("В отчёте — тот же текст, что на экране итогов", "да"),
    ]);
    expect(draft.introResults).toEqual({ text: "Здравствуйте", format: "richText" });
    expect(draft.introRoot).toEqual({ reportSameAsResults: true });
  });

  it("папка не идёт в колонки теста: её резолвит импорт", () => {
    const { draft } = parseSettingsSheet([row("Папка", "Аттестация / 2026")]);
    expect(draft.folderPath).toBe("Аттестация / 2026");
    expect(draft.test).toEqual({});
  });

  // ── Книга не строже редактора (раздел 9 спеки) ──────────────────────────────

  it("значение вне диапазона зажимается к границе, а не отвергается", () => {
    const { draft, errors } = parseSettingsSheet([
      row("Интервал, часов", 0),
      row("Период охлаждения, календарных дней", 9999),
    ]);
    expect(errors).toEqual([]);
    expect(draft.attemptInterval.hours).toBe(1);
    expect(draft.retake.cooldownPeriodDays).toBe(3650);
  });

  it("нецелое значение остаётся ошибкой строки", () => {
    const { errors } = parseSettingsSheet([row("Интервал, часов", "два")]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("целое число");
  });

  it("ячейка, выгруженная книгой, всегда принимается обратно", () => {
    // Значение вне схемы (0 часов) редактор зажал бы молча; книга обязана вести себя так же,
    // иначе экспорт печатает ячейку, которую отвергает собственный импорт.
    const rows = serializeSettingsRows({
      retakePolicyJson: { attemptInterval: { hours: 0 } },
    } as unknown as SettingsSource);
    expect(cellOf(rows, "Интервал, часов")).toBe("0");

    const { errors } = parseSettingsSheet(rows);
    expect(errors).toEqual([]);
  });

  it("незнакомое значение перечисления переживает круг, а не исчезает", () => {
    const rows = serializeSettingsRows({
      retakePolicyJson: { eligibilityPlugin: { key: "custom_x" } },
    } as unknown as SettingsSource);
    expect(cellOf(rows, "Способ проверки (плагин)")).toBe("custom_x");

    const { draft, errors } = parseSettingsSheet(rows);
    expect(errors).toEqual([]);
    expect(draft.plugin.key).toBe("custom_x");
  });

  it("снятый параметр «Webhook URL» из старой книги пропускается без ошибки", () => {
    // Книги, выгруженные до 2026-09-30, несут эту строку. Ошибка на каждой из них была бы
    // шумом, а значение больше некуда писать: адрес телеметрии — настройка установки.
    const { draft, errors } = parseSettingsSheet([
      row("Webhook URL", "https://example.test/hook"),
      row("Отправлять телеметрию о прохождении", "Да"),
    ]);
    expect(errors).toEqual([]);
    expect(draft.test).not.toHaveProperty("webhookUrl");
    expect(draft.test.telemetryEnabled).toBe(true);
  });

  it("выгрузка не несёт строки «Webhook URL»", () => {
    expect(SETTING_PARAM_NAMES).not.toContain("Webhook URL");
  });

  it("перечисление принимает и хранимое значение, а не только метку", () => {
    const { draft, errors } = parseSettingsSheet([row("Тип общего правила", "percent")]);
    expect(errors).toEqual([]);
    expect(draft.overall.type).toBe("percent");
  });

  it("мусор из Word не ломает разбор значения", () => {
    const { draft, errors } = parseSettingsSheet([
      row("​Защищать текст задания от копирования", "​Да "),
      row("Порядок выдачи вопросов", "Полное  перемешивание"),
    ]);
    expect(errors).toEqual([]);
    expect(draft.test.copyProtection).toBe(true);
    expect(draft.test.questionOrder).toBe("shuffle_all");
  });

  it("испорченная форма JSON-колонки не роняет выгрузку", () => {
    const rows = serializeSettingsRows({
      retakePolicyJson: "сломано",
      introJson: 42,
      overallPassRuleJson: null,
    } as unknown as SettingsSource);
    expect(rows).toHaveLength(SETTING_PARAMS.length);
    expect(cellOf(rows, "Период охлаждения, календарных дней")).toBe("");
    expect(cellOf(rows, "Вводный текст в отчёте")).toBe("");
    expect(cellOf(rows, "Тип общего правила")).toBe("");
  });

  // ── Круг «экспорт — импорт» ─────────────────────────────────────────────────

  it("фикстура кругового теста задевает каждый параметр реестра", () => {
    // Сторож против фикстуры-декорации: круговой тест обещает «каждый параметр», и без этой
    // сверки тридцать девятый параметр с перепутанной парой bucket/key прошёл бы незамеченным —
    // ровно та ошибка, ради которой заведён реестр. Параметр считается задетым, когда фикстура
    // выгружает его ИНАЧЕ, чем пустой источник: значения по умолчанию («0», «Линейный») тем
    // самым не засчитываются за покрытие.
    const baseline = serializeSettingsRows({});
    const actual = serializeSettingsRows(ROUND_TRIP_SOURCE);
    const untouched = SETTING_PARAM_NAMES.filter(
      (_, i) => actual[i]["Значение"] === baseline[i]["Значение"],
    );
    expect(untouched).toEqual([]);
  });

  it("каждый параметр переживает круг «экспорт — импорт»", () => {
    const { draft, errors } = parseSettingsSheet(serializeSettingsRows(ROUND_TRIP_SOURCE));
    expect(errors).toEqual([]);

    expect(draft.test).toMatchObject({
      title: "Аттестация",
      description: "Годовая",
      mode: "adaptive",
      questionOrder: "fixed",
      showCorrectAnswers: true,
      showDifficultyLevel: false,
      maxAttempts: 3,
      timeLimitMinutes: 45,
      defaultQuestionPoints: 2,
      quickAdvance: true,
      // PRD-19 FR-11a: новый параметр листа ДОБАВЛЕН, а не переименован — уже выданные
      // книги обязаны читаться, и его отсутствие в них значит «настройка не меняется».
      allowFreeSectionNavigation: true,
      showSectionResults: false,
      skipReviewWhenComplete: true,
      // PRD-67: добавлен параметр листа; прежние книги без него настройку не трогают.
      closeSectionOnLeave: true,
      copyProtection: false,
      protectionWatermark: true,
      protectionHideOnBlur: false,
      telemetryEnabled: true,
      passDecisionPolicy: "required_topics_only",
      lmsAttemptResult: "best",
      breakdownGateEnabled: true,
    });
    expect(draft.breakdown).toEqual({
      showInterpretation: true,
      visibility: "bar_and_value",
      basis: "points",
      placement: "both",
    });
    // Ключи блоков в книгу не едут: у листа только названия, а ключ восстанавливает импорт.
    expect(draft.sectionGroupLabels).toEqual(["Теория", "Практика"]);
    expect(draft.flowMode).toBe("linear_by_topics");
    expect(draft.overall).toEqual({ type: "percent", value: 70 });
    expect(draft.router).toEqual({ completionPolicy: "all_required_passed" });
    expect(draft.retake).toEqual({
      enabled: true,
      cooldownPeriodDays: 30,
      cooldownByOutcome: true,
      cooldownPeriodDaysPassed: 60,
      cooldownPeriodDaysFailed: 10,
    });
    expect(draft.plugin).toEqual({ key: "webtutor_cooldown", failPolicy: "failClosed" });
    expect(draft.attemptInterval).toEqual({ enabled: true, hours: 24 });
    expect(draft.introResults).toEqual({ format: "html", text: "<p>Итоги</p>" });
    expect(draft.introReport).toEqual({ format: "plain", text: "Отчёт" });
    expect(draft.introRoot).toEqual({ reportSameAsResults: false });
    // PRD-61: тексты исхода едут своими корзинами — по одной на (выдачу, исход).
    expect(draft.introResultsPassed).toEqual({ format: "plain", text: "Итоги: прошёл" });
    expect(draft.introResultsFailed).toEqual({ format: "richText", text: "<b>Итоги: не прошёл</b>" });
    expect(draft.introReportPassed).toEqual({ format: "html", text: "<p>Отчёт: прошёл</p>" });
    expect(draft.introReportFailed).toEqual({ format: "plain", text: "Отчёт: не прошёл" });
    expect(draft.folderPath).toBe("Аттестация / 2026");
  });

  it("тексты исхода печатаются на листе отдельными строками (PRD-61)", () => {
    const rows = serializeSettingsRows(ROUND_TRIP_SOURCE);
    expect(cellOf(rows, "Вводный текст на экране итогов, если тест пройден")).toBe("Итоги: прошёл");
    expect(cellOf(rows, "Вводный текст на экране итогов, если тест не пройден"))
      .toBe("<b>Итоги: не прошёл</b>");
    expect(cellOf(rows, "Формат вводного текста на экране итогов, если тест не пройден"))
      .toBe("Форматированный");
    expect(cellOf(rows, "Вводный текст в отчёте, если тест пройден")).toBe("<p>Отчёт: прошёл</p>");
    expect(cellOf(rows, "Формат вводного текста в отчёте, если тест пройден")).toBe("HTML");
    expect(cellOf(rows, "Вводный текст в отчёте, если тест не пройден")).toBe("Отчёт: не прошёл");
  });

  it("тест без текстов исхода печатает их строки пустыми", () => {
    // Пустая ячейка = «не трогать»: книга старого теста не должна ничего ему дописывать.
    const rows = serializeSettingsRows({
      introJson: { results: { format: "plain" as const, text: "Только общее" } },
    } as never);
    expect(cellOf(rows, "Вводный текст на экране итогов")).toBe("Только общее");
    expect(cellOf(rows, "Вводный текст на экране итогов, если тест пройден")).toBe("");
    expect(cellOf(rows, "Вводный текст в отчёте, если тест не пройден")).toBe("");
  });

  // ── Переименования и старые книги (Э5.1, Э5.2) ──────────────────────────────

  it("книга, выгруженная до переименования, применяется по старым именам", () => {
    const { draft, errors } = parseSettingsSheet([
      row("Сценарий прохождения", "Через страницу-маршрутизатор"),
      row("Показывать правильные ответы после прохождения", "да"),
    ]);
    expect(errors).toEqual([]);
    expect(draft.flowMode).toBe("router_by_topics");
    expect(draft.test.showCorrectAnswers).toBe(true);
  });

  it("выгрузка печатает только новое имя, старое остаётся лишь на входе", () => {
    const names = serializeSettingsRows({}).map((r) => r["Параметр"]);
    expect(names).toContain("Тип сценария");
    expect(names).toContain("Показывать правильные ответы после ответа");
    expect(names).not.toContain("Сценарий прохождения");
    expect(names).not.toContain("Показывать правильные ответы после прохождения");
  });

  it("старое имя терпит мусор из Word так же, как новое", () => {
    const { draft, errors } = parseSettingsSheet([
      row("Сценарий  прохождения ", "Линейный по темам"),
    ]);
    expect(errors).toEqual([]);
    expect(draft.flowMode).toBe("linear_by_topics");
  });

  it("алиас не отбирает имя у другого параметра", () => {
    // Сторож на будущее: алиас — это имя, которое книга уже носит, и совпади оно с ИМЕНЕМ
    // соседнего параметра, старая книга писала бы в чужую колонку молча.
    const names = new Set(SETTING_PARAMS.map((p) => normalizeCell(p.name)));
    const seen = new Set<string>();
    for (const param of SETTING_PARAMS) {
      for (const alias of param.aliases ?? []) {
        const key = normalizeCell(alias);
        expect(names.has(key)).toBe(false);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("повторённый параметр применяется последним вхождением", () => {
    const { draft, errors } = parseSettingsSheet([
      row("Максимум попыток", 3),
      row("Максимум попыток", 5),
    ]);
    expect(errors).toEqual([]);
    expect(draft.test.maxAttempts).toBe(5);
  });
});
