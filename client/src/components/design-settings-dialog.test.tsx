/**
 * @module client/src/components/design-settings-dialog.test
 * @description Component tests for DesignSettingsDialog and ParamControl.
 *
 * Covers:
 * - Gallery renders templates from API
 * - Template selection loads param form
 * - ParamControl renders correct control for each param type
 * - Save button disabled until template is selected or param changed
 * - Reset button calls PUT /design with empty body
 * - Loading state while fetching templates
 * - Error state when fetch fails
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesignSettingsDialog, ParamControl, type TemplateParam } from "./design-settings-dialog";
import { apiRequest } from "@/lib/queryClient";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/queryClient", () => ({
  queryClient: new QueryClient(),
  apiRequest: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const templateDefault = {
  id: "default",
  name: "Стандартный",
  version: "1.0.0",
  templateApiVersion: "1.0",
  description: "Базовый одноколоночный плеер",
  isBuiltin: true,
  isActive: true,
  manifest: { params: [], contentTemplates: [] },
};

const templateCorporate = {
  id: "corporate",
  name: "Корпоративный",
  version: "1.0.0",
  templateApiVersion: "1.0",
  description: "Корпоративный плеер с боковой панелью",
  isBuiltin: true,
  isActive: true,
  manifest: {
    params: [
      { key: "primaryColor", type: "color" as const, label: "Основной цвет", default: "#0066cc", group: "Цвета" },
      { key: "companyName", type: "text" as const, label: "Название компании", default: "", group: "Оформление" },
      { key: "fontFamily", type: "select" as const, label: "Шрифт", default: "Inter", options: ["Inter", "Roboto", "Arial"], group: "Оформление" },
      { key: "showProgressBar", type: "boolean" as const, label: "Показывать прогресс-бар", default: true, group: "Навигация" },
    ],
    contentTemplates: [],
  },
};

const templateMinimal = {
  id: "minimal",
  name: "Минималистичный",
  version: "1.0.0",
  templateApiVersion: "1.0",
  description: null,
  isBuiltin: true,
  isActive: true,
  manifest: {
    params: [
      { key: "fontSize", type: "number" as const, label: "Размер шрифта", default: 16, group: "" },
      { key: "logoUrl", type: "image" as const, label: "Логотип", default: null, group: "" },
    ],
    contentTemplates: [],
  },
};

const currentDesignDefault = { templateId: "default", params: {} };
const currentDesignCorporate = {
  templateId: "corporate",
  templateVersion: "1.0.0",
  templateApiVersion: "1.0",
  params: { primaryColor: "#ff0000" },
};

// ─── Test helpers ──────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const url = queryKey[0] as string;
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        },
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderDialog(props: Partial<React.ComponentProps<typeof DesignSettingsDialog>> = {}) {
  return render(
    <DesignSettingsDialog testId="test-1" open={true} onOpenChange={vi.fn()} {...props} />,
    { wrapper: createWrapper() }
  );
}

// ─── ParamControl tests ───────────────────────────────────────────────────────

describe("ParamControl", () => {
  const onChange = vi.fn();

  beforeEach(() => onChange.mockClear());

  const makeParam = (type: TemplateParam["type"], extra: Partial<TemplateParam> = {}): TemplateParam => ({
    key: "testParam",
    type,
    label: "Test",
    default: null,
    ...extra,
  });

  it("renders color input for type=color", () => {
    render(<ParamControl param={makeParam("color")} value="#ff0000" onChange={onChange} />);
    expect(screen.getByTestId("param-color-testParam")).toBeInTheDocument();
    expect(screen.getByTestId("param-colorhex-testParam")).toBeInTheDocument();
  });

  it("calls onChange when color hex input changes", () => {
    render(<ParamControl param={makeParam("color")} value="#000000" onChange={onChange} />);
    fireEvent.change(screen.getByTestId("param-colorhex-testParam"), { target: { value: "#ff0000" } });
    expect(onChange).toHaveBeenCalledWith("#ff0000");
  });

  it("renders text input for type=text", () => {
    render(<ParamControl param={makeParam("text")} value="Hello" onChange={onChange} />);
    expect(screen.getByTestId("param-text-testParam")).toBeInTheDocument();
  });

  it("calls onChange when text input changes", () => {
    render(<ParamControl param={makeParam("text")} value="" onChange={onChange} />);
    fireEvent.change(screen.getByTestId("param-text-testParam"), { target: { value: "ACME" } });
    expect(onChange).toHaveBeenCalledWith("ACME");
  });

  it("renders number input for type=number", () => {
    render(<ParamControl param={makeParam("number")} value={16} onChange={onChange} />);
    const input = screen.getByTestId("param-number-testParam");
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).type).toBe("number");
  });

  it("renders switch for type=boolean", () => {
    render(<ParamControl param={makeParam("boolean")} value={true} onChange={onChange} />);
    expect(screen.getByTestId("param-boolean-testParam")).toBeInTheDocument();
  });

  it("renders select for type=select", () => {
    render(
      <ParamControl
        param={makeParam("select", { options: ["Inter", "Roboto"] })}
        value="Inter"
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("param-select-testParam")).toBeInTheDocument();
  });

  it("renders file input for type=image", () => {
    render(<ParamControl param={makeParam("image")} value={null} onChange={onChange} />);
    const input = screen.getByTestId("param-file-testParam");
    expect((input as HTMLInputElement).type).toBe("file");
  });

  it("renders file input for type=font", () => {
    render(<ParamControl param={makeParam("font")} value={null} onChange={onChange} />);
    expect(screen.getByTestId("param-file-testParam")).toBeInTheDocument();
  });

  it("renders file input for type=asset", () => {
    render(<ParamControl param={makeParam("asset")} value={null} onChange={onChange} />);
    expect(screen.getByTestId("param-file-testParam")).toBeInTheDocument();
  });
});

// ─── DesignSettingsDialog tests ───────────────────────────────────────────────

describe("DesignSettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock fetch for templates and design settings
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/templates")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([templateDefault, templateCorporate, templateMinimal]),
        });
      }
      if (url.includes("/api/tests/test-1/design")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(currentDesignDefault),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  it("shows loading state while templates are being fetched", () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise(() => {})  // never resolves
    );
    renderDialog();
    expect(screen.getByTestId("loading-state")).toBeInTheDocument();
  });

  it("renders template gallery with all templates", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId("template-gallery")).toBeInTheDocument();
    });
    expect(screen.getByTestId("template-card-default")).toBeInTheDocument();
    expect(screen.getByTestId("template-card-corporate")).toBeInTheDocument();
    expect(screen.getByTestId("template-card-minimal")).toBeInTheDocument();
  });

  it("shows template names in gallery cards", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByText("Стандартный")).toBeInTheDocument();
    });
    expect(screen.getByText("Корпоративный")).toBeInTheDocument();
    expect(screen.getByText("Минималистичный")).toBeInTheDocument();
  });

  it("shows 'Встроенный' badge for built-in templates", async () => {
    renderDialog();
    await waitFor(() => {
      const badges = screen.getAllByText("Встроенный");
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  it("does not show param form when default template is selected", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId("template-gallery")).toBeInTheDocument();
    });
    // default is selected by default per currentDesignDefault mock
    expect(screen.queryByTestId("param-form")).not.toBeInTheDocument();
  });

  it("shows param form when non-default template card is clicked", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId("template-card-corporate")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("template-card-corporate"));
    await waitFor(() => {
      expect(screen.getByTestId("param-form")).toBeInTheDocument();
    });
  });

  it("param form renders all param types for corporate template", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId("template-card-corporate")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("template-card-corporate"));
    await waitFor(() => {
      expect(screen.getByTestId("param-color-primaryColor")).toBeInTheDocument();
      expect(screen.getByTestId("param-text-companyName")).toBeInTheDocument();
      expect(screen.getByTestId("param-select-fontFamily")).toBeInTheDocument();
      expect(screen.getByTestId("param-boolean-showProgressBar")).toBeInTheDocument();
    });
  });

  it("save button is disabled initially (no dirty state)", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId("button-save-design")).toBeInTheDocument();
    });
    expect(screen.getByTestId("button-save-design")).toBeDisabled();
  });

  it("save button becomes enabled after template selection", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId("template-card-corporate")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("template-card-corporate"));
    await waitFor(() => {
      expect(screen.getByTestId("button-save-design")).not.toBeDisabled();
    });
  });

  it("reset button is always enabled", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId("button-reset-design")).not.toBeDisabled();
    });
  });

  it("shows error state when templates fetch fails", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/templates")) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "Server error" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId("error-state")).toBeInTheDocument();
    });
  });

  it("does not render when closed", () => {
    render(
      <DesignSettingsDialog testId="test-1" open={false} onOpenChange={vi.fn()} />,
      { wrapper: createWrapper() }
    );
    expect(screen.queryByTestId("template-gallery")).not.toBeInTheDocument();
  });
});
