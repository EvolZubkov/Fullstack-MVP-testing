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
import { testHref } from "@/features/analytics/levels/analytics-routes";
import {
  AlertCircle,
  Archive,
  BarChart3,
  BugPlay,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
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
  PackageOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
  Users,
  ArrowRight,
  MessageSquare,
} from "lucide-react";
import {
  Banner,
  Button,
  FilterBar,
  Input,
  Label,
  ModalDialog,
  Select,
  Skeleton,
  Stack,
  Tag,
  Text,
  useToast,
} from "@skillum/ui-kit";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { TransferImportDialog } from "@/features/tests/transfer/import-dialog";
import { FolderTreeSelect } from "@/components/folder-tree-select";
import { t } from "@/lib/i18n";
import {
  EMPTY_TEST_FILTER,
  MODE_OPTS,
  SCENARIO_OPTS,
  STATUS_OPTS,
  TEST_SCOPE_OPTS,
  TestFilters,
  testFacetMatch,
  testFilterCount,
  testFilterOf,
  type TestFilterValue,
} from "./tests-filters";
import { stableKey, useListFilters } from "@/features/saved-filters/use-list-filters";
import { ContentImpactDialog } from "@/features/content-protection/content-impact-dialog";
import type {
  BreakdownWarning,
  PublishCheckFinding,
  PublishInfeasibleError,
} from "@/features/content-protection/types";
import { describeBreakdownWarning } from "@/features/content-protection/issue-text";
import { TestEditor } from "@/features/tests/editor/test-editor";
import { describeDeleteImpact, type TestDeleteImpact } from "./delete-impact";
import { SaveAsDialog } from "@/features/tests/export/save-as-dialog";
import type { EditorTabKey } from "@/features/tests/editor/use-test-editor";
import { TestAccessPanel } from "@/features/tests/access/test-access-panel";
import { AssignTestDialog } from "@/components/assign-test-dialog";
import { useAuth } from "@/lib/auth";
import { ROLES } from "@shared/access";
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
    publicationState: (row as { publication?: { state?: TestListEntry["publicationState"] } }).publication?.state,
    unmappedPageCount: (row as { unmappedPageCount?: number }).unmappedPageCount ?? 0,
    openReviewComments: (row as { openReviewComments?: number }).openReviewComments ?? 0,
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
  const { push: toast } = useToast();
  const { can, hasRole, user } = useAuth();

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

  // ─── Filter (mirrors the content section «Темы и вопросы») ────────────────
  const userId = user?.id ?? "";
  const [testFilter, setTestFilter] = useState<TestFilterValue>(EMPTY_TEST_FILTER); // applied
  const [testDraft, setTestDraft] = useState<TestFilterValue>(EMPTY_TEST_FILTER); // edited in the panel
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  const authorOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const e of entries) if (e.ownerId) names.set(e.ownerId, e.ownerName ?? e.ownerId);
    return Array.from(names.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [entries]);

  const filteredEntries = useMemo(
    () =>
      entries.filter(
        (e) =>
          testFacetMatch(e, testFilter) &&
          (testFilter.scope === "all"
            ? true
            : testFilter.scope === "mine"
              ? e.ownerId === userId
              : e.ownerId !== userId),
      ),
    [entries, testFilter, userId],
  );

  // The panel edits a draft of what is applied; closing it without «Применить» drops the draft
  // (PRD-70 FR-74), so every opening starts from the applied filter.
  const toggleFilters = () => { if (!filterOpen) setTestDraft(testFilter); setFilterOpen(!filterOpen); };
  const applyFilters = () => { setTestFilter(testDraft); setFilterOpen(false); };
  /** «Сбросить» of the panel: clears the draft only. */
  const resetDraft = () => setTestDraft(EMPTY_TEST_FILTER);
  /** «Сбросить фильтры» of the bar: clears what is applied. */
  const resetFilters = () => { setTestDraft(EMPTY_TEST_FILTER); setTestFilter(EMPTY_TEST_FILTER); };
  const commitFilter = (next: TestFilterValue) => { setTestFilter(next); setTestDraft(next); };
  // Сохранённые фильтры «Тестов» (решение владельца 2026-10-05): сохранить в ряду условий,
  // применить и удалить — из «Сохранённых».
  const savedFilters = useListFilters({ scope: "tests", current: testFilter, apply: commitFilter, normalize: testFilterOf, keyOf: stableKey });

  const expandAll = () => setExpandedFolderIds(new Set(folders.map((f) => f.id)));
  const collapseAll = () => setExpandedFolderIds(new Set());

  const filterActiveCount = testFilterCount(testFilter);

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
    | { kind: "edit"; testId: string; tab?: EditorTabKey }
    | { kind: "create"; folderId: string | null }
  >(null);

  // PRD-18 (FR-16): a `?edit=<id>` deep-link opens the editor Drawer for that test.
  // The debug player's build-error «Открыть тест в редакторе» action points here so
  // the author can fix the variant/состав and rebuild. The param is stripped after
  // opening so a refresh/back doesn't re-open the Drawer.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("edit");
    // PRD-52 FR-27: `?test=<id>&review=<threadId>` открывает ящик сразу на вкладке
    // «Комментарии» с раскрытой веткой — по такой ссылке рецензент или коллега
    // отправляет автора к конкретному замечанию, а не к тесту вообще.
    const reviewTestId = params.get("test");
    const reviewThreadId = params.get("review");
    if (reviewTestId && reviewThreadId) {
      setEditorTarget({ kind: "edit", testId: reviewTestId, tab: "review" });
      setFocusReviewThreadId(reviewThreadId);
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
      return;
    }
    if (!id) return;
    setEditorTarget({ kind: "edit", testId: id });
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, []);

  /** PRD-52: ветка, раскрытая по ссылке; передаётся в панель комментариев ящика. */
  const [focusReviewThreadId, setFocusReviewThreadId] = useState<string | null>(null);

  // More-menu --------------------------------------------------------------
  const [testMenu, setTestMenu] = useState<{ id: string } | null>(null);
  /** Э5: тест, открытый в окне «Сохранить как…». */
  const [saveAsTest, setSaveAsTest] = useState<{ id: string; title: string } | null>(null);
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
  // PRD-52: тот же диалог, другое выдаваемое право — грант на рецензирование.
  const [assignMode, setAssignMode] = useState<"assign" | "review">("assign");

  // Access panel (PRD-13 / PRD-15 BRC-27) — admin on any test, author on owned.
  const [accessTest, setAccessTest] = useState<{ id: string; title: string } | null>(null);
  const canGrantAccessCap = can("tests.access.grant");
  const isAdmin = hasRole(ROLES.ADMINISTRATOR) || hasRole(ROLES.SUPERADMIN);
  /** May this user grant access to THIS test (object scope, BRC-27). */
  const canGrantAccessFor = (test: TestListEntry) =>
    canGrantAccessCap && (isAdmin || test.ownerId === user?.id);

  // PRD-13: SCORM generation is developer/admin only — the author role holds the
  // debug run but NOT the export, so the two menu items are gated separately.
  const canExportScorm = can("tests.export.scorm");
  const canDebugPlay = can("tests.debug.play");

  // PRD-48: importing a `.tbtest` package creates or updates a test, so the right is the
  // same one «создать тест» needs.
  const canImportPackage = can("tests.create");
  // Э6: пункт меню теста ведёт в «Импорт» на выгрузку LMS этого теста.
  const canImportLms = can("analytics.import");
  const [transferOpen, setTransferOpen] = useState(false);

  // PRD-15 T-12 (E-12): publish-infeasible findings to show in the impact dialog.
  const [publishImpact, setPublishImpact] = useState<{
    testId: string;
    findings: PublishCheckFinding[];
  } | null>(null);

  // PRD-15 FR-14: emergency-republish confirm target.
  const [forceRepublish, setForceRepublish] = useState<{ id: string; title: string } | null>(null);

  // PRD-50 FR-45 - FR-47: замечания УСПЕШНОЙ публикации. null = диалога нет; тест без
  // единого замечания публикуется ровно как раньше, без лишнего экрана.
  const [publishNotes, setPublishNotes] = useState<string[] | null>(null);
  // PRD-15 FR-05: то же самое, но по итогу СОХРАНЕНИЯ — тест сохранён, а выдать
  // вопросы по нему нечем. Отдельная строка состояния, потому что заголовок другой:
  // публикации не было, и запрещать тут нечего.
  const [saveNotes, setSaveNotes] = useState<string[] | null>(null);

  // ─── Mutations ───────────────────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: async (args: { id: string; status: "draft" | "published" | "archived" }) => {
      const res = await apiRequest("PATCH", `/api/tests/${args.id}/status`, { status: args.status });
      // PRD-50: тело публикации может нести предупреждения (FR-45 - FR-47); их показывает
      // onSuccess. Разбор здесь, а не там, потому что onSuccess получает то, что вернул mutationFn.
      return (await res.json()) as { breakdownWarnings?: BreakdownWarning[] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
      if (data.breakdownWarnings?.length) setPublishNotes(data.breakdownWarnings.map(describeBreakdownWarning));
    },
    onError: (error: Error, args) => {
      // apiRequest throws "409: <json>"; surface a publish-infeasible 409 as the
      // content-impact dialog (PRD-15 FR-06), otherwise a generic toast.
      const match = /^409:\s*([\s\S]+)$/.exec(error.message);
      if (match) {
        try {
          const payload = JSON.parse(match[1]) as PublishInfeasibleError;
          if (payload.error === "publish_infeasible") {
            setPublishImpact({ testId: args.id, findings: payload.findings });
            return;
          }
        } catch {
          /* fall through to the toast */
        }
      }
      toast({ tone: "error", title: "Ошибка", description: "Не удалось изменить статус теста" });
    },
  });

  // PRD-15 FR-14: emergency re-publish — new snapshot + annul in-progress attempts.
  const forceRepublishMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/tests/${id}/republish-force`);
      return res.json() as Promise<{ annulledAttempts: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
      setForceRepublish(null);
      toast({
        tone: "success", title: "Тест переопубликован",
        description: `Прервано идущих попыток: ${data.annulledAttempts}`,
      });
    },
    onError: (error: Error) => {
      // A late-feasibility 409 (E-12) surfaces as the impact dialog.
      const match = /^409:\s*([\s\S]+)$/.exec(error.message);
      if (match && forceRepublish) {
        try {
          const payload = JSON.parse(match[1]) as PublishInfeasibleError;
          if (payload.error === "publish_infeasible") {
            setPublishImpact({ testId: forceRepublish.id, findings: payload.findings });
            setForceRepublish(null);
            return;
          }
        } catch {
          /* fall through */
        }
      }
      toast({ tone: "error", title: "Ошибка", description: "Не удалось переопубликовать тест" });
    },
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
        : buildTreeRows({ tests: filteredEntries, folders, expandedFolderIds, sort: sortBy }),
    [isSearchMode, filteredEntries, folders, expandedFolderIds, sortBy],
  );
  const searchRows = useMemo(
    () =>
      isSearchMode
        ? buildSearchRows({ tests: filteredEntries, folders, query: searchQuery, sort: sortBy })
        : [],
    [isSearchMode, filteredEntries, folders, searchQuery, sortBy],
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

  // Active-condition chips (driven by the applied filter).
  const filterChips: { key: string; label: string; remove: () => void }[] = [];
  for (const s of testFilter.statuses) filterChips.push({ key: `st-${s}`, label: `Статус: ${STATUS_OPTS.find((o) => o.value === s)?.label}`, remove: () => commitFilter({ ...testFilter, statuses: testFilter.statuses.filter((x) => x !== s) }) });
  for (const m of testFilter.modes) filterChips.push({ key: `md-${m}`, label: `Режим: ${MODE_OPTS.find((o) => o.value === m)?.label}`, remove: () => commitFilter({ ...testFilter, modes: testFilter.modes.filter((x) => x !== m) }) });
  for (const sc of testFilter.scenarios) filterChips.push({ key: `sc-${sc}`, label: `Сценарий: ${SCENARIO_OPTS.find((o) => o.value === sc)?.label}`, remove: () => commitFilter({ ...testFilter, scenarios: testFilter.scenarios.filter((x) => x !== sc) }) });
  if (testFilter.author) filterChips.push({ key: "au", label: `Владелец: ${authorOptions.find((o) => o.value === testFilter.author)?.label ?? testFilter.author}`, remove: () => commitFilter({ ...testFilter, author: "" }) });
  if (testFilter.scope !== "all") filterChips.push({ key: "sp", label: `Область: ${TEST_SCOPE_OPTS.find((o) => o.value === testFilter.scope)?.label}`, remove: () => commitFilter({ ...testFilter, scope: "all" }) });

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="tb-tests-list" data-testid="tests-list-page">
      <div className="tl-header">
        <PageHeader title={t.tests.title} description={t.tests.description} />
      </div>
      <FilterBar
        role="search"
        search={(
          <Input
            size="s"
            iconLeft={<Search size={16} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по названию…"
            aria-label="Поиск теста по названию"
            fullWidth
            data-testid="tests-list-search-input"
          />
        )}
        count={filterActiveCount}
        applied={filterChips.map((c) => ({ id: c.key, label: c.label }))}
        filterButtonRef={filterButtonRef}
        filterOpen={filterOpen}
        onOpenFilter={toggleFilters}
        onRemove={(id) => filterChips.find((c) => c.key === id)?.remove()}
        onReset={resetFilters}
        {...savedFilters}
        data-testid="tests-list-filterbar"
        actions={(
          <>
            {!isSearchMode && (
              <div className="toolbar-sort">
                <span className="toolbar-sort__label">Сортировка:</span>
                <Select<SortKey>
                  size="s"
                  value={sortBy}
                  options={[
                    { value: "created_desc", label: "Новые сначала" },
                    { value: "updated_desc", label: "Недавно изменённые" },
                    { value: "title_asc", label: "По названию (А→Я)" },
                  ]}
                  onChange={(value) => handleSortChange(value)}
                  aria-label="Сортировка тестов"
                  data-testid="tests-list-sort"
                />
              </div>
            )}
            {!isSearchMode && (
              <Button variant="ghost" size="s" leadingIcon={<ChevronsUpDown width={14} height={14} aria-hidden="true" />} onClick={expandAll}>{t.content.expandAll}</Button>
            )}
            {!isSearchMode && (
              <Button variant="ghost" size="s" leadingIcon={<ChevronsDownUp width={14} height={14} aria-hidden="true" />} onClick={collapseAll}>{t.content.collapseAll}</Button>
            )}
            {canImportPackage && (
              <Button
                variant="ghost"
                size="s"
                leadingIcon={<PackageOpen size={14} />}
                onClick={() => setTransferOpen(true)}
                data-testid="tests-list-import-package"
              >
                Импорт из пакета
              </Button>
            )}
          </>
        )}
      />
      <TestFilters
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        anchorRef={filterButtonRef}
        value={testDraft}
        onChange={setTestDraft}
        onApply={applyFilters}
        onReset={resetDraft}
        authorOptions={authorOptions}
      />

      {transferOpen && (
        <TransferImportDialog
          open
          onClose={() => setTransferOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ["/api/tests"] })}
        />
      )}

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
          onOpenTest={(id, tab) => setEditorTarget({ kind: "edit", testId: id, tab })}
          onAssign={(id, title) => {
            setAssignTest({ id, title });
            setAssignDialogOpen(true);
          }}
          onOpenMore={(id) => {
            // Mutually exclusive with the folder menu + toggle on re-click,
            // so at most one more-menu is ever open (the more-button stops
            // propagation, so the outside-click handler can't do this for us).
            setFolderMenu(null);
            setTestMenu((cur) => (cur?.id === id ? null : { id }));
          }}
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
          onOpenTest={(id, tab) => setEditorTarget({ kind: "edit", testId: id, tab })}
          onAssign={(id, title) => {
            setAssignTest({ id, title });
            setAssignDialogOpen(true);
          }}
          onOpenMore={(id) => {
            // At most one more-menu open at a time: opening a test menu closes
            // any folder menu; clicking the same button again toggles it shut.
            setFolderMenu(null);
            setTestMenu((cur) => (cur?.id === id ? null : { id }));
          }}
          onOpenFolderMore={(id) => {
            setTestMenu(null);
            setFolderMenu((cur) => (cur?.id === id ? null : { id }));
          }}
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
          onArchive={
            can("tests.publish")
              ? () => {
                  statusMutation.mutate({ id: deleteTestState.id, status: "archived" });
                  setDeleteTestState(null);
                }
              : undefined
          }
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
          mode={assignMode}
        />
      )}

      {saveAsTest && (
        <SaveAsDialog
          open
          onClose={() => setSaveAsTest(null)}
          test={saveAsTest}
          canExportScorm={canExportScorm}
          onOpenSettings={() => {
            setSaveAsTest(null);
            setEditorTarget({ kind: "edit", testId: saveAsTest.id, tab: "main" });
          }}
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
        onClose={() => {
          setEditorTarget(null);
          // Раскрытая ветка живёт ровно одно открытие ящика: следующий заход — это
          // уже обычная работа со списком, а не переход по чьей-то ссылке.
          setFocusReviewThreadId(null);
        }}
        // «Применить» создало тест, а ящик остался открытым: переводим его в режим
        // правки созданного, чтобы следующее «Применить» дописывало этот тест, а не
        // создавало новый.
        onCreated={(testId) => setEditorTarget({ kind: "edit", testId })}
        initialTab={editorTarget?.kind === "edit" ? editorTarget.tab : undefined}
        focusReviewThreadId={focusReviewThreadId ?? undefined}
        onFeasibilityNotes={setSaveNotes}
      />

      {/* Access panel (PRD-13, WF-2) ---------------------------------------- */}
      <TestAccessPanel test={accessTest} onClose={() => setAccessTest(null)} />

      {/* PRD-15 T-12 (E-12): publish-infeasible impact dialog --------------- */}
      <ContentImpactDialog
        open={publishImpact !== null}
        mode="publish"
        title="Тест нельзя опубликовать: выдача вопросов невыполнима"
        description="При текущем составе тем тест не сможет собрать вариант для прохождения."
        findings={publishImpact?.findings ?? []}
        onClose={() => setPublishImpact(null)}
        onOpenStructure={() => {
          if (publishImpact) setEditorTarget({ kind: "edit", testId: publishImpact.testId });
          setPublishImpact(null);
        }}
      />

      {/* PRD-50 FR-45 - FR-47: замечания к УЖЕ опубликованному тесту ---------- */}
      <ContentImpactDialog
        open={publishNotes !== null}
        mode="advisory"
        title="Тест опубликован с замечаниями"
        notes={publishNotes ?? []}
        onClose={() => setPublishNotes(null)}
      />

      {/* PRD-15 FR-05: замечания к СОХРАНЁННОМУ тесту ---------------------- */}
      <ContentImpactDialog
        open={saveNotes !== null}
        mode="advisory"
        title="Тест сохранён, но выдать вопросы по нему нельзя"
        notes={saveNotes ?? []}
        advisoryFooter="Сохранению это не мешает. Но пока состав тем не поправлен, тест не выдаст вопросы: прогон встанет, а публикация будет отклонена."
        onClose={() => setSaveNotes(null)}
      />

      {/* PRD-15 FR-14: emergency re-publish confirm ------------------------- */}
      <ModalDialog
        open={forceRepublish !== null}
        onClose={() => setForceRepublish(null)}
        size="m"
        icon={<RotateCw size={20} />}
        iconTone="danger"
        title="Экстренно переопубликовать тест?"
        description={
          forceRepublish
            ? `Тест «${forceRepublish.title}» будет переопубликован немедленно, а идущие попытки — прерваны.`
            : undefined
        }
        closeOnBackdrop={!forceRepublishMutation.isPending}
        footer={
          <div className="cp-foot cp-foot--between">
            <Button
              variant="destructive"
              size="m"
              loading={forceRepublishMutation.isPending}
              onClick={() => forceRepublish && forceRepublishMutation.mutate(forceRepublish.id)}
            >
              Переопубликовать и прервать
            </Button>
            <Button
              variant="ghost"
              size="m"
              disabled={forceRepublishMutation.isPending}
              onClick={() => setForceRepublish(null)}
            >
              Отмена
            </Button>
          </div>
        }
      >
        <Banner
          tone="warning"
          title="Что произойдёт"
          description="Идущие попытки будут аннулированы и не засчитаны в лимит попыток — ученики смогут пройти заново. Завершённые результаты сохраняются. Действие записывается в журнал. Используйте только при инцидентах (утёкший ключ, грубая ошибка в вопросе)."
        />
      </ModalDialog>
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
          <Pencil size={14} />
          Редактировать
        </button>
        {canGrantAccessFor(test) && (
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
            <KeyRound size={14} />
            Общий доступ
          </button>
        )}
        {canDebugPlay && (
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              setTestMenu(null);
              // PRD-18: open the in-service debug player in a chromeless popup window
              // (no address bar), sized to the screen, named per test so it's reused.
              window.open(
                `/author/tests/${test.id}/debug`,
                `tb-debug-${test.id}`,
                `popup=yes,width=${window.screen.availWidth},height=${window.screen.availHeight},left=0,top=0`,
              );
            }}
            data-testid={`menu-debug-${test.id}`}
          >
            <BugPlay size={14} />
            Выполнить отладку
          </button>
        )}
        {canGrantAccessFor(test) && (
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              setTestMenu(null);
              setAssignMode("review");
              setAssignTest({ id: test.id, title: test.title });
              setAssignDialogOpen(true);
            }}
            data-testid={`menu-review-${test.id}`}
          >
            <MessageSquare size={14} />
            Отправить на рецензирование
          </button>
        )}
        {/* Э5 (решение владельца Р6 2026-10-05): один пункт вместо трёх — окно называет задачу
            каждого формата, путь обратно и версию; формат без права в окне не показывается. */}
        <button
          type="button"
          className="dropdown-item"
          role="menuitem"
          onClick={() => {
            setTestMenu(null);
            setSaveAsTest({ id: test.id, title: test.title });
          }}
          data-testid={`menu-save-as-${test.id}`}
        >
          <Download size={14} />
          Сохранить как…
        </button>
        {/* Э6: своего окна у пункта нет — он ведёт в раздел «Импорт» с этим тестом в адресе,
            и раздел сразу показывает загрузки теста. Тест задаёт файл, а не пункт. */}
        {canImportLms && (
          <Link
            href={`/author/import?testId=${encodeURIComponent(test.id)}`}
            className="dropdown-item"
            role="menuitem"
            onClick={() => setTestMenu(null)}
            data-testid={`menu-import-lms-${test.id}`}
          >
            <Upload size={14} />
            Загрузить выгрузку LMS
          </Link>
        )}
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
          <Globe size={14} />
          {test.status === "published" ? "Снять с публикации" : "Опубликовать"}
        </button>
        {/* PRD-15 FR-12: re-publish the working version (new snapshot); only
            when the published test has diverged. */}
        {test.publicationState === "published_with_changes" && (
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              setTestMenu(null);
              statusMutation.mutate({ id: test.id, status: "published" });
            }}
            data-testid={`menu-republish-${test.id}`}
          >
            <Upload size={14} />
            Опубликовать изменения
          </button>
        )}
        {/* PRD-15 FR-14: emergency re-publish — annuls in-progress attempts. */}
        {test.status === "published" && (
          <button
            type="button"
            className="dropdown-item danger"
            role="menuitem"
            onClick={() => {
              setTestMenu(null);
              setForceRepublish({ id: test.id, title: test.title });
            }}
            data-testid={`menu-force-republish-${test.id}`}
          >
            <RotateCw size={14} />
            Экстренная переопубликация...
          </button>
        )}
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
          <Folder size={14} />
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
          <Archive size={14} />
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
          <Trash2 size={14} />
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
          <Pencil size={14} />
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
          <Trash2 size={14} />
          Удалить папку...
        </button>
      </div>
    );
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
  onOpenTest: (id: string, tab?: EditorTabKey) => void;
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
            onOpen={() => props.onOpenTest(row.id)}
            onEdit={() => props.onOpenTest(row.id)}
            onOpenStructure={() => props.onOpenTest(row.id, "composition")}
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
  onOpenTest: (id: string, tab?: EditorTabKey) => void;
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
          onOpen={() => props.onOpenTest(row.id)}
          onEdit={() => props.onOpenTest(row.id)}
          onOpenStructure={() => props.onOpenTest(row.id, "composition")}
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
  onOpen: () => void;
  onEdit: () => void;
  /** Opens the editor on «Структура» — where an unmapped page is resolved. */
  onOpenStructure: () => void;
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
  const canDebugPlay = can("tests.debug.play");
  const canAnyMenu =
    canEdit ||
    can("tests.export.scorm") ||
    can("tests.debug.play") ||
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
  // Row body opens the editor Drawer on DOUBLE-click; the «Редактировать»
  // (pencil) button still opens it on a single click and is the
  // keyboard-accessible path.
  return (
    <div
      className={"tree-test" + (props.indented ? " indent-1" : "")}
      role="treeitem"
      aria-level={props.indented ? 3 : 2}
      onDoubleClick={canEdit ? props.onOpen : undefined}
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
      <div className="tb-status-cell">
        <StatusTag status={e.status} publicationState={e.publicationState} />
        <UnmappedPagesMark count={e.unmappedPageCount ?? 0} testId={e.id} onOpen={props.onOpenStructure} />
        <OpenCommentsMark count={e.openReviewComments ?? 0} />
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
        {canDebugPlay && (
          <button
            type="button"
            className="action-btn"
            title="Выполнить отладку"
            aria-label="Выполнить отладку"
            onClick={(ev) => {
              ev.stopPropagation();
              // PRD-18: open the in-service debug player in a chromeless popup window
              // (no address bar), sized to the screen, named per test so it's reused.
              window.open(
                `/author/tests/${e.id}/debug`,
                `tb-debug-${e.id}`,
                `popup=yes,width=${window.screen.availWidth},height=${window.screen.availHeight},left=0,top=0`,
              );
            }}
            data-testid={`test-debug-${e.id}`}
          >
            <BugPlay width={14} height={14} />
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
        {/* Э3.1, решение владельца 2026-10-03: на уровень теста — туда же, куда ведёт строка
            вкладки «Тесты» в «Аналитике». Отменяет решение Э2 (общий раздел с отбором). */}
        {canAnalytics && (
          <Link href={testHref(e.id)} onClick={(ev) => ev.stopPropagation()}>
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

/**
 * PRD-22 (plan Э6): a test holding content pages whose variant its design template
 * no longer declares. The pages still render — through a substitute — so nothing
 * in the run reveals it; the mark is how the author learns a decision is pending,
 * and it takes them to «Структура», where the mapping is made.
 */
/**
 * PRD-52 FR-32: сколько у теста открытых комментариев рецензентов.
 *
 * Показывается ТОЛЬКО когда они есть: у теста без комментариев строка не должна
 * обрастать нулём — это шум в списке, который читают ежедневно.
 */
function OpenCommentsMark({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = `Открытых комментариев: ${count}`;
  return (
    <span className="tb-open-comments-mark" title={label} aria-label={label} data-testid="open-comments">
      <MessageSquare size={12} aria-hidden />
      {count}
    </span>
  );
}

function UnmappedPagesMark(props: { count: number; testId: string; onOpen: () => void }) {
  if (props.count <= 0) return null;
  // Just a warning pictogram: the count lives in the tooltip (it is a hint, not a
  // metric on screen), and it sits ON the status line rather than as a chip below.
  const label = `Страниц с недоступным вариантом: ${props.count}. Открыть «Структуру».`;
  return (
    <button
      type="button"
      className="tb-unmapped-mark"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen();
      }}
      data-testid={`test-unmapped-${props.testId}`}
    >
      <TriangleAlert width={15} height={15} aria-hidden="true" />
    </button>
  );
}

function StatusTag({
  status,
  publicationState,
}: {
  status: TestListEntry["status"];
  publicationState?: TestListEntry["publicationState"];
}) {
  if (status === "published") {
    // PRD-15 FR-12: a published test whose working version diverged from the
    // active snapshot stacks an "Есть изменения" warning chip (like prd7's
    // "Требует обновления").
    return (
      <span className="tb-status-stack">
        <Tag tone="success" aria-label="Статус: опубликован">Опубликован</Tag>
        {publicationState === "published_with_changes" && (
          <Tag tone="warning" aria-label="Есть неопубликованные изменения">Есть изменения</Tag>
        )}
      </span>
    );
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
            <span className="fab-action-label">Добавить папку</span>
            <button
              type="button"
              className="fab-action-btn"
              aria-label="Добавить папку"
              onClick={props.onNewFolder}
              data-testid="fab-new-folder"
            >
              <FolderPlus width={18} height={18} />
            </button>
          </div>
          <div className="fab-action">
            <span className="fab-action-label">Добавить тест</span>
            <button
              type="button"
              className="fab-action-btn"
              aria-label="Добавить тест"
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

/**
 * Test delete confirmation (FR-30, approved wireframes prd7-tests-delete-confirm and
 * test-delete-lms-impact). PRD-15 FR-07a: the dialog names what goes with the test —
 * web and LMS attempts, uploaded exports, packages that stop reporting — and offers
 * archiving as the equal alternative right next to «Удалить навсегда».
 *
 * While the counts load, or when the request fails, there is no banner: the dialog
 * works exactly as before, the counts only inform the choice.
 */
function DeleteTestModal(props: {
  state: { id: string; title: string; input: string; error: string | null };
  onChange: (input: string) => void;
  onCancel: () => void;
  onDelete: () => void | Promise<void>;
  /** Absent when the user may not archive (`tests.publish`): then there is no button. */
  onArchive?: () => void;
}) {
  const match = props.state.input === props.state.title;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const { data: impact } = useQuery<TestDeleteImpact>({
    // Not under ["/api/tests"]: the delete mutation invalidates that prefix while the dialog is
    // still mounted, and the refetch would ask about a test that no longer exists (404).
    queryKey: ["test-delete-impact", props.state.id],
    queryFn: () => fetchJson(`/api/tests/${props.state.id}/delete-impact`),
    staleTime: 0,
  });
  const warning = impact ? describeDeleteImpact(impact) : null;
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
          {props.onArchive && (
            <Button
              variant="secondary"
              size="s"
              onClick={props.onArchive}
              data-testid="delete-test-archive"
            >
              Архивировать
            </Button>
          )}
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
      <p className="typed-confirm__lead">
        Тест <strong>«{props.state.title}»</strong> будет удалён безвозвратно вместе со всеми
        назначениями и результатами попыток. Это действие невозможно отменить.
      </p>
      {warning && (
        <Banner
          className="typed-confirm__impact"
          tone="warning"
          variant="subtle"
          icon={<TriangleAlert size={20} />}
          title={warning.title}
          description={warning.description}
          data-testid="delete-test-impact"
        />
      )}
      <div className="typed-confirm">
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
      </div>
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
            variant="secondary"
            onClick={props.onCancel}
            data-testid="move-folder-pick-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="primary"
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
      <Stack gap={2}>
        <Label>Папка назначения</Label>
        <FolderTreeSelect
          folders={props.folders}
          value={props.selected}
          onChange={props.onSelect}
          rootLabel="Корень (без папки)"
        />
        <Text variant="body-xs" tone="muted">
          Текущая: {props.current === null ? "Корень (без папки)" : (props.folders.find((f) => f.id === props.current)?.name ?? "—")}
        </Text>
      </Stack>
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
          <Button variant="secondary" onClick={props.onCancel}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={props.onCreate}
            data-testid="fab-pick-create"
          >
            Создать тест
          </Button>
        </>
      }
    >
      <Stack gap={2}>
        <Label>Папка</Label>
        <FolderTreeSelect
          folders={props.folders}
          value={props.selected}
          onChange={props.onSelect}
          rootLabel="Корень (без папки)"
        />
      </Stack>
    </ModalDialog>
  );
}
