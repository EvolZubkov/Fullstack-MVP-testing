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
    expect(
      screen.getByTestId("design-param-unsupported-logoUrl"),
    ).toBeInTheDocument();
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
    // Iframe is the body of the modal — verifies the iframe-based embedding
    // (the previous React mock has been replaced — see s12-design-closeout §G2 v2).
    expect(screen.getByTestId("design-template-preview-iframe")).toBeInTheDocument();
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

  it("iframe src points at the preview-page endpoint and forwards draft.params as query overrides", async () => {
    // Pre-load a non-default param so the iframe URL must include it.
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`)
        return jsonResponse({ templateId: "corporate", params: { companyName: "Acme", primaryColor: "180 50% 40%" } });
      if (url === `/api/templates/corporate`) return jsonResponse(TEMPLATE);
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
    await waitFor(() =>
      expect(screen.getByTestId("design-template-preview-iframe")).toBeInTheDocument(),
    );
    const iframe = screen.getByTestId("design-template-preview-iframe") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toMatch(/^\/api\/templates\/corporate\/preview-page\?/);
    expect(iframe.getAttribute("src")).toContain("companyName=Acme");
    expect(iframe.getAttribute("src")).toContain("primaryColor=");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  });
});
