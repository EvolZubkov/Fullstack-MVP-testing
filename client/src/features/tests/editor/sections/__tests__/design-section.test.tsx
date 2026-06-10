/**
 * @module features/tests/editor/sections/__tests__/design-section.test
 * @description Tests for the «Оформление» tab section.
 *
 * Coverage:
 *   - 4 rail items render (Шаблон / Брендирование / Макет / Прогресс и шапка)
 *   - Create-mode notice when testId is undefined
 *   - Шаблон pane renders template name + version + description loaded from
 *     `/api/templates/:id`
 *   - «Сбросить до умолчаний» clears params in the draft (Save enabled)
 *   - Branding pane renders a dynamic form keyed by manifest params:
 *       text / color / boolean / select inputs work
 *       unsupported types render a stub row
 *   - Save button is disabled until the draft is dirty
 *   - Layout / Progress panes still show «следующий шаг» stubs
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesignSection } from "../design-section";
import { useDesignSettings } from "../../use-design-settings";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_ID = "te-1";

const TEMPLATE = {
  id: "corporate",
  name: "Корпоративный",
  description: "Боковая панель, прогресс по темам",
  version: "1.2.0",
  templateApiVersion: "1.0",
  isBuiltin: true,
  isActive: true,
  previewPath: null,
  manifest: {
    id: "corporate",
    name: "Корпоративный",
    description: "Боковая панель, прогресс по темам",
    version: "1.2.0",
    templateApiVersion: "1.0",
    params: [
      { key: "companyName", type: "text", label: "Название компании", default: "" },
      { key: "primaryColor", type: "color", label: "Основной цвет", default: "221 83% 53%" },
      { key: "showProgressBar", type: "boolean", label: "Показывать прогресс-бар", default: true },
      { key: "fontFamily", type: "select", label: "Шрифт", options: ["Inter", "Roboto"], default: "Inter" },
      { key: "logoUrl", type: "image", label: "Логотип" },
    ],
    contentTemplates: [
      { key: "intro-default", kind: "intro", label: "Вступление" },
      { key: "info-default", kind: "info", label: "Учебный слайд" },
      { key: "questions-default", kind: "questions", label: "Вопросы" },
      { key: "summary-default", kind: "summary", label: "Итоги" },
    ],
  },
};

const DESIGN_SETTINGS_DEFAULT = { templateId: "corporate", params: {} };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderWithClient(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  mockFetch((url) => {
    if (url === `/api/tests/${TEST_ID}/design`) return jsonResponse(DESIGN_SETTINGS_DEFAULT);
    if (url === `/api/templates/corporate`) return jsonResponse(TEMPLATE);
    return jsonResponse({ error: "unexpected" }, 500);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<DesignSection /> — rail navigation", () => {
  it("renders all four rail items", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    expect(screen.getByTestId("design-rail-template")).toBeInTheDocument();
    expect(screen.getByTestId("design-rail-branding")).toBeInTheDocument();
    expect(screen.getByTestId("design-rail-layout")).toBeInTheDocument();
    expect(screen.getByTestId("design-rail-progress")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
  });

  it("switches pane when a rail item is clicked", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    await waitFor(() =>
      expect(screen.getByTestId("design-branding-pane")).toBeInTheDocument(),
    );
  });

  it("renders empty-section info-banner for Layout and Progress panes when the template declares no params there (S12 G1)", async () => {
    // Fixture `TEMPLATE` declares params without an explicit `section` — all
    // fall back to `branding`, so layout and progress panes must render their
    // own empty-state banners (paramsBySection filters to []).
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-layout"));
    await waitFor(() =>
      expect(screen.getByTestId("design-layout-pane")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("design-layout-pane-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("design-rail-progress"));
    await waitFor(() =>
      expect(screen.getByTestId("design-progress-pane")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("design-progress-pane-empty")).toBeInTheDocument();
  });
});

describe("<DesignSection /> — create-mode notice", () => {
  it("shows the create-mode notice when testId is undefined", () => {
    renderWithClient(<DesignSection testId={undefined} />);
    expect(screen.getByTestId("design-create-notice")).toBeInTheDocument();
    expect(screen.queryByTestId("design-template-pane")).toBeNull();
  });
});

describe("<DesignSection /> — Шаблон pane", () => {
  it("renders the current template name, version and description", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-name")).toHaveTextContent(
        "Корпоративный",
      ),
    );
    expect(screen.getByTestId("design-template-version")).toHaveTextContent(
      "v1.2.0",
    );
    expect(screen.getByTestId("design-template-builtin")).toBeInTheDocument();
    expect(screen.getByTestId("design-template-desc")).toHaveTextContent(
      "Боковая панель",
    );
  });

  it("«Сбросить до умолчаний» clears params in the draft (verified via Branding inputs)", async () => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`)
        return jsonResponse({ templateId: "corporate", params: { companyName: "Acme" } });
      if (url === `/api/templates/corporate`) return jsonResponse(TEMPLATE);
      return jsonResponse({ error: "unexpected" }, 500);
    });
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    // Confirm preloaded param shows in Branding
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    await waitFor(() =>
      expect(
        (screen.getByTestId("design-param-input-companyName") as HTMLInputElement).value,
      ).toBe("Acme"),
    );
    // Reset clears params → companyName input becomes empty
    fireEvent.click(screen.getByTestId("design-rail-template"));
    fireEvent.click(screen.getByTestId("design-template-reset"));
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    await waitFor(() =>
      expect(
        (screen.getByTestId("design-param-input-companyName") as HTMLInputElement).value,
      ).toBe(""),
    );
  });
});

describe("<DesignSection /> — template-outdated banner (PRD-3)", () => {
  it("shows the outdated banner when the saved version differs from the template's", async () => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`)
        return jsonResponse({ templateId: "corporate", templateVersion: "1.0.0", params: {} });
      if (url === `/api/templates/corporate`) return jsonResponse(TEMPLATE);
      return jsonResponse({ error: "unexpected" }, 500);
    });
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-outdated")).toBeInTheDocument(),
    );
  });

  it("does not show the banner when the saved version matches the template's", async () => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`)
        return jsonResponse({ templateId: "corporate", templateVersion: "1.2.0", params: {} });
      if (url === `/api/templates/corporate`) return jsonResponse(TEMPLATE);
      return jsonResponse({ error: "unexpected" }, 500);
    });
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("design-template-outdated")).toBeNull();
  });

  it("does not show the banner when the slepok recorded no version", async () => {
    // DESIGN_SETTINGS_DEFAULT has no templateVersion → nothing to reconcile.
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("design-template-outdated")).toBeNull();
  });
});

describe("<DesignSection /> — Брендирование pane", () => {
  it("renders one row per template param", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    await waitFor(() =>
      expect(screen.getByTestId("design-branding-pane")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("design-param-row-companyName")).toBeInTheDocument();
    expect(screen.getByTestId("design-param-row-primaryColor")).toBeInTheDocument();
    expect(screen.getByTestId("design-param-row-showProgressBar")).toBeInTheDocument();
    expect(screen.getByTestId("design-param-row-fontFamily")).toBeInTheDocument();
    // S12-G4 (2026-05-28): image params now render as a media-row with an
    // upload button + file chip, no longer an «unsupported» banner. The row
    // wrapper testid stays; the upload button uses the same input testid.
    expect(screen.getByTestId("design-param-row-logoUrl")).toBeInTheDocument();
    expect(screen.getByTestId("design-param-input-logoUrl")).toBeInTheDocument();
  });

  it("editing a text param updates the draft (input value)", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    fireEvent.change(screen.getByTestId("design-param-input-companyName"), {
      target: { value: "Acme" },
    });
    expect(
      (screen.getByTestId("design-param-input-companyName") as HTMLInputElement).value,
    ).toBe("Acme");
  });

  it("toggling a boolean param flips the switch state", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    const input = screen.getByTestId("design-param-input-showProgressBar") as HTMLInputElement;
    const before = input.checked;
    fireEvent.click(input);
    await waitFor(() => expect(input.checked).toBe(!before));
  });

  it("changing a select param updates the trigger label", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    const wrap = screen.getByTestId("design-param-input-fontFamily");
    fireEvent.click(within(wrap).getByRole("button"));
    fireEvent.click(screen.getByRole("option", { name: "Roboto" }));
    await waitFor(() => expect(wrap).toHaveTextContent("Roboto"));
  });
});

describe("<DesignSection /> — save flow (via hoisted hook)", () => {
  /**
   * Test harness emulates the parent (TestEditorView) hoisting
   * `useDesignSettings` and triggering its save from a unified footer.
   * The DesignSection no longer renders a per-pane save button (per
   * wireframe prd7-design-tab.html — single drawer footer save).
   */
  function Harness() {
    const design = useDesignSettings(TEST_ID);
    return (
      <>
        <DesignSection testId={TEST_ID} design={design} />
        <button
          type="button"
          data-testid="harness-save"
          disabled={!design.isDirty || design.isSaving}
          onClick={() => {
            design.save().catch(() => {});
          }}
        >
          save
        </button>
      </>
    );
  }

  it("PUTs the hoisted draft to /api/tests/:id/design and clears the dirty state", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    mockFetch((url, init) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === `/api/tests/${TEST_ID}/design` && init?.method === "PUT") {
        return jsonResponse({
          templateId: "corporate",
          params: { companyName: "Acme" },
        });
      }
      if (url === `/api/tests/${TEST_ID}/design`) return jsonResponse(DESIGN_SETTINGS_DEFAULT);
      if (url === `/api/templates/corporate`) return jsonResponse(TEMPLATE);
      return jsonResponse({ error: "unexpected" }, 500);
    });
    renderWithClient(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    fireEvent.change(screen.getByTestId("design-param-input-companyName"), {
      target: { value: "Acme" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("harness-save")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("harness-save"));
    await waitFor(() =>
      expect(screen.getByTestId("harness-save")).toBeDisabled(),
    );
    const putCall = calls.find(
      (c) => c.url === `/api/tests/${TEST_ID}/design` && c.body !== undefined,
    );
    expect(putCall).toBeDefined();
    expect((putCall!.body as { params: Record<string, unknown> }).params.companyName).toBe(
      "Acme",
    );
  });
});

describe("<DesignSection /> — template preview modal (S12-G2)", () => {
  it("opens the modal on «Предпросмотр» click", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-template-preview"));
    await waitFor(() =>
      expect(screen.getByTestId("design-template-preview-modal")).toBeInTheDocument(),
    );
  });

  it("closes on close button click", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-template-preview"));
    await waitFor(() =>
      expect(screen.getByTestId("design-template-preview-modal")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-template-preview-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("design-template-preview-modal")).not.toBeInTheDocument(),
    );
  });

  it("renders via the unified renderer and applies draft.params as CSS variables", async () => {
    // Minimal bundle: one "start" screen + a primaryColor param (→ --primary).
    const BUNDLE = {
      manifest: {
        name: "Корпоративный",
        version: "1.2.0",
        params: [
          { key: "companyName", type: "text", label: "Название компании", default: "" },
          { key: "primaryColor", type: "color", label: "Основной цвет", default: "221 83% 53%" },
        ],
        layouts: { start: "start.html" },
        preview: { defaultRoute: "start", routes: ["start"] },
      },
      demo: { course: { title: "Демо" } },
      layouts: { start: "<div class=\"start-page\">Демо</div>" },
      css: ":root{--primary: 221 83% 53%;}",
    };
    // Pre-load a non-default param so the applied CSS variable must reflect it.
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`)
        return jsonResponse({ templateId: "corporate", params: { companyName: "Acme", primaryColor: "180 50% 40%" } });
      if (url === `/api/templates/corporate`) return jsonResponse(TEMPLATE);
      if (url === `/api/templates/corporate/bundle`) return jsonResponse(BUNDLE);
      return jsonResponse({ error: "unexpected" }, 500);
    });
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    // Wait for the design settings query to populate draft.params before opening.
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("design-rail-branding"));
      const input = screen.getByTestId("design-param-input-companyName") as HTMLInputElement;
      expect(input.value).toBe("Acme");
    });
    fireEvent.click(screen.getByTestId("design-rail-template"));
    fireEvent.click(screen.getByTestId("design-template-preview"));
    // The unified renderer mounts into a host carrying the draft's branding as
    // CSS custom properties — primaryColor (180 50% 40%) → --primary.
    await waitFor(() => {
      const host = document.querySelector("[data-template-screen]") as HTMLElement | null;
      expect(host).not.toBeNull();
      expect(host!.style.getPropertyValue("--primary").trim()).toBe("180 50% 40%");
    });
  });
});

// ─── S12-G6 — wf-template-incompatible (templateId 404) ──────────────────────

describe("<DesignSection /> — template-incompatible state (S12-G6)", () => {
  beforeEach(() => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`) {
        return jsonResponse({ templateId: "deleted-template-v2", params: {} });
      }
      if (url === `/api/templates/deleted-template-v2`) {
        return jsonResponse({ error: "Template not found" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
  });

  it("renders the incompatible banner with both recovery actions when templateId 404s", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-incompatible")).toBeInTheDocument(),
    );
    const banner = screen.getByTestId("design-template-incompatible");
    expect(banner).toHaveTextContent("Шаблон недоступен");
    expect(banner).toHaveTextContent("deleted-template-v2");
    expect(banner).toHaveTextContent("Выбрать шаблон");
    expect(banner).toHaveTextContent("Применить «Стандартный»");
  });

  it("marks the «Шаблон» rail with status-dot error and disables other panes", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-incompatible")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("design-rail-template-error-dot")).toBeInTheDocument();
    expect(screen.getByTestId("design-rail-branding")).toBeDisabled();
    expect(screen.getByTestId("design-rail-layout")).toBeDisabled();
    expect(screen.getByTestId("design-rail-progress")).toBeDisabled();
  });

  it("clicking «Применить «Стандартный»» switches the draft to the default template", async () => {
    // The default template resolves on the draft-keyed manifest query after the switch.
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`) {
        return jsonResponse({ templateId: "deleted-template-v2", params: {} });
      }
      if (url === `/api/templates/deleted-template-v2`) {
        return jsonResponse({ error: "Template not found" }, 404);
      }
      if (url === `/api/templates/default`) {
        return jsonResponse({ ...TEMPLATE, id: "default", manifest: { ...TEMPLATE.manifest, id: "default", name: "Стандартный" } });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });

    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-incompatible")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Применить «Стандартный»"));

    // The draft now points at a resolvable template, so the manifest loads and the
    // incompatible banner clears — the template pane returns (the user still saves
    // to persist). This is the same mechanism that makes «Заменить шаблон» update
    // the card without a save.
    await waitFor(() => {
      expect(screen.queryByTestId("design-template-incompatible")).not.toBeInTheDocument();
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument();
    });
  });
});

// ─── S12-G3 — Template gallery (FR-33) ───────────────────────────────────────

describe("<DesignSection /> — template gallery (S12-G3 / FR-33)", () => {
  beforeEach(() => {
    const TEMPLATES_LIST = [
      TEMPLATE,
      {
        ...TEMPLATE,
        id: "default",
        manifest: { ...TEMPLATE.manifest, id: "default", name: "Стандартный" },
      },
      {
        ...TEMPLATE,
        id: "minimal",
        manifest: { ...TEMPLATE.manifest, id: "minimal", name: "Минимальный" },
      },
    ];
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`) return jsonResponse(DESIGN_SETTINGS_DEFAULT);
      if (url === `/api/templates/corporate`) return jsonResponse(TEMPLATE);
      if (url === `/api/templates/default`) return jsonResponse(TEMPLATES_LIST[1]);
      if (url === `/api/templates/minimal`) return jsonResponse(TEMPLATES_LIST[2]);
      if (url === `/api/templates`) return jsonResponse(TEMPLATES_LIST);
      return jsonResponse({ error: "unexpected" }, 500);
    });
  });

  it("«Заменить шаблон» opens the gallery modal with current template marked", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-template-replace"));

    await waitFor(() =>
      expect(screen.getByTestId("design-gallery-grid")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("design-gallery-card-corporate")).toBeInTheDocument();
    expect(screen.getByTestId("design-gallery-card-default")).toBeInTheDocument();
    expect(screen.getByTestId("design-gallery-card-minimal")).toBeInTheDocument();
    // Current is corporate → its «Текущий» chip is present.
    expect(
      screen.getByTestId("design-gallery-card-corporate-current"),
    ).toBeInTheDocument();
  });

  it("filters the gallery by name", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-template-replace"));
    await waitFor(() => expect(screen.getByTestId("design-gallery-grid")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("design-gallery-search"), {
      target: { value: "минимальный" },
    });

    expect(screen.queryByTestId("design-gallery-card-corporate")).toBeNull();
    expect(screen.queryByTestId("design-gallery-card-default")).toBeNull();
    expect(screen.getByTestId("design-gallery-card-minimal")).toBeInTheDocument();
  });

  it("«Применить» disabled when selected card equals current", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-template-replace"));
    await waitFor(() => expect(screen.getByTestId("design-gallery-grid")).toBeInTheDocument());
    // Pre-selected to current corporate → Apply is disabled.
    expect(screen.getByTestId("design-gallery-apply")).toBeDisabled();
    // Click another card → Apply enabled.
    fireEvent.click(screen.getByTestId("design-gallery-card-minimal"));
    expect(screen.getByTestId("design-gallery-apply")).not.toBeDisabled();
  });
});

// ─── S12-G4 — New param types (FR-31a) ───────────────────────────────────────

const TEMPLATE_WITH_ALL_TYPES = {
  ...TEMPLATE,
  id: "all-types",
  manifest: {
    ...TEMPLATE.manifest,
    id: "all-types",
    params: [
      { key: "maxStudents", type: "number", label: "Учеников в группе", default: 25, min: 0, max: 200 },
      { key: "supportUrl", type: "url", label: "Ссылка на поддержку", default: "" },
      {
        key: "audience",
        type: "multiselect",
        label: "Целевая аудитория",
        options: ["Junior", "Middle", "Senior"],
        default: [],
      },
      { key: "logoUrl", type: "image", label: "Логотип" },
      { key: "manualPdf", type: "downloadLink", label: "Руководство" },
    ],
  },
};

describe("<DesignSection /> — new param types (S12-G4 / FR-31a)", () => {
  beforeEach(() => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`)
        return jsonResponse({ templateId: "all-types", params: {} });
      if (url === `/api/templates/all-types`) return jsonResponse(TEMPLATE_WITH_ALL_TYPES);
      return jsonResponse({ error: "unexpected" }, 500);
    });
  });

  it("renders a NumberInput row for `number` params", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    await waitFor(() =>
      expect(screen.getByTestId("design-param-row-maxStudents")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("design-param-input-maxStudents")).toBeInTheDocument();
  });

  it("renders an url Input row for `url` params", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    await waitFor(() =>
      expect(screen.getByTestId("design-param-row-supportUrl")).toBeInTheDocument(),
    );
    const input = screen.getByTestId("design-param-input-supportUrl") as HTMLInputElement;
    expect(input.getAttribute("type")).toBe("url");
  });

  it("renders a multiselect Combobox row for `multiselect` params", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    await waitFor(() =>
      expect(screen.getByTestId("design-param-row-audience")).toBeInTheDocument(),
    );
    // Combobox renders an input inside; the row exists, and no «unsupported»
    // banner is shown — sufficient signal that the multiselect branch fired.
    expect(screen.queryByTestId("design-param-unsupported-audience")).toBeNull();
  });

  it("renders an upload button + hidden file input for `image` params", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    await waitFor(() =>
      expect(screen.getByTestId("design-param-row-logoUrl")).toBeInTheDocument(),
    );
    const fileInput = screen.getByTestId("design-param-input-logoUrl-file") as HTMLInputElement;
    expect(fileInput.getAttribute("type")).toBe("file");
    expect(fileInput.getAttribute("accept")).toContain("image/png");
    // No file chosen yet → no chip.
    expect(screen.queryByTestId("design-param-chip-logoUrl")).toBeNull();
  });

  it("renders an upload button + descriptor for `downloadLink` params", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    await waitFor(() =>
      expect(screen.getByTestId("design-param-row-manualPdf")).toBeInTheDocument(),
    );
    const row = screen.getByTestId("design-param-row-manualPdf");
    expect(row).toHaveTextContent(/Добавить файл/i);
    expect(row).toHaveTextContent(/будет доступен обучающемуся/i);
  });
});
