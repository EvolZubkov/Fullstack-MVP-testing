/**
 * @module features/tests/editor/__tests__/use-test-editor.coverage.test
 * @description Coverage-focused hook tests for {@link useTestEditor}. Drives the
 * paths the component suite does not reach: idle mode, the CRUD reconcile
 * branches inside the save mutation (result-variables / scales / measurements,
 * incl. `resolveScaleKeyToId`), the create-with-children path, the save-error
 * surfaces (generic 500 / 400-with-fields / non-HTTP), and the 409 conflict
 * resolution actions (`resolveConflictReload` / `resolveConflictOverwrite` /
 * `dismissConflict`), plus the transient-error dismissers.
 *
 * Harness: `renderHook` with a per-hook QueryClient wrapper (mirrors
 * {@link use-design-settings.test}); `fetch` is stubbed with a small URL router.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useTestEditor } from "../use-test-editor";

const TEST_ID = "test-1";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function buildApiResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TEST_ID,
    version: 7,
    title: "Sample Test",
    description: "",
    mode: "standard",
    status: "draft",
    overallPassRuleJson: { type: "percent", value: 70 },
    passDecisionPolicy: "overall_only",
    webhookUrl: null,
    feedbackJson: { format: "plain", text: "", links: [], assets: [] },
    telemetryEnabled: false,
    timeLimitMinutes: null,
    maxAttempts: null,
    showCorrectAnswers: false,
    sections: [
      { id: "section-1", topicId: "topic-1", topicName: "Основы ИБ", drawCount: 5, required: true, maxQuestions: 10 },
    ],
    adaptiveSettings: null,
    ...overrides,
  };
}

const RESULT_VAR = {
  name: "v1",
  label: "V1",
  type: "number" as const,
  formula: "0",
  showToLearner: false,
  scormTarget: "both" as const,
  controlsStatus: "none" as const,
  sortOrder: 0,
};

const SCALE = {
  key: "s1",
  label: "S1",
  type: "number" as const,
  aggregation: "sum" as const,
  normalization: "none" as const,
  direction: "positive" as const,
  bands: [],
  showToLearner: false,
  scormTarget: "none" as const,
  sortOrder: 0,
};

const MEASUREMENT = {
  questionId: "q1",
  scaleKey: "s1",
  sourceType: "question" as const,
  sourceKey: null,
  value: 1,
  weight: 1,
};

// ─── fetch router ──────────────────────────────────────────────────────────

type Call = { url: string; method: string };
let calls: Call[];

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

/**
 * Install a fetch router. `putHandler` (optional) overrides the response for the
 * top-level `PUT /api/tests/:id` (to force an error / conflict); `postHandler`
 * likewise for create. Everything else — the initial + refresh GET, the child
 * CRUD endpoints — answers 200.
 */
function installApi(cfg: {
  getBody?: () => Record<string, unknown>;
  putHandler?: () => Promise<Response>;
  postHandler?: () => Promise<Response>;
} = {}) {
  const getBody = cfg.getBody ?? (() => buildApiResponse());
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.split("?")[0];
      calls.push({ url: path, method });
      const topLevelGet = /^\/api\/tests\/[^/]+$/.exec(path);
      if (topLevelGet && method === "GET") {
        // Echo the requested id so create-mode refresh (GET /api/tests/new-id)
        // resolves `createdId`; the primary test still uses its fixture body.
        const id = path.split("/").pop()!;
        return jsonResponse(id === TEST_ID ? getBody() : buildApiResponse({ id }));
      }
      if (path === `/api/tests/${TEST_ID}` && method === "PUT") return cfg.putHandler ? cfg.putHandler() : jsonResponse(getBody());
      if (path === "/api/tests" && method === "POST") {
        return cfg.postHandler ? cfg.postHandler() : jsonResponse(buildApiResponse({ id: "new-id" }), 201);
      }
      // Child CRUD resources (result-variables / scales / measurements / question-scoring).
      return jsonResponse({}, 200);
    }),
  );
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

const editOpts = { mode: "edit" as const, testId: TEST_ID };

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

// ─── Idle mode ────────────────────────────────────────────────────────────

describe("useTestEditor — idle mode", () => {
  it("stays idle with no model and a no-op save when options are null", async () => {
    installApi();
    const { result } = renderHook(() => useTestEditor(null), { wrapper: wrapper() });
    expect(result.current.mode).toBe("idle");
    expect(result.current.model).toBeNull();
    expect(result.current.isLoading).toBe(false);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save();
    });
    expect(ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});

// ─── Load-error branches ─────────────────────────────────────────────────

describe("useTestEditor — load failures", () => {
  it("leaves the model null when the initial GET fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "boom" }, 500)));
    const { result } = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.model).toBeNull();
  });

  it("leaves the model null when the snapshot fails to map (malformed body)", async () => {
    // An array body makes `apiToEditorModel` throw → caught → draft stays null.
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse([1, 2, 3])));
    const { result } = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.model).toBeNull();
  });
});

// ─── Save gate: validation blocks save ─────────────────────────────────────

describe("useTestEditor — save gate", () => {
  it("returns false (no PUT) while the draft has blocking validation errors", async () => {
    installApi();
    const { result } = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({ ...m, basic: { ...m.basic, title: "" } }));
    });
    // Debounced validation (300ms) surfaces the empty-title error.
    await waitFor(() => expect(result.current.validation.errors.length).toBeGreaterThan(0), { timeout: 1000 });

    const putsBefore = calls.filter((c) => c.method === "PUT").length;
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save();
    });
    expect(ok).toBe(false);
    expect(calls.filter((c) => c.method === "PUT").length).toBe(putsBefore);
  });
});

// ─── CRUD reconcile inside the save mutation ───────────────────────────────

describe("useTestEditor — child-resource reconcile on save (edit)", () => {
  it("POSTs a new result variable and refreshes the snapshot", async () => {
    installApi();
    const { result } = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({ ...m, resultVariables: [{ ...RESULT_VAR }] }));
    });
    await act(async () => {
      await result.current.save();
    });

    expect(calls.some((c) => c.method === "POST" && c.url === `/api/tests/${TEST_ID}/result-variables`)).toBe(true);
    // A child change forces a full re-fetch; the last GET is that refresh.
    expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(2);
  });

  it("reconciles a measurement with scales unchanged (resolveScaleKeyToId from draft)", async () => {
    installApi();
    const { result } = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({ ...m, measurements: [{ ...MEASUREMENT }] }));
    });
    await act(async () => {
      await result.current.save();
    });

    expect(calls.some((c) => c.method === "PUT" && c.url.startsWith(`/api/tests/${TEST_ID}/measurements/`))).toBe(true);
  });

  it("reconciles scales + measurements together (resolveScaleKeyToId re-reads persisted scales)", async () => {
    installApi();
    const { result } = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        scales: [{ ...SCALE }],
        measurements: [{ ...MEASUREMENT }],
      }));
    });
    await act(async () => {
      await result.current.save();
    });

    expect(calls.some((c) => c.method === "POST" && c.url === `/api/tests/${TEST_ID}/scales`)).toBe(true);
    expect(calls.some((c) => c.method === "PUT" && c.url.startsWith(`/api/tests/${TEST_ID}/measurements/`))).toBe(true);
  });
});

// ─── Create with children ─────────────────────────────────────────────────

describe("useTestEditor — create with children", () => {
  it("POSTs the test then its children and exposes createdId", async () => {
    installApi();
    const { result } = renderHook(
      () => useTestEditor({ mode: "create", folderId: "fld-1" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: "Свежий" },
        sections: [
          {
            topicId: "topic-1", topicName: "Topic", maxQuestions: 10, drawCount: 1, drawAll: false,
            required: true, timeLimit: { source: "inherit_test" }, feedback: { format: "plain", text: "" },
            feedbackLinks: [], feedbackAssets: [], feedbackEvents: [], defaultPoints: null,
          },
        ],
        resultVariables: [{ ...RESULT_VAR }],
        scales: [{ ...SCALE }],
        measurements: [{ ...MEASUREMENT }],
      }));
    });
    await act(async () => {
      await result.current.save();
    });

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/tests")).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/tests/new-id/result-variables")).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/tests/new-id/scales")).toBe(true);
    expect(result.current.createdId).toBe("new-id");
  });
});

// ─── Save-error surfaces ─────────────────────────────────────────────────

describe("useTestEditor — save-error surfaces", () => {
  it("surfaces a generic 500 as saveError with the server error text", async () => {
    installApi({ putHandler: () => jsonResponse({ error: "internal boom" }, 500) });
    const { result } = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({ ...m, basic: { ...m.basic, title: "Edited" } }));
    });
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.saveError?.status).toBe(500);
    expect(result.current.saveError?.message).toContain("internal boom");

    // dismissSaveError clears the banner state.
    act(() => result.current.dismissSaveError());
    expect(result.current.saveError).toBeNull();
  });

  it("surfaces a 400 zod failure listing the offending field paths", async () => {
    installApi({
      putHandler: () => jsonResponse({ error: "Validation failed", fields: [{ field: "basic.title" }, { field: "sections" }] }, 400),
    });
    const { result } = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({ ...m, basic: { ...m.basic, title: "Edited" } }));
    });
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.saveError?.status).toBe(400);
    expect(result.current.saveError?.message).toContain("basic.title");
  });

  it("surfaces a non-HTTP (network) error with status 0", async () => {
    installApi({ putHandler: () => Promise.reject(new Error("network down")) });
    const { result } = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({ ...m, basic: { ...m.basic, title: "Edited" } }));
    });
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.saveError?.status).toBe(0);
    expect(result.current.saveError?.message).toContain("network down");
  });

  it("surfaces a create 422 required-fields payload", async () => {
    installApi({
      postHandler: () =>
        jsonResponse(
          { error: "required_fields_missing", fields: [{ pageId: "p1", templateKey: "intro", fieldName: "title" }] },
          422,
        ),
    });
    const { result } = renderHook(
      () => useTestEditor({ mode: "create", folderId: null }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: "Свежий" },
        sections: [
          {
            topicId: "topic-1", topicName: "Topic", maxQuestions: 10, drawCount: 1, drawAll: false,
            required: true, timeLimit: { source: "inherit_test" }, feedback: { format: "plain", text: "" },
            feedbackLinks: [], feedbackAssets: [], feedbackEvents: [], defaultPoints: null,
          },
        ],
      }));
    });
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.requiredFieldsMissing).toEqual([
      { pageId: "p1", templateKey: "intro", fieldName: "title" },
    ]);
  });
});

// ─── Conflict resolution ───────────────────────────────────────────────────

describe("useTestEditor — 409 conflict resolution", () => {
  async function loadWithConflict() {
    const hook = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
    await waitFor(() => expect(hook.result.current.model).not.toBeNull());
    act(() => {
      hook.result.current.updateModel((m) => ({ ...m, basic: { ...m.basic, title: "Edited" } }));
    });
    await act(async () => {
      await hook.result.current.save();
    });
    return hook;
  }

  it("dismissConflict clears the conflict without retrying", async () => {
    installApi({ putHandler: () => jsonResponse({ error: "version_conflict", currentVersion: 9, expectedVersion: 7 }, 409) });
    const { result } = await loadWithConflict();
    expect(result.current.conflict).toEqual({ currentVersion: 9, expectedVersion: 7 });
    act(() => result.current.dismissConflict());
    expect(result.current.conflict).toBeNull();
  });

  it("resolveConflictReload drops the draft and refetches from the server", async () => {
    let conflictNext = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const path = url.split("?")[0];
        calls.push({ url: path, method });
        if (path === `/api/tests/${TEST_ID}` && method === "GET") return jsonResponse(buildApiResponse());
        if (path === `/api/tests/${TEST_ID}` && method === "PUT") {
          return conflictNext
            ? jsonResponse({ error: "version_conflict", currentVersion: 9, expectedVersion: 7 }, 409)
            : jsonResponse(buildApiResponse());
        }
        return jsonResponse({}, 200);
      }),
    );
    const { result } = await loadWithConflict();
    expect(result.current.conflict).not.toBeNull();

    const getsBefore = calls.filter((c) => c.method === "GET").length;
    await act(async () => {
      await result.current.resolveConflictReload();
    });
    await waitFor(() => expect(result.current.conflict).toBeNull());
    expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(getsBefore);
  });

  it("resolveConflictOverwrite re-PUTs with the server version and clears the conflict", async () => {
    let conflictNext = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const path = url.split("?")[0];
        calls.push({ url: path, method });
        if (path === `/api/tests/${TEST_ID}` && method === "GET") return jsonResponse(buildApiResponse());
        if (path === `/api/tests/${TEST_ID}` && method === "PUT") {
          if (conflictNext) {
            conflictNext = false;
            return jsonResponse({ error: "version_conflict", currentVersion: 9, expectedVersion: 7 }, 409);
          }
          return jsonResponse(buildApiResponse({ version: 9 }));
        }
        return jsonResponse({}, 200);
      }),
    );
    const { result } = await loadWithConflict();
    expect(result.current.conflict).not.toBeNull();
    const putsBefore = calls.filter((c) => c.method === "PUT").length;

    await act(async () => {
      await result.current.resolveConflictOverwrite();
    });
    await waitFor(() => expect(result.current.conflict).toBeNull());
    expect(calls.filter((c) => c.method === "PUT").length).toBe(putsBefore + 1);
  });
});
