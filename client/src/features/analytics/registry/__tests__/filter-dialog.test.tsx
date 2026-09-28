/**
 * @module features/analytics/registry/__tests__/filter-dialog
 * @description PRD-56 FR-02: окно условий отбора реестра.
 *
 * Условия задаются целиком в одном окне и применяются разом: набор из пяти полей, меняемых по
 * одному прямо в списке, заставлял бы перезапрашивать выборку на каждый щелчок.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RegistryFilterDialog } from "../filter-dialog";

const EMPTY = { testIds: [], groupIds: [], formIds: [], snapshotIds: [], organizations: [], units: [], positions: [], sources: [], outcomes: [] };

const ORG_VALUES = {
  organization: [{ value: "АО «Ромашка»", users: 3, attempts: 0 }],
  unit: [
    { value: "Логистика", users: 2, attempts: 5 },
    { value: "Отдел продаж", users: 4, attempts: 40 },
  ],
  position: [],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => ({
    ok: true,
    json: async () => (String(input).includes("/api/groups")
      ? [{ id: "g1", name: "Отдел продаж" }]
      : String(input).includes("/api/analytics/org-values")
        ? ORG_VALUES
        : [{ id: "t1", title: "Сертификация руководителей" }]),
  })));
});

afterEach(() => vi.unstubAllGlobals());

describe("RegistryFilterDialog", () => {
  it("применяет отмеченные условия разом, а не по одному", async () => {
    const onApply = vi.fn();
    render(<RegistryFilterDialog open filter={EMPTY} onApply={onApply} onClose={() => {}} />);

    await userEvent.click(await screen.findByLabelText("Импорт"));
    await userEvent.click(screen.getByLabelText("Не сдал"));
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ["import"], outcomes: ["failed"] }),
    );
  });

  it("не трогает условия, если окно закрыли отменой", async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<RegistryFilterDialog open filter={EMPTY} onApply={onApply} onClose={onClose} />);

    await userEvent.click(await screen.findByLabelText("Веб"));
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("показывает уже применённые условия отмеченными", async () => {
    render(
      <RegistryFilterDialog
        open
        filter={{ ...EMPTY, sources: ["telemetry"], from: "2026-09-01" }}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );

    expect((await screen.findByLabelText("Телеметрия LMS")) as HTMLInputElement).toBeChecked();
    expect((screen.getByLabelText("Период с") as HTMLInputElement).value).toBe("2026-09-01");
  });

  it("отбирает по подразделению из справочника оргзначений (FR-06b)", async () => {
    const onApply = vi.fn();
    render(<RegistryFilterDialog open filter={EMPTY} onApply={onApply} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole("combobox", { name: "Подразделение" }));
    await userEvent.click(await screen.findByRole("option", { name: /Логистика/ }));
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ units: ["Логистика"] }));
  });

  it("показывает применённое оргзначение, даже если его написания нет в справочнике", async () => {
    // Значение пришло ссылкой в другом написании: сервер отберёт по нему, а окно обязано
    // показать его, иначе «Применить» молча сняло бы условие.
    const onApply = vi.fn();
    render(
      <RegistryFilterDialog open filter={{ ...EMPTY, units: ["отдел продаж"] }} onApply={onApply} onClose={() => {}} />,
    );

    expect(await screen.findByText("отдел продаж")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ units: ["отдел продаж"] }));
  });

  it("сбрасывает все условия одной кнопкой", async () => {
    const onApply = vi.fn();
    render(
      <RegistryFilterDialog
        open
        filter={{ ...EMPTY, sources: ["web"], outcomes: ["passed"] }}
        onApply={onApply}
        onClose={() => {}}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Сбросить" }));
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));

    expect(onApply).toHaveBeenCalledWith(EMPTY);
  });
});
