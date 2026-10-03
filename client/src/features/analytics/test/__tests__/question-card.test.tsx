/**
 * @module features/analytics/test/__tests__/question-card.test
 * @description Э3.3: «Вопрос в этом тесте» и «Этот вопрос в других тестах».
 *
 * Значения — из «Оценки» теста; заданное в тесте подписано, иначе непонятно, откуда число.
 * Исключённый вопрос назван тегом, верный ответ словами — только когда он есть. В других тестах
 * ниже порога — «мало данных», а не число; строка ведёт в тот тест.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OtherTestsCard, QuestionInTestCard, type QuestionCardView } from "../question-card";

const CARD: QuestionCardView = {
  questionId: "q1", prompt: "Расставьте этапы закупки", questionType: "ranking",
  topicName: "Закупки", tags: ["Процедуры", "223-ФЗ"], media: null, excluded: false,
  points: 3, pointsInTest: false, scoringKind: "tiered", scoringInTest: true,
  difficulty: 70, difficultyInTest: true, correctAnswer: "Заявка → Проверка → Договор",
  otherTests: [], windowMonths: 12,
};

describe("QuestionInTestCard", () => {
  it("показывает вопрос и его настройки в тесте, заданное в тесте — подписано", () => {
    render(<QuestionInTestCard card={CARD} currentSince="2026-09-04T00:00:00Z" onOpenInTopic={vi.fn()} />);

    expect(screen.getByText("Расставьте этапы закупки")).toBeTruthy();
    expect(screen.getByText("Текущая редакция · с 04.09.2026")).toBeTruthy();
    expect(screen.getByText("Закупки")).toBeTruthy();
    expect(screen.getByText("223-ФЗ")).toBeTruthy();
    expect(screen.getByText("выдаётся")).toBeTruthy();
    expect(screen.getByText("Ступени")).toBeTruthy();
    // Цена ответа и сложность заданы в тесте, балл — нет.
    expect(screen.getAllByText("настроено в тесте")).toHaveLength(2);
    expect(screen.getByText("Заявка → Проверка → Договор")).toBeTruthy();
  });

  it("исключённый вопрос — тегом; без верного ответа словами поля нет", () => {
    render(<QuestionInTestCard card={{ ...CARD, excluded: true, correctAnswer: null, difficultyInTest: false }} currentSince={null} onOpenInTopic={vi.fn()} />);

    expect(screen.getByText("Исключён из выдачи")).toBeTruthy();
    expect(screen.queryByText("Верный ответ")).toBeNull();
    expect(screen.getByText("из вопроса")).toBeTruthy();
    expect(screen.getByText("Текущая редакция")).toBeTruthy();
  });

  it("«Открыть вопрос в теме» ведёт к правке", async () => {
    const onOpenInTopic = vi.fn();
    render(<QuestionInTestCard card={CARD} currentSince={null} onOpenInTopic={onOpenInTopic} />);
    await userEvent.click(screen.getByRole("button", { name: "Открыть вопрос в теме" }));
    expect(onOpenInTopic).toHaveBeenCalled();
  });
});

describe("OtherTestsCard", () => {
  it("трудность или «мало данных»; строка ведёт в тот тест", async () => {
    const onOpen = vi.fn();
    render(
      <OtherTestsCard
        windowMonths={12}
        onOpen={onOpen}
        rows={[
          { testId: "t2", title: "Антикоррупционный минимум", delivered: 412, observations: 412, difficulty: 0.58 },
          { testId: "t3", title: "Вводный курс", delivered: 96, observations: 6, difficulty: null },
        ]}
      />,
    );

    expect(screen.getByText("Тесты, где вопрос выдавался за последние 12 мес.")).toBeTruthy();
    expect(screen.getByText("0,58")).toBeTruthy();
    expect(screen.getByText("мало данных")).toBeTruthy();
    await userEvent.click(screen.getByText("Вводный курс"));
    expect(onOpen).toHaveBeenCalledWith("t3");
  });

  it("пусто — говорит словами", () => {
    render(<OtherTestsCard windowMonths={12} onOpen={vi.fn()} rows={[]} />);
    expect(screen.getByText("В других тестах вопрос за это время не выдавался")).toBeTruthy();
  });
});
