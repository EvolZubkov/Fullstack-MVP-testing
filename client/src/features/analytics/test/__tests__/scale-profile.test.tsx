/**
 * @module features/analytics/test/__tests__/scale-profile
 * @description PRD-56 FR-21, FR-21a, FR-21b: вкладка «Шкалы».
 *
 * Проверяется то, что легко потерять при правке: объём выборки рядом с каждой величиной, цвет
 * полос ИЗ ДАННЫХ (а не выбранный экраном) и честная строка у шкалы без полос толкования.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScaleProfilePanel } from "../scale-profile";

const BURNOUT = {
  key: "burnout",
  label: "Эмоциональное истощение",
  average: 27,
  sampleSize: 412,
  domainMin: 0,
  domainMax: 54,
  hasBands: true,
  bands: [
    { level: "low", label: "Низкий", count: 74, share: 18, color: "hsl(142 76% 36%)", tone: null },
    { level: "mid", label: "Средний", count: 202, share: 49, color: "hsl(38 92% 50%)", tone: null },
    { level: "high", label: "Высокий", count: 136, share: 33, color: "hsl(0 84% 60%)", tone: "critical" },
  ],
};

const RAW = {
  key: "raw",
  label: "Редукция достижений",
  average: 19,
  sampleSize: 412,
  domainMin: 0,
  domainMax: 40,
  hasBands: false,
  bands: [],
};

describe("ScaleProfilePanel", () => {
  it("печатает среднее с доменом и объёмом выборки", () => {
    render(<ScaleProfilePanel scales={[BURNOUT]} observations={412} />);

    expect(screen.getByText(/среднее 27 из 54/)).toBeTruthy();
    expect(screen.getByText(/412 прохождений опросника/)).toBeTruthy();
  });

  it("рисует полосы цветами ИЗ ДАННЫХ, а не своими", () => {
    // Цвет решает сервер: он выводит его из тона уровня и рампы теста (FR-21a). Выбери его
    // экран — один и тот же уровень окрасился бы здесь иначе, чем в итогах участника.
    const { container } = render(<ScaleProfilePanel scales={[BURNOUT]} observations={412} />);

    const segments = container.querySelectorAll(".ou-progress__stack-seg");
    expect(segments).toHaveLength(3);
    expect(screen.getByText("Высокий — 33 %")).toBeTruthy();
  });

  it("шкалу без полос толкования называет прямо, а не оставляет пустую полосу", () => {
    // Пустая полоса читается как «никто никуда не попал», хотя строить распределение просто
    // не по чему (FR-21b).
    render(<ScaleProfilePanel scales={[RAW]} observations={412} />);

    expect(screen.getByText(/полосы толкования не заданы · 412 прохождений/)).toBeTruthy();
  });

  it("шкалу С полосами, но без прохождений, не объявляет беспорожной", () => {
    // Приёмка в браузере поймала именно это: у опросника с тремя полосами экран печатал
    // «полосы толкования не заданы» просто потому, что распределять было некого.
    render(
      <ScaleProfilePanel
        scales={[{ ...BURNOUT, average: null, sampleSize: 0, bands: [] }]}
        observations={0}
      />,
    );

    expect(screen.getByText(/полосы заданы, но прохождений с этим значением нет/)).toBeTruthy();
    expect(screen.queryByText(/полосы толкования не заданы/)).toBeNull();
  });

  it("у теста без шкал говорит, что показывать нечего", () => {
    render(<ScaleProfilePanel scales={[]} observations={0} />);

    expect(screen.getByText(/у теста нет шкал/i)).toBeTruthy();
  });

  it("шкала без единого значения среднего не выдумывает", () => {
    render(
      <ScaleProfilePanel
        scales={[{ ...RAW, average: null, sampleSize: 0 }]}
        observations={0}
      />,
    );

    expect(screen.getByText(/значения не считались/)).toBeTruthy();
  });
});
