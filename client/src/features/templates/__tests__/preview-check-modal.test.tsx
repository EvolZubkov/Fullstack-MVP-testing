/**
 * @module features/templates/__tests__/preview-check-modal.test
 * @description Tests for the PRD-3 §3.4 preview + health-check modal. The heavy
 * collaborators (the unified renderer, the smoke runner, the preview-context and
 * rail builders, and the admin hooks) are stubbed so the modal's own behaviour is
 * under test: the loading / error states, the rail + stage render, running the
 * client-side check (pass and fail, incl. the failing-variant error list), the
 * footer verdict/gating, posting the report, and firing activation.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AdminTemplate } from "../use-admin-templates";

const h = vi.hoisted(() => ({
  fetchSmokeBundle: vi.fn(),
  activateMutate: vi.fn(),
  postReportMutate: vi.fn(),
  runSmokeChecks: vi.fn(),
  buildScreenInputs: vi.fn(),
  buildRail: vi.fn(),
  activatePending: false,
}));

vi.mock("../use-admin-templates", () => ({
  fetchSmokeBundle: (id: string) => h.fetchSmokeBundle(id),
  useActivateTemplate: () => ({ mutate: h.activateMutate, isPending: h.activatePending }),
  usePostSmokeReport: () => ({ mutate: h.postReportMutate }),
}));
vi.mock("@shared/template/preview-context", () => ({
  buildScreenInputs: (...args: unknown[]) => h.buildScreenInputs(...args),
}));
vi.mock("@shared/template/smoke-runner", () => ({
  runSmokeChecks: (...args: unknown[]) => h.runSmokeChecks(...args),
}));
vi.mock("../preview-rail", () => ({ buildRail: (...args: unknown[]) => h.buildRail(...args) }));
vi.mock("@/components/template-screen", () => ({
  TemplateScreen: () => <div data-testid="template-screen" />,
}));

import { PreviewCheckModal } from "../preview-check-modal";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const specs = [
  { id: "start", route: "start", layoutKey: "start", input: { context: {}, slots: {}, content: {} } },
  { id: "q-single", route: "question", layoutKey: "question", input: { context: {}, slots: {}, content: {} } },
  { id: "q-single-b", route: "question", layoutKey: "question", input: { context: {}, slots: {}, content: {} } },
];

const rail = [
  {
    key: "sec-start",
    label: "Начало",
    types: [{ key: "t-start", label: "Старт", variants: [{ id: "start", label: "Старт" }] }],
  },
  {
    key: "sec-q",
    label: "Вопросы",
    types: [
      {
        key: "t-q",
        label: "Один ответ",
        variants: [
          { id: "q-single", label: "Один ответ" },
          { id: "q-single-b", label: "Вариант B" },
        ],
      },
    ],
  },
];

const bundle = {
  manifest: { preview: {} },
  demo: {},
  layouts: { start: "<div>start</div>", question: "<div>q</div>" },
  css: "",
};

const passReport = {
  ok: true,
  passed: 3,
  total: 3,
  warned: 0,
  failed: 0,
  routes: [
    { id: "start", route: "start", status: "pass", errors: [] },
    { id: "q-single", route: "question", status: "pass", errors: [] },
    { id: "q-single-b", route: "question", status: "pass", errors: [] },
  ],
};
const failReport = {
  ok: false,
  passed: 2,
  total: 3,
  warned: 0,
  failed: 1,
  routes: [
    { id: "start", route: "start", status: "pass", errors: [] },
    { id: "q-single", route: "question", status: "fail", errors: ["Блок «content» не найден"] },
  ],
};

function makeTemplate(overrides: Partial<AdminTemplate> = {}): AdminTemplate {
  return {
    id: "acme",
    name: "Acme",
    description: null,
    version: "1.2.0",
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

// ─── Harness ─────────────────────────────────────────────────────────────────

let bundlePending = false;

beforeEach(() => {
  bundlePending = false;
  h.activatePending = false;
  h.fetchSmokeBundle.mockReset().mockImplementation(async () => {
    if (bundlePending) return new Promise(() => {});
    return bundle;
  });
  h.activateMutate.mockReset();
  h.postReportMutate.mockReset();
  h.runSmokeChecks.mockReset().mockReturnValue(passReport);
  h.buildScreenInputs.mockReset().mockReturnValue(specs);
  h.buildRail.mockReset().mockReturnValue(rail);
});
afterEach(() => vi.clearAllMocks());

function renderModal(template = makeTemplate(), onActivated = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <PreviewCheckModal open onClose={vi.fn()} template={template} onActivated={onActivated} />
    </QueryClientProvider>,
  );
  return { ...utils, onActivated };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("<PreviewCheckModal /> load states", () => {
  it("shows the loading hint while the bundle is fetching", () => {
    bundlePending = true;
    renderModal();
    expect(screen.getByText("Загружаем шаблон…")).toBeInTheDocument();
  });

  it("shows an error banner when the bundle fails to load", async () => {
    h.fetchSmokeBundle.mockRejectedValueOnce(new Error("boom 500"));
    renderModal();
    expect(await screen.findByText("Не удалось загрузить файлы шаблона")).toBeInTheDocument();
    expect(screen.getByText("boom 500")).toBeInTheDocument();
  });
});

describe("<PreviewCheckModal /> rendered bundle", () => {
  it("renders the rail sections and the default-selected stage", async () => {
    renderModal();
    expect(await screen.findByText("Начало")).toBeInTheDocument();
    expect(screen.getByText("Вопросы")).toBeInTheDocument();
    // Collapsible group with two render variants.
    expect(screen.getByText("Вариант B")).toBeInTheDocument();
    // Default screen renders through the (stubbed) unified renderer.
    expect(screen.getByTestId("template-screen")).toBeInTheDocument();
  });

  it("starts with the not-checked verdict and activation disabled", async () => {
    renderModal();
    await screen.findByText("Начало");
    expect(screen.getByText("Проверка работоспособности не запускалась")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Активировать/ })).toBeDisabled();
  });

  it("selecting a rail variant updates the stage caption", async () => {
    renderModal();
    await screen.findByText("Вариант B");
    // Default selection is the first spec (route "start"); its route code shows
    // in the caption. Selecting «Вариант B» switches the caption to "question".
    expect(screen.getByText("start")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Вариант B"));
    await waitFor(() => expect(screen.getByText("question")).toBeInTheDocument());
    expect(screen.queryByText("start")).not.toBeInTheDocument();
  });
});

describe("<PreviewCheckModal /> health check", () => {
  it("runs a passing check, posts the report and unlocks activation", async () => {
    renderModal();
    await screen.findByText("Начало");
    fireEvent.click(screen.getByRole("button", { name: "Проверить работоспособность" }));
    expect(await screen.findByText(/Проверка пройдена/)).toBeInTheDocument();
    expect(screen.getByText("Активация доступна")).toBeInTheDocument();
    expect(h.postReportMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "acme", report: passReport }),
    );
    expect(screen.getByRole("button", { name: /Активировать/ })).not.toBeDisabled();
  });

  it("runs a failing check, blocks activation and lists the failing variant errors", async () => {
    h.runSmokeChecks.mockReturnValue(failReport);
    renderModal();
    await screen.findByText("Начало");
    fireEvent.click(screen.getByRole("button", { name: "Проверить работоспособность" }));
    expect(await screen.findByText(/Проверка не пройдена/)).toBeInTheDocument();
    expect(screen.getByText("Активация заблокирована")).toBeInTheDocument();
    // The first failing variant is auto-selected and its errors are shown.
    expect(await screen.findByText("Блок «content» не найден")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Активировать/ })).toBeDisabled();
  });

  it("shows «Перепроверить» once a report exists", async () => {
    const template = makeTemplate({ smokeTestJson: passReport as unknown as AdminTemplate["smokeTestJson"] });
    renderModal(template);
    await screen.findByText("Начало");
    expect(screen.getByRole("button", { name: "Перепроверить" })).toBeInTheDocument();
  });
});

describe("<PreviewCheckModal /> activation", () => {
  it("fires activation when a passing report allows it", async () => {
    const template = makeTemplate({ smokeTestJson: passReport as unknown as AdminTemplate["smokeTestJson"] });
    const { onActivated } = renderModal(template);
    await screen.findByText("Начало");
    const btn = screen.getByRole("button", { name: /Активировать/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(h.activateMutate).toHaveBeenCalledWith("acme", expect.objectContaining({ onSuccess: expect.any(Function) }));
    // Invoke the onSuccess passed to mutate to prove the callback is wired.
    const opts = h.activateMutate.mock.calls[0][1] as { onSuccess: () => void };
    opts.onSuccess();
    expect(onActivated).toHaveBeenCalled();
  });

  it("shows the «Шаблон активен» verdict for an already-active template", async () => {
    renderModal(makeTemplate({ status: "active", isActive: true }));
    await screen.findByText("Начало");
    expect(screen.getByText("Шаблон активен")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Активирован/ })).toBeDisabled();
  });

  it("allows activating a built-in template without a report", async () => {
    renderModal(makeTemplate({ id: "default", name: "Стандартный", isBuiltin: true }));
    await screen.findByText("Начало");
    expect(screen.getByRole("button", { name: /^Активировать$/ })).not.toBeDisabled();
  });
});
