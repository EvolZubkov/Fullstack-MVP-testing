/**
 * @module features/tests/editor/__tests__/use-content-pages.test
 * @description Locks {@link useContentPages}:
 *   - the variant catalogue follows the in-progress «Оформление» DRAFT template
 *     id when supplied (else the persisted design);
 *   - «Структура» edits are buffered in a LOCAL draft (no network) and replayed
 *     to the server only by {@link commit}; {@link discard} rolls them back —
 *     so the drawer's «Отмена» fully reverts add / edit / variant / delete.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useContentPages, type ContentPage } from "../use-content-pages";

const TEST_ID = "t1";

const DEFAULT_TPL = {
  id: "default",
  manifest: { contentTemplates: [{ key: "info.text", label: "Информация: текст", kind: "info", placeholders: [{ key: "title", type: "text" }] }] },
};
const MY_TPL = {
  id: "my-template",
  manifest: {
    contentTemplates: [
      { key: "info.e-migr-1", label: "Материал", kind: "info", placeholders: [{ key: "title", type: "text" }, { key: "body", type: "richText" }] },
      { key: "info.175-snli", label: "Материал 2", kind: "info", placeholders: [{ key: "title", type: "text" }] },
    ],
  },
};

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function installApi(initialPages: ContentPage[] = []) {
  const spies = {
    post: vi.fn<(a: { url: string; body: any }) => void>(),
    put: vi.fn<(a: { id: string; url: string; body: any }) => void>(),
    del: vi.fn<(id: string) => void>(),
    reorder: vi.fn<(b: any) => void>(),
  };
  let seq = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = url.split("?")[0];
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      if (path === `/api/tests/${TEST_ID}/content-pages` && method === "GET") return jsonResponse(initialPages);
      if (path === `/api/tests/${TEST_ID}/design`) return jsonResponse({ templateId: "default" });
      if (path === "/api/templates/default") return jsonResponse(DEFAULT_TPL);
      if (path === "/api/templates/my-template") return jsonResponse(MY_TPL);
      if (path === `/api/tests/${TEST_ID}/content-pages` && method === "POST") {
        spies.post({ url, body });
        return jsonResponse({ ...body, id: `srv-${++seq}` }, 201);
      }
      if (path === `/api/tests/${TEST_ID}/content-pages/reorder` && method === "PUT") {
        spies.reorder(body);
        return jsonResponse({ ok: true });
      }
      const idm = path.match(/\/content-pages\/([^/]+)$/);
      if (idm && method === "PUT") {
        spies.put({ id: idm[1], url, body });
        return jsonResponse({ ...body, id: idm[1] });
      }
      if (idm && method === "DELETE") {
        spies.del(idm[1]);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return jsonResponse({ error: `unexpected ${method} ${url}` }, 500);
    }),
  );
  return spies;
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function buildPage(over: Partial<ContentPage> = {}): ContentPage {
  return {
    id: "pg-1", testId: TEST_ID, topicId: null, position: "before", mode: "template",
    type: "info", kind: "info", templateKey: "info.e-migr-1", sortOrder: 0,
    valuesJson: { values: { title: "Hello", body: "<p>x</p>" } },
    autoAdvance: false, autoAdvanceDelayMs: null,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useContentPages — variant catalogue source", () => {
  it("without a draft id, uses the persisted design template (default → 1 info variant)", async () => {
    installApi();
    const { result } = renderHook(() => useContentPages(TEST_ID), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.contentTemplates.length).toBeGreaterThan(0));
    expect(result.current.infoVariants.map((v) => v.key)).toEqual(["info.text"]);
  });

  it("with a draft id, follows the DRAFT template before save (my-template → 2 info variants)", async () => {
    installApi();
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.contentTemplates.length).toBeGreaterThan(0));
    expect(result.current.infoVariants.map((v) => v.key).sort()).toEqual(["info.175-snli", "info.e-migr-1"]);
  });
});

describe("useContentPages — local draft + commit/discard", () => {
  it("buffers edits locally (no network) and replays them on commit()", async () => {
    const spies = installApi([]);
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.contentTemplates.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.create({ position: "before", mode: "template", type: "info", templateKey: "info.e-migr-1", valuesJson: { values: { title: "Новая" } } });
    });
    // The page appears locally and dirties the draft — WITHOUT any write yet.
    expect(result.current.isDirty).toBe(true);
    expect(result.current.pages).toHaveLength(1);
    expect(spies.post).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.commit();
    });
    // Commit POSTs the page, carrying the draft template id, then reorders.
    expect(spies.post).toHaveBeenCalledTimes(1);
    expect(spies.post.mock.calls[0][0].url).toContain("templateId=my-template");
    expect(spies.post.mock.calls[0][0].body.templateKey).toBe("info.e-migr-1");
    expect(spies.reorder).toHaveBeenCalledTimes(1);
  });

  it("replaceVariant migrates shared values locally; commit PUTs the new key", async () => {
    const spies = installApi([buildPage({ id: "pg-1", templateKey: "info.e-migr-1" })]);
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pages.length).toBe(1));

    await act(async () => {
      await result.current.replaceVariant("pg-1", "info.175-snli");
    });
    // Local: templateKey switched; `body` dropped (info.175-snli has only `title`).
    const page = result.current.pages[0];
    expect(page.templateKey).toBe("info.175-snli");
    expect(page.valuesJson.values).toEqual({ title: "Hello" });
    expect(spies.put).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.commit();
    });
    expect(spies.put).toHaveBeenCalledTimes(1);
    expect(spies.put.mock.calls[0][0].body.templateKey).toBe("info.175-snli");
  });

  it("discard() rolls the draft back to the server state with no network writes", async () => {
    const spies = installApi([buildPage({ id: "pg-1" })]);
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pages.length).toBe(1));

    await act(async () => {
      await result.current.create({ position: "before", mode: "template", type: "info", templateKey: "info.175-snli", valuesJson: { values: {} } });
      await result.current.remove("pg-1");
    });
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.discard());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.pages.map((p) => p.id)).toEqual(["pg-1"]); // back to server state
    expect(spies.post).not.toHaveBeenCalled();
    expect(spies.del).not.toHaveBeenCalled();
  });
});
