/**
 * @module features/analytics/test/__tests__/indicator-profile
 * @description PRD-56 FR-21c - FR-21e: the «Показатели» card of the «Шкалы и показатели» tab.
 *
 * What is easy to lose in an edit: the sample size next to every value and the honest
 * «не передано» for runs without a value. Colours are pinned by the server summary's tests: the
 * kit renders them into generated classes, out of reach of a DOM assertion.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IndicatorProfilePanel, type IndicatorProfileView } from "../indicator-profile";

const INDEX: IndicatorProfileView = {
  name: "idx",
  label: "Индекс человекоцентричности",
  type: "number",
  kind: "bands",
  sampleSize: 380,
  missing: 32,
  average: 64.24,
  domainMin: 0,
  domainMax: 100,
  histogram: [],
  shares: [
    { key: "dev", label: "Зона развития", count: 34, share: 9, color: "hsl(0 84% 60%)", tone: null },
    { key: "strong", label: "Сильная сторона", count: 346, share: 91, color: "hsl(142 76% 36%)", tone: null },
  ],
};

const SPREAD: IndicatorProfileView = {
  name: "spread",
  label: "Разброс стилей",
  type: "number",
  kind: "average",
  sampleSize: 412,
  missing: 0,
  average: 6.8,
  domainMin: 0,
  domainMax: 28,
  shares: [],
  histogram: [
    { label: "0–2", from: 0, to: 2, count: 37, share: 9 },
    { label: "3–5", from: 3, to: 5, count: 99, share: 24 },
    { label: "27–28", from: 27, to: 28, count: 0, share: 0 },
  ],
};

const STYLE: IndicatorProfileView = {
  name: "style",
  label: "Ведущий стиль",
  type: "string",
  kind: "outcomes",
  sampleSize: 412,
  missing: 0,
  average: null,
  domainMin: null,
  domainMax: null,
  histogram: [],
  shares: [
    { key: "kom", label: "Командный", count: 140, share: 34, color: "hsl(257.9 71.3% 65.9%)", tone: null },
    { key: "__rest__", label: "Прочее", count: 21, share: 5, color: "var(--ou-border-strong)", tone: null, rest: true },
  ],
};

const EMPTY: IndicatorProfileView = {
  ...STYLE,
  name: "reserve",
  label: "Рекомендован в кадровый резерв",
  sampleSize: 0,
  missing: 120,
  shares: [],
};

describe("IndicatorProfilePanel", () => {
  it("prints the average with its domain, the sample size and the runs without a value", () => {
    render(<IndicatorProfilePanel indicators={[INDEX]} observations={412} />);

    expect(screen.getByText("Показатели")).toBeTruthy();
    expect(screen.getByText("Индекс человекоцентричности")).toBeTruthy();
    expect(screen.getByText("среднее 64,2 из 100 · 380 прохождений · у 32 не передано")).toBeTruthy();
    expect(screen.getByText("Зона развития")).toBeTruthy();
  });

  it("says nothing about missing values when every run holds one", () => {
    render(<IndicatorProfilePanel indicators={[SPREAD]} observations={412} />);

    expect(screen.getByText("среднее 6,8 из 28 · 412 прохождений")).toBeTruthy();
    // The histogram replaces the bare average: intervals on the axis, shares over the bars.
    expect(screen.getByText("3–5")).toBeTruthy();
    expect(screen.getByText(/^24\s%$/)).toBeTruthy();
  });

  it("shows outcome shares with the count of outcomes, «Прочее» included in the legend", () => {
    render(<IndicatorProfilePanel indicators={[STYLE]} observations={412} />);

    expect(screen.getByText("412 прохождений · 1 исход")).toBeTruthy();
    // A row per outcome, like «Профиль по шкалам»: label and share in the bar's header.
    expect(screen.getByText("Командный")).toBeTruthy();
    expect(screen.getByText("Прочее")).toBeTruthy();
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });

  it("an indicator no run reported gets a muted line instead of an empty bar", () => {
    render(<IndicatorProfilePanel indicators={[EMPTY]} observations={120} />);

    expect(screen.getByText("не передано ни в одном из 120 прохождений")).toBeTruthy();
  });

  it("an empty selection says so instead of «не передано ни в одном из 0»", () => {
    render(<IndicatorProfilePanel indicators={[{ ...EMPTY, missing: 0 }]} observations={0} />);

    expect(screen.getByText("в выборке нет прохождений")).toBeTruthy();
    expect(screen.queryByText(/не передано/)).toBeNull();
  });

  it("an average without a domain still gets its histogram, the caption names no maximum", () => {
    render(<IndicatorProfilePanel indicators={[{ ...SPREAD, domainMin: null, domainMax: null }]} observations={412} />);

    expect(screen.getByText("среднее 6,8 · 412 прохождений")).toBeTruthy();
    expect(screen.getByText("0–2")).toBeTruthy();
  });
});
