/**
 * @module features/analytics/test/__tests__/question-distribution.test
 * @description Э4а: полный вид распределения ответов на странице вопроса.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotGradedTiles, QuestionAnswersCard, SpreadCard, UnitsCard } from "../question-distribution";
import { termOrText } from "./term-text";

function withQuery(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

afterEach(() => vi.unstubAllGlobals());

describe("UnitsCard", () => {
  it("сопоставление: пара, верный ответ, слабые и сильные, частая ошибка", () => {
    render(<UnitsCard units={{
      type: "matching", observations: 302, share: 0.64,
      units: [{ index: 0, label: "Приказы", reference: "75 лет", share: 0.64, bottomShare: 0.38, topShare: 0.88, mistake: { label: "50 лет", share: 0.21 } }],
    }} />);
    expect(screen.getByText("Пары")).toBeTruthy();
    expect(screen.getByText("верно: 75 лет")).toBeTruthy();
    expect(screen.getByText(termOrText("50 лет — 21 %"))).toBeTruthy();
    expect(screen.getByText(termOrText("38 %"))).toBeTruthy();
  });

  it("ранжирование: среднее место и сдвиг", () => {
    render(<UnitsCard units={{
      type: "ranking", observations: 10, share: 0.5, meanShift: 0.5,
      units: [{ index: 0, label: "Запрос", reference: "1", place: 1, share: 0.5, bottomShare: null, topShare: null, mistake: null, meanPlace: 1.5, meanShift: 0.5 }],
    }} />);
    expect(screen.getByText("верное место: 1")).toBeTruthy();
    expect(screen.getByText("1,5")).toBeTruthy();
  });
});

describe("SpreadCard", () => {
  it("короткий ответ: написания с пометкой «засчитано» и выгрузка", () => {
    render(<SpreadCard questionType="short" testId="t1" questionId="q1" spread={{
      answered: 286, options: [{ label: "декларация", share: 46, correct: true }, { label: "уведомление", share: 18, correct: false }],
    }} />);
    expect(screen.getByText("Что писали")).toBeTruthy();
    expect(screen.getByText("засчитано")).toBeTruthy();
    expect(screen.getByText("не засчитано")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Выгрузить ответы в Excel/ })).toBeTruthy();
  });

  it("шкала: градации без оценки", () => {
    render(<SpreadCard questionType="scale" testId="t1" questionId="q1" spread={{ answered: 10, options: [{ label: "Согласен", share: 60 }] }} />);
    expect(screen.getByText("Разброс ответов")).toBeTruthy();
    expect(screen.queryByText("засчитано")).toBeNull();
  });
});

describe("QuestionAnswersCard", () => {
  it("читает ответы порцией по 20 и называет, сколько показано", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total: 34, offset: 0, rows: [{ attemptId: "a1", participant: "Петрова Анна", at: null, answer: "Сообщу в комплаенс.", length: 19, outcome: "neutral", latencyMs: 425_000 }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(withQuery(<QuestionAnswersCard testId="t1" questionId="q1" questionType="long" volume={{ answered: 34, medianLength: 412, minLength: 38, maxLength: 1920 }} />));

    expect(await screen.findByText("Сообщу в комплаенс.")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/analytics/tests/t1/questions/q1/answers?offset=0&limit=20");
    expect(screen.getByText("Показано 1 из 34")).toBeTruthy();
    expect(screen.getByText("412 знаков")).toBeTruthy();
  });

  it("передаёт условия страницы и в список, и в ссылку выгрузки", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total: 0, offset: 0, rows: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(withQuery(
      <QuestionAnswersCard testId="t1" questionId="q1" questionType="long" search="?source=web&firstAttemptOnly=true" />,
    ));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0])
      .toBe("/api/analytics/tests/t1/questions/q1/answers?source=web&firstAttemptOnly=true&offset=0&limit=20");

    // Э5.2: кнопка открывает окно «Экспорт», и оно выгружает по тем же условиям.
    fetchMock.mockResolvedValue({
      ok: true, json: async () => ({ total: 7, offset: 0, rows: [] }),
      blob: async () => new Blob(["xlsx"]), headers: new Headers(),
    });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: /Выгрузить ответы в Excel/ }));
    expect(await screen.findByText("Под условия подходит 7 ответов")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/analytics/tests/t1/questions/q1/answers/export/excel?source=web&firstAttemptOnly=true",
      expect.anything(),
    ));
  });

  it("у пропусков — исход ответа тегом", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total: 1, offset: 0, rows: [{ attemptId: "a1", participant: "Соколов", at: null, answer: "1-й пропуск: «личная»", length: 20, outcome: "partial", latencyMs: null }] }),
    }));
    render(withQuery(<QuestionAnswersCard testId="t1" questionId="q1" questionType="blanks" />));
    await waitFor(() => expect(screen.getByText("частично")).toBeTruthy());
  });
});

describe("NotGradedTiles", () => {
  it("развёрнутый ответ: трудность не применима, сложность — заданная", () => {
    render(<NotGradedTiles declared={45} latencyMedianMs={400_000} latencySampleSize={34} />);
    expect(screen.getAllByText("не применимо")).toHaveLength(2);
    expect(screen.getByText("45")).toBeTruthy();
    expect(screen.getByText("6:40")).toBeTruthy();
  });
});
