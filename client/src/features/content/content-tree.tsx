/**
 * @module features/content/content-tree
 *
 * Table-tree for the unified "Темы и вопросы" section: a single tree
 * `Folder ⊃ Topic ⊃ Question` in the visual language of the tests list (column
 * header Название | Сложность | Вопросов, plain-number counts, indent guide, no
 * card). Question type is a monochrome pictogram; difficulty an outline Tag.
 * Assembled on the client from `/api/folders` + `/api/topics` + `/api/questions`.
 *
 * Phase 1: read-only tree, search, expand/collapse.
 * Phase 2: facet filter as a popover (Тип/Сложность/Теги/Медиа/Владелец/Область)
 * with «Сбросить всё» / «Применить»; active-condition Chips; auto-expand to
 * matches with a "найдено / всего" count and a result note.
 * Phase 3: interaction layer matching the wireframe — an always-visible ⋯ menu
 * on every row (folder/topic/question), a question select checkbox + bulk-action
 * bar, a speed-dial FAB (create folder/topic/question), question-row click → the
 * shared {@link QuestionEditorDrawer}, the {@link TopicDrawer} for topic
 * settings/access, and move pickers (question→topic, topic→folder). Question
 * deletes/moves pass the PRD-15 content guard. Matches the approved wireframe
 * docs/wireframes/approved/content-bank-explorer.html.
 *
 * Deep link `?questionId=<id>` (see {@link module:features/content/question-link}):
 * analytics diagnoses a question, but the fix happens in its topic. Once the data
 * is loaded the tree expands the question's folder path and topic, scrolls the row
 * into view and opens the same {@link QuestionEditorDrawer} the ⋯ «Редактировать»
 * action opens. It acts once and then strips the param from the address.
 *
 * Performance: the per-topic filtered question lists are memoized (one pass per
 * data/filter change, not per render); free-text search is debounced; filters
 * apply in a batch on «Применить» (the tree does not re-filter on each facet
 * toggle). Row virtualization is a planned follow-up for very large banks. See
 * docs/PLAN_content_axis_implementation.md.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// Навигация без хука: дерево живёт и на подменённом `window.location` (выгрузка в Excel в тестах).
import { navigate } from "wouter/use-browser-location";
import {
  BarChart3,
  Bookmark,
  Braces,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  Download,
  Folder as FolderIcon,
  FolderPlus,
  Image as ImageIcon,
  KeyRound,
  ListOrdered,
  ThermometerSun,
  SlidersHorizontal,
  TextCursorInput,
  MoreHorizontal,
  Move,
  Pencil,
  Plus,
  Search,
  Trash2,
  Unplug,
  type LucideIcon,
  MonitorPlay,
  Pilcrow,
} from "lucide-react";
import { Button, Checkbox, FilterBar, Input, Label, ModalDialog, SegmentedControl, Select, Stack, Tag, Text, useToast } from "@skillum/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { FolderTreeSelect } from "@/components/folder-tree-select";
import { TruncatedLabel } from "@/components/truncated-label";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import type { Folder, Question, Topic } from "@shared/schema";
import { QuestionEditorDrawer } from "@/features/questions/question-editor-drawer";
import { QuestionPreview } from "@/features/content/question-preview";
import { TopicDrawer, type TopicDrawerTarget } from "@/features/topics/topic-drawer";
import { useContentGuard } from "@/features/content-protection/use-content-guard";
import { ContentImpactDialog } from "@/features/content-protection/content-impact-dialog";
import {
  GroupAccessModal,
  GroupMoveModal,
  FolderDeleteDialog,
  GroupDeleteFlow,
} from "@/features/content/bulk-content-ops";
import {
  ContentFilters,
  diffActive,
  EMPTY_FILTER,
  filterCount,
  MEDIA_OPTS,
  readContentFilter,
  contentFilterOf,
  writeContentFilter,
  SCOPE_OPTS,
  TYPE_OPTS,
  type ContentFilterValue,
  type MediaBucket,
} from "@/features/content/content-filters";
import { questionFromSearch, searchWithoutQuestion } from "@/features/content/question-link";
import {
  matchesStates,
  overexposureSub,
  reviewSub,
  STATE_OPTS,
  totalsOf,
  type BankQuestionQuality,
  type QualityTotals,
} from "@/features/content/bank-quality";
import { TermHint } from "@/features/analytics/test/term-hint";
import { bankQuestionHref } from "@/features/analytics/levels/analytics-routes";
import { currentHref, stateForDive, trailOf } from "@/features/analytics/levels/trail";
import { FoldAllButtons, type SectionFold } from "@/features/tests/editor/sections/section-fold";
import { stableKey, useListFilters } from "@/features/saved-filters/use-list-filters";

/** PRD-70 FR-20: набор колонок дерева — «Содержание» (как было) или «Качество». */
type ColumnSet = "content" | "quality";
/** Параметр адреса, в котором помнится набор колонок — как вкладка на уровне теста. */
const VIEW_PARAM = "view";

/** Open ⋯-menu (one at a time across the whole tree). */
type OpenMenu = { kind: "folder" | "topic" | "question"; id: string } | null;

/** A small reusable ⋯ actions cell + anchored dropdown (mirrors the tests-list pattern). */
function RowActions({ open, onToggle, label, children }: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ct-acts">
      <div className="ct-more-wrap">
        <button
          type="button"
          className="ct-actbtn"
          aria-label={label}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          <MoreHorizontal size={16} />
        </button>
        {open && (
          <div className="ct-menu" onClick={(e) => e.stopPropagation()}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/** One dropdown action. */
function MenuItem({ icon, danger, onClick, children, testId }: {
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={"ct-menu__item" + (danger ? " is-danger" : "")}
      onClick={onClick}
      data-testid={testId}
    >
      {icon}{children}
    </button>
  );
}

import type { QuestionType } from "@shared/questions/question-type";
import { questionLabel } from "@shared/questions/question-label";

const TYPE_ICON: Record<QuestionType, LucideIcon> = { single: CircleDot, multiple: CheckSquare, matching: Unplug, ranking: ListOrdered, scale: ThermometerSun, allocation: SlidersHorizontal, short: TextCursorInput, blanks: Braces, long: Pilcrow, simulation: MonitorPlay };
const TYPE_LABEL: Record<QuestionType, string> = {
  single: t.questions.singleChoice,
  multiple: t.questions.multipleChoice,
  matching: t.questions.matching,
  ranking: t.questions.ranking,
  scale: t.questions.scaleChoice,
  allocation: t.questions.allocation,
  short: t.questions.shortAnswer,
  blanks: t.questions.blanks,
  long: t.questions.longAnswer,
  simulation: t.questions.simulation,
};

const depthClass = (depth: number): string => `ct-d${Math.min(depth, 6)}`;

/** Pure facet predicate (filter is the applied value). */
function facetMatch(q: Question, f: ContentFilterValue, quality: ReadonlyMap<string, BankQuestionQuality>): boolean {
  if (f.types.length && !f.types.includes(q.type as QuestionType)) return false;
  // PRD-70 FR-23: «Состояние» — по качеству вопроса в тестах читателя.
  if (!matchesStates(quality.get(q.id), f.states)) return false;
  // PRD-16 FR-13: difficulty interval 0–100 / «Не задана» (null = «не задано»).
  if (f.diffUnset) {
    if (q.difficulty != null) return false;
  } else if (f.diffMin > 0 || f.diffMax < 100) {
    if (q.difficulty == null || q.difficulty < f.diffMin || q.difficulty > f.diffMax) return false;
  }
  if (f.tags.length) {
    const qt = q.tags ?? [];
    if (!f.tags.some((tg) => qt.includes(tg))) return false;
  }
  if (f.media.length) {
    const mb = (q.mediaType as MediaBucket | null) ?? "none";
    if (!f.media.includes(mb)) return false;
  }
  if (f.author && q.createdBy !== f.author) return false;
  return true;
}
const textIncludes = (text: string, q: string): boolean => text.toLowerCase().includes(q);

/** Russian plural form picker (one / few / many). */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** What a row's caption reports: everything the container holds, at any depth. */
interface ContentCounts {
  folders: number;
  topics: number;
  questions: number;
}

/**
 * Row caption: «2 папки · 3 темы · 40 вопросов». Zero parts are dropped — a
 * folder without subfolders should not carry «0 папок» — and a container with
 * nothing inside says so instead of showing three zeros.
 */
function countsLabel(c: ContentCounts): string {
  const parts: string[] = [];
  if (c.folders > 0) parts.push(`${c.folders} ${plural(c.folders, "папка", "папки", "папок")}`);
  if (c.topics > 0) parts.push(`${c.topics} ${plural(c.topics, "тема", "темы", "тем")}`);
  if (c.questions > 0) parts.push(`${c.questions} ${plural(c.questions, "вопрос", "вопроса", "вопросов")}`);
  return parts.length > 0 ? parts.join(" · ") : "пусто";
}

/** Debounce a changing value so it only settles after `ms` of quiet. */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

interface UserLite {
  id: string;
  /** The user model carries a single `name` (not first/last) — see server schema. */
  name?: string | null;
  email?: string | null;
}

/** Раскрытие и прокрутка дерева в состоянии записи истории. */
interface TreeSnapshot {
  collapsedFolders?: string[];
  expandedTopics?: string[];
  scrollTop?: number;
}

/** Ключ снимка дерева в состоянии записи. */
const TREE_KEY = "ctTree";

/** Снимок дерева текущей записи; нет — дерево открывается как обычно. */
function savedTree(): TreeSnapshot | null {
  if (typeof window === "undefined") return null;
  const value = (window.history.state as Record<string, unknown> | null)?.[TREE_KEY];
  return value && typeof value === "object" ? value as TreeSnapshot : null;
}

/** Дописать снимок дерева в состояние текущей записи, не трогая остального. */
function rememberTree(patch: TreeSnapshot): void {
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  window.history.replaceState({ ...state, [TREE_KEY]: { ...(savedTree() ?? {}), ...patch } }, "", window.location.href);
}

export function ContentTree() {
  const { user, can } = useAuth();
  const userId = user?.id ?? "";

  const { data: folders = [], isLoading: loadingFolders } = useQuery<Folder[]>({ queryKey: ["/api/folders"] });
  const { data: topics = [], isLoading: loadingTopics } = useQuery<Topic[]>({ queryKey: ["/api/topics"] });
  const { data: questions = [], isLoading: loadingQuestions } = useQuery<Question[]>({ queryKey: ["/api/questions"] });
  const { data: users = [] } = useQuery<UserLite[]>({ queryKey: ["/api/users"], enabled: can("users.read") });
  // PRD-70 FR-14: качество вопросов по тестам читателя — из аналитики, поэтому только с правом на неё.
  const canAnalytics = can("analytics.read");
  const { data: bankQualityData } = useQuery<{ questions: BankQuestionQuality[] }>({
    queryKey: ["/api/analytics/bank/quality"],
    enabled: canAnalytics,
  });
  const qualityById = useMemo(
    () => new Map((bankQualityData?.questions ?? []).map((q) => [q.questionId, q])),
    [bankQualityData],
  );
  const [columnSet, setColumnSetState] = useState<ColumnSet>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get(VIEW_PARAM) === "quality" ? "quality" : "content",
  );
  /** Сменить набор колонок и запомнить его в адресе (FR-20). */
  function setColumnSet(next: ColumnSet) {
    setColumnSetState(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "quality") params.set(VIEW_PARAM, "quality");
    else params.delete(VIEW_PARAM);
    const search = params.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (search ? `?${search}` : "") + window.location.hash);
  }
  const quality = canAnalytics && columnSet === "quality";

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  // Возврат (замечание владельца 2026-10-05): условия фильтра живут в адресе, раскрытие дерева и
  // прокрутка — в состоянии записи истории. Крошка «Темы и вопросы» и «Назад» браузера приводят на
  // тот же отбор и то же место дерева, с которого ушли вглубь.
  const [filter, setFilter] = useState<ContentFilterValue>(() =>
    typeof window === "undefined" ? EMPTY_FILTER : readContentFilter(window.location.search)); // applied
  const [draft, setDraft] = useState<ContentFilterValue>(filter); // edited in the panel
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(() => new Set(savedTree()?.collapsedFolders ?? []));
  const [expandedTopics, setExpandedTopics] = useState<ReadonlySet<string>>(() => new Set(savedTree()?.expandedTopics ?? []));
  const treeRef = useRef<HTMLDivElement>(null);

  // Условия фильтра — в адрес, без новой записи истории: это та же страница.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    writeContentFilter(filter, params);
    const search = params.toString();
    const href = window.location.pathname + (search ? `?${search}` : "") + window.location.hash;
    if (href !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, "", href);
    }
  }, [filter]);
  // Раскрытие — в состояние записи: с ним на неё и вернутся.
  useEffect(() => {
    rememberTree({ collapsedFolders: [...collapsedFolders], expandedTopics: [...expandedTopics] });
  }, [collapsedFolders, expandedTopics]);
  // PRD-16: inline read-only preview of a question (expand a question row).
  const [expandedQuestions, setExpandedQuestions] = useState<ReadonlySet<string>>(() => new Set());

  // ── Phase 3: interaction layer (⋯-menus, FAB, drawers, move pickers, bulk) ──
  const { push: toast } = useToast();
  const queryClient = useQueryClient();
  const contentGuard = useContentGuard();
  const isAdmin = can("topics.owner.change");

  const [menu, setMenu] = useState<OpenMenu>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<{ question: Question | null; defaultTopicId?: string } | null>(null);
  const [topicTarget, setTopicTarget] = useState<TopicDrawerTarget | null>(null);
  const [topicTab, setTopicTab] = useState<"props" | "access">("props");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedTopics, setSelectedTopics] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedFolders, setSelectedFolders] = useState<ReadonlySet<string>>(() => new Set());
  const [moveQ, setMoveQ] = useState<{ ids: string[]; topicId: string } | null>(null);
  const [moveTopicTarget, setMoveTopicTarget] = useState<{ id: string; folderId: string } | null>(null);
  const [newFolder, setNewFolder] = useState<{ parentId: string | null; name: string } | null>(null);
  const [renameFolderTarget, setRenameFolderTarget] = useState<{ id: string; name: string } | null>(null);
  // Group («Папки и темы») operation modals (Р-2..Р-8).
  const [groupMoveOpen, setGroupMoveOpen] = useState(false);
  const [groupAccessOpen, setGroupAccessOpen] = useState(false);
  // Topic delete (single ⋯ or group) routes through the same guarded flow
  // (GroupDeleteFlow): clean → DS confirm, conflicts → partial-batch impact.
  const [deleteTopicIds, setDeleteTopicIds] = useState<string[] | null>(null);
  const [folderDelete, setFolderDelete] = useState<{ folderIds: string[]; folderName: string; standaloneTopicIds: string[] } | null>(null);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
    queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
  };
  const onMutError = () => toast({ tone: "error", title: t.common.error });

  const duplicateQuestionMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/questions/${id}/duplicate`),
    onSuccess: () => { invalidateAll(); toast({ tone: "success", title: t.questions.duplicated }); },
    onError: onMutError,
  });
  // Topic/folder deletion is guarded (single topic → content guard; folder →
  // two-mode dialog; groups → the bulk flows), so no plain delete mutations here.
  const clearGroupSelection = () => { setSelectedTopics(new Set()); setSelectedFolders(new Set()); };
  const onGroupDone = () => { invalidateAll(); clearGroupSelection(); };
  const createFolderMut = useMutation({
    mutationFn: (body: { name: string; parentId: string | null }) => apiRequest("POST", "/api/folders", body),
    onSuccess: () => { invalidateAll(); setNewFolder(null); },
    onError: onMutError,
  });
  const renameFolderMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiRequest("PUT", `/api/folders/${id}`, { name }),
    onSuccess: () => { invalidateAll(); setRenameFolderTarget(null); },
    onError: onMutError,
  });
  const moveTopicMut = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) => apiRequest("PUT", `/api/topics/${id}`, { folderId }),
    onSuccess: () => { invalidateAll(); setMoveTopicTarget(null); },
    onError: onMutError,
  });
  const moveQuestionsMut = useMutation({
    mutationFn: async ({ ids, topicId }: { ids: string[]; topicId: string }) => {
      for (const id of ids) await apiRequest("PUT", `/api/questions/${id}`, { topicId });
    },
    onSuccess: () => { invalidateAll(); setMoveQ(null); setSelected(new Set()); },
    onError: () => toast({ tone: "error", title: t.common.error, description: "Не удалось переместить (возможно, затронуты опубликованные тесты)." }),
  });

  // Delete a question through the PRD-15 content guard (dry-run -> warn/block 409).
  function deleteQuestion(q: Question) {
    contentGuard.guard({
      url: `/api/questions/${q.id}`,
      method: "DELETE",
      blockTitle: "Вопрос нельзя удалить: он используется в опубликованных тестах",
      blockDescription: "Удаление сломает выдачу или оценивание опубликованных тестов.",
      warnTitle: "Удалить вопрос? Это затронет другие тесты",
      warnDescription: "Опубликованные тесты не пострадают, но есть последствия, о которых стоит знать.",
      confirmLabel: t.content.deleteSelected,
      confirmVariant: "destructive",
      onDone: () => invalidateAll(),
    });
  }

  // Two mutually-exclusive selection modes: «Вопросы» and «Папки и темы».
  // Toggling a question clears folders/topics; toggling a folder/topic (same
  // mode) clears questions.
  const toggle = (set: ReadonlySet<string>, id: string) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; };
  function toggleSelected(id: string) {
    setSelectedTopics(new Set()); setSelectedFolders(new Set());
    setSelected((prev) => toggle(prev, id));
  }
  function toggleTopicSelected(id: string) {
    setSelected(new Set());
    setSelectedTopics((prev) => toggle(prev, id));
  }
  function toggleFolderSelected(id: string) {
    setSelected(new Set());
    setSelectedFolders((prev) => toggle(prev, id));
  }

  /** Export the questions of the given topics to Excel (PRD-16 — replaces the old «Вопросы» export). */
  function exportTopicsToExcel(ids: string[]) {
    if (ids.length === 0) return;
    window.location.href = `/api/questions/export?topicIds=${ids.join(",")}`;
  }

  // Close any open ⋯-menu / FAB on an outside click (menus stopPropagation on themselves).
  useEffect(() => {
    if (!menu && !fabOpen) return;
    const close = () => { setMenu(null); setFabOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menu, fabOpen]);

  // Deep link from analytics: `?questionId=<id>`. Analytics only diagnoses a
  // question («сильные ошибаются чаще»); the author fixes it here, in its topic.
  // Read once on mount; handled once the tree data has loaded, then the param is
  // stripped so a reload / «Назад» does not reopen a drawer the author closed.
  const [linkedQuestionId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : questionFromSearch(window.location.search),
  );
  const linkHandled = useRef(false);
  const [scrollToQuestionId, setScrollToQuestionId] = useState<string | null>(null);
  const dataLoading = loadingFolders || loadingTopics || loadingQuestions;
  useEffect(() => {
    if (!linkedQuestionId || linkHandled.current || dataLoading) return;
    linkHandled.current = true;
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + searchWithoutQuestion(window.location.search) + window.location.hash,
    );
    const q = questions.find((x) => x.id === linkedQuestionId);
    if (!q) {
      // Deleted, or outside this author's topic scope: say so, do not block.
      toast({ tone: "success", title: "Вопрос не найден", description: "Он удалён или недоступен вам." });
      return;
    }
    // Expand the folder path (folders start open, but the user may have collapsed
    // some) and the question's topic — filters are untouched: on a fresh
    // navigation they are empty, so the row is visible.
    const topic = topics.find((tp) => tp.id === q.topicId);
    const ancestors = new Set<string>();
    const parentOf = new Map(folders.map((f) => [f.id, f.parentId ?? null] as const));
    for (let fid = topic?.folderId ?? null; fid && !ancestors.has(fid); fid = parentOf.get(fid) ?? null) ancestors.add(fid);
    if (ancestors.size > 0) {
      setCollapsedFolders((prev) => new Set(Array.from(prev).filter((id) => !ancestors.has(id))));
    }
    setExpandedTopics((prev) => new Set(prev).add(q.topicId));
    setScrollToQuestionId(q.id);
    setEditorTarget({ question: q });
  }, [linkedQuestionId, dataLoading, questions, topics, folders, toast]);

  // Прокрутка дерева: вернуть, когда дерево отрисовано, и запоминать по ходу.
  const scrollRestored = useRef(false);
  useEffect(() => {
    if (dataLoading || scrollRestored.current) return;
    scrollRestored.current = true;
    const top = savedTree()?.scrollTop;
    if (top && treeRef.current) treeRef.current.scrollTop = top;
  }, [dataLoading]);
  useEffect(() => {
    const el = treeRef.current;
    if (!el) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => rememberTree({ scrollTop: el.scrollTop }), 150);
    };
    el.addEventListener("scroll", onScroll);
    return () => { clearTimeout(timer); el.removeEventListener("scroll", onScroll); };
  }, [dataLoading]);

  /** «Статистика» вопроса: переход вглубь с путём — крошка «Темы и вопросы» вернёт сюда. */
  function openStatistics(questionId: string) {
    const target = bankQuestionHref(questionId);
    navigate(target, {
      state: stateForDive(trailOf(window.history.state), { label: t.content.title, href: currentHref(), state: window.history.state }, target),
    });
  }

  // Scroll the linked question's row into view once it has rendered.
  useEffect(() => {
    if (!scrollToQuestionId) return;
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-question-id]"))
      .find((el) => el.dataset.questionId === scrollToQuestionId);
    row?.scrollIntoView?.({ block: "center" });
    setScrollToQuestionId(null);
  }, [scrollToQuestionId]);

  const questionsByTopic = useMemo(() => {
    const map = new Map<string, Question[]>();
    for (const q of questions) {
      const list = map.get(q.topicId);
      if (list) list.push(q);
      else map.set(q.topicId, [q]);
    }
    return map;
  }, [questions]);

  const childFolders = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const key = f.parentId ?? null;
      (map.get(key) ?? map.set(key, []).get(key)!).push(f);
    }
    return map;
  }, [folders]);

  const topicsByFolder = useMemo(() => {
    const map = new Map<string | null, Topic[]>();
    for (const tp of topics) {
      const key = tp.folderId ?? null;
      (map.get(key) ?? map.set(key, []).get(key)!).push(tp);
    }
    return map;
  }, [topics]);

  // What each folder HOLDS, counted through the whole subtree: a folder that only
  // groups other folders (its own topic list empty) still reports the material
  // inside it, instead of reading «0 тем» next to hundreds of questions.
  const folderTotals = useMemo(() => {
    const totals = new Map<string, ContentCounts>();
    const visit = (folderId: string): ContentCounts => {
      const cached = totals.get(folderId);
      if (cached) return cached;
      const acc: ContentCounts = { folders: 0, topics: 0, questions: 0 };
      for (const tp of topicsByFolder.get(folderId) ?? []) {
        acc.topics += 1;
        acc.questions += (questionsByTopic.get(tp.id) ?? []).length;
      }
      for (const sub of childFolders.get(folderId) ?? []) {
        const inner = visit(sub.id);
        acc.folders += 1 + inner.folders;
        acc.topics += inner.topics;
        acc.questions += inner.questions;
      }
      totals.set(folderId, acc);
      return acc;
    };
    for (const f of folders) visit(f.id);
    return totals;
  }, [folders, childFolders, topicsByFolder, questionsByTopic]);

  // Topics resolved from the «Папки и темы» selection: directly-selected topics
  // plus every topic inside a selected folder (transitively).
  function topicsUnderFolder(folderId: string): string[] {
    const out: string[] = [];
    const queue = [folderId];
    while (queue.length > 0) {
      const f = queue.shift()!;
      for (const tp of topicsByFolder.get(f) ?? []) out.push(tp.id);
      for (const sub of childFolders.get(f) ?? []) queue.push(sub.id);
    }
    return out;
  }
  const resolvedTopicIds = useMemo(() => {
    const set = new Set<string>(selectedTopics);
    for (const fid of selectedFolders) for (const tid of topicsUnderFolder(fid)) set.add(tid);
    return Array.from(set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopics, selectedFolders, topicsByFolder, childFolders]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const q of questions) for (const tg of q.tags ?? []) set.add(tg);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const userNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.name || u.email || u.id);
    return m;
  }, [users]);

  const authorOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const q of questions) if (q.createdBy) ids.add(q.createdBy);
    return Array.from(ids).map((id) => ({ value: id, label: userNameById.get(id) ?? id })).sort((a, b) => a.label.localeCompare(b.label));
  }, [questions, userNameById]);

  /** Display name of a topic owner (PRD-15 block C). null owner = общий пул. */
  const ownerLabel = (ownerId: string | null): string => {
    if (!ownerId) return "—";
    if (ownerId === userId) return user?.name || user?.email || "—";
    return userNameById.get(ownerId) ?? "—";
  };

  const query = debouncedSearch.trim().toLowerCase();
  const searching = query.length > 0;
  const facetsActive = filter.types.length > 0 || diffActive(filter) || filter.tags.length > 0 || filter.media.length > 0 || filter.author !== "" || filter.states.length > 0;
  const contentActive = facetsActive || searching;

  // Memoized per-topic filtered question lists — one pass per data/filter change.
  const shownByTopic = useMemo(() => {
    const map = new Map<string, Question[]>();
    for (const topic of topics) {
      let qs = (questionsByTopic.get(topic.id) ?? []).filter((q) => facetMatch(q, filter, qualityById));
      if (searching && !textIncludes(topic.name, query)) qs = qs.filter((q) => textIncludes(questionLabel(q), query) || textIncludes(q.prompt, query));
      map.set(topic.id, qs);
    }
    return map;
  }, [topics, questionsByTopic, filter, query, searching, qualityById]);

  function topicInScope(topic: Topic): boolean {
    switch (filter.scope) {
      case "mine": return topic.ownerId === userId;
      case "shared": return topic.visibility === "shared";
      case "accessible": return topic.ownerId !== userId && topic.visibility !== "shared";
      default: return true;
    }
  }
  function topicVisible(topic: Topic): boolean {
    if (!topicInScope(topic)) return false;
    if (!contentActive) return true;
    if ((shownByTopic.get(topic.id)?.length ?? 0) > 0) return true;
    return searching && textIncludes(topic.name, query);
  }
  function folderVisible(folderId: string): boolean {
    if (!contentActive && filter.scope === "all") return true;
    if ((topicsByFolder.get(folderId) ?? []).some(topicVisible)) return true;
    return (childFolders.get(folderId) ?? []).some((f) => folderVisible(f.id));
  }

  function toggleFolder(id: string) {
    setCollapsedFolders((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleTopic(id: string) {
    setExpandedTopics((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleQuestion(id: string) {
    setExpandedQuestions((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function expandAll() { setCollapsedFolders(new Set()); setExpandedTopics(new Set(topics.map((tp) => tp.id))); }
  function collapseAll() { setCollapsedFolders(new Set(folders.map((f) => f.id))); setExpandedTopics(new Set()); }

  // The panel edits a draft of what is applied; closing it without «Применить» drops the draft
  // (PRD-70 FR-74), so every opening starts from the applied filter.
  function toggleFilters() { if (!filterOpen) setDraft(filter); setFilterOpen(!filterOpen); }
  function applyFilters() { setFilter(draft); setFilterOpen(false); }
  /** «Сбросить» of the panel: clears the draft only. */
  function resetDraft() { setDraft(EMPTY_FILTER); }
  /** «Сбросить фильтры» of the bar: clears what is applied. */
  function resetFilters() { setDraft(EMPTY_FILTER); setFilter(EMPTY_FILTER); }
  function commitFilter(next: ContentFilterValue) { setFilter(next); setDraft(next); }
  // Сохранённые фильтры банка (решение владельца 2026-10-05): сохранить в ряду условий,
  // применить и удалить — из «Сохранённых».
  const savedFilters = useListFilters({ scope: "content", current: filter, apply: commitFilter, normalize: contentFilterOf, keyOf: stableKey });

  // PRD-70 FR-21, FR-22: суммы качества темы и папки — количества вопросов, у «Тестов» — разные тесты.
  const topicQuality = (topicId: string): QualityTotals =>
    totalsOf((questionsByTopic.get(topicId) ?? []).map((q) => q.id), qualityById);
  const folderQuality = (folderId: string): QualityTotals =>
    totalsOf(topicsUnderFolder(folderId).flatMap((tid) => (questionsByTopic.get(tid) ?? []).map((q) => q.id)), qualityById);
  /** Число колонки: ноль — приглушённо, как в эскизе. */
  const countCell = (n: number) => (n === 0 ? <span className="ct-zero">0</span> : n);
  /** Ячейки набора «Качество» для темы и папки. */
  const totalsCells = (totals: QualityTotals) => (
    <>
      <div className="ct-cell">{countCell(totals.review)}</div>
      <div className="ct-cell">{countCell(totals.overexposed)}</div>
      <div className="ct-cell">{countCell(totals.never)}</div>
      <div className="ct-cell">{countCell(totals.tests)}</div>
    </>
  );
  /** Метка «N на ревизии» у темы и папки в наборе «Содержание». */
  const reviewCountTag = (totals: QualityTotals) =>
    canAnalytics && totals.review > 0 ? <Tag tone="warning" size="s">{totals.review} на ревизии</Tag> : null;

  // FR-24: «Развернуть все / Свернуть все» — та же пара ДС, что в редакторе и профиле экспозиции.
  const treeFold: SectionFold = {
    isOpen: () => true,
    toggle: () => {},
    expandAll,
    collapseAll,
    anyCollapsed: collapsedFolders.size > 0 || expandedTopics.size < topics.length,
    allCollapsed: collapsedFolders.size >= folders.length && expandedTopics.size === 0,
  };

  const rows: React.ReactNode[] = [];

  function pushTopic(topic: Topic, depth: number) {
    if (!topicVisible(topic)) return;
    const total = (questionsByTopic.get(topic.id) ?? []).length;
    const shown = shownByTopic.get(topic.id) ?? [];
    const open = contentActive || expandedTopics.has(topic.id);
    const menuOpen = menu?.kind === "topic" && menu.id === topic.id;
    const topicSel = selectedTopics.has(topic.id);
    rows.push(
      <div key={`t-${topic.id}`} className={`ct-row ct-row--topic ${depthClass(depth)}${open ? " is-open" : ""}${topicSel ? " is-tselected" : ""}`} onClick={() => toggleTopic(topic.id)} role="button" tabIndex={0}>
        <div className="ct-name">
          <span className="ct-qcheck" onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={topicSel} onChange={() => toggleTopicSelected(topic.id)} aria-label={t.content.selectTopicForExport} />
          </span>
          <span className="ct-twist">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
          <span className="ct-ico ct-ico--topic"><Bookmark size={16} /></span>
          <span className="ct-name__label">{topic.name}</span>
          {!quality && reviewCountTag(topicQuality(topic.id))}
        </div>
        {quality ? totalsCells(topicQuality(topic.id)) : (
          <>
            <div className="ct-owner">{ownerLabel(topic.ownerId ?? null)}</div>
            <div className="ct-cell" />
            <div className="ct-cell" />
            <div className="ct-cell">{contentActive ? `${shown.length} / ${total}` : `${total}`}</div>
          </>
        )}
        <RowActions open={menuOpen} label={t.content.actionsTopic} onToggle={() => setMenu(menuOpen ? null : { kind: "topic", id: topic.id })}>
          {can("questions.manage") && <MenuItem icon={<Plus size={16} />} onClick={() => { setMenu(null); setEditorTarget({ question: null, defaultTopicId: topic.id }); }} testId={`ct-topic-addq-${topic.id}`}>{t.content.addQuestion}</MenuItem>}
          {can("questions.importExport") && <MenuItem icon={<Download size={16} />} onClick={() => { setMenu(null); exportTopicsToExcel([topic.id]); }} testId={`ct-topic-export-${topic.id}`}>{t.content.exportToExcel}</MenuItem>}
          {can("topics.manage") && <MenuItem icon={<Pencil size={16} />} onClick={() => { setMenu(null); setTopicTab("props"); setTopicTarget({ mode: "edit", topic }); }}>{t.content.topicSettings}</MenuItem>}
          {can("topics.access.grant") && <MenuItem icon={<KeyRound size={16} />} onClick={() => { setMenu(null); setTopicTab("access"); setTopicTarget({ mode: "edit", topic }); }}>{t.content.topicAccess}</MenuItem>}
          {can("topics.manage") && <MenuItem icon={<Move size={16} />} onClick={() => { setMenu(null); setMoveTopicTarget({ id: topic.id, folderId: topic.folderId ?? "" }); }}>{t.content.moveTopicToFolder}</MenuItem>}
          {can("topics.manage") && <MenuItem danger icon={<Trash2 size={16} />} onClick={() => { setMenu(null); setDeleteTopicIds([topic.id]); }}>{t.content.deleteTopic}</MenuItem>}
        </RowActions>
      </div>,
    );
    if (open) for (const q of shown) pushQuestion(q, depth + 1);
  }

  /** Ячейки набора «Качество» у вопроса: признак, переэкспонированность, «не выдавался», тестов. */
  function questionQualityCells(item: BankQuestionQuality | undefined) {
    return (
      <>
        <div className="ct-cell">
          {item?.review ? (
            <>
              <Tag tone={item.review.tone === "info" ? "neutral" : item.review.tone} size="s">{item.review.title}</Tag>
              <span className="ct-cell-sub">{reviewSub(item.review)}</span>
            </>
          ) : null}
        </div>
        <div className="ct-cell">
          {item?.overexposure ? (
            <>
              <Tag tone="warning" size="s">чаще ожидаемого</Tag>
              <span className="ct-cell-sub">{overexposureSub(item.overexposure)}</span>
            </>
          ) : null}
        </div>
        <div className="ct-cell">{item?.neverDelivered ? <Tag tone="neutral" size="s">не выдавался</Tag> : null}</div>
        <div className="ct-cell">{countCell(item?.testIds.length ?? 0)}</div>
      </>
    );
  }

  function pushQuestion(q: Question, depth: number) {
    const type = q.type as QuestionType;
    const Icon = TYPE_ICON[type] ?? CircleDot;
    const menuOpen = menu?.kind === "question" && menu.id === q.id;
    const isSel = selected.has(q.id);
    const qOpen = expandedQuestions.has(q.id);
    rows.push(
      <div key={`q-${q.id}`} data-question-id={q.id} className={`ct-row ct-row--q ${depthClass(depth)}${isSel ? " is-selected" : ""}${qOpen ? " is-open" : ""}`} onClick={() => toggleQuestion(q.id)} role="button" tabIndex={0}>
        <div className="ct-name">
          <span className="ct-qcheck" onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={isSel} onChange={() => toggleSelected(q.id)} aria-label={t.content.selectQuestion} />
          </span>
          <span className="ct-twist">{qOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
          <span className="ct-qtype" title={TYPE_LABEL[type]}><Icon size={16} /></span>
          <TruncatedLabel className="ct-name__label" text={questionLabel(q)} />
          {q.mediaType ? <span className="ct-qmedia" title="С медиа"><ImageIcon size={16} /></span> : null}
          {/* FR-21: метка «на ревизии» ведёт на статистику вопроса банка. */}
          {!quality && canAnalytics && qualityById.get(q.id)?.review ? (
            <a
              className="ou-link-reset"
              href={bankQuestionHref(q.id)}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); openStatistics(q.id); }}
            >
              <Tag tone="warning" size="s">на ревизии</Tag>
            </a>
          ) : null}
        </div>
        {quality ? questionQualityCells(qualityById.get(q.id)) : (
          <>
            <div className="ct-owner" />
            <div className="ct-cell">
              {q.orderIndex != null ? q.orderIndex : <span className="ct-na">{t.content.orderIndexNotSet}</span>}
            </div>
            <div className="ct-cell">{q.difficulty != null ? q.difficulty : <span className="ct-na">{t.questions.difficultyNotSet}</span>}</div>
            <div className="ct-cell" />
          </>
        )}
        <RowActions open={menuOpen} label={t.content.actionsQuestion} onToggle={() => setMenu(menuOpen ? null : { kind: "question", id: q.id })}>
          <MenuItem icon={<Pencil size={16} />} onClick={() => { setMenu(null); setEditorTarget({ question: q }); }} testId={`ct-q-edit-${q.id}`}>{t.content.editQuestion}</MenuItem>
          {/* PRD-70 FR-25: статистика вопроса по всем тестам читателя. */}
          {canAnalytics && <MenuItem icon={<BarChart3 size={16} />} onClick={() => { setMenu(null); openStatistics(q.id); }} testId={`ct-q-stats-${q.id}`}>Статистика</MenuItem>}
          {can("questions.manage") && <MenuItem icon={<Copy size={16} />} onClick={() => { setMenu(null); duplicateQuestionMut.mutate(q.id); }}>{t.questions.duplicate}</MenuItem>}
          {can("questions.manage") && <MenuItem icon={<Move size={16} />} onClick={() => { setMenu(null); setMoveQ({ ids: [q.id], topicId: q.topicId }); }}>{t.content.moveQuestionToTopic}</MenuItem>}
          {can("questions.manage") && <MenuItem danger icon={<Trash2 size={16} />} onClick={() => { setMenu(null); deleteQuestion(q); }}>{t.content.deleteSelected}</MenuItem>}
        </RowActions>
      </div>,
    );
    if (qOpen) {
      rows.push(
        <div key={`qp-${q.id}`} className={`ct-qpreview-row ${depthClass(depth)}`}>
          <QuestionPreview question={q} />
        </div>,
      );
    }
  }

  function pushFolder(folder: Folder, depth: number) {
    if (!folderVisible(folder.id)) return;
    const open = contentActive || !collapsedFolders.has(folder.id);
    const totals = folderTotals.get(folder.id) ?? { folders: 0, topics: 0, questions: 0 };
    const menuOpen = menu?.kind === "folder" && menu.id === folder.id;
    const folderSel = selectedFolders.has(folder.id);
    rows.push(
      <div key={`f-${folder.id}`} className={`ct-row ct-row--folder ${depthClass(depth)}${folderSel ? " is-tselected" : ""}`} onClick={() => toggleFolder(folder.id)} role="button" tabIndex={0}>
        <div className="ct-name">
          <span className="ct-qcheck" onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={folderSel} onChange={() => toggleFolderSelected(folder.id)} aria-label={t.content.selectFolder} />
          </span>
          <span className="ct-twist">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
          <span className="ct-ico"><FolderIcon size={16} /></span>
          <span className="ct-name__label">{folder.name}</span>
          <span className="ct-foldercount">{countsLabel(totals)}</span>
          {!quality && reviewCountTag(folderQuality(folder.id))}
        </div>
        {quality ? totalsCells(folderQuality(folder.id)) : (
          <>
            <div className="ct-owner" />
            <div className="ct-cell" />
            <div className="ct-cell" />
            <div className="ct-cell" />
          </>
        )}
        <RowActions open={menuOpen} label={t.content.actionsFolder} onToggle={() => setMenu(menuOpen ? null : { kind: "folder", id: folder.id })}>
          {can("topics.manage") && <MenuItem icon={<Plus size={16} />} onClick={() => { setMenu(null); setTopicTab("props"); setTopicTarget({ mode: "create", folderId: folder.id }); }}>{t.content.addTopicHere}</MenuItem>}
          {can("folders.manage") && <MenuItem icon={<FolderPlus size={16} />} onClick={() => { setMenu(null); setNewFolder({ parentId: folder.id, name: "" }); }}>{t.content.addSubfolder}</MenuItem>}
          {can("folders.manage") && <MenuItem icon={<Pencil size={16} />} onClick={() => { setMenu(null); setRenameFolderTarget({ id: folder.id, name: folder.name }); }}>{t.content.renameFolder}</MenuItem>}
          {can("folders.manage") && <MenuItem danger icon={<Trash2 size={16} />} onClick={() => { setMenu(null); setFolderDelete({ folderIds: [folder.id], folderName: folder.name, standaloneTopicIds: [] }); }}>{t.content.deleteFolder}</MenuItem>}
        </RowActions>
      </div>,
    );
    if (open) {
      for (const sub of childFolders.get(folder.id) ?? []) pushFolder(sub, depth + 1);
      for (const tp of topicsByFolder.get(folder.id) ?? []) pushTopic(tp, depth + 1);
    }
  }

  for (const folder of childFolders.get(null) ?? []) pushFolder(folder, 0);
  for (const tp of topicsByFolder.get(null) ?? []) pushTopic(tp, 0);

  // Active-condition chips (driven by the applied filter).
  const chips: { key: string; label: string; remove: () => void }[] = [];
  for (const ty of filter.types) chips.push({ key: `t-${ty}`, label: `Тип: ${TYPE_OPTS.find((o) => o.value === ty)?.label}`, remove: () => commitFilter({ ...filter, types: filter.types.filter((x) => x !== ty) }) });
  if (filter.diffUnset) chips.push({ key: "d-unset", label: "Сложность: не задана", remove: () => commitFilter({ ...filter, diffUnset: false }) });
  else if (filter.diffMin > 0 || filter.diffMax < 100) chips.push({ key: "d-range", label: `Сложность: ${filter.diffMin}–${filter.diffMax}`, remove: () => commitFilter({ ...filter, diffMin: 0, diffMax: 100 }) });
  for (const tg of filter.tags) chips.push({ key: `g-${tg}`, label: `Тег: ${tg}`, remove: () => commitFilter({ ...filter, tags: filter.tags.filter((x) => x !== tg) }) });
  for (const m of filter.media) chips.push({ key: `m-${m}`, label: `Медиа: ${MEDIA_OPTS.find((o) => o.value === m)?.label}`, remove: () => commitFilter({ ...filter, media: filter.media.filter((x) => x !== m) }) });
  if (filter.author) chips.push({ key: "a", label: `Владелец: ${authorOptions.find((o) => o.value === filter.author)?.label ?? filter.author}`, remove: () => commitFilter({ ...filter, author: "" }) });
  if (filter.scope !== "all") chips.push({ key: "s", label: `Область: ${SCOPE_OPTS.find((o) => o.value === filter.scope)?.label}`, remove: () => commitFilter({ ...filter, scope: "all" }) });
  for (const st of filter.states) chips.push({ key: `st-${st}`, label: `Состояние: ${STATE_OPTS.find((o) => o.value === st)?.label.toLowerCase()}`, remove: () => commitFilter({ ...filter, states: filter.states.filter((x) => x !== st) }) });

  // Result note when filtering.
  let foundQ = 0;
  let foundTopics = 0;
  if (contentActive) {
    for (const topic of topics) {
      const s = shownByTopic.get(topic.id);
      if (topicInScope(topic) && s && s.length > 0) { foundQ += s.length; foundTopics += 1; }
    }
  }

  const isLoading = dataLoading;
  const activeCount = filterCount(filter);

  return (
    <div className="tb-content-tree">
      <FilterBar
        search={<Input size="s" iconLeft={<Search size={16} />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.content.searchPlaceholder} aria-label={t.content.searchPlaceholder} fullWidth />}
        count={activeCount}
        applied={chips.map((c) => ({ id: c.key, label: c.label }))}
        filterButtonRef={filterButtonRef}
        filterOpen={filterOpen}
        onOpenFilter={toggleFilters}
        onRemove={(id) => chips.find((c) => c.key === id)?.remove()}
        onReset={resetFilters}
        {...savedFilters}
        actions={(
          <>
            {canAnalytics && (
              <SegmentedControl<ColumnSet>
                size="s"
                aria-label="Набор колонок"
                value={columnSet}
                onChange={setColumnSet}
                items={[{ value: "content", label: "Содержание" }, { value: "quality", label: "Качество" }]}
              />
            )}
            <FoldAllButtons fold={treeFold} testIdPrefix="ct" />
          </>
        )}
      />
      <ContentFilters
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        anchorRef={filterButtonRef}
        value={draft}
        onChange={setDraft}
        onApply={applyFilters}
        onReset={resetDraft}
        tagOptions={tagOptions}
        authorOptions={authorOptions}
        showStates={canAnalytics}
      />

      {contentActive && !isLoading && (
        <div className="ct-filternote">Показано {foundQ} {plural(foundQ, "совпадение", "совпадения", "совпадений")} в {foundTopics} {plural(foundTopics, "теме", "темах", "темах")} · дерево автоматически раскрыто</div>
      )}

      {selected.size > 0 && (
        <div className="ct-bulkbar">
          <span className="ct-bulkbar__count">{t.content.selectedCount} {selected.size}</span>
          <span className="ct-bulkbar__spacer" />
          {can("questions.manage") && (
            <Button variant="secondary" size="s" leadingIcon={<Move size={16} />} onClick={() => setMoveQ({ ids: Array.from(selected), topicId: "" })}>{t.content.moveSelected}</Button>
          )}
          <Button variant="ghost" size="s" onClick={() => setSelected(new Set())}>{t.content.clearSelection}</Button>
        </div>
      )}

      {/* «Папки и темы» selection bar: group move / access / export / delete. */}
      {(selectedTopics.size + selectedFolders.size) > 0 && (
        <div className="ct-bulkbar">
          <span className="ct-bulkbar__count">
            {t.content.selectedFtCount} {resolvedTopicIds.length} {plural(resolvedTopicIds.length, "тема", "темы", "тем")}
            {selectedFolders.size > 0 ? ` · ${selectedFolders.size} ${plural(selectedFolders.size, "папка", "папки", "папок")}` : ""}
          </span>
          <span className="ct-bulkbar__spacer" />
          {can("topics.manage") && (
            <Button variant="ghost" size="s" leadingIcon={<Move size={16} />} onClick={() => setGroupMoveOpen(true)} data-testid="ct-group-move">{t.content.moveSelected}</Button>
          )}
          {can("topics.access.grant") && (
            <Button variant="ghost" size="s" leadingIcon={<KeyRound size={16} />} onClick={() => setGroupAccessOpen(true)} data-testid="ct-group-access">{t.content.groupAccess}</Button>
          )}
          {can("questions.importExport") && (
            <Button variant="ghost" size="s" leadingIcon={<Download size={16} />} onClick={() => exportTopicsToExcel(resolvedTopicIds)} data-testid="ct-export-topics">{t.content.exportToExcel}</Button>
          )}
          {can("topics.manage") && (
            <Button
              variant="ghost"
              size="s"
              leadingIcon={<Trash2 size={16} />}
              data-testid="ct-group-delete"
              onClick={() => {
                if (selectedFolders.size > 0) {
                  const fid = Array.from(selectedFolders);
                  const primary = folders.find((f) => f.id === fid[0]);
                  setFolderDelete({ folderIds: fid, folderName: primary?.name ?? "", standaloneTopicIds: Array.from(selectedTopics) });
                } else {
                  setDeleteTopicIds(resolvedTopicIds);
                }
              }}
            >
              {t.content.deleteSelected}
            </Button>
          )}
          <Button variant="ghost" size="s" onClick={clearGroupSelection}>{t.content.clearSelection}</Button>
        </div>
      )}

      {isLoading ? (
        <LoadingState message={t.content.loading} />
      ) : topics.length === 0 ? (
        <div className="ct-empty"><Text tone="muted">{t.content.emptyTopics}</Text></div>
      ) : (
        <div ref={treeRef} className={`ct-tree${quality ? " ct-tree--quality" : ""}`} aria-label={t.content.title}>
          {quality ? (
            <div className="ct-thead">
              <div>{t.content.colName}</div>
              <div><TermHint entry="bankReview" /></div>
              <div><TermHint entry="bankOverexposed" /></div>
              <div><TermHint entry="bankNeverDelivered" /></div>
              <div><TermHint entry="bankTests" /></div>
              <div />
            </div>
          ) : (
            <div className="ct-thead">
              <div>{t.content.colName}</div>
              <div>{t.content.colOwner}</div>
              {/* PRD-30 FR-08: the bank is sorted by this index, so the number has
                  to be visible — otherwise the row order is unexplainable. */}
              <div>{t.content.colOrderIndex}</div>
              <div>{t.content.colDifficulty}</div>
              <div>{t.content.colQuestions}</div>
              <div />
            </div>
          )}
          <div className="ct-rootrow">
            <span className="ct-ico"><FolderIcon size={16} /></span>
            {/* The bare «(N)» here silently meant QUESTIONS; the tree's totals now
                say what each number counts. */}
            {t.content.allTopics}
            <span className="ct-foldercount">
              {countsLabel({ folders: folders.length, topics: topics.length, questions: questions.length })}
            </span>
          </div>
          {rows.length > 0 ? rows : <div className="ct-empty"><Text tone="muted">{t.content.nothingFound}</Text></div>}
        </div>
      )}

      {/* Speed-dial FAB — create folder / topic / question (matches the wireframe). */}
      <div className="ct-fab-wrap" onClick={(e) => e.stopPropagation()}>
        {fabOpen && (
          <div className="ct-fab-actions">
            {can("folders.manage") && (
              <div className="ct-fab-action">
                <span className="ct-fab-action-label">{t.content.fabAddFolder}</span>
                <button type="button" className="ct-fab-action-btn" aria-label={t.content.fabAddFolder} onClick={() => { setFabOpen(false); setNewFolder({ parentId: null, name: "" }); }} data-testid="ct-fab-folder"><FolderPlus size={18} /></button>
              </div>
            )}
            {can("topics.manage") && (
              <div className="ct-fab-action">
                <span className="ct-fab-action-label">{t.content.fabAddTopic}</span>
                <button type="button" className="ct-fab-action-btn" aria-label={t.content.fabAddTopic} onClick={() => { setFabOpen(false); setTopicTab("props"); setTopicTarget({ mode: "create" }); }} data-testid="ct-fab-topic"><Bookmark size={18} /></button>
              </div>
            )}
            {can("questions.manage") && (
              <div className="ct-fab-action">
                <span className="ct-fab-action-label">{t.content.fabAddQuestion}</span>
                <button type="button" className="ct-fab-action-btn" aria-label={t.content.fabAddQuestion} onClick={() => { setFabOpen(false); setEditorTarget({ question: null }); }} data-testid="ct-fab-question"><CircleDot size={18} /></button>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className={"ou-fab ou-fab--m" + (fabOpen ? " ou-fab--open" : "")}
          aria-label={fabOpen ? t.common.cancel : t.content.createFab}
          onClick={() => setFabOpen((v) => !v)}
          data-testid="ct-fab-toggle"
        >
          <Plus size={24} />
        </button>
      </div>

      {/* Question editor (create / edit) */}
      <QuestionEditorDrawer
        open={editorTarget !== null}
        question={editorTarget?.question ?? null}
        defaultTopicId={editorTarget?.defaultTopicId}
        topics={topics}
        tagSuggestions={tagOptions}
        onClose={() => setEditorTarget(null)}
        onSaved={invalidateAll}
        onOpenStatistics={(questionId) => { setEditorTarget(null); openStatistics(questionId); }}
      />

      {/* Topic settings / access (create / edit) */}
      <TopicDrawer
        target={topicTarget}
        folders={folders}
        isAdmin={isAdmin}
        initialTab={topicTab}
        onClose={() => setTopicTarget(null)}
      />

      {/* Move questions → topic. `tb-select-modal` lets the DS Select popup escape
          the modal body's overflow (this is a short modal — see tb-components.css). */}
      <ModalDialog
        open={moveQ !== null}
        onClose={() => setMoveQ(null)}
        size="m"
        className="tb-select-modal"
        title={t.content.moveQuestionsTitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMoveQ(null)}>{t.common.cancel}</Button>
            <Button
              onClick={() => { if (moveQ?.topicId) moveQuestionsMut.mutate({ ids: moveQ.ids, topicId: moveQ.topicId }); }}
              disabled={!moveQ?.topicId || moveQuestionsMut.isPending}
              loading={moveQuestionsMut.isPending}
              data-testid="ct-move-questions-confirm"
            >
              {t.content.move}
            </Button>
          </>
        }
      >
        <Select
          label={t.content.targetTopic}
          value={moveQ?.topicId ?? ""}
          onChange={(v) => setMoveQ((prev) => (prev ? { ...prev, topicId: v } : prev))}
          placeholder={t.questions.selectTopic}
          fullWidth
          options={topics.map((tp) => ({ value: tp.id, label: tp.name }))}
        />
      </ModalDialog>

      {/* Move topic → folder */}
      <ModalDialog
        open={moveTopicTarget !== null}
        onClose={() => setMoveTopicTarget(null)}
        size="m"
        title={t.content.moveTopicTitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMoveTopicTarget(null)}>{t.common.cancel}</Button>
            <Button
              onClick={() => { if (moveTopicTarget) moveTopicMut.mutate({ id: moveTopicTarget.id, folderId: moveTopicTarget.folderId || null }); }}
              loading={moveTopicMut.isPending}
              data-testid="ct-move-topic-confirm"
            >
              {t.content.move}
            </Button>
          </>
        }
      >
        {/* FolderTreeSelect (popover portaled to <body>) instead of a DS Select,
            whose absolute `.ou-select__menu` was clipped by the modal body's
            `overflow-y: auto`. Same picker as the create-folder modal below. */}
        <Stack gap={2}>
          <Label>{t.content.targetFolder}</Label>
          <FolderTreeSelect
            folders={folders}
            value={moveTopicTarget?.folderId || null}
            onChange={(pid) => setMoveTopicTarget((prev) => (prev ? { ...prev, folderId: pid ?? "" } : prev))}
            rootLabel={t.content.rootFolder}
          />
        </Stack>
      </ModalDialog>

      {/* Create folder */}
      <ModalDialog
        open={newFolder !== null}
        onClose={() => setNewFolder(null)}
        size="m"
        title={t.content.newFolderTitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNewFolder(null)}>{t.common.cancel}</Button>
            <Button
              onClick={() => { if (newFolder?.name.trim()) createFolderMut.mutate({ name: newFolder.name.trim(), parentId: newFolder.parentId }); }}
              disabled={!newFolder?.name.trim() || createFolderMut.isPending}
              loading={createFolderMut.isPending}
              data-testid="ct-new-folder-confirm"
            >
              {t.common.create}
            </Button>
          </>
        }
      >
        <Stack gap={3}>
          <Stack gap={2}>
            <Label>{t.content.folderParent}</Label>
            <FolderTreeSelect
              folders={folders}
              value={newFolder?.parentId ?? null}
              onChange={(pid) => setNewFolder((prev) => (prev ? { ...prev, parentId: pid } : prev))}
            />
          </Stack>
          <Input
            label={t.content.folderName}
            value={newFolder?.name ?? ""}
            onChange={(e) => setNewFolder((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
            fullWidth
          />
        </Stack>
      </ModalDialog>

      {/* Rename folder */}
      <ModalDialog
        open={renameFolderTarget !== null}
        onClose={() => setRenameFolderTarget(null)}
        size="m"
        title={t.content.renameFolder}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameFolderTarget(null)}>{t.common.cancel}</Button>
            <Button
              onClick={() => { if (renameFolderTarget?.name.trim()) renameFolderMut.mutate({ id: renameFolderTarget.id, name: renameFolderTarget.name.trim() }); }}
              disabled={!renameFolderTarget?.name.trim() || renameFolderMut.isPending}
              loading={renameFolderMut.isPending}
            >
              {t.common.update}
            </Button>
          </>
        }
      >
        <Input
          label={t.content.folderName}
          value={renameFolderTarget?.name ?? ""}
          onChange={(e) => setRenameFolderTarget((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
          fullWidth
        />
      </ModalDialog>

      {/* Group operations over the «Папки и темы» selection (Р-2..Р-8) */}
      <GroupMoveModal
        open={groupMoveOpen}
        directTopicIds={Array.from(selectedTopics)}
        folderIds={Array.from(selectedFolders)}
        folders={folders}
        onClose={() => setGroupMoveOpen(false)}
        onDone={onGroupDone}
      />
      <GroupAccessModal
        open={groupAccessOpen}
        topicIds={resolvedTopicIds}
        topicCount={resolvedTopicIds.length}
        folderCount={selectedFolders.size}
        users={users}
        isAdmin={isAdmin}
        canForce={isAdmin}
        onClose={() => setGroupAccessOpen(false)}
        onDone={onGroupDone}
      />
      <GroupDeleteFlow
        open={deleteTopicIds !== null}
        topicIds={deleteTopicIds ?? []}
        canForce={isAdmin}
        onClose={() => setDeleteTopicIds(null)}
        onDone={onGroupDone}
      />
      {folderDelete && (
        <FolderDeleteDialog
          open
          folderIds={folderDelete.folderIds}
          folderName={folderDelete.folderName}
          standaloneTopicIds={folderDelete.standaloneTopicIds}
          folders={folders}
          canForce={isAdmin}
          onClose={() => setFolderDelete(null)}
          onDone={onGroupDone}
        />
      )}

      {/* PRD-15 content guard for topic/question deletes/moves affecting published tests */}
      <ContentImpactDialog {...contentGuard.dialogProps} />
    </div>
  );
}
