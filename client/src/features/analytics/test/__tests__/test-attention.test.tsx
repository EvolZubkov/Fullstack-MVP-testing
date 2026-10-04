/**
 * @module features/analytics/test/__tests__/test-attention.test
 * @description Э3.4: блок «Требует внимания» на «Обзоре» теста.
 *
 * Сводка посчитанного: счётчики со строкой-объяснением, общий итог тегом, «Показать» ведёт в
 * нужный вид и выключено, когда смотреть нечего.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TestAttention } from "../test-attention";

describe("TestAttention", () => {
  it("показывает счётчики, итог и ведёт в вид; пустой вид не открывается", async () => {
    const showSuspicious = vi.fn();
    const showExcluded = vi.fn();
    render(
      <TestAttention
        questions={42}
        lines={[
          { key: "suspicious", title: "Вопросы под подозрением", count: 8, caption: "сильные ошибаются чаще", onShow: showSuspicious },
          { key: "excluded", title: "Исключены из выдачи", count: 0, caption: "не попадают в новые прохождения", onShow: showExcluded },
        ]}
      />,
    );

    expect(screen.getByText("Качество вопросов теста · 42 вопроса")).toBeTruthy();
    expect(screen.getByText("Вопросы под подозрением · 8")).toBeTruthy();
    expect(screen.getByText("8", { selector: ".ou-tag, .ou-tag *" })).toBeTruthy();
    const [first, second] = screen.getAllByRole("button", { name: /Показать/ });
    await userEvent.click(first);
    expect(showSuspicious).toHaveBeenCalled();
    expect(second).toBeDisabled();
  });

  it("пока психометрика считается — так и сказано", () => {
    render(<TestAttention questions={3} pending lines={[]} />);
    expect(screen.getByText("Качество вопросов теста · 3 вопроса · считаем психометрику…")).toBeTruthy();
  });
});
