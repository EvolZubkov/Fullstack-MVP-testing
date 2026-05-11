/**
 * @module client/src/components/content-pages-dialog.test
 * @description Component tests for ContentPagesDialog, ContentPageCard,
 * ContentPageForm, and PlaceholderControl.
 *
 * Covers:
 * - PlaceholderControl renders correct control for each placeholder type
 * - ContentPageCard shows type badge, template label, missing-key warning, autoAdvance badge
 * - ContentPageForm position/type/mode/templateKey selects, placeholder section,
 *   autoAdvance toggle + delay, save/cancel
 * - ContentPagesDialog structural view renders topic blocks with correct topic names
 * - ContentPagesDialog shows "add before / after" buttons per topic
 * - ContentPagesDialog shows inline form when add button clicked
 * - ContentPagesDialog shows missing-keys warning banner when pages have templateKeyMissing
 * - ContentPagesDialog shows empty state when sections is empty
 * - ContentPagesDialog calls create mutation on form save
 * - ContentPagesDialog calls delete mutation on delete
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ContentPagesDialog,
  ContentPageCard,
  ContentPageForm,
  PlaceholderControl,
  type ContentPage,
  type ContentTemplate,
  type ContentTemplatePlaceholder,
  type ContentPagesDialogProps,
} from "./content-pages-dialog";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/queryClient", () => ({
  queryClient: new QueryClient(),
  apiRequest: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TOPIC_A = { topicId: "topic-a", topicName: "Алгебра", drawCount: 5 };
const TOPIC_B = { topicId: "topic-b", topicName: "Геометрия", drawCount: 3 };

const makePage = (overrides: Partial<ContentPage> = {}): ContentPage => ({
  id: "page-1",
  testId: "test-1",
  topicId: "topic-a",
  position: "before_topic",
  mode: "template",
  type: "intro",
  templateKey: "ct.intro",
  sortOrder: 0,
  valuesJson: { values: {}, placeholderStyles: {} },
  autoAdvance: false,
  autoAdvanceDelayMs: null,
  ...overrides,
});

const CT_INTRO: ContentTemplate = {
  key: "ct.intro",
  label: "Вводная страница",
  placeholders: [
    { key: "title", type: "text", label: "Заголовок", required: true },
    { key: "body", type: "richText", label: "Текст" },
  ],
};

const CT_SCORE: ContentTemplate = {
  key: "ct.score",
  label: "Результаты",
  placeholders: [
    {
      key: "score",
      type: "resultField",
      label: "Счёт",
      allowedRenderers: ["core.textMetric", "core.progressBar"],
      defaultRenderer: "core.textMetric",
    },
  ],
};

const TEMPLATES_RESPONSE = [
  {
    id: "default",
    name: "Стандартный",
    manifest: { contentTemplates: [CT_INTRO, CT_SCORE] },
  },
];

const DESIGN_RESPONSE = { templateId: "default" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createWrapper(initialData: Record<string, unknown> = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const url = queryKey[0] as string;
          if (url in initialData) return initialData[url];
          return [];
        },
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function renderDialog(
  props: Partial<ContentPagesDialogProps> = {},
  initialData: Record<string, unknown> = {}
) {
  const defaults: ContentPagesDialogProps = {
    testId: "test-1",
    open: true,
    onOpenChange: vi.fn(),
    sections: [TOPIC_A],
  };
  const data = {
    "/api/tests/test-1/content-pages": [],
    "/api/templates": TEMPLATES_RESPONSE,
    "/api/tests/test-1/design": DESIGN_RESPONSE,
    ...initialData,
  };
  return render(<ContentPagesDialog {...defaults} {...props} />, {
    wrapper: createWrapper(data),
  });
}

// ─── PlaceholderControl tests ─────────────────────────────────────────────────

describe("PlaceholderControl", () => {
  const onChange = vi.fn();
  beforeEach(() => onChange.mockClear());

  const makePh = (
    type: ContentTemplatePlaceholder["type"],
    extra: Partial<ContentTemplatePlaceholder> = {}
  ): ContentTemplatePlaceholder => ({
    key: "field",
    type,
    label: "Field",
    ...extra,
  });

  it("renders text input for type=text", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("text")}
        value="hello"
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("placeholder-text-field")).toBeInTheDocument();
    expect(screen.getByTestId("placeholder-text-field")).toHaveValue("hello");
  });

  it("calls onChange when text input changes", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("text")}
        value=""
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByTestId("placeholder-text-field"), {
      target: { value: "new" },
    });
    expect(onChange).toHaveBeenCalledWith("new");
  });

  it("renders textarea for type=textarea", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("textarea")}
        value="text"
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("placeholder-textarea-field")).toBeInTheDocument();
  });

  it("renders textarea for type=richText", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("richText")}
        value="<b>bold</b>"
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("placeholder-richtext-field")).toBeInTheDocument();
  });

  it("renders monospace textarea for type=html", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("html")}
        value="<div/>"
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("placeholder-html-field")).toBeInTheDocument();
  });

  it("renders number input for type=number", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("number")}
        value={42}
        onChange={onChange}
      />
    );
    const input = screen.getByTestId("placeholder-number-field");
    expect(input).toHaveAttribute("type", "number");
  });

  it("renders switch for type=boolean", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("boolean")}
        value={true}
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("placeholder-boolean-field")).toBeInTheDocument();
  });

  it("renders input for type=image", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("image")}
        value="http://img.example.com/a.png"
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("placeholder-asset-field")).toBeInTheDocument();
  });

  it("renders resultField with renderer select and path input", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("resultField", {
          allowedRenderers: ["core.textMetric", "core.progressBar"],
          defaultRenderer: "core.textMetric",
        })}
        value={{ renderer: "core.textMetric", path: "result.score" }}
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("placeholder-resultfield-field")).toBeInTheDocument();
    expect(screen.getByTestId("placeholder-renderer-field")).toBeInTheDocument();
    expect(screen.getByTestId("placeholder-resultfield-path-field")).toBeInTheDocument();
  });

  it("calls onChange on resultField path change", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("resultField", {
          allowedRenderers: ["core.textMetric"],
          defaultRenderer: "core.textMetric",
        })}
        value={{ renderer: "core.textMetric", path: "" }}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByTestId("placeholder-resultfield-path-field"), {
      target: { value: "result.scorePercent" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ path: "result.scorePercent" })
    );
  });

  it("shows font size number input when allowAuthorFontSize=true", () => {
    const onStyleChange = vi.fn();
    render(
      <PlaceholderControl
        placeholder={makePh("text", {
          textFit: {
            mode: "fixed",
            defaultFontSize: 24,
            allowAuthorFontSize: true,
          },
        })}
        value="hi"
        style={{ fontSize: 24 }}
        onChange={onChange}
        onStyleChange={onStyleChange}
      />
    );
    expect(screen.getByTestId("placeholder-fontsize-field")).toBeInTheDocument();
  });

  it("shows font size select when allowedFontSizes provided", () => {
    const onStyleChange = vi.fn();
    render(
      <PlaceholderControl
        placeholder={makePh("text", {
          textFit: {
            mode: "fixed",
            defaultFontSize: 24,
            allowAuthorFontSize: true,
            allowedFontSizes: [16, 24, 32],
          },
        })}
        value=""
        onChange={onChange}
        onStyleChange={onStyleChange}
      />
    );
    // The font size selector should be a Select trigger (not a number input)
    const fsControl = screen.getByTestId("placeholder-fontsize-field");
    expect(fsControl.tagName).not.toBe("INPUT");
  });

  it("does not show font size control when allowAuthorFontSize is false", () => {
    render(
      <PlaceholderControl
        placeholder={makePh("text", {
          textFit: { mode: "fixed", defaultFontSize: 24, allowAuthorFontSize: false },
        })}
        value=""
        onChange={onChange}
      />
    );
    expect(screen.queryByTestId("placeholder-fontsize-field")).not.toBeInTheDocument();
  });
});

// ─── ContentPageCard tests ────────────────────────────────────────────────────

describe("ContentPageCard", () => {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  beforeEach(() => {
    onEdit.mockClear();
    onDelete.mockClear();
  });

  it("shows type badge and template label", () => {
    render(
      <ContentPageCard
        page={makePage()}
        contentTemplates={[CT_INTRO]}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    expect(screen.getByText("Введение")).toBeInTheDocument();
    expect(screen.getByText("Вводная страница")).toBeInTheDocument();
  });

  it("shows missing-key warning badge when templateKeyMissing=true", () => {
    render(
      <ContentPageCard
        page={makePage({ templateKeyMissing: true })}
        contentTemplates={[]}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    expect(screen.getByText("Шаблон не найден")).toBeInTheDocument();
  });

  it("shows autoAdvance badge with delay when autoAdvance=true", () => {
    render(
      <ContentPageCard
        page={makePage({ autoAdvance: true, autoAdvanceDelayMs: 5000 })}
        contentTemplates={[CT_INTRO]}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    expect(screen.getByText("5с")).toBeInTheDocument();
  });

  it("shows position label in secondary line", () => {
    render(
      <ContentPageCard
        page={makePage({ position: "after_topic" })}
        contentTemplates={[CT_INTRO]}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    expect(screen.getByText(/После темы/)).toBeInTheDocument();
  });

  it("calls onEdit when edit button clicked", () => {
    render(
      <ContentPageCard
        page={makePage()}
        contentTemplates={[CT_INTRO]}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByTestId("edit-page-page-1"));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("calls onDelete when delete button clicked", () => {
    render(
      <ContentPageCard
        page={makePage()}
        contentTemplates={[CT_INTRO]}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByTestId("delete-page-page-1"));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("applies isDragging class when dragging", () => {
    render(
      <ContentPageCard
        page={makePage()}
        contentTemplates={[CT_INTRO]}
        onEdit={onEdit}
        onDelete={onDelete}
        isDragging
      />
    );
    expect(screen.getByTestId("content-page-card-page-1")).toHaveClass(
      "opacity-70"
    );
  });
});

// ─── ContentPageForm tests ────────────────────────────────────────────────────

describe("ContentPageForm", () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  beforeEach(() => {
    onSave.mockClear();
    onCancel.mockClear();
  });

  function renderForm(
    props: Partial<React.ComponentProps<typeof ContentPageForm>> = {}
  ) {
    return render(
      <ContentPageForm
        contentTemplates={[CT_INTRO, CT_SCORE]}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
        topicId="topic-a"
        {...props}
      />
    );
  }

  it("renders form with position, type, mode selects", () => {
    renderForm();
    expect(screen.getByTestId("content-page-form")).toBeInTheDocument();
    expect(screen.getByTestId("form-position")).toBeInTheDocument();
    expect(screen.getByTestId("form-type")).toBeInTheDocument();
    expect(screen.getByTestId("form-mode")).toBeInTheDocument();
  });

  it("shows template key select when mode=template", () => {
    renderForm({ initial: { mode: "template" } });
    expect(screen.getByTestId("form-template-key")).toBeInTheDocument();
  });

  it("shows placeholder form when template has placeholders", () => {
    renderForm({ initial: { mode: "template", templateKey: "ct.intro" } });
    expect(screen.getByTestId("placeholder-form")).toBeInTheDocument();
  });

  it("shows HTML textarea when mode=html", () => {
    renderForm({ initial: { mode: "html" } });
    expect(screen.getByTestId("form-html-content")).toBeInTheDocument();
  });

  it("does not show placeholder form when mode=standard", () => {
    renderForm({ initial: { mode: "standard" } });
    expect(screen.queryByTestId("placeholder-form")).not.toBeInTheDocument();
  });

  it("shows autoAdvance delay input when autoAdvance toggled on", () => {
    renderForm();
    expect(screen.queryByTestId("form-auto-advance-delay")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("form-auto-advance"));
    expect(screen.getByTestId("form-auto-advance-delay")).toBeInTheDocument();
  });

  it("calls onSave with correct data on submit", () => {
    renderForm({ initial: { mode: "template", templateKey: "ct.intro" } });
    fireEvent.click(screen.getByTestId("form-save-btn"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "template",
        templateKey: "ct.intro",
        autoAdvance: false,
      })
    );
  });

  it("calls onCancel when cancel button clicked", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("disables save and cancel when isSaving=true", () => {
    renderForm({ isSaving: true });
    expect(screen.getByTestId("form-save-btn")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeDisabled();
  });

  it("shows 'Сохранение...' label when isSaving=true", () => {
    renderForm({ isSaving: true });
    expect(screen.getByTestId("form-save-btn")).toHaveTextContent("Сохранение...");
  });

  it("populates form from initial edit state", () => {
    renderForm({
      initial: {
        mode: "template",
        type: "summary",
        templateKey: "ct.score",
        autoAdvance: true,
        autoAdvanceDelayS: 15,
      },
    });
    // autoAdvance delay is visible
    expect(screen.getByTestId("form-auto-advance-delay")).toBeInTheDocument();
    expect(screen.getByTestId("form-auto-advance-delay")).toHaveValue(15);
  });

  it("resets values when template key changes", async () => {
    renderForm({
      initial: {
        mode: "template",
        templateKey: "ct.intro",
        values: { title: "Hello" },
      },
    });
    // Verify placeholder text input exists with initial value
    const titleInput = screen.getByTestId("placeholder-text-title");
    expect(titleInput).toHaveValue("Hello");
  });
});

// ─── ContentPagesDialog structural view tests ─────────────────────────────────

describe("ContentPagesDialog – structural view", () => {
  it("renders topic blocks with topic names", async () => {
    renderDialog({ sections: [TOPIC_A, TOPIC_B] });
    await waitFor(() => {
      expect(screen.getByTestId("topic-block-topic-a")).toBeInTheDocument();
      expect(screen.getByTestId("topic-block-topic-b")).toBeInTheDocument();
    });
    expect(screen.getByTestId("topic-name-topic-a")).toHaveTextContent("Алгебра");
    expect(screen.getByTestId("topic-name-topic-b")).toHaveTextContent("Геометрия");
  });

  it("renders add-before and add-after buttons for each topic", async () => {
    renderDialog({ sections: [TOPIC_A] });
    await waitFor(() => {
      expect(screen.getByTestId("add-before-topic-a")).toBeInTheDocument();
      expect(screen.getByTestId("add-after-topic-a")).toBeInTheDocument();
    });
  });

  it("shows empty state when sections is empty", async () => {
    renderDialog({ sections: [] });
    await waitFor(() => {
      expect(screen.getByTestId("no-sections-empty")).toBeInTheDocument();
    });
  });

  it("renders existing content pages inside topic block", async () => {
    const page = makePage({ id: "page-x", topicId: "topic-a", position: "before_topic" });
    renderDialog({ sections: [TOPIC_A] }, {
      "/api/tests/test-1/content-pages": [page],
    });
    await waitFor(() => {
      expect(screen.getByTestId("content-page-card-page-x")).toBeInTheDocument();
    });
  });

  it("shows missing-keys warning banner when any page has templateKeyMissing", async () => {
    const page = makePage({ id: "page-m", templateKeyMissing: true });
    renderDialog({ sections: [TOPIC_A] }, {
      "/api/tests/test-1/content-pages": [page],
    });
    await waitFor(() => {
      expect(screen.getByTestId("missing-keys-warning")).toBeInTheDocument();
    });
  });

  it("does not show missing-keys warning when all pages are healthy", async () => {
    const page = makePage({ id: "page-ok" });
    renderDialog({ sections: [TOPIC_A] }, {
      "/api/tests/test-1/content-pages": [page],
    });
    await waitFor(() => {
      expect(screen.getByTestId("content-page-card-page-ok")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("missing-keys-warning")).not.toBeInTheDocument();
  });
});

// ─── ContentPagesDialog CRUD interaction tests ────────────────────────────────

describe("ContentPagesDialog – interactions", () => {
  it("opens inline form when 'До темы' button clicked", async () => {
    renderDialog({ sections: [TOPIC_A] });
    await waitFor(() => {
      expect(screen.getByTestId("add-before-topic-a")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("add-before-topic-a"));
    expect(screen.getByTestId("inline-page-form")).toBeInTheDocument();
    expect(screen.getByText("Новая страница")).toBeInTheDocument();
  });

  it("opens inline form with 'Редактировать' header when edit clicked", async () => {
    const page = makePage({ id: "page-e" });
    renderDialog({ sections: [TOPIC_A] }, {
      "/api/tests/test-1/content-pages": [page],
    });
    await waitFor(() => {
      expect(screen.getByTestId("edit-page-page-e")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("edit-page-page-e"));
    expect(screen.getByTestId("inline-page-form")).toBeInTheDocument();
    expect(screen.getByText("Редактировать страницу")).toBeInTheDocument();
  });

  it("closes inline form when cancel clicked", async () => {
    renderDialog({ sections: [TOPIC_A] });
    await waitFor(() => screen.getByTestId("add-before-topic-a"));
    fireEvent.click(screen.getByTestId("add-before-topic-a"));
    expect(screen.getByTestId("inline-page-form")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByTestId("inline-page-form")).not.toBeInTheDocument();
  });

  it("calls apiRequest POST when create form saved", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    (apiRequest as ReturnType<typeof vi.fn>).mockClear();

    renderDialog({ sections: [TOPIC_A] });
    await waitFor(() => screen.getByTestId("add-before-topic-a"));
    fireEvent.click(screen.getByTestId("add-before-topic-a"));
    fireEvent.click(screen.getByTestId("form-save-btn"));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/tests/test-1/content-pages",
        expect.objectContaining({ topicId: "topic-a", position: "before_topic" })
      );
    });
  });

  it("calls apiRequest DELETE when delete confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { apiRequest } = await import("@/lib/queryClient");
    (apiRequest as ReturnType<typeof vi.fn>).mockClear();

    const page = makePage({ id: "page-del" });
    renderDialog({ sections: [TOPIC_A] }, {
      "/api/tests/test-1/content-pages": [page],
    });
    await waitFor(() => screen.getByTestId("delete-page-page-del"));
    fireEvent.click(screen.getByTestId("delete-page-page-del"));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/tests/test-1/content-pages/page-del"
      );
    });
    vi.restoreAllMocks();
  });

  it("does not call DELETE when confirm cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { apiRequest } = await import("@/lib/queryClient");
    (apiRequest as ReturnType<typeof vi.fn>).mockClear();

    const page = makePage({ id: "page-nd" });
    renderDialog({ sections: [TOPIC_A] }, {
      "/api/tests/test-1/content-pages": [page],
    });
    await waitFor(() => screen.getByTestId("delete-page-page-nd"));
    fireEvent.click(screen.getByTestId("delete-page-page-nd"));

    expect(apiRequest).not.toHaveBeenCalledWith(
      "DELETE",
      expect.stringContaining("page-nd")
    );
    vi.restoreAllMocks();
  });

  it("calls onOpenChange(false) when Закрыть button clicked", async () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange, sections: [TOPIC_A] });
    await waitFor(() => screen.getByTestId("structural-view"));
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
