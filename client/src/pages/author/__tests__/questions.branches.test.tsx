/**
 * @module pages/author/__tests__/questions.branches.test
 * @description Branch-coverage companion to `questions.test.tsx`. Targets the
 * paths the smoke suite skips: the per-media-type preview blocks
 * (image/audio/video and the no-type null case), the export dialog in «По тесту»
 * mode plus the «Все вопросы» / «Выбрать темы» URL assembly, the topic/type
 * filters, the dry-run preview error list, the full real-import success toast
 * (created/updated/skipped/errors branches) and the duplicate/import `onError`
 * toasts. `useToast`, the content guard, auth and `window.location` are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ can: () => true, hasRole: () => false, user: { id: "u1", name: "Author" } }),
}));

const { guardMock } = vi.hoisted(() => ({ guardMock: vi.fn() }));
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

// Observe toasts (success + error) without mounting a provider.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn() }),
}));

import QuestionsPage from "../questions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const qImage = {
  id: "qi", topicId: "t1", topicName: "Тема A", type: "single",
  prompt: "Что на картинке?", difficulty: 10,
  dataJson: { options: ["Кот", "Пёс"] }, correctJson: { correctIndex: 0 },
  mediaUrl: "/m/i.png", mediaType: "image", tags: [],
};
const qAudio = {
  id: "qa", topicId: "t1", topicName: "Тема A", type: "multiple",
  prompt: "Какие ноты звучат?", difficulty: 40,
  dataJson: { options: ["До", "Ре", "Ми"] }, correctJson: { correctIndices: [0, 2] },
  mediaUrl: "/m/a.mp3", mediaType: "audio", tags: [],
};
const qVideo = {
  id: "qv", topicId: "t2", topicName: "Тема B", type: "matching",
  prompt: "Сопоставьте кадры", difficulty: 70,
  dataJson: { left: ["Сцена"], right: ["Финал"] }, correctJson: { pairs: [{ left: 0, right: 0 }] },
  mediaUrl: "/m/v.mp4", mediaType: "video", tags: [],
};
const qNoMediaType = {
  id: "qn", topicId: "t2", topicName: "Тема B", type: "ranking",
  prompt: "Расставьте по порядку", difficulty: null,
  dataJson: { items: ["Первый", "Второй"] }, correctJson: { correctOrder: [0, 1] },
  // mediaUrl present but mediaType null -> mediaSection stays null.
  mediaUrl: "/m/x.png", mediaType: null, tags: [],
};

const topicsData = [
  { id: "t1", name: "Тема A" },
  { id: "t2", name: "Тема B" },
];
const testsData = [{ id: "test1", title: "Итоговый тест" }];

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

let questionsData: unknown[];
let duplicateOk: boolean;
let importOk: boolean;
let importDryRun: { created: number; updated: number; skipped: number; errors: string[] };
let importReal: { created: number; updated: number; skipped: number; errors: string[] };
let fetchMock: ReturnType<typeof vi.fn>;

// Swap window.location for a plain, writable object so handleExport's
// `window.location.href = url` is observable (and does not warn in jsdom).
let originalLocation: Location;
beforeEach(() => {
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, href: "" } as unknown as Location,
  });
});
afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

beforeEach(() => {
  guardMock.mockReset();
  toastSpy.mockClear();
  questionsData = [qImage, qAudio, qVideo, qNoMediaType];
  duplicateOk = true;
  importOk = true;
  importDryRun = { created: 2, updated: 1, skipped: 0, errors: [] };
  importReal = { created: 1, updated: 2, skipped: 1, errors: ["Строка 5: пропущен вариант"] };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    if (method === "GET") {
      if (url === "/api/questions") return jsonRes(questionsData);
      if (url === "/api/topics") return jsonRes(topicsData);
      if (url === "/api/tests") return jsonRes(testsData);
    }
    if (method === "POST") {
      if (url.includes("/duplicate")) return jsonRes(duplicateOk ? { id: "dup" } : { error: "no" }, duplicateOk, duplicateOk ? 200 : 500);
      if (url.startsWith("/api/questions/import")) {
        if (!importOk) return jsonRes({ error: "bad" }, false, 500);
        return jsonRes(url.includes("dryRun=true") ? importDryRun : importReal);
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
      <QuestionsPage />
    </QueryClientProvider>,
  );
}

// ─── Media previews ────────────────────────────────────────────────────────────

describe("<QuestionsPage /> — media previews", () => {
  it("renders image / audio / video attachment hints per media type", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Что на картинке?")).toBeInTheDocument());
    expect(screen.getByText("Прикреплено изображение")).toBeInTheDocument();
    expect(screen.getByText("Прикреплено аудио")).toBeInTheDocument();
    expect(screen.getByText("Прикреплено видео")).toBeInTheDocument();
    // qNoMediaType: mediaUrl set but mediaType null -> no attachment hint, and
    // the null difficulty falls back to 50 in the card tag.
    expect(screen.getByText("Расставьте по порядку")).toBeInTheDocument();
    expect(screen.getByText(/Сложность: 50/)).toBeInTheDocument();
  });
});

// ─── Filters ───────────────────────────────────────────────────────────────────

describe("<QuestionsPage /> — filters", () => {
  it("filters by topic (keeps only the selected topic's questions)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Что на картинке?")).toBeInTheDocument());
    const topicSelect = screen.getByTestId("select-filter-topic");
    fireEvent.click(within(topicSelect).getByRole("button"));
    fireEvent.click(await screen.findByRole("option", { name: "Тема B" }));
    await waitFor(() => expect(screen.queryByText("Что на картинке?")).toBeNull());
    expect(screen.getByText("Сопоставьте кадры")).toBeInTheDocument();
  });

  it("filters by question type (keeps only single-choice)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Что на картинке?")).toBeInTheDocument());
    const typeSelect = screen.getByTestId("select-filter-type");
    fireEvent.click(within(typeSelect).getByRole("button"));
    fireEvent.click(await screen.findByRole("option", { name: "Один ответ" }));
    await waitFor(() => expect(screen.queryByText("Какие ноты звучат?")).toBeNull());
    expect(screen.getByText("Что на картинке?")).toBeInTheDocument();
  });
});

// ─── Export dialog ─────────────────────────────────────────────────────────────

describe("<QuestionsPage /> — export modes", () => {
  it("exports all questions to the bare export URL", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Что на картинке?"));
    fireEvent.click(screen.getByTestId("button-export-questions"));
    await screen.findByText("Экспорт вопросов");
    fireEvent.click(screen.getByTestId("button-confirm-export"));
    expect(window.location.href).toBe("/api/questions/export");
  });

  it("exports selected topics with a topicIds query param", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Что на картинке?"));
    fireEvent.click(screen.getByTestId("button-export-questions"));
    fireEvent.click(await screen.findByRole("radio", { name: "Выбрать темы" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Тема A" }));
    expect(screen.getByText(/Выбрано тем: 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-confirm-export"));
    expect(window.location.href).toBe("/api/questions/export?topicIds=t1");
  });

  it("exports by test with a testId query param", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Что на картинке?"));
    fireEvent.click(screen.getByTestId("button-export-questions"));
    fireEvent.click(await screen.findByRole("radio", { name: "По тесту (все темы теста)" }));
    // The test picker appears; confirm is disabled until a test is chosen.
    expect(screen.getByTestId("button-confirm-export")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Выберите тест" }));
    fireEvent.click(await screen.findByRole("option", { name: "Итоговый тест" }));
    fireEvent.click(screen.getByTestId("button-confirm-export"));
    expect(window.location.href).toBe("/api/questions/export?testId=test1");
  });
});

// ─── Import: preview errors + real success description ──────────────────────────

describe("<QuestionsPage /> — import branches", () => {
  it("renders the dry-run error list in the preview box", async () => {
    importDryRun = { created: 1, updated: 0, skipped: 0, errors: ["Лист 1, строка 3: нет темы"] };
    renderPage();
    await waitFor(() => screen.getByText("Что на картинке?"));
    fireEvent.click(screen.getByTestId("button-import-questions"));
    const file = new File(["x"], "q.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(screen.getByTestId("input-import-file"), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId("button-check-import"));
    await waitFor(() => expect(screen.getByTestId("import-preview")).toBeInTheDocument());
    expect(screen.getByText("Лист 1, строка 3: нет темы")).toBeInTheDocument();
    expect(screen.getByText(/Ошибок: 1/)).toBeInTheDocument();
  });

  it("builds the created/updated/skipped/errors description on a real import", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Что на картинке?"));
    fireEvent.click(screen.getByTestId("button-import-questions"));
    const file = new File(["x"], "q.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(screen.getByTestId("input-import-file"), { target: { files: [file] } });
    // Real import (not dry-run) closes the dialog and toasts a summary.
    fireEvent.click(screen.getByTestId("button-confirm-import"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Импорт завершён",
          description: expect.stringContaining("Обновлено: 2"),
        }),
      ),
    );
    const desc = String(
      (toastSpy.mock.calls.find((c) => (c[0] as { title?: string })?.title === "Импорт завершён")?.[0] as { description: string }).description,
    );
    expect(desc).toContain("Добавлено: 1");
    expect(desc).toContain("Пропущено дублей: 1");
    expect(desc).toMatch(/Ошибки при импорте: 1/);
  });

  it("toasts failedToImport when the import request fails", async () => {
    importOk = false;
    renderPage();
    await waitFor(() => screen.getByText("Что на картинке?"));
    fireEvent.click(screen.getByTestId("button-import-questions"));
    const file = new File(["x"], "q.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(screen.getByTestId("input-import-file"), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId("button-check-import"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Не удалось импортировать вопросы." }),
      ),
    );
  });
});

// ─── Duplicate onError ─────────────────────────────────────────────────────────

describe("<QuestionsPage /> — duplicate onError", () => {
  it("toasts failedToDuplicate when the duplicate POST fails", async () => {
    duplicateOk = false;
    renderPage();
    await waitFor(() => screen.getByText("Что на картинке?"));
    fireEvent.click(screen.getByTestId("button-duplicate-question-qi"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Не удалось дублировать вопрос." }),
      ),
    );
  });
});
