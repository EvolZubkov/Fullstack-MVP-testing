/**
 * @module features/content/content-tree
 *
 * Table-tree for the unified "Темы и вопросы" section: a single tree
 * `Folder ⊃ Topic ⊃ Question` in the visual language of the tests list
 * (column header Название | Сложность | Вопросов, plain-number counts, indent
 * guide, no card). Question type is a monochrome pictogram; difficulty an
 * outline Tag. The tree is assembled on the client from `/api/folders` +
 * `/api/topics` + `/api/questions` (questions grouped by topic).
 *
 * Phase 1: read-only tree, search, expand/collapse.
 * Phase 2: facet filter (Тип/Сложность/Теги/Медиа/Автор/Область) + active-chip
 * bar; filtering auto-expands the tree to matches and shows "найдено / всего"
 * per topic. Editing, moves, bulk ops and the FAB land in later phases — see
 * docs/PLAN_content_axis_implementation.md. Styling:
 * client/src/styles/tb-content-tree.css.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bookmark,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDot,
  Filter,
  Folder as FolderIcon,
  Image as ImageIcon,
  ListOrdered,
  Search,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { Button, Input, Tag, Text } from "@universityrt/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import type { Folder, Question, Topic } from "@shared/schema";
import {
  ContentFilters,
  EMPTY_FILTER,
  filterCount,
  type ContentFilterValue,
  type DiffBucket,
  type MediaBucket,
} from "@/features/content/content-filters";

type QuestionType = "single" | "multiple" | "matching" | "ranking";

/** Question type -> monochrome pictogram (mirrors the approved wireframe). */
const TYPE_ICON: Record<QuestionType, LucideIcon> = {
  single: CircleDot,
  multiple: CheckSquare,
  matching: Unplug,
  ranking: ListOrdered,
};
const TYPE_LABEL: Record<QuestionType, string> = {
  single: "Одиночный выбор",
  multiple: "Множественный выбор",
  matching: "Соответствие",
  ranking: "Порядок (ранжирование)",
};

function diffBucket(d: number): DiffBucket {
  return d <= 33 ? "easy" : d <= 66 ? "medium" : "hard";
}
function difficultyTone(d: number): "success" | "warning" | "error" {
  return d <= 33 ? "success" : d <= 66 ? "warning" : "error";
}
function difficultyLabel(d: number): string {
  return d <= 33 ? "легко" : d <= 66 ? "средне" : "сложно";
}

/** Indentation class by tree depth (capped); sets --ct-depth via CSS. */
const depthClass = (depth: number): string => `ct-d${Math.min(depth, 6)}`;

interface UserLite {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export function ContentTree() {
  const { user, can } = useAuth();
  const userId = user?.id ?? "";

  const { data: folders = [], isLoading: loadingFolders } = useQuery<Folder[]>({ queryKey: ["/api/folders"] });
  const { data: topics = [], isLoading: loadingTopics } = useQuery<Topic[]>({ queryKey: ["/api/topics"] });
  const { data: questions = [], isLoading: loadingQuestions } = useQuery<Question[]>({ queryKey: ["/api/questions"] });
  const { data: users = [] } = useQuery<UserLite[]>({ queryKey: ["/api/users"], enabled: can("users.read") });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ContentFilterValue>(EMPTY_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  // Folders open by default (track collapsed ones); topics closed by default.
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedTopics, setExpandedTopics] = useState<ReadonlySet<string>>(() => new Set());

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
      const list = map.get(key);
      if (list) list.push(f);
      else map.set(key, [f]);
    }
    return map;
  }, [folders]);

  const topicsByFolder = useMemo(() => {
    const map = new Map<string | null, Topic[]>();
    for (const tp of topics) {
      const key = tp.folderId ?? null;
      const list = map.get(key);
      if (list) list.push(tp);
      else map.set(key, [tp]);
    }
    return map;
  }, [topics]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const q of questions) for (const tg of q.tags ?? []) set.add(tg);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const userName = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || u.id;
      map.set(u.id, name);
    }
    return map;
  }, [users]);

  const authorOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const q of questions) if (q.createdBy) ids.add(q.createdBy);
    return Array.from(ids)
      .map((id) => ({ value: id, label: userName.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [questions, userName]);

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  const facetsActive = filter.types.length > 0 || filter.diffs.length > 0 || filter.tags.length > 0 || filter.media.length > 0 || filter.author !== "";
  const contentActive = facetsActive || searching;
  const textMatches = (text: string) => text.toLowerCase().includes(query);

  function facetMatch(q: Question): boolean {
    if (filter.types.length && !filter.types.includes(q.type as QuestionType)) return false;
    if (filter.diffs.length && !filter.diffs.includes(diffBucket(q.difficulty ?? 50))) return false;
    if (filter.tags.length) {
      const qt = q.tags ?? [];
      if (!filter.tags.some((tg) => qt.includes(tg))) return false;
    }
    if (filter.media.length) {
      const mb = (q.mediaType as MediaBucket | null) ?? "none";
      if (!filter.media.includes(mb)) return false;
    }
    if (filter.author && q.createdBy !== filter.author) return false;
    return true;
  }

  function topicInScope(topic: Topic): boolean {
    switch (filter.scope) {
      case "mine": return topic.ownerId === userId;
      case "shared": return topic.visibility === "shared";
      case "accessible": return topic.ownerId !== userId && topic.visibility !== "shared";
      default: return true;
    }
  }

  /** Questions of a topic to show given the current facets + search. */
  function shownQuestions(topic: Topic): Question[] {
    let qs = (questionsByTopic.get(topic.id) ?? []).filter(facetMatch);
    if (searching && !textMatches(topic.name)) qs = qs.filter((q) => textMatches(q.prompt));
    return qs;
  }
  function topicVisible(topic: Topic): boolean {
    if (!topicInScope(topic)) return false;
    if (!contentActive) return true;
    if (shownQuestions(topic).length > 0) return true;
    return searching && textMatches(topic.name);
  }
  function folderVisible(folderId: string): boolean {
    if (!contentActive && filter.scope === "all") return true;
    const direct = topicsByFolder.get(folderId) ?? [];
    if (direct.some(topicVisible)) return true;
    return (childFolders.get(folderId) ?? []).some((f) => folderVisible(f.id));
  }

  function toggleFolder(id: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleTopic(id: string) {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function expandAll() {
    setCollapsedFolders(new Set());
    setExpandedTopics(new Set(topics.map((tp) => tp.id)));
  }
  function collapseAll() {
    setCollapsedFolders(new Set(folders.map((f) => f.id)));
    setExpandedTopics(new Set());
  }

  const rows: React.ReactNode[] = [];

  function pushTopic(topic: Topic, depth: number) {
    if (!topicVisible(topic)) return;
    const total = (questionsByTopic.get(topic.id) ?? []).length;
    const open = contentActive || expandedTopics.has(topic.id);
    const countLabel = contentActive ? `${shownQuestions(topic).length} / ${total}` : `${total}`;
    rows.push(
      <div
        key={`t-${topic.id}`}
        className={`ct-row ct-row--topic ${depthClass(depth)}${open ? " is-open" : ""}`}
        onClick={() => toggleTopic(topic.id)}
        role="button"
        tabIndex={0}
      >
        <div className="ct-name">
          <span className="ct-twist">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
          <span className="ct-ico ct-ico--topic"><Bookmark size={16} /></span>
          <span className="ct-name__label">{topic.name}</span>
        </div>
        <div className="ct-cell" />
        <div className="ct-cell">{countLabel}</div>
      </div>,
    );
    if (open) for (const q of shownQuestions(topic)) pushQuestion(q, depth + 1);
  }

  function pushQuestion(q: Question, depth: number) {
    const type = q.type as QuestionType;
    const Icon = TYPE_ICON[type] ?? CircleDot;
    const diff = q.difficulty ?? 50;
    rows.push(
      <div key={`q-${q.id}`} className={`ct-row ct-row--q ${depthClass(depth)}`}>
        <div className="ct-name">
          <span className="ct-qtype" title={TYPE_LABEL[type]}><Icon size={16} /></span>
          <span className="ct-name__label">{q.prompt}</span>
          {q.mediaType ? <span className="ct-qmedia" title="С медиа"><ImageIcon size={16} /></span> : null}
        </div>
        <div className="ct-cell"><Tag tone={difficultyTone(diff)} variant="outline" size="s">{difficultyLabel(diff)}</Tag></div>
        <div className="ct-cell" />
      </div>,
    );
  }

  function pushFolder(folder: Folder, depth: number) {
    if (!folderVisible(folder.id)) return;
    const open = contentActive || !collapsedFolders.has(folder.id);
    const topicCount = (topicsByFolder.get(folder.id) ?? []).length;
    rows.push(
      <div
        key={`f-${folder.id}`}
        className={`ct-row ct-row--folder ${depthClass(depth)}`}
        onClick={() => toggleFolder(folder.id)}
        role="button"
        tabIndex={0}
      >
        <div className="ct-name">
          <span className="ct-twist">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
          <span className="ct-ico"><FolderIcon size={16} /></span>
          <span className="ct-name__label">{folder.name}</span>
          <span className="ct-foldercount">{topicCount} {t.navigation.topics.toLowerCase()}</span>
        </div>
        <div className="ct-cell" />
        <div className="ct-cell" />
      </div>,
    );
    if (open) {
      for (const sub of childFolders.get(folder.id) ?? []) pushFolder(sub, depth + 1);
      for (const tp of topicsByFolder.get(folder.id) ?? []) pushTopic(tp, depth + 1);
    }
  }

  for (const folder of childFolders.get(null) ?? []) pushFolder(folder, 0);
  for (const tp of topicsByFolder.get(null) ?? []) pushTopic(tp, 0);

  const isLoading = loadingFolders || loadingTopics || loadingQuestions;
  const activeCount = filterCount(filter);

  return (
    <div className="tb-content-tree">
      <div className="ct-toolbar">
        <div className="ct-search">
          <Input
            iconLeft={<Search size={16} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.content.searchPlaceholder}
            aria-label={t.content.searchPlaceholder}
            fullWidth
          />
        </div>
        <Button
          variant={filterOpen || activeCount > 0 ? "secondary" : "ghost"}
          leadingIcon={<Filter size={16} />}
          onClick={() => setFilterOpen((v) => !v)}
        >
          {t.content.filters}{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
        <span className="ct-spacer" />
        <Button variant="ghost" leadingIcon={<ChevronsUpDown size={16} />} onClick={expandAll}>{t.content.expandAll}</Button>
        <Button variant="ghost" leadingIcon={<ChevronsDownUp size={16} />} onClick={collapseAll}>{t.content.collapseAll}</Button>
      </div>

      <ContentFilters value={filter} onChange={setFilter} open={filterOpen} tagOptions={tagOptions} authorOptions={authorOptions} />

      {isLoading ? (
        <LoadingState message={t.content.loading} />
      ) : topics.length === 0 ? (
        <div className="ct-empty"><Text tone="muted">{t.content.emptyTopics}</Text></div>
      ) : (
        <div className="ct-tree" aria-label={t.content.title}>
          <div className="ct-thead">
            <div>{t.content.colName}</div>
            <div>{t.content.colDifficulty}</div>
            <div>{t.content.colQuestions}</div>
          </div>
          <div className="ct-rootrow">
            <span className="ct-ico"><FolderIcon size={16} /></span>
            {t.content.allTopics} ({questions.length})
          </div>
          {rows.length > 0 ? rows : <div className="ct-empty"><Text tone="muted">{t.content.nothingFound}</Text></div>}
        </div>
      )}
    </div>
  );
}
