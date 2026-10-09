// @vitest-environment jsdom
/**
 * @module features/tests/editor/sections/__tests__/report-block-fields
 *
 * PRD-51, задача 5 плана Э3 — ПОЛЯ РАСКРЫТОЙ СТРОКИ страницы документа (FR-17, FR-05).
 *
 * Проверяется, что состав формы диктует ВАРИАНТ, правка уходит в значения именно этой
 * строки, а вариант без полей объясняется словами, а не пустой формой.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ReportBlockFields } from "../report-block-fields";
import type { DraftBlock } from "../../use-report-document";

const block: DraftBlock = {
  block: "page",
  templateKey: "v.page.text",
  enabled: true,
  values: { title: "О тесте" },
  settings: {},
};

const placeholders = [
  { key: "title", type: "text", label: "Заголовок", required: true },
  { key: "body", type: "textarea", label: "Текст" },
];

afterEach(cleanup);

describe("поля блока-страницы", () => {
  it("показывает поля варианта с их значениями", () => {
    render(
      <ReportBlockFields
        index={3}
        block={block}
        placeholders={placeholders as never}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("О тесте")).toBeInTheDocument();
    expect(screen.getByTestId("report-document-field-3-body")).toBeInTheDocument();
  });

  it("правка уходит в значения ЭТОЙ строки, не задевая остальных полей", () => {
    const onChange = vi.fn();
    render(
      <ReportBlockFields index={0} block={block} placeholders={placeholders as never} onChange={onChange} />,
    );
    fireEvent.change(screen.getByDisplayValue("О тесте"), { target: { value: "Как читать отчёт" } });
    const next = onChange.mock.calls[0][0] as DraftBlock;
    expect(next.values.title).toBe("Как читать отчёт");
    expect(next.templateKey).toBe("v.page.text");
  });

  it("вариант без полей объясняется словами, а не пустой формой", () => {
    render(<ReportBlockFields index={1} block={block} placeholders={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("report-document-edit-empty-1")).toBeInTheDocument();
    expect(screen.queryByTestId("report-document-edit-fields-1")).toBeNull();
  });

  it("опубликованный тест поля не правит", () => {
    render(
      <ReportBlockFields
        index={0}
        block={block}
        placeholders={placeholders as never}
        onChange={vi.fn()}
        readOnly
      />,
    );
    expect(screen.getByTestId("report-document-edit-fields-0")).toBeDisabled();
  });
});
