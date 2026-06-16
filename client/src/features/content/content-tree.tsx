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
 * Phase 2: facet filter as a popover (Тип/Сложность/Теги/Медиа/Автор/Область)
 * with «Сбросить всё» / «Применить»; active-condition Chips; auto-expand to
 * matches with a "найдено / всего" count and a result note. Matches the approved
 * wireframe docs/wireframes/approved/content-bank-explorer.html.
 *
 * Performance: the per-topic filtered question lists are memoized (one pass per
 * data/filter change, not per render); free-text search is debounced; filters
 * apply in a batch on «Применить» (the tree does not re-filter on each facet
 * toggle). Row virtualization is a planned follow-up for very large banks. See
 * docs/PLAN_content_axis_implementation.md.
 */
import { useEffect, useMemo, useState } from "react";
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
import { Button, Chip, Cluster, Input, Text } from "@universityrt/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import type { Folder, Question, Topic } from "@shared/schema";
import {
  ContentFilters,
  diffActive,
  EMPTY_FILTER,
  filterCount,
  MEDIA_OPTS,
  SCOPE_OPTS,
  TYPE_OPTS,
  type ContentFilterValue,
  type MediaBucket,
} from "@/features/content/content-filters";

type QuestionType = "single" | "multiple" | "matching" | "ranking";

const TYPE_ICON: Record<QuestionType, LucideIcon> = { single: CircleDot, multiple: CheckSquare, matching: Unplug, ranking: ListOrdered };
const TYPE_LABEL: Record<QuestionType, string> = {
  single: "Одиночный выбор",
  multiple: "Множественный выбор",
  matching: "Соответствие",
  ranking: "Порядок (ранжирование)",
};

const depthClass = (depth: number): string => `ct-d${Math.min(depth, 6)}`;

/** Pure facet predicate (filter is the applied value). */
function facetMatch(q: Question, f: ContentFilterValue): boolean {
  if (f.types.length && !f.types.includes(q.type as QuestionType)) return false;
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
  const debouncedSearch = useDebouncedValue(search, 250);
  const [filter, setFilter] = useState<ContentFilterValue>(EMPTY_FILTER); // applied
  const [draft, setDraft] = useState<ContentFilterValue>(EMPTY_FILTER); // edited in the panel
  const [filterOpen, setFilterOpen] = useState(false);
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

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const q of questions) for (const tg of q.tags ?? []) set.add(tg);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const authorOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const u of users) names.set(u.id, [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || u.id);
    const ids = new Set<string>();
    for (const q of questions) if (q.createdBy) ids.add(q.createdBy);
    return Array.from(ids).map((id) => ({ value: id, label: names.get(id) ?? id })).sort((a, b) => a.label.localeCompare(b.label));
  }, [users, questions]);

  const query = debouncedSearch.trim().toLowerCase();
  const searching = query.length > 0;
  const facetsActive = filter.types.length > 0 || diffActive(filter) || filter.tags.length > 0 || filter.media.length > 0 || filter.author !== "";
  const contentActive = facetsActive || searching;

  // Memoized per-topic filtered question lists — one pass per data/filter change.
  const shownByTopic = useMemo(() => {
    const map = new Map<string, Question[]>();
    for (const topic of topics) {
      let qs = (questionsByTopic.get(topic.id) ?? []).filter((q) => facetMatch(q, filter));
      if (searching && !textIncludes(topic.name, query)) qs = qs.filter((q) => textIncludes(q.prompt, query));
      map.set(topic.id, qs);
    }
    return map;
  }, [topics, questionsByTopic, filter, query, searching]);

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
  function expandAll() { setCollapsedFolders(new Set()); setExpandedTopics(new Set(topics.map((tp) => tp.id))); }
  function collapseAll() { setCollapsedFolders(new Set(folders.map((f) => f.id))); setExpandedTopics(new Set()); }

  function openFilters() { setDraft(filter); setFilterOpen(true); }
  function applyFilters() { setFilter(draft); setFilterOpen(false); }
  function resetFilters() { setDraft(EMPTY_FILTER); setFilter(EMPTY_FILTER); }
  function commitFilter(next: ContentFilterValue) { setFilter(next); setDraft(next); }

  const rows: React.ReactNode[] = [];

  function pushTopic(topic: Topic, depth: number) {
    if (!topicVisible(topic)) return;
    const total = (questionsByTopic.get(topic.id) ?? []).length;
    const shown = shownByTopic.get(topic.id) ?? [];
    const open = contentActive || expandedTopics.has(topic.id);
    rows.push(
      <div key={`t-${topic.id}`} className={`ct-row ct-row--topic ${depthClass(depth)}${open ? " is-open" : ""}`} onClick={() => toggleTopic(topic.id)} role="button" tabIndex={0}>
        <div className="ct-name">
          <span className="ct-twist">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
          <span className="ct-ico ct-ico--topic"><Bookmark size={16} /></span>
          <span className="ct-name__label">{topic.name}</span>
        </div>
        <div className="ct-cell" />
        <div className="ct-cell">{contentActive ? `${shown.length} / ${total}` : `${total}`}</div>
      </div>,
    );
    if (open) for (const q of shown) pushQuestion(q, depth + 1);
  }

  function pushQuestion(q: Question, depth: number) {
    const type = q.type as QuestionType;
    const Icon = TYPE_ICON[type] ?? CircleDot;
    rows.push(
      <div key={`q-${q.id}`} className={`ct-row ct-row--q ${depthClass(depth)}`}>
        <div className="ct-name">
          <span className="ct-qtype" title={TYPE_LABEL[type]}><Icon size={16} /></span>
          <span className="ct-name__label">{q.prompt}</span>
          {q.mediaType ? <span className="ct-qmedia" title="С медиа"><ImageIcon size={16} /></span> : null}
        </div>
        <div className="ct-cell">{q.difficulty != null ? q.difficulty : <span className="ct-na">{t.questions.difficultyNotSet}</span>}</div>
        <div className="ct-cell" />
      </div>,
    );
  }

  function pushFolder(folder: Folder, depth: number) {
    if (!folderVisible(folder.id)) return;
    const open = contentActive || !collapsedFolders.has(folder.id);
    const topicCount = (topicsByFolder.get(folder.id) ?? []).length;
    rows.push(
      <div key={`f-${folder.id}`} className={`ct-row ct-row--folder ${depthClass(depth)}`} onClick={() => toggleFolder(folder.id)} role="button" tabIndex={0}>
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

  // Active-condition chips (driven by the applied filter).
  const chips: { key: string; label: string; remove: () => void }[] = [];
  for (const ty of filter.types) chips.push({ key: `t-${ty}`, label: `Тип: ${TYPE_OPTS.find((o) => o.value === ty)?.label}`, remove: () => commitFilter({ ...filter, types: filter.types.filter((x) => x !== ty) }) });
  if (filter.diffUnset) chips.push({ key: "d-unset", label: "Сложность: не задана", remove: () => commitFilter({ ...filter, diffUnset: false }) });
  else if (filter.diffMin > 0 || filter.diffMax < 100) chips.push({ key: "d-range", label: `Сложность: ${filter.diffMin}–${filter.diffMax}`, remove: () => commitFilter({ ...filter, diffMin: 0, diffMax: 100 }) });
  for (const tg of filter.tags) chips.push({ key: `g-${tg}`, label: `Тег: ${tg}`, remove: () => commitFilter({ ...filter, tags: filter.tags.filter((x) => x !== tg) }) });
  for (const m of filter.media) chips.push({ key: `m-${m}`, label: `Медиа: ${MEDIA_OPTS.find((o) => o.value === m)?.label}`, remove: () => commitFilter({ ...filter, media: filter.media.filter((x) => x !== m) }) });
  if (filter.author) chips.push({ key: "a", label: `Автор: ${authorOptions.find((o) => o.value === filter.author)?.label ?? filter.author}`, remove: () => commitFilter({ ...filter, author: "" }) });
  if (filter.scope !== "all") chips.push({ key: "s", label: `Область: ${SCOPE_OPTS.find((o) => o.value === filter.scope)?.label}`, remove: () => commitFilter({ ...filter, scope: "all" }) });

  // Result note when filtering.
  let foundQ = 0;
  let foundTopics = 0;
  if (contentActive) {
    for (const topic of topics) {
      const s = shownByTopic.get(topic.id);
      if (topicInScope(topic) && s && s.length > 0) { foundQ += s.length; foundTopics += 1; }
    }
  }

  const isLoading = loadingFolders || loadingTopics || loadingQuestions;
  const activeCount = filterCount(filter);

  return (
    <div className="tb-content-tree">
      <div className="ct-toolbar">
        <div className="ct-search">
          <Input iconLeft={<Search size={16} />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.content.searchPlaceholder} aria-label={t.content.searchPlaceholder} fullWidth />
        </div>
        <Button variant={filterOpen || activeCount > 0 ? "secondary" : "ghost"} leadingIcon={<Filter size={16} />} onClick={() => (filterOpen ? setFilterOpen(false) : openFilters())}>
          {t.content.filters}{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
        <span className="ct-spacer" />
        <Button variant="ghost" leadingIcon={<ChevronsUpDown size={16} />} onClick={expandAll}>{t.content.expandAll}</Button>
        <Button variant="ghost" leadingIcon={<ChevronsDownUp size={16} />} onClick={collapseAll}>{t.content.collapseAll}</Button>
        {filterOpen && <ContentFilters value={draft} onChange={setDraft} onApply={applyFilters} onReset={resetFilters} tagOptions={tagOptions} authorOptions={authorOptions} />}
      </div>

      {chips.length > 0 && (
        <div className="ct-chips">
          <Cluster gap={2} wrap>
            {chips.map((c) => <Chip key={c.key} size="s" onRemove={c.remove}>{c.label}</Chip>)}
            <Button variant="ghost" size="s" onClick={resetFilters}>Очистить всё</Button>
          </Cluster>
        </div>
      )}

      {contentActive && !isLoading && (
        <div className="ct-filternote">Показано {foundQ} {plural(foundQ, "совпадение", "совпадения", "совпадений")} в {foundTopics} {plural(foundTopics, "теме", "темах", "темах")} · дерево автоматически раскрыто</div>
      )}

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
