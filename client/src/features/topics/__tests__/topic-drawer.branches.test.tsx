/**
 * @module features/topics/__tests__/topic-drawer.branches.test
 * @description Branch-coverage tests for the unified topic Drawer (PRD-15 T-32).
 * Complements {@link topic-drawer.test} by driving the still-uncovered branches:
 * the structured `feedbackJson` normalisation, the code/description inputs, the
 * owner-change PATCH (+ its error path), the grant add (Combobox) / level-change
 * (Select) / revoke error paths, the shared feedback editor Save/Cancel, the
 * revoke-modal cancel and the live same-name CLASH (Input error + disabled Save).
 *
 * Harness mirrors {@link topic-drawer.test}: `fetch` is stubbed globally and the
 * Drawer renders inside a throwaway QueryClient.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopicDrawer } from "../topic-drawer";
import type { Topic } from "@shared/schema";

// ─── fetch harness ──────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Build a fetch stub. `access` / `users` seed the two GET queries; `fail` is a
 * predicate that forces a non-ok response for a matching (method, url) — used to
 * exercise the mutation onError branches.
 */
function installFetch(opts: {
  access?: unknown;
  users?: unknown;
  nameCheck?: unknown;
  fail?: (method: string, url: string) => { status: number; body: unknown } | null;
}) {
  const access = opts.access ?? { topicId: "t1", ownerId: null, visibility: "private", grants: [] };
  const users = opts.users ?? [];
  const nameCheck = opts.nameCheck ?? { normalized: "", sameOwner: null, duplicates: [] };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const forced = opts.fail?.(method, u);
    if (forced) {
      return {
        ok: forced.status >= 200 && forced.status < 300,
        status: forced.status,
        json: async () => forced.body,
        text: async () => JSON.stringify(forced.body),
      };
    }
    let body: unknown = {};
    if (u.includes("/access")) body = access;
    else if (u.includes("/api/users")) body = users;
    else if (u.includes("/name-check")) body = nameCheck;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => installFetch({}));
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: React.JSX.Element) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Mirror the app's default queryFn (fetch the queryKey URL) so the
        // `/api/users` query — which has no explicit queryFn — resolves in tests.
        queryFn: async ({ queryKey }) => {
          const res = await fetch(String(queryKey[0]), { credentials: "include" });
          return res.json();
        },
      },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Find a fetch call matching a method + url predicate. */
function callMatching(method: string, pred: (url: string, body: unknown) => boolean) {
  return fetchMock.mock.calls.find((c) => {
    const init = c[1] as RequestInit | undefined;
    const m = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = init?.body;
    }
    return m === method && pred(String(c[0]), body);
  });
}

const editTopic = {
  id: "t1",
  name: "Финансовая грамотность",
  code: "",
  description: "",
  feedback: "",
  feedbackJson: null,
  folderId: null,
  ownerId: null,
  visibility: "private",
} as unknown as Topic;

// ─── Feedback normalisation + property inputs ────────────────────────────────

describe("<TopicDrawer /> — properties branches", () => {
  it("normalises a structured feedbackJson into the preview (feedbackOf object branch)", () => {
    const topic = {
      ...editTopic,
      feedbackJson: { format: "markdown", text: "Читай главу 3", links: [], assets: [], events: [] },
    } as unknown as Topic;
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    expect(screen.getByText("Читай главу 3")).toBeInTheDocument();
  });

  it("edits the code + description and includes them in the create POST body", async () => {
    const onClose = vi.fn();
    renderWithClient(
      <TopicDrawer target={{ mode: "create", folderId: null }} folders={[]} isAdmin={false} onClose={onClose} />,
    );
    fireEvent.change(screen.getByTestId("input-topic-name"), { target: { value: "Этика" } });
    fireEvent.change(screen.getByTestId("input-topic-code"), { target: { value: "ethics" } });
    fireEvent.change(screen.getByTestId("input-topic-description"), { target: { value: "Курс по этике" } });
    fireEvent.click(screen.getByTestId("button-submit-topic"));

    await waitFor(() => expect(callMatching("POST", (u) => u === "/api/topics")).toBeTruthy());
    const call = callMatching("POST", (u) => u === "/api/topics");
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body.code).toBe("ethics");
    expect(body.description).toBe("Курс по этике");
  });

  it("blocks Save and shows an error on a same-owner name CLASH (FR-27)", async () => {
    installFetch({ nameCheck: { normalized: "дубль", sameOwner: { id: "x", name: "Дубль" }, duplicates: [] } });
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByTestId("input-topic-name"), { target: { value: "Дубль" } });
    // The debounced name-check resolves → nameClash disables Save + marks the input.
    await waitFor(() => expect(screen.getByTestId("button-submit-topic")).toBeDisabled());
    expect(screen.getByText(/У вас уже есть тема «Дубль»/i)).toBeInTheDocument();
  });
});

// ─── Shared feedback editor Save / Cancel ────────────────────────────────────

describe("<TopicDrawer /> — feedback editor", () => {
  it("Save in the shared editor writes back into the preview (onSave branch)", async () => {
    renderWithClient(
      <TopicDrawer target={{ mode: "create", folderId: null }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("topic-feedback"));
    const dialog = await screen.findByRole("dialog", { name: /Обратная связь по теме/i });
    fireEvent.change(within(dialog).getByTestId("feedback-editor-text"), {
      target: { value: "Полезный совет" },
    });
    fireEvent.click(within(dialog).getByTestId("feedback-editor-save"));
    // The editor closes and the preview now shows the saved text.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Обратная связь по теме/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Полезный совет")).toBeInTheDocument();
  });

  it("Cancel in the shared editor closes it without changes (onCancel branch)", async () => {
    renderWithClient(
      <TopicDrawer target={{ mode: "create", folderId: null }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("topic-feedback"));
    const dialog = await screen.findByRole("dialog", { name: /Обратная связь по теме/i });
    fireEvent.click(within(dialog).getByTestId("feedback-editor-cancel"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Обратная связь по теме/i })).not.toBeInTheDocument(),
    );
  });
});

// ─── Access tab: owner change ────────────────────────────────────────────────

describe("<TopicDrawer /> — owner change", () => {
  const usersTwo = [
    { id: "u1", name: "Марина", email: "m@t" },
    { id: "u2", name: "Пётр", email: "p@t" },
  ];

  it("admin changes the owner via Select and Save PATCHes /owner", async () => {
    installFetch({
      access: { topicId: "t1", ownerId: "u1", visibility: "private", grants: [] },
      users: usersTwo,
    });
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin initialTab="access" onClose={() => {}} />,
    );
    // Wait for the access query to sync `ownerId` (so the Select shows «Марина»).
    fireEvent.click(await screen.findByText("Сменить владельца"));
    fireEvent.click(await screen.findByRole("button", { name: "Марина" }));
    fireEvent.click(await screen.findByRole("option", { name: "Пётр" }));
    fireEvent.click(screen.getByTestId("button-submit-topic"));

    await waitFor(() =>
      expect(callMatching("PATCH", (u, b) => u.endsWith("/owner") && (b as { ownerId?: string }).ownerId === "u2")).toBeTruthy(),
    );
  });

  it("keeps the Drawer open when the owner PATCH fails (saveMutation onError)", async () => {
    const onClose = vi.fn();
    installFetch({
      access: { topicId: "t1", ownerId: "u1", visibility: "private", grants: [] },
      users: usersTwo,
      fail: (m, u) => (m === "PATCH" && u.endsWith("/owner") ? { status: 500, body: { error: "boom" } } : null),
    });
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin initialTab="access" onClose={onClose} />,
    );
    fireEvent.click(await screen.findByText("Сменить владельца"));
    fireEvent.click(await screen.findByRole("button", { name: "Марина" }));
    fireEvent.click(await screen.findByRole("option", { name: "Пётр" }));
    fireEvent.click(screen.getByTestId("button-submit-topic"));

    await waitFor(() =>
      expect(callMatching("PATCH", (u) => u.endsWith("/owner"))).toBeTruthy(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the owner email when the owner has no display name (displayName fallback)", async () => {
    installFetch({
      access: { topicId: "t1", ownerId: "u1", visibility: "private", grants: [] },
      users: [{ id: "u1", name: "", email: "owner@t" }],
    });
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin initialTab="access" onClose={() => {}} />,
    );
    expect(await screen.findByText("owner@t")).toBeInTheDocument();
  });
});

// ─── Access tab: grant add / level-change / revoke error ─────────────────────

describe("<TopicDrawer /> — grants", () => {
  it("adds a grant via the Combobox + «Добавить» (POST /access)", async () => {
    installFetch({
      access: { topicId: "t1", ownerId: "u1", visibility: "private", grants: [] },
      users: [
        { id: "u1", name: "Марина", email: "m@t" },
        { id: "u5", name: "Иван", email: "i@t" },
      ],
    });
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} initialTab="access" onClose={() => {}} />,
    );
    await screen.findByText("Гранты доступа");
    // Open the user Combobox and pick the only addable user.
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Иван" }));
    // Change the add-form level Select (the only «Уровень доступа» here — no grants yet).
    fireEvent.click(screen.getByRole("button", { name: "Просмотр" }));
    fireEvent.click(await screen.findByRole("option", { name: "Управление" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));

    await waitFor(() =>
      expect(
        callMatching(
          "POST",
          (u, b) =>
            u.endsWith("/access") &&
            (b as { granteeId?: string }).granteeId === "u5" &&
            (b as { accessLevel?: string }).accessLevel === "manage",
        ),
      ).toBeTruthy(),
    );
  });

  it("changes an active grant's level via the row Select (upsert)", async () => {
    installFetch({
      access: {
        topicId: "t1", ownerId: "u1", visibility: "private",
        grants: [{ id: "g1", granteeId: "u2", granteeName: "Пётр", accessLevel: "use", state: "active" }],
      },
      users: [{ id: "u1", name: "Марина", email: "m@t" }],
    });
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} initialTab="access" onClose={() => {}} />,
    );
    const row = (await screen.findByText("Пётр")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Просмотр" }));
    fireEvent.click(await screen.findByRole("option", { name: "Управление" }));

    await waitFor(() =>
      expect(
        callMatching("POST", (u, b) => u.endsWith("/access") && (b as { accessLevel?: string }).accessLevel === "manage"),
      ).toBeTruthy(),
    );
  });

  it("surfaces the error path when the grant upsert fails (upsertGrant onError)", async () => {
    installFetch({
      access: {
        topicId: "t1", ownerId: "u1", visibility: "private",
        grants: [{ id: "g1", granteeId: "u2", granteeName: "Пётр", accessLevel: "use", state: "active" }],
      },
      users: [{ id: "u1", name: "Марина", email: "m@t" }],
      fail: (m, u) => (m === "POST" && u.endsWith("/access") ? { status: 400, body: { error: "нельзя" } } : null),
    });
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} initialTab="access" onClose={() => {}} />,
    );
    const row = (await screen.findByText("Пётр")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Просмотр" }));
    fireEvent.click(await screen.findByRole("option", { name: "Управление" }));
    await waitFor(() => expect(callMatching("POST", (u) => u.endsWith("/access"))).toBeTruthy());
    // The row stays (onError only toasts — no refetch / clear).
    expect(screen.getByText("Пётр")).toBeInTheDocument();
  });

  it("surfaces the error path when a soft revoke fails (revokeMutation onError)", async () => {
    installFetch({
      access: {
        topicId: "t1", ownerId: "u1", visibility: "private",
        grants: [{ id: "g1", granteeId: "u2", granteeName: "Пётр", accessLevel: "use", state: "active" }],
      },
      users: [{ id: "u1", name: "Марина", email: "m@t" }],
      fail: (m, u) => (m === "DELETE" && u.includes("/access/") ? { status: 500, body: { error: "fail" } } : null),
    });
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} initialTab="access" onClose={() => {}} />,
    );
    await screen.findByText("Пётр");
    fireEvent.click(screen.getByLabelText("Отозвать доступ"));
    fireEvent.click(await screen.findByRole("button", { name: "Мягкий отзыв" }));
    await waitFor(() => expect(callMatching("DELETE", (u) => u.includes("/access/g1"))).toBeTruthy());
  });

  it("closes the revoke modal on «Отмена» (ModalDialog onClose branch)", async () => {
    installFetch({
      access: {
        topicId: "t1", ownerId: "u1", visibility: "private",
        grants: [{ id: "g1", granteeId: "u2", granteeName: "Пётр", accessLevel: "use", state: "active" }],
      },
      users: [{ id: "u1", name: "Марина", email: "m@t" }],
    });
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin initialTab="access" onClose={() => {}} />,
    );
    await screen.findByText("Пётр");
    fireEvent.click(screen.getByLabelText("Отозвать доступ"));
    const modal = await screen.findByRole("dialog", { name: "Отозвать доступ" });
    fireEvent.click(within(modal).getByRole("button", { name: "Отмена" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Отозвать доступ" })).not.toBeInTheDocument(),
    );
  });
});

// ─── Tab switching ───────────────────────────────────────────────────────────

describe("<TopicDrawer /> — tab switching", () => {
  it("switches between «Свойства» and «Доступ» tabs (Tabs onChange)", async () => {
    installFetch({ access: { topicId: "t1", ownerId: "u1", visibility: "private", grants: [] }, users: [] });
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin onClose={() => {}} />,
    );
    // Starts on «Свойства».
    expect(screen.getByTestId("input-topic-name")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Доступ" }));
    expect(await screen.findByText("Гранты доступа")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Свойства" }));
    expect(screen.getByTestId("input-topic-name")).toBeInTheDocument();
  });
});
