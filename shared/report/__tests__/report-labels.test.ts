/**
 * @module shared/report/__tests__/report-labels
 *
 * PRD-49, задача 11 — НАДПИСИ В ОТЧЁТЕ и его собственный слой переопределений.
 *
 * Проверяется весь путь документа целиком, а не одна функция: объявления манифеста
 * поставляемого шаблона -> разрешение для экрана `report` (`resolveReportBake`) -> контекст
 * отчёта (`buildReportContext`) -> макет варианта. Именно этим путём приходит и выбор
 * варианта отчёта, поэтому проверять надписи в отрыве от него значило бы проверять не то,
 * что печатается.
 *
 * Манифест и макеты читаются С ДИСКА: предмет проверки — поставляемые файлы, а фикстура
 * рядом с ними неизбежно разошлась бы с продуктом.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compileTemplate } from "../../template/dsl";
import { resolveReportBake, type ReportLabelLayers } from "../report-variants";
import { buildReportContext, buildAdaptiveReportContext } from "../report-context";
import type { ReportInput, AdaptiveReportInput } from "../report-html";

const TEMPLATE_DIR = path.join(process.cwd(), "server", "scorm", "templates", "default");
const MANIFEST: unknown = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "manifest.json"), "utf-8"));
const REPORT = fs.readFileSync(path.join(TEMPLATE_DIR, "layouts", "report.html"), "utf-8");
const REPORT_ADAPTIVE = fs.readFileSync(path.join(TEMPLATE_DIR, "layouts", "report.adaptive.html"), "utf-8");

/** Попытка с темами, курсами и мероприятиями — то есть со всеми разделами документа. */
const STANDARD: ReportInput = {
  testName: "Тест",
  learnerName: "Ольга Швецова",
  timestamp: "2026-08-12T10:00:00.000Z",
  attemptsCount: 1,
  result: {
    passed: false,
    percent: 40,
    totalQuestions: 10,
    correct: 4,
    earnedPoints: 4,
    possiblePoints: 10,
    topicResults: [
      {
        topicId: "t1",
        topicName: "Технологии",
        correct: 4,
        total: 10,
        percent: 40,
        earnedPoints: 4,
        possiblePoints: 10,
        passed: false,
        recommendedCourses: [{ title: "Основы сетей", url: "https://e/net" }],
        recommendedEvents: [{ title: "Семинар по инфраструктуре" }],
      },
    ],
  },
};

const ADAPTIVE: AdaptiveReportInput = {
  testName: "Тест",
  adaptive: true,
  timestamp: "2026-08-12T10:00:00.000Z",
  result: {
    passed: true,
    topicResults: [
      { topicName: "Технологии", achievedLevelIndex: 1, achievedLevelName: "Средний", feedback: "" },
    ],
  },
};

/** Печатный вид документа: разметка со схлопнутыми пробелами. */
function renderReport(layers?: ReportLabelLayers): string {
  const bake = resolveReportBake(MANIFEST, "report", null, "", layers);
  return compileTemplate(REPORT)(buildReportContext(STANDARD, { labels: bake.labels })).replace(/\s+/g, " ");
}

describe("отчёт печатает надписи блоков (PRD-49)", () => {
  it("берёт формулировки из словаря, а не из макета", () => {
    const html = renderReport();
    // Ключи `results.*` — те же, что на экране итогов, поэтому и умолчания те же.
    expect(html).toContain("По темам");
    // …а у групп рекомендаций манифест объявил СВОИ умолчания отчёта (`defaults.report`).
    expect(html).toContain("Рекомендации по курсам");
    expect(html).toContain("Рекомендуемые мероприятия");
    // Жёстких строк в макете не осталось: они пришли из словаря, а не из вёрстки.
    expect(REPORT).not.toContain(">Результаты по темам<");
    expect(REPORT).not.toContain(">Рекомендации по курсам<");
  });

  it("умолчание экрана `report` применяется там, где своих значений нет", () => {
    // Автор переформулировал только темы — умолчание отчёта у групп рекомендаций осталось.
    const html = renderReport({ values: { "results.topics": { on: true, text: "Разделы теста" } } });
    expect(html).toContain("Разделы теста");
    expect(html).toContain("Рекомендации по курсам");
    expect(html).not.toContain("Пройти обучение");
  });

  it("без переопределений печатает ОБЩУЮ формулировку теста", () => {
    // Консолидированный блок рекомендаций поднимает обратная связь самого теста.
    const withFeedback: ReportInput = { ...STANDARD, feedback: { text: "Повторите материал" } };
    const bake = resolveReportBake(MANIFEST, "report", null, "", {
      values: { "results.recommendations": { on: true, text: "Что делать дальше" } },
    });
    const html = compileTemplate(REPORT)(
      buildReportContext(withFeedback, { labels: bake.labels }),
    ).replace(/\s+/g, " ");
    expect(html).toContain("Что делать дальше");
    expect(html).not.toContain(">Рекомендации<");
  });

  it("переопределение отчёта побеждает общую формулировку", () => {
    const layers: ReportLabelLayers = {
      values: { "results.topics": { on: true, text: "Разделы теста" } },
      overrides: { "results.topics": { on: true, text: "Разделы теста (документ)" } },
    };
    const html = renderReport(layers);
    expect(html).toContain("Разделы теста (документ)");
    // На экране итогов при этом остаётся общая формулировка: слой принадлежит документу.
    const screen = resolveReportBake(MANIFEST, "report", null, "", { values: layers.values });
    expect(screen.labels?.["results.topics"]).toBe("Разделы теста");
  });

  it("выключенная в отчёте надпись уносит заголовок, но не сам раздел", () => {
    const html = renderReport({ overrides: { "results.topics": { on: false } } });
    expect(html).not.toContain("По темам");
    // Карточки тем на месте — гасится подпись, а не содержимое (спека, решение 4).
    expect(html).toContain("Технологии");
  });

  it("адаптивный отчёт читает тот же словарь", () => {
    const bake = resolveReportBake(MANIFEST, "report.adaptive", null, "", {
      values: { "results.topics": { on: true, text: "Разделы теста" } },
    });
    const html = compileTemplate(REPORT_ADAPTIVE)(
      buildAdaptiveReportContext(ADAPTIVE, { labels: bake.labels }),
    ).replace(/\s+/g, " ");
    expect(html).toContain("Разделы теста");
    expect(html).toContain("Технологии");
  });

  it("без надписей вовсе документ собирается и печатает разделы без заголовков", () => {
    // Шаблон, не объявивший `labels[]`: карты в запекании нет, и контекст её не несёт.
    const bake = resolveReportBake({ contentTemplates: [] }, "report", null);
    expect(bake.labels).toBeUndefined();
    const ctx = buildReportContext(STANDARD, { labels: bake.labels });
    expect((ctx as { labels?: unknown }).labels).toBeUndefined();
    const html = compileTemplate(REPORT)(ctx).replace(/\s+/g, " ");
    expect(html).toContain("Технологии");
    expect(html).toContain("Основы сетей");
    expect(html).not.toContain("По темам");
  });
});
