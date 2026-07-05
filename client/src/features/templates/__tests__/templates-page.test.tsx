/**
 * @module features/templates/__tests__/templates-page.test
 * @description Tests for the PRD-3 admin template registry page. Exercises the
 * loading / error / empty states, the card grid (names, built-in tag, status +
 * health badges, version), the toolbar count, opening the upload modal, and the
 * per-card action menu switching the modal state (details / preview) and firing
 * activation. The heavy child modals are stubbed so the page's own wiring is
 * what is under test.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { AdminTemplate } from "../use-admin-templates";

// Stub the heavy child modals: we only assert that the page opens them.
vi.mock("../upload-modal", () => ({
  UploadModal: ({ open }: { open: boolean }) => (open ? <div data-testid="upload-modal" /> : null),
}));
vi.mock("../details-modal", () => ({
  DetailsModal: ({ open }: { open: boolean }) => (open ? <div data-testid="details-modal" /> : null),
}));
vi.mock("../preview-check-modal", () => ({
  PreviewCheckModal: ({ open }: { open: boolean }) => (open ? <div data-testid="preview-modal" /> : null),
}));
vi.mock("../update-modal", () => ({
  UpdateModal: ({ open }: { open: boolean }) => (open ? <div data-testid="update-modal" /> : null),
}));

import { TemplatesPage } from "../templates-page";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<AdminTemplate> = {}): AdminTemplate {
  return {
    id: "tpl",
    name: "Template",
    description: null,
    version: "1.0.0",
    templateApiVersion: "1",
    isBuiltin: false,
    isActive: false,
    status: "draft",
    sourceType: "uploaded",
    sourcePath: null,
    manifest: { assets: {} },
    validationJson: null,
    smokeTestJson: null,
    installedAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

const okReport = { ok: true, passed: 5, total: 5, warned: 0, failed: 0, routes: [] };

const builtin = makeTemplate({
  id: "default",
  name: "Стандартный",
  isBuiltin: true,
  isActive: true,
  status: "active",
  sourceType: "builtin",
  manifest: { assets: { preview: "preview.png" } },
});
const uploadedActive = makeTemplate({
  id: "acme",
  name: "Acme",
  isActive: true,
  status: "active",
  validationJson: { ok: true, blocking: [], warnings: [] },
  smokeTestJson: okReport as AdminTemplate["smokeTestJson"],
});
const uploadedDraft = makeTemplate({
  id: "beta",
  name: "Beta",
  status: "draft",
  validationJson: { ok: true, blocking: [], warnings: [] },
  smokeTestJson: okReport as AdminTemplate["smokeTestJson"],
});

// ─── Fetch harness ───────────────────────────────────────────────────────────

let listBody: AdminTemplate[] | null = [];
let listStatus = 200;
let pending = false;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listBody = [builtin, uploadedActive, uploadedDraft];
  listStatus = 200;
  pending = false;
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u === "/api/admin/templates") {
      if (pending) return new Promise(() => {}) as unknown as Response;
      return {
        ok: listStatus < 400,
        status: listStatus,
        json: async () => listBody,
        text: async () => JSON.stringify(listBody),
      } as unknown as Response;
    }
    // Everything else (details, activate, ...) resolves ok.
    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TemplatesPage />
    </QueryClientProvider>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("<TemplatesPage /> states", () => {
  it("shows the loading placeholder while the list is fetching", () => {
    pending = true;
    renderPage();
    expect(screen.getByText("Загружаем шаблоны…")).toBeInTheDocument();
  });

  it("shows an error banner when the list request fails", async () => {
    listStatus = 500;
    renderPage();
    expect(await screen.findByText("Не удалось загрузить шаблоны")).toBeInTheDocument();
  });

  it("shows the empty state when there are no templates", async () => {
    listBody = [];
    renderPage();
    expect(await screen.findByText(/Шаблоны не найдены/)).toBeInTheDocument();
  });
});

describe("<TemplatesPage /> card grid", () => {
  it("renders a card per template with names, the built-in tag and the count", async () => {
    renderPage();
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Стандартный")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    // Built-in tag on the default template.
    expect(screen.getByText("Встроенный")).toBeInTheDocument();
    // Toolbar count.
    expect(screen.getByText("3 шаблон(ов) в реестре")).toBeInTheDocument();
    // Version tag rendered on every card.
    expect(screen.getAllByText("v1.0.0").length).toBeGreaterThanOrEqual(3);
  });

  it("renders the health badge from the smoke report", async () => {
    renderPage();
    await screen.findByText("Acme");
    expect(screen.getAllByText(/Пройдена · 5\/5 экранов/).length).toBeGreaterThanOrEqual(1);
  });
});

describe("<TemplatesPage /> interactions", () => {
  it("opens the upload modal from the toolbar", async () => {
    renderPage();
    await screen.findByText("Acme");
    fireEvent.click(screen.getByRole("button", { name: "Загрузить шаблон" }));
    expect(screen.getByTestId("upload-modal")).toBeInTheDocument();
  });

  it("opens the details modal from a card action menu", async () => {
    renderPage();
    await screen.findByText("Acme");
    fireEvent.click(screen.getByRole("button", { name: "Действия: Acme" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Детали/ }));
    expect(screen.getByTestId("details-modal")).toBeInTheDocument();
  });

  it("opens the preview modal from a card action menu", async () => {
    renderPage();
    await screen.findByText("Acme");
    fireEvent.click(screen.getByRole("button", { name: "Действия: Acme" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Предпросмотр и проверка/ }));
    expect(screen.getByTestId("preview-modal")).toBeInTheDocument();
  });

  it("activates a draft template from its action menu", async () => {
    renderPage();
    await screen.findByText("Beta");
    fireEvent.click(screen.getByRole("button", { name: "Действия: Beta" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Активировать/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/templates/beta/activate",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });

  it("does not offer «Активировать» for a not-yet-checked draft", async () => {
    listBody = [makeTemplate({ id: "raw", name: "Raw", status: "draft" })];
    renderPage();
    await screen.findByText("Raw");
    fireEvent.click(screen.getByRole("button", { name: "Действия: Raw" }));
    await screen.findByRole("menuitem", { name: /Детали/ });
    expect(screen.queryByRole("menuitem", { name: /^Активировать$/ })).not.toBeInTheDocument();
  });

  it("opens the update modal from a card action menu", async () => {
    renderPage();
    await screen.findByText("Acme");
    fireEvent.click(screen.getByRole("button", { name: "Действия: Acme" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Обновить/ }));
    expect(screen.getByTestId("update-modal")).toBeInTheDocument();
  });

  it("opens the deactivate confirm and fires deactivation on confirm", async () => {
    renderPage();
    await screen.findByText("Acme");
    fireEvent.click(screen.getByRole("button", { name: "Действия: Acme" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Деактивировать/ }));
    expect(await screen.findByText("Деактивировать «Acme»?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Деактивировать" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/templates/acme/deactivate",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });

  it("opens the delete confirm for an inactive uploaded template", async () => {
    renderPage();
    await screen.findByText("Beta");
    fireEvent.click(screen.getByRole("button", { name: "Действия: Beta" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Удалить/ }));
    expect(await screen.findByText("Удалить «Beta»?")).toBeInTheDocument();
    // Confirm stays disabled until the usage-count details query resolves.
    await waitFor(() => expect(screen.getByRole("button", { name: "Удалить" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/templates/beta",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("triggers a ZIP download via a transient anchor on «Экспортировать ZIP»", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPage();
    await screen.findByText("Acme");
    fireEvent.click(screen.getByRole("button", { name: "Действия: Acme" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Экспортировать ZIP/ }));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
