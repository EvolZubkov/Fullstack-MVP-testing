/**
 * @module features/tests/editor/sections/__tests__/page-preview-modal.coverage.test
 * @description Coverage tests for {@link PagePreviewModal} (PRD-7 S13.4-G17 / FR-44).
 *
 * The modal is a thin orchestrator over the unified renderer: it resolves the
 * template bundle, overlays REAL test data on the demo dataset, picks a single
 * ScreenSpec by the page's `kind` and renders it through {@link TemplateScreen}.
 * The heavy dependencies (bundle fetch, the framework-free renderer, the shared
 * preview/result-context builders and the CSS-var mapper) are mocked so the tests
 * drive the modal's OWN branch logic deterministically:
 *   - closed → renders nothing;
 *   - loading / error banner states;
 *   - runtime-screen kinds (start / results / review / section-results / questions)
 *     resolved from the demo screens;
 *   - the `intro` («Введение раздела») section-intro path with + without a matching
 *     real section;
 *   - content kinds (info) via `buildContentPageScreen`, incl. real-data overlay;
 *   - the two "cannot assemble preview" fallbacks (missing layout vs. no spec);
 *   - the close action.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ─── Mocks (installed before the component import) ──────────────────────────────

const useTemplateBundleMock = vi.fn();
vi.mock("../use-template-bundle", () => ({
  useTemplateBundle: (...args: unknown[]) => useTemplateBundleMock(...args),
}));

// Stub the Shadow-DOM renderer: expose the resolved layout so we can assert which
// ScreenSpec the modal picked without running the real renderer.
vi.mock("@/components/template-screen", () => ({
  TemplateScreen: (props: { layout: string }) => (
    <div data-testid="mock-template-screen" data-layout={props.layout} />
  ),
}));

const buildContentPageScreen = vi.fn();
const buildScreenInputs = vi.fn();
vi.mock("@shared/template/preview-context", () => ({
  buildContentPageScreen: (...a: unknown[]) => buildContentPageScreen(...a),
  buildScreenInputs: (...a: unknown[]) => buildScreenInputs(...a),
}));

const buildSectionIntroContext = vi.fn();
vi.mock("@shared/template/result-context", () => ({
  buildSectionIntroContext: (...a: unknown[]) => buildSectionIntroContext(...a),
}));

vi.mock("@shared/template/params-css", () => ({
  buildTemplateCssVars: () => ({ "--x": "1" }),
}));

import { PagePreviewModal, type PagePreviewModalProps } from "../page-preview-modal";

// ─── Fixtures ───────────────────────────────────────────────────────────────────

function makeBundle(over: Record<string, unknown> = {}) {
  return {
    manifest: {
      contentTemplates: [{ key: "info.text", pageKind: "content.info" }],
      params: [],
    },
    demo: {
      course: {
        title: "Demo",
        topics: [{ id: "d1", title: "DT", status: "available" }],
        questionCount: 3,
      },
      runtime: { result: { scorePercent: 50, status: "failed", passed: false } },
    },
    layouts: {
      "content.info": "<div>info</div>",
      "section-intro": "<div>intro</div>",
      start: "<div>start</div>",
    },
    css: ".x{}",
    ...over,
  };
}

function renderModal(props: Partial<PagePreviewModalProps> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <PagePreviewModal
      open
      onClose={onClose}
      templateId="tpl-1"
      params={{}}
      page={{ id: "p1", kind: "info", templateKey: "info.text", valuesJson: { values: { title: "T" } } }}
      pageTitle="Стр"
      {...props}
    />,
  );
  return { onClose, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  useTemplateBundleMock.mockReturnValue({ data: makeBundle(), isLoading: false, error: null });
  buildContentPageScreen.mockReturnValue(null);
  buildScreenInputs.mockReturnValue([]);
  buildSectionIntroContext.mockReturnValue({ course: {}, sectionIntro: {} });
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("<PagePreviewModal /> — shell states", () => {
  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByTestId("page-preview-modal")).toBeNull();
  });

  it("shows the loading hint while the bundle is fetching", () => {
    useTemplateBundleMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderModal();
    expect(screen.getByText("Загружаем шаблон…")).toBeInTheDocument();
  });

  it("shows an error banner when the bundle fails to load", () => {
    useTemplateBundleMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error("boom") });
    renderModal();
    expect(screen.getByText("Не удалось загрузить файлы шаблона")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});

describe("<PagePreviewModal /> — content page (buildContentPageScreen)", () => {
  it("renders the resolved layout through TemplateScreen", () => {
    buildContentPageScreen.mockReturnValue({
      layoutKey: "content.info",
      input: { context: { a: 1 }, slots: {}, content: {} },
    });
    renderModal();
    expect(screen.getByTestId("mock-template-screen")).toHaveAttribute("data-layout", "<div>info</div>");
    // Route derived from the template's pageKind; templateKey forwarded.
    expect(buildContentPageScreen).toHaveBeenCalledWith(
      expect.objectContaining({ route: "content.info", templateKey: "info.text" }),
    );
  });

  it("overlays REAL test data onto the demo dataset (courseTitle)", () => {
    buildContentPageScreen.mockReturnValue({
      layoutKey: "content.info",
      input: { context: {}, slots: {}, content: {} },
    });
    renderModal({
      realData: {
        courseTitle: "Real",
        topics: [{ id: "r1", title: "RT" }],
        questionCount: 9,
        description: "D",
        passPercent: 70,
        timeLimitMinutes: null,
        maxAttempts: 2,
      },
    });
    expect(buildContentPageScreen).toHaveBeenCalledWith(
      expect.objectContaining({
        courseTitle: "Real",
        routerTopics: [{ id: "r1", title: "RT", status: "available" }],
      }),
    );
  });

  it("shows «макет не найден» when the spec's layout is absent from the bundle", () => {
    buildContentPageScreen.mockReturnValue({
      layoutKey: "missing-layout",
      input: { context: {}, slots: {}, content: {} },
    });
    renderModal();
    expect(screen.getByText(/Макет «missing-layout» не найден/)).toBeInTheDocument();
  });

  it("shows «нет подходящего макета» when no spec is produced", () => {
    buildContentPageScreen.mockReturnValue(null);
    renderModal();
    expect(screen.getByText("Выбранный шаблон не содержит подходящего макета.")).toBeInTheDocument();
  });
});

describe("<PagePreviewModal /> — runtime-screen kinds (buildScreenInputs)", () => {
  it.each([
    ["start", "start"],
    ["results", "results.adaptive"],
    ["review", "review"],
    ["section-results", "section-results"],
    ["questions", "question-1"],
  ])("resolves the %s kind from the demo screens", (kind, route) => {
    buildScreenInputs.mockReturnValue([
      { route, layoutKey: "content.info", input: { context: {}, slots: {} } },
    ]);
    renderModal({ page: { id: "x", kind, templateKey: null, valuesJson: { values: {} } } });
    expect(screen.getByTestId("mock-template-screen")).toBeInTheDocument();
  });

  it("uses the `start` layout key when the matched screen points at it", () => {
    buildScreenInputs.mockReturnValue([
      { route: "start", layoutKey: "start", input: { context: {}, slots: {} } },
    ]);
    renderModal({ page: { id: "s", kind: "start", templateKey: null, valuesJson: { values: {} } } });
    expect(screen.getByTestId("mock-template-screen")).toHaveAttribute("data-layout", "<div>start</div>");
  });

  it("falls back to «нет подходящего макета» when the demo has no dataset", () => {
    useTemplateBundleMock.mockReturnValue({ data: makeBundle({ demo: null }), isLoading: false, error: null });
    renderModal({ page: { id: "s", kind: "start", templateKey: null, valuesJson: { values: {} } } });
    expect(screen.getByText("Выбранный шаблон не содержит подходящего макета.")).toBeInTheDocument();
    expect(buildScreenInputs).not.toHaveBeenCalled();
  });
});

describe("<PagePreviewModal /> — intro (section-intro) path", () => {
  it("builds the section-intro context from the matching real section", () => {
    buildSectionIntroContext.mockReturnValue({ course: { title: "C" }, sectionIntro: { number: 1 } });
    renderModal({
      page: { id: "in", kind: "intro", topicId: "t1", valuesJson: { values: { instruction: "Do" } } },
      realData: { sections: [{ topicId: "t1", topicName: "TA", questionCount: 4 }] },
    });
    expect(screen.getByTestId("mock-template-screen")).toHaveAttribute("data-layout", "<div>intro</div>");
    expect(buildSectionIntroContext).toHaveBeenCalledWith(
      expect.objectContaining({ sectionNumber: 1, topicName: "TA", questionCount: 4, instruction: "Do" }),
    );
  });

  it("falls back to demo topic/count when no real section matches", () => {
    buildSectionIntroContext.mockReturnValue({ course: {}, sectionIntro: {} });
    renderModal({
      page: { id: "in2", kind: "intro", topicId: "tX", valuesJson: { values: {} } },
      realData: { sections: [] },
    });
    expect(buildSectionIntroContext).toHaveBeenCalledWith(
      expect.objectContaining({ sectionNumber: 1, topicName: "DT", questionCount: 3, instruction: "" }),
    );
  });
});

describe("<PagePreviewModal /> — close", () => {
  it("calls onClose from the footer button", () => {
    buildContentPageScreen.mockReturnValue({
      layoutKey: "content.info",
      input: { context: {}, slots: {}, content: {} },
    });
    const { onClose } = renderModal();
    fireEvent.click(screen.getByTestId("page-preview-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
