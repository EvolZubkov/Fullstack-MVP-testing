/**
 * @module features/tests/editor/__tests__/use-design-settings.test
 * @description Unit tests for the PRD-3 version-reconciliation behaviour added
 * to {@link useDesignSettings}: detecting a drifted `templateVersion` snapshot
 * and re-stamping it (dropping params that no longer exist in the new manifest).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDesignSettings } from "../use-design-settings";

const TEST_ID = "te-1";

const TEMPLATE = {
  id: "corporate",
  name: "Корпоративный",
  description: null,
  version: "1.2.0",
  templateApiVersion: "1.0",
  isBuiltin: true,
  isActive: true,
  previewPath: null,
  manifest: {
    id: "corporate",
    name: "Корпоративный",
    version: "1.2.0",
    templateApiVersion: "1.0",
    params: [
      { key: "companyName", type: "text", label: "Название" },
      { key: "primaryColor", type: "color", label: "Цвет" },
    ],
  },
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDesignSettings — version reconciliation (PRD-3)", () => {
  it("flags templateOutdated on drift; refreshTemplateVersion re-stamps and prunes params", async () => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`)
        return jsonResponse({
          templateId: "corporate",
          templateVersion: "1.0.0",
          templateApiVersion: "1.0",
          params: { companyName: "Acme", bogus: "x" },
        });
      if (url === `/api/templates/corporate`) return jsonResponse(TEMPLATE);
      return jsonResponse({ error: "unexpected" }, 500);
    });

    const { result } = renderHook(() => useDesignSettings(TEST_ID), { wrapper });
    await waitFor(() => expect(result.current.templateOutdated).toBe(true));

    act(() => result.current.refreshTemplateVersion());

    expect(result.current.draft.templateId).toBe("corporate");
    expect(result.current.draft.templateVersion).toBe("1.2.0");
    expect(result.current.draft.templateApiVersion).toBe("1.0");
    // `companyName` exists in the new manifest → kept; `bogus` → dropped.
    expect(result.current.draft.params).toEqual({ companyName: "Acme" });
    expect(result.current.isDirty).toBe(true);
    // The banner must clear immediately (follows the draft) so the click gives
    // visible feedback before the author saves.
    expect(result.current.templateOutdated).toBe(false);
  });

  it("does not flag templateOutdated when versions match", async () => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/design`)
        return jsonResponse({ templateId: "corporate", templateVersion: "1.2.0", params: {} });
      if (url === `/api/templates/corporate`) return jsonResponse(TEMPLATE);
      return jsonResponse({ error: "unexpected" }, 500);
    });

    const { result } = renderHook(() => useDesignSettings(TEST_ID), { wrapper });
    await waitFor(() => expect(result.current.template).not.toBeNull());
    expect(result.current.templateOutdated).toBe(false);
  });
});
