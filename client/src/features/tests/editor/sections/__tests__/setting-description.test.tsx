/**
 * @module features/tests/editor/sections/__tests__/setting-description.test
 * @description PRD-35: свойство страницы объясняет автору условие своей работы.
 *
 * Переключатель «Радар компетенций» не действует, пока видимых шкал меньше трёх
 * (PRD-35 §6). Перед учеником отказ молчаливый, но автор обязан понимать, почему
 * включённый переключатель ничего не изменил, — иначе это читается как дефект.
 * Текст приходит из манифеста, поэтому контрол лишь обязан его показать.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingControl } from "../start-pages-section";

function renderSetting(setting: Parameters<typeof SettingControl>[0]["setting"]) {
  render(
    <SettingControl
      setting={setting}
      value={true}
      onChange={() => {}}
      sequenceIds={[]}
      sequenceTotal={0}
      testId="s-1"
    />,
  );
}

describe("SettingControl: описание свойства", () => {
  it("показывает описание булева свойства", () => {
    renderSetting({
      key: "showCompetencyRadar",
      type: "boolean",
      label: "Радар компетенций",
      description: "Рисуется при трёх и более видимых шкалах.",
    });
    expect(screen.getByText("Радар компетенций")).toBeTruthy();
    expect(screen.getByText("Рисуется при трёх и более видимых шкалах.")).toBeTruthy();
  });

  it("без описания рисует только подпись", () => {
    renderSetting({ key: "showCompetencyRadar", type: "boolean", label: "Радар компетенций" });
    expect(screen.getByText("Радар компетенций")).toBeTruthy();
    expect(screen.queryByText(/Рисуется/)).toBeNull();
  });
});
