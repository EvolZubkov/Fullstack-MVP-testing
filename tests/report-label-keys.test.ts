/**
 * @module tests/report-label-keys
 *
 * PRD-49, приёмка: панель «Заголовки и подписи отчёта» предлагала автору ВСЕ пятнадцать
 * объявленных надписей, а документ печатал шесть — тумблер «Заголовок итогов» стоял
 * включённым и не давал в PDF ничего. Решение владельца: надпись одна на экран и на
 * документ, поэтому зонтик «Ваш результат» ПЕЧАТАЕТСЯ и в отчёте, а перечень строк панели
 * равен тому, что печатают макеты.
 *
 * Кто печатает надпись, знает МАКЕТ, и только он: на экране итогов подзаголовки подблоков
 * едут данными (`result.blocks`), а в документе — прямыми путями `labels.*`, потому что
 * порядок подблоков отчёту сознательно не передаётся. Поэтому перечень для панели
 * ВЫЧИСЛЯЕТСЯ по макетам вариантов отчёта, а не объявляется вторым списком в манифесте:
 * второй список разошёлся бы с макетами молча.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { readReportLabelKeys } from "../server/services/template-render";

const DEFAULT_DIR = path.resolve(process.cwd(), "server", "scorm", "templates", "default");
const CERT_DIR = path.resolve(process.cwd(), "templates", "certification");

/** Ровно то, что печатают `report.html` и `report.adaptive.html` поставляемых шаблонов. */
const PRINTED = [
  "results.heading",
  "results.recommendations",
  "results.scales",
  "results.indicators",
  "results.topics",
  "recommendations.courses",
  "recommendations.events",
];

/** Объявлено, но документом не печатается ни в одном варианте. */
const NOT_PRINTED = [
  "results.summary",
  "recommendations.assets",
  "facts.questions",
  "facts.correct",
  "facts.points",
  "topic.correct",
  "topic.points",
  "section.eyebrow",
];

describe("readReportLabelKeys: перечень надписей, которые печатает документ", () => {
  for (const [templateId, dir] of [
    ["default", DEFAULT_DIR],
    ["certification", CERT_DIR],
  ] as const) {
    it(`${templateId}: отдаёт только надписи, встречающиеся в макетах отчёта`, () => {
      const keys = readReportLabelKeys(dir);
      expect(keys).not.toBeNull();
      for (const key of PRINTED) expect(keys, key).toContain(key);
      for (const key of NOT_PRINTED) expect(keys, key).not.toContain(key);
    });

    it(`${templateId}: порядок — объявления манифеста, чтобы панель не переставляла строки`, () => {
      const keys = readReportLabelKeys(dir)!;
      const sorted = [...keys].sort(
        (a, b) => PRINTED.indexOf(a) - PRINTED.indexOf(b),
      );
      // Оба списка идут в порядке манифеста, поэтому сортировка по нему ничего не двигает.
      expect(keys).toEqual(sorted);
    });
  }

  it("шаблон без вариантов отчёта отдаёт null — хост обязан взять перечень «Стандартного» (FR-10)", () => {
    // Каталог без manifest.json: чтения нет, объявлений нет, вариантов нет.
    expect(readReportLabelKeys(path.resolve(process.cwd(), "server", "scorm", "templates"))).toBeNull();
  });
});
