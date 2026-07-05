/**
 * @module lib/__tests__/auth.test
 * @description Tests for the auth context/provider (PRD-13). Covers the initial
 * `/api/auth/me` bootstrap, capability checks (`can`) from both the server
 * permission list and the fallback role-based computation, `hasRole`, the
 * `login`/`logout` flows (success + failure), and the guard that `useAuth` must
 * be used inside an `<AuthProvider>`.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { ROLES } from "@shared/access";
import { AuthProvider, useAuth } from "../auth";

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown };

let handler: Handler;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  handler = () => ({ status: 200, body: { user: null } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const { status = 200, body = {} } = handler(String(url), init);
      return jsonResponse(status, body) as unknown as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

async function renderAuth() {
  const rendered = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(rendered.result.current.isLoading).toBe(false));
  return rendered;
}

describe("AuthProvider bootstrap", () => {
  it("starts loading, then resolves to null when the session is anonymous", async () => {
    handler = () => ({ status: 401, body: {} });
    const { result } = await renderAuth();
    expect(result.current.user).toBeNull();
    expect(result.current.can("tests.read")).toBe(false);
    expect(result.current.hasRole(ROLES.AUTHOR)).toBe(false);
  });

  it("loads the authenticated user from /api/auth/me", async () => {
    handler = () => ({
      status: 200,
      body: { user: { id: "u1", name: "Автор", roles: [ROLES.AUTHOR], permissions: ["tests.read"] } },
    });
    const { result } = await renderAuth();
    expect(result.current.user?.id).toBe("u1");
    expect(result.current.hasRole(ROLES.AUTHOR)).toBe(true);
  });

  it("treats a network failure as anonymous", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("offline"));
    const { result } = await renderAuth();
    expect(result.current.user).toBeNull();
  });
});

describe("capability checks", () => {
  it("prefers the server-provided permission list", async () => {
    handler = () => ({
      status: 200,
      body: { user: { id: "u1", roles: [ROLES.LEARNER], permissions: ["analytics.read"] } },
    });
    const { result } = await renderAuth();
    expect(result.current.can("analytics.read")).toBe(true);
    // Not in the explicit list, even though it is implied by no role — list wins.
    expect(result.current.can("tests.delete")).toBe(false);
  });

  it("falls back to role-based permissions when no list is present", async () => {
    handler = () => ({ status: 200, body: { user: { id: "u1", roles: [ROLES.AUTHOR] } } });
    const { result } = await renderAuth();
    // Author holds tests.create via the shared role -> permission map.
    expect(result.current.can("tests.create")).toBe(true);
    expect(result.current.can("system.config")).toBe(false);
  });
});

describe("login / logout", () => {
  it("login resolves true and sets the user on success", async () => {
    handler = (url) => {
      if (url.endsWith("/api/auth/me")) return { status: 401, body: {} };
      if (url.endsWith("/api/auth/login")) return { status: 200, body: { user: { id: "u9", roles: [ROLES.MANAGER] } } };
      return { status: 200, body: {} };
    };
    const { result } = await renderAuth();
    let ok = false;
    await act(async () => {
      ok = await result.current.login("m@e.test", "pw");
    });
    expect(ok).toBe(true);
    expect(result.current.user?.id).toBe("u9");
    expect(result.current.hasRole(ROLES.MANAGER)).toBe(true);
  });

  it("login resolves false on bad credentials", async () => {
    handler = (url) => {
      if (url.endsWith("/api/auth/login")) return { status: 401, body: { error: "bad" } };
      return { status: 401, body: {} };
    };
    const { result } = await renderAuth();
    let ok = true;
    await act(async () => {
      ok = await result.current.login("m@e.test", "wrong");
    });
    expect(ok).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("logout clears the user", async () => {
    handler = (url) => {
      if (url.endsWith("/api/auth/me")) return { status: 200, body: { user: { id: "u1", roles: [ROLES.AUTHOR] } } };
      return { status: 200, body: {} };
    };
    const { result } = await renderAuth();
    expect(result.current.user?.id).toBe("u1");
    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.user).toBeNull();
  });
});

describe("useAuth guard", () => {
  it("throws when used outside an AuthProvider", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Consumer() {
      useAuth();
      return null;
    }
    expect(() => render(<Consumer />)).toThrow(/must be used within an AuthProvider/);
    errSpy.mockRestore();
  });
});
