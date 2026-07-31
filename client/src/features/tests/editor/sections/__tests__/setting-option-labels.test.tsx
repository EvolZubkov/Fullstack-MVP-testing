import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingControl } from "../start-pages-section";

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
