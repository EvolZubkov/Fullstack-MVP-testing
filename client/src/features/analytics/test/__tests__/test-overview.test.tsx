/**
 * @module features/analytics/test/__tests__/test-overview
 * @description PRD-56 FR-13, FR-13a, FR-14a: блоки обзора теста.
 *
 * Три блока, и у каждого своё обещание читателю. Распределение показывает, как результаты
 * легли относительно порога, — и подпись обязана назвать сам порог, иначе цвет столбиков не с
 * чем соотнести. Таблица тем называет единицу счёта в каждой колонке: «Прошли тему» — про
 * прохождения, «Доля верных ответов» — про ответы, и путать их нельзя. Линия сдаваемости
 * молчит там, где судить было нечего, вместо того чтобы рисовать ноль.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PassTrend } from "../pass-trend";
import { ScoreDistribution, shareAxis } from "../score-distribution";
import { TopicBreakdown } from "../topic-breakdown";

const BUCKETS = [
  { label: "0–9", from: 0, to: 10, count: 1, share: 10, tone: "error" as const, holdsThreshold: false },
  { label: "70–79", from: 70, to: 80, count: 4, share: 40, tone: "warning" as const, holdsThreshold: true },
  { label: "80–89", from: 80, to: 90, count: 5, share: 50, tone: "success" as const, holdsThreshold: false },
];

describe("ScoreDistribution", () => {
  it("называет объём выборки и проходной балл", () => {
    render(<ScoreDistribution buckets={BUCKETS} completed={10} thresholdPercent={75} />);

    expect(screen.getByText(/10 завершённых прохождений/)).toBeTruthy();
    expect(screen.getByText(/проходной балл 75 %/)).toBeTruthy();
  });

  it("говорит, что порога нет, а не молчит о нём", () => {
    // Молчание читается как «порог просто не поместился»: одноцветные столбики без подписи
    // выглядят сломанной диаграммой, а не опросником, который ничего не оценивает.
    render(<ScoreDistribution buckets={BUCKETS} completed={10} thresholdPercent={null} />);

    expect(screen.getByText(/проходного балла нет/i)).toBeTruthy();
  });

  it("объясняет пустую сетку там, где результата в процентах нет", () => {
    // Адаптивный тест судят достигнутые уровни: процента у прохождения может не быть вовсе.
    // Пустые столбики под подписью «10 завершённых прохождений» читаются как поломка.
    render(
      <ScoreDistribution
        buckets={BUCKETS.map(b => ({ ...b, count: 0, share: 0 }))}
        completed={10}
        thresholdPercent={null}
      />,
    );

    expect(screen.getByText(/результата в процентах/i)).toBeTruthy();
  });

  it("на пустой выборке говорит, что прохождений нет", () => {
    render(
      <ScoreDistribution
        buckets={BUCKETS.map(b => ({ ...b, count: 0, share: 0 }))}
        completed={0}
        thresholdPercent={70}
      />,
    );

    expect(screen.getByText(/Прохождений пока нет/i)).toBeTruthy();
  });
});

const TOPICS = [
  {
    topicId: "t1", topicName: "Право и комплаенс",
    passedShare: 64, correctShare: 71, thresholdPercent: 70, inSample: 486,
    subtopics: [
      { name: "Антикоррупция", passedShare: 58, correctShare: 63, thresholdPercent: 70, inSample: 240 },
    ],
  },
  {
    topicId: "t2", topicName: "Опросник",
    passedShare: null, correctShare: null, thresholdPercent: null, inSample: 12,
    subtopics: [],
  },
];

describe("TopicBreakdown", () => {
  it("называет единицу счёта в каждой колонке", () => {
    render(<TopicBreakdown topics={TOPICS} />);

    // FR-14a: без единицы счёта «64 %» и «71 %» читаются как одно и то же число,
    // посчитанное дважды с разной точностью.
    expect(screen.getByText("Прошли тему, % прохождений")).toBeTruthy();
    expect(screen.getByText("Доля верных, % ответов")).toBeTruthy();
    expect(screen.getByText("В выборке, прохождений")).toBeTruthy();
  });

  it("не показывает колонки «вердикт»", () => {
    render(<TopicBreakdown topics={TOPICS} />);

    expect(screen.queryByText(/вердикт/i)).toBeNull();
  });

  it("показывает подтему отдельной строкой под её темой", () => {
    render(<TopicBreakdown topics={TOPICS} />);

    expect(screen.getByText("Антикоррупция")).toBeTruthy();
  });

  it("печатает прочерк там, где порога и исхода нет", () => {
    render(<TopicBreakdown topics={[TOPICS[1]]} />);

    const row = screen.getByText("Опросник").closest("tr")!;
    // Ноль здесь означал бы «никто не справился», а справляться было не с чем.
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});

describe("PassTrend", () => {
  it("подписывает месяцы и их объём", () => {
    render(<PassTrend points={[
      { key: "2026-08", label: "август 2026", attempts: 54, judged: 54, passRate: 74 },
      { key: "2026-09", label: "сентябрь 2026", attempts: 46, judged: 46, passRate: 86 },
    ]} />);

    expect(screen.getByText(/август · 54/)).toBeTruthy();
    expect(screen.getByText(/сентябрь · 46/)).toBeTruthy();
  });

  it("не рисует линии, когда судить было нечего", () => {
    // У опросника вердиктов нет вовсе: линия «ноль процентов сдали» — это утверждение о
    // провале там, где никого не оценивали.
    render(<PassTrend points={[
      { key: "2026-09", label: "сентябрь 2026", attempts: 12, judged: 0, passRate: null },
    ]} />);

    expect(screen.getByText(/вердиктов не выносили/i)).toBeTruthy();
  });
});

/**
 * План сверки 5.9: деления оси долей — целые проценты. Четыре равных шага от 37 % давали
 * 9,25 / 18,5 / 27,75, и подписи обрезались левым полем диаграммы.
 */
describe("shareAxis — круглые деления оси", () => {
  it("при 37 % — шаг 10, верх 50: над столбиком остаётся место для подписи", () => {
    expect(shareAxis(37)).toEqual({ max: 50, ticks: [0, 10, 20, 30, 40, 50] });
  });

  it("верх оси не ниже самого высокого столбика плюс полшага", () => {
    for (const top of [4, 12, 22, 37, 44, 58, 81]) {
      const { max, ticks } = shareAxis(top);
      const step = ticks[1] - ticks[0];
      expect(max - top).toBeGreaterThanOrEqual(step / 2);
    }
  });

  it("низкие столбики — шаг 5", () => {
    expect(shareAxis(12)).toEqual({ max: 15, ticks: [0, 5, 10, 15] });
    expect(shareAxis(8)).toEqual({ max: 15, ticks: [0, 5, 10, 15] });
  });

  it("высокие — шаг 20 и не выше 100 %", () => {
    expect(shareAxis(97)).toEqual({ max: 100, ticks: [0, 20, 40, 60, 80, 100] });
  });

  it("все деления — целые числа", () => {
    for (const top of [1, 7, 23, 37, 49, 51, 66, 100]) {
      expect(shareAxis(top).ticks.every(Number.isInteger)).toBe(true);
    }
  });
});
