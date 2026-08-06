// @vitest-environment jsdom
/**
 * @module features/tests/editor/sections/__tests__/report-preview-modal
 *
 * PRD-27 Фаза 4 — окно «Предпросмотр отчёта».
 *
 * Ключевое, что пиннится: окно берёт МАКЕТ ШАБЛОНА (FR-17), а не рисует свою вёрстку;
 * переключатель меняет исход (FR-19); в контекст уходят НЕсохранённые значения полей
 * (FR-20); шаблон без макета отчёта объясняет деградацию, а не показывает пустоту.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReportPreviewModal } from "../report-preview-modal";
import type { ReportVariantOption } from "../../use-report-variants";

/** Захваченные вызовы рендерера: окно обязано ходить через него, а не верстать само. */
const rendered: Array<{ layout: string; context: Record<string, unknown>; css?: string }> = [];

vi.mock("@/components/template-screen", () => ({
  TemplateScreen: (props: { layout: string; context: unknown; css?: string }) => {
    rendered.push({
      layout: props.layout,
      context: props.context as Record<string, unknown>,
      css: props.css,
    });
    return <div data-testid="template-screen">{props.layout}</div>;
  },
}));

const BUNDLE = {
  manifest: { params: [], contentTemplates: [] },
  demo: null,
  layouts: {
    report: "<div>КАНОНИЧЕСКИЙ МАКЕТ ОТЧЁТА</div>",
    "report.adaptive": "<div>МАКЕТ УРОВНЕЙ</div>",
    "layouts/report.certificate.html": "<div>МАКЕТ СЕРТИФИКАТА</div>",
  },
  css: ".tb-report { color: red }",
};

/** Шаблон без макета отчёта — деградация FR-10/FR-15. */
const BARE_BUNDLE = { manifest: { params: [] }, demo: null, layouts: {}, css: "" };

function mockFetch(bundle: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => bundle }) as never));
}

const CERTIFICATE: ReportVariantOption = {
  key: "report.certificate",
  kind: "report",
  label: "Сертификат",
  layoutFile: "layouts/report.certificate.html",
};

function renderModal(over: Partial<Parameters<typeof ReportPreviewModal>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReportPreviewModal
        open={over.open ?? true}
        onClose={over.onClose ?? (() => {})}
        mode={over.mode ?? "standard"}
        templateId={over.templateId ?? "default"}
        params={over.params ?? {}}
        variant={over.variant === undefined ? CERTIFICATE : over.variant}
        values={over.values ?? {}}
        testName={over.testName ?? "Сертификация руководителей"}
        sections={over.sections ?? [{ topicId: "t1", topicName: "Управление", questionCount: 10 }]}
        levelNames={over.levelNames}
      />
    </QueryClientProvider>,
  );
}

/** Последний контекст, ушедший в рендерер. */
function lastContext(): Record<string, any> {
  return rendered[rendered.length - 1].context;
}

beforeEach(() => {
  rendered.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("макет берётся у шаблона (FR-17)", () => {
  it("рендерит макет, объявленный ВЫБРАННЫМ вариантом", async () => {
    mockFetch(BUNDLE);
    renderModal();
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    expect(rendered[rendered.length - 1].layout).toContain("МАКЕТ СЕРТИФИКАТА");
  });

  it("без варианта — канонический макет режима (деградация FR-15)", async () => {
    mockFetch(BUNDLE);
    renderModal({ variant: null });
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    expect(rendered[rendered.length - 1].layout).toContain("КАНОНИЧЕСКИЙ МАКЕТ ОТЧЁТА");
  });

  it("адаптивный тест берёт свой макет (D-5)", async () => {
    mockFetch(BUNDLE);
    renderModal({ mode: "adaptive", variant: null });
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    expect(rendered[rendered.length - 1].layout).toContain("МАКЕТ УРОВНЕЙ");
  });

  it("отдаёт рендереру CSS шаблона, а не свой", async () => {
    mockFetch(BUNDLE);
    renderModal();
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    expect(rendered[rendered.length - 1].css).toBe(".tb-report { color: red }");
  });

  it("шаблон без макета отчёта объясняет деградацию, а не показывает пустоту", async () => {
    mockFetch(BARE_BUNDLE);
    renderModal({ variant: null });
    expect(await screen.findByText(/не содержит макета отчёта/)).toBeTruthy();
    expect(screen.queryByTestId("template-screen")).toBeNull();
  });
});

describe("данные предпросмотра", () => {
  it("структура теста — настоящая (FR-18)", async () => {
    mockFetch(BUNDLE);
    renderModal({
      testName: "Мой тест",
      sections: [
        { topicName: "Первый", questionCount: 6 },
        { topicName: "Второй", questionCount: 4 },
      ],
    });
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    const ctx = lastContext();
    expect(ctx.course.title).toBe("Мой тест");
    expect(ctx.result.topicResults.map((t: { topicName: string }) => t.topicName)).toEqual([
      "Первый",
      "Второй",
    ]);
  });

  it("несохранённые значения полей доходят до контекста (FR-20)", async () => {
    mockFetch(BUNDLE);
    renderModal({ values: { headline: "Аттестация 2026" } });
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    expect(lastContext().report.values.headline).toBe("Аттестация 2026");
  });

  it("страница помечена образцом", async () => {
    mockFetch(BUNDLE);
    renderModal();
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    expect(lastContext().report.isPreview).toBe(true);
    expect(screen.getByText("Образец")).toBeTruthy();
  });
});

describe("переключатель исхода (FR-19)", () => {
  it("открывается на непройденном исходе — том, где видны рекомендации", async () => {
    mockFetch(BUNDLE);
    renderModal();
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    expect(lastContext().report.verdictHeadline).toBe("Тест не пройден");
  });

  it("переключение на «Пройден» меняет вердикт страницы", async () => {
    mockFetch(BUNDLE);
    renderModal();
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Пройден" }));
    await waitFor(() => expect(lastContext().report.verdictHeadline).toBe("Тест пройден"));
  });
});

describe("это страница, а не PDF (FR-21)", () => {
  it("не скачивает файл и не растеризует — в окне только страница и «Закрыть»", async () => {
    mockFetch(BUNDLE);
    renderModal();
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    const labels = screen
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").trim())
      .filter(Boolean);
    expect(labels).not.toContain("Скачать");
    expect(labels.some((l) => /скачать|pdf/i.test(l))).toBe(false);
    expect(screen.getByTestId("report-preview-close")).toBeTruthy();
  });

  it("«Закрыть» закрывает окно", async () => {
    mockFetch(BUNDLE);
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(await screen.findByTestId("report-preview-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
