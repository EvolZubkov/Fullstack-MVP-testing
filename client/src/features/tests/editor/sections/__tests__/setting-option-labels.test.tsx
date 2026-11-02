import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingControl, selectShownValue } from "../start-pages-section";

const STUBS = { sequenceIds: [], sequenceTotal: 0, testId: "setting" };

describe("настройка страницы типа select", () => {
  it("показывает человекочитаемую подпись из optionLabels", () => {
    render(
      <SettingControl
        {...STUBS}
        setting={{
          key: "scales",
          type: "select",
          label: "Шкалы",
          options: ["auto", "show", "hide"],
          optionLabels: { auto: "Автоматически", show: "Показывать", hide: "Скрывать" },
        }}
        value="auto"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Автоматически")).toBeInTheDocument();
    expect(screen.queryByText("auto")).toBeNull();
  });

  it("падает обратно на значение, когда подписи не объявлены", () => {
    render(
      <SettingControl
        {...STUBS}
        setting={{ key: "mode", type: "select", label: "Режим", options: ["fast", "slow"] }}
        value="fast"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("fast")).toBeInTheDocument();
  });
});

describe("несохранённая настройка показывает умолчание манифеста (PRD-22 FR-45)", () => {
  const BAR = {
    key: "scoreBar",
    type: "select" as const,
    label: "Полоса балла",
    description: "Тонкая полоса под заголовком.",
    default: "summary",
    options: ["summary", "show", "hide"],
    optionLabels: { summary: "Как сводка", show: "Показывать", hide: "Скрывать" },
  };

  it("список без значения называет умолчание, а не «Выберите…», и ничего не пишет", () => {
    const onChange = vi.fn();
    render(<SettingControl {...STUBS} setting={BAR} value={undefined} onChange={onChange} />);
    expect(screen.getByText("Как сводка")).toBeInTheDocument();
    expect(screen.queryByText("Выберите…")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("сохранённое значение показывает себя", () => {
    render(<SettingControl {...STUBS} setting={BAR} value="hide" onChange={() => {}} />);
    expect(screen.getByText("Скрывать")).toBeInTheDocument();
  });

  it("под списком печатается пояснение из манифеста", () => {
    render(<SettingControl {...STUBS} setting={BAR} value={undefined} onChange={() => {}} />);
    expect(screen.getByText("Тонкая полоса под заголовком.")).toBeInTheDocument();
  });

  it("без умолчания или с умолчанием вне вариантов остаётся заглушка", () => {
    expect(selectShownValue({ ...BAR, default: undefined }, undefined)).toBe("");
    expect(selectShownValue({ ...BAR, default: "nope" }, "")).toBe("");
    render(<SettingControl {...STUBS} setting={{ ...BAR, default: undefined }} value={undefined} onChange={() => {}} />);
    expect(screen.getByText("Выберите…")).toBeInTheDocument();
  });

  it("число без значения показывает умолчание, а не ноль", () => {
    render(
      <SettingControl
        {...STUBS}
        setting={{ key: "cols", type: "number", label: "Колонок", default: 3 }}
        value={undefined}
        onChange={() => {}}
      />,
    );
    expect((screen.getByLabelText("Колонок") as HTMLInputElement).value).toBe("3");
  });
});
