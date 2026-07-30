/**
 * @module client/src/lib/__tests__/query-client-scope
 * @description Tests for the MAGIC_SCOPE detection predicate inside
 * `throwIfResNotOk` (exercised through the real `apiRequest`), not for the flag
 * primitive itself (see `magic-scope.test.ts`). Verifies the flag is raised only
 * from the structured `code` field of a 403 JSON body, and stays clear for a
 * benign 403, a 403 whose plain-text body merely mentions the string, and any
 * non-403 status.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiRequest } from "../queryClient";
import { isScopeViolation, resetScopeViolation } from "../magic-scope";

function mockResponse(status: number, body: string, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    statusText: "",
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("throwIfResNotOk MAGIC_SCOPE detection", () => {
  beforeEach(() => {
    resetScopeViolation();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("raises the flag for a 403 with the structured MAGIC_SCOPE code", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(403, JSON.stringify({ error: "Link scope", code: "MAGIC_SCOPE" })),
    );

    await expect(apiRequest("GET", "/api/whatever")).rejects.toThrow("403:");
    expect(isScopeViolation()).toBe(true);
  });

  it("does not raise the flag for an unrelated 403 JSON body", async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(403, JSON.stringify({ error: "Forbidden" })));

    await expect(apiRequest("GET", "/api/whatever")).rejects.toThrow("403:");
    expect(isScopeViolation()).toBe(false);
  });

  it("does not raise the flag for a plain-text 403 body that merely mentions MAGIC_SCOPE", async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(403, "Denied: MAGIC_SCOPE is not JSON here"));

    await expect(apiRequest("GET", "/api/whatever")).rejects.toThrow("403:");
    expect(isScopeViolation()).toBe(false);
  });

  it("does not raise the flag for a non-403 error status", async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(500, JSON.stringify({ code: "MAGIC_SCOPE" })));

    await expect(apiRequest("GET", "/api/whatever")).rejects.toThrow("500:");
    expect(isScopeViolation()).toBe(false);
  });
});
