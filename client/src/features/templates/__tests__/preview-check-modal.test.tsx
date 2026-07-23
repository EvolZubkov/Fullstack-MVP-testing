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
// Only the grouping builder is stubbed; the worst-of roll-up (`variantStatus`) is
// the real one, so the group dot is exercised rather than mocked away.
vi.mock("../preview-rail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../preview-rail")>()),
  buildRail: (...args: unknown[]) => h.buildRail(...args),
}));
// The stub stands in for the rendered screen's own «Далее»/«Назад», which the real
// renderer delegates to `onAction` as `nav:next` / `nav:prev`.
vi.mock("@/components/template-screen", () => ({
  TemplateScreen: ({ onAction }: { onAction?: (action: string) => void }) => (
    <div data-testid="template-screen">
      <button type="button" onClick={() => onAction?.("nav:next")}>
        demo-next
      </button>
      <button type="button" onClick={() => onAction?.("nav:prev")}>
        demo-prev
      </button>
    </div>
  ),
}));

import { PreviewCheckModal } from "../preview-check-modal";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const specs = [
  { id: "start", route: "start", layoutKey: "start", input: { context: {}, slots: {}, content: {} } },
  { id: "q-single", route: "question", layoutKey: "question", input: { context: {}, slots: {}, content: {} } },
  { id: "q-single-b", route: "question", layoutKey: "question", input: { context: {}, slots: {}, content: {} } },
];

// Раздел → Вариант → демонстрации. «Начало» holds a one-demo variant (rendered as
// a leaf); «Вопросы» holds a variant with two demonstrations (collapsible group).
const rail = [
  {
    key: "sec-start",
    label: "Начало",
    variants: [
      {
        key: "t-start",
        label: "Старт",
        fromManifest: false,
        screens: [{ id: "start", route: "start", label: "Экран старта", spec: specs[0] }],
      },
    ],
  },
  {
    key: "sec-q",
    label: "Вопросы",
    variants: [
      {
        key: "v:q.card",
        label: "Один ответ карточками",
        fromManifest: true,
        screens: [
          { id: "q-single", route: "question", label: "Один ответ", spec: specs[1] },
          { id: "q-single-b", route: "question", label: "Вариант B", spec: specs[2] },
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
    {
      id: "q-single",
      route: "question",
      status: "fail",
      errors: ["Блок «content» не найден"],
      warnings: ["Поле «title» не попадёт на экран"],
    },
  ],
};
const warnReport = {
  ok: true,
  passed: 2,
  total: 3,
  warned: 1,
  failed: 0,
  routes: [
    { id: "start", route: "start", status: "warn", errors: [], warnings: ["Макет не объявляет область для поля «lead»"] },
    { id: "q-single", route: "question", status: "pass", errors: [], warnings: [] },
    { id: "q-single-b", route: "question", status: "pass", errors: [], warnings: [] },
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

describe("<PreviewCheckModal /> variant rail (Э3)", () => {
  it("names the middle rail level after the manifest variant", async () => {
    renderModal();
    expect(await screen.findByText("Один ответ карточками")).toBeInTheDocument();
    // A one-demonstration variant IS the leaf: it carries the variant name, not
    // the name of its single demonstration.
    expect(screen.getByText("Старт")).toBeInTheDocument();
    expect(screen.queryByText("Экран старта")).not.toBeInTheDocument();
  });

  it("counts the demonstrations of the selected variant under the stage", async () => {
    renderModal();
    await screen.findByText("Вариант B");
    // The default screen's variant has a single demonstration — no counter.
    expect(screen.queryByText(/слайд/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Один ответ"));
    expect(await screen.findByText(/слайд 1 из 2/)).toBeInTheDocument();
  });

  it("the screen's own «Далее»/«Назад» leaf through the demonstrations, wrapping around", async () => {
    renderModal();
    await screen.findByText("Вариант B");
    fireEvent.click(screen.getByText("Один ответ"));
    await screen.findByText(/слайд 1 из 2/);

    fireEvent.click(screen.getByRole("button", { name: "demo-next" }));
    expect(await screen.findByText(/слайд 2 из 2/)).toBeInTheDocument();
    // Wrap forward, then step back the other way.
    fireEvent.click(screen.getByRole("button", { name: "demo-next" }));
    expect(await screen.findByText(/слайд 1 из 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "demo-prev" }));
    expect(await screen.findByText(/слайд 2 из 2/)).toBeInTheDocument();
  });

  it("navigation is inert on a variant with a single demonstration", async () => {
    renderModal();
    await screen.findByText("Старт");
    fireEvent.click(screen.getByRole("button", { name: "demo-next" }));
    await waitFor(() => expect(screen.getByText("start")).toBeInTheDocument());
    expect(screen.queryByText(/слайд/)).not.toBeInTheDocument();
  });

  it("the variant dot reports the worst status of its demonstrations", async () => {
    h.runSmokeChecks.mockReturnValue({
      ok: false,
      passed: 2,
      total: 3,
      warned: 0,
      failed: 1,
      routes: [
        { id: "start", route: "start", status: "pass", errors: [], warnings: [] },
        { id: "q-single", route: "question", status: "pass", errors: [], warnings: [] },
        { id: "q-single-b", route: "question", status: "fail", errors: ["Нет блока"], warnings: [] },
      ],
    });
    renderModal();
    await screen.findByText("Вариант B");
    fireEvent.click(screen.getByRole("button", { name: "Проверить работоспособность" }));
    await screen.findByText(/Проверка не пройдена/);
    // The group is collapsible, so a failing slide must not hide behind a green dot.
    const groupDot = document.querySelector(".tpl-check-rail__type .tpl-check-dot");
    expect(groupDot?.className).toContain("tpl-check-dot--fail");
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

  it("lists the warnings of the selected variant (Э2: warn text is readable)", async () => {
    h.runSmokeChecks.mockReturnValue(warnReport);
    renderModal();
    await screen.findByText("Начало");
    fireEvent.click(screen.getByRole("button", { name: "Проверить работоспособность" }));
    expect(await screen.findByText(/Проверка пройдена/)).toBeInTheDocument();
    // The default-selected screen is the warned one — its warnings are spelled out,
    // not merely counted by the summary banner.
    expect(await screen.findByText("Макет не объявляет область для поля «lead»")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Активировать/ })).not.toBeDisabled();
  });

  it("shows errors and warnings side by side on a failing variant", async () => {
    h.runSmokeChecks.mockReturnValue(failReport);
    renderModal();
    await screen.findByText("Начало");
    fireEvent.click(screen.getByRole("button", { name: "Проверить работоспособность" }));
    expect(await screen.findByText("Блок «content» не найден")).toBeInTheDocument();
    expect(screen.getByText("Поле «title» не попадёт на экран")).toBeInTheDocument();
  });

  it("tolerates a legacy report whose routes carry no warnings array", async () => {
    h.runSmokeChecks.mockReturnValue(passReport);
    renderModal();
    await screen.findByText("Начало");
    fireEvent.click(screen.getByRole("button", { name: "Проверить работоспособность" }));
    expect(await screen.findByText(/Проверка пройдена/)).toBeInTheDocument();
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
