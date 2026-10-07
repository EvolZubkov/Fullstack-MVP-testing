/**
 * @module features/analytics/registry/__tests__/filter-panel
 * @description PRD-56 FR-02: условия отбора реестра — панелью под кнопкой «Фильтр» (PRD-70 FR-71).
 *
 * Условия задаются целиком в одной панели и применяются разом: набор из пяти полей, меняемых по
 * одному прямо в списке, заставлял бы перезапрашивать выборку на каждый щелчок.
 */
import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RegistryFilterPanel, type RegistryFilterPanelProps } from "../filter-panel";

/** The panel under its «Фильтр» button, as the screens mount it. */
function Panel(props: Omit<RegistryFilterPanelProps, "anchorRef">) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef} type="button">Фильтр</button>
      <RegistryFilterPanel {...props} anchorRef={anchorRef} />
    </>
  );
}

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

describe("RegistryFilterPanel", () => {
  it("применяет отмеченные условия разом, а не по одному", async () => {
    const onApply = vi.fn();
    render(<Panel open filter={EMPTY} onApply={onApply} onClose={() => {}} />);

    await userEvent.click(await screen.findByLabelText("Импорт"));
    await userEvent.click(screen.getByLabelText("Не сдал"));
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ["import"], outcomes: ["failed"] }),
    );
  });

  it("не трогает условия, если панель закрыли без «Применить» — отмены отдельной кнопкой нет", async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<Panel open filter={EMPTY} onApply={onApply} onClose={onClose} />);

    await userEvent.click(await screen.findByLabelText("Веб"));
    expect(screen.queryByRole("button", { name: "Отмена" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("показывает уже применённые условия отмеченными", async () => {
    render(
      <Panel
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
    render(<Panel open filter={EMPTY} onApply={onApply} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole("combobox", { name: "Подразделение" }));
    await userEvent.click(await screen.findByRole("option", { name: /Логистика/ }));
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ units: ["Логистика"] }));
  });

  it("показывает применённое оргзначение, даже если его написания нет в справочнике", async () => {
    // Значение пришло ссылкой в другом написании: сервер отберёт по нему, а панель обязана
    // показать его, иначе «Применить» молча сняло бы условие.
    const onApply = vi.fn();
    render(
      <Panel open filter={{ ...EMPTY, units: ["отдел продаж"] }} onApply={onApply} onClose={() => {}} />,
    );

    expect(await screen.findByText("отдел продаж")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ units: ["отдел продаж"] }));
  });

  it("сбрасывает все условия одной кнопкой", async () => {
    const onApply = vi.fn();
    render(
      <Panel
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

  describe("«Попытки» (PRD-66 FR-51, дельта 2026-10-07)", () => {
    it("без правила попыток группы нет — на «Обзоре» считаются все попытки", async () => {
      render(<Panel open filter={EMPTY} onApply={() => {}} onClose={() => {}} />);

      await screen.findByLabelText("Веб");
      expect(screen.queryByRole("radio")).toBeNull();
    });

    it("выбранное правило уходит одним значением вместе с остальными условиями", async () => {
      const onAttempts = vi.fn();
      render(
        <Panel
          open
          filter={EMPTY}
          onApply={() => {}}
          onClose={() => {}}
          attempts={{ value: "first", onApply: onAttempts }}
        />,
      );

      await userEvent.click(await screen.findByLabelText("Только последняя"));
      expect(screen.getByLabelText("Только первая")).not.toBeChecked();
      await userEvent.click(screen.getByRole("button", { name: "Применить" }));

      expect(onAttempts).toHaveBeenCalledWith("last");
    });

    it("у измерительного теста «Только лучшая» недоступна: общего балла нет", async () => {
      render(
        <Panel
          open
          filter={EMPTY}
          onApply={() => {}}
          onClose={() => {}}
          attempts={{ value: "first", onApply: () => {}, bestUnavailable: true }}
        />,
      );

      expect(await screen.findByLabelText("Только лучшая")).toBeDisabled();
      expect(screen.getByLabelText("Только последняя")).toBeEnabled();
    });
  });
});
