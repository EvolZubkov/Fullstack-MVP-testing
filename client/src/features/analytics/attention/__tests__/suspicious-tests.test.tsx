/**
 * @module features/analytics/attention/__tests__/suspicious-tests.test
 * @description Э3.4: корзина «Тесты с вопросами под подозрением».
 *
 * Строка — тест с числом «N из M» и объёмом; «Открыть» ведёт на уровень теста; без строк корзины
 * нет вовсе; время расчёта названо — число из фонового пересчёта.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SuspiciousTests } from "../suspicious-tests";

const today = new Date();
today.setHours(10, 42, 0, 0);

describe("SuspiciousTests", () => {
  it("называет тесты с числом под подозрением и ведёт на уровень теста", async () => {
    const onOpen = vi.fn();
    render(
      <SuspiciousTests
        onOpen={onOpen}
        rows={[
          { testId: "t1", title: "Сертификация руководителей", count: 8, items: 42, passages: 486, computedAt: today.toISOString() },
          { testId: "t2", title: "Охрана труда", count: 2, items: 30, passages: 212, computedAt: today.toISOString() },
        ]}
      />,
    );

    expect(screen.getByText("2 теста · разбирать — на уровне теста · посчитано в 10:42")).toBeTruthy();
    expect(screen.getByText("8 вопросов из 42 под подозрением · 486 прохождений")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: /Открыть/ })[1]);
    expect(onOpen).toHaveBeenCalledWith("t2");
  });

  it("без тестов корзины нет", () => {
    const { container } = render(<SuspiciousTests rows={[]} onOpen={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
