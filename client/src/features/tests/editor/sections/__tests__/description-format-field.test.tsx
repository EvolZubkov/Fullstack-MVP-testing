/**
 * @module features/tests/editor/sections/__tests__/description-format-field
 *
 * PRD-59 FR-05 - FR-09: поле «Описание» предлагает три режима ввода, хранит значение
 * простого режима ИСХОДНИКОМ и не склеивает абзацы при понижении режима.
 *
 * Проверяется композиция, которую подраздел «Основное» отдаёт компоненту, а не сам
 * компонент: связка `sourceMode` — единственное место, где политика разметки продукта
 * встречается с DS-контролом, и именно её потеря вернула бы дефект, ради которого
 * заведён FR-07 (значение простого режима приезжало экранированным, а переводы строк
 * при возврате из «Форматированного» терялись).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RichTextEditor } from "@skillum/ui-kit";
import { richTextToHtml, richTextToPlain } from "@shared/template/rich-text";

/** Ровно та композиция, что стоит в `basic-settings-section.tsx`. */
function Field(props: {
  value: string;
  mode: "plain" | "rich" | "html";
  onChange?: (v: string) => void;
}) {
  return (
    <RichTextEditor
      label="Описание"
      hint="Опишите цели теста и аудиторию"
      fullWidth
      rows={3}
      maxRows={10}
      value={props.value}
      mode={props.mode}
      modes={["plain", "rich", "html"]}
      sourceMode={{
        toMarkup: (text) => richTextToHtml(text, "plain"),
        toPlain: (html) => richTextToPlain(html, "richText"),
      }}
      onChange={props.onChange ?? (() => {})}
      onModeChange={() => {}}
      data-testid="settings-description-input"
    />
  );
}

describe("поле «Описание» с режимами ввода", () => {
  it("предлагает три режима в порядке спецификации", () => {
    render(<Field value="" mode="plain" />);
    expect(screen.getByTestId("settings-description-input-mode-plain")).toHaveTextContent(
      "Простой текст",
    );
    expect(screen.getByTestId("settings-description-input-mode-rich")).toHaveTextContent(
      "Форматированный",
    );
    expect(screen.getByTestId("settings-description-input-mode-html")).toHaveTextContent("HTML");
  });

  it("в простом режиме показывает исходник с настоящими переводами строк", () => {
    render(<Field value={"Первая\nВторая"} mode="plain" />);
    const area = screen.getByTestId("settings-description-input-input") as HTMLTextAreaElement;
    expect(area.value).toBe("Первая\nВторая");
  });

  it("при переходе в форматированный превращает переводы строк в разметку", () => {
    const onChange = vi.fn();
    render(<Field value={"Первая\nВторая"} mode="plain" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("settings-description-input-mode-rich"));
    expect(onChange).toHaveBeenCalledWith("Первая<br>Вторая");
  });

  it("при возврате в простой режим не склеивает абзацы", () => {
    const onChange = vi.fn();
    render(<Field value="<p>Первая</p><p>Вторая</p>" mode="rich" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("settings-description-input-mode-plain"));
    expect(onChange).toHaveBeenCalledWith("Первая\nВторая");
  });

  it("в режиме HTML показывает разметку текстом", () => {
    render(<Field value="<p>Курс</p>" mode="html" />);
    const area = screen.getByTestId("settings-description-input-input") as HTMLTextAreaElement;
    expect(area.value).toBe("<p>Курс</p>");
    expect(area.className).toContain("ou-rte__input--code");
  });

  it("ограничивает высоту поля и оставляет уголок растягивания (FR-05a)", () => {
    render(<Field value="" mode="plain" />);
    const area = screen.getByTestId("settings-description-input-input") as HTMLTextAreaElement;
    expect(area.style.maxHeight).toBe("16em");
  });

  it("показывает подсказку под полем — плейсхолдера у компонента нет", () => {
    render(<Field value="" mode="plain" />);
    expect(screen.getByText("Опишите цели теста и аудиторию")).toBeInTheDocument();
  });
});
