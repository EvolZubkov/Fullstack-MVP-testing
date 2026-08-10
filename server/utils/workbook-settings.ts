/**
 * @module server/utils/workbook-settings
 * @description Лист «Настройки» книги теста (PRD-48 §4.1): ОДИН декларативный реестр
 * параметров, который читают и выгрузка, и загрузка.
 *
 * Реестр, а не две функции: до PRD-48 экспорт и импорт держали по своему списку, и списки
 * разошлись — лист нёс один параметр, пока у теста их было тридцать. Здесь у параметра одно
 * имя ячейки, одно чтение и одна запись, и разойтись им негде.
 *
 * Правила ячейки (§4.4 спеки): пустое «Значение» — «оставить как есть», поэтому книга,
 * снятая до появления параметра, ничего не сбрасывает; `0` в ограничении — «без
 * ограничения», дословно как подсказка редактора; логическое — «Да»/«Нет».
 *
 * Несколько параметров пишут в одну JSON-колонку, поэтому лист применяется не к строке
 * `tests`, а к ЧЕРНОВИКУ {@link SettingsDraft}: импорт накладывает его ветви на текущее
 * состояние теста и только потом зовёт службу настроек.
 */
import type { Test } from "@shared/schema";
import { ELIGIBILITY_PLUGINS } from "@shared/eligibility/registry";

/** Заголовки листа. Лист — список «параметр — значение», а не таблица колонок. */
export const SETTINGS_HEADERS = ["Параметр", "Значение"];
export const SETTINGS_WIDTHS = [46, 44];

/** Источник для выгрузки: строка теста плюс путь его папки (её резолвит маршрут). */
export type SettingsSource = Partial<Test> & { folderPath?: string | null };

/** Ветви черновика, в которые пишут параметры. */
export interface SettingsDraft {
  /** Прямые колонки `tests`. */
  test: Record<string, unknown>;
  /** `flow_policy_json.mode`; `undefined` — книга сценарий не называла. */
  flowMode?: "linear_flat" | "linear_by_topics" | "router_by_topics";
  /** Накладывается на текущий `flow_policy_json.router`. */
  router: Record<string, unknown>;
  /** Накладывается на текущий `overall_pass_rule_json`. */
  overall: Record<string, unknown>;
  /** Накладывается на текущий `retake_policy_json`. */
  retake: Record<string, unknown>;
  /** Накладывается на `retake_policy_json.attemptInterval`. */
  attemptInterval: Record<string, unknown>;
  /** Накладывается на `retake_policy_json.eligibilityPlugin`. */
  plugin: Record<string, unknown>;
  /** Накладывается на `intro_json.results` / `.report` / корень. */
  introResults: Record<string, unknown>;
  introReport: Record<string, unknown>;
  introRoot: Record<string, unknown>;
  /** Путь папки; в `folderId` его превращает импорт — ему доступно хранилище. */
  folderPath?: string;
}

/** Пустой черновик. Отдельная функция: тесты сравнивают с ним «книга ничего не изменила». */
export function emptySettingsDraft(): SettingsDraft {
  return {
    test: {},
    router: {},
    overall: {},
    retake: {},
    attemptInterval: {},
    plugin: {},
    introResults: {},
    introReport: {},
    introRoot: {},
  };
}

/** Ветви черновика, доступные простым параметрам (всё, кроме скалярных полей). */
type Bucket = "test" | "router" | "overall" | "retake" | "attemptInterval" | "plugin"
  | "introResults" | "introReport" | "introRoot";

export interface SettingParam {
  /** Текст ячейки «Параметр» — дословная метка редактора. */
  name: string;
  /** Значение для выгрузки; пустая строка, когда у теста ничего нет. */
  read(src: SettingsSource): string;
  /** Применить НЕПУСТУЮ ячейку к черновику; вернуть текст ошибки или ничего. */
  write(raw: string, draft: SettingsDraft): string | undefined;
}

const YES = "Да";
const NO = "Нет";

function boolParam(
  name: string,
  get: (s: SettingsSource) => unknown,
  bucket: Bucket,
  key: string,
): SettingParam {
  return {
    name,
    read: (s) => {
      const v = get(s);
      return v === true ? YES : v === false ? NO : "";
    },
    write: (raw, draft) => {
      const v = raw.toLowerCase();
      if (v === "да") { draft[bucket][key] = true; return; }
      if (v === "нет") { draft[bucket][key] = false; return; }
      return `значение должно быть «${YES}» или «${NO}», получено "${raw}"`;
    },
  };
}

function intParam(
  name: string,
  get: (s: SettingsSource) => unknown,
  bucket: Bucket,
  key: string,
  opts: { min?: number; max?: number; zeroIsNull?: boolean } = {},
): SettingParam {
  const { min = 0, max = Number.MAX_SAFE_INTEGER, zeroIsNull = false } = opts;
  return {
    name,
    read: (s) => {
      const v = get(s);
      if (v == null) return zeroIsNull ? "0" : "";
      return String(v);
    },
    write: (raw, draft) => {
      if (!/^-?\d+$/.test(raw)) return `нужно целое число, получено "${raw}"`;
      const n = Number(raw);
      if (zeroIsNull && n === 0) { draft[bucket][key] = null; return; }
      if (n < min || n > max) return `число вне диапазона ${min}..${max}: ${n}`;
      draft[bucket][key] = n;
    },
  };
}

function textParam(
  name: string,
  get: (s: SettingsSource) => unknown,
  bucket: Bucket,
  key: string,
): SettingParam {
  return {
    name,
    read: (s) => String(get(s) ?? ""),
    // Пустая ячейка сюда не доходит (её отсеивает parseSettingsSheet), поэтому текстовый
    // параметр книгой не стирается — осознанное следствие правила «пусто = как есть».
    write: (raw, draft) => { draft[bucket][key] = raw; return; },
  };
}

function enumParam(
  name: string,
  labels: Record<string, string>,
  get: (s: SettingsSource) => unknown,
  bucket: Bucket,
  key: string,
): SettingParam {
  const byLabel = new Map(
    Object.entries(labels).map(([value, label]) => [label.toLowerCase(), value]),
  );
  return {
    name,
    read: (s) => {
      const v = get(s);
      return typeof v === "string" && labels[v] ? labels[v] : "";
    },
    write: (raw, draft) => {
      const value = byLabel.get(raw.toLowerCase());
      if (!value) {
        return `недопустимое значение "${raw}"; ожидается одно из: ${Object.values(labels).join(", ")}`;
      }
      draft[bucket][key] = value;
      return;
    },
  };
}

/** Ветвь JSON-колонки источника, безопасно к `null` и к чужой форме. */
function branch(value: unknown, ...path: string[]): Record<string, unknown> {
  let cur: unknown = value;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return {};
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "object" && cur !== null ? (cur as Record<string, unknown>) : {};
}

// ─── Словари значений (метки дословно из редактора и PRD-8) ──────────────────

const MODE_LABELS = { standard: "Стандартный", adaptive: "Адаптивный" };

const FLOW_LABELS = {
  linear_flat: "Линейный",
  linear_by_topics: "Линейный по темам",
  router_by_topics: "Через страницу-маршрутизатор",
};

const ORDER_LABELS = {
  fixed: "Фиксированный порядок",
  random: "Перемешивание",
  shuffle_all: "Полное перемешивание",
};

const OVERALL_TYPE_LABELS = {
  percent: "Процент правильных ответов",
  absolute: "Сумма баллов",
  none: "Не задано",
};

/** PRD-8 §3.2: смысл политик приведён к длине ячейки, термины оттуда же. */
const COMPLETION_LABELS = {
  all_required_completed: "После завершения всех обязательных разделов",
  all_required_passed: "Только если все обязательные разделы пройдены",
};

const FORMAT_LABELS = { plain: "Простой", richText: "Форматированный", html: "HTML" };

const FAIL_POLICY_LABELS = { failOpen: "Разрешить старт", failClosed: "Заблокировать" };

/** Плагины допуска — по человеческому имени из общего реестра, не по ключу. */
const PLUGIN_LABELS: Record<string, string> = Object.fromEntries(
  ELIGIBILITY_PLUGINS.map((p) => [p.key, p.name]),
);

// ─── Реестр ──────────────────────────────────────────────────────────────────

/**
 * Порядок строк = порядок групп вкладки «Настройки» редактора. Автор, открывший книгу,
 * читает её сверху вниз в том же порядке, в каком настраивал тест.
 */
export const SETTING_PARAMS: SettingParam[] = [
  // ── Основное ──
  textParam("Название", (s) => s.title, "test", "title"),
  textParam("Описание", (s) => s.description, "test", "description"),
  {
    name: "Папка",
    read: (s) => String(s.folderPath ?? ""),
    write: (raw, draft) => { draft.folderPath = raw; return; },
  },
  enumParam("Режим теста", MODE_LABELS, (s) => s.mode, "test", "mode"),
  {
    name: "Сценарий прохождения",
    read: (s) => {
      const mode = branch(s.flowPolicyJson).mode;
      const key = typeof mode === "string" && FLOW_LABELS[mode as keyof typeof FLOW_LABELS]
        ? (mode as keyof typeof FLOW_LABELS)
        : "linear_flat";
      return FLOW_LABELS[key];
    },
    write: (raw, draft) => {
      const entry = Object.entries(FLOW_LABELS).find(([, l]) => l.toLowerCase() === raw.toLowerCase());
      if (!entry) {
        return `недопустимое значение "${raw}"; ожидается одно из: ${Object.values(FLOW_LABELS).join(", ")}`;
      }
      draft.flowMode = entry[0] as SettingsDraft["flowMode"];
      return;
    },
  },
  enumParam("Порядок выдачи вопросов", ORDER_LABELS, (s) => s.questionOrder, "test", "questionOrder"),
  boolParam("Показывать правильные ответы после прохождения", (s) => s.showCorrectAnswers, "test", "showCorrectAnswers"),
  boolParam("Показывать уровень сложности при прохождении", (s) => s.showDifficultyLevel, "test", "showDifficultyLevel"),

  // ── Правила прохождения ──
  enumParam("Тип общего правила", OVERALL_TYPE_LABELS, (s) => branch(s.overallPassRuleJson).type, "overall", "type"),
  intParam("Порог", (s) => branch(s.overallPassRuleJson).value, "overall", "value"),
  enumParam(
    "Политика завершения маршрутизатора",
    COMPLETION_LABELS,
    (s) => branch(s.flowPolicyJson, "router").completionPolicy,
    "router",
    "completionPolicy",
  ),

  // ── Ограничения ──
  intParam("Максимум попыток", (s) => s.maxAttempts, "test", "maxAttempts", { zeroIsNull: true }),
  intParam("Лимит времени теста", (s) => s.timeLimitMinutes, "test", "timeLimitMinutes", { zeroIsNull: true }),
  intParam("Цена вопроса по умолчанию", (s) => s.defaultQuestionPoints, "test", "defaultQuestionPoints"),
  boolParam("Разрешить возврат к неотвеченным вопросам", (s) => s.allowReturnToUnanswered, "test", "allowReturnToUnanswered"),
  boolParam("Позволить изменять ответ до завершения", (s) => s.allowAnswerChange, "test", "allowAnswerChange"),
  boolParam("Не показывать обзор, если отвечены все вопросы", (s) => s.skipReviewWhenComplete, "test", "skipReviewWhenComplete"),
  boolParam("Переходить к следующему вопросу сразу после ответа", (s) => s.quickAdvance, "test", "quickAdvance"),
  boolParam("Показывать итоги раздела", (s) => s.showSectionResults, "test", "showSectionResults"),
  boolParam("Защищать текст задания от копирования", (s) => s.copyProtection, "test", "copyProtection"),
  boolParam("Показывать водяной знак", (s) => s.protectionWatermark, "test", "protectionWatermark"),
  boolParam("Скрывать задание при уходе из окна", (s) => s.protectionHideOnBlur, "test", "protectionHideOnBlur"),

  // ── Повторное прохождение ──
  boolParam("Ограничить повторное прохождение", (s) => branch(s.retakePolicyJson).enabled, "retake", "enabled"),
  intParam("Период охлаждения, календарных дней", (s) => branch(s.retakePolicyJson).cooldownPeriodDays, "retake", "cooldownPeriodDays", { min: 1, max: 3650 }),
  boolParam("Разделять период по результату попытки", (s) => branch(s.retakePolicyJson).cooldownByOutcome, "retake", "cooldownByOutcome"),
  intParam("При успешном прохождении, дней", (s) => branch(s.retakePolicyJson).cooldownPeriodDaysPassed, "retake", "cooldownPeriodDaysPassed", { min: 1, max: 3650 }),
  intParam("При неуспешном прохождении, дней", (s) => branch(s.retakePolicyJson).cooldownPeriodDaysFailed, "retake", "cooldownPeriodDaysFailed", { min: 1, max: 3650 }),
  enumParam("Способ проверки (плагин)", PLUGIN_LABELS, (s) => branch(s.retakePolicyJson, "eligibilityPlugin").key, "plugin", "key"),
  enumParam("При ошибке проверки допуска", FAIL_POLICY_LABELS, (s) => branch(s.retakePolicyJson, "eligibilityPlugin").failPolicy, "plugin", "failPolicy"),
  boolParam("Ограничение между попытками", (s) => branch(s.retakePolicyJson, "attemptInterval").enabled, "attemptInterval", "enabled"),
  intParam("Интервал, часов", (s) => branch(s.retakePolicyJson, "attemptInterval").hours, "attemptInterval", "hours", { min: 1, max: 8760 }),

  // ── Интеграция ──
  textParam("Webhook URL", (s) => s.webhookUrl, "test", "webhookUrl"),
  boolParam("Отправлять телеметрию о прохождении", (s) => s.telemetryEnabled, "test", "telemetryEnabled"),

  // ── Вводные блоки экрана итогов и отчёта ──
  textParam("Вводный текст на экране итогов", (s) => branch(s.introJson, "results").text, "introResults", "text"),
  enumParam("Формат вводного текста на экране итогов", FORMAT_LABELS, (s) => branch(s.introJson, "results").format, "introResults", "format"),
  textParam("Вводный текст в отчёте", (s) => branch(s.introJson, "report").text, "introReport", "text"),
  enumParam("Формат вводного текста в отчёте", FORMAT_LABELS, (s) => branch(s.introJson, "report").format, "introReport", "format"),
  boolParam("В отчёте — тот же текст, что на экране итогов", (s) => branch(s.introJson).reportSameAsResults, "introRoot", "reportSameAsResults"),
];

/** Параметр по имени ячейки: сравнение без регистра и без «залипших» пробелов Excel. */
const PARAM_BY_NAME = new Map(SETTING_PARAMS.map((p) => [normalizeName(p.name), p]));

function normalizeName(raw: string): string {
  return raw.replace(/[\s ​﻿]+/g, " ").trim().toLowerCase();
}

/** Выгрузка: по строке на каждый параметр реестра, всегда все. */
export function serializeSettingsRows(src: SettingsSource): Record<string, unknown>[] {
  return SETTING_PARAMS.map((p) => ({ "Параметр": p.name, "Значение": p.read(src) }));
}

/**
 * Загрузка листа. Возвращает черновик и построчные ошибки: строка с ошибкой отбрасывается,
 * остальные применяются — как у всех прочих листов книги.
 */
export function parseSettingsSheet(rows: Record<string, unknown>[]): {
  draft: SettingsDraft;
  errors: string[];
} {
  const draft = emptySettingsDraft();
  const errors: string[] = [];

  rows.forEach((row, i) => {
    const where = `Лист «Настройки», строка ${i + 2}`;
    const name = String(row["Параметр"] ?? "").replace(/[\s ​﻿]+/g, " ").trim();
    if (!name) {
      errors.push(`${where}: не указан «Параметр»`);
      return;
    }
    const param = PARAM_BY_NAME.get(normalizeName(name));
    if (!param) {
      errors.push(`${where}: неизвестный параметр: "${name}"`);
      return;
    }
    const raw = String(row["Значение"] ?? "").trim();
    if (raw === "") return; // «оставить как есть»
    const error = param.write(raw, draft);
    if (error) errors.push(`${where}: «${name}» — ${error}`);
  });

  return { draft, errors };
}

/** Имена всех параметров — шаблон книги подставляет их в колонку «Параметр». */
export const SETTING_PARAM_NAMES: string[] = SETTING_PARAMS.map((p) => p.name);
