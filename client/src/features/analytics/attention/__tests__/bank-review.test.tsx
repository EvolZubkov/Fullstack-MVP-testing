/**
 * @module features/analytics/attention/__tests__/bank-review
 * @description PRD-70 FR-60 - FR-62: карточка «Вопросы банка на ревизию» — строка «вопрос · тема»,
 * признак «в N из M тестов · ещё K», счётчик равен длине списка, «Статистика» ведёт на вопрос банка.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BankReviewCard } from "../bank-review";

const ROWS = [
  {
    questionId: "q1",
    prompt: "Что считается подарком по политике компании?",
    topicName: "Право и комплаенс",
    review: { tone: "error" as const, title: "Сильные ошибаются чаще", tests: 1, of: 2, more: 1 },
  },
  {
    questionId: "q2",
    prompt: "Что входит в вводный инструктаж?",
    topicName: "Охрана труда",
    review: { tone: "warning" as const, title: "Слишком лёгкий", tests: 2, of: 2, more: 0 },
  },
];

describe("BankReviewCard", () => {
  it("строки и подписи — как в эскизе; счётчик равен длине списка", () => {
    render(<BankReviewCard rows={ROWS} onOpen={() => {}} />);

    expect(screen.getByText("Вопросы банка на ревизию")).toBeInTheDocument();
    expect(screen.getByText("2 вопроса в ваших темах · признак хотя бы в одном тесте")).toBeInTheDocument();
    expect(screen.getByText("Что считается подарком по политике компании? · Право и комплаенс")).toBeInTheDocument();
    expect(screen.getByText("Сильные ошибаются чаще — в 1 из 2 тестов · ещё 1 признак")).toBeInTheDocument();
    expect(screen.getByText("Слишком лёгкий — в 2 из 2 тестов")).toBeInTheDocument();
    expect(screen.getByText("2", { selector: ".ou-tag, .ou-tag *" })).toBeInTheDocument();
  });

  it("«Статистика» открывает вопрос банка", () => {
    const onOpen = vi.fn();
    render(<BankReviewCard rows={ROWS} onOpen={onOpen} />);

    fireEvent.click(screen.getAllByRole("button", { name: /Статистика/ })[1]);
    expect(onOpen).toHaveBeenCalledWith("q2");
  });

  it("пусто — карточки нет", () => {
    const { container } = render(<BankReviewCard rows={[]} onOpen={() => {}} />);
    expect(container.textContent).toBe("");
  });
});
