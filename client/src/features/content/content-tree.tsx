/**
 * @module features/content/content-tree
 *
 * Read-only table-tree for the unified "Темы и вопросы" section (Phase 1):
 * a single tree `Folder ⊃ Topic ⊃ Question` rendered in the visual language of
 * the tests list — column header (Название | Сложность | Вопросов), plain-number
 * counts, indent guide, bottom-border rows, no card. Question type is shown as a
 * monochrome pictogram; difficulty as an outline Tag. The tree is assembled on
 * the client from `/api/folders` + `/api/topics` + `/api/questions` (questions
 * grouped by topic). Expansion is local state; search filters by topic name and
 * question prompt and force-expands matches.
 *
 * Editing, the facet filter panel, moves, bulk operations and the FAB land in
 * later phases — see docs/PLAN_content_axis_implementation.md. Styling:
 * client/src/styles/tb-content-tree.css. Wireframe:
 * docs/wireframes/approved/content-bank-explorer.html.
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
  Folder as FolderIcon,
  Image as ImageIcon,
  ListOrdered,
  Search,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { Button, Input, Tag, Text } from "@universityrt/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { t } from "@/lib/i18n";
import type { Folder, Question, Topic } from "@shared/schema";

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

/** Map a 0–100 difficulty to a Tag tone / label (easy / medium / hard). */
function difficultyTone(d: number): "success" | "warning" | "error" {
  return d <= 33 ? "success" : d <= 66 ? "warning" : "error";
}
function difficultyLabel(d: number): string {
  return d <= 33 ? "легко" : d <= 66 ? "средне" : "сложно";
}

/** Indentation class by tree depth (capped); sets --ct-depth via CSS. */
const depthClass = (depth: number): string => `ct-d${Math.min(depth, 6)}`;

export function ContentTree() {
  const { data: folders = [], isLoading: loadingFolders } = useQuery<Folder[]>({ queryKey: ["/api/folders"] });
  const { data: topics = [], isLoading: loadingTopics } = useQuery<Topic[]>({ queryKey: ["/api/topics"] });
  const { data: questions = [], isLoading: loadingQuestions } = useQuery<Question[]>({ queryKey: ["/api/questions"] });

  const [search, setSearch] = useState("");
  // Folders are open by default (track only the collapsed ones); topics closed by default.
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

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  const matches = (text: string) => text.toLowerCase().includes(query);

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

  /** Questions of a topic to show given the current search. */
  function shownQuestions(topic: Topic): Question[] {
    const all = questionsByTopic.get(topic.id) ?? [];
    if (!searching) return all;
    if (matches(topic.name)) return all;
    return all.filter((q) => matches(q.prompt));
  }
  /** Whether a topic is visible under the current search. */
  function topicVisible(topic: Topic): boolean {
    if (!searching) return true;
    return matches(topic.name) || shownQuestions(topic).length > 0;
  }
  /** Whether a folder (or any descendant) has a visible topic. */
  function folderVisible(folderId: string): boolean {
    if (!searching) return true;
    const directTopics = topicsByFolder.get(folderId) ?? [];
    if (directTopics.some(topicVisible)) return true;
    const subs = childFolders.get(folderId) ?? [];
    return subs.some((f) => folderVisible(f.id));
  }

  const rows: React.ReactNode[] = [];

  function pushTopic(topic: Topic, depth: number) {
    if (!topicVisible(topic)) return;
    const count = (questionsByTopic.get(topic.id) ?? []).length;
    const open = searching || expandedTopics.has(topic.id);
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
        <div className="ct-cell">{count}</div>
      </div>,
    );
    if (open) {
      for (const q of shownQuestions(topic)) pushQuestion(q, depth + 1);
    }
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
    const open = searching || !collapsedFolders.has(folder.id);
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
          />
        </div>
        <span className="ct-spacer" />
        <Button variant="ghost" leadingIcon={<ChevronsUpDown size={16} />} onClick={expandAll}>{t.content.expandAll}</Button>
        <Button variant="ghost" leadingIcon={<ChevronsDownUp size={16} />} onClick={collapseAll}>{t.content.collapseAll}</Button>
      </div>

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
