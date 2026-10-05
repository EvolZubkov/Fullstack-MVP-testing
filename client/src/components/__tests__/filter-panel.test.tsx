/**
 * @module client/src/components/__tests__/filter-panel
 * @description PRD-70 FR-70 - FR-77: the one filter form — `FilterBar` and the `FilterPanel` that
 * opens under its «Фильтр» button.
 *
 * The panel applies only on «Применить»; closing it any other way (outside click, `Esc`, the
 * button again) drops the draft, so there is no «Отмена». Focus goes to the first field on open
 * and back to the button on close.
 *
 * Лежит в `client/src`, а не в `tests/`: `vitest` берёт из `tests` только `.ts`, а тест
 * компонента написан с JSX.
 */
import { useRef, useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "../../../../vendor/ui-kit/src/components/Checkbox";
import { FilterBar } from "../../../../vendor/ui-kit/src/components/FilterBar";
import { FilterPanel, FilterPanelGroup } from "../../../../vendor/ui-kit/src/components/FilterPanel";

/** A list screen in miniature: applied conditions, a draft and the bar with its panel. */
function Host({ onApplied }: { onApplied?: (value: string[]) => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>([]);
  const toggle = (value: string) =>
    setDraft((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  const openPanel = () => {
    setDraft(applied);
    setOpen((value) => !value);
  };
  return (
    <>
      <FilterBar
        count={applied.length}
        applied={applied.map((value) => ({ id: value, label: `Статус: ${value}` }))}
        filterButtonRef={buttonRef}
        filterOpen={open}
        onOpenFilter={openPanel}
        onReset={() => setApplied([])}
      />
      <FilterPanel
        open={open}
        anchorRef={buttonRef}
        onClose={() => setOpen(false)}
        onReset={() => setDraft([])}
        onApply={() => {
          setApplied(draft);
          onApplied?.(draft);
          setOpen(false);
        }}
      >
        <FilterPanelGroup title="Статус" inline>
          <Checkbox label="черновик" checked={draft.includes("черновик")} onChange={() => toggle("черновик")} />
          <Checkbox label="опубликован" checked={draft.includes("опубликован")} onChange={() => toggle("опубликован")} />
        </FilterPanelGroup>
      </FilterPanel>
    </>
  );
}

describe("FilterPanel", () => {
  it("opens under the button as a labelled dialog with groups and the two-button footer", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const button = screen.getByRole("button", { name: "Фильтр" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);

    const panel = screen.getByRole("dialog", { name: "Фильтр" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveClass("ou-popover--xl", "ou-popover--no-arrow", "ou-filterpanel");
    expect(within(panel).getByRole("group", { name: "Статус" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Сбросить" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Применить" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Отмена" })).toBeNull();
    expect(panel.querySelector(".ou-popover__footer")).toHaveClass("ou-popover__footer--between");
  });

  it("moves focus to the first field on open", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Фильтр" }));

    expect(screen.getByRole("checkbox", { name: "черновик" })).toHaveFocus();
  });

  it("applies only on «Применить»: the chip appears after it, not after ticking", async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn();
    render(<Host onApplied={onApplied} />);
    await user.click(screen.getByRole("button", { name: "Фильтр" }));
    await user.click(screen.getByRole("checkbox", { name: "опубликован" }));

    expect(screen.queryByText("Статус: опубликован")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Применить" }));

    expect(onApplied).toHaveBeenCalledWith(["опубликован"]);
    expect(screen.getByText("Статус: опубликован")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc closes without applying and returns focus to the button", async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn();
    render(<Host onApplied={onApplied} />);
    const button = screen.getByRole("button", { name: "Фильтр" });
    await user.click(button);
    await user.click(screen.getByRole("checkbox", { name: "черновик" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.queryByText("Статус: черновик")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("the button again closes the panel and drops the draft", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const button = screen.getByRole("button", { name: "Фильтр" });
    await user.click(button);
    await user.click(screen.getByRole("checkbox", { name: "черновик" }));
    await user.click(button);

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(button);
    expect(screen.getByRole("checkbox", { name: "черновик" })).not.toBeChecked();
  });

  it("«Сбросить» clears the draft and keeps the panel open", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Фильтр" }));
    await user.click(screen.getByRole("checkbox", { name: "черновик" }));
    await user.click(screen.getByRole("button", { name: "Сбросить" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "черновик" })).not.toBeChecked();
  });
});
