# PRD-48 Э1: план реализации — все параметры теста в книге Excel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Цель:** книга Excel переносит ВСЕ параметры теста и все недостающие поля раздела, а импорт
перестаёт навязывать сценарий со страницей-маршрутизатором.

**Решение:** один декларативный РЕЕСТР параметров в новом модуле `server/utils/workbook-settings.ts`,
который читают и экспорт, и импорт. Двух списков параметров быть не должно: расхождение двух списков
и есть исходный дефект — лист нёс один параметр, пока у теста их было тридцать. Лист «Структура»
получает недостающие колонки раздела; сценарий пишется только тогда, когда книга его назвала.

**Стек:** TypeScript, ExcelJS, Drizzle, Vitest. Миграций БД нет: переносятся существующие поля.

**Требования:** [спека PRD-48](../specs/prd-48/test-workbook-full-transfer.md), этап Э1 — FR-01 - FR-11,
FR-19, FR-20, FR-22, FR-23, FR-25.

**Ветка:** от локального `main`.

---

## Правила, обязательные для каждой задачи

- **Комментарии в коде и JSDoc — ПО-АНГЛИЙСКИ** (правило проекта; соседний
  `workbook-sheets.ts` написан так же). Пользовательские строки — имена ячеек, метки
  значений, тексты ошибок — остаются русскими. Названия `describe`/`it` в тестах — русские,
  как в соседних файлах `tests/`.
- Тесты запускать только как `npm test -- <путь>`; полный прогон без аргументов запрещён,
  в копии работают другие сессии.
- Коммитить только перечисленные в задаче файлы: индекс общий.

## Что план НЕ делает

- Листы «Обратная связь», «Рекомендации», «Страницы», «Поля страниц», «Адаптивные уровни»,
  «Оформление» — это Э2 - Э5 спеки.
- Лист «Справка» и руководство по заполнению — Э6. Здесь правится только сам шаблон книги,
  чтобы он не противоречил выгрузке в тот же день.
- Импорт медиафайлов, публикация книгой, перенос прав и назначений — раздел 9 спеки, вне охвата.
- Новые перекрёстные проверки параметров: книга не должна быть строже редактора (раздел 9 спеки).

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `server/utils/workbook-settings.ts` (создать) | Реестр параметров листа «Настройки»: имя ячейки, чтение для экспорта, запись в черновик |
| `tests/workbook-settings.test.ts` (создать) | Реестр: круг «прочитал — записал» по каждому параметру, правила ячейки |
| `server/utils/workbook-sheets.ts` | Реэкспорт контракта листа «Настройки» + новые колонки «Структуры» |
| `server/services/workbook-import.ts` | Применение черновика: папка, политика повтора патчем, сценарий, построчные ошибки |
| `server/routes/tests-workbook.ts` | Экспорт: путь папки в источник листа «Настройки» |
| `server/services/workbook-template.ts` | Шаблон: лист «Настройки» перечисляет все параметры, выпадающий список снимается |
| `tests/workbook-question-order.test.ts` | Правится под новый контракт функций (сам формат книги не меняется) |
| `tests/routes.tests-workbook.test.ts` | Круговой тест «экспорт — импорт — совпало» |
| `docs/specs/prd-14/questions-import-export.md` | Снятие требования «поток фиксируется в router_by_topics» |
| `docs/specs/questions-import/format.md` | Контракт листов «Настройки» и «Оценка» в таблице §12.1 |

## Порядок и почему он такой

Срез A даёт реестр и переводит на него обе стороны — после него настройки уже ходят по кругу.
Срез B чинит сценарий: он опирается на реестр (сценарий — параметр листа), поэтому идёт вторым.
Срез C добирает поля раздела. Срез D приводит шаблон и документы в соответствие. Каждый срез
самодостаточен и заканчивается коммитом.

---

## Срез A. Реестр параметров

### Task 1. Модуль реестра

**Файлы:**

- Создать: `server/utils/workbook-settings.ts`
- Тест: `tests/workbook-settings.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Создать `tests/workbook-settings.test.ts`:

```ts
/**
 * @module tests/workbook-settings
 *
 * PRD-48 Э1: реестр параметров листа «Настройки». Проверяется не список имён (он длинный и
 * будет расти), а СВОЙСТВА реестра: каждый параметр читается и записывается одним и тем же
 * именем, пустая ячейка ничего не меняет, а «Да»/«Нет» и «0» разбираются по правилам раздела
 * 4.4 спеки.
 */
import { describe, it, expect } from "vitest";
import {
  SETTING_PARAMS,
  emptySettingsDraft,
  parseSettingsSheet,
  serializeSettingsRows,
} from "../server/utils/workbook-settings";

/** Строка листа по имени параметра. */
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
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/workbook-settings.test.ts`

Ожидается: FAIL, `Cannot find module '../server/utils/workbook-settings'`.

- [ ] **Шаг 3. Написать модуль**

Создать `server/utils/workbook-settings.ts`:

```ts
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
    // An empty cell never reaches here (parseSettingsSheet filters it out), so a text
    // parameter cannot be CLEARED by a workbook — the accepted consequence of the
    // "empty = leave as is" rule.
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

// ─── Value dictionaries (labels verbatim from the editor and PRD-8) ──────────

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

// ─── The registry ────────────────────────────────────────────────────────────

/**
 * Row order = the order of the editor's «Настройки» tab groups. An author who opens the
 * workbook reads it top to bottom in the same order they configured the test in.
 */
export const SETTING_PARAMS: SettingParam[] = [
  // ── «Основное» ──
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

  // ── «Правила прохождения» ──
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
  return raw.replace(/[\s ​﻿]+/g, " ").trim().toLowerCase();
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
    const name = String(row["Параметр"] ?? "").replace(/[\s ​﻿]+/g, " ").trim();
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
```

- [ ] **Шаг 4. Убедиться, что тест зелёный**

Выполнить: `npm test -- tests/workbook-settings.test.ts`

Ожидается: PASS, 13 тестов.

- [ ] **Шаг 5. Проверить типы**

Выполнить: `npm run check`

Ожидается: 0 ошибок.

- [ ] **Шаг 6. Коммит**

```bash
git add server/utils/workbook-settings.ts tests/workbook-settings.test.ts
git commit -m "feat(workbook): реестр параметров листа «Настройки»"
```

### Task 2. Перевести экспорт и импорт на реестр

**Файлы:**

- Изменить: `server/utils/workbook-sheets.ts` (удалить старый контракт листа, реэкспортировать новый)
- Изменить: `server/services/workbook-import.ts` (проход «Настройки»)
- Изменить: `server/routes/tests-workbook.ts` (источник выгрузки)
- Изменить: `tests/workbook-question-order.test.ts` (под новый контракт функций)

- [ ] **Шаг 1. Снять старый контракт листа с `workbook-sheets.ts`**

Удалить из `server/utils/workbook-sheets.ts` блок листа «Настройки» — константы `SETTINGS_HEADERS`,
`SETTINGS_WIDTHS`, интерфейс `ParsedTestSettings`, константу `SETTING_QUESTION_ORDER`, словари
`TEST_ORDER_FROM`/`TEST_ORDER_TO`, функции `parseSettingsRow`, `serializeSettingsRows` и константу
`TEST_ORDER_CHOICES` (строки с 662 по 727 в текущей редакции). На их место поставить реэкспорт:

```ts
// ─── «Настройки» (PRD-48 §4.1) ────────────────────────────────────────────────
// The sheet's contract lives in its own module: it grew from one parameter into a
// registry of forty, and keeping it here would drown the other eight sheets in it.
export {
  SETTINGS_HEADERS,
  SETTINGS_WIDTHS,
  SETTING_PARAM_NAMES,
  SETTING_PARAMS,
  emptySettingsDraft,
  parseSettingsSheet,
  serializeSettingsRows,
  type SettingsDraft,
  type SettingsSource,
} from "./workbook-settings";
```

- [ ] **Шаг 2. Прогнать типы, увидеть три падения**

Выполнить: `npm run check`

Ожидается: FAIL — `TEST_ORDER_CHOICES` в `workbook-template.ts`, `parseSettingsRow`/`ParsedTestSettings`
в `workbook-import.ts`, `parseSettingsRow` в `tests/workbook-question-order.test.ts`.

- [ ] **Шаг 3. Починить шаблон книги**

В `server/services/workbook-template.ts` заменить импорт `TEST_ORDER_CHOICES` на `SETTING_PARAM_NAMES`
и удалить запись листа «Настройки» из `VALIDATED_COLUMNS`:

```ts
  [SHEET_SETTINGS]: {
    "Параметр": SETTING_PARAM_NAMES,
  },
```

Выпадающий список на колонке «Значение» снимается: у каждого параметра своя область значений, и
один список на всю колонку предлагал бы «Перемешивание» там, где ждут «Да».

- [ ] **Шаг 4. Перевести проход импорта**

В `server/services/workbook-import.ts` заменить импорт `parseSettingsRow`/`ParsedTestSettings` на
`parseSettingsSheet`/`emptySettingsDraft`/`type SettingsDraft` и переписать проход «Настройки»
(строки 130-146 текущей редакции):

```ts
  // ── «Настройки» (PRD-48 §4.1): settings OF THE TEST, read before anything else so
  // the structure pass can save them together with the sections. A book without the
  // sheet changes nothing — that is what a book exported before a parameter existed
  // has to keep meaning.
  let settingsDraft: SettingsDraft = emptySettingsDraft();
  const settingsSheet = findSheet(workbook, "Настройки");
  if (settingsSheet) {
    const parsed = parseSettingsSheet(sheetToObjects(settingsSheet));
    settingsDraft = parsed.draft;
    result.errors.push(...parsed.errors);
  }
```

- [ ] **Шаг 5. Собрать патч теста из черновика**

Там же, в `workbook-import.ts`, добавить функцию перед `importWorkbook`:

```ts
/**
 * Patch for the `tests` row built from the «Настройки» draft.
 *
 * JSON columns are merged OVER the current value rather than rebuilt from scratch: a
 * «Период охлаждения» row without a «Разделять период» row would otherwise wipe the half
 * of the policy the book never mentioned (FR-20).
 */
function buildTestPatch(draft: SettingsDraft, current: Test | undefined): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...draft.test };

  if (Object.keys(draft.overall).length > 0) {
    patch.overallPassRuleJson = { ...(current?.overallPassRuleJson as object ?? {}), ...draft.overall };
  }

  const hasRetake = [draft.retake, draft.attemptInterval, draft.plugin].some(
    (b) => Object.keys(b).length > 0,
  );
  if (hasRetake) {
    const cur = (current?.retakePolicyJson ?? {}) as Record<string, unknown>;
    const retake: Record<string, unknown> = { ...cur, ...draft.retake };
    if (Object.keys(draft.attemptInterval).length > 0) {
      retake.attemptInterval = { ...(cur.attemptInterval as object ?? {}), ...draft.attemptInterval };
    }
    if (Object.keys(draft.plugin).length > 0) {
      retake.eligibilityPlugin = { ...(cur.eligibilityPlugin as object ?? {}), ...draft.plugin };
    }
    patch.retakePolicyJson = retake;
  }

  const hasIntro = [draft.introResults, draft.introReport, draft.introRoot].some(
    (b) => Object.keys(b).length > 0,
  );
  if (hasIntro) {
    const cur = (current?.introJson ?? {}) as Record<string, unknown>;
    const intro: Record<string, unknown> = { ...cur, ...draft.introRoot };
    if (Object.keys(draft.introResults).length > 0) {
      intro.results = { format: "plain", text: "", ...(cur.results as object ?? {}), ...draft.introResults };
    }
    if (Object.keys(draft.introReport).length > 0) {
      intro.report = { format: "plain", text: "", ...(cur.report as object ?? {}), ...draft.introReport };
    }
    patch.introJson = intro;
  }

  return patch;
}
```

Добавить `Test` в импорт из `@shared/schema` в этом файле.

- [ ] **Шаг 6. Применить патч в обеих ветвях сохранения**

В `workbook-import.ts` заменить `...testSettings` на `...buildTestPatch(settingsDraft, current)` в ветви
со «Структурой» (около строки 735) и переписать ветвь без «Структуры» (строки 745-753):

```ts
  // A book may carry «Настройки» WITHOUT «Структура» — settings of an existing test,
  // edited on their own. Saving them must not require re-sending sections (the service
  // rewrites sections only when the payload names them).
  if (!dryRun && !structureSheet) {
    const current = await storage.getTest(testId);
    const patch = buildTestPatch(settingsDraft, current);
    if (Object.keys(patch).length > 0) {
      await testSettingsService.save(testId, {
        test: {
          ...patch,
          status: (current?.status as "draft" | "published" | "archived") ?? "draft",
        },
      });
    }
  }
```

- [ ] **Шаг 7. Отдать выгрузке путь папки**

В `server/routes/tests-workbook.ts` перед сборкой книги собрать путь папки и передать его в источник:

```ts
      // «Папка» of the settings sheet — the path from the root, walked up the parents.
      const folders = await storage.getTestFolders();
      const folderById = new Map(folders.map((f) => [f.id, f]));
      const folderPath = (() => {
        const parts: string[] = [];
        let cur = test.folderId ? folderById.get(test.folderId) : undefined;
        const guard = new Set<string>();
        while (cur && !guard.has(cur.id)) {
          guard.add(cur.id);
          parts.unshift(cur.name);
          cur = cur.parentId ? folderById.get(cur.parentId) : undefined;
        }
        return parts.join(" / ");
      })();
```

и заменить строку записи листа:

```ts
      addSheet(wb, "Настройки", serializeSettingsRows({ ...test, folderPath }), SETTINGS_HEADERS, SETTINGS_WIDTHS);
```

- [ ] **Шаг 8. Переписать старый тест под новый контракт**

В `tests/workbook-question-order.test.ts` заменить импорт `parseSettingsRow` на `parseSettingsSheet` и
блок из шести проверок листа «Настройки» (строки 155-210) на:

```ts
  it("«Порядок выдачи вопросов» читается по всем трём значениям", () => {
    for (const [label, expected] of [
      ["Фиксированный порядок", "fixed"],
      ["Перемешивание", "random"],
      ["Полное перемешивание", "shuffle_all"],
      ["  полное ПЕРЕМЕШИВАНИЕ ", "shuffle_all"],
    ] as const) {
      const { draft, errors } = parseSettingsSheet([
        { "Параметр": "Порядок выдачи вопросов", "Значение": label },
      ]);
      expect(errors).toEqual([]);
      expect(draft.test.questionOrder).toBe(expected);
    }
  });

  it("пустое значение не меняет порядок, мусорное даёт ошибку строки", () => {
    expect(parseSettingsSheet([{ "Параметр": "Порядок выдачи вопросов", "Значение": "" }]).draft.test)
      .toEqual({});
    expect(parseSettingsSheet([{ "Параметр": "Порядок выдачи вопросов", "Значение": "как-нибудь" }]).errors)
      .toHaveLength(1);
  });

  it("порядок выдачи переживает круг «экспорт — импорт»", () => {
    const rows = serializeSettingsRows({ questionOrder: "fixed" });
    expect(parseSettingsSheet(rows).draft.test.questionOrder).toBe("fixed");
    expect(serializeSettingsRows({ questionOrder: null })
      .find((r) => r["Параметр"] === "Порядок выдачи вопросов")?.["Значение"]).toBe("");
  });
```

Прежняя проверка «пустой `questionOrder` выгружается как «Перемешивание»» снимается сознательно:
реестр пишет пустую ячейку там, где у теста ничего нет, и подставлять умолчание вместо пустоты
значило бы навязывать «Перемешивание» тесту, который его не выбирал.

- [ ] **Шаг 9. Прогнать затронутые тесты и типы**

Выполнить:

```bash
npm run check
npm test -- tests/workbook-settings.test.ts tests/workbook-question-order.test.ts tests/workbook-template.test.ts tests/routes.tests-workbook.test.ts
```

Ожидается: 0 ошибок типов, все четыре файла PASS.

- [ ] **Шаг 10. Коммит**

```bash
git add server/utils/workbook-sheets.ts server/services/workbook-import.ts server/routes/tests-workbook.ts server/services/workbook-template.ts tests/workbook-question-order.test.ts
git commit -m "feat(workbook): лист «Настройки» переносит все параметры теста"
```

### Task 3. Папка теста

**Файлы:**

- Изменить: `server/services/workbook-import.ts`
- Тест: `tests/routes.tests-workbook.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Добавить в `tests/routes.tests-workbook.test.ts`:

```ts
  it("«Папка» создаёт недостающие папки и кладёт тест в последнюю", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Настройки");
    sheet.addRow(["Параметр", "Значение"]);
    sheet.addRow(["Папка", "Аттестация / 2026"]);

    await importWorkbook(testId, wb, { dryRun: false });

    const folders = await storage.getTestFolders();
    const parent = folders.find((f) => f.name === "Аттестация");
    const child = folders.find((f) => f.name === "2026");
    expect(parent).toBeDefined();
    expect(child?.parentId).toBe(parent!.id);
    expect((await storage.getTest(testId))?.folderId).toBe(child!.id);
  });
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.tests-workbook.test.ts -t "Папка"`

Ожидается: FAIL — `folderId` теста не изменился (`undefined`/`null` вместо id папки).

- [ ] **Шаг 3. Реализовать резолвинг пути**

В `server/services/workbook-import.ts` добавить функцию:

```ts
/**
 * A «Папка / Подпапка» path → the id of the last folder, creating the missing ones.
 *
 * Creating rather than failing: the workbook already creates missing TOPICS by name, and a
 * folder is the same hierarchy of names. Demanding a pre-built tree would ask the author to
 * reproduce by hand the structure the book already describes.
 */
async function resolveFolderPath(path: string, actorId: string | null): Promise<string | null> {
  const names = path.split("/").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return null;

  const existing = await storage.getTestFolders();
  let parentId: string | null = null;
  for (const name of names) {
    const key = name.toLowerCase();
    const found = existing.find(
      (f) => f.name.trim().toLowerCase() === key && (f.parentId ?? null) === parentId,
    );
    if (found) {
      parentId = found.id;
      continue;
    }
    const created = await storage.createTestFolder({ name, parentId, createdBy: actorId });
    existing.push(created);
    parentId = created.id;
  }
  return parentId;
}
```

- [ ] **Шаг 4. Позвать её из сборки патча**

В `importWorkbook` перед обеими ветвями сохранения добавить:

```ts
  // The folder resolves HERE, not in the registry: the registry is pure cell parsing,
  // while a path needs storage and may create rows.
  if (!dryRun && settingsDraft.folderPath !== undefined) {
    const folderId = await resolveFolderPath(settingsDraft.folderPath, actor?.id ?? null);
    settingsDraft.test.folderId = folderId;
  }
```

- [ ] **Шаг 5. Убедиться, что тест зелёный**

Выполнить: `npm test -- tests/routes.tests-workbook.test.ts`

Ожидается: PASS, включая новый тест про папку.

- [ ] **Шаг 6. Коммит**

```bash
git add server/services/workbook-import.ts tests/routes.tests-workbook.test.ts
git commit -m "feat(workbook): папка теста переносится путём, недостающие создаются"
```

---

## Срез B. Сценарий прохождения

### Task 4. Снять фиксацию маршрутизатора

**Файлы:**

- Изменить: `server/services/workbook-import.ts:731`
- Тест: `tests/routes.tests-workbook.test.ts`

- [ ] **Шаг 1. Написать падающие тесты**

Добавить в `tests/routes.tests-workbook.test.ts`:

```ts
  it("книга со «Структурой» без сценария не делает тест маршрутизатором", async () => {
    const wb = new ExcelJS.Workbook();
    const structure = wb.addWorksheet("Структура");
    structure.addRow(["Раздел", "Порядок", "Вопросов в выборке"]);
    structure.addRow(["Финансы", 1, 2]);

    await importWorkbook(testId, wb, { dryRun: false });

    const test = await storage.getTest(testId);
    expect((test?.flowPolicyJson as { mode?: string } | null)?.mode ?? "linear_flat").toBe("linear_flat");
  });

  it("сценарий из книги применяется", async () => {
    const wb = new ExcelJS.Workbook();
    const settings = wb.addWorksheet("Настройки");
    settings.addRow(["Параметр", "Значение"]);
    settings.addRow(["Сценарий прохождения", "Через страницу-маршрутизатор"]);
    const structure = wb.addWorksheet("Структура");
    structure.addRow(["Раздел", "Порядок", "Вопросов в выборке"]);
    structure.addRow(["Финансы", 1, 2]);

    await importWorkbook(testId, wb, { dryRun: false });

    const test = await storage.getTest(testId);
    expect((test?.flowPolicyJson as { mode?: string }).mode).toBe("router_by_topics");
  });
```

- [ ] **Шаг 2. Убедиться, что первый тест падает**

Выполнить: `npm test -- tests/routes.tests-workbook.test.ts -t "не делает тест маршрутизатором"`

Ожидается: FAIL — получено `router_by_topics` вместо `linear_flat`.

- [ ] **Шаг 3. Заменить жёсткую запись на условную**

В `server/services/workbook-import.ts` в ветви со «Структурой» убрать строку
`flowPolicyJson: { mode: "router_by_topics" },` и добавить перед вызовом `save`:

```ts
      // The flow is written ONLY when the book named it (PRD-48 FR-06). The import used
      // to set `router_by_topics` unconditionally (PRD-14 FR-16), so a linear test came
      // back from an export/import round trip as a router-page test.
      const flowPatch: Record<string, unknown> = {};
      if (settingsDraft.flowMode) {
        const currentRouter = (current?.flowPolicyJson as { router?: unknown } | null)?.router ?? null;
        flowPatch.flowPolicyJson = settingsDraft.flowMode === "router_by_topics"
          ? { mode: "router_by_topics", router: { ...(currentRouter as object ?? {}), ...settingsDraft.router } }
          : { mode: settingsDraft.flowMode, router: null };
      }
```

и подставить `...flowPatch` в объект `test:` вызова `save` перед `...buildTestPatch(...)`.

- [ ] **Шаг 4. Убедиться, что оба теста зелёные**

Выполнить: `npm test -- tests/routes.tests-workbook.test.ts`

Ожидается: PASS.

- [ ] **Шаг 5. Закрыть FR-07 тестом на создание теста импортом**

Добавить в `tests/routes.workbook.test.ts` (там живут проверки `/api/workbook/import-new`):

```ts
  it("тест, созданный импортом книги без сценария, линейный", async () => {
    const wb = new ExcelJS.Workbook();
    const structure = wb.addWorksheet("Структура");
    structure.addRow(["Раздел", "Порядок", "Вопросов в выборке"]);
    structure.addRow(["Финансы", 1, 1]);

    const res = await request(app)
      .post("/api/workbook/import-new")
      .field("newTestTitle", "Импортированный")
      .attach("file", await workbookToBuffer(wb), "book.xlsx");

    expect(res.status).toBe(201);
    const created = await storage.getTest(res.body.test.id);
    expect((created?.flowPolicyJson as { mode?: string } | null)?.mode ?? "linear_flat")
      .toBe("linear_flat");
  });
```

Выполнить: `npm test -- tests/routes.workbook.test.ts`

Ожидается: PASS. Тест зелёный сразу после шага 3 — он закрепляет поведение, а не гонит новое:
`testSettingsService.create` оставляет `flow_policy_json` пустым, и все читатели трактуют пустой
как «Линейный».

- [ ] **Шаг 6. Коммит**

```bash
git add server/services/workbook-import.ts tests/routes.tests-workbook.test.ts tests/routes.workbook.test.ts
git commit -m "fix(workbook): импорт больше не навязывает страницу-маршрутизатор"
```

### Task 5. Построчные ошибки вместо ответа 500

**Файлы:**

- Изменить: `server/services/workbook-import.ts`
- Тест: `tests/routes.tests-workbook.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
  it("недопустимое сочетание режима и сценария даёт ошибку строки, а не падение", async () => {
    const wb = new ExcelJS.Workbook();
    const settings = wb.addWorksheet("Настройки");
    settings.addRow(["Параметр", "Значение"]);
    settings.addRow(["Режим теста", "Адаптивный"]);
    settings.addRow(["Сценарий прохождения", "Линейный"]);
    const structure = wb.addWorksheet("Структура");
    structure.addRow(["Раздел", "Порядок", "Вопросов в выборке"]);
    structure.addRow(["Финансы", 1, 2]);

    const result = await importWorkbook(testId, wb, { dryRun: false });

    expect(result.errors.some((e) => e.includes("Адаптивный режим"))).toBe(true);
  });
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.tests-workbook.test.ts -t "недопустимое сочетание"`

Ожидается: FAIL — тест падает исключением `FlowPolicyValidationError`, до `expect` дело не доходит.

- [ ] **Шаг 3. Ловить ошибку применения**

В `server/services/workbook-import.ts` обернуть оба вызова `testSettingsService.save`:

```ts
/**
 * Save, turning the service's refusals into per-row workbook errors.
 *
 * The service throws `FlowPolicyValidationError` on combinations the editor cannot even
 * assemble (adaptive mode in the flat flow, an adaptive section without levels). Before
 * PRD-48 that exception reached the route and became a 500 "Failed to import workbook" —
 * the author saw a refusal without a single word about the cause.
 */
async function saveOrCollect(
  testId: string,
  payload: Parameters<typeof testSettingsService.save>[1],
  errors: string[],
): Promise<void> {
  try {
    await testSettingsService.save(testId, payload);
  } catch (error) {
    if (error instanceof FlowPolicyValidationError) {
      for (const v of error.violations) errors.push(`Настройки теста: ${v.message}`);
      return;
    }
    throw error;
  }
}
```

Добавить импорт `FlowPolicyValidationError` из `./flow-policy-validator` и заменить оба
`await testSettingsService.save(testId, {...})` на `await saveOrCollect(testId, {...}, result.errors)`.

- [ ] **Шаг 4. Убедиться, что тест зелёный**

Выполнить: `npm test -- tests/routes.tests-workbook.test.ts`

Ожидается: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add server/services/workbook-import.ts tests/routes.tests-workbook.test.ts
git commit -m "fix(workbook): отказ применения настроек виден построчно, а не ответом 500"
```

---

## Срез C. Недостающие поля раздела

### Task 6. Три простые колонки «Структуры»

**Файлы:**

- Изменить: `server/utils/workbook-sheets.ts` (`STRUCTURE_HEADERS`, `STRUCTURE_WIDTHS`,
  `parseStructureRow`, `serializeStructureRow`)
- Изменить: `server/services/workbook-import.ts` (проброс в `SectionPayload`)
- Изменить: `server/routes/tests-workbook.ts` (проброс в сериализатор)
- Тест: `tests/workbook-sheets.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Добавить в `tests/workbook-sheets.test.ts`:

```ts
describe("«Структура»: поля раздела (PRD-48 FR-09)", () => {
  it("три новые колонки ходят по кругу", () => {
    const row = serializeStructureRow({
      topicName: "Финансы",
      sortOrder: 0,
      drawCount: 5,
      topicPassRuleJson: null,
      required: true,
      drawAll: true,
      timeLimitMinutes: 15,
      defaultPoints: 2,
    });
    expect(row["Выдавать все вопросы темы"]).toBe("да");
    expect(row["Лимит времени темы"]).toBe(15);
    expect(row["Цена вопроса по умолчанию"]).toBe(2);

    const parsed = parseStructureRow(row, 0);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.drawAll).toBe(true);
    expect(parsed.value.timeLimitMinutes).toBe(15);
    expect(parsed.value.defaultPoints).toBe(2);
  });

  it("отсутствие колонок оставляет умолчания", () => {
    const parsed = parseStructureRow(
      { "Раздел": "Финансы", "Порядок": 1, "Вопросов в выборке": 5 },
      0,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.drawAll).toBe(false);
    expect(parsed.value.timeLimitMinutes).toBeNull();
    expect(parsed.value.defaultPoints).toBeNull();
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/workbook-sheets.test.ts -t "поля раздела"`

Ожидается: FAIL — `row["Выдавать все вопросы темы"]` равно `undefined`.

- [ ] **Шаг 3. Расширить контракт листа**

В `server/utils/workbook-sheets.ts` дополнить заголовки и ширины:

```ts
export const STRUCTURE_HEADERS = [
  "Раздел", "Порядок", "Вопросов в выборке", "Тип порога", "Порог", "Обязательный",
  "Случайный порядок вопросов",
  // PRD-48 FR-09: the section fields the workbook was missing for a full transfer.
  "Выдавать все вопросы темы", "Лимит времени темы", "Цена вопроса по умолчанию",
];
export const STRUCTURE_WIDTHS = [28, 10, 20, 16, 10, 14, 26, 24, 20, 26];
```

В `serializeStructureRow` добавить в возвращаемый объект (тип аргумента дополнить полями
`drawAll?: boolean`, `timeLimitMinutes?: number | null`, `defaultPoints?: number | null`):

```ts
    "Выдавать все вопросы темы": section.drawAll ? "да" : "нет",
    "Лимит времени темы": section.timeLimitMinutes ?? "",
    "Цена вопроса по умолчанию": section.defaultPoints ?? "",
```

В `parseStructureRow` добавить разбор (перед `return { ok: true, value: ... }`) и три поля в
результат, дополнив интерфейс `ParsedSection` (он объявлен прямо над функцией) полями
`drawAll: boolean`, `timeLimitMinutes: number | null`, `defaultPoints: number | null`:

```ts
  // An empty cell means the section default, NOT zero: the columns may be absent from
  // the book entirely (an older export).
  const drawAll = String(row["Выдавать все вопросы темы"] ?? "").trim().toLowerCase() === "да";
  const timeLimitRaw = String(row["Лимит времени темы"] ?? "").trim();
  const defaultPointsRaw = String(row["Цена вопроса по умолчанию"] ?? "").trim();
  if (timeLimitRaw !== "" && !/^\d+$/.test(timeLimitRaw)) {
    return { ok: false, error: `«Лимит времени темы»: нужно целое число, получено "${timeLimitRaw}"` };
  }
  if (defaultPointsRaw !== "" && !/^\d+$/.test(defaultPointsRaw)) {
    return { ok: false, error: `«Цена вопроса по умолчанию»: нужно целое число, получено "${defaultPointsRaw}"` };
  }
  const timeLimitMinutes = timeLimitRaw === "" ? null : Number(timeLimitRaw);
  const defaultPoints = defaultPointsRaw === "" ? null : Number(defaultPointsRaw);
```

- [ ] **Шаг 4. Пробросить в обе стороны**

В `server/services/workbook-import.ts` в `pending.push({ ... payload: { ... } })` добавить:

```ts
          drawAll: sec.drawAll,
          timeLimitMinutes: sec.timeLimitMinutes,
          defaultPoints: sec.defaultPoints,
```

В `server/routes/tests-workbook.ts` в вызов `serializeStructureRow` добавить:

```ts
          drawAll: s.drawAll,
          timeLimitMinutes: s.timeLimitMinutes,
          defaultPoints: s.defaultPoints,
```

- [ ] **Шаг 5. Убедиться, что тесты зелёные**

Выполнить: `npm test -- tests/workbook-sheets.test.ts tests/workbook-question-order.test.ts tests/routes.tests-workbook.test.ts`

Ожидается: PASS.

- [ ] **Шаг 6. Коммит**

```bash
git add server/utils/workbook-sheets.ts server/services/workbook-import.ts server/routes/tests-workbook.ts tests/workbook-sheets.test.ts
git commit -m "feat(workbook): «Структура» переносит выдачу всей темы, лимит времени и цену вопроса"
```

### Task 7. Код темы

**Файлы:**

- Изменить: `server/utils/workbook-sheets.ts`, `server/services/workbook-import.ts`,
  `server/routes/tests-workbook.ts`
- Тест: `tests/routes.tests-workbook.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
  it("«Код темы» проставляется теме без кода и не перетирает существующий", async () => {
    const withCode = await storage.createTopic({ name: "Право", code: "law" });
    const withoutCode = await storage.createTopic({ name: "Финансы" });

    const wb = new ExcelJS.Workbook();
    const structure = wb.addWorksheet("Структура");
    structure.addRow(["Раздел", "Порядок", "Вопросов в выборке", "Код темы"]);
    structure.addRow(["Финансы", 1, 1, "fin"]);
    structure.addRow(["Право", 2, 1, "другой"]);

    await importWorkbook(testId, wb, { dryRun: false });

    const topics = await storage.getTopics();
    expect(topics.find((t) => t.id === withoutCode.id)?.code).toBe("fin");
    expect(topics.find((t) => t.id === withCode.id)?.code).toBe("law");
  });
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.tests-workbook.test.ts -t "Код темы"`

Ожидается: FAIL — код темы «Финансы» остался `null`.

- [ ] **Шаг 3. Добавить колонку**

В `server/utils/workbook-sheets.ts` дописать `"Код темы"` в `STRUCTURE_HEADERS` (после `"Раздел"`),
`22` в `STRUCTURE_WIDTHS` на ту же позицию, в `serializeStructureRow` — `"Код темы": section.topicCode ?? ""`
(поле `topicCode?: string | null` в типе аргумента), в `parseStructureRow` — `topicCode` в результат:

```ts
  // The topic code travels for the sake of result-variable FORMULAS: they address a
  // topic as `topicById("<code>")`, and a book without codes leaves those formulas
  // without an addressee (`topics.code`, migration 032).
  const topicCode = String(row["Код темы"] ?? "").trim() || null;
```

- [ ] **Шаг 4. Проставлять код на импорте**

В `server/services/workbook-import.ts` в проходе «Структура», сразу после успешного резолва `topicId`:

```ts
      // The code is set on a topic that has NONE and never overwrites an existing one:
      // a topic is shared between tests, and one test's book may not rename the address
      // another test's formulas call it by (PRD-48 FR-10).
      if (!dryRun && sec.topicCode && !topicId.startsWith("__newtopic__:")) {
        const topic = topics.find((t) => t.id === topicId);
        if (topic && !topic.code) await storage.updateTopic(topicId, { code: sec.topicCode });
      }
```

- [ ] **Шаг 5. Отдать код выгрузке**

В `server/routes/tests-workbook.ts` собрать карту кодов рядом с картой имён и передать в сериализатор:

```ts
      const topicCode = new Map(topics.map((t) => [t.id, t.code]));
```

```ts
          topicCode: topicCode.get(s.topicId) ?? null,
```

- [ ] **Шаг 6. Убедиться, что тест зелёный**

Выполнить: `npm test -- tests/routes.tests-workbook.test.ts`

Ожидается: PASS.

- [ ] **Шаг 7. Коммит**

```bash
git add server/utils/workbook-sheets.ts server/services/workbook-import.ts server/routes/tests-workbook.ts tests/routes.tests-workbook.test.ts
git commit -m "feat(workbook): код темы едет книгой, чтобы формулы показателей не теряли адресата"
```

### Task 8. Правила разблокировки разделов

**Файлы:**

- Изменить: `server/utils/workbook-sheets.ts`, `server/services/workbook-import.ts`,
  `server/routes/tests-workbook.ts`
- Тест: `tests/routes.tests-workbook.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
  it("правила разблокировки ходят по кругу по ИМЕНАМ тем", async () => {
    await storage.createTopic({ name: "Вводный" });
    await storage.createTopic({ name: "Основной" });

    const wb = new ExcelJS.Workbook();
    const settings = wb.addWorksheet("Настройки");
    settings.addRow(["Параметр", "Значение"]);
    settings.addRow(["Сценарий прохождения", "Через страницу-маршрутизатор"]);
    const structure = wb.addWorksheet("Структура");
    structure.addRow(["Раздел", "Порядок", "Вопросов в выборке", "Доступность раздела", "Зависит от разделов"]);
    structure.addRow(["Вводный", 1, 1, "Доступен сразу", ""]);
    structure.addRow(["Основной", 2, 1, "После завершения выбранных разделов", "Вводный"]);

    await importWorkbook(testId, wb, { dryRun: false });

    const test = await storage.getTest(testId);
    const topics = await storage.getTopics();
    const intro = topics.find((t) => t.name === "Вводный")!;
    const main = topics.find((t) => t.name === "Основной")!;
    const rules = (test?.flowPolicyJson as { router: { sectionUnlockRules: Record<string, unknown> } })
      .router.sectionUnlockRules;
    expect(rules[main.id]).toEqual({ mode: "after_sections_completed", sectionIds: [intro.id] });
  });
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.tests-workbook.test.ts -t "правила разблокировки"`

Ожидается: FAIL — `sectionUnlockRules` пуст.

- [ ] **Шаг 3. Добавить две колонки**

В `server/utils/workbook-sheets.ts` дописать в `STRUCTURE_HEADERS` `"Доступность раздела"` и
`"Зависит от разделов"`, в `STRUCTURE_WIDTHS` — `34` и `34`. Рядом со словарями порогов добавить:

```ts
/**
 * «Доступность раздела» → the router's unlock mode (PRD-8 §3.2).
 *
 * The rules are keyed by TOPIC ids, not section ids: `isSectionUnlocked` in
 * `shared/flow/router-hub` reads `unlockRules[section.topicId]`. That is why the workbook
 * addresses them by topic NAME — section ids are minted anew on every import anyway.
 */
const UNLOCK_MODE_FROM: Record<string, "always_available" | "after_sections_completed" | "after_sections_passed"> = {
  "": "always_available",
  "доступен сразу": "always_available",
  "после завершения выбранных разделов": "after_sections_completed",
  "после успешного прохождения выбранных разделов": "after_sections_passed",
};
const UNLOCK_MODE_TO: Record<string, string> = {
  always_available: "Доступен сразу",
  after_sections_completed: "После завершения выбранных разделов",
  after_sections_passed: "После успешного прохождения выбранных разделов",
};
export const UNLOCK_MODE_CHOICES = Object.values(UNLOCK_MODE_TO);
```

В `serializeStructureRow` (тип аргумента дополнить `unlockMode?: string | null`,
`unlockDependsOn?: string[]`):

```ts
    "Доступность раздела": UNLOCK_MODE_TO[section.unlockMode ?? "always_available"] ?? UNLOCK_MODE_TO.always_available,
    "Зависит от разделов": (section.unlockDependsOn ?? []).join("; "),
```

В `parseStructureRow` — разбор в результат:

```ts
  const unlockRaw = String(row["Доступность раздела"] ?? "").trim().toLowerCase();
  const unlockMode = UNLOCK_MODE_FROM[unlockRaw];
  if (unlockMode === undefined) {
    return { ok: false, error: `«Доступность раздела»: недопустимое значение "${unlockRaw}"` };
  }
  const unlockDependsOn = String(row["Зависит от разделов"] ?? "")
    .split(";").map((s) => s.trim()).filter(Boolean);
```

- [ ] **Шаг 4. Собрать правила на импорте**

В `server/services/workbook-import.ts` в проходе «Структура» накапливать карту (перед циклом):

```ts
    // Unlock rules: topic NAMES for now, ids once every row has been resolved.
    const unlockByTopicName = new Map<string, { mode: string; dependsOn: string[] }>();
```

внутри цикла, после резолва `topicId`:

```ts
      if (sec.unlockMode !== "always_available" || sec.unlockDependsOn.length > 0) {
        unlockByTopicName.set(key, { mode: sec.unlockMode, dependsOn: sec.unlockDependsOn });
      }
```

и перед сборкой `flowPatch`:

```ts
      // Dependency names → topic ids. A name absent from the book's sections is an
      // author's typo: a silently dropped dependency would OPEN a section meant to be
      // locked.
      const unlockRules: Record<string, unknown> = {};
      for (const [name, rule] of unlockByTopicName) {
        const id = topicIdByName.get(name);
        if (!id) continue;
        const ids: string[] = [];
        for (const dep of rule.dependsOn) {
          const depId = topicIdByName.get(normalizeName(dep));
          if (!depId) {
            result.errors.push(`Лист «Структура»: раздел "${dep}" из «Зависит от разделов» не найден`);
            continue;
          }
          ids.push(depId);
        }
        unlockRules[id] = rule.mode === "always_available"
          ? { mode: "always_available" }
          : { mode: rule.mode, sectionIds: ids };
      }
      if (Object.keys(unlockRules).length > 0) settingsDraft.router.sectionUnlockRules = unlockRules;
```

- [ ] **Шаг 5. Отдать правила выгрузке**

В `server/routes/tests-workbook.ts` перед сборкой строк «Структуры»:

```ts
      const routerRules = ((test.flowPolicyJson as { router?: { sectionUnlockRules?: Record<string, {
        mode?: string; sectionIds?: string[] }> } } | null)?.router?.sectionUnlockRules) ?? {};
```

и в вызов `serializeStructureRow`:

```ts
          unlockMode: routerRules[s.topicId]?.mode ?? null,
          unlockDependsOn: (routerRules[s.topicId]?.sectionIds ?? []).map((id) => topicName.get(id) ?? id),
```

- [ ] **Шаг 6. Убедиться, что тест зелёный**

Выполнить: `npm test -- tests/routes.tests-workbook.test.ts tests/workbook-sheets.test.ts`

Ожидается: PASS.

- [ ] **Шаг 7. Коммит**

```bash
git add server/utils/workbook-sheets.ts server/services/workbook-import.ts server/routes/tests-workbook.ts tests/routes.tests-workbook.test.ts
git commit -m "feat(workbook): правила разблокировки разделов переносятся именами тем"
```

---

## Срез D. Шаблон и документы

### Task 9. Шаблон книги

**Файлы:**

- Изменить: `server/services/workbook-template.ts`
- Тест: `tests/workbook-template.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Добавить `SETTING_PARAM_NAMES` в импорт из `../server/utils/workbook-sheets` в этом файле, затем:

```ts
  it("лист «Настройки» шаблона перечисляет все параметры", async () => {
    const wb = await buildWorkbookTemplate();
    const sheet = wb.worksheets.find((w) => w.name === "Настройки")!;
    const names = sheetToObjects(sheet).map((r) => String(r["Параметр"]));
    expect(names).toEqual(SETTING_PARAM_NAMES);
    expect(names.length).toBeGreaterThan(30);
  });
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/workbook-template.test.ts -t "перечисляет все параметры"`

Ожидается: FAIL — лист пуст (в шаблоне только заголовки).

- [ ] **Шаг 3. Заполнить лист именами параметров**

В `server/services/workbook-template.ts` в `buildWorkbookTemplate` после записи ролевых листов
заполнить «Настройки» именами:

```ts
  // «Настройки» is the ONLY role sheet that ships non-empty: it is a parameter/value
  // list, and an empty sheet would not tell the author which parameters exist. The
  // values stay blank, and a blank cell changes nothing (PRD-48 §4.4).
  const settingsSheet = wb.worksheets.find((w) => w.name === SHEET_SETTINGS);
  if (settingsSheet) {
    for (const name of SETTING_PARAM_NAMES) settingsSheet.addRow([name, ""]);
  }
```

Заменить пример листа в `EXAMPLE_ROWS[SHEET_SETTINGS]` на три показательные строки:

```ts
  [SHEET_SETTINGS]: [
    { "Параметр": "Сценарий прохождения", "Значение": "Линейный по темам" },
    { "Параметр": "Порядок выдачи вопросов", "Значение": "Перемешивание" },
    { "Параметр": "Максимум попыток", "Значение": 3 },
  ],
```

- [ ] **Шаг 4. Убедиться, что тесты зелёные**

Выполнить: `npm test -- tests/workbook-template.test.ts tests/routes.workbook.test.ts`

Ожидается: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add server/services/workbook-template.ts tests/workbook-template.test.ts
git commit -m "feat(workbook): шаблон книги перечисляет все параметры листа «Настройки»"
```

### Task 10. Документы

**Файлы:**

- Изменить: `docs/specs/prd-14/questions-import-export.md`
- Изменить: `docs/specs/questions-import/format.md`

- [ ] **Шаг 1. Снять устаревшее требование PRD-14**

В `docs/specs/prd-14/questions-import-export.md` в строке FR-16 заменить
«применяет их через `testSettingsService` с режимом `router_by_topics`» на
«применяет их через `testSettingsService`; сценарий прохождения задаёт лист «Настройки»
(PRD-48 FR-05, FR-06)». В §5.6 заменить предложение «Поток фиксируется в `router_by_topics`.» на:

```markdown
Сценарий прохождения книга берёт с листа «Настройки» (PRD-48 FR-05). До PRD-48 импорт
безусловно ставил `router_by_topics`, и линейный тест после круга «экспорт — импорт»
становился тестом со страницей-маршрутизатором.
```

- [ ] **Шаг 2. Дополнить таблицу листов контракта формата**

В `docs/specs/questions-import/format.md` §12.1 добавить две строки в начало таблицы:

```markdown
| `Настройки` | Параметры САМОГО теста, список «параметр — значение» (PRD-48) | по имени параметра |
| `Оценка` | Переопределения цены и градуированной оценки вопроса в тесте (PRD-15 блок D) | (тест, вопрос) |
```

и в §12 в абзац «Статус» дописать: «PRD-48 (2026-08-10) довёл лист `Настройки` до всех
параметров теста и снял фиксацию сценария.»

- [ ] **Шаг 3. Прогнать линтер разметки**

Выполнить: `npx markdownlint-cli2 "docs/specs/prd-14/*.md" "docs/specs/questions-import/*.md"`

Ожидается: 0 замечаний.

- [ ] **Шаг 4. Коммит**

```bash
git add docs/specs/prd-14/questions-import-export.md docs/specs/questions-import/format.md
git commit -m "docs(prd-14): сценарий задаёт лист «Настройки», а не фиксация импорта"
```

---

## Приёмка этапа

- [ ] `npm run check` — 0 ошибок.
- [ ] Затронутые наборы тестов зелёные:

```bash
npm test -- tests/workbook-settings.test.ts tests/workbook-sheets.test.ts \
  tests/workbook-question-order.test.ts tests/workbook-template.test.ts \
  tests/routes.tests-workbook.test.ts tests/routes.workbook.test.ts
```

- [ ] Полный прогон `npm test` — ТОЛЬКО с явного разрешения владельца: в одной рабочей копии
  параллельно идут другие сессии.
- [ ] В браузере: у теста с заполненными настройками выгрузить книгу из меню действий,
  создать новый тест загрузкой этой книги через раздел «Импорт», сверить вкладку «Настройки»
  обоих тестов поле за полем.
- [ ] В браузере: линейный тест после круга «экспорт — импорт» остался линейным.
- [ ] Книга, снятая ДО этой работы (лист «Настройки» с одной строкой), импортируется без ошибок.
