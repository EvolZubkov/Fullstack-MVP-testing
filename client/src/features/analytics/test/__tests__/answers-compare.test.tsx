/**
 * @module features/analytics/test/__tests__/answers-compare
 * @description PRD-56 FR-07k - FR-07n, FR-21g: таблицы сравнения срезов «Ответы, шкалы и показатели».
 *
 * Стережётся то, что приёмка эскиза выбила у владельца: сортировка — щелчком по заголовку, по
 * умолчанию по «Расхождению»; «Разница» только при двух срезах; срез ниже минимума наблюдений
 * в расхождение не входит и подписан; уровни шкалы — таблицей долей, а не составной полосой.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnswersCompare, type AnswersQuestionMeta, type AnswersSlice } from "../answers-compare";

const QUESTIONS: AnswersQuestionMeta[] = [
  { questionId: "q1", prompt: "В чём ваш вклад?", type: "allocation", topicName: "ЧИЛ" },
  { questionId: "q2", prompt: "Какие недостатки вы замечаете?", type: "allocation", topicName: "ЧИЛ" },
];

const SCALE = (average: number, low: number, high: number) => ({
  key: "focus", label: "Целеполагание", average, sampleSize: 20, domainMin: 0, domainMax: 35, hasBands: true,
  bands: [
    { level: "low", label: "Низкий", count: 0, share: low, color: "red", tone: null },
    { level: "high", label: "Высокий", count: 0, share: high, color: "blue", tone: null },
  ],
});

function slice(id: string, name: string, q1: [number, number], q2: [number, number], answered = 26): AnswersSlice {
  return {
    id, name, conditions: {}, respondents: answered,
    questions: [
      { questionId: "q1", answered, options: [{ label: "Результат", share: q1[0] }, { label: "Атмосфера", share: q1[1] }] },
      { questionId: "q2", answered, options: [{ label: "Требовательность", share: q2[0] }, { label: "Договорённости", share: q2[1] }] },
    ],
    scales: [SCALE(answered === 26 ? 27.4 : 22.1, 15, 47)],
  };
}

const HRBP = slice("s1", "HRBP", [35, 65], [32, 68]);
const DUZ = slice("s2", "Тестовая ДУЗ", [29, 71], [49, 51], 22);

/** Тексты строк первой (вопросной) таблицы сверху вниз. */
function questionOrder(): string[] {
  const grid = screen.getByText(/^Ответы на вопросы/).parentElement!;
  return within(grid).getAllByText(/В чём ваш вклад|Какие недостатки/).map(node => node.textContent ?? "");
}

describe("AnswersCompare", () => {
  it("вопросы по умолчанию идут по убыванию расхождения", () => {
    render(<AnswersCompare slices={[HRBP, DUZ]} questions={QUESTIONS} minObservations={10} />);

    expect(questionOrder()[0]).toMatch(/Какие недостатки/);
    expect(screen.getByText("17 п.п.")).toBeInTheDocument();
  });

  it("щелчок по «Вопросу» возвращает порядок теста", () => {
    render(<AnswersCompare slices={[HRBP, DUZ]} questions={QUESTIONS} minObservations={10} />);

    fireEvent.click(screen.getByText("Вопрос"));
    expect(questionOrder()[0]).toMatch(/В чём ваш вклад/);
  });

  it("при двух срезах есть «Разница», при трёх — нет", () => {
    const { unmount } = render(<AnswersCompare slices={[HRBP, DUZ]} questions={QUESTIONS} minObservations={10} />);
    expect(screen.getAllByText("Разница").length).toBeGreaterThan(0);
    unmount();

    render(<AnswersCompare slices={[HRBP, DUZ, slice("s3", "Тест целиком", [33, 67], [40, 60], 48)]} questions={QUESTIONS} minObservations={10} />);
    expect(screen.queryByText("Разница")).toBeNull();
  });

  it("уровни шкалы — таблица долей по срезам", () => {
    render(<AnswersCompare slices={[HRBP, DUZ]} questions={QUESTIONS} minObservations={10} />);

    expect(screen.getByText("Целеполагание · уровни")).toBeInTheDocument();
    expect(screen.getByText("27,4 из 35")).toBeInTheDocument();
    expect(screen.getByText("22,1 из 35")).toBeInTheDocument();
  });

  it("indicators: averages with the difference, then a share table per banded or outcome indicator", () => {
    const indicators = (average: number, kom: number, rest: number | null) => [
      {
        name: "idx", label: "Индекс", type: "number" as const, kind: "average" as const, sampleSize: 20, missing: 0,
        average, domainMin: 0, domainMax: 100, shares: [],
      },
      {
        name: "style", label: "Ведущий стиль", type: "string" as const, kind: "outcomes" as const, sampleSize: 20, missing: 0,
        average: null, domainMin: null, domainMax: null,
        shares: [
          { key: "kom", label: "Командный", count: 0, share: kom, color: "red", tone: null },
          ...(rest === null ? [] : [{ key: "__rest__", label: "Прочее", count: 0, share: rest, color: "grey", tone: null, rest: true }]),
        ],
      },
    ];
    render(<AnswersCompare
      slices={[{ ...HRBP, indicators: indicators(66.1, 42, null) }, { ...DUZ, indicators: indicators(58.4, 27, 5) }]}
      questions={QUESTIONS}
      minObservations={10}
    />);

    expect(screen.getByText("Показатели")).toBeInTheDocument();
    expect(screen.getByText("66,1 из 100")).toBeInTheDocument();
    expect(screen.getByText("58,4 из 100")).toBeInTheDocument();
    expect(screen.getByText("+7,7")).toBeInTheDocument();
    expect(screen.getByText("Ведущий стиль · исходы")).toBeInTheDocument();
    // An outcome one slice did not have is a zero there, not a gap: both slices hold values.
    const prochee = screen.getByText("Прочее").closest("tr")!;
    expect(within(prochee).getByText(/^0\s%$/)).toBeInTheDocument();
  });

  it("no indicators block when the slices carry none", () => {
    render(<AnswersCompare slices={[HRBP, DUZ]} questions={QUESTIONS} minObservations={10} />);

    expect(screen.queryByText("Показатели")).toBeNull();
  });

  it("срез ниже минимума наблюдений подписан и в расхождение не входит", () => {
    const thin = slice("s3", "Внешние", [90, 10], [90, 10], 6);
    render(<AnswersCompare slices={[HRBP, DUZ, thin]} questions={QUESTIONS} minObservations={10} />);

    expect(screen.getByText(/«Внешние»: ответов меньше минимума наблюдений \(10\)/)).toBeInTheDocument();
    // С «Внешними» размах был бы 58 п.п.; без них — 17.
    expect(screen.queryByText("58 п.п.")).toBeNull();
    expect(screen.getByText("17 п.п.")).toBeInTheDocument();
  });

  it("одного среза мало для сравнения", () => {
    render(<AnswersCompare slices={[HRBP]} questions={QUESTIONS} minObservations={10} />);
    expect(screen.getByText("Для сравнения нужны хотя бы два среза.")).toBeInTheDocument();
  });
});
