/**
 * @module tests/breakdown-persistence
 * @description PRD-50 FR-39: записи разреза области ТЕСТА сохраняются вместе с попыткой.
 * До этой работы они собирались только ради контекста формул и пропадали, поэтому блок
 * области теста (Э4) и аналитика без пересчёта были невозможны.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { attemptResultSchema, breakdownEntrySchema } from "../shared/schema";

const entry = {
  scope: "test", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
  unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50,
};

const base = {
  totalCorrect: 1, totalQuestions: 2, overallPercent: 50,
  totalEarnedPoints: 1, totalPossiblePoints: 2, overallPassed: false,
  topicResults: [],
};

describe("attemptResultSchema.breakdowns", () => {
  it("принимает записи области теста", () => {
    const parsed = attemptResultSchema.parse({ ...base, breakdowns: [entry] });
    expect(parsed.breakdowns).toEqual([entry]);
  });

  it("результат, сохранённый до этой работы, остаётся валидным", () => {
    expect(attemptResultSchema.parse(base).breakdowns).toBeUndefined();
  });

  it("схема записи одна на все места хранения", () => {
    // Страж от второй копии: три места (тема, тест, адаптивная тема) обязаны разбирать
    // запись ОДНОЙ схемой, иначе поле, добавленное в одном, молча потеряется в двух других.
    expect(breakdownEntrySchema.parse(entry)).toEqual(entry);
  });
});

const viewSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/viewResults.js"),
  "utf8",
);

/** Lift the package's plain-JS `vrTopicBreakdown` out of the flat ES5 runtime. */
function makeVrTopicBreakdown() {
  const match = viewSrc.match(/function vrTopicBreakdown\([\s\S]*?\n\}/);
  if (!match) throw new Error("vrTopicBreakdown not found in viewResults.js");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${match[0]}\n;return vrTopicBreakdown;`)() as (
    tr: unknown,
    breakdowns: unknown,
  ) => unknown[];
}

describe("пакет SCORM: разрез сохранённой попытки", () => {
  const sectionEntry = { ...entry, scope: "section:law" };
  const vrTopicBreakdown = makeVrTopicBreakdown();

  it("у СОХРАНЁННОЙ попытки берёт записи с самой темы", () => {
    // Запись попытки из suspend_data: плоского списка `breakdowns` в ней нет вовсе.
    const tr = { topicId: "law", breakdown: [sectionEntry] };
    expect(vrTopicBreakdown(tr, undefined)).toEqual([sectionEntry]);
  });

  it("у ТЕКУЩЕЙ попытки берёт свои записи из плоского списка", () => {
    const tr = { topicId: "law" };
    expect(vrTopicBreakdown(tr, [sectionEntry, { ...entry, scope: "section:sec" }]))
      .toEqual([sectionEntry]);
  });

  it("темы без ключей остаются без строк", () => {
    expect(vrTopicBreakdown({ topicId: "sec" }, [sectionEntry])).toEqual([]);
  });
});

describe("пакет SCORM: calculateResults не выбрасывает записи темы", () => {
  const resultsSrc = readFileSync(
    resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
    "utf8",
  );
  const mapped = resultsSrc.match(/topicResults: agg\.topicResults\.map\([\s\S]*?\n {4}\}\)/);

  it("тема, уходящая в suspend_data, несёт поле breakdown, сведённое к t.breakdown", () => {
    // Страж, а не проверка вычисления: `saveAttemptResult` пишет `topicResults` дословно
    // (suspendAttempts.js), поэтому поле на теме — единственный путь записей в сохранённую
    // попытку. Пропажа этой строки читается как «полос нет у прошлых попыток» и ничем
    // больше не ловится.
    expect(mapped?.[0]).toMatch(/breakdown:[\s\S]*t\.breakdown/);
  });

  it("пустой breakdown темы не пишет ключ вовсе (JSON.stringify гасит undefined)", () => {
    // `aggregateStandardResult` (shared/scoring/aggregate.ts) всегда возвращает МАССИВ на
    // `t.breakdown`, даже для темы без единого ключа (`breakdown: []`, никогда не absent).
    // Литеральное `breakdown: t.breakdown` из плана поэтому писало бы `"breakdown":[]` на
    // КАЖДОЙ теме КАЖДОЙ попытки — байты за тест, который вообще не использует PRD-50.
    // Значит поле обязано гаситься до undefined, а не проходить как есть.
    const fnSrc = mapped?.[0]
      ?.replace(/^topicResults: agg\.topicResults\.map\(/, "")
      .replace(/\)$/, "");
    if (!fnSrc) throw new Error("topicResults mapper function not found");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const mapper = new Function(`return (${fnSrc});`)() as (t: unknown) => Record<string, unknown>;

    const withoutTags = mapper({ breakdown: [], extra: {} });
    // `undefined` keeps the KEY present (`in`), but `JSON.stringify` — the serializer
    // `writeSuspendObj` actually calls — drops an `undefined`-valued key outright; that
    // is the behaviour the byte budget depends on, not `Object.keys`.
    expect(withoutTags.breakdown).toBeUndefined();
    expect(JSON.stringify(withoutTags)).not.toContain("breakdown");

    const sectionEntry = { ...entry, scope: "section:law" };
    const withTags = mapper({ breakdown: [sectionEntry], extra: {} });
    expect(withTags.breakdown).toEqual([sectionEntry]);
  });
});
