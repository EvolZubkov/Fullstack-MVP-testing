/**
 * @module features/tests/editor/sections/__tests__/template-preview-modal.test
 * @description The «Оформление» preview modal must show its screens as the SAME
 * three-level rail the template registry shows (Раздел → Вариант → демонстрации):
 * a flat list of every demo screen is unreadable once a template ships a dozen
 * learning-page variants, and same-type screens have to collapse into one branch.
 *
 * The renderer and the bundle hook are stubbed — the rail's structure and the
 * selection it drives are what is under test.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ bundle: null as unknown }));

vi.mock("../use-template-bundle", () => ({
  useTemplateBundle: () => ({ data: h.bundle, isLoading: false, error: null }),
}));
vi.mock("@/components/template-screen", () => ({
  TemplateScreen: () => <div data-testid="template-screen" />,
}));

import { TemplatePreviewModal } from "../template-preview-modal";

const manifest = {
  name: "Стандартный",
  preview: { defaultRoute: "start" },
  themes: [],
};

// Two start variants, two question kinds and two learning-page variants: every
// group is a branch of same-type screens, which is exactly what a flat list lost.
const demoSpecs = [
  { id: "start", route: "start", label: "Стандартный", layoutKey: "start", input: { context: {}, slots: {}, content: {} } },
  { id: "start.image-right", route: "start.image-right", label: "Изображение справа", layoutKey: "start", input: { context: {}, slots: {}, content: {} } },
  { id: "q-single", route: "question.single", label: "Одиночный выбор", layoutKey: "question", input: { context: {}, slots: {}, content: {} } },
  { id: "q-multiple", route: "question.multiple", label: "Множественный выбор", layoutKey: "question", input: { context: {}, slots: {}, content: {} } },
  { id: "results", route: "results", label: "Итоги теста", layoutKey: "results", input: { context: {}, slots: {}, content: {} } },
  { id: "content-text", route: "content.text", label: "Текст", layoutKey: "content", input: { context: {}, slots: {}, content: {} } },
  { id: "content-image", route: "content.image-left", label: "Текст, изображение слева", layoutKey: "content", input: { context: {}, slots: {}, content: {} } },
];

vi.mock("@shared/template/preview-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/template/preview-context")>()),
  buildScreenInputs: () => demoSpecs,
}));

const template = {
  id: "default",
  version: "1.3.0",
  manifest: { name: "Стандартный" },
} as never;

function renderModal() {
  return render(
    <TemplatePreviewModal open onClose={vi.fn()} template={template} params={{}} />,
  );
}

beforeEach(() => {
  h.bundle = {
    manifest,
    demo: {},
    layouts: { start: "<div>s</div>", question: "<div>q</div>", results: "<div>r</div>", content: "<div>c</div>" },
    css: "",
  };
});

describe("<TemplatePreviewModal /> rail is a tree", () => {
  it("groups the screens under the section headings", async () => {
    renderModal();
    expect(await screen.findByText("Системные экраны")).toBeInTheDocument();
    expect(screen.getByText("Страницы контента")).toBeInTheDocument();
  });

  it("collapses same-type screens into one branch instead of listing them flat", async () => {
    renderModal();
    // Type nodes, not seven sibling leaves.
    expect(await screen.findByText("Старт")).toBeInTheDocument();
    expect(screen.getByText("Вопрос")).toBeInTheDocument();
    expect(screen.getByText("Учебная страница")).toBeInTheDocument();
    // A single-demonstration type IS its leaf — no redundant middle level.
    expect(screen.getByText("Итоги теста")).toBeInTheDocument();
    // Branches open by default, so the demonstrations are reachable.
    expect(screen.getByText("Множественный выбор")).toBeInTheDocument();
    expect(screen.getByText("Текст, изображение слева")).toBeInTheDocument();
  });

  it("a branch collapses and expands, hiding its demonstrations", async () => {
    renderModal();
    const branch = await screen.findByText("Вопрос");
    fireEvent.click(branch);
    await waitFor(() => expect(screen.queryByText("Множественный выбор")).not.toBeInTheDocument());
    fireEvent.click(branch);
    expect(await screen.findByText("Множественный выбор")).toBeInTheDocument();
  });

  it("selecting a demonstration switches the stage caption", async () => {
    renderModal();
    fireEvent.click(await screen.findByText("Множественный выбор"));
    await waitFor(() =>
      expect(screen.getByTestId("design-template-preview-caption")).toHaveTextContent("Множественный выбор"),
    );
  });
});
