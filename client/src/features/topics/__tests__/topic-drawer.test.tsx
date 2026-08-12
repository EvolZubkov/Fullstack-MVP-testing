/**
 * @module features/topics/__tests__/topic-drawer.test
 * @description Smoke tests for the unified topic Drawer (PRD-15 T-32). Verifies
 * the component mounts with the real ui-kit Drawer/Tabs/Input and the shared
 * feedback preview, that create mode shows only «Свойства», and that edit mode
 * shows both tabs with the name prefilled.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopicDrawer } from "../topic-drawer";
import type { Topic } from "@shared/schema";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    let body: unknown = {};
    if (u.includes("/access")) body = { topicId: "t1", ownerId: null, visibility: "private", grants: [] };
    else if (u.includes("/api/users")) body = [];
    else if (u.includes("/name-check")) body = { normalized: "", sameOwner: null, duplicates: [] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: React.JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const editTopic = {
  id: "t1",
  name: "Финансовая грамотность",
  description: "",
  feedback: "",
  feedbackJson: null,
  folderId: null,
  ownerId: null,
  visibility: "private",
} as unknown as Topic;

describe("<TopicDrawer />", () => {
  it("create mode: shows only «Свойства» with the name field and feedback preview", () => {
    renderWithClient(
      <TopicDrawer target={{ mode: "create", folderId: null }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    expect(screen.getByTestId("input-topic-name")).toBeInTheDocument();
    expect(screen.getByTestId("topic-feedback")).toBeInTheDocument();
    expect(screen.getByText("Свойства")).toBeInTheDocument();
    // No «Доступ» tab until the topic exists.
    expect(screen.queryByText("Доступ")).not.toBeInTheDocument();
  });

  it("edit mode: shows both tabs and prefills the name", () => {
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    expect(screen.getByText("Свойства")).toBeInTheDocument();
    expect(screen.getByText("Доступ")).toBeInTheDocument();
    expect((screen.getByTestId("input-topic-name") as HTMLInputElement).value).toBe("Финансовая грамотность");
  });

  it("renders nothing interactive when target is null (closed)", () => {
    renderWithClient(<TopicDrawer target={null} folders={[]} isAdmin={false} onClose={() => {}} />);
    expect(screen.queryByTestId("input-topic-name")).not.toBeInTheDocument();
  });

  /** Find the fetch call matching a method + exact url. */
  function calledWith(method: string, url: string): boolean {
    return fetchMock.mock.calls.some(
      (c) => String(c[0]) === url && (c[1] as RequestInit | undefined)?.method === method,
    );
  }

  it("create mode: Save POSTs /api/topics with the feedbackJson body", async () => {
    const onClose = vi.fn();
    renderWithClient(
      <TopicDrawer target={{ mode: "create", folderId: null }} folders={[]} isAdmin={false} onClose={onClose} />,
    );
    fireEvent.change(screen.getByTestId("input-topic-name"), { target: { value: "Новая тема" } });
    fireEvent.click(screen.getByTestId("button-submit-topic"));
    await waitFor(() => expect(calledWith("POST", "/api/topics")).toBe(true));
    const call = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/topics" && (c[1] as RequestInit).method === "POST",
    );
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body.name).toBe("Новая тема");
    expect(body.feedbackJson).toMatchObject({ format: "plain", links: [], assets: [], events: [] });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("edit mode: Save PUTs /api/topics/:id", async () => {
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("button-submit-topic"));
    await waitFor(() => expect(calledWith("PUT", "/api/topics/t1")).toBe(true));
  });

  it("edit mode: «Доступ» tab renders owner / visibility / grants sections", () => {
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin initialTab="access" onClose={() => {}} />,
    );
    expect(screen.getByText("Владелец")).toBeInTheDocument();
    expect(screen.getByText("Видимость")).toBeInTheDocument();
    expect(screen.getByText("Гранты доступа")).toBeInTheDocument();
  });

  it("clicking the empty feedback preview opens the shared editor", async () => {
    renderWithClient(
      <TopicDrawer target={{ mode: "create", folderId: null }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("topic-feedback"));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Обратная связь по теме/i })).toBeInTheDocument(),
    );
  });

  /** Re-stub fetch so the access query returns two grants (active + revoked). */
  function stubWithGrants() {
    fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      let body: unknown = {};
      if (u.includes("/access")) {
        body = {
          topicId: "t1", ownerId: "u1", visibility: "private",
          grants: [
            { id: "g1", granteeId: "u2", granteeName: "Пётр", accessLevel: "use", state: "active" },
            { id: "g2", granteeId: "u3", granteeName: "Анна", accessLevel: "manage", state: "revoked_in_use" },
          ],
        };
      } else if (u.includes("/api/users")) {
        body = [{ id: "u1", name: "Марина", email: "m@t" }, { id: "u2", name: "Пётр", email: "p@t" }];
      } else if (u.includes("/name-check")) {
        body = { normalized: "", sameOwner: null, duplicates: [] };
      }
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  it("access tab: soft revoke DELETEs the active grant", async () => {
    stubWithGrants();
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} initialTab="access" onClose={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText("Пётр")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Отозвать доступ"));
    fireEvent.click(await screen.findByRole("button", { name: "Мягкий отзыв" }));
    await waitFor(() => expect(calledWith("DELETE", "/api/topics/t1/access/g1")).toBe(true));
  });

  it("access tab: «Вернуть» re-POSTs the revoked grant", async () => {
    stubWithGrants();
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} initialTab="access" onClose={() => {}} />,
    );
    fireEvent.click(await screen.findByText("Вернуть"));
    await waitFor(() => expect(calledWith("POST", "/api/topics/t1/access")).toBe(true));
  });

  it("access tab: toggling visibility and Save PATCHes /visibility", async () => {
    stubWithGrants();
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin initialTab="access" onClose={() => {}} />,
    );
    // Wait for the access query to resolve (the effect syncs `shared` from it),
    // otherwise the toggle would be overwritten when the data arrives.
    await waitFor(() => expect(screen.getByText("Пётр")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("button-submit-topic"));
    await waitFor(() => expect(calledWith("PATCH", "/api/topics/t1/visibility")).toBe(true));
  });

  it("access tab: admin can reveal the owner Select", async () => {
    stubWithGrants();
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin initialTab="access" onClose={() => {}} />,
    );
    fireEvent.click(await screen.findByText("Сменить владельца"));
    expect(screen.getByLabelText("Владелец темы")).toBeInTheDocument();
  });

  it("access tab: hard revoke surfaces dependent tests (409), then force-revokes", async () => {
    fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const u = String(url);
      if (u.includes("/access/") && opts?.method === "DELETE") {
        if (u.includes("mode=hard") && !u.includes("force=true")) {
          return {
            ok: false, status: 409,
            json: async () => ({ dependents: [{ testId: "x", title: "Курс финансов", status: "published" }] }),
            text: async () => "",
          };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
      }
      let body: unknown = {};
      if (u.includes("/access")) {
        body = {
          topicId: "t1", ownerId: "u1", visibility: "private",
          grants: [{ id: "g1", granteeId: "u2", granteeName: "Пётр", accessLevel: "use", state: "active" }],
        };
      } else if (u.includes("/api/users")) body = [];
      else if (u.includes("/name-check")) body = { normalized: "", sameOwner: null, duplicates: [] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin initialTab="access" onClose={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText("Пётр")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Отозвать доступ"));
    fireEvent.click(await screen.findByRole("button", { name: "Жёсткий отзыв" }));
    // 409 → dependency list shown.
    expect(await screen.findByText("Курс финансов")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отозвать принудительно" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("force=true"))).toBe(true),
    );
  });

  it("create mode: a duplicate-name error keeps the Drawer open", async () => {
    fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const u = String(url);
      if (u === "/api/topics" && opts?.method === "POST") {
        return { ok: false, status: 409, json: async () => ({ error: "duplicate_topic_name" }), text: async () => '{"error":"duplicate_topic_name"}' };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
    });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    renderWithClient(
      <TopicDrawer target={{ mode: "create", folderId: null }} folders={[]} isAdmin={false} onClose={onClose} />,
    );
    fireEvent.change(screen.getByTestId("input-topic-name"), { target: { value: "Дубликат" } });
    fireEvent.click(screen.getByTestId("button-submit-topic"));
    await waitFor(() => expect(calledWith("POST", "/api/topics")).toBe(true));
    expect(onClose).not.toHaveBeenCalled();
  });

  /** Re-stub fetch so the live name-check reports an other-author collision. */
  function stubWithDuplicateName() {
    fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      let body: unknown = {};
      if (u.includes("/access")) body = { topicId: "t1", ownerId: null, visibility: "private", grants: [] };
      else if (u.includes("/api/users")) body = [];
      else if (u.includes("/name-check")) body = { normalized: "fttb", sameOwner: null, duplicates: [{ id: "d1", name: "FTTB" }] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  it("edit mode: the same-name warning stays hidden while the name is unchanged", async () => {
    stubWithDuplicateName();
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    // Let the debounced name-check fire for the prefilled (unchanged) name.
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/name-check"))).toBe(true),
    );
    expect(screen.queryByTestId("topic-name-warning")).not.toBeInTheDocument();
  });

  it("edit mode: renaming into an other-author collision surfaces the warning", async () => {
    stubWithDuplicateName();
    renderWithClient(
      <TopicDrawer target={{ mode: "edit", topic: editTopic }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByTestId("input-topic-name"), { target: { value: "FTTB" } });
    expect(await screen.findByTestId("topic-name-warning")).toBeInTheDocument();
  });

  it("create mode: an other-author same-name topic surfaces the warning", async () => {
    stubWithDuplicateName();
    renderWithClient(
      <TopicDrawer target={{ mode: "create", folderId: null }} folders={[]} isAdmin={false} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByTestId("input-topic-name"), { target: { value: "FTTB" } });
    expect(await screen.findByTestId("topic-name-warning")).toBeInTheDocument();
  });
});
