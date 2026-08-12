/**
 * @module features/tests/editor/__tests__/use-content-pages.coverage.test
 * @description Coverage-focused tests for {@link useContentPages} and its
 * exported pure helpers. Complements {@link use-content-pages.test} (which locks
 * the draft/commit/discard contract) by driving: the local `update` / `reorder`
 * mutators + their commit replay (PUT update / PUT reorder / DELETE), the
 * sanitiser-diagnostics surface + dismiss, `templateKeyMissing` derivation, the
 * commit-failure path (`mutationError`), the load-error path, and the two
 * aggregate signals {@link hasStructureErrors} / {@link hasStructureWarnings}.
 *
 * Harness mirrors {@link use-content-pages.test}: an in-memory fetch router with
 * spies, and a per-hook QueryClient wrapper.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useContentPages,
  hasStructureErrors,
  hasStructureWarnings,
  type ContentPage,
  type ContentTemplateVariant,
} from "../use-content-pages";

const TEST_ID = "t1";

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

function installApi(opts: {
  initialPages?: ContentPage[];
  failPost?: boolean;
  failGetPages?: boolean;
  failDesign?: boolean;
  putDiagnostics?: Record<string, unknown>;
} = {}) {
  const initialPages = opts.initialPages ?? [];
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
      if (path === `/api/tests/${TEST_ID}/content-pages` && method === "GET") {
        return opts.failGetPages ? jsonResponse({ error: "boom" }, 500) : jsonResponse(initialPages);
      }
      if (path === `/api/tests/${TEST_ID}/design`) {
        return opts.failDesign ? jsonResponse({ error: "boom" }, 500) : jsonResponse({ templateId: "default" });
      }
      if (path === "/api/templates/my-template") return jsonResponse(MY_TPL);
      if (path === "/api/templates/default") return opts.failDesign ? jsonResponse({ error: "boom" }, 500) : jsonResponse({ id: "default", manifest: { contentTemplates: [] } });
      if (path === `/api/tests/${TEST_ID}/content-pages` && method === "POST") {
        spies.post({ url, body });
        return opts.failPost ? jsonResponse({ error: "denied" }, 500) : jsonResponse({ ...body, id: `srv-${++seq}` }, 201);
      }
      if (path === `/api/tests/${TEST_ID}/content-pages/reorder` && method === "PUT") {
        spies.reorder(body);
        return jsonResponse({ ok: true });
      }
      const idm = path.match(/\/content-pages\/([^/]+)$/);
      if (idm && method === "PUT") {
        spies.put({ id: idm[1], url, body });
        return jsonResponse({ ...body, id: idm[1], ...(opts.putDiagnostics ? { sanitizeDiagnostics: opts.putDiagnostics } : {}) });
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

// ─── Pure aggregate signals ──────────────────────────────────────────────

describe("useContentPages — aggregate signals (pure)", () => {
  const variants: ContentTemplateVariant[] = [
    { key: "info.req", label: "Req", kind: "info", placeholders: [{ key: "title", type: "text", label: "T", required: true }] },
  ];

  it("hasStructureErrors: true when a required placeholder is empty, false when filled", () => {
    const empty = buildPage({ templateKey: "info.req", valuesJson: { values: { title: "  " } } });
    const filled = buildPage({ templateKey: "info.req", valuesJson: { values: { title: "Заголовок" } } });
    expect(hasStructureErrors([empty], variants)).toBe(true);
    expect(hasStructureErrors([filled], variants)).toBe(false);
    // A page whose variant is not in the catalogue is ignored (no error).
    expect(hasStructureErrors([buildPage({ templateKey: "info.GONE" })], variants)).toBe(false);
  });

  it("hasStructureWarnings: true for any page flagged templateKeyMissing", () => {
    expect(hasStructureWarnings([buildPage({ kind: "info", templateKeyMissing: true })])).toBe(true);
    expect(hasStructureWarnings([buildPage({ kind: "info", templateKeyMissing: false })])).toBe(false);
    // A SYSTEM page bound to a dropped variant is the same unresolved mapping —
    // and the tests list counts it, so the tab dot must not stay silent (its
    // `kind === "info"` filter made the list warn while the drawer looked clean).
    expect(hasStructureWarnings([buildPage({ kind: "questions", templateKeyMissing: true })])).toBe(true);
    expect(hasStructureWarnings([buildPage({ kind: "results", templateKeyMissing: true })])).toBe(true);
    expect(hasStructureWarnings([buildPage({ kind: "review", templateKeyMissing: false })])).toBe(false);
  });
});

// ─── Load error ───────────────────────────────────────────────────────────

describe("useContentPages — load error", () => {
  it("surfaces the content-pages fetch error", async () => {
    installApi({ failGetPages: true });
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.pages).toHaveLength(0);
  });

  it("tolerates a failing design/template fetch (empty catalogue)", async () => {
    installApi({ failDesign: true });
    const { result } = renderHook(() => useContentPages(TEST_ID), { wrapper: wrapper() });
    // The pages list still loads; the variant catalogue is simply empty.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.contentTemplates).toEqual([]);
    expect(result.current.infoVariants).toEqual([]);
  });
});

// ─── templateKeyMissing derivation ─────────────────────────────────────────

describe("useContentPages — templateKeyMissing derivation", () => {
  it("flags a page whose saved templateKey is absent from the active catalogue", async () => {
    installApi({ initialPages: [buildPage({ id: "pg-1", templateKey: "info.GONE" })] });
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pages.length).toBe(1));
    expect(result.current.pages[0].templateKeyMissing).toBe(true);
    expect(hasStructureWarnings(result.current.pages)).toBe(true);
  });
});

// ─── update() + commit replay ─────────────────────────────────────────────

describe("useContentPages — update + reorder + delete replay on commit", () => {
  it("buffers an update locally and PUTs it on commit, surfacing sanitiser diagnostics", async () => {
    const spies = installApi({
      initialPages: [buildPage({ id: "pg-1" })],
      putDiagnostics: { title: [{ kind: "tag", label: "<script>", count: 1 }] },
    });
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pages.length).toBe(1));

    await act(async () => {
      await result.current.update("pg-1", { valuesJson: { values: { title: "Изменено", body: "<p>y</p>" } } });
    });
    expect(result.current.isDirty).toBe(true);
    expect(spies.put).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.commit();
    });
    expect(spies.put).toHaveBeenCalledTimes(1);
    expect(result.current.sanitizeDiagnostics["pg-1"]).toBeDefined();

    // dismissSanitizeDiagnostics clears the entry (banner dismiss).
    act(() => result.current.dismissSanitizeDiagnostics("pg-1"));
    expect(result.current.sanitizeDiagnostics["pg-1"]).toBeUndefined();
    // Dismissing an unknown page id is a no-op.
    act(() => result.current.dismissSanitizeDiagnostics("nope"));
  });

  it("update() on an unknown id resolves to the fallback lookup", async () => {
    installApi({ initialPages: [buildPage({ id: "pg-1" })] });
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pages.length).toBe(1));
    await act(async () => {
      const returned = await result.current.update("does-not-exist", { type: "info" });
      expect(returned).toBeUndefined();
    });
  });

  it("reorder() buffers a new order and PUTs /reorder on commit", async () => {
    const spies = installApi({
      initialPages: [buildPage({ id: "pg-1", sortOrder: 0 }), buildPage({ id: "pg-2", sortOrder: 1, valuesJson: { values: { title: "Second" } } })],
    });
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pages.length).toBe(2));

    await act(async () => {
      await result.current.reorder([{ id: "pg-1", sortOrder: 1 }, { id: "pg-2", sortOrder: 0 }]);
    });
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      await result.current.commit();
    });
    expect(spies.reorder).toHaveBeenCalledTimes(1);
  });

  it("removing a server page DELETEs it on commit", async () => {
    const spies = installApi({ initialPages: [buildPage({ id: "pg-1" })] });
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pages.length).toBe(1));

    await act(async () => {
      await result.current.remove("pg-1");
    });
    await act(async () => {
      await result.current.commit();
    });
    expect(spies.del).toHaveBeenCalledWith("pg-1");
  });

  it("replaceVariant preserves placeholderStyles for keys kept by the new variant", async () => {
    installApi({
      initialPages: [
        buildPage({
          id: "pg-1",
          templateKey: "info.e-migr-1",
          valuesJson: { values: { title: "Hello", body: "<p>x</p>" }, placeholderStyles: { title: { fontSize: 20 }, body: { fontSize: 14 } } },
        }),
      ],
    });
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pages.length).toBe(1));

    await act(async () => {
      // info.175-snli keeps only `title` — the `body` value + style are dropped.
      await result.current.replaceVariant("pg-1", "info.175-snli");
    });
    const page = result.current.pages[0];
    expect(page.templateKey).toBe("info.175-snli");
    expect(page.valuesJson.values).toEqual({ title: "Hello" });
    expect(page.valuesJson.placeholderStyles).toEqual({ title: { fontSize: 20 } });
  });
});

// ─── Commit failure ────────────────────────────────────────────────────────

describe("useContentPages — commit failure", () => {
  it("sets mutationError and rethrows when a POST fails during commit", async () => {
    installApi({ initialPages: [], failPost: true });
    const { result } = renderHook(() => useContentPages(TEST_ID, "my-template"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.contentTemplates.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.create({ position: "before", mode: "template", type: "info", templateKey: "info.e-migr-1", valuesJson: { values: { title: "Новая" } } });
    });

    await act(async () => {
      await expect(result.current.commit()).rejects.toThrow();
    });
    expect(result.current.mutationError).not.toBeNull();
  });
});
