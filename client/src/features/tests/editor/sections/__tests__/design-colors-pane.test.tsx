/**
 * @module features/tests/editor/sections/__tests__/design-colors-pane.test
 * @description PRD-23, раздел «Цвета» вкладки «Оформление»
 * (эскиз `docs/wireframes/approved/prd23-template-themes.html`).
 *
 * Проверяется то, что отличает раздел от остальных: форма раздела следует
 * ШАБЛОНУ (одна палитра — плоский список, несколько — таблица «параметр × тема»),
 * а не выбору автора, и таблица не сворачивается при закреплении темы — иначе
 * подобранная для второй палитры раскладка исчезает из виду.
 */
import type * as React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesignSection } from "../design-section";
import type {
  TemplateParam,
  TemplateRow,
  UseDesignSettingsResult,
} from "../../use-design-settings";

const TEST_ID = "te-1";

const COLOR_PARAMS: TemplateParam[] = [
  {
    key: "primaryColor",
    type: "color",
    label: "Цвет кнопок",
    description: "Кнопки «Далее» и выбранный вариант ответа.",
  } as TemplateParam,
  { key: "backgroundColor", type: "color", label: "Фон экрана" } as TemplateParam,
];

const THEMES = [
  { id: "light" as const, label: "Светлая" },
  { id: "dark" as const, label: "Тёмная" },
];

function templateRow(params: TemplateParam[]): TemplateRow {
  return {
    id: "certification",
    name: "Сертификация",
    description: null,
    version: "1.3.0",
    templateApiVersion: "1.0",
    isBuiltin: false,
    isActive: true,
    previewPath: null,
    manifest: {
      id: "certification",
      name: "Сертификация",
      version: "1.3.0",
      templateApiVersion: "1.0",
      params,
    },
  };
}

function makeDesign(over: Partial<UseDesignSettingsResult> = {}): UseDesignSettingsResult {
  return {
    isLoading: false,
    error: null,
    template: templateRow(COLOR_PARAMS),
    draft: { templateId: "certification", params: {} },
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
    save: vi.fn(async () => ({ templateId: "certification" })),
    isSaving: false,
    saveError: null,
    ...over,
  };
}

/** Renders the tab and opens «Цвета». */
function renderColors(over: Partial<UseDesignSettingsResult> = {}) {
  const design = makeDesign(over);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <DesignSection testId={TEST_ID} design={design} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTestId("design-rail-colors"));
  return { design, ...result };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("«Цвета» — шаблон без тем", () => {
  it("рисует плоский список цветов и не показывает переключатель темы", () => {
    renderColors();
    expect(screen.getByTestId("design-param-row-primaryColor")).toBeInTheDocument();
    expect(screen.getByTestId("design-param-row-backgroundColor")).toBeInTheDocument();
    expect(screen.queryByTestId("design-theme-switch")).toBeNull();
    expect(screen.queryByTestId("design-colors-table")).toBeNull();
  });
});

describe("«Цвета» — шаблон с темами", () => {
  it("показывает переключатель и колонку на каждую палитру вместо плоского списка", () => {
    renderColors({ themes: THEMES, themeParams: { light: {}, dark: {} } });
    expect(screen.getByTestId("design-theme-switch")).toBeInTheDocument();
    const table = screen.getByTestId("design-colors-table");
    expect(table).toHaveTextContent("Светлая");
    expect(table).toHaveTextContent("Тёмная");
    expect(table).toHaveTextContent("Цвет кнопок");
    // Описание параметра из манифеста — под названием, а не в отдельной колонке.
    expect(table).toHaveTextContent("Кнопки «Далее» и выбранный вариант ответа.");
    // Плоские строки не дублируют таблицу.
    expect(screen.queryByTestId("design-param-row-primaryColor")).toBeNull();
  });

  it("таблица остаётся при закреплённой теме — подобранная палитра не пропадает", () => {
    renderColors({ themes: THEMES, theme: "light", themeParams: { light: {}, dark: {} } });
    const table = screen.getByTestId("design-colors-table");
    expect(table).toHaveTextContent("Светлая");
    expect(table).toHaveTextContent("Тёмная");
  });

  it("объясняет выбор: закреплённая тема — одинаково у всех, «Авто» — по настройке участника", () => {
    const { unmount } = renderColors({ themes: THEMES, theme: "dark" });
    expect(screen.getByTestId("design-theme-desc")).toHaveTextContent(
      "Тест открывается в теме «Тёмная» у всех участников",
    );
    unmount();
    renderColors({ themes: THEMES, theme: "auto" });
    expect(screen.getByTestId("design-theme-desc")).toHaveTextContent(
      "Тест открывается в теме, выбранной у участника",
    );
  });

  it("выбор темы уходит в черновик", () => {
    const { design } = renderColors({ themes: THEMES, theme: "auto" });
    const item = [...document.querySelectorAll(".ou-seg__item")].find(
      (b) => b.textContent === "Тёмная",
    )!;
    fireEvent.click(item);
    expect(design.setTheme).toHaveBeenCalledWith("dark");
  });

  it("правка цвета адресована КОНКРЕТНОЙ палитре", async () => {
    const { design } = renderColors({ themes: THEMES, themeParams: { light: {}, dark: {} } });
    fireEvent.click(screen.getByTestId("design-theme-color-dark-primaryColor"));
    fireEvent.change(document.querySelector(".ou-color-pop__hex") as HTMLInputElement, {
      target: { value: "#7700FF" },
    });
    const apply = [...document.querySelectorAll("button")].find((b) =>
      /Готово|ОК|Применить/i.test(b.textContent ?? ""),
    );
    if (apply) fireEvent.click(apply);
    await waitFor(() => expect(design.setThemeParam).toHaveBeenCalled());
    const [theme, key] = (design.setThemeParam as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!;
    expect(theme).toBe("dark");
    expect(key).toBe("primaryColor");
  });

  it("возврат к цвету шаблона предлагается только у переопределённой ячейки", () => {
    const { design } = renderColors({
      themes: THEMES,
      themeParams: { light: { primaryColor: "10 20% 30%" }, dark: {} },
    });
    // Тёмная ячейка не переопределена — возвращать нечего.
    expect(screen.queryByTestId("design-theme-reset-dark-primaryColor")).toBeNull();
    fireEvent.click(screen.getByTestId("design-theme-reset-light-primaryColor"));
    expect(design.clearThemeParam).toHaveBeenCalledWith("light", "primaryColor");
  });
});
