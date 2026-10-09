/**
 * @module features/tests/editor/sections/__tests__/score-preview-modal.test
 * @description Tests for {@link ScorePreviewModal} — «Предпросмотр балла»
 * (PRD-10 §7, issue #31; wireframe prd15-test-scoring.html s-preview).
 *
 * The modal has no data dependencies: it takes the question key plus the DRAFT
 * scoring config, picks a demo answer and scores it with the product's own
 * engine. The tests therefore drive it directly and assert the numbers an author
 * reads — which row fired, s / sMax / scoreRatio and the verdict.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import type { QuestionScoring } from "@shared/schema";
import { ScorePreviewModal } from "../score-preview-modal";

/** «Всё верно» pays 2, «хоть что-то верно» pays 1, anything else falls to 0. */
const TIERED: QuestionScoring = {
  kind: "tiered",
  tiers: [
    { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 2 },
    { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }] }, score: 1 },
  ],
};

function renderModal(props: Partial<React.ComponentProps<typeof ScorePreviewModal>> = {}) {
  const onClose = vi.fn();
  render(
    <ScorePreviewModal
      type="multiple"
      options={["Москва", "Тула", "Пермь"]}
      correct={{ correctIndices: [0, 1] }}
      scoring={TIERED}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose };
}

/** Open the DS Select and click a demo answer by its label. */
function pickDemo(optionLabel: string | RegExp) {
  const wrap = screen.getByTestId("score-preview-answer");
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

/** Value cell of a labelled row of the preview table. */
function row(label: string): HTMLElement {
  const tr = screen.getByText(label).closest("tr");
  if (!tr) throw new Error(`row «${label}» not found`);
  return within(tr).getAllByRole("cell")[1];
}

describe("<ScorePreviewModal /> — ступенчатая цена", () => {
  it("scores the first demo answer (полностью верный) through the top tier", () => {
    renderModal();
    expect(row("Балл s")).toHaveTextContent("2");
    expect(row("sMax")).toHaveTextContent("2");
    expect(row("scoreRatio")).toHaveTextContent("1");
    expect(row("Сработала строка")).toHaveTextContent("1");
    expect(screen.getByTestId("score-preview-verdict")).toHaveTextContent("Правильно");
  });

  it("a partial demo answer drops to the second tier", () => {
    renderModal();
    pickDemo("Часть верных (Москва)");
    expect(row("Балл s")).toHaveTextContent("1");
    expect(row("scoreRatio")).toHaveTextContent("0.5");
    expect(row("Сработала строка")).toHaveTextContent("2");
    expect(screen.getByTestId("score-preview-verdict")).toHaveTextContent("Частично правильно");
  });

  it("reports the tallies behind the score", () => {
    renderModal();
    pickDemo("Все верные и лишний (Москва, Тула, Пермь)");
    expect(row("Ответ")).toHaveTextContent("c = 2, x = 1");
    expect(row("Эталон")).toHaveTextContent("T = 2");
  });

  it("an answer that matches no row falls through to «иначе → 0»", () => {
    renderModal();
    pickDemo("Только лишние (Пермь)");
    expect(row("Балл s")).toHaveTextContent("0");
    expect(row("Сработала строка")).toHaveTextContent("Иначе");
    expect(screen.getByTestId("score-preview-verdict")).toHaveTextContent("Неверно");
  });
});

describe("<ScorePreviewModal /> — прочие способы", () => {
  it("exact scoring has no step table, so no «Сработала строка» row", () => {
    renderModal({ scoring: null });
    expect(screen.queryByText("Сработала строка")).not.toBeInTheDocument();
    expect(row("Балл s")).toHaveTextContent("1");
    expect(row("sMax")).toHaveTextContent("1");
  });

  it("weighted single choice scores the weight of the picked option", () => {
    renderModal({
      type: "single",
      options: ["Да", "Нет"],
      correct: { correctIndex: 0 },
      scoring: { kind: "weighted", weights: [3, 1] },
    });
    expect(row("Балл s")).toHaveTextContent("3");
    pickDemo("Нет");
    expect(row("Балл s")).toHaveTextContent("1");
    expect(screen.getByTestId("score-preview-verdict")).toHaveTextContent("Частично правильно");
  });

  it("closes on «Назад к цене ответа»", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByTestId("score-preview-back"));
    expect(onClose).toHaveBeenCalled();
  });
});
