/**
 * @module tests/start-facts
 * @description Плитки обложки, которые автор выключает на странице старта: «Показывать
 * число вопросов», «Показывать условие прохождения», «Показывать ограничение времени»,
 * «Показывать число попыток».
 *
 * Скрытие работает на ДАННЫХ: построитель убирает факт из `course.*`, а макеты всех
 * шаблонов и так гасят плитку по пустому полю. Переключатель действует, только если вариант
 * страницы его объявил, — иначе значение, сохранённое при другом варианте, прятало бы плитку
 * без способа её вернуть.
 */
import { describe, it, expect } from "vitest";
import {
  hiddenStartFacts,
  hideStartFacts,
  hideStartFactsInContext,
  START_FACT_SETTING_KEYS,
} from "@shared/template/start-facts";
import { buildStartState } from "@shared/template/start-state";

const variant = {
  settings: [
    { key: "image", type: "image" },
    ...Object.values(START_FACT_SETTING_KEYS).map((key) => ({ key, type: "boolean" })),
  ],
};

describe("hiddenStartFacts", () => {
  it("скрыто то, что вариант объявил и страница выключила", () => {
    expect(hiddenStartFacts(variant, { questionCountShown: false, maxAttemptsShown: false })).toEqual([
      "questionCount",
      "maxAttempts",
    ]);
  });

  it("незаданное значение — умолчание манифеста, плитка видна", () => {
    expect(hiddenStartFacts(variant, {})).toEqual([]);
    expect(hiddenStartFacts(variant, null)).toEqual([]);
    expect(hiddenStartFacts(variant, { timeLimitShown: true })).toEqual([]);
  });

  it("вариант без переключателя не прячет плитку, даже если значение сохранено", () => {
    expect(hiddenStartFacts({ settings: [{ key: "image", type: "image" }] }, { questionCountShown: false })).toEqual([]);
    expect(hiddenStartFacts(null, { questionCountShown: false })).toEqual([]);
  });
});

describe("hideStartFacts", () => {
  const course = {
    title: "Т",
    questionCount: 4,
    passPercent: null,
    passPoints: { value: 5, valueLabel: "5", label: "баллов для прохождения" },
    timeLimitMinutes: 30,
    timeLimitLabel: "30 мин",
    maxAttempts: 3,
  };

  it("убирает только выключенные плитки", () => {
    const out = hideStartFacts(course, ["questionCount", "timeLimit"]);
    expect("questionCount" in out).toBe(false);
    expect(out.timeLimitMinutes).toBeNull();
    expect(out.timeLimitLabel).toBe("");
    expect(out.passPoints).toEqual(course.passPoints);
    expect(out.maxAttempts).toBe(3);
  });

  it("условие прохождения уходит целиком: процент, баллы и темы", () => {
    const withTopics = { ...course, passPercent: 70, passCondition: { count: 2, total: 2, kind: "required" as const, countLabel: "2 из 2", label: "обязательных тем для прохождения" } };
    const out = hideStartFacts(withTopics, ["passCondition"]);
    expect(out.passPercent).toBeNull();
    expect("passPoints" in out).toBe(false);
    expect("passCondition" in out).toBe(false);
  });

  it("ничего не скрыто — тот же объект", () => {
    expect(hideStartFacts(course, [])).toBe(course);
    expect(hideStartFacts(course, null)).toBe(course);
  });
});

describe("buildStartState + hiddenFacts", () => {
  const base = { maxAttempts: 3, completedAttempts: 0, resume: null, hasCompletedResults: false, canStartNew: true };

  it("число попыток скрыто только на плитке — подзаголовок «Попытка N из M» остаётся", () => {
    const { course } = buildStartState({
      info: { title: "Т", questionCount: 4, passPercent: 70, maxAttempts: 3 },
      ...base,
      hiddenFacts: ["maxAttempts"],
    });
    expect(course.maxAttempts).toBeNull();
    expect(course.subtitle).toContain("из 3");
    expect(course.questionCount).toBe(4);
    expect(course.passPercent).toBe(70);
  });
});

describe("hideStartFactsInContext", () => {
  it("правит course и не трогает остальное", () => {
    const ctx = { course: { title: "Т", questionCount: 4 }, state: { canStart: true } };
    const out = hideStartFactsInContext(ctx, ["questionCount"]) as typeof ctx;
    expect("questionCount" in out.course).toBe(false);
    expect(out.state).toBe(ctx.state);
  });

  it("контекст без course возвращается как есть", () => {
    const ctx = { state: {} };
    expect(hideStartFactsInContext(ctx, ["questionCount"])).toBe(ctx);
  });
});
