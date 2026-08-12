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

// ─── PRD-23: themes ──────────────────────────────────────────────────────────

/** Same params as TEMPLATE, plus a declared pair of palettes. */
const THEMED_TEMPLATE = {
  ...TEMPLATE,
  id: "certification",
  manifest: {
    ...TEMPLATE.manifest,
    id: "certification",
    themes: [
      { id: "light", label: "Светлая" },
      { id: "dark", label: "Тёмная" },
    ],
  },
};

function mountThemed(design: Record<string, unknown>) {
  mockFetch((url) => {
    if (url === `/api/tests/${TEST_ID}/design`) return jsonResponse(design);
    if (url === `/api/templates/certification`) return jsonResponse(THEMED_TEMPLATE);
    return jsonResponse({ error: "unexpected" }, 500);
  });
  return renderHook(() => useDesignSettings(TEST_ID), { wrapper });
}

describe("useDesignSettings — themes (PRD-23)", () => {
  it("exposes the declared palettes and reads a missing choice as «Авто»", async () => {
    const { result } = mountThemed({ templateId: "certification", params: {} });
    await waitFor(() => expect(result.current.template).not.toBeNull());
    expect(result.current.themes.map((t) => t.id)).toEqual(["light", "dark"]);
    expect(result.current.theme).toBe("auto");
  });

  it("keeps the picked palettes when the author pins a theme", async () => {
    const { result } = mountThemed({
      templateId: "certification",
      params: {},
      paramsByTheme: { light: { primaryColor: "L" }, dark: { primaryColor: "D" } },
    });
    await waitFor(() => expect(result.current.template).not.toBeNull());
    act(() => result.current.setTheme("light"));
    await waitFor(() => expect(result.current.theme).toBe("light"));
    // Pinning is a choice about DELIVERY, not an edit of the palettes.
    expect(result.current.themeParams).toEqual({
      light: { primaryColor: "L" },
      dark: { primaryColor: "D" },
    });
  });

  // FR-17 — the barrier case: a test branded before PRD-23 must not lose its
  // colour when it lands on a template that ships two palettes.
  it("shows a colour saved flat in every palette and moves it on the first edit", async () => {
    const { result } = mountThemed({
      templateId: "certification",
      params: { primaryColor: "OLD", companyName: "Acme" },
    });
    await waitFor(() => expect(result.current.template).not.toBeNull());
    expect(result.current.themeParams).toEqual({
      light: { primaryColor: "OLD" },
      dark: { primaryColor: "OLD" },
    });

    act(() => result.current.setThemeParam("dark", "primaryColor", "NEW"));
    await waitFor(() =>
      expect(result.current.themeParams.dark).toEqual({ primaryColor: "NEW" }),
    );
    // The light palette kept the old colour instead of following the dark edit…
    expect(result.current.themeParams.light).toEqual({ primaryColor: "OLD" });
    // …the flat leftover is gone, and the non-colour param stayed put.
    expect(result.current.draft.params).toEqual({ companyName: "Acme" });
  });

  it("returns ONE palette to the template without touching the other", async () => {
    const { result } = mountThemed({
      templateId: "certification",
      params: {},
      paramsByTheme: { light: { primaryColor: "L" }, dark: { primaryColor: "D" } },
    });
    await waitFor(() => expect(result.current.template).not.toBeNull());
    act(() => result.current.clearThemeParam("light", "primaryColor"));
    await waitFor(() => expect(result.current.themeParams.light).toEqual({}));
    expect(result.current.themeParams.dark).toEqual({ primaryColor: "D" });
  });
});
