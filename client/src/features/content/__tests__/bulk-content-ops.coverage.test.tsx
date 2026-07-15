/**
 * @module features/content/__tests__/bulk-content-ops.coverage.test
 * @description Behaviour (network) coverage for the «Папки и темы» bulk-operation
 * modals (Р-2..Р-8) that the render-only sibling suite does not exercise: the
 * confirm paths that actually fire requests. For each modal we open it, drive the
 * confirmation, and assert the resulting `fetch` calls plus the success/error
 * toast and the `onDone`/`onClose` wiring:
 *   - {@link GroupMoveModal}   — bulk-move topics + reparent folders, and the
 *     `invalid_parent` cycle error.
 *   - {@link GroupAccessModal} — grant / visibility / owner / soft-revoke apply,
 *     and the hard-revoke dry-run → impact → forced execute flow.
 *   - {@link FolderDeleteDialog} — reparent («folder-only») mode and the
 *     cascade dry-run → impact → delete flow (folders + standalone topics).
 *   - {@link GroupDeleteFlow}  — clean confirm → execute, and the dry-run failure.
 * `fetch` is stubbed per case (never real); `useToast` is a spy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { Folder } from "@shared/schema";

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

import {
  GroupMoveModal,
  GroupAccessModal,
  FolderDeleteDialog,
  GroupDeleteFlow,
  type GroupAccessModalProps,
} from "../bulk-content-ops";

// ── Fixtures ──────────────────────────────────────────────────────────────
const folders = [
  { id: "f1", name: "Финансы", parentId: null },
  { id: "f2", name: "Экономика", parentId: null },
] as Folder[];
const users = [{ id: "u1", name: "Петров", email: "p@corp.ru" }];

// ── fetch stub: route a call to a caller-supplied response descriptor ───────
interface Route {
  ok?: boolean;
  status?: number;
  body?: unknown;
}
type Router = (url: string, method: string, body: any) => Route;

function stubFetch(router: Router) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const r = router(String(url), method, body) ?? {};
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body ?? {} };
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

/** Was `urlPart` requested with `method`? */
function hit(fetchMock: ReturnType<typeof stubFetch>, urlPart: string, method: string): boolean {
  return fetchMock.mock.calls.some(
    (c) => String(c[0]).includes(urlPart) && (c[1] as RequestInit | undefined)?.method === method,
  );
}

/** Open the single Combobox in the dialog and pick the first (Петров) user. */
function pickUser(match: RegExp = /Петров/) {
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: match }));
}

beforeEach(() => {
  toastSpy.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── GroupMoveModal ──────────────────────────────────────────────────────────
describe("GroupMoveModal — apply", () => {
  it("bulk-moves topics and reparents folders, then reports success and closes", async () => {
    const fetchMock = stubFetch(() => ({ ok: true, body: {} }));
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(
      <GroupMoveModal
        open
        directTopicIds={["t1", "t2"]}
        folderIds={["f1"]}
        folders={folders}
        onClose={onClose}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByTestId("ct-group-move-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hit(fetchMock, "/api/topics/bulk-move", "POST")).toBe(true);
    expect(hit(fetchMock, "/api/folders/bulk-reparent", "POST")).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Перенесено" }));
  });

  it("surfaces the cycle-prevented error when reparent returns invalid_parent", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("bulk-reparent")
        ? { ok: false, status: 400, body: { error: "invalid_parent" } }
        : { ok: true, body: {} },
    );
    const onDone = vi.fn();
    render(
      <GroupMoveModal open directTopicIds={[]} folderIds={["f1"]} folders={folders} onClose={() => {}} onDone={onDone} />,
    );
    fireEvent.click(screen.getByTestId("ct-group-move-confirm"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          description: "Нельзя перенести папку внутрь себя или своего потомка",
        }),
      ),
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(hit(fetchMock, "/api/topics/bulk-move", "POST")).toBe(false);
  });
});

// ── GroupAccessModal ─────────────────────────────────────────────────────────
describe("GroupAccessModal — apply operations", () => {
  function renderAccess(over: Partial<GroupAccessModalProps> = {}) {
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(
      <GroupAccessModal
        open
        topicIds={["t1", "t2"]}
        topicCount={2}
        folderCount={0}
        users={users}
        isAdmin
        canForce
        onClose={onClose}
        onDone={onDone}
        {...over}
      />,
    );
    return { onDone, onClose };
  }

  it("grant: POSTs bulk-grant for the picked user and closes", async () => {
    const fetchMock = stubFetch(() => ({ ok: true, body: { grantedCount: 2 } }));
    const { onDone, onClose } = renderAccess();
    pickUser();
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hit(fetchMock, "/api/topics/bulk-grant", "POST")).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Доступ выдан на темы: 2" }));
  });

  it("visibility: POSTs bulk-visibility (no user needed)", async () => {
    const fetchMock = stubFetch(() => ({ ok: true, body: { updatedCount: 2 } }));
    const { onClose } = renderAccess();
    fireEvent.click(screen.getByText("Видимость")); // switch op to «vis»
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hit(fetchMock, "/api/topics/bulk-visibility", "POST")).toBe(true);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Видимость изменена у тем: 2" }));
  });

  it("owner: POSTs bulk-owner for the picked owner (admin)", async () => {
    const fetchMock = stubFetch(() => ({ ok: true, body: { updatedCount: 2 } }));
    const { onClose } = renderAccess();
    fireEvent.click(screen.getByText("Владелец")); // switch op to «owner»
    pickUser();
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hit(fetchMock, "/api/topics/bulk-owner", "POST")).toBe(true);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Владелец изменён у тем: 2" }));
  });

  it("soft revoke: POSTs bulk-revoke without a mode", async () => {
    const fetchMock = stubFetch(() => ({ ok: true, body: { revokedCount: 2 } }));
    const { onClose } = renderAccess();
    fireEvent.click(screen.getByText("Отозвать")); // switch op to «revoke»
    pickUser();
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const revokeCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/topics/bulk-revoke"));
    expect(revokeCall).toBeTruthy();
    expect(String(revokeCall![0])).not.toContain("mode=hard");
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Доступ отозван на темы: 2" }));
  });

  it("hard revoke: previews dependents, then force-executes the revoke", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("dryRun=true")) {
        return {
          ok: true,
          body: {
            revocable: [{ topicId: "t1", name: "Тема A" }],
            blocked: [{ topicId: "t2", name: "Тема B", dependents: [{ title: "Тест X" }] }],
          },
        };
      }
      return { ok: true, body: { revokedCount: 2 } };
    });
    const { onDone, onClose } = renderAccess();
    fireEvent.click(screen.getByText("Отозвать"));
    pickUser();
    fireEvent.click(screen.getByRole("radio", { name: /Жёсткий отзыв/ }));
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    // Impact preview appears with both partitions.
    await waitFor(() => expect(screen.getByText("Жёсткий отзыв доступа")).toBeInTheDocument());
    expect(screen.getByText("Тема A")).toBeInTheDocument();
    expect(screen.getByText("Тема B")).toBeInTheDocument();
    // Admin forces the blocked ones too, then confirms.
    fireEvent.click(screen.getByRole("checkbox", { name: /отозвать всё равно/ }));
    fireEvent.click(screen.getByTestId("ct-impact-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const forced = fetchMock.mock.calls.find((c) => String(c[0]).includes("force=true"));
    expect(forced).toBeTruthy();
    expect(String(forced![0])).toContain("mode=hard");
    expect(onDone).toHaveBeenCalled();
  });
});

// ── FolderDeleteDialog ───────────────────────────────────────────────────────
describe("FolderDeleteDialog — two modes", () => {
  it("reparent mode: deletes folder-only and moves standalone topics", async () => {
    const fetchMock = stubFetch(() => ({ ok: true, body: {} }));
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(
      <FolderDeleteDialog
        open
        folderIds={["f1"]}
        folderName="Финансы"
        standaloneTopicIds={["t9"]}
        folders={folders}
        canForce
        onClose={onClose}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByTestId("ct-folder-delete-move"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hit(fetchMock, "/api/folders/f1", "DELETE")).toBe(true);
    expect(hit(fetchMock, "/api/topics/bulk-move", "POST")).toBe(true);
    expect(onDone).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Папка удалена" }));
  });

  it("cascade mode: dry-runs the impact, then deletes folder + standalone topics", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("dryRun=true") && url.includes("/api/folders/f1")) {
        return {
          ok: true,
          body: {
            deletable: [{ topicId: "t1", name: "Тема A" }],
            blocked: [{ topicId: "t2", name: "Тема B", blocking: [{ title: "Тест X" }] }],
            forbidden: [{ topicId: "t3", name: "Тема C" }],
          },
        };
      }
      if (url.includes("dryRun=true") && url.includes("/api/topics/bulk-delete")) {
        return { ok: true, body: { deletable: [{ topicId: "t9", name: "Отдельная" }] } };
      }
      return { ok: true, body: {} };
    });
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(
      <FolderDeleteDialog
        open
        folderIds={["f1"]}
        folderName="Финансы"
        standaloneTopicIds={["t9"]}
        folders={folders}
        canForce
        onClose={onClose}
        onDone={onDone}
      />,
    );
    // Switch to «Удалить папку со всем содержимым», then confirm-by-name.
    fireEvent.click(screen.getByRole("radio", { name: /Удалить папку со всем содержимым/ }));
    fireEvent.change(screen.getByLabelText("Введите имя папки для подтверждения"), { target: { value: "Финансы" } });
    fireEvent.click(screen.getByTestId("ct-folder-delete-cascade"));
    // Impact preview: deletable A + standalone; skipped B + C.
    await waitFor(() => expect(screen.getByText("Проверка перед удалением")).toBeInTheDocument());
    expect(screen.getByText("Тема A")).toBeInTheDocument();
    expect(screen.getByText("Отдельная")).toBeInTheDocument();
    expect(screen.getByText("Тема B")).toBeInTheDocument();
    expect(screen.getByText("Тема C")).toBeInTheDocument();
    // Execute the delete.
    fireEvent.click(screen.getByTestId("ct-impact-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hit(fetchMock, "/api/folders/f1", "DELETE")).toBe(true);
    expect(hit(fetchMock, "/api/topics/bulk-delete", "POST")).toBe(true);
    expect(onDone).toHaveBeenCalled();
  });
});

// ── GroupDeleteFlow ──────────────────────────────────────────────────────────
describe("GroupDeleteFlow — dry-run → execute", () => {
  it("confirms a clean delete and executes the bulk-delete", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("dryRun=true")
        ? { ok: true, body: { deletable: [{ topicId: "t1", name: "Тема A" }], blocked: [], forbidden: [] } }
        : { ok: true, body: { deletedCount: 1 } },
    );
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(<GroupDeleteFlow open topicIds={["t1"]} canForce onClose={onClose} onDone={onDone} />);
    await waitFor(() => expect(screen.getByText("Тема A")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ct-impact-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // A clean run makes two calls: dry-run + the real (unforced) delete.
    const execCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/api/topics/bulk-delete") && !String(c[0]).includes("dryRun"),
    );
    expect(execCall).toBeTruthy();
    expect(String(execCall![0])).not.toContain("force=true");
    expect(onDone).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Удалено тем: 1" }));
  });

  it("closes with an error toast when the dry-run fails", async () => {
    stubFetch(() => ({ ok: false, status: 500, body: {} }));
    const onClose = vi.fn();
    render(<GroupDeleteFlow open topicIds={["t1"]} canForce onClose={onClose} onDone={() => {}} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});
