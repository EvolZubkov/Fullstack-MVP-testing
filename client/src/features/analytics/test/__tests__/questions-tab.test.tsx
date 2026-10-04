/**
 * @module features/analytics/test/__tests__/questions-tab.test
 * @description Э4б: одна таблица вопросов с наборами колонок.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { QuestionsTab } from "../questions-tab";
import type { ItemQualityView } from "../item-quality";
import type { QuestionRow } from "../question-table";
import { termOrText } from "./term-text";

const question = (id: string, prompt: string, over: Partial<QuestionRow> = {}): QuestionRow => ({
  questionId: id, questionPrompt: prompt, questionType: "single", topicName: "Тема", difficulty: 50,
  totalAnswers: 60, gradedAnswers: 60, correctAnswers: 30, correctPercent: 50,
  skipShare: 3, exposurePercent: 82, latencyMedianMs: 48_000, latencySampleSize: 60, reviewFlags: [],
  ...over,
});

const item = (id: string, over: Record<string, unknown> = {}) => ({
  questionId: id, observations: 120, difficulty: 0.5, correctedDifficulty: null, itemRest: 0.35,
  discrimination: 0.4, declaredDifficulty: 50, difficultyConfidence: "reliable", coefficientConfidence: "reliable",
  flags: { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false, weakDiscrimination: false },
  timingFlags: { rushed: false, slow: false },
  ...over,
});

const QUALITY = {
  items: [
    item("q1", { itemRest: -0.21, discrimination: -0.14, flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false, weakDiscrimination: false } }),
    item("q2"),
    item("q3", { observations: 8, coefficientConfidence: "insufficient", itemRest: null }),
    item("pool", { observations: 0, difficulty: null, itemRest: null, coefficientConfidence: "insufficient", neverDelivered: true, prompt: "Ещё не выдавался", topicName: "Тема", questionType: "single" }),
  ],
  reliability: { alpha: 0.84, items: 42, respondents: 486, totalSd: 4, dichotomous: false },
  sem: 1, semPercent: 4.2, cutBand: null,
  sample: { respondents: 486, responses: 4000, bySource: { web: 486 }, unknownVersionShare: 0 },
  firstAttemptOnly: true,
} as unknown as ItemQualityView;

const QUESTIONS = [
  question("q1", "Испорченный ключ"),
  question("q2", "Обычный вопрос", { excludedFromDelivery: true }),
  question("q3", "Новый вопрос", { totalAnswers: 8 }),
];

function renderTab(node: ReactNode, path = "/author/analytics/tests/t1?tab=questions") {
  const { hook, searchHook } = memoryLocation({ path, record: true });
  return render(<Router hook={hook} searchHook={searchHook}>{node}</Router>);
}

const base = {
  questions: QUESTIONS, measurement: false, minObservations: 10, qualityLoading: false,
  quality: QUALITY, heuristics: {}, excluded: {}, onOpenQuestion: vi.fn(),
};

describe("QuestionsTab", () => {
  it("по умолчанию — набор «Основное», блока качества нет", () => {
    renderTab(<QuestionsTab {...base} />);
    expect(screen.getByRole("button", { name: "Основное" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(termOrText("Что отвечали"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Надёжность (альфа)"))).toBeNull();
  });

  it("«Психометрика» — блок качества над таблицей и колонка «Что не так»", () => {
    renderTab(<QuestionsTab {...base} initialSet="psychometrics" />);
    expect(screen.getByText(termOrText("Надёжность (альфа)"))).toBeTruthy();
    expect(screen.getByText(termOrText("Что не так"))).toBeTruthy();
    expect(screen.getByText("Сильные ошибаются чаще")).toBeTruthy();
  });

  it("«Показы и пропуски» — пропуски, экспозиция, другие тесты", () => {
    renderTab(<QuestionsTab {...base} initialSet="delivery" />);
    expect(screen.getByText(termOrText("Экспозиция"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Что отвечали"))).toBeNull();
  });

  it("вид не зависит от набора: «Под подозрением», «Мало данных», «Исключённые»", () => {
    renderTab(<QuestionsTab {...base} />);
    const views = screen.getByRole("button", { name: /Под подозрением/ }).closest(".ou-seg") as HTMLElement;
    expect(within(views).getByRole("button", { name: /Все/ }).textContent).toContain("4");

    fireEvent.click(within(views).getByRole("button", { name: /Под подозрением/ }));
    expect(screen.getByText("Испорченный ключ")).toBeTruthy();
    expect(screen.queryByText("Обычный вопрос")).toBeNull();

    fireEvent.click(within(views).getByRole("button", { name: /Исключённые/ }));
    expect(screen.getByText("Обычный вопрос")).toBeTruthy();
    expect(screen.queryByText("Испорченный ключ")).toBeNull();

    fireEvent.click(within(views).getByRole("button", { name: /Мало данных/ }));
    expect(screen.getByText("Новый вопрос")).toBeTruthy();
    expect(screen.getByText("Ещё не выдавался")).toBeTruthy();
  });

  it("набор пишется в адрес", () => {
    const { hook, searchHook, history } = memoryLocation({ path: "/author/analytics/tests/t1?tab=questions", record: true });
    render(<Router hook={hook} searchHook={searchHook}><QuestionsTab {...base} /></Router>);
    fireEvent.click(screen.getByRole("button", { name: "Психометрика" }));
    expect(history.at(-1)).toBe("/author/analytics/tests/t1?tab=questions&cols=psychometrics");
  });

  it("у опросника наборов два, «Под подозрением» нет", () => {
    renderTab(<QuestionsTab {...base} measurement />);
    expect(screen.queryByRole("button", { name: "Психометрика" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Под подозрением/ })).toBeNull();
  });
});
