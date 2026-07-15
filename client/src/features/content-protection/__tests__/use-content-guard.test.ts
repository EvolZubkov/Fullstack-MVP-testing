/**
 * @module features/content-protection/__tests__/use-content-guard.test
 * @description Branch coverage for {@link useContentGuard} — the PRD-15 block A
 * "guarded destructive operation" orchestrator (T-12). Drives every arm of the
 * dry-run → dialog → confirm/force flow through {@link renderHook}:
 *   - clean dry-run → immediate execute (and the `confirmClean` gate: true runs,
 *     false aborts);
 *   - warnings → warn dialog → confirm executes;
 *   - `wouldBlock` → block dialog → admin force executes with `?force=true`;
 *   - a failed dry-run → error toast, no dialog;
 *   - a real op that 409s (race) → re-opens the block dialog;
 *   - a 403 → permission toast + close;
 *   - a generic non-ok → error toast + pending cleared.
 * The hook's `useAuth` / `useToast` collaborators are mocked; `fetch` is stubbed
 * per case. `useAuth.hasRole` drives `canForce`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { toastSpy, authState } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  authState: { user: { id: "u1" } as { id: string } | null, roles: [] as string[] },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: authState.user, hasRole: (r: string) => authState.roles.includes(r) }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

import { useContentGuard, type GuardedOperation } from "../use-content-guard";

interface RespSpec {
  ok?: boolean;
  status?: number;
  body?: unknown;
}
function resp(d: RespSpec) {
  return { ok: d.ok ?? true, status: d.status ?? 200, json: async () => d.body ?? {} };
}
/** Route by `dryRun=true` in the URL: the dry-run vs. the real-execute response. */
function stubFetch(dry: RespSpec, exec: RespSpec = { ok: true }) {
  const f = vi.fn(async (url: string) => (String(url).includes("dryRun=true") ? resp(dry) : resp(exec)));
  vi.stubGlobal("fetch", f as unknown as typeof fetch);
  return f;
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function op(over: Partial<GuardedOperation> = {}): GuardedOperation {
  return {
    url: "/api/questions/q1",
    method: "DELETE",
    blockTitle: "BLOCK",
    warnTitle: "WARN",
    confirmLabel: "Удалить",
    onDone: vi.fn(),
    ...over,
  };
}

const CLEAN = { dryRun: true, wouldBlock: false, blocking: [], warnings: [] };

beforeEach(() => {
  toastSpy.mockClear();
  authState.user = { id: "u1" };
  authState.roles = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("useContentGuard — clean dry-run", () => {
  it("executes immediately (no dialog) and calls onDone", async () => {
    const fetchMock = stubFetch({ body: CLEAN }, { ok: true, status: 200 });
    const onDone = vi.fn();
    const { result } = renderHook(() => useContentGuard(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.guard(op({ onDone }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result.current.dialogProps.open).toBe(false);
    expect(result.current.dialogProps.confirmVariant).toBe("destructive");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const exec = fetchMock.mock.calls.find((c) => !String(c[0]).includes("dryRun"));
    expect(String(exec![0])).toBe("/api/questions/q1");
  });

  it("confirmClean=false aborts before executing", async () => {
    const fetchMock = stubFetch({ body: CLEAN });
    const onDone = vi.fn();
    const { result } = renderHook(() => useContentGuard(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.guard(op({ onDone, confirmClean: () => false }));
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the dry-run
    expect(result.current.dialogProps.open).toBe(false);
  });

  it("confirmClean=true executes", async () => {
    const fetchMock = stubFetch({ body: CLEAN }, { ok: true });
    const onDone = vi.fn();
    const { result } = renderHook(() => useContentGuard(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.guard(op({ onDone, confirmClean: () => true }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("useContentGuard — warn dialog", () => {
  it("opens the warn dialog and executes on confirm", async () => {
    stubFetch(
      { body: { dryRun: true, wouldBlock: false, blocking: [], warnings: [{ testId: "tX", issues: [] }] } },
      { ok: true },
    );
    const onDone = vi.fn();
    const { result } = renderHook(() => useContentGuard(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.guard(op({ onDone, warnTitle: "Точно удалить?", confirmVariant: "primary" }));
    });
    expect(result.current.dialogProps.open).toBe(true);
    expect(result.current.dialogProps.mode).toBe("warn");
    expect(result.current.dialogProps.title).toBe("Точно удалить?");
    expect(result.current.dialogProps.confirmVariant).toBe("primary");
    expect(result.current.dialogProps.tests).toHaveLength(1);
    expect(result.current.dialogProps.currentUserId).toBe("u1");
    await act(async () => {
      await result.current.dialogProps.onConfirm!();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result.current.dialogProps.open).toBe(false);
  });
});

describe("useContentGuard — block dialog", () => {
  it("opens the block dialog and forces (admin) with ?force=true", async () => {
    authState.roles = ["administrator"];
    const fetchMock = stubFetch(
      { body: { dryRun: true, wouldBlock: true, blocking: [{ testId: "tX", issues: [] }], warnings: [] } },
      { ok: true },
    );
    const onDone = vi.fn();
    const { result } = renderHook(() => useContentGuard(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.guard(op({ onDone, blockTitle: "Нельзя удалить" }));
    });
    expect(result.current.dialogProps.open).toBe(true);
    expect(result.current.dialogProps.mode).toBe("block");
    expect(result.current.dialogProps.title).toBe("Нельзя удалить");
    expect(result.current.dialogProps.canForce).toBe(true);
    expect(result.current.dialogProps.tests).toHaveLength(1);
    await act(async () => {
      await result.current.dialogProps.onForce!();
    });
    const forced = fetchMock.mock.calls.find((c) => String(c[0]).includes("force=true"));
    expect(forced).toBeTruthy();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("re-opens the block dialog when the real op 409s (race), non-admin cannot force", async () => {
    const { result } = renderHook(() => useContentGuard(), { wrapper: wrapper() });
    stubFetch(
      { body: CLEAN },
      {
        ok: false,
        status: 409,
        body: { error: "content_in_use", message: "", blocking: [{ testId: "tRace", issues: [] }], warnings: [] },
      },
    );
    const onDone = vi.fn();
    await act(async () => {
      await result.current.guard(op({ onDone }));
    });
    expect(result.current.dialogProps.open).toBe(true);
    expect(result.current.dialogProps.mode).toBe("block");
    expect(result.current.dialogProps.tests).toHaveLength(1);
    expect(result.current.dialogProps.canForce).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("useContentGuard — error paths", () => {
  it("toasts and opens nothing when the dry-run request fails", async () => {
    stubFetch({ ok: false, status: 500 });
    const onDone = vi.fn();
    const { result } = renderHook(() => useContentGuard(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.guard(op({ onDone }));
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", description: "Не удалось проверить операцию" }),
    );
    expect(result.current.dialogProps.open).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("toasts a permission error and closes on 403", async () => {
    stubFetch({ body: CLEAN }, { ok: false, status: 403, body: { message: "Только автор" } });
    const onDone = vi.fn();
    const { result } = renderHook(() => useContentGuard(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.guard(op({ onDone }));
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Недостаточно прав", description: "Только автор" }),
    );
    expect(result.current.dialogProps.open).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("toasts a generic error and clears pending when the real op fails", async () => {
    stubFetch({ body: CLEAN }, { ok: false, status: 500 });
    const onDone = vi.fn();
    const { result } = renderHook(() => useContentGuard(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.guard(op({ onDone }));
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", description: "Операция не выполнена" }),
    );
    expect(result.current.dialogProps.pending).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });
});
