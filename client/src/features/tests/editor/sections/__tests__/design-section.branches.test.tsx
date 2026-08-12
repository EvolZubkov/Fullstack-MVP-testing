/**
 * @module features/tests/editor/sections/__tests__/design-section.branches.test
 * @description Branch-coverage tests for the «Оформление» tab
 * ({@link module:features/tests/editor/sections/design-section}). The reference
 * suite drives the real `useDesignSettings` hook and so never reaches the
 * loading / error / save-error notices, the manifest-fallback ternaries in the
 * template card, the default-value branches of every `ParamRow` type, or the
 * `MediaParamRow` upload state machine (oversize guard, HTTP failure, network
 * rejection, uploading spinner, stored-file chips). This file feeds a fabricated
 * `design` prop straight into `DesignSection` (the `designProp` short-circuits
 * the internal hook) to pin those states deterministically, and mocks
 * `/api/media/upload` for the upload paths.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesignSection } from "../design-section";
import type {
  TemplateParam,
  TemplateRow,
  UseDesignSettingsResult,
} from "../../use-design-settings";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TEST_ID = "te-1";

function templateRow(over: Partial<TemplateRow> = {}, manifest: Partial<TemplateRow["manifest"]> = {}): TemplateRow {
  return {
    id: "corporate",
    name: "Корпоративный",
    description: "Боковая панель",
    version: "1.2.0",
    templateApiVersion: "1.0",
    isBuiltin: true,
    isActive: true,
    previewPath: null,
    ...over,
    manifest: {
      id: "corporate",
      name: "Корпоративный",
      version: "1.2.0",
      description: "Боковая панель",
      templateApiVersion: "1.0",
      params: [],
      ...manifest,
    },
  };
}

/** A fully-formed hook result; override only the fields a test cares about. */
function makeDesign(over: Partial<UseDesignSettingsResult> = {}): UseDesignSettingsResult {
  return {
    isLoading: false,
    error: null,
    template: templateRow(),
    draft: { templateId: "corporate", params: {} },
    isDirty: false,
    templateMissing: false,
    templateOutdated: false,
    setParam: vi.fn(),
    clearParam: vi.fn(),
    themes: [],
    theme: "auto",
    setTheme: vi.fn(),
    themeParams: {},
    setThemeParam: vi.fn(),
    clearThemeParam: vi.fn(),
    resetToDefaults: vi.fn(),
    setTemplate: vi.fn(),
    applyDefaultTemplate: vi.fn(),
    refreshTemplateVersion: vi.fn(),
    revert: vi.fn(),
    save: vi.fn(async () => ({ templateId: "corporate" })),
    isSaving: false,
    saveError: null,
    ...over,
  };
}

function renderSection(design: UseDesignSettingsResult) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DesignSection testId={TEST_ID} design={design} />
    </QueryClientProvider>,
  );
}

/**
 * Render a template with the given params + preloaded draft values, and open the
 * section that holds them. PRD-23 split the old single «Брендирование» pane: a
 * colour param now lives in «Цвета», everything else stays put — so a fixture of
 * colours alone opens on «Цвета».
 */
function renderBranding(
  params: TemplateParam[],
  params_values: Record<string, unknown> = {},
  rail: "branding" | "colors" = params.every((p) => p.type === "color") ? "colors" : "branding",
) {
  const design = makeDesign({
    template: templateRow({}, { params }),
    draft: { templateId: "corporate", params: params_values },
  });
  const result = renderSection(design);
  fireEvent.click(screen.getByTestId(`design-rail-${rail}`));
  return { design, ...result };
}

beforeEach(() => {
  // Default: no unexpected network. Individual upload tests re-stub fetch.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

// ─── Loading / error / save-error notices ──────────────────────────────────

describe("<DesignSection /> — status notices", () => {
  it("renders the loading banner while design is loading", () => {
    renderSection(makeDesign({ isLoading: true }));
    expect(screen.getByTestId("design-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("design-template-pane")).toBeNull();
  });

  it("renders the error banner when a query failed", () => {
    renderSection(makeDesign({ error: new Error("сеть недоступна"), template: null }));
    const banner = screen.getByTestId("design-error");
    expect(banner).toHaveTextContent("Не удалось загрузить оформление");
    expect(banner).toHaveTextContent("сеть недоступна");
  });

  it("surfaces the save error under the template card", () => {
    renderSection(makeDesign({ saveError: new Error("сохранение отклонено") }));
    expect(screen.getByTestId("design-save-error")).toHaveTextContent("сохранение отклонено");
  });
});

// ─── Null template — panes render nothing but the empty-desc ternaries fire ──

describe("<DesignSection /> — null template", () => {
  it("renders no card and no pane bodies across every rail when template is null", () => {
    renderSection(makeDesign({ template: null }));
    // Template pane sub-component returns null.
    expect(screen.queryByTestId("design-template-pane")).toBeNull();
    // Visiting each content rail computes its emptyDesc with the `?? ""` fallback;
    // «Цвета» takes the `if (!tpl) return null` guard of ColorsPane.
    for (const rail of ["branding", "colors", "layout", "progress"] as const) {
      fireEvent.click(screen.getByTestId(`design-rail-${rail}`));
      expect(screen.queryByTestId(`design-${rail}-pane`)).toBeNull();
    }
  });
});

// ─── Template card — manifest fallbacks ─────────────────────────────────────

describe("<DesignSection /> — template card manifest fallbacks", () => {
  it("falls back to the row's name/version and outdated banner uses them", () => {
    const design = makeDesign({
      templateOutdated: true,
      template: templateRow(
        { name: "Резервное имя", version: "9.9.9", description: "Резервное описание" },
        { name: undefined, version: undefined, description: undefined },
      ),
    });
    renderSection(design);
    expect(screen.getByTestId("design-template-outdated")).toHaveTextContent("Резервное имя");
    expect(screen.getByTestId("design-template-outdated")).toHaveTextContent("v9.9.9");
    expect(screen.getByTestId("design-template-name")).toHaveTextContent("Резервное имя");
    expect(screen.getByTestId("design-template-version")).toHaveTextContent("v9.9.9");
    expect(screen.getByTestId("design-template-desc")).toHaveTextContent("Резервное описание");
  });

  it("uses the default description text when neither manifest nor row supplies one", () => {
    renderSection(
      makeDesign({
        template: templateRow(
          { description: null, isBuiltin: false },
          { description: undefined },
        ),
      }),
    );
    expect(screen.getByTestId("design-template-desc")).toHaveTextContent("Описание не указано.");
    // isBuiltin=false → no «Встроенный» tag.
    expect(screen.queryByTestId("design-template-builtin")).toBeNull();
  });
});

// ─── paramsBySection — explicit section assignment ──────────────────────────

describe("<DesignSection /> — explicit param sections", () => {
  it("routes a param with an explicit `section` to the Макет pane", () => {
    const design = makeDesign({
      template: templateRow({}, {
        params: [{ key: "cols", type: "text", label: "Колонки", section: "layout" }],
      }),
    });
    renderSection(design);
    // PRD-23: branding holds nothing, so it is not offered at all.
    expect(screen.queryByTestId("design-rail-branding")).toBeNull();
    // Layout carries the param row.
    fireEvent.click(screen.getByTestId("design-rail-layout"));
    expect(screen.getByTestId("design-param-row-cols")).toBeInTheDocument();
  });
});

// ─── ParamRow — default-value branches ──────────────────────────────────────

describe("<DesignSection /> — ParamRow default-value branches", () => {
  it("color falls back to the param default when no value is stored", () => {
    renderBranding([
      { key: "brand", type: "color", label: "Цвет", default: "10 20% 30%" },
    ]);
    expect(screen.getByTestId("design-param-row-brand")).toBeInTheDocument();
    expect(screen.getByTestId("design-param-input-brand")).toBeInTheDocument();
  });

  it("boolean falls back to the param default (true) when no value is stored", () => {
    renderBranding([
      { key: "showBar", type: "boolean", label: "Прогресс", default: true },
    ]);
    expect((screen.getByTestId("design-param-input-showBar") as HTMLInputElement).checked).toBe(true);
  });

  it("select falls back to the param default, else the first option, else empty", () => {
    renderBranding([
      { key: "withDefault", type: "select", label: "С умолчанием", options: ["S", "M"], default: "M" },
      { key: "noDefault", type: "select", label: "Без умолчания", options: ["X", "Y"] },
    ]);
    expect(screen.getByTestId("design-param-input-withDefault")).toHaveTextContent("M");
    // No default → first option.
    expect(screen.getByTestId("design-param-input-noDefault")).toHaveTextContent("X");
  });

  it("number keeps a stored numeric value and defaults to 0 when absent", () => {
    renderBranding(
      [
        { key: "count", type: "number", label: "Значение", min: 0, max: 100 },
        { key: "zeroed", type: "number", label: "Пусто" },
      ],
      { count: 42 },
    );
    expect((screen.getByTestId("design-param-input-count") as HTMLInputElement).value).toBe("42");
    expect((screen.getByTestId("design-param-input-zeroed") as HTMLInputElement).value).toBe("0");
  });

  it("url shows an open-in-new-tab affordance only for http(s) values", () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    renderBranding(
      [
        { key: "site", type: "url", label: "Сайт" },
        { key: "notUrl", type: "url", label: "Не ссылка" },
      ],
      { site: "https://example.com", notUrl: "ftp://nope" },
    );
    const openBtn = screen.getByTestId("design-param-input-site-open");
    expect(openBtn).toBeInTheDocument();
    // Non-http value → no open affordance.
    expect(screen.queryByTestId("design-param-input-notUrl-open")).toBeNull();
    fireEvent.click(openBtn);
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });

  it("multiselect accepts a stored array, a default array, or falls back to empty", () => {
    renderBranding(
      [
        { key: "stored", type: "multiselect", label: "Из значения", options: ["a", "b"] },
        { key: "fromDefault", type: "multiselect", label: "Из умолчания", options: ["c", "d"], default: ["c"] },
        { key: "emptyMs", type: "multiselect", label: "Пусто" },
      ],
      { stored: ["a"] },
    );
    expect(screen.getByTestId("design-param-row-stored")).toBeInTheDocument();
    expect(screen.getByTestId("design-param-row-fromDefault")).toBeInTheDocument();
    expect(screen.getByTestId("design-param-row-emptyMs")).toBeInTheDocument();
  });

  it("keeps stored primitive values and covers the empty-select / empty-url fallbacks", () => {
    renderBranding(
      [
        { key: "hue", type: "color", label: "Цвет", default: "0 0% 0%" },
        { key: "flag", type: "boolean", label: "Флаг", default: false },
        { key: "size", type: "select", label: "Размер", options: ["S", "M"], default: "S" },
        { key: "empty", type: "select", label: "Пустой" }, // no options, no default → ""
        { key: "link", type: "url", label: "Ссылка" }, // no value, no default → ""
      ],
      { hue: "120 50% 50%", flag: true, size: "M" },
    );
    // Stored string colour is used verbatim (the `typeof value === "string" && value` branch)
    // — in «Цвета», where PRD-23 moved every colour.
    fireEvent.click(screen.getByTestId("design-rail-colors"));
    expect(screen.getByTestId("design-param-row-hue")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("design-rail-branding"));
    // Stored boolean value wins over the default.
    expect((screen.getByTestId("design-param-input-flag") as HTMLInputElement).checked).toBe(true);
    // Stored select value shown in the trigger.
    expect(screen.getByTestId("design-param-input-size")).toHaveTextContent("M");
    // Optionless select still renders (options ?? [] → empty).
    expect(screen.getByTestId("design-param-row-empty")).toBeInTheDocument();
    // Url with no value / default falls back to an empty string.
    expect((screen.getByTestId("design-param-input-link") as HTMLInputElement).value).toBe("");
  });

  it("renders the «unsupported type» banner for an unknown param type", () => {
    renderBranding([
      { key: "geo", type: "geo" as unknown as TemplateParam["type"], label: "Гео" },
    ]);
    expect(screen.getByTestId("design-param-unsupported-geo")).toBeInTheDocument();
  });
});

// ─── MediaParamRow — stored chips, icons, remove ────────────────────────────

describe("<DesignSection /> — MediaParamRow stored state", () => {
  it("renders «Заменить …» buttons, per-type icons and a removable chip when a file is stored", () => {
    const { design } = renderBranding(
      [
        { key: "logo", type: "image", label: "Логотип" },
        { key: "sheet", type: "asset", label: "Ассет" },
        { key: "doc", type: "file", label: "Файл" },
        { key: "manual", type: "downloadLink", label: "Руководство" },
      ],
      {
        logo: { url: "/u/logo.png", name: "logo.png" },
        sheet: { url: "/u/sheet.csv", name: "sheet.csv" },
        doc: { url: "/u/doc.pdf", name: "doc.pdf" },
        manual: { url: "/u/manual.pdf", name: "manual.pdf" },
      },
    );
    // Stored → button label switches to «Заменить …».
    expect(screen.getByTestId("design-param-input-logo")).toHaveTextContent("Заменить изображение");
    expect(screen.getByTestId("design-param-input-sheet")).toHaveTextContent("Заменить файл");
    // Chips show file names.
    expect(screen.getByTestId("design-param-chip-logo")).toHaveTextContent("logo.png");
    expect(screen.getByTestId("design-param-chip-manual")).toHaveTextContent("manual.pdf");

    // Removing the logo chip clears the param.
    fireEvent.click(screen.getByTestId("design-param-chip-logo-remove"));
    expect(design.setParam).toHaveBeenCalledWith("logo", null);
  });

  it("shows the МБ-scaled size hint for a large image maxSize", () => {
    renderBranding([
      { key: "hero", type: "image", label: "Баннер", maxSizeKb: 2048 },
    ]);
    expect(screen.getByTestId("design-param-row-hero")).toHaveTextContent("2 МБ");
  });
});

// ─── MediaParamRow — upload state machine ───────────────────────────────────

describe("<DesignSection /> — MediaParamRow upload", () => {
  function fileOfSize(bytes: number, name = "f.png", type = "image/png"): File {
    const blob = new Blob([new Uint8Array(bytes)], { type });
    return new File([blob], name, { type });
  }

  it("rejects an oversize image before uploading (КБ hint)", async () => {
    renderBranding([{ key: "logo", type: "image", label: "Логотип" }]);
    const input = screen.getByTestId("design-param-input-logo-file") as HTMLInputElement;
    // Default image limit is 512 KB.
    fireEvent.change(input, { target: { files: [fileOfSize(600 * 1024)] } });
    await waitFor(() =>
      expect(screen.getByTestId("design-param-error-logo")).toHaveTextContent("512 КБ"),
    );
    // No upload attempted.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an oversize file with the МБ-scaled hint", async () => {
    renderBranding([{ key: "doc", type: "file", label: "Файл" }]);
    const input = screen.getByTestId("design-param-input-doc-file") as HTMLInputElement;
    // Default non-image limit is 5 MB → a 6 MB file is rejected.
    fireEvent.change(input, { target: { files: [fileOfSize(6 * 1024 * 1024, "d.pdf", "application/pdf")] } });
    await waitFor(() =>
      expect(screen.getByTestId("design-param-error-doc")).toHaveTextContent("5 МБ"),
    );
  });

  it("uploads a valid file and writes the media envelope to the param", async () => {
    const upload = vi.fn(async () =>
      new Response(
        JSON.stringify({ url: "/u/logo.png", mime: "image/png", originalName: "logo.png", size: 1234 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", upload);
    const { design } = renderBranding([{ key: "logo", type: "image", label: "Логотип" }]);
    const input = screen.getByTestId("design-param-input-logo-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOfSize(1024)] } });
    await waitFor(() =>
      expect(design.setParam).toHaveBeenCalledWith("logo", {
        url: "/u/logo.png",
        name: "logo.png",
        mime: "image/png",
        size: 1234,
      }),
    );
    expect(upload).toHaveBeenCalledWith("/api/media/upload", expect.objectContaining({ method: "POST" }));
  });

  it("surfaces an HTTP error from the upload endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    renderBranding([{ key: "logo", type: "image", label: "Логотип" }]);
    const input = screen.getByTestId("design-param-input-logo-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOfSize(1024)] } });
    await waitFor(() =>
      expect(screen.getByTestId("design-param-error-logo")).toHaveTextContent("HTTP 500"),
    );
  });

  it("surfaces a network rejection's message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("нет сети"); }));
    renderBranding([{ key: "logo", type: "image", label: "Логотип" }]);
    const input = screen.getByTestId("design-param-input-logo-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOfSize(1024)] } });
    await waitFor(() =>
      expect(screen.getByTestId("design-param-error-logo")).toHaveTextContent("нет сети"),
    );
  });

  it("falls back to a generic message when the rejection carries none", async () => {
    // Reject with a non-Error value → the `?? "Не удалось загрузить файл"` path.
    vi.stubGlobal("fetch", vi.fn(async () => { throw {}; }));
    renderBranding([{ key: "logo", type: "image", label: "Логотип" }]);
    const input = screen.getByTestId("design-param-input-logo-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOfSize(1024)] } });
    await waitFor(() =>
      expect(screen.getByTestId("design-param-error-logo")).toHaveTextContent("Не удалось загрузить файл"),
    );
  });

  it("shows the «Загрузка…» spinner label while the upload is in flight", async () => {
    // A never-resolving fetch keeps the row in the uploading state.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderBranding([{ key: "logo", type: "image", label: "Логотип" }]);
    const input = screen.getByTestId("design-param-input-logo-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOfSize(1024)] } });
    await waitFor(() =>
      expect(screen.getByTestId("design-param-input-logo")).toHaveTextContent("Загрузка…"),
    );
    expect(screen.getByTestId("design-param-input-logo")).toBeDisabled();
  });
});

// ─── Colour params: value shown vs value stored ──────────────────────────────

describe("<DesignSection /> — colour params", () => {
  /** A bundle response carrying a certification-style theme.css. */
  function stubBundle(css: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/bundle")
          ? new Response(JSON.stringify({ manifest: { params: [] }, demo: null, layouts: {}, css }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          : new Response("[]", { status: 200 }),
      ),
    );
  }

  const THEME_CSS = ':root { --primary: 15 100% 45%; --background: 240 4% 93%; }';

  // The certification template leaves colours to theme.css (`default: null`).
  // Before this the field showed #000000 — a colour the learner never sees.
  it("shows the colour the template actually paints with, not a black placeholder", async () => {
    stubBundle(THEME_CSS);
    renderBranding([{ key: "primaryColor", type: "color", label: "Цвет кнопок", default: null }]);

    // 15 100% 45% → #E63900, the template's brand orange.
    await waitFor(() =>
      expect(screen.getByTestId("design-param-input-primaryColor")).toHaveTextContent("#E63900"),
    );
    expect(screen.getByTestId("design-param-inherited-primaryColor")).toHaveTextContent("из шаблона");
  });

  // The bug: the picker speaks HEX, and with nothing stored the editor guessed
  // HEX too — but the template composes hsl(var(--primary)), so `hsl(#7700FF)`
  // was dropped by the browser and the button lost its colour.
  it("stores an edit in the template's HSL format, not the picker's HEX", async () => {
    stubBundle(THEME_CSS);
    const { design } = renderBranding([
      { key: "primaryColor", type: "color", label: "Цвет кнопок", default: null },
    ]);
    await waitFor(() => expect(screen.getByTestId("design-param-input-primaryColor")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("design-param-input-primaryColor"));
    fireEvent.change(document.querySelector(".ou-color-pop__hex") as HTMLInputElement, {
      target: { value: "#7700FF" },
    });
    const apply = [...document.querySelectorAll("button")].find((b) => /Готово|ОК|Применить/i.test(b.textContent ?? ""));
    if (apply) fireEvent.click(apply);

    await waitFor(() => expect(design.setParam).toHaveBeenCalled());
    const [key, value] = (design.setParam as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!;
    expect(key).toBe("primaryColor");
    // #7700FF as the template stores colours; the round-trip is lossless —
    // hsl(268 100% 50%) renders back to rgb(119, 0, 255).
    expect(value).toBe("268 100% 50%");
  });

  it("offers «Вернуть из шаблона» only once the colour is overridden", async () => {
    stubBundle(THEME_CSS);
    const { design } = renderBranding(
      [{ key: "primaryColor", type: "color", label: "Цвет кнопок", default: null }],
      { primaryColor: "271 100% 50%" },
    );
    await waitFor(() =>
      expect(screen.getByTestId("design-param-reset-primaryColor")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("design-param-inherited-primaryColor")).toBeNull();

    fireEvent.click(screen.getByTestId("design-param-reset-primaryColor"));
    expect(design.clearParam).toHaveBeenCalledWith("primaryColor");
  });
});
