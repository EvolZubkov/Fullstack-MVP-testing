/**
 * @module features/content/__tests__/bulk-content-ops.branches.test
 * @description Branch-completion coverage for the «Папки и темы» bulk-operation
 * modals (Р-2..Р-8) that the render-only and behaviour siblings do not reach:
 * the network-failure `catch` paths (destructive toast + `?? "…"` fallback
 * messages), the forced vs. non-forced impact partitions, the alternate dialog
 * titles / banners (1 vs. N items, clean vs. conflicted), the `?? 0` count
 * fallbacks, the non-admin operation sets, and the presentational
 * {@link BulkImpactDialog} banner-tone / detail branches. `fetch` is stubbed per
 * case (never real); `useToast` is a spy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { Folder } from "@shared/schema";

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

import {
  BulkImpactDialog,
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
// Second user has no `name` → exercises the email/id fallback in userLabel/userOpts.
const users = [{ id: "u1", name: "Петров", email: "p@corp.ru" }, { id: "u2", email: "e2@corp.ru" }];

// ── fetch stub: route a call to a caller-supplied response descriptor ───────
interface Route { ok?: boolean; status?: number; body?: unknown }
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

beforeEach(() => { toastSpy.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ── BulkImpactDialog — presentational branches ──────────────────────────────
describe("BulkImpactDialog — banner tone + detail branches", () => {
  it("renders the default (warning) banner, applied+skipped detail lines and the force switch", () => {
    render(
      <BulkImpactDialog
        open
        title="Проверка"
        bannerText="Внимание, часть заблокирована"
        appliedLabel="Будет удалено"
        applied={[{ id: "t1", name: "Тема A", detail: "в разделе" }]}
        skippedLabel="Пропущено"
        skipped={[{ id: "t2", name: "Тема B", detail: "в тесте" }]}
        confirmLabel="Удалить"
        canForce
        forced={false}
        onForceChange={() => {}}
        forceLabel="Администратор: удалить всё равно"
        forceHint="Сломает опубликованные тесты"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    // Banner (default tone) + both list details render.
    expect(screen.getByText("Внимание, часть заблокирована")).toBeInTheDocument();
    expect(screen.getByText("в разделе")).toBeInTheDocument();
    expect(screen.getByText("в тесте")).toBeInTheDocument();
    // canForce && skipped.length > 0 && onForceChange → the force switch renders.
    expect(screen.getByRole("checkbox", { name: /удалить всё равно/ })).toBeInTheDocument();
  });

  it("renders the explicit error banner tone", () => {
    render(
      <BulkImpactDialog
        open
        title="X"
        bannerTone="error"
        bannerText="Ошибка проверки"
        appliedLabel="A"
        applied={[{ id: "t1", name: "Тема A" }]}
        skippedLabel="S"
        skipped={[]}
        confirmLabel="OK"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Ошибка проверки")).toBeInTheDocument();
    // No skipped → no force switch even if canForce were set.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

// ── GroupMoveModal — failure paths ──────────────────────────────────────────
describe("GroupMoveModal — apply failures", () => {
  it("surfaces a destructive toast when the topics bulk-move fails (default «move» message)", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("bulk-move") ? { ok: false, status: 500, body: {} } : { ok: true, body: {} },
    );
    const onDone = vi.fn();
    render(
      <GroupMoveModal open directTopicIds={["t1"]} folderIds={[]} folders={folders} onClose={() => {}} onDone={onDone} />,
    );
    fireEvent.click(screen.getByTestId("ct-group-move-confirm"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "move" }),
      ),
    );
    expect(onDone).not.toHaveBeenCalled();
    // Topics move failed → reparent is never attempted.
    expect(hit(fetchMock, "/api/folders/bulk-reparent", "POST")).toBe(false);
  });

  it("passes through a non-cycle reparent error message when the server names one", async () => {
    stubFetch((url) =>
      url.includes("bulk-reparent") ? { ok: false, status: 400, body: { error: "boom" } } : { ok: true, body: {} },
    );
    const onDone = vi.fn();
    render(
      <GroupMoveModal open directTopicIds={[]} folderIds={["f1"]} folders={folders} onClose={() => {}} onDone={onDone} />,
    );
    fireEvent.click(screen.getByTestId("ct-group-move-confirm"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "boom" })),
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it("falls back to the «reparent» message when the reparent error has no field", async () => {
    stubFetch((url) =>
      url.includes("bulk-reparent") ? { ok: false, status: 500, body: {} } : { ok: true, body: {} },
    );
    render(
      <GroupMoveModal open directTopicIds={[]} folderIds={["f1"]} folders={folders} onClose={() => {}} onDone={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("ct-group-move-confirm"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "reparent" })),
    );
  });
});

// ── GroupAccessModal — failure paths, non-admin, disabled, count fallbacks ──
describe("GroupAccessModal — branches", () => {
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

  it("grant success with a missing count falls back to 0 in the toast", async () => {
    stubFetch(() => ({ ok: true, body: {} })); // grantedCount undefined → ?? 0
    const { onClose } = renderAccess();
    pickUser();
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Доступ выдан на темы: 0" }));
  });

  it("visibility success with a missing count falls back to 0", async () => {
    const { onClose } = renderAccess();
    stubFetch(() => ({ ok: true, body: {} })); // updatedCount undefined → ?? 0
    fireEvent.click(screen.getByText("Видимость"));
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Видимость изменена у тем: 0" }));
  });

  it("owner success with a missing count falls back to 0", async () => {
    stubFetch(() => ({ ok: true, body: {} })); // updatedCount undefined → ?? 0
    const { onClose } = renderAccess();
    fireEvent.click(screen.getByText("Владелец"));
    pickUser();
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Владелец изменён у тем: 0" }));
  });

  it("soft-revoke success with a missing count falls back to 0", async () => {
    stubFetch(() => ({ ok: true, body: {} })); // revokedCount undefined → ?? 0
    const { onClose } = renderAccess();
    fireEvent.click(screen.getByText("Отозвать"));
    pickUser();
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Доступ отозван на темы: 0" }));
  });

  it("grant failure raises a destructive toast and keeps the dialog open", async () => {
    stubFetch(() => ({ ok: false, status: 500, body: {} }));
    const { onDone, onClose } = renderAccess();
    pickUser();
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "grant" })),
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("visibility failure raises a destructive toast (default «visibility» message)", async () => {
    stubFetch(() => ({ ok: false, status: 500, body: {} }));
    renderAccess();
    fireEvent.click(screen.getByText("Видимость"));
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "visibility" })),
    );
  });

  it("owner failure raises a destructive toast (default «owner» message)", async () => {
    stubFetch(() => ({ ok: false, status: 500, body: {} }));
    renderAccess();
    fireEvent.click(screen.getByText("Владелец"));
    pickUser();
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "owner" })),
    );
  });

  it("soft-revoke failure raises a destructive toast (default «revoke» message)", async () => {
    stubFetch(() => ({ ok: false, status: 500, body: {} }));
    renderAccess();
    fireEvent.click(screen.getByText("Отозвать"));
    pickUser();
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "revoke" })),
    );
  });

  it("hard-revoke dry-run failure raises a destructive toast without opening the impact screen", async () => {
    stubFetch((url) => (url.includes("dryRun=true") ? { ok: false, status: 500, body: {} } : { ok: true, body: {} }));
    renderAccess();
    fireEvent.click(screen.getByText("Отозвать"));
    pickUser();
    fireEvent.click(screen.getByRole("radio", { name: /Жёсткий отзыв/ }));
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "revoke" })),
    );
    // The impact preview screen must NOT appear.
    expect(screen.queryByText("Жёсткий отзыв доступа")).not.toBeInTheDocument();
  });

  it("hard revoke without conflicts executes the unforced (?mode=hard) revoke", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("dryRun=true")) {
        return { ok: true, body: { revocable: [{ topicId: "t1", name: "Тема A" }], blocked: [] } };
      }
      return { ok: true, body: {} }; // revokedCount undefined → ?? 0
    });
    const { onDone, onClose } = renderAccess();
    fireEvent.click(screen.getByText("Отозвать"));
    pickUser();
    fireEvent.click(screen.getByRole("radio", { name: /Жёсткий отзыв/ }));
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() => expect(screen.getByText("Жёсткий отзыв доступа")).toBeInTheDocument());
    // No blocked entries → no force switch; confirm the clean revoke directly.
    expect(screen.queryByRole("checkbox", { name: /отозвать всё равно/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ct-impact-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const exec = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/api/topics/bulk-revoke") && !String(c[0]).includes("dryRun"),
    );
    expect(exec).toBeTruthy();
    expect(String(exec![0])).toContain("mode=hard");
    expect(String(exec![0])).not.toContain("force=true");
    expect(onDone).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Доступ отозван на темы: 0" }));
  });

  it("hard-revoke execute failure raises a destructive toast", async () => {
    stubFetch((url) =>
      url.includes("dryRun=true")
        ? { ok: true, body: { revocable: [{ topicId: "t1", name: "Тема A" }], blocked: [] } }
        : { ok: false, status: 500, body: {} },
    );
    renderAccess();
    fireEvent.click(screen.getByText("Отозвать"));
    pickUser();
    fireEvent.click(screen.getByRole("radio", { name: /Жёсткий отзыв/ }));
    fireEvent.click(screen.getByTestId("ct-group-access-apply"));
    await waitFor(() => expect(screen.getByText("Жёсткий отзыв доступа")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ct-impact-confirm"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "revoke" })),
    );
  });

  it("non-admin: hides the «Владелец» operation and the hard-revoke option", () => {
    renderAccess({ isAdmin: false });
    // Owner segment absent from the operation control.
    expect(screen.queryByText("Владелец")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Отозвать"));
    expect(screen.queryByText(/Жёсткий отзыв/)).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Мягкий отзыв/ })).toBeInTheDocument();
  });

  it("disables Apply when there are no resolved topics (even with a grantee picked)", () => {
    renderAccess({ topicIds: [], topicCount: 0 });
    pickUser();
    expect(screen.getByTestId("ct-group-access-apply")).toBeDisabled();
  });

  it("disables Apply for the owner op until an owner is picked", () => {
    renderAccess();
    fireEvent.click(screen.getByText("Владелец"));
    expect(screen.getByTestId("ct-group-access-apply")).toBeDisabled();
  });
});

// ── FolderDeleteDialog — failure paths + forced cascade partition ───────────
describe("FolderDeleteDialog — branches", () => {
  function renderDialog(over: Partial<React.ComponentProps<typeof FolderDeleteDialog>> = {}) {
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(
      <FolderDeleteDialog
        open
        folderIds={["f1"]}
        folderName="Финансы"
        standaloneTopicIds={[]}
        folders={folders}
        canForce
        onClose={onClose}
        onDone={onDone}
        {...over}
      />,
    );
    return { onDone, onClose };
  }

  it("reparent mode: a folder-only delete failure raises a destructive toast", async () => {
    stubFetch(() => ({ ok: false, status: 500, body: {} }));
    const { onDone } = renderDialog();
    fireEvent.click(screen.getByTestId("ct-folder-delete-move"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "delete" })),
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it("cascade mode: a dry-run failure raises a destructive toast and no impact screen", async () => {
    stubFetch((url) => (url.includes("dryRun=true") ? { ok: false, status: 500, body: {} } : { ok: true, body: {} }));
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /Удалить папку со всем содержимым/ }));
    fireEvent.change(screen.getByLabelText("Введите имя папки для подтверждения"), { target: { value: "Финансы" } });
    fireEvent.click(screen.getByTestId("ct-folder-delete-cascade"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "dryrun" })),
    );
    expect(screen.queryByText("Проверка перед удалением")).not.toBeInTheDocument();
  });

  it("cascade mode: forcing includes blocked topics and deletes with ?force=true", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("dryRun=true")) {
        return {
          ok: true,
          body: {
            deletable: [{ topicId: "t1", name: "Тема A" }],
            blocked: [{ topicId: "t2", name: "Тема B", blocking: [{ title: "Тест X" }] }],
            forbidden: [{ topicId: "t3", name: "Тема C" }],
          },
        };
      }
      return { ok: true, body: {} };
    });
    const { onClose, onDone } = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /Удалить папку со всем содержимым/ }));
    fireEvent.change(screen.getByLabelText("Введите имя папки для подтверждения"), { target: { value: "Финансы" } });
    fireEvent.click(screen.getByTestId("ct-folder-delete-cascade"));
    await waitFor(() => expect(screen.getByText("Проверка перед удалением")).toBeInTheDocument());
    // Admin forces → confirm executes the real cascade delete with force=true.
    fireEvent.click(screen.getByRole("checkbox", { name: /удалить всё равно/ }));
    fireEvent.click(screen.getByTestId("ct-impact-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const del = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/api/folders/f1") && !String(c[0]).includes("dryRun"),
    );
    expect(del).toBeTruthy();
    expect(String(del![0])).toContain("force=true");
    expect(onDone).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Папка удалена" }));
  });

  it("cascade mode: an execute failure raises a destructive toast", async () => {
    stubFetch((url) => {
      if (url.includes("dryRun=true")) {
        return { ok: true, body: { deletable: [{ topicId: "t1", name: "Тема A" }], blocked: [], forbidden: [] } };
      }
      return { ok: false, status: 500, body: {} }; // the real delete fails
    });
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /Удалить папку со всем содержимым/ }));
    fireEvent.change(screen.getByLabelText("Введите имя папки для подтверждения"), { target: { value: "Финансы" } });
    fireEvent.click(screen.getByTestId("ct-folder-delete-cascade"));
    await waitFor(() => expect(screen.getByText("Тема A")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ct-impact-confirm"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "delete" })),
    );
  });

  it("cascade dry-run dedups topics across folders and skips a failed standalone dry-run", async () => {
    stubFetch((url) => {
      if (url.includes("/api/topics/bulk-delete") && url.includes("dryRun=true")) {
        return { ok: false, status: 500, body: {} }; // standalone dry-run fails → if(r.ok) false
      }
      if (url.includes("dryRun=true")) {
        // Both folders report the SAME topic id → the `seen` set must dedup it.
        return { ok: true, body: { deletable: [{ topicId: "tX", name: "Общая" }], blocked: [], forbidden: [] } };
      }
      return { ok: true, body: {} };
    });
    renderDialog({ folderIds: ["f1", "f2"], standaloneTopicIds: ["t9"] });
    fireEvent.click(screen.getByRole("radio", { name: /Удалить папку со всем содержимым/ }));
    fireEvent.change(screen.getByLabelText("Введите имя папки для подтверждения"), { target: { value: "Финансы" } });
    fireEvent.click(screen.getByTestId("ct-folder-delete-cascade"));
    await waitFor(() => expect(screen.getByText("Проверка перед удалением")).toBeInTheDocument());
    // Dedup: «Общая» appears once despite two folders reporting it.
    expect(screen.getAllByText("Общая")).toHaveLength(1);
    // The failed standalone dry-run contributed nothing.
    expect(screen.queryByText("Отдельная")).not.toBeInTheDocument();
  });
});

// ── GroupDeleteFlow — titles, forced partition, execute failure ─────────────
describe("GroupDeleteFlow — branches", () => {
  it("clean multi-topic delete uses the plural «Удалить темы?» title", async () => {
    stubFetch((url) =>
      url.includes("dryRun=true")
        ? { ok: true, body: { deletable: [{ topicId: "t1", name: "Тема A" }, { topicId: "t2", name: "Тема B" }], blocked: [], forbidden: [] } }
        : { ok: true, body: { deletedCount: 2 } },
    );
    render(<GroupDeleteFlow open topicIds={["t1", "t2"]} canForce onClose={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText("Удалить темы?")).toBeInTheDocument());
    expect(screen.getByText(/Ни одна тема не используется/)).toBeInTheDocument();
  });

  it("conflicted delete: shows the check title, forces blocked topics and deletes with ?force=true", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("dryRun=true")
        ? {
            ok: true,
            body: {
              deletable: [{ topicId: "t1", name: "Тема A" }],
              blocked: [{ topicId: "t2", name: "Тема B" }],
              forbidden: [{ topicId: "t3", name: "Тема C" }],
            },
          }
        : { ok: true, body: {} }, // deletedCount undefined → ?? 0
    );
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(<GroupDeleteFlow open topicIds={["t1", "t2", "t3"]} canForce onClose={onClose} onDone={onDone} />);
    await waitFor(() => expect(screen.getByText("Проверка перед удалением")).toBeInTheDocument());
    // Blocked topic with no `blocking` list → the «used in published tests» hint.
    expect(screen.getByText("Используется в опубликованных тестах")).toBeInTheDocument();
    // Forbidden topic → the «no permission» hint (exercises the forbidden mapping).
    expect(screen.getByText("Нет прав на управление")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /удалить всё равно/ }));
    fireEvent.click(screen.getByTestId("ct-impact-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const exec = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/api/topics/bulk-delete") && !String(c[0]).includes("dryRun"),
    );
    expect(String(exec![0])).toContain("force=true");
    expect(onDone).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Удалено тем: 0" }));
  });

  it("execute failure raises a destructive toast", async () => {
    stubFetch((url) =>
      url.includes("dryRun=true")
        ? { ok: true, body: { deletable: [{ topicId: "t1", name: "Тема A" }], blocked: [], forbidden: [] } }
        : { ok: false, status: 500, body: {} },
    );
    render(<GroupDeleteFlow open topicIds={["t1"]} canForce onClose={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText("Тема A")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ct-impact-confirm"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "delete" })),
    );
  });
});
