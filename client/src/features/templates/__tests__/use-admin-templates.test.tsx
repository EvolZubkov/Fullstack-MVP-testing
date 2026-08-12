/**
 * @module features/templates/__tests__/use-admin-templates.test
 * @description Regression test for the PRD-3 cache-invalidation fix: admin
 * lifecycle mutations must invalidate the author-facing template queries
 * (`["templates", ...]` — the design-tab card and the «Заменить шаблон» gallery)
 * in addition to the admin registry list. The global QueryClient runs
 * `staleTime: Infinity`, so without this a template activated in the registry
 * stayed invisible in the test editor's gallery.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useActivateTemplate,
  useDeactivateTemplate,
  useDeleteTemplate,
} from "../use-admin-templates";

function mockFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

function setup<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(hook, { wrapper });
  return { result, invalidateSpy };
}

function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>): unknown[] {
  return spy.mock.calls.map((c: unknown[]) => (c[0] as { queryKey?: unknown })?.queryKey);
}

describe("use-admin-templates — cache invalidation", () => {
  it("activate invalidates both the admin list and the author-facing templates", async () => {
    mockFetch({ id: "acme", status: "active", isActive: true });
    const { result, invalidateSpy } = setup(() => useActivateTemplate());
    await result.current.mutateAsync("acme");
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    const keys = invalidatedKeys(invalidateSpy);
    expect(keys).toContainEqual(["/api/admin/templates"]);
    expect(keys).toContainEqual(["templates"]);
  });

  it("deactivate invalidates the author-facing templates", async () => {
    mockFetch({ id: "acme", status: "inactive", switchedTests: 0 });
    const { result, invalidateSpy } = setup(() => useDeactivateTemplate());
    await result.current.mutateAsync("acme");
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidatedKeys(invalidateSpy)).toContainEqual(["templates"]);
  });

  it("delete invalidates the author-facing templates", async () => {
    mockFetch({ id: "acme", deleted: true });
    const { result, invalidateSpy } = setup(() => useDeleteTemplate());
    await result.current.mutateAsync("acme");
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidatedKeys(invalidateSpy)).toContainEqual(["templates"]);
  });
});
