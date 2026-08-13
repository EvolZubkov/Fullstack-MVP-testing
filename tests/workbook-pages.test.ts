/**
 * @module tests/workbook-pages
 *
 * PRD-48 Э3: листы «Страницы» и «Поля страниц». Проверяются свойства контракта: адрес
 * страницы однозначен (две авторские страницы одной зоны не сливаются), поле привязано к
 * названной странице, «Куда» разводит содержание и настройки, а пустое «Значение» — это
 * значимая пустая строка, а не «оставить как есть».
 */
import { describe, it, expect } from "vitest";
import { contentPages } from "@shared/schema";
import {
  PAGE_HEADERS,
  PAGE_FIELD_HEADERS,
  PAGE_KIND_CHOICES,
  PAGE_ZONE_CHOICES,
  PAGE_MODE_CHOICES,
  PAGE_TARGET_CHOICES,
  serializePageRows,
  serializePageFieldRows,
  parsePageSheets,
  type PageSource,
} from "../server/utils/workbook-pages";

/** Системная страница: её создаёт сервер, книга только обновляет содержимое. */
const START: PageSource = {
  position: "before",
  kind: "start",
  templateKey: "start.default",
  mode: "template",
  autoAdvance: false,
  autoAdvanceDelayMs: null,
  valuesJson: { values: { title: "Добро пожаловать", lead: "Пара слов" } },
  settingsJson: { buttonLabel: "Начать", showLogo: true, delay: 5 },
};

/** Авторская страница в зоне темы. */
const INFO: PageSource = {
  position: "after_topic",
  topicName: "Финансы",
  kind: "info",
  templateKey: "info.wide",
  mode: "html",
  autoAdvance: true,
  autoAdvanceDelayMs: 0,
  valuesJson: { values: { body: "<p>Итоги темы</p>" } },
  settingsJson: { sequenceId: "seq-1" },
};

describe("листы «Страницы» и «Поля страниц»", () => {
  it("заголовки несут четырёхчастный адрес страницы", () => {
    expect(PAGE_HEADERS).toEqual([
      "Зона", "Раздел", "Вид", "Номер", "Вариант", "Режим", "Автопереход", "Задержка, мс",
    ]);
    expect(PAGE_FIELD_HEADERS).toEqual(["Зона", "Раздел", "Вид", "Номер", "Куда", "Ключ", "Значение"]);
  });

  it("перечень видов не разошёлся со схемой", () => {
    // «Авторская» одна, остальные семь — системные; легаси `summary` не предлагается.
    expect(PAGE_KIND_CHOICES).toEqual([
      "Стартовая", "Вопросы", "Маршрутизатор", "Введение раздела", "Обзор", "Итоги раздела",
      "Итоги", "Авторская",
    ]);
    expect(PAGE_KIND_CHOICES).toHaveLength(contentPages.kind.enumValues.length - 1);
    expect(PAGE_ZONE_CHOICES).toEqual(["До теста", "После теста", "До темы", "После темы"]);
    expect(PAGE_MODE_CHOICES).toEqual(["Шаблон", "Стандартный", "HTML"]);
    expect(PAGE_TARGET_CHOICES).toEqual(["Содержание", "Настройка"]);
  });

  it("системная и авторская страницы ходят по кругу", () => {
    const pages = [START, INFO];
    const { pages: parsed, errors } = parsePageSheets(
      serializePageRows(pages),
      serializePageFieldRows(pages),
    );

    expect(errors).toEqual([]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      zone: "before",
      topicName: "",
      topicKey: "",
      kind: "start",
      index: 1,
      templateKey: "start.default",
      mode: "template",
      autoAdvance: false,
      autoAdvanceDelayMs: undefined,
      values: { title: "Добро пожаловать", lead: "Пара слов" },
      // Скаляры едут литералом: именно так их читает нормализация настроек страницы
      // (`raw === "true"`, `Number(raw)`), а «Да»/«Нет» молча дали бы `false`.
      settings: { buttonLabel: "Начать", showLogo: "true", delay: "5" },
    });
    expect(parsed[1]).toEqual({
      zone: "after_topic",
      topicName: "Финансы",
      topicKey: "финансы",
      kind: "info",
      index: 1,
      templateKey: "info.wide",
      mode: "html",
      autoAdvance: true,
      autoAdvanceDelayMs: 0,
      values: { body: "<p>Итоги темы</p>" },
      settings: { sequenceId: "seq-1" },
    });
  });

  it("«Задержка, мс» = 0 переживает круг: выгрузка не пишет того, что отвергает загрузка", () => {
    const rows = serializePageRows([INFO]);
    expect(rows[0]["Задержка, мс"]).toBe("0");
    expect(parsePageSheets(rows, []).pages[0].autoAdvanceDelayMs).toBe(0);
  });

  it("структурное значение возвращается объектом, а не строкой JSON", () => {
    const page: PageSource = {
      position: "after",
      kind: "results",
      valuesJson: { values: { score: { path: "attempt.score", renderer: "number" } } },
    };
    const { pages, errors } = parsePageSheets(
      serializePageRows([page]),
      serializePageFieldRows([page]),
    );
    expect(errors).toEqual([]);
    expect(pages[0].values.score).toEqual({ path: "attempt.score", renderer: "number" });
  });

  it("две авторские страницы одной зоны различаются номером и не сливаются", () => {
    const first: PageSource = { position: "after", kind: "info", valuesJson: { values: { body: "Первая" } } };
    const second: PageSource = { position: "after", kind: "info", valuesJson: { values: { body: "Вторая" } } };

    const rows = serializePageRows([first, second]);
    expect(rows.map((r) => r["Номер"])).toEqual([1, 2]);

    const { pages, errors } = parsePageSheets(rows, serializePageFieldRows([first, second]));
    expect(errors).toEqual([]);
    expect(pages).toHaveLength(2);
    expect(pages[0].values).toEqual({ body: "Первая" });
    expect(pages[1].values).toEqual({ body: "Вторая" });
  });

  it("повторённый адрес — ошибка своей строки", () => {
    const { pages, errors } = parsePageSheets([
      { "Зона": "После теста", "Вид": "Авторская", "Номер": 1 },
      { "Зона": "После теста", "Вид": "Авторская", "Номер": 1 },
    ], []);
    expect(pages).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("строка 3");
  });

  it("«Куда» разводит содержание и настройки в разные словари", () => {
    const { pages, errors } = parsePageSheets(
      [{ "Зона": "До теста", "Вид": "Стартовая", "Номер": 1 }],
      [
        { "Зона": "До теста", "Вид": "Стартовая", "Номер": 1, "Куда": "Содержание", "Ключ": "title", "Значение": "Т" },
        { "Зона": "До теста", "Вид": "Стартовая", "Номер": 1, "Куда": "Настройка", "Ключ": "title", "Значение": "Н" },
      ],
    );
    expect(errors).toEqual([]);
    expect(pages[0].values).toEqual({ title: "Т" });
    expect(pages[0].settings).toEqual({ title: "Н" });
  });

  it("поле с адресом, которого нет на листе «Страницы», — ошибка своей строки", () => {
    const { errors } = parsePageSheets(
      [{ "Зона": "До теста", "Вид": "Стартовая", "Номер": 1 }],
      [{ "Зона": "После теста", "Вид": "Авторская", "Номер": 2, "Куда": "Содержание", "Ключ": "body", "Значение": "X" }],
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("не названа на листе «Страницы»");
  });

  it("неизвестные зона, вид, режим и «Куда» — ошибка своей строки", () => {
    const { pages, errors } = parsePageSheets(
      [
        { "Зона": "В середине", "Вид": "Авторская", "Номер": 1 },
        { "Зона": "До теста", "Вид": "Приветствие", "Номер": 1 },
        { "Зона": "До теста", "Вид": "Стартовая", "Номер": 1, "Режим": "Волшебный" },
        { "Зона": "До теста", "Вид": "Стартовая", "Номер": 2 },
      ],
      [{ "Зона": "До теста", "Вид": "Стартовая", "Номер": 2, "Куда": "Куда-то", "Ключ": "title", "Значение": "Т" }],
    );
    expect(pages).toHaveLength(1);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain("«Зона»");
    expect(errors[1]).toContain("«Вид»");
    expect(errors[2]).toContain("«Режим»");
    expect(errors[3]).toContain("«Куда»");
    expect(pages[0].values).toEqual({});
  });

  it("зона темы без раздела и зона теста с разделом — ошибки", () => {
    const { pages, errors } = parsePageSheets([
      { "Зона": "До темы", "Раздел": "", "Вид": "Введение раздела", "Номер": 1 },
      { "Зона": "До теста", "Раздел": "Финансы", "Вид": "Стартовая", "Номер": 1 },
    ], []);
    expect(pages).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("не указан «Раздел»");
    expect(errors[1]).toContain("должна быть пустой");
  });

  it("пустое «Значение» — значимая пустая строка, а не «оставить как есть»", () => {
    const { pages, errors } = parsePageSheets(
      [{ "Зона": "До теста", "Вид": "Стартовая", "Номер": 1 }],
      [
        { "Зона": "До теста", "Вид": "Стартовая", "Номер": 1, "Куда": "Содержание", "Ключ": "lead", "Значение": "" },
        // Ячейка из одного пробела выглядит пустой; без обрезки `Number(" ")` дал бы 0.
        { "Зона": "До теста", "Вид": "Стартовая", "Номер": 1, "Куда": "Настройка", "Ключ": "delay", "Значение": " " },
      ],
    );
    expect(errors).toEqual([]);
    expect(pages[0].values).toEqual({ lead: "" });
    expect("lead" in pages[0].values).toBe(true);
    expect(pages[0].settings).toEqual({ delay: "" });
  });

  it("незаявленный вариантом ключ сохраняется как есть: фильтрация — забота импорта", () => {
    const { pages, errors } = parsePageSheets(
      [{ "Зона": "До теста", "Вид": "Стартовая", "Номер": 1 }],
      [{ "Зона": "До теста", "Вид": "Стартовая", "Номер": 1, "Куда": "Настройка", "Ключ": "чужойКлюч", "Значение": "<b>x</b>" }],
    );
    expect(errors).toEqual([]);
    expect(pages[0].settings).toEqual({ "чужойКлюч": "<b>x</b>" });
  });

  it("пустой «Номер» берёт следующий свободный в зоне и находит единственную страницу вида", () => {
    const { pages, errors } = parsePageSheets(
      [
        { "Зона": "После теста", "Вид": "Итоги" },
        { "Зона": "После теста", "Вид": "Авторская" },
      ],
      [{ "Зона": "После теста", "Вид": "Авторская", "Куда": "Содержание", "Ключ": "body", "Значение": "Х" }],
    );
    expect(errors).toEqual([]);
    expect(pages.map((p) => p.index)).toEqual([1, 2]);
    expect(pages[1].values).toEqual({ body: "Х" });
  });

  it("пустой «Номер» при двух страницах одного вида — ошибка, а не догадка", () => {
    const { errors } = parsePageSheets(
      [
        { "Зона": "После теста", "Вид": "Авторская", "Номер": 1 },
        { "Зона": "После теста", "Вид": "Авторская", "Номер": 2 },
      ],
      [{ "Зона": "После теста", "Вид": "Авторская", "Куда": "Содержание", "Ключ": "body", "Значение": "Х" }],
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("укажите «Номер»");
  });

  it("сырые значения модели и легаси `summary` принимаются при разборе", () => {
    const { pages, errors } = parsePageSheets([
      { "Зона": "before_topic", "Раздел": "Финансы", "Вид": "summary", "Номер": 1, "Режим": "standard" },
    ], []);
    expect(errors).toEqual([]);
    expect(pages[0]).toMatchObject({ zone: "before_topic", kind: "summary", mode: "standard" });
  });

  it("страница зоны темы без имени темы не выгружается: адресовать её нечем", () => {
    const rows = serializePageRows([{ position: "before_topic", kind: "intro", topicName: "" }]);
    expect(rows).toEqual([]);
  });

  it("пустые строки в конце листа пропускаются", () => {
    const { pages, errors } = parsePageSheets(
      [{ "Зона": "", "Раздел": "", "Вид": "", "Номер": "" }],
      [{ "Зона": "", "Вид": "", "Ключ": "", "Значение": "" }],
    );
    expect(pages).toEqual([]);
    expect(errors).toEqual([]);
  });
});
