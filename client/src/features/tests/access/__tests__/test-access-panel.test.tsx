/**
 * @module features/tests/access/__tests__/test-access-panel.test
 * @description Coverage suite for the per-test access panel (PRD-13, WF-2). Drives
 * the owner section (display / «не назначен» / change-owner Select), the grants
 * table (empty state, per-row level change, revoke), the add-grant flow (Combobox +
 * level + «Добавить»), and the explicit «Сохранить» that batches owner change,
 * grant upserts and revocations — asserting the exact endpoints hit, the success
 * toast + onClose, and the error toast on a failed request.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

import { TestAccessPanel } from "../test-access-panel";

// ─── Fixtures ────────────────────────────────────────────────────────────────────

const users = () => [
  { id: "u1", name: "Иван Петров", email: "ivan@t.ru", roles: ["author"] },
  { id: "u2", name: "Мария Сидорова", email: "maria@t.ru", roles: ["manager"] },
  { id: "u3", name: "Пётр Смирнов", email: "petr@t.ru", roles: ["author"] },
];

type Access = { testId: string; ownerId: string | null; grants: { userId: string; accessLevel: "edit" | "assign" }[] };

let access: Access;
let ownerPatchOk: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
let calls: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  toastMock.mockClear();
  access = { testId: "t1", ownerId: "u1", grants: [{ userId: "u2", accessLevel: "edit" }] };
  ownerPatchOk = true;
  calls = [];

  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const fail = (body: unknown) => ({ ok: false, status: 400, json: async () => body, text: async () => JSON.stringify(body) });

  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method || "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET") calls.push({ url: u, method, body });
    if (u === "/api/users") return ok(users());
    if (u === "/api/tests/t1/access" && method === "GET") return ok(access);
    if (u === "/api/tests/t1/owner") return ownerPatchOk ? ok({}) : fail({ error: "Владельца сменить нельзя" });
    if (u === "/api/tests/t1/access" && method === "POST") return ok({});
    if (u.startsWith("/api/tests/t1/access/")) return ok({}); // DELETE revoke
    return ok([]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function renderPanel(props?: { test?: { id: string; title: string } | null; onClose?: () => void }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  const onClose = props?.onClose ?? vi.fn();
  const test = props && "test" in props ? props.test ?? null : { id: "t1", title: "Тест по финансам" };
  const utils = render(
    <QueryClientProvider client={client}>
      <TestAccessPanel test={test} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

/** Wait until the loaded access draft has seeded the panel (owner name visible). */
async function renderLoaded(props?: Parameters<typeof renderPanel>[0]) {
  const utils = renderPanel(props);
  await waitFor(() => expect(screen.getByText("Мария Сидорова")).toBeInTheDocument());
  return utils;
}

describe("<TestAccessPanel />", () => {
  it("renders nothing when no test is selected (drawer closed)", () => {
    renderPanel({ test: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the owner and the existing grant row", async () => {
    await renderLoaded();
    // Owner (u1) shown via avatar + name; grantee (u2) in the table.
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    expect(screen.getByText("Мария Сидорова")).toBeInTheDocument();
    // A real grant → no empty state.
    expect(screen.queryByText("Доступ ещё никому не выдан")).not.toBeInTheDocument();
    expect(screen.getByText("Тест по финансам")).toBeInTheDocument();
  });

  it("shows «Владелец не назначен» when the test has no owner", async () => {
    access = { testId: "t1", ownerId: null, grants: [] };
    renderPanel();
    await waitFor(() => expect(screen.getByText("Владелец не назначен")).toBeInTheDocument());
    // No grants → empty state.
    expect(screen.getByText("Доступ ещё никому не выдан")).toBeInTheDocument();
  });

  it("reveals the owner Select on «Сменить владельца»", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Сменить владельца" }));
    // The Select trigger now carries the current owner as its value.
    expect(screen.getByLabelText("Владелец теста")).toBeInTheDocument();
  });

  it("adds a grant through the combobox + level, showing the new row", async () => {
    await renderLoaded();
    // Only u3 is addable (u1 is owner, u2 already granted).
    const combo = screen.getByRole("combobox");
    fireEvent.focus(combo);
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Пётр Смирнов"));
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    // The new grantee now appears in the table alongside the existing one.
    await waitFor(() => expect(screen.getByText("Пётр Смирнов")).toBeInTheDocument());
    expect(screen.getByText("Мария Сидорова")).toBeInTheDocument();
  });

  it("revokes a grant, collapsing the table to its empty state", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Отозвать доступ" }));
    await waitFor(() => expect(screen.getByText("Доступ ещё никому не выдан")).toBeInTheDocument());
    expect(screen.queryByText("Мария Сидорова")).not.toBeInTheDocument();
  });

  it("changes a grant level through the per-row Select", async () => {
    await renderLoaded();
    const row = screen.getByText("Мария Сидорова").closest("tr")!;
    // The row Select trigger shows the current level; open it and pick «Назначение».
    fireEvent.click(within(row).getByText("Редактирование").closest("button")!);
    fireEvent.click(screen.getByRole("option", { name: "Назначение" }));
    await waitFor(() => expect(within(row).getByText("Назначение")).toBeInTheDocument());
  });

  it("saves an owner change → PATCH /owner, success toast and onClose", async () => {
    const { onClose } = await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Сменить владельца" }));
    fireEvent.click(screen.getByLabelText("Владелец теста").querySelector("button")!);
    fireEvent.click(screen.getByRole("option", { name: "Пётр Смирнов" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/tests/t1/owner" && c.method === "PATCH")).toBe(true));
    const owner = calls.find((c) => c.url === "/api/tests/t1/owner")!;
    expect((owner.body as { ownerId: string }).ownerId).toBe("u3");
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Доступ сохранён" })));
    expect(onClose).toHaveBeenCalled();
  });

  it("saves an added grant → POST /access with the chosen level", async () => {
    await renderLoaded();
    const combo = screen.getByRole("combobox");
    fireEvent.focus(combo);
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Пётр Смирнов"));
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(screen.getByText("Пётр Смирнов")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url === "/api/tests/t1/access" && c.method === "POST");
      expect(post).toBeTruthy();
      expect((post!.body as { userId: string }).userId).toBe("u3");
    });
  });

  it("saves a revocation → DELETE /access/:userId", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Отозвать доступ" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/tests/t1/access/u2" && c.method === "DELETE")).toBe(true),
    );
  });

  it("surfaces a failed owner change via a destructive toast (no close)", async () => {
    ownerPatchOk = false;
    const { onClose } = await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Сменить владельца" }));
    fireEvent.click(screen.getByLabelText("Владелец теста").querySelector("button")!);
    fireEvent.click(screen.getByRole("option", { name: "Пётр Смирнов" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Владельца сменить нельзя" }),
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
