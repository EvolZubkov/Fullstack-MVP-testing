/**
 * Render tests for the group («Папки и темы») operation modals (Р-2..Р-8).
 * These exercise the component render paths (scope banner, operation segments,
 * two-mode folder delete, partial-batch impact) without hitting the network,
 * except GroupDeleteFlow whose on-open dry-run uses a mocked fetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import {
  BulkImpactDialog,
  GroupMoveModal,
  GroupAccessModal,
  FolderDeleteDialog,
  GroupDeleteFlow,
} from "./bulk-content-ops";
import type { Folder } from "@shared/schema";

const folders = [
  { id: "f1", name: "Финансы", parentId: null },
  { id: "f2", name: "Экономика", parentId: null },
] as Folder[];
const users = [{ id: "u1", name: "Петров", email: "p@corp.ru" }];

beforeEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("BulkImpactDialog", () => {
  it("renders applied and skipped groups + the confirm button", () => {
    render(
      <BulkImpactDialog
        open
        title="Проверка перед удалением"
        appliedLabel="Будет удалено"
        applied={[{ id: "t1", name: "Тема A" }]}
        skippedLabel="Пропущено"
        skipped={[{ id: "t2", name: "Тема B", detail: "в тесте" }]}
        confirmLabel="Удалить 1 тему"
        canForce
        forced={false}
        onForceChange={() => {}}
        forceLabel="Удалить всё равно"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Проверка перед удалением")).toBeInTheDocument();
    expect(screen.getByText("Тема A")).toBeInTheDocument();
    expect(screen.getByText("Тема B")).toBeInTheDocument();
    expect(screen.getByText("Удалить 1 тему")).toBeInTheDocument();
  });

  it("disables the confirm button when nothing applies and not forced", () => {
    render(
      <BulkImpactDialog
        open
        title="X"
        appliedLabel="A"
        applied={[]}
        skippedLabel="S"
        skipped={[{ id: "t2", name: "B" }]}
        confirmLabel="Удалить"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("ct-impact-confirm")).toBeDisabled();
  });
});

describe("GroupMoveModal", () => {
  it("renders the destination picker and the container hint", () => {
    render(
      <GroupMoveModal open directTopicIds={["t1"]} folderIds={["f1"]} folders={folders} onClose={() => {}} onDone={() => {}} />,
    );
    expect(screen.getByText("Переместить в папку")).toBeInTheDocument();
    expect(screen.getByTestId("ct-group-move-confirm")).toBeInTheDocument();
  });
});

describe("GroupAccessModal", () => {
  it("renders the scope banner and all operations (admin)", () => {
    render(
      <GroupAccessModal
        open
        topicIds={["t1", "t2"]}
        topicCount={2}
        folderCount={1}
        users={users}
        isAdmin
        canForce
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(screen.getByText("Групповой доступ")).toBeInTheDocument();
    expect(screen.getByText("Выдать доступ")).toBeInTheDocument();
    expect(screen.getByText("Владелец")).toBeInTheDocument();
    expect(screen.getByTestId("ct-group-access-apply")).toBeInTheDocument();
  });
});

describe("FolderDeleteDialog", () => {
  it("renders the two-mode folder delete", () => {
    render(
      <FolderDeleteDialog
        open
        folderIds={["f1"]}
        folderName="Финансы"
        standaloneTopicIds={[]}
        folders={folders}
        canForce
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(screen.getByText(/Удалить папку «Финансы»/)).toBeInTheDocument();
    expect(screen.getByTestId("ct-folder-delete-move")).toBeInTheDocument();
  });
});

describe("GroupDeleteFlow", () => {
  it("dry-runs on open and shows the impact partition", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ dryRun: true, deletable: [{ topicId: "t1", name: "Тема A" }], blocked: [], forbidden: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GroupDeleteFlow open topicIds={["t1"]} canForce onClose={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText("Тема A")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/topics/bulk-delete?dryRun=true"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
