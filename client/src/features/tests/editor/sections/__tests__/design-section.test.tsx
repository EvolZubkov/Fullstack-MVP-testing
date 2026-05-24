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

  it("shows the «следующий шаг» stub for Layout and Progress panes", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-layout"));
    expect(screen.getByTestId("design-stub-layout")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("design-rail-progress"));
    expect(screen.getByTestId("design-stub-progress")).toBeInTheDocument();
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

  it("«Сбросить до умолчаний» enables the save button (dirty draft)", async () => {
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
    expect(screen.getByTestId("design-save")).toBeDisabled();
    fireEvent.click(screen.getByTestId("design-template-reset"));
    await waitFor(() =>
      expect(screen.getByTestId("design-save")).not.toBeDisabled(),
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

  it("editing a text param marks the draft dirty and enables save", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    fireEvent.change(screen.getByTestId("design-param-input-companyName"), {
      target: { value: "Acme" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("design-save")).not.toBeDisabled(),
    );
    expect(
      (screen.getByTestId("design-param-input-companyName") as HTMLInputElement).value,
    ).toBe("Acme");
  });

  it("toggling a boolean param marks the draft dirty", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    fireEvent.click(screen.getByTestId("design-param-input-showProgressBar"));
    await waitFor(() =>
      expect(screen.getByTestId("design-save")).not.toBeDisabled(),
    );
  });

  it("changing a select param marks the draft dirty", async () => {
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    const wrap = screen.getByTestId("design-param-input-fontFamily");
    fireEvent.click(within(wrap).getByRole("button"));
    fireEvent.click(screen.getByRole("option", { name: "Roboto" }));
    await waitFor(() =>
      expect(screen.getByTestId("design-save")).not.toBeDisabled(),
    );
  });
});

describe("<DesignSection /> — save flow", () => {
  it("PUTs the current draft to /api/tests/:id/design and clears the dirty state", async () => {
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
    renderWithClient(<DesignSection testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("design-template-pane")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    fireEvent.change(screen.getByTestId("design-param-input-companyName"), {
      target: { value: "Acme" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("design-save")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("design-save"));
    await waitFor(() =>
      expect(screen.getByTestId("design-save")).toBeDisabled(),
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
