/**
 * @module tests/workbook-settings
 *
 * PRD-48 stage 1: the parameter registry of the «Настройки» sheet. What is checked is not the
 * list of names (it is long and will grow) but the PROPERTIES of the registry: every parameter
 * is read and written under one and the same name, an empty cell changes nothing, and «Да»/«Нет»
 * and «0» are parsed by the rules of spec §4.4.
 */
import { describe, it, expect } from "vitest";
import {
  SETTING_PARAMS,
  emptySettingsDraft,
  parseSettingsSheet,
  serializeSettingsRows,
} from "../server/utils/workbook-settings";

/** A sheet row addressed by parameter name. */
function row(name: string, value: unknown) {
  return { "Параметр": name, "Значение": value };
}

describe("реестр листа «Настройки»", () => {
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
    const cell = on.find((r) => r["Параметр"] === "Защищать текст задания от копирования");
    expect(cell?.["Значение"]).toBe("Да");

    const { draft, errors } = parseSettingsSheet([
      row("Защищать текст задания от копирования", "нет"),
    ]);
    expect(errors).toEqual([]);
    expect(draft.test.copyProtection).toBe(false);
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
    expect(rows.find((r) => r["Параметр"] === "Максимум попыток")?.["Значение"]).toBe("0");
  });

  it("пустая ячейка не меняет ничего", () => {
    const { draft, errors } = parseSettingsSheet([
      row("Максимум попыток", ""),
      row("Описание", "   "),
    ]);
    expect(errors).toEqual([]);
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

  it("сценарий прохождения ходит по кругу", () => {
    const rows = serializeSettingsRows({ flowPolicyJson: { mode: "router_by_topics" } });
    const cell = rows.find((r) => r["Параметр"] === "Сценарий прохождения");
    expect(cell?.["Значение"]).toBe("Через страницу-маршрутизатор");

    const { draft } = parseSettingsSheet([cell as Record<string, unknown>]);
    expect(draft.flowMode).toBe("router_by_topics");
  });

  it("сценарий по умолчанию — «Линейный»", () => {
    const rows = serializeSettingsRows({ flowPolicyJson: null });
    expect(rows.find((r) => r["Параметр"] === "Сценарий прохождения")?.["Значение"]).toBe("Линейный");
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

  it("каждый параметр переживает круг «экспорт — импорт»", () => {
    const source = {
      title: "Аттестация",
      description: "Годовая",
      mode: "adaptive" as const,
      questionOrder: "fixed" as const,
      showCorrectAnswers: true,
      showDifficultyLevel: false,
      overallPassRuleJson: { type: "percent", value: 70 },
      maxAttempts: 3,
      timeLimitMinutes: 45,
      defaultQuestionPoints: 2,
      allowReturnToUnanswered: true,
      allowAnswerChange: false,
      quickAdvance: true,
      showSectionResults: false,
      skipReviewWhenComplete: true,
      copyProtection: false,
      protectionWatermark: true,
      protectionHideOnBlur: false,
      telemetryEnabled: true,
      webhookUrl: "https://example.test/hook",
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
        results: { format: "html" as const, text: "<p>Итоги</p>" },
        report: { format: "plain" as const, text: "Отчёт" },
        reportSameAsResults: false,
      },
      folderPath: "Аттестация / 2026",
    };

    const { draft, errors } = parseSettingsSheet(serializeSettingsRows(source));
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
      showSectionResults: false,
      skipReviewWhenComplete: true,
      copyProtection: false,
      protectionWatermark: true,
      protectionHideOnBlur: false,
      telemetryEnabled: true,
      webhookUrl: "https://example.test/hook",
    });
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
    expect(draft.folderPath).toBe("Аттестация / 2026");
  });
});
