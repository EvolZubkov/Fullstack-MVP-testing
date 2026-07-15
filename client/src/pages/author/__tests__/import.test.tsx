/**
 * @module pages/author/__tests__/import.test
 * @description Component tests for the PRD-14 «Импорт» page. Covers the empty
 * uploader state, the questions-only path (inspect -> detected banner -> dry-run
 * preview -> real import "done" banner), the wrong-file-type guard, and the
 * workbook path that requires a target test (target combobox + gated action
 * buttons). Auth is stubbed (can create tests); `fetch` is stubbed per URL so
 * the inspect/import mutations and the /api/tests query resolve against
 * fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ can: () => true, hasRole: () => false, user: { id: "u1", name: "Author" } }),
}));

import ImportPage from "../import";

// ─── fetch stub ─────────────────────────────────────────────────────────────

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

const testsData = [
  { id: "test1", title: "Стресс-опросник" },
  { id: "test2", title: "Аттестация" },
];

const questionsOnlyInspect = {
  sheets: ["Вопросы"],
  hasQuestions: true,
  hasScales: false,
  hasResultVariables: false,
  hasMeasurements: false,
  requiresTest: false,
  counts: { questions: 3, scales: 0, resultVariables: 0, measurements: 0 },
};
const workbookInspect = {
  sheets: ["Вопросы", "Шкалы", "Показатели"],
  hasQuestions: true,
  hasScales: true,
  hasResultVariables: true,
  hasMeasurements: false,
  requiresTest: true,
  counts: { questions: 3, scales: 2, resultVariables: 1, measurements: 0 },
};

let inspectResult: unknown = questionsOnlyInspect;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  inspectResult = questionsOnlyInspect;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    if (method === "GET" && url === "/api/tests") return jsonRes(testsData);
    if (method === "POST") {
      if (url.startsWith("/api/workbook/inspect")) return jsonRes(inspectResult);
      if (url.startsWith("/api/questions/import")) {
        return jsonRes({ created: 3, updated: 1, skipped: 0, errors: [] });
      }
      if (url.includes("/workbook/import")) {
        return jsonRes({
          questions: { created: 3, updated: 0, skipped: 0 },
          scales: { created: 2, updated: 0 },
          resultVariables: { created: 1, updated: 0 },
          structure: { sections: 0, quotas: 0 },
          errors: [],
          test: { id: "test1", title: "Стресс-опросник" },
        });
      }
    }
    return jsonRes({});
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
      <ImportPage />
    </QueryClientProvider>,
  );
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="file"]');
  if (!el) throw new Error("file input not found");
  return el as HTMLInputElement;
}

function xlsx(name = "book.xlsx"): File {
  return new File(["x"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<ImportPage /> — empty", () => {
  it("renders the uploader and the download-template action", async () => {
    renderPage();
    expect(await screen.findByText("Импорт из Excel")).toBeInTheDocument();
    expect(screen.getByText("Перетащите файл .xlsx или выберите")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скачать шаблон" })).toBeInTheDocument();
  });
});

describe("<ImportPage /> — wrong file type", () => {
  it("rejects a non-.xlsx file without inspecting", async () => {
    const { container } = renderPage();
    await screen.findByText("Импорт из Excel");
    fireEvent.change(fileInput(container), { target: { files: [xlsx("data.txt")] } });

    // No inspect call was made; the uploader is still shown.
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/workbook/inspect")),
    ).toBe(false);
    expect(screen.getByText("Перетащите файл .xlsx или выберите")).toBeInTheDocument();
  });
});

describe("<ImportPage /> — questions-only path", () => {
  it("inspects, previews the dry-run, then imports to the done banner", async () => {
    const { container } = renderPage();
    await screen.findByText("Импорт из Excel");

    fireEvent.change(fileInput(container), { target: { files: [xlsx("questions.xlsx")] } });

    // Inspect resolves -> questions-only banner + file item.
    await waitFor(() =>
      expect(screen.getByText("В файле только вопросы — импорт в общий банк.")).toBeInTheDocument(),
    );
    expect(screen.getByText("questions.xlsx")).toBeInTheDocument();

    // Dry-run preview: no target needed, "Проверить" is enabled.
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));
    await waitFor(() =>
      expect(screen.getByText("Ошибок не найдено — можно импортировать.")).toBeInTheDocument(),
    );

    // Confirm the real import -> "Импорт выполнен" done banner.
    fireEvent.click(screen.getByRole("button", { name: "Импортировать" }));
    await waitFor(() => expect(screen.getByText("Импорт выполнен")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Импортировать ещё" })).toBeInTheDocument();
  });
});

describe("<ImportPage /> — workbook path (requires test)", () => {
  it("gates the actions until a target test is chosen and previews the workbook plan", async () => {
    inspectResult = workbookInspect;
    const { container } = renderPage();
    await screen.findByText("Импорт из Excel");

    fireEvent.change(fileInput(container), { target: { files: [xlsx("workbook.xlsx")] } });

    await waitFor(() =>
      expect(
        screen.getByText("В файле есть шкалы/показатели/вклады — укажите целевой тест."),
      ).toBeInTheDocument(),
    );

    // No target yet -> both action buttons disabled.
    expect(screen.getByRole("button", { name: "Проверить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Импортировать" })).toBeDisabled();

    // Pick an existing test via the target combobox.
    const combo = screen.getByRole("combobox");
    fireEvent.focus(combo);
    fireEvent.click(await screen.findByText("Аттестация"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Проверить" })).not.toBeDisabled(),
    );

    // Dry-run preview of the workbook plan (scales row present).
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));
    await waitFor(() => expect(screen.getByText("Шкалы")).toBeInTheDocument());
    expect(screen.getByText(/Целевой тест:/)).toBeInTheDocument();
  });

  it("requires a name when creating a new test", async () => {
    inspectResult = workbookInspect;
    const { container } = renderPage();
    await screen.findByText("Импорт из Excel");
    fireEvent.change(fileInput(container), { target: { files: [xlsx("workbook.xlsx")] } });
    await screen.findByText("В файле есть шкалы/показатели/вклады — укажите целевой тест.");

    const combo = screen.getByRole("combobox");
    fireEvent.focus(combo);
    fireEvent.click(await screen.findByText("＋ Создать новый тест"));

    // New-test name field appears; actions stay disabled until it is filled.
    // (The label carries a required «*» marker, so match loosely.)
    const nameInput = await screen.findByLabelText(/Название нового теста/);
    expect(screen.getByRole("button", { name: "Импортировать" })).toBeDisabled();
    fireEvent.change(nameInput, { target: { value: "Новый тест 2026" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Импортировать" })).not.toBeDisabled(),
    );
  });
});
