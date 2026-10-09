// @vitest-environment jsdom
/**
 * @module features/tests/editor/sections/__tests__/report-document-list
 *
 * PRD-51, задача 4 плана Э3 — СПИСОК БЛОКОВ ДОКУМЕНТА в карточке отчёта.
 *
 * Пиннится то, что отличает документ от обычного списка страниц и что легко потерять
 * правкой: системный блок ГАСИТСЯ, а не удаляется (FR-09); удаление предлагается только
 * странице и разрыву; опубликованный тест не редактируется; кнопка-вставка добавляет блок
 * НА СВОЁ место, а не в конец.
 *
 * Разметка взята из утверждённого эскиза `docs/wireframes/prd51-report-document.html`,
 * поэтому проверяются и классы строки: расхождение с эскизом — дефект, а не свобода.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ReportDocumentList, type ReportBlockVariantOption } from "../report-document-list";
import type { DraftBlock } from "../../use-report-document";

const blocks: DraftBlock[] = [
  { block: "header", templateKey: null, enabled: true, values: {}, settings: {} },
  { block: "summary", templateKey: null, enabled: false, values: {}, settings: {} },
  { block: "page-break", templateKey: null, enabled: true, values: {}, settings: {} },
  {
    block: "page",
    templateKey: "report.block.page.text",
    enabled: true,
    values: { title: "О тесте" },
    settings: {},
  },
];

/** Варианты активного шаблона: у тем их два — значит «Сменить вариант» имеет смысл. */
const variants: ReportBlockVariantOption[] = [
  { key: "report.block.header", block: "header", label: "Тёмная карточка", isDefault: true },
  { key: "report.block.summary", block: "summary", label: "Кольцо", isDefault: true },
  { key: "report.block.page.text", block: "page", label: "Заголовок и текст", isDefault: true },
  { key: "report.block.page.columns", block: "page", label: "Три колонки" },
];

let onChange: ReturnType<typeof vi.fn>;
const lastDraft = () => onChange.mock.calls[0][0] as DraftBlock[];

beforeEach(() => {
  onChange = vi.fn();
});
afterEach(cleanup);

function renderList(over: Partial<React.ComponentProps<typeof ReportDocumentList>> = {}) {
  return render(
    <ReportDocumentList
      blocks={blocks}
      variants={variants}
      onChange={onChange as unknown as (next: DraftBlock[]) => void}
      onAdd={vi.fn()}
      {...over}
    />,
  );
}

describe("список блоков документа", () => {
  it("называет системный блок подписью из реестра продукта", () => {
    renderList();
    expect(screen.getByText("Шапка документа")).toBeInTheDocument();
    expect(screen.getByText("Сводка баллов")).toBeInTheDocument();
  });

  it("показывает бейдж варианта, заголовок страницы и разрыв листа", () => {
    renderList();
    expect(screen.getByText("Тёмная карточка")).toBeInTheDocument();
    expect(screen.getByText("О тесте")).toBeInTheDocument();
    expect(screen.getByText("Разрыв листа")).toBeInTheDocument();
  });

  it("гасит системный блок тумблером, НЕ удаляя строку", () => {
    renderList();
    fireEvent.click(screen.getByLabelText("Показывать блок «Шапка документа»"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastDraft()).toHaveLength(blocks.length);
    expect(lastDraft()[0].enabled).toBe(false);
  });

  it("оставляет выключенный блок в списке и метит строку", () => {
    const { container } = renderList();
    expect(screen.getByText("Сводка баллов")).toBeInTheDocument();
    expect(container.querySelector('[data-block="summary"]')?.className).toContain("is-off");
  });

  it("не предлагает удалить системный блок — его выключают", () => {
    renderList();
    fireEvent.click(screen.getByTestId("report-document-actions-0"));
    expect(screen.queryByTestId("report-document-delete-0")).toBeNull();
  });

  it("удаляет разрыв листа одной кнопкой: подтверждать там нечего", () => {
    renderList();
    fireEvent.click(screen.getByLabelText("Удалить разрыв листа"));
    expect(lastDraft().map((b) => b.block)).toEqual(["header", "summary", "page"]);
  });

  it("удаляет страницу с содержимым ТОЛЬКО после подтверждения", () => {
    renderList();
    fireEvent.click(screen.getByTestId("report-document-actions-3"));
    fireEvent.click(screen.getByTestId("report-document-delete-3"));
    // Меню закрылось, строка спросила — до ответа документ не тронут.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("report-document-delete-confirm-3"));
    expect(lastDraft().map((b) => b.block)).toEqual(["header", "summary", "page-break"]);
  });

  it("зовёт смену варианта, когда вариантов больше одного", () => {
    const onReplaceVariant = vi.fn();
    renderList({ onReplaceVariant });
    fireEvent.click(screen.getByTestId("report-document-actions-3"));
    fireEvent.click(screen.getByTestId("report-document-replace-3"));
    expect(onReplaceVariant).toHaveBeenCalledWith(3);
  });

  it("кнопка-вставка стоит между строками и добавляет НА ЭТО место", () => {
    const onAdd = vi.fn();
    renderList({ onAdd });
    const inserts = screen.getAllByText("Добавить блок");
    // Вставок на одну больше, чем строк: перед первой, между всеми и после последней.
    expect(inserts).toHaveLength(blocks.length + 1);
    fireEvent.click(inserts[1]);
    expect(onAdd).toHaveBeenCalledWith(1);
  });

  it("опубликованный тест не редактируется, но читается и смотрится", () => {
    renderList({ readOnly: true, onPreview: vi.fn() });
    expect(screen.queryByText("Добавить блок")).toBeNull();
    expect(screen.queryByLabelText("Удалить разрыв листа")).toBeNull();
    expect(screen.queryByLabelText("Показывать блок «Шапка документа»")).toBeNull();
    expect(screen.queryByTestId("report-document-grip-0")).toBeNull();
    expect(screen.getByText("Шапка документа")).toBeInTheDocument();
    expect(screen.getByLabelText("Предпросмотр блока «О тесте»")).toBeInTheDocument();
  });

  it("несёт разметку утверждённого эскиза", () => {
    const { container } = renderList();
    expect(container.querySelector(".zone-block")).not.toBeNull();
    expect(container.querySelectorAll(".page-row")).toHaveLength(blocks.length);
    expect(container.querySelectorAll(".drag-handle")).toHaveLength(blocks.length);
    expect(container.querySelectorAll(".insert-row")).toHaveLength(blocks.length + 1);
    expect(container.querySelector(".page-row--break")).not.toBeNull();
    // У разрыва листа ни бейджа варианта, ни тега природы: он не раскладка.
    const brk = container.querySelector('[data-block="page-break"]')!;
    expect(brk.querySelector(".page-variant-badge")).toBeNull();
  });

  it("метит блок, дописанный шаблоном после сборки документа", () => {
    renderList({
      blocks: [
        { block: "breakdown", templateKey: null, enabled: false, values: {}, settings: {}, appended: true },
      ],
      variants: [{ key: "v.breakdown", block: "breakdown", label: "Полосы", isDefault: true }],
    });
    expect(screen.getByTestId("report-document-appended-0")).toHaveTextContent("Добавлен шаблоном");
  });

  it("подсказывает, что вводный текст правится не здесь", () => {
    renderList({
      blocks: [{ block: "intro", templateKey: null, enabled: true, values: {}, settings: {} }],
    });
    expect(screen.getByTestId("report-document-intro-hint-0")).toHaveTextContent(
      "Текст задаётся в подразделе «Обратная связь»",
    );
  });
});
