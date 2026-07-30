// @vitest-environment jsdom
/**
 * @module features/tests/editor/sections/__tests__/report-settings-card
 *
 * PRD-27 Фаза 3 — карточка «Отчёт о результатах» в блоке обратной связи.
 *
 * Ключевое, что пиннится: каталог видов считается на ЧЕРНОВОМ шаблоне вкладки
 * «Оформление» (§4.2, риск R-5) — иначе автор выбирает из списка, которого после
 * сохранения не будет; и смена вида НАЗЫВАЕТ теряемые значения (FR-14), а не роняет их
 * молча.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReportSettings } from "@shared/schema";
import { ReportSettingsCard } from "../report-settings-card";

/** Манифест шаблона: два вида отчёта, у обычного — два варианта с разными полями. */
const MANIFEST = {
  name: "Сертификация",
  manifest: {
    contentTemplates: [
      { key: "results.standard", kind: "results" },
      {
        key: "report.certificate",
        label: "Сертификат",
        kind: "report",
        isDefault: true,
        settings: [
          { key: "headline", type: "text", label: "Заголовок отчёта", default: "Итоги" },
          { key: "showRecs", type: "boolean", label: "Показывать рекомендации", default: true },
        ],
      },
      {
        key: "report.compact",
        label: "Сводка",
        kind: "report",
        settings: [{ key: "headline", type: "text", label: "Заголовок отчёта" }],
      },
      {
        key: "report.levels",
        label: "Уровни",
        kind: "report.adaptive",
        isDefault: true,
        settings: [{ key: "headline", type: "text", label: "Заголовок отчёта" }],
      },
    ],
  },
};

/** Шаблон, который видов отчёта не объявляет. */
const BARE = { manifest: { contentTemplates: [{ key: "results.standard", kind: "results" }] } };

let requested: string[] = [];

function mockFetch(byTemplate: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      const id = decodeURIComponent(String(url).replace("/api/templates/", ""));
      const body = byTemplate[id];
      if (!body) return { ok: false, status: 404 } as never;
      return { ok: true, json: async () => body } as never;
    }),
  );
}

function renderCard(
  over: Partial<Parameters<typeof ReportSettingsCard>[0]> = {},
  primeCache?: (client: QueryClient) => void,
) {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  primeCache?.(client);
  const value: ReportSettings = over.value ?? {};
  render(
    <QueryClientProvider client={client}>
      <ReportSettingsCard
        mode={over.mode ?? "standard"}
        draftTemplateId={over.draftTemplateId ?? "certification"}
        value={value}
        onChange={over.onChange ?? onChange}
        readOnly={over.readOnly}
      />
    </QueryClientProvider>,
  );
  return { onChange: over.onChange ?? onChange };
}

/**
 * `Select` дизайн-системы — не нативный `<select>`: это кнопка-триггер и список
 * `role="option"`. Водим его так, как это делает автор мышью.
 */
async function openSelect(): Promise<HTMLElement> {
  // Триггер — кнопка с `aria-haspopup="listbox"`, подписанная своим `<label>`.
  const trigger = await screen.findByLabelText("Вид отчёта");
  fireEvent.click(trigger);
  return trigger;
}

/** Подписи доступных вариантов в открытом списке. */
async function selectOptionLabels(): Promise<string[]> {
  await openSelect();
  return screen.getAllByRole("option").map((o) => o.textContent ?? "");
}

/** Выбрать вариант по подписи. */
async function pickOption(label: string): Promise<void> {
  await openSelect();
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

beforeEach(() => {
  requested = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("каталог видов", () => {
  it("запрашивается по ЧЕРНОВОМУ шаблону вкладки «Оформление» (§4.2)", async () => {
    mockFetch({ certification: MANIFEST });
    renderCard({ draftTemplateId: "certification" });
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(requested[0]).toBe("/api/templates/certification");
  });

  it("предлагает только виды СВОЕГО режима (D-5)", async () => {
    mockFetch({ certification: MANIFEST });
    renderCard({ mode: "standard" });
    // «Уровни» — вид адаптивного режима, в обычном тесте его быть не должно.
    expect(await selectOptionLabels()).toEqual(["Сертификат", "Сводка"]);
  });

  it("адаптивный тест видит свои виды и не видит обычные", async () => {
    mockFetch({ certification: MANIFEST });
    renderCard({ mode: "adaptive" });
    expect(await selectOptionLabels()).toEqual(["Уровни"]);
  });

  it("не читает кэш каталога страниц: у него другая ФОРМА записи", async () => {
    // `use-content-pages` кладёт под свой ключ голый массив вариантов. Если каталог отчёта
    // сядет на тот же ключ, содержимое кэша определит тот хук, который сходил первым, и
    // карточка молча покажет «шаблон не предлагает видов».
    mockFetch({ certification: MANIFEST });
    renderCard({}, (client) =>
      client.setQueryData(
        ["templates", "certification", "content-templates"],
        MANIFEST.manifest.contentTemplates,
      ),
    );
    expect(await screen.findByLabelText("Вид отчёта")).toBeTruthy();
    expect(screen.queryByText(/не предлагает видов отчёта/)).toBeNull();
  });

  it("подсказка называет шаблон ИМЕНЕМ, а не идентификатором", async () => {
    mockFetch({ certification: MANIFEST });
    renderCard();
    // `certification` — служебный ключ; автору он ни о чём не говорит (эскиз, строка 172).
    const hint = await screen.findByText(/Виды предлагает шаблон оформления/);
    expect(hint.textContent).toContain("«Сертификация»");
    expect(hint.textContent).not.toContain("certification");
  });

  it("шаблон без видов: вместо селектора объяснение деградации (FR-15)", async () => {
    mockFetch({ "my-template": BARE });
    renderCard({ draftTemplateId: "my-template" });
    expect(await screen.findByText(/не предлагает видов отчёта/)).toBeTruthy();
    expect(screen.queryByLabelText("Вид отчёта")).toBeNull();
  });
});

describe("поля выбранного вида", () => {
  it("показывает поля, объявленные вариантом, с их подписями", async () => {
    mockFetch({ certification: MANIFEST });
    renderCard();
    expect(await screen.findByLabelText("Заголовок отчёта")).toBeTruthy();
    expect(screen.getByLabelText("Показывать рекомендации")).toBeTruthy();
  });

  it("правка поля сохраняет выбранный вид и значение", async () => {
    mockFetch({ certification: MANIFEST });
    const { onChange } = renderCard();
    const input = await screen.findByLabelText("Заголовок отчёта");
    fireEvent.change(input, { target: { value: "Аттестация" } });
    expect(onChange).toHaveBeenCalledWith({
      standard: { variantKey: "report.certificate", values: { headline: "Аттестация" } },
    });
  });

  it("опубликованный тест не редактируется", async () => {
    mockFetch({ certification: MANIFEST });
    renderCard({ readOnly: true });
    const input = await screen.findByLabelText("Заголовок отчёта");
    expect((input as HTMLInputElement).disabled).toBe(true);
  });
});

describe("смена вида (FR-14)", () => {
  it("называет теряемые значения по ИМЕНАМ полей", async () => {
    mockFetch({ certification: MANIFEST });
    renderCard({
      value: { standard: { variantKey: "report.certificate", values: { headline: "X", showRecs: false } } },
    });
    await pickOption("Сводка");
    const warning = await screen.findByTestId("report-drop-warning");
    // «Сводка» не имеет поля «Показывать рекомендации» — о нём и предупреждаем.
    expect(warning.textContent).toContain("Показывать рекомендации");
    expect(warning.textContent).not.toContain("Заголовок отчёта");
  });

  it("переносит совпадающие значения и отбрасывает чужие", async () => {
    mockFetch({ certification: MANIFEST });
    const { onChange } = renderCard({
      value: { standard: { variantKey: "report.certificate", values: { headline: "X", showRecs: false } } },
    });
    await pickOption("Сводка");
    expect(onChange).toHaveBeenCalledWith({
      standard: { variantKey: "report.compact", values: { headline: "X" } },
    });
  });

  it("до смены предупреждения нет", async () => {
    mockFetch({ certification: MANIFEST });
    renderCard();
    await openSelect();
    expect(screen.queryByTestId("report-drop-warning")).toBeNull();
  });
});
