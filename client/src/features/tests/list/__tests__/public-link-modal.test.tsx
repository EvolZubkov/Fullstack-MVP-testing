/**
 * @module features/tests/list/__tests__/public-link-modal.test
 * @description Component tests for the public link window: the disabled state with the
 * enable action, the enabled state with copy / rotate / disable, and the unpublished test
 * that cannot be given a link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@skillum/ui-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@skillum/ui-kit")>()),
  useToast: () => ({ push: toastMock, dismiss: vi.fn(), clear: vi.fn() }),
}));

import { PublicLinkModal } from "../public-link-modal";

const URL_1 = "http://localhost/p/" + "a".repeat(64);
const URL_2 = "http://localhost/p/" + "b".repeat(64);

let state: { url: string | null; published: boolean };
let calls: { url: string; method: string }[];

beforeEach(() => {
  toastMock.mockClear();
  calls = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    calls.push({ url: String(url), method });
    if (method === "POST") state = { url: URL_2, published: true };
    if (method === "DELETE") state = { url: null, published: true };
    const body = state;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PublicLinkModal test={{ id: "t1", title: "Тест" }} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("PublicLinkModal", () => {
  it("offers to enable a disabled link and shows the link after POST", async () => {
    state = { url: null, published: true };
    renderModal();
    expect(await screen.findByText("Ссылка выключена")).toBeTruthy();
    const enable = await screen.findByTestId("public-link-enable");
    await waitFor(() => expect((enable as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(enable);
    await waitFor(() => expect((screen.getByTestId("public-link-url") as HTMLInputElement).value).toBe(URL_2));
    expect(calls).toContainEqual({ url: "/api/tests/t1/public-link", method: "POST" });
  });

  it("shows the link and copies, rotates and disables it", async () => {
    state = { url: URL_1, published: true };
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderModal();
    const input = (await screen.findByTestId("public-link-url")) as HTMLInputElement;
    expect(input.value).toBe(URL_1);

    fireEvent.click(screen.getByTestId("public-link-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_1));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Ссылка скопирована" })));

    fireEvent.click(screen.getByTestId("public-link-rotate"));
    await waitFor(() => expect((screen.getByTestId("public-link-url") as HTMLInputElement).value).toBe(URL_2));

    fireEvent.click(screen.getByTestId("public-link-disable"));
    await waitFor(() => expect(calls).toContainEqual({ url: "/api/tests/t1/public-link", method: "DELETE" }));
    expect(await screen.findByText("Ссылка выключена")).toBeTruthy();
  });

  it("blocks enabling for an unpublished test and explains why", async () => {
    state = { url: null, published: false };
    renderModal();
    expect(await screen.findByText("Ссылку можно выпустить только для опубликованного теста.")).toBeTruthy();
    expect((screen.getByTestId("public-link-enable") as HTMLButtonElement).disabled).toBe(true);
  });
});
