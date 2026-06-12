/**
 * @module pages/author/__tests__/topics.test
 * @description Smoke test for the topics page (PRD-15 T-32). Verifies the page
 * renders the visibility-scoped topic list, shows recommended-item counts from
 * the topic feedback (TD-02), and opens the unified <TopicDrawer/> on «Создать
 * тему» / «Редактировать».
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ can: () => true, hasRole: () => false, user: { id: "u1", name: "Author" } }),
}));
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: vi.fn(), dialogProps: { open: false } }),
}));

import TopicsPage from "../topics";

const topic = {
  id: "t1",
  name: "Финансовая грамотность",
  description: "Базовый блок",
  folderId: null,
  ownerId: "u1",
  visibility: "shared",
  feedbackJson: { format: "plain", text: "", links: [{ title: "Курс", url: "https://e.test" }], assets: [], events: [{ title: "Вебинар" }] },
  courses: [],
  events: [],
  questionCount: 5,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    let body: unknown = [];
    if (u === "/api/topics") body = [topic];
    else if (u === "/api/folders") body = [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
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
      <TopicsPage />
    </QueryClientProvider>,
  );
}

describe("<TopicsPage />", () => {
  it("renders the topic list with feedback-derived counts", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Финансовая грамотность")).toBeInTheDocument());
    // 1 course (link) + 1 event derived from feedbackJson.
    expect(screen.getByText(/1 мероприятий/)).toBeInTheDocument();
  });

  it("opens the unified TopicDrawer on «Создать тему»", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Финансовая грамотность")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("button-create-topic"));
    await waitFor(() => expect(screen.getByTestId("input-topic-name")).toBeInTheDocument());
  });

  it("opens the TopicDrawer in edit mode with the name prefilled", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Финансовая грамотность")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("button-edit-topic-t1"));
    await waitFor(() =>
      expect((screen.getByTestId("input-topic-name") as HTMLInputElement).value).toBe("Финансовая грамотность"),
    );
  });
});
