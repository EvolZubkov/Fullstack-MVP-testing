/**
 * @module features/tests/list/tests-list
 * @description Explorer-tree page for the authoring tests list (PRD-7 §5.5,
 * wireframe `docs/wireframes/approved/prd7-tests-list.html`).
 *
 * Implementation coverage:
 *   - s-default     — tree with folders + indented tests
 *   - s-collapsed   — chevron collapse per folder
 *   - s-search      — flat list with breadcrumb (s-search wireframe)
 *   - s-empty       — empty-state with two CTA buttons
 *   - s-loading     — skeleton rows
 *   - s-error       — error pane with retry
 *   - s-menu-open   — per-test more-menu (Edit / Export SCORM / Publish↔Unpublish / Move / Archive / Delete)
 *   - s-folder-menu — per-folder more-menu (Rename / Delete)
 *   - s-folder-delete-a/b — two-mode folder delete confirmation
 *   - s-fab-open    — speed-dial FAB (New test / New folder)
 *   - s-fab-folder-pick — folder picker modal for new test
 *
 * Deferred (separate ticket): s-preview side-panel, s-lazy pagination,
 * archive page (`prd7-tests-archive.html` / FR-31), s-fab-restricted.
 *
 * The page renders inside `AuthorLayout`, so the outer sidebar + header are
 * supplied by the layout; this component only renders the toolbar, tree
 * content, modals and the FAB.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertCircle,
  Archive,
  BarChart3,
  ChevronRight,
  ClipboardList,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Globe,
  Info,
  KeyRound,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Trash2,
  TriangleAlert,
  Users,
  ArrowRight,
} from "lucide-react";
import {
  Button,
  Input,
  ModalDialog,
  Select,
  Skeleton,
  Tag,
} from "@universityrt/ui-kit";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TestEditor } from "@/features/tests/editor/test-editor";
import { TestAccessPanel } from "@/features/tests/access/test-access-panel";
import { AssignTestDialog } from "@/components/assign-test-dialog";
import { useAuth } from "@/lib/auth";
import type { Test, TestSection, TestFolder } from "@shared/schema";
import {
  buildSearchRows,
  buildTreeRows,
  excludeArchived,
} from "./tree-builder";
import type {
  FolderEntry,
  SortKey,
  TestListEntry,
  TestListFlowMode,
} from "./tests-list.types";

// ─── Raw API shape (subset we consume from GET /api/tests) ────────────────────

type ApiTestRow = Test & {
  sections: (TestSection & { topicName?: string; maxQuestions?: number })[];
  /** Owner display name resolved server-side (PRD-13). */
  ownerName?: string | null;
};

function apiToEntry(row: ApiTestRow): TestListEntry {
  const flowMode = (row as { flowPolicyJson?: { mode?: string } | null }).flowPolicyJson?.mode;
  return {
    id: row.id,
    title: row.title,
    status: (row.status as TestListEntry["status"]) ?? "draft",
    mode: (row.mode as TestListEntry["mode"]) ?? "standard",
    flowMode: (isFlowMode(flowMode) ? flowMode : "linear_flat") as TestListFlowMode,
    folderId: row.folderId ?? null,
    ownerId: row.ownerId ?? null,
    ownerName: row.ownerName ?? null,
    topicCount: row.sections?.length ?? 0,
    questionCount: row.sections?.reduce((sum, s) => sum + (s.drawCount ?? 0), 0) ?? 0,
    assignmentCount: (row as { assignmentCount?: number }).assignmentCount ?? 0,
    updatedAt: (row as { updatedAt?: string | Date | null }).updatedAt ?? null,
    createdAt: (row as { createdAt?: string | Date | null }).createdAt ?? null,
  };
}

function isFlowMode(value: unknown): value is TestListFlowMode {
  return (
    value === "linear_flat" ||
    value === "linear_by_topics" ||
    value === "router_by_topics"
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Module-level stable empty arrays so that `useMemo` dependencies stay stable
 * while React Query data is still loading (`= []` in destructuring creates a
 * fresh array on every render → reference change → memo recompute → useEffect
 * loop).
 */
const EMPTY_TESTS: ApiTestRow[] = [];
const EMPTY_FOLDERS: TestFolder[] = [];

// ─── Component ────────────────────────────────────────────────────────────────

export function TestsListPage(): React.JSX.Element {
  const { toast } = useToast();
  const { can } = useAuth();

  // Data ----------------------------------------------------------------------
  const {
    data: rawTests = EMPTY_TESTS,
    isLoading,
    isError,
    refetch,
  } = useQuery<ApiTestRow[]>({
    queryKey: ["/api/tests"],
    queryFn: () => fetchJson("/api/tests"),
  });
  const { data: rawFolders = EMPTY_FOLDERS } = useQuery<TestFolder[]>({
    queryKey: ["/api/test-folders"],
    queryFn: () => fetchJson("/api/test-folders"),
  });

  const entries: TestListEntry[] = useMemo(
    () => excludeArchived(rawTests.map(apiToEntry)),
    [rawTests],
  );
  const folders: FolderEntry[] = useMemo(
    () => rawFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId ?? null })),
    [rawFolders],
  );

  // Local UI state ------------------------------------------------------------
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    return (localStorage.getItem("tests_sort") as SortKey) || "created_desc";
  });
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(folders.map((f) => f.id)),
  );
  useEffect(() => {
    // Expand new folders by default when the folder list changes. Important:
    // return the same `prev` reference when nothing was added, otherwise
    // setState triggers a re-render even on no-op (which can mask deeper
    // issues and produce render thrashing under React strict mode).
    setExpandedFolderIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const f of folders) {
        if (!next.has(f.id)) {
          next.add(f.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [folders]);

  const handleSortChange = (next: SortKey) => {
    setSortBy(next);
    localStorage.setItem("tests_sort", next);
  };

  // Drawer (editor) -----------------------------------------------------------
  // The Drawer can be open in one of two modes:
  //   - edit: pencil action / row click → load existing test by id
  //   - create: FAB → «Новый тест» → folder pick → empty draft with folderId
  const [editorTarget, setEditorTarget] = useState<
    | null
    | { kind: "edit"; testId: string }
    | { kind: "create"; folderId: string | null }
  >(null);

  // More-menu --------------------------------------------------------------
  const [testMenu, setTestMenu] = useState<{ id: string } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ id: string } | null>(null);

  // Test delete confirm (FR-30) ---------------------------------------------
  const [deleteTestState, setDeleteTestState] = useState<{
    id: string;
    title: string;
    input: string;
    error: string | null;
  } | null>(null);

  // Folder operations -------------------------------------------------------
  const [renameFolder, setRenameFolder] = useState<{ id: string; value: string } | null>(null);
  const [deleteFolderState, setDeleteFolderState] = useState<{
    id: string;
    name: string;
    mode: "folder-only" | "folder-and-tests";
    moveTo: string | null;
    input: string;
    error: string | null;
  } | null>(null);

  // FAB --------------------------------------------------------------------
  const [fabOpen, setFabOpen] = useState(false);
  const [fabFolderPick, setFabFolderPick] = useState<
    | null
    | { kind: "new-test"; selected: string | null }
    | { kind: "new-folder"; value: string }
  >(null);

  // Move-to-folder picker (S13.1-G32): replaces window.prompt with a radio-list
  // modal. `current` is the folder the test is in right now (pre-selected and
  // disabled as a no-op), `selected` is the user's pick.
  const [moveFolderPick, setMoveFolderPick] = useState<
    | null
    | { testId: string; testTitle: string; current: string | null; selected: string | null }
  >(null);

  // Existing dialogs (assign / export) --------------------------------------
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignTest, setAssignTest] = useState<{ id: string; title: string } | null>(null);

  // Access panel (PRD-13, WF-2) — admin/superadmin only ---------------------
  const [accessTest, setAccessTest] = useState<{ id: string; title: string } | null>(null);
  const canGrantAccess = can("tests.access.grant");

  // ─── Mutations ───────────────────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: async (args: { id: string; status: "draft" | "published" | "archived" }) => {
      return apiRequest("PATCH", `/api/tests/${args.id}/status`, { status: args.status });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tests"] }),
  });

  const moveMutation = useMutation({
    mutationFn: async (args: { testId: string; folderId: string | null }) =>
      apiRequest("PATCH", `/api/test-folders/move/${args.testId}`, { folderId: args.folderId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tests"] }),
  });

  const deleteTestMutation = useMutation({
    mutationFn: async (args: { id: string; confirmTitle: string }) =>
      apiRequest("DELETE", `/api/tests/${args.id}`, { confirmTitle: args.confirmTitle }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tests"] }),
  });

  const createFolderMutation = useMutation({
    mutationFn: async (args: { name: string; parentId?: string | null }) =>
      apiRequest("POST", "/api/test-folders", { name: args.name, parentId: args.parentId ?? null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/test-folders"] }),
  });

  const renameFolderMutation = useMutation({
    mutationFn: async (args: { id: string; name: string }) =>
      apiRequest("PUT", `/api/test-folders/${args.id}`, { name: args.name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/test-folders"] }),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (args: {
      id: string;
      mode: "folder-only" | "folder-and-tests";
      moveTestsTo?: string | null;
      confirmName?: string;
    }) =>
      apiRequest(
        "DELETE",
        `/api/test-folders/${args.id}`,
        args.mode === "folder-only"
          ? { mode: "folder-only", moveTestsTo: args.moveTestsTo ?? null }
          : { mode: "folder-and-tests", confirmName: args.confirmName ?? "" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
    },
  });

  // ─── Derived rows ────────────────────────────────────────────────────────
  const isSearchMode = searchQuery.trim().length > 0;
  const treeRows = useMemo(
    () =>
      isSearchMode
        ? []
        : buildTreeRows({ tests: entries, folders, expandedFolderIds, sort: sortBy }),
    [isSearchMode, entries, folders, expandedFolderIds, sortBy],
  );
  const searchRows = useMemo(
    () =>
      isSearchMode
        ? buildSearchRows({ tests: entries, folders, query: searchQuery, sort: sortBy })
        : [],
    [isSearchMode, entries, folders, searchQuery, sortBy],
  );

  // ─── Close dropdowns on outside-click / Escape ───────────────────────────
  useEffect(() => {
    if (!testMenu && !folderMenu) return;
    const closeAll = () => {
      setTestMenu(null);
      setFolderMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    document.addEventListener("click", closeAll);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", closeAll);
      document.removeEventListener("keydown", handleKey);
    };
  }, [testMenu, folderMenu]);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="tb-tests-list" data-testid="tests-list-page">
      <Toolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortBy={sortBy}
        onSortChange={handleSortChange}
        showSort={!isSearchMode}
      />

      {isError ? (
        <ErrorPane onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingPane />
      ) : entries.length === 0 && folders.length === 0 ? (
        <EmptyPane
          onCreateFolder={() =>
            setFabFolderPick({ kind: "new-folder", value: "" })
          }
          onCreateTest={() => setFabFolderPick({ kind: "new-test", selected: null })}
        />
      ) : isSearchMode ? (
        <SearchTree
          rows={searchRows}
          query={searchQuery}
          onClearSearch={() => setSearchQuery("")}
          onOpenTest={(id) => setEditorTarget({ kind: "edit", testId: id })}
          onAssign={(id, title) => {
            setAssignTest({ id, title });
            setAssignDialogOpen(true);
          }}
          onOpenMore={(id) => setTestMenu({ id })}
          testMenu={testMenu}
          entriesById={byId(entries)}
          renderTestMenu={renderTestMenu}
        />
      ) : (
        <DefaultTree
          rows={treeRows}
          totalTests={entries.length}
          expandedFolderIds={expandedFolderIds}
          onToggleFolder={(id) =>
            setExpandedFolderIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onOpenTest={(id) => setEditorTarget({ kind: "edit", testId: id })}
          onAssign={(id, title) => {
            setAssignTest({ id, title });
            setAssignDialogOpen(true);
          }}
          onOpenMore={(id) => setTestMenu({ id })}
          onOpenFolderMore={(id) => setFolderMenu({ id })}
          testMenu={testMenu}
          folderMenu={folderMenu}
          renderTestMenu={renderTestMenu}
          renderFolderMenu={renderFolderMenu}
        />
      )}

      {/* Floating action button --------------------------------------------- */}
      <FabSpeedDial
        open={fabOpen}
        onToggle={() => setFabOpen((v) => !v)}
        onNewTest={() => {
          setFabOpen(false);
          setFabFolderPick({ kind: "new-test", selected: null });
        }}
        onNewFolder={() => {
          setFabOpen(false);
          setFabFolderPick({ kind: "new-folder", value: "" });
        }}
      />

      {/* Modal: FAB new-test folder picker ---------------------------------- */}
      {fabFolderPick?.kind === "new-test" && (
        <FabFolderPickModal
          folders={folders}
          selected={fabFolderPick.selected}
          onSelect={(id) =>
            setFabFolderPick({ kind: "new-test", selected: id })
          }
          onCancel={() => setFabFolderPick(null)}
          onCreate={() => {
            const folderId = fabFolderPick.selected;
            setFabFolderPick(null);
            // Open the Drawer in create-mode with the chosen folder. The
            // editor renders an empty draft, the user fills in title + topics
            // and clicks Save → POST /api/tests; the Drawer auto-closes on
            // success and the list refetches.
            setEditorTarget({ kind: "create", folderId });
          }}
        />
      )}

      {/* Modal: move test to folder (S13.1-G32, replaces window.prompt) ----- */}
      {moveFolderPick !== null && (
        <MoveFolderPickModal
          folders={folders}
          testTitle={moveFolderPick.testTitle}
          current={moveFolderPick.current}
          selected={moveFolderPick.selected}
          onSelect={(id) =>
            setMoveFolderPick((s) => (s ? { ...s, selected: id } : s))
          }
          onCancel={() => setMoveFolderPick(null)}
          onMove={() => {
            if (!moveFolderPick) return;
            const folderId = moveFolderPick.selected;
            moveMutation.mutate({ testId: moveFolderPick.testId, folderId });
            setMoveFolderPick(null);
          }}
        />
      )}

      {/* Modal: FAB new-folder (simple name input) -------------------------- */}
      {fabFolderPick?.kind === "new-folder" && (
        <NewFolderModal
          value={fabFolderPick.value}
          onChange={(v) =>
            setFabFolderPick({ kind: "new-folder", value: v })
          }
          onCancel={() => setFabFolderPick(null)}
          onSubmit={async () => {
            const name = fabFolderPick.value.trim();
            if (!name) return;
            await createFolderMutation.mutateAsync({ name });
            setFabFolderPick(null);
          }}
        />
      )}

      {/* Modal: test delete confirm (FR-30) --------------------------------- */}
      {deleteTestState !== null && (
        <DeleteTestModal
          state={deleteTestState}
          onChange={(input) =>
            setDeleteTestState((s) =>
              s
                ? {
                    ...s,
                    input,
                    error: input === s.title || input === "" ? null : "Название не совпадает",
                  }
                : s,
            )
          }
          onCancel={() => setDeleteTestState(null)}
          onDelete={async () => {
            if (!deleteTestState) return;
            try {
              await deleteTestMutation.mutateAsync({
                id: deleteTestState.id,
                confirmTitle: deleteTestState.input,
              });
              setDeleteTestState(null);
            } catch {
              setDeleteTestState((s) =>
                s ? { ...s, error: "Название не совпадает" } : s,
              );
            }
          }}
        />
      )}

      {/* Modal: folder rename ------------------------------------------------ */}
      {renameFolder !== null && (
        <RenameFolderModal
          value={renameFolder.value}
          onChange={(v) =>
            setRenameFolder((s) => (s ? { ...s, value: v } : s))
          }
          onCancel={() => setRenameFolder(null)}
          onSubmit={async () => {
            if (!renameFolder) return;
            const name = renameFolder.value.trim();
            if (!name) return;
            await renameFolderMutation.mutateAsync({ id: renameFolder.id, name });
            setRenameFolder(null);
          }}
        />
      )}

      {/* Modal: folder delete A/B ------------------------------------------- */}
      {deleteFolderState !== null && (
        <DeleteFolderModal
          state={deleteFolderState}
          folders={folders}
          testsInFolder={entries.filter((e) => e.folderId === deleteFolderState.id).length}
          onChange={(patch) =>
            setDeleteFolderState((s) => (s ? { ...s, ...patch } : s))
          }
          onCancel={() => setDeleteFolderState(null)}
          onDelete={async () => {
            if (!deleteFolderState) return;
            if (deleteFolderState.mode === "folder-and-tests") {
              if (deleteFolderState.input !== deleteFolderState.name) {
                setDeleteFolderState((s) =>
                  s ? { ...s, error: "Название не совпадает" } : s,
                );
                return;
              }
              await deleteFolderMutation.mutateAsync({
                id: deleteFolderState.id,
                mode: "folder-and-tests",
                confirmName: deleteFolderState.input,
              });
            } else {
              await deleteFolderMutation.mutateAsync({
                id: deleteFolderState.id,
                mode: "folder-only",
                moveTestsTo: deleteFolderState.moveTo,
              });
            }
            setDeleteFolderState(null);
          }}
        />
      )}

      {/* Existing AssignTestDialog ------------------------------------------ */}
      {assignTest && (
        <AssignTestDialog
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          testId={assignTest.id}
          testTitle={assignTest.title}
        />
      )}

      {/* TestEditor Drawer (edit + create modes) ---------------------------- */}
      <TestEditor
        testId={editorTarget?.kind === "edit" ? editorTarget.testId : undefined}
        createMode={
          editorTarget?.kind === "create"
            ? { folderId: editorTarget.folderId }
            : undefined
        }
        open={editorTarget !== null}
        onClose={() => setEditorTarget(null)}
      />

      {/* Access panel (PRD-13, WF-2) ---------------------------------------- */}
      <TestAccessPanel test={accessTest} onClose={() => setAccessTest(null)} />
    </div>
  );

  // ─── Helpers that close over component state ─────────────────────────────

  function renderTestMenu(test: TestListEntry) {
    return (
      <div
        className="dropdown-menu"
        role="menu"
        aria-label="Действия с тестом"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="dropdown-item"
          role="menuitem"
          onClick={() => {
            setTestMenu(null);
            setEditorTarget({ kind: "edit", testId: test.id });
          }}
          data-testid={`menu-edit-${test.id}`}
        >
          <Pencil className="h-3.5 w-3.5" />
          Редактировать
        </button>
        {canGrantAccess && (
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              setTestMenu(null);
              setAccessTest({ id: test.id, title: test.title });
            }}
            data-testid={`menu-access-${test.id}`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            Общий доступ
          </button>
        )}
        <a
          className="dropdown-item"
          role="menuitem"
          href={`/api/tests/${test.id}/export/scorm`}
          onClick={() => setTestMenu(null)}
          data-testid={`menu-export-${test.id}`}
        >
          <Download className="h-3.5 w-3.5" />
          Экспорт SCORM
        </a>
        <hr className="dropdown-sep" />
        <button
          type="button"
          className="dropdown-item"
          role="menuitem"
          onClick={() => {
            setTestMenu(null);
            statusMutation.mutate({
              id: test.id,
              status: test.status === "published" ? "draft" : "published",
            });
          }}
          data-testid={`menu-toggle-publish-${test.id}`}
        >
          <Globe className="h-3.5 w-3.5" />
          {test.status === "published" ? "Снять с публикации" : "Опубликовать"}
        </button>
        <hr className="dropdown-sep" />
        <button
          type="button"
          className="dropdown-item"
          role="menuitem"
          onClick={() => {
            setTestMenu(null);
            setMoveFolderPick({
              testId: test.id,
              testTitle: test.title,
              current: test.folderId ?? null,
              selected: test.folderId ?? null,
            });
          }}
          data-testid={`menu-move-${test.id}`}
        >
          <Folder className="h-3.5 w-3.5" />
          Переместить в папку
        </button>
        <button
          type="button"
          className="dropdown-item"
          role="menuitem"
          onClick={() => {
            setTestMenu(null);
            statusMutation.mutate({ id: test.id, status: "archived" });
          }}
          data-testid={`menu-archive-${test.id}`}
        >
          <Archive className="h-3.5 w-3.5" />
          Архивировать
        </button>
        <hr className="dropdown-sep" />
        <button
          type="button"
          className="dropdown-item danger"
          role="menuitem"
          onClick={() => {
            setTestMenu(null);
            setDeleteTestState({ id: test.id, title: test.title, input: "", error: null });
          }}
          data-testid={`menu-delete-${test.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Удалить тест...
        </button>
      </div>
    );
  }

  function renderFolderMenu(folder: FolderEntry) {
    return (
      <div
        className="dropdown-menu"
        role="menu"
        aria-label="Действия с папкой"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="dropdown-item"
          role="menuitem"
          onClick={() => {
            setFolderMenu(null);
            setRenameFolder({ id: folder.id, value: folder.name });
          }}
          data-testid={`folder-menu-rename-${folder.id}`}
        >
          <Pencil className="h-3.5 w-3.5" />
          Переименовать
        </button>
        <hr className="dropdown-sep" />
        <button
          type="button"
          className="dropdown-item danger"
          role="menuitem"
          onClick={() => {
            setFolderMenu(null);
            setDeleteFolderState({
              id: folder.id,
              name: folder.name,
              mode: "folder-only",
              moveTo: null,
              input: "",
              error: null,
            });
          }}
          data-testid={`folder-menu-delete-${folder.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Удалить папку...
        </button>
      </div>
    );
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toolbar(props: {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  sortBy: SortKey;
  onSortChange: (v: SortKey) => void;
  showSort: boolean;
}) {
  return (
    <div className="toolbar">
      <div className="search-input-wrap" role="search">
        <Search className="search-icon" aria-hidden="true" />
        <input
          className="ou-field__input"
          type="text"
          placeholder="Поиск по названию..."
          aria-label="Поиск теста по названию"
          value={props.searchQuery}
          onChange={(e) => props.onSearchChange(e.target.value)}
          data-testid="tests-list-search-input"
        />
      </div>
      {props.searchQuery && (
        <button
          type="button"
          className="search-clear"
          onClick={() => props.onSearchChange("")}
          data-testid="tests-list-search-clear"
        >
          Сбросить
        </button>
      )}
      {props.showSort && (
        <div className="toolbar-sort">
          <span className="toolbar-sort__label">Сортировка:</span>
          <Select<SortKey>
            size="s"
            value={props.sortBy}
            options={[
              { value: "created_desc", label: "Новые сначала" },
              { value: "updated_desc", label: "Недавно изменённые" },
              { value: "title_asc", label: "По названию (А→Я)" },
            ]}
            onChange={(value) => props.onSortChange(value)}
            aria-label="Сортировка тестов"
            data-testid="tests-list-sort"
          />
        </div>
      )}
    </div>
  );
}

function TreeHeader() {
  return (
    <div className="tree-header" aria-hidden="true">
      <div>Название</div>
      <div>Владелец</div>
      <div>Статус</div>
      <div>Режим</div>
      <div>Сценарий</div>
      <div>Тем</div>
      <div>Вопросов</div>
      <div>Назначений</div>
      <div />
    </div>
  );
}

function DefaultTree(props: {
  rows: ReturnType<typeof buildTreeRows>;
  totalTests: number;
  expandedFolderIds: ReadonlySet<string>;
  onToggleFolder: (id: string) => void;
  onOpenTest: (id: string) => void;
  onAssign: (id: string, title: string) => void;
  onOpenMore: (id: string) => void;
  onOpenFolderMore: (id: string) => void;
  testMenu: { id: string } | null;
  folderMenu: { id: string } | null;
  renderTestMenu: (test: TestListEntry) => React.JSX.Element;
  renderFolderMenu: (folder: FolderEntry) => React.JSX.Element;
}) {
  return (
    <div className="tree-area" role="tree" aria-label="Список тестов" data-testid="tests-list-tree">
      <TreeHeader />
      <div
        className="tree-root"
        role="treeitem"
        aria-expanded="true"
        aria-level={1}
      >
        <div className="tree-root-label">
          <FolderOpen className="folder-icon" aria-hidden="true" width={14} height={14} />
          Все тесты <span className="folder-count">&nbsp;({props.totalTests})</span>
        </div>
      </div>
      {props.rows.map((row) => {
        if (row.kind === "root") return null;
        if (row.kind === "folder") {
          return (
            <FolderRow
              key={`folder-${row.id}`}
              folderId={row.id}
              name={row.name}
              testsCount={row.testsCount}
              expanded={row.expanded}
              onToggle={() => props.onToggleFolder(row.id)}
              onMore={(e) => {
                e.stopPropagation();
                props.onOpenFolderMore(row.id);
              }}
              menuOpen={props.folderMenu?.id === row.id}
              menu={props.folderMenu?.id === row.id ? props.renderFolderMenu({ id: row.id, name: row.name, parentId: null }) : null}
            />
          );
        }
        return (
          <TestRow
            key={`test-${row.id}`}
            entry={row.entry}
            indented={row.depth >= 2}
            onClick={() => props.onOpenTest(row.id)}
            onEdit={() => props.onOpenTest(row.id)}
            onAssign={() => props.onAssign(row.id, row.entry.title)}
            onMore={(e) => {
              e.stopPropagation();
              props.onOpenMore(row.id);
            }}
            menuOpen={props.testMenu?.id === row.id}
            menu={props.testMenu?.id === row.id ? props.renderTestMenu(row.entry) : null}
          />
        );
      })}
    </div>
  );
}

function SearchTree(props: {
  rows: ReturnType<typeof buildSearchRows>;
  query: string;
  onClearSearch: () => void;
  onOpenTest: (id: string) => void;
  onAssign: (id: string, title: string) => void;
  onOpenMore: (id: string) => void;
  testMenu: { id: string } | null;
  entriesById: Map<string, TestListEntry>;
  renderTestMenu: (test: TestListEntry) => React.JSX.Element;
}) {
  return (
    <div className="tree-area" role="list" aria-label="Результаты поиска" data-testid="tests-list-search">
      <div className="search-banner" role="status" aria-live="polite">
        <Info aria-hidden="true" width={14} height={14} />
        Результаты поиска по <strong>«{props.query}»</strong>: {props.rows.length} тест(а).
      </div>
      <TreeHeader />
      {props.rows.map((row) => (
        <TestRow
          key={`search-${row.id}`}
          entry={row.entry}
          indented={false}
          breadcrumb={row.folderName}
          onClick={() => props.onOpenTest(row.id)}
          onEdit={() => props.onOpenTest(row.id)}
          onAssign={() => props.onAssign(row.id, row.entry.title)}
          onMore={(e) => {
            e.stopPropagation();
            props.onOpenMore(row.id);
          }}
          menuOpen={props.testMenu?.id === row.id}
          menu={
            props.testMenu?.id === row.id
              ? props.renderTestMenu(props.entriesById.get(row.id) ?? row.entry)
              : null
          }
        />
      ))}
    </div>
  );
}

function FolderRow(props: {
  folderId: string;
  name: string;
  testsCount: number;
  expanded: boolean;
  onToggle: () => void;
  onMore: (e: React.MouseEvent) => void;
  menuOpen: boolean;
  menu: React.JSX.Element | null;
}) {
  return (
    <div
      className="tree-folder"
      role="treeitem"
      aria-expanded={props.expanded}
      aria-level={2}
      onClick={props.onToggle}
      data-testid={`folder-row-${props.folderId}`}
    >
      <div className="tree-folder-name">
        <span className={"chevron" + (props.expanded ? " open" : "")} aria-hidden="true">
          <ChevronRight width={12} height={12} />
        </span>
        {props.expanded ? (
          <FolderOpen className="folder-icon" aria-hidden="true" width={15} height={15} />
        ) : (
          <Folder className="folder-icon" aria-hidden="true" width={15} height={15} />
        )}
        {props.name}
        <span className="folder-count">({props.testsCount})</span>
      </div>
      <div /><div /><div /><div /><div /><div /><div />
      <div className={"tree-folder-actions" + (props.menuOpen ? " is-open" : "")}>
        <div className="more-btn-wrap">
          <button
            type="button"
            className="action-btn"
            aria-label="Действия с папкой"
            onClick={props.onMore}
            data-testid={`folder-more-${props.folderId}`}
          >
            <MoreHorizontal width={14} height={14} />
          </button>
          {props.menu}
        </div>
      </div>
    </div>
  );
}

function TestRow(props: {
  entry: TestListEntry;
  indented: boolean;
  breadcrumb?: string | null;
  onClick: () => void;
  onEdit: () => void;
  onAssign: () => void;
  onMore: (e: React.MouseEvent) => void;
  menuOpen: boolean;
  menu: React.JSX.Element | null;
}) {
  const e = props.entry;
  const { can } = useAuth();
  // PRD-13: gate row actions by capability (the tree is already scope-filtered,
  // so a visible row is always actionable within the role's allowed actions).
  const canEdit = can("tests.edit");
  const canAssign = can("assignments.manage");
  const canAnalytics = can("analytics.read");
  const canAnyMenu =
    canEdit ||
    can("tests.export.scorm") ||
    can("tests.publish") ||
    can("tests.delete") ||
    can("tests.access.grant");
  // Reactive subscription to warning state written by the editor after save.
  // queryFn is never called (enabled: false); setQueryData in the editor triggers re-render.
  const { data: hasWarnings = false } = useQuery<boolean>({
    queryKey: ["test-warnings", e.id],
    queryFn: () => false,
    enabled: false,
    staleTime: Infinity,
  });
  return (
    <div
      className={"tree-test" + (props.indented ? " indent-1" : "")}
      role="treeitem"
      aria-level={props.indented ? 3 : 2}
      onClick={canEdit ? props.onClick : undefined}
      data-testid={`test-row-${e.id}`}
    >
      <div className="tree-test-name">
        {props.indented && <span className="indent-line" aria-hidden="true" />}
        <div className="test-info">
          <div className="test-name">
            {e.title}
            {hasWarnings && (
              <TriangleAlert
                width={14}
                height={14}
                className="test-name-warn"
                aria-label="Тест сохранён с предупреждениями"
              />
            )}
          </div>
          {props.breadcrumb && (
            <div className="tree-test-path">
              <Folder width={11} height={11} aria-hidden="true" />
              <span>{props.breadcrumb}</span>
            </div>
          )}
        </div>
      </div>
      <div className="tree-test-owner">
        <span>{e.ownerName ?? "—"}</span>
      </div>
      <div>
        <StatusTag status={e.status} />
      </div>
      <div>
        <span className={"mode-badge " + e.mode} title={modeTitle(e.mode)}>
          {e.mode === "adaptive" ? "Адаптив" : "Стандарт"}
        </span>
      </div>
      <div>
        <FlowChip flowMode={e.flowMode} />
      </div>
      <div className="tree-num">{e.topicCount}</div>
      <div className="tree-num">{e.questionCount}</div>
      <div className="tree-num">{e.assignmentCount}</div>
      <div className={"tree-test-actions" + (props.menuOpen ? " is-open" : "")}>
        {canEdit && (
          <button
            type="button"
            className="action-btn"
            title="Редактировать"
            aria-label="Редактировать"
            onClick={(ev) => {
              ev.stopPropagation();
              props.onEdit();
            }}
            data-testid={`test-edit-${e.id}`}
          >
            <Pencil width={14} height={14} />
          </button>
        )}
        {canAssign && (
          <button
            type="button"
            className="action-btn"
            title="Назначить"
            aria-label="Назначить"
            onClick={(ev) => {
              ev.stopPropagation();
              props.onAssign();
            }}
            data-testid={`test-assign-${e.id}`}
          >
            <Users width={14} height={14} />
          </button>
        )}
        {canAnalytics && (
          <Link href={`/author/tests/${e.id}/analytics`} onClick={(ev) => ev.stopPropagation()}>
            <button
              type="button"
              className="action-btn"
              title="Аналитика"
              aria-label="Аналитика"
              data-testid={`test-analytics-${e.id}`}
            >
              <BarChart3 width={14} height={14} />
            </button>
          </Link>
        )}
        {canAnyMenu && (
          <div className="more-btn-wrap">
            <button
              type="button"
              className="action-btn"
              aria-label="Ещё действия"
              onClick={props.onMore}
              data-testid={`test-more-${e.id}`}
            >
              <MoreHorizontal width={14} height={14} />
            </button>
            {props.menu}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusTag({ status }: { status: TestListEntry["status"] }) {
  if (status === "published") {
    return <Tag tone="success" aria-label="Статус: опубликован">Опубликован</Tag>;
  }
  if (status === "archived") {
    return <Tag tone="neutral" aria-label="Статус: архив">Архив</Tag>;
  }
  return <Tag tone="neutral" aria-label="Статус: черновик">Черновик</Tag>;
}

function FlowChip({ flowMode }: { flowMode: TestListFlowMode }) {
  if (flowMode === "router_by_topics") {
    return (
      <span className="flow-chip" title="Роутер по темам">
        <GitBranch width={12} height={12} aria-hidden="true" />
        Роутер
      </span>
    );
  }
  if (flowMode === "linear_by_topics") {
    return (
      <span className="flow-chip" title="Линейный по темам">
        <Layers width={12} height={12} aria-hidden="true" />
        По темам
      </span>
    );
  }
  return (
    <span className="flow-chip" title="Линейный (плоский)">
      <ArrowRight width={12} height={12} aria-hidden="true" />
      Линейный
    </span>
  );
}

function modeTitle(mode: TestListEntry["mode"]): string {
  return mode === "adaptive" ? "Адаптивный режим (IRT)" : "Стандартный режим";
}

function byId<T extends { id: string }>(arr: T[]): Map<string, T> {
  return new Map(arr.map((x) => [x.id, x]));
}

// ─── Pseudo-states ────────────────────────────────────────────────────────────

function LoadingPane() {
  return (
    <div className="tree-area" data-testid="tests-list-loading">
      <TreeHeader />
      <div style={{ padding: "var(--ou-space-6)" }}>
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={i}
            style={{
              height: "32px",
              marginBottom: "var(--ou-space-2)",
              borderRadius: "var(--ou-radius-xs)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyPane(props: { onCreateFolder: () => void; onCreateTest: () => void }) {
  return (
    <div className="tree-area" data-testid="tests-list-empty">
      <div className="empty-tree">
        <div className="empty-tree__icon" aria-hidden="true">
          <ClipboardList width={22} height={22} />
        </div>
        <div className="empty-tree__title">Тестов пока нет</div>
        <div className="empty-tree__desc">
          Создайте первый тест или сначала добавьте папку для организации.
        </div>
        <div className="empty-tree__actions">
          <Button
            variant="secondary"
            size="s"
            leadingIcon={<FolderPlus width={13} height={13} />}
            onClick={props.onCreateFolder}
            data-testid="tests-list-empty-new-folder"
          >
            Создать папку
          </Button>
          <Button
            variant="primary"
            size="s"
            leadingIcon={<Plus width={13} height={13} />}
            onClick={props.onCreateTest}
            data-testid="tests-list-empty-new-test"
          >
            Новый тест
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorPane(props: { onRetry: () => void }) {
  return (
    <div className="tree-area" data-testid="tests-list-error">
      <div className="empty-tree" role="alert" aria-live="assertive">
        <div className="empty-tree__icon is-error" aria-hidden="true">
          <AlertCircle width={22} height={22} />
        </div>
        <div className="empty-tree__title">Не удалось загрузить тесты</div>
        <div className="empty-tree__desc">
          Проверьте подключение к сети и попробуйте ещё раз.
        </div>
        <div className="empty-tree__actions">
          <Button
            variant="primary"
            size="s"
            leadingIcon={<RotateCw width={13} height={13} />}
            onClick={props.onRetry}
            data-testid="tests-list-error-retry"
          >
            Повторить
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── FAB speed-dial ───────────────────────────────────────────────────────────

function FabSpeedDial(props: {
  open: boolean;
  onToggle: () => void;
  onNewTest: () => void;
  onNewFolder: () => void;
}) {
  return (
    <div className="fab-wrap">
      {props.open && (
        <div className="fab-actions">
          <div className="fab-action">
            <span className="fab-action-label">Новая папка</span>
            <button
              type="button"
              className="fab-action-btn"
              aria-label="Новая папка"
              onClick={props.onNewFolder}
              data-testid="fab-new-folder"
            >
              <FolderPlus width={18} height={18} />
            </button>
          </div>
          <div className="fab-action">
            <span className="fab-action-label">Новый тест</span>
            <button
              type="button"
              className="fab-action-btn"
              aria-label="Новый тест"
              onClick={props.onNewTest}
              data-testid="fab-new-test"
            >
              <ClipboardList width={18} height={18} />
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className={"ou-fab ou-fab--m" + (props.open ? " ou-fab--open" : "")}
        aria-label={props.open ? "Закрыть меню создания" : "Создать"}
        aria-expanded={props.open}
        onClick={props.onToggle}
        data-testid="fab-toggle"
      >
        <Plus width={24} height={24} />
      </button>
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function DeleteTestModal(props: {
  state: { id: string; title: string; input: string; error: string | null };
  onChange: (input: string) => void;
  onCancel: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const match = props.state.input === props.state.title;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <ModalDialog
      open
      onClose={props.onCancel}
      size="m"
      title="Удалить тест навсегда?"
      footer={
        <>
          <Button
            variant="ghost"
            size="s"
            onClick={props.onCancel}
            data-testid="delete-test-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="destructive"
            size="s"
            disabled={!match}
            onClick={() => void props.onDelete()}
            data-testid="delete-test-confirm"
          >
            Удалить навсегда
          </Button>
        </>
      }
    >
      <label className="typed-confirm__label" htmlFor="del-test-input">
        Введите точное название теста для подтверждения:
      </label>
      <div className="typed-confirm__name-block" aria-hidden="true">
        {props.state.title}
      </div>
      <Input
        ref={inputRef}
        id="del-test-input"
        size="m"
        fullWidth
        type="text"
        placeholder="Введите название…"
        value={props.state.input}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete="off"
        tone={props.state.error ? "error" : match ? "success" : undefined}
        error={props.state.error ?? undefined}
        data-testid="delete-test-input"
      />
      <p className="typed-confirm__hint">Регистр символов учитывается.</p>
    </ModalDialog>
  );
}

function RenameFolderModal(props: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <ModalDialog
      open
      onClose={props.onCancel}
      size="s"
      title="Переименовать папку"
      footer={
        <>
          <Button variant="ghost" size="s" onClick={props.onCancel}>
            Отмена
          </Button>
          <Button
            variant="primary"
            size="s"
            disabled={props.value.trim() === ""}
            onClick={() => void props.onSubmit()}
            data-testid="rename-folder-submit"
          >
            Сохранить
          </Button>
        </>
      }
    >
      <Input
        ref={inputRef}
        size="m"
        fullWidth
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Новое название…"
        autoComplete="off"
        data-testid="rename-folder-input"
      />
    </ModalDialog>
  );
}

function NewFolderModal(props: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <ModalDialog
      open
      onClose={props.onCancel}
      size="s"
      title="Новая папка"
      footer={
        <>
          <Button variant="ghost" size="s" onClick={props.onCancel}>
            Отмена
          </Button>
          <Button
            variant="primary"
            size="s"
            disabled={props.value.trim() === ""}
            onClick={() => void props.onSubmit()}
            data-testid="new-folder-submit"
          >
            Создать
          </Button>
        </>
      }
    >
      <Input
        ref={inputRef}
        size="m"
        fullWidth
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Название папки"
        autoComplete="off"
        data-testid="new-folder-input"
      />
    </ModalDialog>
  );
}

function DeleteFolderModal(props: {
  state: {
    id: string;
    name: string;
    mode: "folder-only" | "folder-and-tests";
    moveTo: string | null;
    input: string;
    error: string | null;
  };
  folders: FolderEntry[];
  testsInFolder: number;
  onChange: (
    patch: Partial<{
      mode: "folder-only" | "folder-and-tests";
      moveTo: string | null;
      input: string;
      error: string | null;
    }>,
  ) => void;
  onCancel: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const otherFolders = props.folders.filter((f) => f.id !== props.state.id);
  const isDestructive = props.state.mode === "folder-and-tests";
  const canDestructive = !isDestructive || props.state.input === props.state.name;

  return (
    <ModalDialog
      open
      onClose={props.onCancel}
      size="m"
      title={`Удалить папку «${props.state.name}»?`}
      description={`Папка содержит ${props.testsInFolder} тест(ов). Выберите, что сделать с тестами.`}
      footer={
        <>
          <Button variant="ghost" size="s" onClick={props.onCancel}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            size="s"
            disabled={!canDestructive}
            onClick={() => void props.onDelete()}
            data-testid="delete-folder-confirm"
          >
            {isDestructive ? "Удалить всё" : "Удалить папку"}
          </Button>
        </>
      }
    >
      <fieldset className="ou-choice-card-group">
            <div className="ou-choice-card-group__items">
              <label
                className={
                  "ou-choice-card" + (!isDestructive ? " is-selected" : "")
                }
              >
                <input
                  className="ou-choice-card__input"
                  type="radio"
                  name="del-folder-mode"
                  value="folder-only"
                  checked={!isDestructive}
                  onChange={() => props.onChange({ mode: "folder-only", error: null })}
                  data-testid="delete-folder-mode-only"
                />
                <span className="ou-choice-card__lead" aria-hidden="true">
                  <Folder width={20} height={20} />
                </span>
                <span className="ou-choice-card__body">
                  <span className="ou-choice-card__title">Только папку</span>
                  <span className="ou-choice-card__desc">
                    Тесты сохраняются и перемещаются в указанное место.
                  </span>
                  {!isDestructive && (
                    <span className="ou-choice-card__inset">
                      <Select<string>
                        id="del-folder-dest"
                        size="m"
                        fullWidth
                        label="Переместить тесты в:"
                        value={props.state.moveTo ?? ""}
                        options={[
                          { value: "", label: "Корень (Все тесты)" },
                          ...otherFolders.map((f) => ({
                            value: f.id,
                            label: f.name,
                          })),
                        ]}
                        onChange={(value) =>
                          props.onChange({
                            moveTo: value === "" ? null : value,
                          })
                        }
                        data-testid="delete-folder-dest"
                      />
                    </span>
                  )}
                </span>
              </label>

              <label
                className={
                  "ou-choice-card ou-choice-card--destructive" + (isDestructive ? " is-selected" : "")
                }
              >
                <input
                  className="ou-choice-card__input"
                  type="radio"
                  name="del-folder-mode"
                  value="folder-and-tests"
                  checked={isDestructive}
                  onChange={() => props.onChange({ mode: "folder-and-tests", error: null })}
                  data-testid="delete-folder-mode-cascade"
                />
                <span className="ou-choice-card__lead" aria-hidden="true">
                  <Trash2 width={20} height={20} />
                </span>
                <span className="ou-choice-card__body">
                  <span className="ou-choice-card__title">Папку и все тесты</span>
                  <span className="ou-choice-card__desc">
                    {props.testsInFolder} тест(ов) будут удалены без возможности восстановления.
                  </span>
                  {isDestructive && (
                    <span className="ou-choice-card__inset">
                      <Input
                        id="del-folder-confirm"
                        size="m"
                        fullWidth
                        label="Введите название папки для подтверждения:"
                        type="text"
                        placeholder={props.state.name}
                        value={props.state.input}
                        onChange={(e) =>
                          props.onChange({
                            input: e.target.value,
                            error:
                              e.target.value === "" || e.target.value === props.state.name
                                ? null
                                : "Название не совпадает",
                          })
                        }
                        autoComplete="off"
                        tone={props.state.error ? "error" : undefined}
                        error={props.state.error ?? undefined}
                        data-testid="delete-folder-confirm-input"
                      />
                      <span className="typed-confirm__hint">
                        Введите точно: <strong>{props.state.name}</strong>
                      </span>
                    </span>
                  )}
                </span>
              </label>
            </div>
          </fieldset>
    </ModalDialog>
  );
}

/**
 * Move-to-folder picker modal (S13.1-G32). Mirrors {@link FabFolderPickModal}
 * but binds to an existing test: pre-selects the current folder, disables
 * «Переместить» until the user picks a different folder, then fires the move
 * mutation. Replaces the legacy `window.prompt("ID папки для перемещения")`.
 */
function MoveFolderPickModal(props: {
  folders: FolderEntry[];
  testTitle: string;
  current: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCancel: () => void;
  onMove: () => void;
}) {
  const noChange = props.selected === props.current;
  return (
    <ModalDialog
      open
      onClose={props.onCancel}
      size="s"
      title="Переместить в папку"
      description={`Выберите папку для теста «${props.testTitle}»`}
      data-testid="move-folder-pick"
      footer={
        <>
          <Button
            variant="ghost"
            size="s"
            onClick={props.onCancel}
            data-testid="move-folder-pick-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            size="s"
            onClick={props.onMove}
            disabled={noChange}
            title={noChange ? "Тест уже в этой папке" : undefined}
            data-testid="move-folder-pick-submit"
          >
            Переместить
          </Button>
        </>
      }
    >
      <div className="fab-folder-list">
        <label className="fab-folder-item">
          <input
            type="radio"
            name="move-folder-pick"
            checked={props.selected === null}
            onChange={() => props.onSelect(null)}
            data-testid="move-folder-pick-root"
          />
          <Folder className="fab-folder-item__ico" width={14} height={14} aria-hidden="true" />
          Корень (без папки)
          {props.current === null && (
            <Tag tone="neutral" variant="outline" size="s">
              Текущая
            </Tag>
          )}
        </label>
        {props.folders.map((f) => (
          <label key={f.id} className="fab-folder-item">
            <input
              type="radio"
              name="move-folder-pick"
              checked={props.selected === f.id}
              onChange={() => props.onSelect(f.id)}
              data-testid={`move-folder-pick-folder-${f.id}`}
            />
            <Folder className="fab-folder-item__ico" width={14} height={14} aria-hidden="true" />
            {f.name}
            {props.current === f.id && (
              <Tag tone="neutral" variant="outline" size="s">
                Текущая
              </Tag>
            )}
          </label>
        ))}
      </div>
    </ModalDialog>
  );
}

function FabFolderPickModal(props: {
  folders: FolderEntry[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <ModalDialog
      open
      onClose={props.onCancel}
      size="s"
      title="Новый тест"
      description="Выберите папку для размещения теста"
      footer={
        <>
          <Button variant="ghost" size="s" onClick={props.onCancel}>
            Отмена
          </Button>
          <Button
            variant="primary"
            size="s"
            onClick={props.onCreate}
            data-testid="fab-pick-create"
          >
            Создать тест
          </Button>
        </>
      }
    >
      <div className="fab-folder-list">
        <label className="fab-folder-item">
          <input
            type="radio"
            name="fab-pick"
            checked={props.selected === null}
            onChange={() => props.onSelect(null)}
            data-testid="fab-pick-root"
          />
          <Folder className="fab-folder-item__ico" width={14} height={14} aria-hidden="true" />
          Корень (без папки)
        </label>
        {props.folders.map((f) => (
          <label key={f.id} className="fab-folder-item">
            <input
              type="radio"
              name="fab-pick"
              checked={props.selected === f.id}
              onChange={() => props.onSelect(f.id)}
              data-testid={`fab-pick-folder-${f.id}`}
            />
            <Folder className="fab-folder-item__ico" width={14} height={14} aria-hidden="true" />
            {f.name}
          </label>
        ))}
      </div>
    </ModalDialog>
  );
}
