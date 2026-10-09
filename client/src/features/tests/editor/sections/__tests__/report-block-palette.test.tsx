// @vitest-environment jsdom
/**
 * @module features/tests/editor/sections/__tests__/report-block-palette
 *
 * PRD-51, задача 5 плана Э3 — ПАЛИТРА ДОБАВЛЕНИЯ БЛОКА (FR-16).
 *
 * Три группы эскиза `s-add-palette` и правило, которое легко потерять: группа без единого
 * элемента НЕ рисуется — пустой заголовок «Удалённые из документа» сообщал бы, что что-то
 * удалено, когда удалено ничего.
 *
 * Второе, что здесь пиннится: блок встаёт НА МЕСТО, откуда его добавляли. Палитра
 * открывается кнопкой-вставкой между строками, и добавление в конец списка означало бы,
 * что автор промахнулся мимо места, которое сам же выбрал.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ReportBlockPalette } from "../report-block-palette";
import type { ReportBlockVariantOption } from "../report-document-list";

const pageVariants: ReportBlockVariantOption[] = [
  { key: "v.page.text", block: "page", label: "Заголовок и текст", isDefault: true },
  { key: "v.page.cols", block: "page", label: "Три колонки" },
];

function renderPalette(over: Partial<React.ComponentProps<typeof ReportBlockPalette>> = {}) {
  const onPick = vi.fn();
  const utils = render(
    <ReportBlockPalette
      open
      onClose={vi.fn()}
      onPick={onPick}
      variants={pageVariants}
      documentBlocks={["header", "summary"]}
      {...over}
    />,
  );
  return { ...utils, onPick };
}

afterEach(cleanup);

describe("палитра блоков документа", () => {
  it("предлагает варианты страниц активного шаблона", () => {
    renderPalette();
    expect(screen.getByText("Страницы")).toBeInTheDocument();
    expect(screen.getByText("Заголовок и текст")).toBeInTheDocument();
    expect(screen.getByText("Три колонки")).toBeInTheDocument();
  });

  it("предлагает разрыв листа в служебной группе", () => {
    renderPalette();
    expect(screen.getByText("Служебное")).toBeInTheDocument();
    expect(screen.getByText("Разрыв листа")).toBeInTheDocument();
  });

  it("возвращает в документ системный блок, которого в нём нет", () => {
    renderPalette();
    expect(screen.getByText("Удалённые из документа")).toBeInTheDocument();
    // «Шапка» и «Сводка» в документе есть — их в палитре быть не должно.
    expect(screen.queryByText("Шапка документа")).toBeNull();
    expect(screen.getByText("Результаты по темам")).toBeInTheDocument();
  });

  it("не рисует группу, в которой нечего предложить", () => {
    renderPalette({ variants: [] });
    expect(screen.queryByText("Страницы")).toBeNull();
    expect(screen.getByText("Служебное")).toBeInTheDocument();
  });

  it("отдаёт выбранную страницу с её вариантом", () => {
    const { onPick } = renderPalette();
    fireEvent.click(screen.getByTestId("report-palette-option-v.page.cols"));
    fireEvent.click(screen.getByTestId("report-palette-add"));
    expect(onPick).toHaveBeenCalledWith({
      block: "page",
      templateKey: "v.page.cols",
      enabled: true,
      values: {},
      settings: {},
    });
  });

  it("отдаёт разрыв листа без варианта: раскладки у него нет", () => {
    const { onPick } = renderPalette();
    fireEvent.click(screen.getByTestId("report-palette-option-page-break"));
    fireEvent.click(screen.getByTestId("report-palette-add"));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ block: "page-break", templateKey: null }),
    );
  });

  it("возвращает системный блок ВКЛЮЧЁННЫМ: его вернули, чтобы он печатался", () => {
    const { onPick } = renderPalette();
    fireEvent.click(screen.getByTestId("report-palette-option-topics"));
    fireEvent.click(screen.getByTestId("report-palette-add"));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ block: "topics", templateKey: null, enabled: true }),
    );
  });

  it("не даёт добавить, пока ничего не выбрано", () => {
    renderPalette();
    expect(screen.getByTestId("report-palette-add")).toBeDisabled();
  });

  it("ищет по названию блока", () => {
    renderPalette();
    fireEvent.change(screen.getByLabelText("Поиск блока"), { target: { value: "колон" } });
    expect(screen.getByText("Три колонки")).toBeInTheDocument();
    expect(screen.queryByText("Заголовок и текст")).toBeNull();
    // Опустевшая группа исчезает вместе со своим заголовком.
    expect(screen.queryByText("Служебное")).toBeNull();
  });

  it("говорит, когда поиск не нашёл ничего", () => {
    renderPalette();
    fireEvent.change(screen.getByLabelText("Поиск блока"), { target: { value: "ыыы" } });
    expect(screen.getByTestId("report-palette-empty")).toBeInTheDocument();
  });

  it("схема блока появляется только после выбора и зависит от блока", () => {
    renderPalette();
    // Пока не выбрано, правая колонка зовёт выбрать, а не показывает пустой лист.
    expect(screen.getByTestId("report-palette-preview-empty")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("report-palette-option-topics"));
    const sheet = screen.getByTestId("report-palette-preview");
    expect(sheet).toHaveAttribute("aria-label", "Схема блока «Результаты по темам»");
    // «Результаты по темам» — таблица: заголовок и крупный блок.
    expect(sheet.querySelectorAll(".tb-sheet__block")).toHaveLength(1);

    // Разрыв листа — единственный блок, который лист не заполняет, а делит.
    fireEvent.click(screen.getByTestId("report-palette-option-page-break"));
    expect(screen.getByTestId("report-palette-preview").querySelector(".tb-sheet__break")).not.toBeNull();
  });
});
