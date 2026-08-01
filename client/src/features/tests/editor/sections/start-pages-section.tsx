/**
 * @module features/tests/editor/sections/start-pages-section
 * @description Editor section for the «Структура» tab (PRD-7 wireframes
 * `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`,
 * `prd7-structure-router.html`; closeout of PRD-1 §4).
 *
 * Rendering is **kind-aware** (PRD-1 §4.3 / PRD-19 §3.2), not position-tuple-based:
 * system pages are placed by their `kind` into semantic zones, author pages by
 * their position/topic into editable groups.
 *   - `start`   (singleton) → «До теста» zone, read-only + variant switch.
 *   - `results` (singleton) → «После теста» zone, read-only + variant switch.
 *   - `router`  (singleton) → «Маршрутизатор» zone (router_by_topics).
 *   - `questions` → one row per topic (per-topic modes) or one flat row
 *     (linear_flat), enriched with the section's question count; read-only +
 *     variant switch. NOT duplicated with a synthetic row.
 *   - `review` (singleton, PRD-19) → «Обзор раздела/теста» system node at the
 *     section/test boundary — variant switch + preview; gated by «возврат к
 *     неотвеченным» (dimmed + comment when off) and hidden for adaptive.
 *   - `section-results` (singleton, PRD-19) → «Итоги раздела» system node, shown
 *     in each section block when `showSectionResults` is ON; variant switch + preview.
 *   - `info` (author) → editable rows in «До/После теста» and per-topic
 *     before/after groups: add (insert-row + variant modal), inline-expand
 *     edit, drag-reorder, delete.
 *
 * The legacy per-topic `intro` («Введение раздела») / `summary` («Итоги раздела»)
 * system pages were removed (PRD-19 contract §3.2): section intro/summary content
 * is authored via the topic-before/after `info` zones, and the section boundary
 * is the `review` + `section-results` nodes above.
 *
 * System rows expose «Сменить вариант» (FR-46 / PRD-1 §4.3.3) — disabled when
 * the active template declares a single variant of that kind. Structural
 * classes live in `client/src/styles/tb-components.css`; controls use
 * `@universityrt/ui-kit`.
 */
import { createContext, Fragment, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Eye,
  FileText,
  GripVertical,
  HelpCircle,
  Image as ImageIcon,
  Info,
  Layout,
  List,
  Lock,
  MoreHorizontal,
  PieChart,
  Plus,
  Route,
  Search,
  Upload,
  X,
} from "lucide-react";
import {
  Banner,
  Button,
  Combobox,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuTrigger,
  ModalDialog,
  NumberInput,
  RichTextEditor,
  Select,
  Switch,
  Tag,
  Textarea,
  type RichTextMode,
} from "@universityrt/ui-kit";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useContentPages,
  type ContentPage,
  type ContentPageKind,
  type ContentPagePosition,
  type ContentPageMode,
  type ContentTemplatePlaceholder,
  type ContentTemplateSetting,
  type ContentTemplateVariant,
  type UseContentPagesResult,
} from "../use-content-pages";
import { isPlaceholderType, isSettingType, inputModesFor } from "@shared/template/field-types";
import { sanitizeHtml as sanitizeContentHtml, placeholderScope } from "@shared/security/html-sanitize";
import type { TestEditorModel } from "../test-editor.types";
import { PagePreviewModal } from "./page-preview-modal";
import { VariantPreviewPicker } from "./variant-preview-picker";
import { SanitizeBanner } from "./sanitize-banner";

// ─── Public API ───────────────────────────────────────────────────────────────

export type StructureSectionProps = {
  model: TestEditorModel;
  /** Test id is required to fetch content_pages; `undefined` in create mode. */
  testId?: string;
  /**
   * Optional pre-hoisted content-pages hook. When provided, the section does
   * NOT call {@link useContentPages} internally — the drawer owns the lifecycle
   * so its footer can reflect content-page validation in the save gate.
   */
  content?: UseContentPagesResult;
  /**
   * The `flowMode` from the last saved snapshot (from {@link useTestEditor}).
   * When it differs from `model.flowMode`, the section renders an info-banner
   * telling the user the mode change is pending save (G15 / s-mode-change).
   * `null` in create mode or while the snapshot is not yet loaded.
   */
  savedFlowMode?: TestEditorModel["flowMode"] | null;
  /**
   * Callback that switches the Drawer to the «Состав» tab. Used for the
   * empty-topics CTA in router mode (G26).
   */
  onGoToComposition?: () => void;
  /**
   * Draft mutator for topic-drag reorder (PRD-7 G47). When `undefined` the
   * topic-grip is omitted entirely — better than a non-functional affordance.
   */
  updateModel?: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  /**
   * Renders the tab in read-only mode (PRD-7 G19). Drives: dimmed grips,
   * hidden insert-rows, row action-menu replaced by an eye-icon (preview),
   * variant-replace disabled, expand-toggle hidden. Driven from the drawer
   * by `test.status === "published"`.
   */
  readOnly?: boolean;
  /**
   * The in-progress design draft (template id + params) from the editor-level
   * {@link useDesignSettings}. The single-page preview renders against THIS
   * template/branding, so an unsaved «Оформление» switch is reflected immediately
   * — consistent with the «Оформление» template preview.
   */
  designDraft?: { templateId: string; params?: Record<string, unknown> };
};

/** Backwards-compatible alias: original skeleton lived under this name. */
export type StartPagesSectionProps = StructureSectionProps;

const FLOW_LABEL: Record<TestEditorModel["flowMode"], string> = {
  linear_flat: "Последовательный",
  linear_by_topics: "Последовательный по темам",
  router_by_topics: "Через страницу-маршрутизатор",
};

const KIND_LABEL: Record<string, string> = {
  start: "Старт",
  intro: "Введение",
  info: "Материал",
  summary: "Итоги раздела",
  results: "Итоги теста",
  router: "Маршрутизатор",
  questions: "Вопросы",
  // PRD-19 section-boundary system nodes.
  review: "Обзор",
  "section-results": "Итоги раздела",
};

/** Placement of a not-yet-created author page, captured on insert-row click. */
type AddContext = {
  position: ContentPagePosition;
  topicId: string | null;
  group: ContentPage[];
  index: number;
  zoneLabel: string;
};

/** A system page the user is re-varying (replace-variant modal). */
type ReplaceContext = { page: ContentPage };

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Author-editable pages. System kinds are bound by the service. */
function isAuthorPage(page: ContentPage): boolean {
  return page.kind === "info";
}

/**
 * PRD-19: synthesize a display-only system-node page for `review` /
 * `section-results` when the test has no persisted singleton row yet (legacy test
 * not reconciled, or a pending save). It binds to the template's default variant
 * of that kind so the row still renders the variant badge + «Предпросмотр»
 * (the обзор/итоги must always be template-overridable — PRD-19 contract §5).
 * A persisted row (created by the planner on save / by migration) takes precedence.
 * Returns null when the template declares no variant of the kind (contract §7:
 * an optional node absent from the template is simply not shown).
 */
function synthSystemNode(
  kind: "review" | "section-results",
  variants: ReadonlyArray<ContentTemplateVariant>,
): ContentPage | null {
  const variant = variants.find((v) => v.kind === kind);
  if (!variant) return null;
  return {
    id: `__virtual-${kind}`,
    testId: "",
    topicId: null,
    position: "after",
    mode: "template",
    type: kind === "section-results" ? "summary" : "info",
    kind,
    templateKey: variant.key,
    sortOrder: 0,
    valuesJson: { values: {} },
    autoAdvance: false,
    autoAdvanceDelayMs: null,
    createdAt: "",
    updatedAt: "",
  };
}

function pageTitle(page: ContentPage): string {
  const values = page.valuesJson?.values ?? {};
  return (
    (values.title as string | undefined) ||
    (values.heading as string | undefined) ||
    KIND_LABEL[page.kind] ||
    "Страница"
  );
}

/** How many pages the summary banner offers to map before it stops listing them. */
const UNMAPPED_LISTED = 5;

/**
 * Plan Э5: after switching the test's design template, every page bound to a
 * variant the new template does not declare needs the author's decision. Each
 * such page already carries a marker, but they can sit anywhere in a long
 * structure — this states the count once, at the top, and takes the author to
 * each one. Nothing is rewritten: the mapping happens in «Сменить вариант».
 */
function UnmappedPagesBanner(props: { pages: ContentPage[]; onMap: (page: ContentPage) => void }) {
  const unmapped = props.pages.filter((p) => p.templateKeyMissing);
  if (unmapped.length === 0) return null;
  const listed = unmapped.slice(0, UNMAPPED_LISTED);
  const rest = unmapped.length - listed.length;
  return (
    <Banner
      tone="warning"
      stacked
      title={`Страниц требуют сопоставления: ${unmapped.length}`}
      description={
        "Выбранный шаблон оформления не содержит вариантов, к которым привязаны эти страницы. " +
        "До сопоставления они показываются вариантом по умолчанию — привязка сохранена." +
        (rest > 0 ? ` Показаны первые ${listed.length}, ещё ${rest} — по отметке в списке.` : "")
      }
      actions={listed.map((page) => ({
        label: pageTitle(page),
        onClick: () => props.onMap(page),
      }))}
      data-testid="structure-unmapped-banner"
    />
  );
}

/** Required placeholder keys of `variant` that are empty in `values` (PRD-1 §4.3.6). */
function missingRequired(
  variant: ContentTemplateVariant | undefined,
  values: Record<string, unknown>,
): string[] {
  if (!variant) return [];
  return variant.placeholders
    .filter((ph) => ph.required)
    .filter((ph) => {
      const v = values[ph.key];
      return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    })
    .map((ph) => ph.key);
}

/** Which edge of the hovered row the dragged row will land on. */
export type DropSide = "before" | "after";

/** Active drop target during a drag: hovered row id + the insertion side. */
export type DropState = { overId: string; side: DropSide } | null;

/**
 * Shared drop-indicator state for «Структура» DnD. Rows do NOT shift while
 * dragging (the shift confused the drop direction); instead the row under the
 * pointer shows an insertion line on `side` — exactly where the dragged row
 * will land (see {@link reorderByDrop}).
 */
const DropContext = createContext<DropState>(null);

/**
 * New `sortOrder` list after dropping `activeId` on the `side` of `overId`
 * inside `zone` (already sorted). Returns `null` for a no-op. Pure — unit tested
 * independently of the @dnd-kit sensors (which need real DOM measurements
 * unavailable in jsdom).
 */
export function reorderByDrop<T extends { id: string }>(
  zone: T[],
  activeId: string,
  overId: string,
  side: DropSide,
): Array<{ id: string; sortOrder: number }> | null {
  if (activeId === overId) return null;
  const moved = zone.find((p) => p.id === activeId);
  if (!moved || !zone.some((p) => p.id === overId)) return null;
  const without = zone.filter((p) => p.id !== activeId);
  let insertAt = without.findIndex((p) => p.id === overId);
  if (side === "after") insertAt += 1;
  without.splice(insertAt, 0, moved);
  if (without.every((p, i) => p.id === zone[i].id)) return null; // no-op
  return without.map((p, i) => ({ id: p.id, sortOrder: i }));
}

/**
 * Insertion side by list index (deterministic — matches @dnd-kit's sortable
 * convention and avoids rect-center flicker when rows don't shift): dragging a
 * lower item DOWN onto a later one drops it AFTER; dragging UP drops BEFORE.
 * Keeps the indicator and the actual reorder ({@link reorderByDrop}) in sync.
 */
function sideByIndex<T extends { id: string }>(
  zone: T[],
  activeId: string,
  overId: string,
): DropSide {
  return zone.findIndex((p) => p.id === activeId) < zone.findIndex((p) => p.id === overId)
    ? "after"
    : "before";
}

/**
 * Cross-zone insertion side from the dragged row's center vs the hovered row's
 * center. Used only when the dragged page is moving to a DIFFERENT zone (the
 * dragged item isn't in the target list, so index ordering doesn't apply); the
 * DragOverlay follows the pointer so its translated rect is reliable here.
 */
function dropSideFromRects(event: DragOverEvent | DragEndEvent): DropSide {
  const ar = event.active.rect.current.translated;
  const or = event.over?.rect;
  if (!ar || !or) return "before";
  return ar.top + ar.height / 2 < or.top + or.height / 2 ? "before" : "after";
}

/** Index in `zone` where a page should be inserted for (`overId`, `side`). */
export function insertIndexFor<T extends { id: string }>(
  zone: T[],
  overId: string | null,
  side: DropSide,
): number {
  if (!overId) return zone.length;
  const oi = zone.findIndex((p) => p.id === overId);
  if (oi < 0) return zone.length;
  return side === "after" ? oi + 1 : oi;
}

// Zone droppable ids encode the target zone so an empty zone (no rows to hover)
// is still a drop target. Position/topic contain no ":" so parsing is safe.
const zoneDroppableId = (position: ContentPagePosition, topicId: string | null) =>
  `zone:${position}:${topicId ?? ""}`;
function parseZoneId(id: string): { position: ContentPagePosition; topicId: string | null } | null {
  if (!id.startsWith("zone:")) return null;
  const [, position, topicId] = id.split(":");
  return { position: position as ContentPagePosition, topicId: topicId === "" ? null : topicId };
}

/**
 * Pointer-based collision so a drop lands in the zone/row actually UNDER the
 * cursor (closestCenter compared the dragged item's center to droppable centers,
 * which mis-targeted small/empty zones). Prefer a row hit (precise sort/position)
 * over the wrapping zone; fall back to the zone, then to rect intersection.
 */
const structureCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const pool = hits.length ? hits : rectIntersection(args);
  const row = pool.find((c) => !String(c.id).startsWith("zone:"));
  return row ? [row] : pool;
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Resolves which template the page-preview must render from. Mirrors the
 * variant-binding fallback (PRD-7 G21 / PRD-1 §4.3.2): when the active template
 * declares no `contentTemplate` of this page's kind, the planner binds the page
 * to the built-in `default`, so the preview MUST render from `default` too —
 * otherwise «Структура» shows «Из стандартного шаблона» while the preview renders
 * the active template's own (or fallback) screen. Returns the draft template id
 * when the active template owns a variant of the kind, else `"default"`.
 */
export function previewTemplateId(
  cp: { contentTemplates: ReadonlyArray<{ kind?: string }> },
  draftTemplateId: string | undefined,
  page: { kind?: string | null },
): string | undefined {
  const hasOwnVariant =
    page.kind != null && cp.contentTemplates.some((v) => v.kind === page.kind);
  return hasOwnVariant ? draftTemplateId : "default";
}

export function StructureSection({ model, testId, content: contentProp, savedFlowMode, onGoToComposition, updateModel, readOnly = false, designDraft }: StructureSectionProps) {
  // Fallback hook so the section works standalone (component tests) when the
  // drawer has not hoisted the hook. Mirrors design-section's pattern.
  const fallback = useContentPages(contentProp ? undefined : testId);
  const cp = contentProp ?? fallback;

  const [addCtx, setAddCtx] = useState<AddContext | null>(null);
  const [replaceCtx, setReplaceCtx] = useState<ReplaceContext | null>(null);
  const [previewCtx, setPreviewCtx] = useState<{ page: ContentPage } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handlers: ZoneHandlers = {
    cp,
    expandedId,
    setExpandedId,
    onAdd: setAddCtx,
    onReplaceVariant: (page) => setReplaceCtx({ page }),
    onPreview: (page) => setPreviewCtx({ page }),
    readOnly,
  };

  return (
    <div data-testid="structure-section">
      {savedFlowMode !== null && savedFlowMode !== undefined && savedFlowMode !== model.flowMode && (
        <Banner
          tone="info"
          title="Режим изменён"
          description={`Структура показана в новом режиме «${FLOW_LABEL[model.flowMode]}». Изменение применится после сохранения.`}
          data-testid="structure-mode-change-banner"
        />
      )}
      <FlowModeBar mode={model.flowMode} />

      <UnmappedPagesBanner pages={cp.pages} onMap={(page) => setReplaceCtx({ page })} />

      {testId === undefined ? (
        <CreateModeNotice />
      ) : cp.isLoading ? (
        <LoadingNotice />
      ) : cp.error ? (
        <ErrorNotice message={cp.error.message} />
      ) : (
        <ZonesBlock
          model={model}
          handlers={handlers}
          onGoToComposition={onGoToComposition}
          updateModel={updateModel}
        />
      )}

      {cp.mutationError && (
        <Banner
          tone="error"
          title="Не удалось сохранить изменения структуры"
          description={cp.mutationError.message}
          data-testid="structure-mutation-error"
        />
      )}

      <AddPageModal
        ctx={addCtx}
        cp={cp}
        designDraft={designDraft}
        onClose={() => setAddCtx(null)}
        onCreated={(id) => {
          setAddCtx(null);
          setExpandedId(id);
        }}
      />
      <ReplaceVariantModal ctx={replaceCtx} cp={cp} designDraft={designDraft} onClose={() => setReplaceCtx(null)} />
      {previewCtx && (
        <PagePreviewModal
          open
          onClose={() => setPreviewCtx(null)}
          // When the active template declares no variant of this page's kind, the
          // planner binds the page to the built-in `default` (same rule as the
          // «Из стандартного шаблона» badge). The preview MUST then render from
          // `default` too — otherwise the structure says "standard" while the
          // preview shows the active template (PRD-7 G21 consistency).
          templateId={previewTemplateId(cp, designDraft?.templateId, previewCtx.page)}
          params={designDraft?.params ?? {}}
          page={previewCtx.page}
          pageTitle={pageTitle(previewCtx.page)}
          // PRD-22: the indicator a sequence page carries is computed over the whole
          // test, so the preview must be told where this page sits.
          sequencePlacement={cp.sequencePlacements.get(previewCtx.page.id) ?? null}
          // FR-44: preview from REAL test data where possible — real title, topics
          // (router menu / section labels) and total question count. Demo fills
          // the rest (e.g. example questions, not loaded in the structure editor).
          realData={{
            courseTitle: model.basic.title,
            // FR-44: real test description → the «Старт» subtitle (not the demo's).
            description: model.basic.description,
            passPercent: model.passRules.overall.type === "percent" ? model.passRules.overall.value : null,
            timeLimitMinutes: model.runtime.timeLimitMinutes,
            maxAttempts: model.runtime.maxAttempts,
            topics: model.sections.map((s) => ({ id: s.topicId, title: s.topicName })),
            questionCount: model.sections.reduce((n, s) => n + s.drawCount, 0),
            sections: model.sections.map((s) => ({
              topicId: s.topicId,
              topicName: s.topicName,
              questionCount: s.drawCount,
            })),
          }}
        />
      )}
    </div>
  );
}

/** Backwards-compatible re-export under the old skeleton name. */
export const StartPagesSection = StructureSection;

// ─── Top banner ───────────────────────────────────────────────────────────────

function FlowModeBar({ mode }: { mode: TestEditorModel["flowMode"] }) {
  return (
    <div className="flow-mode-bar" data-testid="structure-mode-banner">
      <Layout size={14} aria-hidden="true" />
      <span>Режим:</span>
      <span className="flow-mode-label">{FLOW_LABEL[mode]}</span>
      <span className="flow-mode-hint">
        — задаётся во вкладке Настройки › Сценарий прохождения
      </span>
    </div>
  );
}

function CreateModeNotice() {
  return (
    <Banner
      tone="info"
      title="Сначала сохраните черновик"
      description="Структура страниц «до / после» привязана к существующему тесту. Сохраните черновик во вкладке «Настройки», после этого здесь появится возможность редактировать страницы."
      data-testid="structure-create-notice"
    />
  );
}

function LoadingNotice() {
  return <Banner tone="info" title="Загружаем структуру…" data-testid="structure-loading" />;
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <Banner
      tone="error"
      title="Не удалось загрузить структуру"
      description={message}
      data-testid="structure-error"
    />
  );
}

// ─── Zones ────────────────────────────────────────────────────────────────────

type ZoneHandlers = {
  cp: UseContentPagesResult;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  onAdd: (ctx: AddContext) => void;
  onReplaceVariant: (page: ContentPage) => void;
  /** PRD-7 S13.4-G17 / FR-44: opens the page-preview modal for this page. */
  onPreview: (page: ContentPage) => void;
  /** When true, the tab is rendered without authoring controls (PRD-7 G19). */
  readOnly: boolean;
};

function ZonesBlock(props: {
  model: TestEditorModel;
  handlers: ZoneHandlers;
  onGoToComposition?: () => void;
  updateModel?: (updater: (model: TestEditorModel) => TestEditorModel) => void;
}) {
  const { model, handlers, onGoToComposition, updateModel } = props;
  const pages = handlers.cp.pages;
  // Distinct id namespace so the shared DndContext routes topic drags to the
  // topic-level SortableContext and page drags stay on the existing path.
  const TOPIC_ID_PREFIX = "topic:";
  const topicSortableIds = model.sections.map((s) => TOPIC_ID_PREFIX + s.topicId);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);

  // Hooks must run unconditionally, before the «no topics» early return.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropState>(null);

  const infoIn = (position: ContentPagePosition, topicId: string | null) =>
    pages
      .filter((p) => p.kind === "info" && p.position === position && p.topicId === topicId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  const systemSingleton = (kind: ContentPageKind) =>
    pages.find((p) => p.kind === kind && p.topicId === null) ?? null;
  const questionsForTopic = (tid: string) =>
    pages.find((p) => p.kind === "questions" && p.topicId === tid) ?? null;
  // PRD-1 §4.3: «Введение раздела» (intro) — a per-topic system node shown at the top
  // of each section block. Carries the author instruction (editable inline); topic
  // name / description / count / time are rendered from the section at runtime.
  const introForTopic = (tid: string) =>
    pages.find((p) => p.kind === "intro" && p.topicId === tid) ?? null;
  // PRD-19 §3.2: «Обзор раздела» (review) and «Итоги раздела» (section-results) are
  // TEST-LEVEL design bindings (singletons, topicId=null) — the section boundary
  // SYSTEM nodes, shown in every section block. They replace the legacy per-topic
  // `intro`/`summary` content pages.
  //   - review: design is always bindable; its DISPLAY is gated by «возврат к
  //     неотвеченным» (reviewSlot below) and hidden for adaptive (FR-08a / FR-22).
  //   - section-results: OPTIONAL, gated by the `showSectionResults` setting
  //     (FR-05a). When OFF the runtime goes straight to the next section, so the
  //     row is hidden.
  const reviewPage =
    systemSingleton("review") ?? synthSystemNode("review", handlers.cp.contentTemplates);
  const sectionResultsPage = model.runtime.showSectionResults
    ? (systemSingleton("section-results") ?? synthSystemNode("section-results", handlers.cp.contentTemplates))
    : null;

  // «После теста» order list = author after-pages + «Итоги теста» (results), by
  // sortOrder. Reordering/adding here renumbers this combined list so «Итоги
  // теста» stays the pre/post boundary the runtime reads.
  const afterCombined = (): ContentPage[] => {
    const r = systemSingleton("results");
    const list = infoIn("after", null);
    return r ? [...list, r].sort((a, b) => a.sortOrder - b.sortOrder) : list;
  };

  const activePage = activeId ? pages.find((p) => p.id === activeId) ?? null : null;

  // Resolve the drop target for the current drag. `over` is another page row or
  // a zone droppable (empty/zone area). Shared by the indicator (onDragOver) and
  // the actual move (onDragEnd) so they can never disagree.
  const resolveTarget = (event: DragOverEvent | DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return null;
    const activeP = pages.find((p) => p.id === active.id);
    if (!activeP || activeP.kind !== "info") return null;
    const overId = String(over.id);
    const zoneRef = parseZoneId(overId);
    const overP = zoneRef ? null : pages.find((p) => p.id === overId);
    // The «Итоги» (summary) row lives in the «После теста» zone but the system-
    // page planner stores it with a best-fit `position: "after_topic"` and
    // `topicId: null` (see server `positionForKind`). A drop on it must target
    // the after-zone ("after"/null) — inheriting the summary's raw position would
    // write the page as "after_topic"+null, which NO zone renders (it vanishes).
    const overIsSummary = overP?.kind === "summary";
    const position: ContentPagePosition | undefined = zoneRef
      ? zoneRef.position
      : overIsSummary
        ? "after"
        : overP?.position;
    const topicId = zoneRef ? zoneRef.topicId : overIsSummary ? null : overP?.topicId;
    if (!position) return null;
    const overPageId = overP ? overId : null;
    const sameZone = position === activeP.position && (topicId ?? null) === activeP.topicId;
    // «После теста» order list includes «Итоги» (a drop boundary), so a page can
    // be dropped before/after it; other zones list only their author pages.
    const isAfter = position === "after" && (topicId ?? null) === null;
    const targetZone = isAfter ? afterCombined() : infoIn(position, topicId ?? null);
    const side: DropSide = overPageId
      ? sameZone
        ? sideByIndex(targetZone, String(active.id), overPageId)
        : dropSideFromRects(event)
      : "after";
    return { activeP, sameZone, position, topicId: topicId ?? null, overPageId, side, targetZone };
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (id.startsWith(TOPIC_ID_PREFIX)) {
      setActiveTopicId(id.slice(TOPIC_ID_PREFIX.length));
      setDrop(null);
      return;
    }
    setActiveId(id);
    setDrop(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (activeTopicId !== null) return; // topic drag doesn't use the row insert-indicator
    const t = resolveTarget(event);
    // Row indicator only when hovering a specific row; empty-zone targeting is
    // shown by the zone droppable highlight (see AuthorPageGroup).
    setDrop(t && t.overPageId ? { overId: t.overPageId, side: t.side } : null);
  };

  // Reorder topics in `model.sections`. Persists on the next save (sortOrder
  // is rewritten from the array index in _insertSections — PRD-7 G47).
  const handleTopicDragEnd = (event: DragEndEvent) => {
    setActiveTopicId(null);
    if (!event.over || !updateModel) return;
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    if (activeId === overId) return;
    const activeTopicId = activeId.slice(TOPIC_ID_PREFIX.length);
    const overTopicId = overId.slice(TOPIC_ID_PREFIX.length);
    updateModel((m) => {
      const from = m.sections.findIndex((s) => s.topicId === activeTopicId);
      const to = m.sections.findIndex((s) => s.topicId === overTopicId);
      if (from < 0 || to < 0 || from === to) return m;
      return { ...m, sections: arrayMove(m.sections, from, to) };
    });
  };

  // Reorder within a zone, or move the page to another zone (changing
  // position/topicId), placing it on the indicated side of the drop target.
  const handleDragEnd = (event: DragEndEvent) => {
    if (String(event.active.id).startsWith(TOPIC_ID_PREFIX)) {
      handleTopicDragEnd(event);
      return;
    }
    setActiveId(null);
    setDrop(null);
    const t = resolveTarget(event);
    if (!t) return;
    const activeId = t.activeP.id;
    // For «После теста», t.targetZone already includes «Итоги» (resolveTarget),
    // so reordering renumbers the summary too and the pre/post boundary holds.
    const list = t.targetZone;
    if (t.sameZone) {
      if (!t.overPageId) return;
      const next = reorderByDrop(list, activeId, t.overPageId, t.side);
      if (next) void handlers.cp.reorder(next);
      return;
    }
    const insertAt = insertIndexFor(list, t.overPageId, t.side);
    const newOrder = [...list];
    newOrder.splice(insertAt, 0, t.activeP);
    void (async () => {
      await handlers.cp.update(activeId, { position: t.position, topicId: t.topicId });
      await handlers.cp.reorder(newOrder.map((p, i) => ({ id: p.id, sortOrder: i })));
    })().catch(() => {
      /* error surfaced via cp.mutationError banner — avoid an uncaught rejection */
    });
  };

  if (model.sections.length === 0) {
    if (model.flowMode === "router_by_topics") {
      return (
        <Banner
          tone="info"
          title="В тесте нет тем"
          description="Добавьте темы во вкладке «Состав», и они появятся здесь как ветки маршрутизатора."
          data-testid="structure-empty"
        >
          {onGoToComposition && (
            <Button
              variant="secondary"
              size="s"
              onClick={onGoToComposition}
              data-testid="structure-empty-topics-cta"
            >
              Перейти к Составу
            </Button>
          )}
        </Banner>
      );
    }
    return (
      <Banner
        tone="info"
        title="Тем пока нет"
        description="Добавьте темы во вкладке «Состав» — здесь они появятся в порядке прохождения."
        data-testid="structure-empty"
      />
    );
  }

  const start = systemSingleton("start");
  const results = systemSingleton("results");
  const router = systemSingleton("router");

  // PRD-19 FR-08a: the «Обзор» (section-finish / test-finish) system navigation
  // slot. The обзор is a RUNTIME template screen (not a content_page), so its
  // row is informational. Enabled when `allowReturnToUnanswered` is ON; otherwise
  // DISABLED with a comment pointing to the setting. Hidden entirely for adaptive
  // tests, where skip/return are impossible (FR-22). Independent of
  // `showSectionResults` (which gates the «Итоги раздела» summary row).
  const reviewSlot: "enabled" | "disabled" | null =
    model.mode === "adaptive"
      ? null
      : model.runtime.allowReturnToUnanswered
        ? "enabled"
        : "disabled";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={structureCollision}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
    <DropContext.Provider value={drop}>
    <div data-testid="structure-section-list">
      <Zone title="До теста" testId="structure-zone-before-test">
        {start && (
          <SystemPageRow
            page={start}
            title={pageTitle(start)}
            handlers={handlers}
            testId="structure-system-start"
          />
        )}
        <AuthorPageGroup
          pages={infoIn("before", null)}
          position="before"
          topicId={null}
          zoneLabel="До теста"
          handlers={handlers}
        />
      </Zone>

      {model.flowMode === "linear_flat" ? (
        <Zone title="Внутри теста" testId="structure-zone-questions">
          <QuestionsRow
            page={systemSingleton("questions")}
            countLabel={flatCountLabel(model)}
            handlers={handlers}
            testId="structure-flat-questions-row"
          />
          {/* PRD-19 FR-08a: flat tests have a single test-level «Обзор теста». */}
          <ReviewNodeRow state={reviewSlot} scope="test" page={reviewPage} handlers={handlers} testId="structure-review-slot" />
        </Zone>
      ) : (
        <SortableContext items={topicSortableIds} strategy={verticalListSortingStrategy}>
          {model.flowMode === "router_by_topics" ? (
            <InsideTestZone
              router={router}
              handlers={handlers}
              sections={model.sections}
              infoIn={infoIn}
              questionsForTopic={questionsForTopic}
              introForTopic={introForTopic}
              reviewPage={reviewPage}
              sectionResultsPage={sectionResultsPage}
              reviewSlot={reviewSlot}
              dragEnabled={Boolean(updateModel) && !handlers.readOnly}
              dimGrip={handlers.readOnly}
            />
          ) : (
            model.sections.map((section, idx) => (
              <TopicBlock
                key={section.topicId}
                index={idx + 1}
                section={section}
                intro={introForTopic(section.topicId)}
                reviewPage={reviewPage}
                sectionResultsPage={sectionResultsPage}
                before={infoIn("before_topic", section.topicId)}
                after={infoIn("after_topic", section.topicId)}
                questions={questionsForTopic(section.topicId)}
                reviewSlot={reviewSlot}
                handlers={handlers}
                dragEnabled={Boolean(updateModel) && !handlers.readOnly}
                dimGrip={handlers.readOnly}
              />
            ))
          )}
        </SortableContext>
      )}

      <Zone title="После теста" testId="structure-zone-after-test">
        <AfterTestZone results={results} afterPages={infoIn("after", null)} handlers={handlers} />
      </Zone>
    </div>
      <DragOverlay>
        {activePage ? (
          <div className="page-row dragging" data-testid="structure-drag-overlay">
            <span className="drag-handle">
              <GripVertical size={14} />
            </span>
            <span className="page-variant-badge">
              {handlers.cp.contentTemplates.find((v) => v.key === activePage.templateKey)?.label ??
                KIND_LABEL[activePage.kind] ??
                "Материал"}
            </span>
            <span className="page-title">{pageTitle(activePage)}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DropContext.Provider>
    </DndContext>
  );
}

function flatCountLabel(model: TestEditorModel): string {
  const total = model.sections.reduce((s, x) => s + x.drawCount, 0);
  const max = model.sections.reduce((s, x) => s + x.maxQuestions, 0);
  const n = model.sections.length;
  return `Единый поток: ${total} вопросов из ${max} (${n} ${n === 1 ? "тема" : "тем"})`;
}

function Zone(props: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section className="zone-block" data-testid={props.testId}>
      <div className="zone-header">
        <ChevronRight size={14} aria-hidden="true" />
        {props.title}
      </div>
      <div className="topic-body">{props.children}</div>
    </section>
  );
}

function TopicBlock(props: {
  index: number;
  section: TestEditorModel["sections"][number];
  /** PRD-1 §4.3: per-topic «Введение раздела» (kind: intro), shown FIRST. */
  intro: ContentPage | null;
  /** PRD-19: test-level «Обзор раздела» (kind: review) design binding, shown
   *  after the questions/after-zone. `null` only if the singleton is missing. */
  reviewPage: ContentPage | null;
  /** PRD-19: test-level «Итоги раздела» (kind: section-results) design binding,
   *  shown last. `null` when `showSectionResults` is OFF (node hidden). */
  sectionResultsPage: ContentPage | null;
  before: ContentPage[];
  after: ContentPage[];
  questions: ContentPage | null;
  /** PRD-19 FR-08a: «Обзор раздела» slot state (`null` = hidden, e.g. adaptive). */
  reviewSlot: "enabled" | "disabled" | null;
  handlers: ZoneHandlers;
  /** When false, no grip is rendered (read-only or test harness without updateModel). */
  dragEnabled?: boolean;
  /** Render a non-interactive dimmed grip (PRD-7 G19 read-only). */
  dimGrip?: boolean;
}) {
  const { section, dragEnabled = false } = props;
  const sortable = useSortable({ id: "topic:" + section.topicId, disabled: !dragEnabled });
  // @dnd-kit's verticalListSortingStrategy requires `transform` and `transition`
  // to be applied inline on the sortable node — they come from the hook's
  // current drag state and cannot live in static CSS. Standard library pattern.
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : undefined,
  };
  // In read-only mode (PRD-7 G19) the grip is rendered but dimmed via the
  // topic-block--readonly modifier; doing it via CSS — not removal — preserves
  // structural parity with the wireframe.
  const showGripVisually = props.section && (dragEnabled || props.dimGrip);
  return (
    <section
      ref={sortable.setNodeRef}
      style={dragStyle}
      className={"topic-block" + (props.dimGrip ? " topic-block--readonly" : "")}
      data-testid={`structure-zone-topic-${section.topicId}`}
    >
      <div className="topic-header">
        {showGripVisually && (
          <span
            className="topic-grip"
            data-testid={`structure-topic-grip-${section.topicId}`}
            aria-label={`Переместить тему «${section.topicName}»`}
            {...(dragEnabled ? sortable.attributes : {})}
            {...(dragEnabled ? sortable.listeners : {})}
          >
            <GripVertical size={14} aria-hidden="true" />
          </span>
        )}
        <span className="topic-name">
          {props.index}. {section.topicName}
        </span>
        <span className="topic-count">{section.drawCount} вопросов</span>
      </div>
      <div className="topic-body">
        {/* PRD-1 §4.3: section-level «Введение раздела» (intro node) — shown first;
            expand to edit the author instruction. Topic name/description/count/time
            render from the section at runtime. */}
        {props.intro && (
          <SystemPageRow
            page={props.intro}
            title="Введение раздела"
            icon="content"
            handlers={props.handlers}
            testId={`structure-system-intro-${section.topicId}`}
          />
        )}
        <AuthorPageGroup
          pages={props.before}
          position="before_topic"
          topicId={section.topicId}
          zoneLabel={`«${section.topicName}» — до темы`}
          handlers={props.handlers}
        />
        <QuestionsRow
          page={props.questions}
          countLabel={`${section.drawCount} вопросов темы «${section.topicName}»`}
          handlers={props.handlers}
          testId={`structure-questions-row-${section.topicId}`}
        />
        <AuthorPageGroup
          pages={props.after}
          position="after_topic"
          topicId={section.topicId}
          zoneLabel={`«${section.topicName}» — после темы`}
          handlers={props.handlers}
        />
        {/* PRD-19 FR-08a: section-level «Обзор раздела» (section-finish node) —
            design via template (variant + preview) when enabled; dimmed + comment
            when «возврат к неотвеченным» is OFF; hidden for adaptive. */}
        <ReviewNodeRow
          state={props.reviewSlot}
          scope="section"
          page={props.reviewPage}
          handlers={props.handlers}
          testId={`structure-review-slot-${section.topicId}`}
        />
        {/* PRD-19 FR-05a: section-level «Итоги раздела» (section-results node) —
            shown only when `showSectionResults` is ON; design via template. */}
        {props.sectionResultsPage && (
          <SystemPageRow
            page={props.sectionResultsPage}
            title="Итоги раздела"
            icon="section-results"
            handlers={props.handlers}
            testId={`structure-system-section-results-${section.topicId}`}
          />
        )}
      </div>
    </section>
  );
}

/**
 * PRD-19 FR-08a: «Обзор» (section-finish / test-finish) SYSTEM NODE row in the
 * structure tree. Unlike the previous informational slot, the обзор is now a
 * template-backed system node (`kind: review`), so when enabled it renders the
 * SAME system row as questions/results — with a design-variant badge,
 * «Сменить вариант» and «Предпросмотр» (PRD-19 contract §5: «Дизайн — через
 * шаблон»). States:
 *   - `enabled` (когда «возврат к неотвеченным» ВКЛ): full system row backed by
 *     the test-level `review` design binding (`page`);
 *   - `disabled` (возврат ВЫКЛ): dimmed row + comment pointing to the setting —
 *     the обзор screen does not run in strict mode, so no design actions;
 *   - `null` (adaptive): hidden entirely (skip/return impossible, FR-22).
 */
function ReviewNodeRow(props: {
  state: "enabled" | "disabled" | null;
  scope: "section" | "test";
  /** Test-level `review` design binding (singleton); may be null on legacy data
   *  not yet reconciled — then an informational accent row is shown. */
  page: ContentPage | null;
  handlers: ZoneHandlers;
  testId: string;
}) {
  if (props.state === null) return null;
  const noun = props.scope === "section" ? "раздела" : "теста";
  const finishLabel = props.scope === "section" ? "«Завершить раздел»" : "«Завершить тест»";
  const title = `Обзор ${noun} — навигация по вопросам и ${finishLabel}`;
  if (props.state === "enabled") {
    // Template-backed system node: variant badge + «Сменить вариант» + «Предпросмотр».
    if (props.page) {
      return (
        <SystemPageRow
          page={props.page}
          title={title}
          icon="review"
          handlers={props.handlers}
          testId={props.testId}
        />
      );
    }
    // Binding singleton missing (legacy test not yet reconciled) — informational.
    return (
      <div
        className="page-row page-row--system page-row--obzor"
        data-testid={props.testId}
        data-kind="review-slot"
      >
        <List className="page-icon" size={14} aria-hidden="true" />
        <span className="page-variant-badge">Обзор</span>
        <span className="page-title">{title}</span>
      </div>
    );
  }
  return (
    <>
      <div
        className="page-row page-row--system page-row--obzor page-row--disabled"
        data-testid={props.testId}
        data-kind="review-slot"
        data-disabled="true"
      >
        <Lock className="page-icon" size={14} aria-hidden="true" />
        <span className="page-variant-badge">Обзор</span>
        <span className="page-title">Обзор {noun} — недоступен</span>
      </div>
      <div className="page-comment" data-testid={`${props.testId}-comment`}>
        <Info size={13} aria-hidden="true" />
        <span>
          Экран обзора доступен только при включённом возврате к неотвеченным. Включите
          «Возврат к неотвеченным» в разделе «Настройки › Правила прохождения».
        </span>
      </div>
    </>
  );
}

/**
 * Router-mode «Внутри теста» container (PRD-7 G45). Renders the system
 * `router` page-row followed by a `.tree-branches` group with one
 * `.tree-branch` wrapper per topic — the wrapper provides the tree-connector
 * lines via CSS pseudo-elements. The topic-blocks inside reuse the same
 * sortable behaviour as in linear-by-topics so drag-reorder works in both
 * per-topic modes.
 */
function InsideTestZone(props: {
  router: ContentPage | null;
  handlers: ZoneHandlers;
  sections: TestEditorModel["sections"];
  infoIn: (position: ContentPagePosition, topicId: string | null) => ContentPage[];
  questionsForTopic: (topicId: string) => ContentPage | null;
  /** PRD-1 §4.3: per-topic «Введение раздела» resolver. */
  introForTopic: (topicId: string) => ContentPage | null;
  /** PRD-19: test-level «Обзор раздела» design binding (singleton). */
  reviewPage: ContentPage | null;
  /** PRD-19: test-level «Итоги раздела» design binding (null when hidden). */
  sectionResultsPage: ContentPage | null;
  /** PRD-19 FR-08a: «Обзор раздела» slot state (`null` = hidden, e.g. adaptive). */
  reviewSlot: "enabled" | "disabled" | null;
  dragEnabled: boolean;
  /** PRD-7 G19 read-only: dim topic grips without removing them. */
  dimGrip?: boolean;
}) {
  const { router, handlers, sections, infoIn, questionsForTopic, introForTopic, reviewPage, sectionResultsPage, reviewSlot, dragEnabled, dimGrip } = props;
  return (
    <section className="inside-test" data-testid="structure-inside-test">
      <div className="inside-test__label">
        <ChevronRight size={14} aria-hidden="true" />
        Внутри теста
      </div>
      <div className="inside-test__body">
        {router && (
          <SystemPageRow
            page={router}
            title={pageTitle(router)}
            handlers={handlers}
            icon="router"
            testId="structure-system-router"
          />
        )}
        <div className="tree-branches">
          {sections.map((section, idx) => (
            <div className="tree-branch" key={section.topicId}>
              <TopicBlock
                index={idx + 1}
                section={section}
                intro={introForTopic(section.topicId)}
                reviewPage={reviewPage}
                sectionResultsPage={sectionResultsPage}
                before={infoIn("before_topic", section.topicId)}
                after={infoIn("after_topic", section.topicId)}
                questions={questionsForTopic(section.topicId)}
                reviewSlot={reviewSlot}
                handlers={handlers}
                dragEnabled={dragEnabled}
                dimGrip={dimGrip}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The system question-stream row. Sourced from the `kind: questions`
 * content_page (so its variant + «Сменить вариант» work), with the section's
 * question count as the title. Falls back to a count-only row when the system
 * page is missing (should not happen post-reconcile).
 */
function QuestionsRow(props: {
  page: ContentPage | null;
  countLabel: string;
  handlers: ZoneHandlers;
  testId: string;
}) {
  if (!props.page) {
    return (
      <div
        className="page-row page-row--system page-row--questions"
        data-testid={props.testId}
        data-kind="questions"
      >
        <HelpCircle className="page-icon" size={14} aria-hidden="true" />
        <span className="page-variant-badge">Вопросы</span>
        <span className="page-title">{props.countLabel}</span>
      </div>
    );
  }
  return (
    <SystemPageRow
      page={props.page}
      title={props.countLabel}
      handlers={props.handlers}
      icon="questions"
      testId={props.testId}
    />
  );
}

// ─── System page row (read-only + variant switch) ───────────────────────────────

function SystemPageRow(props: {
  page: ContentPage;
  title: string;
  handlers: ZoneHandlers;
  icon?: "questions" | "router" | "content" | "review" | "section-results";
  testId: string;
}) {
  const { page, handlers } = props;
  const { cp, expandedId, setExpandedId, readOnly } = handlers;
  const variants = cp.contentTemplates.filter((v) => v.kind === page.kind);
  const variant = variants.find((v) => v.key === page.templateKey);
  const badge = variant?.label ?? KIND_LABEL[page.kind] ?? page.kind;
  const canSwitch = variants.length > 1 && !readOnly;
  // PRD-7 G21: when the active template declares NO variant of this system
  // kind, the planner falls back to the built-in `default` template. Surface
  // that to the author via a `.page-row__meta` warning tag so the choice of
  // visuals (which comes from default, not the active template) is visible.
  const usingFallback = variants.length === 0;
  // PRD-7 G27: surface unfilled required placeholders on system rows the same
  // way author rows do — page-row--error border + validation-banner in expand.
  const values = page.valuesJson?.values ?? {};
  const missing = missingRequired(variant, values);
  const hasErr = missing.length > 0;
  // PRD-22 FR-04: the page form is placeholders + settings. Counting only
  // placeholders left a variant whose fields are page PROPERTIES unexpandable —
  // that is how the start illustration («Старт: изображение справа», a `settings[]`
  // image) had nowhere to be uploaded from.
  const isExpandable =
    (variant?.placeholders.length ?? 0) + (variant?.settings?.length ?? 0) > 0;
  const expanded = isExpandable && expandedId === page.id;
  // PRD-7 G25 heuristic: an intro/summary page is "template-driven" until
  // the author has saved at least one non-empty placeholder value. Rendered
  // as `.page-row--template` with a small «шаблон» marker per wireframe
  // `s-main` linear-by-topics (lines 560-563, 649-652). The classification
  // is purely cosmetic — saving values flips it back to plain `--system`.
  const isFromTemplate =
    (page.kind === "intro" || page.kind === "summary") &&
    Object.values(values).every((v) => v === null || v === undefined || v === "");

  const Icon =
    props.icon === "router"
      ? Route
      : props.icon === "questions"
        ? HelpCircle
        : props.icon === "review"
          ? List
          : props.icon === "section-results"
            ? PieChart
            : FileText;

  return (
    <>
    <div
      className={
        "page-row " +
        (isFromTemplate ? "page-row--template" : "page-row--system") +
        (page.kind === "questions" ? " page-row--questions" : "") +
        (hasErr ? " page-row--error" : "") +
        (expanded ? " is-expanded" : "")
      }
      data-testid={props.testId}
      data-kind={page.kind}
      data-from-template={isFromTemplate ? "true" : undefined}
    >
      {isExpandable && (
        <button
          type="button"
          className="page-expand-toggle"
          aria-label={expanded ? "Свернуть" : "Развернуть"}
          aria-expanded={expanded}
          onClick={() => setExpandedId(expanded ? null : page.id)}
          data-testid={`${props.testId}-expand`}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      )}
      <Icon className="page-icon" size={14} aria-hidden="true" />
      <span className="page-variant-badge">{badge}</span>
      <span className="page-title">
        {props.title}
        {isFromTemplate && (
          <span
            className="tpl-page-marker"
            data-testid={`${props.testId}-template-marker`}
          >
            шаблон
          </span>
        )}
      </span>
      <div className="page-actions">
        {/* Предпросмотр — прямой кнопкой перед меню: смотреть страницу приходится
            чаще, чем менять её вариант, и прятать это за меню незачем. */}
        <button
          type="button"
          className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
          aria-label={`Предпросмотр системной страницы «${badge}»`}
          onClick={() => handlers.onPreview(page)}
          data-testid={`${props.testId}-preview-inline`}
        >
          <Eye size={12} aria-hidden="true" />
        </button>
        <MenuTrigger
          placement="bottom-end"
          trigger={
            <button
              type="button"
              className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
              aria-label={`Действия для системной страницы «${badge}»`}
              data-testid={`${props.testId}-actions`}
            >
              <MoreHorizontal size={12} aria-hidden="true" />
            </button>
          }
        >
          <Menu size="sm">
            <MenuItem
              disabled={!canSwitch}
              onClick={canSwitch ? () => handlers.onReplaceVariant(page) : undefined}
              data-testid={`${props.testId}-replace`}
            >
              Сменить вариант
            </MenuItem>
            <MenuItem
              onClick={() => handlers.onPreview(page)}
              data-testid={`${props.testId}-preview`}
            >
              Предпросмотр
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      {(canSwitch || usingFallback || hasErr || page.templateKeyMissing) && (
        <div className="page-row__meta">
          {hasErr && (
            <Tag tone="error" size="s" data-testid={`${props.testId}-required-tag`}>
              <AlertCircle size={12} aria-hidden="true" />
              Не заполнено обязательных полей: {missing.length}
            </Tag>
          )}
          {/* Same mark an author row carries: the tests list counts a system page
              bound to a dropped variant, so the row must show what to act on. */}
          {page.templateKeyMissing && (
            <Tag tone="warning" size="s" data-testid={`${props.testId}-missing-tag`}>
              <Info size={12} aria-hidden="true" />
              Шаблон страницы недоступен
            </Tag>
          )}
          {usingFallback && (
            <Tag tone="warning" size="s" data-testid={`${props.testId}-fallback-tag`}>
              <AlertTriangle size={12} aria-hidden="true" />
              Из стандартного шаблона
            </Tag>
          )}
          {canSwitch && (
            <Tag tone="info" size="s" data-testid={`${props.testId}-variant-hint`}>
              <Info size={12} aria-hidden="true" />
              Доступно вариантов: {variants.length}
            </Tag>
          )}
        </div>
      )}
    </div>
    {expanded && variant && (
      <PageEditForm
        page={page}
        variant={variant}
        cp={cp}
        missingLabels={missing
          .map((k) => variant.placeholders.find((ph) => ph.key === k)?.label ?? k)}
        readOnly={handlers.readOnly}
      />
    )}
    </>
  );
}

// ─── Author page group (info pages + insert-rows + DnD) ─────────────────────────

function AuthorPageGroup(props: {
  pages: ContentPage[];
  position: ContentPagePosition;
  topicId: string | null;
  zoneLabel: string;
  handlers: ZoneHandlers;
}) {
  const { pages, position, topicId, zoneLabel, handlers } = props;

  const insert = (index: number) =>
    handlers.onAdd({ position, topicId, group: pages, index, zoneLabel });

  const slug = `${position}-${topicId ?? "test"}`;
  // Zone-level droppable so a page can be dropped INTO this zone — including an
  // empty one with no rows to hover. Highlights when it is the active drop
  // target (pointer over the zone's gap, not over a specific row).
  const { setNodeRef, isOver } = useDroppable({ id: zoneDroppableId(position, topicId) });

  return (
    <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={"structure-drop-zone" + (isOver ? " is-zone-drop-target" : "")}
        data-testid={`structure-dropzone-${slug}`}
      >
        {!handlers.readOnly && (
          <InsertRow onClick={() => insert(0)} testId={`structure-insert-${slug}-0`} />
        )}
        {pages.map((page, idx) => (
          <Fragment key={page.id}>
            <SortablePageItem page={page} handlers={handlers} />
            {!handlers.readOnly && (
              <InsertRow onClick={() => insert(idx + 1)} testId={`structure-insert-${slug}-${idx + 1}`} />
            )}
          </Fragment>
        ))}
      </div>
    </SortableContext>
  );
}

/**
 * The «После теста» zone. Unlike other zones it interleaves the system `summary`
 * («Итоги») row among the author `after` pages by sortOrder: pages BEFORE «Итоги»
 * are pre-results (shown before the results screen), pages AFTER are post-results
 * — matching the content-flow runtime, which uses the summary's sortOrder as the
 * boundary. Inserts appear in every gap, including before «Итоги». Add/reorder
 * renumber the WHOLE combined list (incl. «Итоги») so the boundary stays stable.
 */
function AfterTestZone(props: {
  results: ContentPage | null;
  afterPages: ContentPage[];
  handlers: ZoneHandlers;
}) {
  const { results, afterPages, handlers } = props;
  // Droppable (for dropping into an empty after-zone / its gap) but WITHOUT the
  // zone-wide dashed outline: this zone wraps «Итоги» + pages, so a full-zone
  // outline covered everything. The «Итоги» row and page rows give the precise
  // drop indicator instead.
  const { setNodeRef } = useDroppable({ id: zoneDroppableId("after", null) });
  const combined: ContentPage[] = results
    ? [...afterPages, results].sort((a, b) => a.sortOrder - b.sortOrder)
    : afterPages;
  // Insert at combined-position `index`: the modal renumbers `group` (incl. the
  // results row) so the new page and «Итоги теста» keep a stable pre/post order.
  const addAt = (index: number) =>
    handlers.onAdd({ position: "after", topicId: null, group: combined, index, zoneLabel: "После теста" });

  return (
    <SortableContext items={afterPages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className="structure-drop-zone"
        data-testid="structure-dropzone-after-test"
      >
        {!handlers.readOnly && (
          <InsertRow onClick={() => addAt(0)} testId="structure-insert-after-test-0" />
        )}
        {combined.map((item, idx) => (
          <Fragment key={item.id}>
            {item.kind === "results" ? (
              <SystemDropRow page={item} handlers={handlers} />
            ) : (
              <SortablePageItem page={item} handlers={handlers} />
            )}
            {!handlers.readOnly && (
              <InsertRow onClick={() => addAt(idx + 1)} testId={`structure-insert-after-test-${idx + 1}`} />
            )}
          </Fragment>
        ))}
      </div>
    </SortableContext>
  );
}

/**
 * One sortable author-page row. The surrounding «+ Добавить» insert-rows are
 * rendered by the parent group/zone (so the summary can be interleaved between
 * pages with inserts on both sides). Rows do NOT shift while dragging — the drop
 * position is shown by an insertion line driven by {@link DropContext}.
 */
function SortablePageItem(props: { page: ContentPage; handlers: ZoneHandlers }) {
  const { page, handlers } = props;
  const sortable = useSortable({ id: page.id, disabled: handlers.readOnly });
  const { attributes, listeners, setNodeRef, isDragging } = sortable;
  const drop = useContext(DropContext);
  const dropCls = drop && drop.overId === page.id && !isDragging ? ` drop-${drop.side}` : "";
  return (
    <div
      ref={setNodeRef}
      className={"structure-sortable-item" + dropCls}
      data-testid={`structure-sortable-${page.id}`}
    >
      <AuthorPageRow
        page={page}
        cp={handlers.cp}
        expanded={handlers.expandedId === page.id}
        onToggleExpand={() =>
          handlers.setExpandedId(handlers.expandedId === page.id ? null : page.id)
        }
        dragHandleProps={handlers.readOnly ? {} : { ...attributes, ...listeners }}
        isDragging={isDragging}
        readOnly={handlers.readOnly}
        onReplaceVariant={handlers.onReplaceVariant}
        onPreview={handlers.onPreview}
      />
    </div>
  );
}

/**
 * A system row («Итоги теста») rendered inside «После теста» as a non-draggable
 * drop boundary: a page dragged onto it lands before (pre-results) or after
 * (post-results) by the combined-list index. Shows the same insertion line as
 * author rows. Test id follows the row kind (`structure-system-results`).
 */
function SystemDropRow(props: { page: ContentPage; handlers: ZoneHandlers }) {
  const { page, handlers } = props;
  const { setNodeRef } = useDroppable({ id: page.id });
  const drop = useContext(DropContext);
  const dropCls = drop && drop.overId === page.id ? ` drop-${drop.side}` : "";
  return (
    <div ref={setNodeRef} className={"structure-sortable-item" + dropCls}>
      <SystemPageRow
        page={page}
        title={pageTitle(page)}
        handlers={handlers}
        testId={`structure-system-${page.kind}`}
      />
    </div>
  );
}

function InsertRow(props: { onClick: () => void; testId: string }) {
  return (
    <div className="insert-row">
      <div className="insert-row-line" aria-hidden="true" />
      <button type="button" className="insert-btn" onClick={props.onClick} data-testid={props.testId}>
        <Plus size={12} aria-hidden="true" /> Добавить страницу
      </button>
      <div className="insert-row-line" aria-hidden="true" />
    </div>
  );
}

// ─── Author page row (editable) ─────────────────────────────────────────────────

function AuthorPageRow(props: {
  page: ContentPage;
  cp: UseContentPagesResult;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Spread on the grip handle: @dnd-kit `attributes` + `listeners`. */
  dragHandleProps: Record<string, unknown>;
  isDragging: boolean;
  /** Render without authoring affordances (PRD-7 G19): grip dimmed, no menu. */
  readOnly: boolean;
  /** PRD-7 G17: opens ReplaceVariantModal for this page. */
  onReplaceVariant: (page: ContentPage) => void;
  /** PRD-7 G17 / FR-44: opens PagePreviewModal for this page. */
  onPreview: (page: ContentPage) => void;
}) {
  const { page, cp } = props;
  const [confirming, setConfirming] = useState(false);

  const variant = cp.contentTemplates.find((v) => v.key === page.templateKey);
  const values = page.valuesJson?.values ?? {};
  const missing = missingRequired(variant, values);
  // Required-empty is an error (red, blocks Save); a missing template variant
  // is only a warning (yellow, does not block — the page still exports as the
  // persisted variant or falls back at runtime).
  const hasErr = missing.length > 0;
  const hasWarn = page.templateKeyMissing === true;

  // PRD-7 G17: «Сменить вариант» + the «Доступно вариантов: N» hint are shown
  // only when the active template offers more than one variant of this page's
  // kind — the SAME rule the system row uses (`canSwitch`), so every page type
  // surfaces variant availability consistently.
  const variantsForKind = cp.contentTemplates.filter((v) => v.kind === page.kind);
  const showVariantHint = variantsForKind.length > 1;
  // Plan Э5: a page whose variant is unavailable must be mappable even when the
  // template offers a single one — otherwise the only page that NEEDS the dialog
  // is the one page that cannot open it.
  const canReplaceVariant =
    !props.readOnly && (showVariantHint || (hasWarn && variantsForKind.length > 0));

  const title = pageTitle(page);
  const badge = variant?.label ?? KIND_LABEL[page.kind] ?? page.kind;

  return (
    <>
      <div
        className={
          "page-row" +
          (hasErr ? " page-row--error" : hasWarn ? " page-row--warn" : "") +
          (props.expanded ? " is-expanded" : "") +
          (props.isDragging ? " dragging" : "") +
          (props.readOnly ? " page-row--readonly" : "")
        }
        data-testid={`structure-page-row-${page.id}`}
      >
        <span
          className="drag-handle"
          data-testid={`structure-page-grip-${page.id}`}
          aria-label={`Переместить страницу «${title}»`}
          {...props.dragHandleProps}
        >
          <GripVertical size={14} aria-hidden="true" />
        </span>
        <button
          type="button"
          className="page-expand-toggle"
          aria-expanded={props.expanded ? "true" : "false"}
          aria-label={props.expanded ? "Свернуть" : "Развернуть"}
          onClick={props.onToggleExpand}
          data-testid={`structure-page-expand-${page.id}`}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <span className="page-variant-badge">{badge}</span>
        <span className="page-title">{title}</span>
        <div className="page-actions">
          {/* Предпросмотр — прямой кнопкой перед меню. Показывается и в
              опубликованном тесте: смотреть страницу можно всегда, это ничего не
              меняет, а меню действий там скрыто целиком. */}
          {!confirming && (
            <button
              type="button"
              className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
              aria-label={`Предпросмотр страницы ${title}`}
              onClick={() => props.onPreview(page)}
              data-testid={`structure-page-preview-inline-${page.id}`}
            >
              <Eye size={12} aria-hidden="true" />
            </button>
          )}
          {props.readOnly ? null : !confirming ? (
            <MenuTrigger
              placement="bottom-end"
              trigger={
                <button
                  type="button"
                  className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
                  aria-label={`Действия для страницы ${title}`}
                  data-testid={`structure-page-actions-${page.id}`}
                >
                  <MoreHorizontal size={12} aria-hidden="true" />
                </button>
              }
            >
              <Menu size="sm">
                {canReplaceVariant && (
                  <MenuItem
                    onClick={() => props.onReplaceVariant(page)}
                    data-testid={`structure-page-replace-${page.id}`}
                  >
                    Сменить вариант…
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => props.onPreview(page)}
                  data-testid={`structure-page-preview-${page.id}`}
                >
                  Предпросмотр
                </MenuItem>
                <MenuItem
                  danger
                  onClick={() => setConfirming(true)}
                  data-testid={`structure-page-delete-${page.id}`}
                >
                  Удалить
                </MenuItem>
              </Menu>
            </MenuTrigger>
          ) : (
            <>
              <span className="page-row__delete-confirm-label">Удалить?</span>
              <Button
                variant="secondary"
                size="s"
                onClick={() => setConfirming(false)}
                data-testid={`structure-page-delete-cancel-${page.id}`}
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                size="s"
                onClick={() => {
                  cp.remove(page.id)
                    .then(() => setConfirming(false))
                    .catch(() => setConfirming(false));
                }}
                disabled={cp.isRemoving}
                loading={cp.isRemoving}
                data-testid={`structure-page-delete-confirm-${page.id}`}
              >
                {cp.isRemoving ? "Удаляем…" : "Удалить"}
              </Button>
            </>
          )}
        </div>
        {(hasErr || hasWarn || canReplaceVariant) && (
          <div className="page-row__meta">
            {page.templateKeyMissing && (
              <Tag tone="warning" size="s" data-testid={`structure-page-missing-${page.id}`}>
                <Info size={12} aria-hidden="true" />
                Шаблон страницы недоступен
              </Tag>
            )}
            {missing.length > 0 && (
              <Tag tone="error" size="s" data-testid={`structure-page-required-${page.id}`}>
                <AlertCircle size={12} aria-hidden="true" />
                Не заполнено обязательных полей: {missing.length}
              </Tag>
            )}
            {/* Same variant-availability hint as the system row, so author info
                pages also surface that «Сменить вариант» (in the «...» menu) exists. */}
            {showVariantHint && (
              <Tag tone="info" size="s" data-testid={`structure-page-${page.id}-variant-hint`}>
                <Info size={12} aria-hidden="true" />
                Доступно вариантов: {variantsForKind.length}
              </Tag>
            )}
          </div>
        )}
      </div>

      {props.expanded && (
        <PageEditForm
          page={page}
          variant={variant}
          cp={cp}
          readOnly={props.readOnly}
        />
      )}
    </>
  );
}

// ─── Inline edit form ────────────────────────────────────────────────────────────

function PageEditForm(props: {
  page: ContentPage;
  variant: ContentTemplateVariant | undefined;
  cp: UseContentPagesResult;
  /**
   * Labels of currently-empty required placeholders. When non-empty, renders
   * the PRD-7 G27 validation banner at the top of the expand (red banner with
   * a bulleted list). Required-empty pages also block the drawer's «Сохранить»
   * (via `hasStructureErrors`).
   */
  missingLabels?: string[];
  /** When true, fields are disabled (published / snapshot view). */
  readOnly?: boolean;
}) {
  const { page, variant, cp } = props;
  const missingLabels = props.missingLabels ?? [];
  const hasErr = missingLabels.length > 0;
  const readOnly = Boolean(props.readOnly);

  // Single-save model: the form has no local buffer and no «Сохранить»/«Отмена» of
  // its own. Every edit is written STRAIGHT into the «Структура» draft (the same
  // draft the composition/settings tabs use), so an edit can never be lost by
  // forgetting a second button and the row does not collapse on typing. The drawer
  // footer «Сохранить» commits the draft; the drawer «Отмена» discards it. Values
  // are therefore read from the draft page each render, not from local state.
  const values = (page.valuesJson?.values ?? {}) as Record<string, unknown>;
  const styles = (page.valuesJson?.placeholderStyles ?? {}) as Record<string, { fontSize?: number }>;
  const settings = (page.settingsJson ?? {}) as Record<string, unknown>;

  const writeValues = (nextValues: Record<string, unknown>, nextStyles: Record<string, { fontSize?: number }>) => {
    if (readOnly) return;
    void cp.update(page.id, { valuesJson: { values: nextValues, placeholderStyles: nextStyles } });
  };
  const setValue = (key: string, v: unknown) => writeValues({ ...values, [key]: v }, styles);
  const setStyle = (key: string, s: { fontSize?: number }) => writeValues(values, { ...styles, [key]: s });
  // PRD-22: page PROPERTIES are edited alongside content but stored separately, so
  // they go to the draft through their own field.
  const setSetting = (key: string, v: unknown) => {
    if (readOnly) return;
    void cp.updateSettings(page.id, { ...settings, [key]: v });
  };

  const placeholders: ContentTemplatePlaceholder[] =
    page.mode === "html"
      ? [{ key: "__html", type: "html", label: "HTML-содержимое" }]
      : variant?.placeholders ?? [];

  // PRD-7 S13.4-G18: when the last successful save stripped placeholder HTML,
  // show an in-form warning banner listing exactly what the server removed.
  // The banner clears automatically on the next save with no removals (the
  // hook drops the entry from `cp.sanitizeDiagnostics`) or via explicit
  // dismiss. Keyed-by-pageId so unrelated pages do not flash this banner.
  const sanitizeDiag = cp.sanitizeDiagnostics[page.id];

  return (
    <div className="page-row-expand" data-testid={`structure-page-edit-${page.id}`}>
      {!variant && page.mode === "template" && (
        <Banner
          tone="warning"
          size="sm"
          description="Вариант страницы недоступен в текущем шаблоне. Выберите другой шаблон оформления или пересоздайте страницу."
          data-testid={`structure-page-edit-no-variant-${page.id}`}
        />
      )}
      {sanitizeDiag && (
        <SanitizeBanner
          diagnostics={sanitizeDiag}
          fieldLabel={(phKey) => variant?.placeholders.find((p) => p.key === phKey)?.label ?? phKey}
          onDismiss={() => cp.dismissSanitizeDiagnostics(page.id)}
          testId={`structure-page-edit-sanitize-${page.id}`}
          dismissTestId={`structure-page-edit-sanitize-dismiss-${page.id}`}
        />
      )}
      {hasErr && (
        <div
          className="validation-banner"
          role="alert"
          data-testid={`structure-page-edit-validation-${page.id}`}
        >
          <span className="validation-banner__ico" aria-hidden="true">
            <AlertCircle size={14} />
          </span>
          <div className="validation-banner__body">
            <div className="validation-banner__title">Заполните обязательные поля</div>
            <ul className="validation-banner__list">
              {missingLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <fieldset
        disabled={readOnly}
        className="page-row-expand__fields"
        data-testid={`structure-page-edit-fields-${page.id}`}
      >
        {placeholders.map((ph) => (
          <div className="ou-formfield" key={ph.key}>
            <PlaceholderControl
              placeholder={ph}
              value={values[ph.key]}
              style={styles[ph.key]}
              onChange={(v) => setValue(ph.key, v)}
              onStyleChange={(s) => setStyle(ph.key, s)}
              testId={`structure-page-field-${page.id}-${ph.key}`}
            />
          </div>
        ))}
        {/* PRD-22: page properties follow the content fields in the same list —
            the form layout does not change, only its contents. */}
        {(variant?.settings ?? []).map((st) => (
          <div className="ou-formfield" key={`setting-${st.key}`}>
            <SettingControl
              setting={st}
              value={settings[st.key]}
              onChange={(v) => setSetting(st.key, v)}
              sequenceIds={cp.sequenceIds}
              sequenceTotal={cp.sequencePlacements.get(page.id)?.total ?? 0}
              testId={`structure-page-setting-${page.id}-${st.key}`}
            />
          </div>
        ))}
      </fieldset>
      {/* No per-form «Сохранить»/«Отмена»: edits are already in the draft (see
          above). The row collapses via the header chevron; the single save is the
          drawer footer «Сохранить». */}
    </div>
  );
}

// ─── Placeholder control (ui-kit) ────────────────────────────────────────────────

function PlaceholderControl(props: {
  placeholder: ContentTemplatePlaceholder;
  value: unknown;
  style?: { fontSize?: number };
  onChange: (value: unknown) => void;
  onStyleChange: (style: { fontSize?: number }) => void;
  testId: string;
}) {
  const { placeholder: ph, value, onChange, testId } = props;
  const label = ph.label + (ph.required ? " *" : "");

  // PRD-22 FR-10: content types come from the closed registry and every one of
  // them is handled here. The former `default` branch silently turned an unknown
  // type into a single-line input; now an unknown type is a template error caught
  // at upload, and a page that still carries one shows a diagnostic instead.
  if (!isPlaceholderType(ph.type)) {
    return (
      <div className="ou-formfield" data-testid={testId}>
        <span className="ou-formfield__lbl">{ph.label}</span>
        <Banner
          tone="warning"
          size="sm"
          description={`Тип поля «${ph.type}» не поддерживается. Сохранённое значение не изменяется и остаётся в тесте.`}
          data-testid={`${testId}-unknown-type`}
        />
      </div>
    );
  }

  switch (ph.type) {
    case "textarea":
    case "richText":
    case "html":
      // PRD-22 FR-32/33: the declared type is the CEILING of what the author may
      // enter; within it they pick the mode. Formatted mode shows the result, not
      // the markup, and pasted fragments are normalised on arrival (FR-34), so a
      // save error can only come from HTML the author typed themselves.
      //
      // Normalisation includes confining a pasted `<style>` to this field's own
      // region — the SAME scope the server applies on save and on package build,
      // so the author sees the final CSS immediately instead of discovering in the
      // package that their `body { … }` rule restyled the player.
      return (
        <RichTextEditor
          label={label}
          value={(value as string) || ""}
          onChange={(next) => onChange(next)}
          modes={inputModesFor(ph.type) as RichTextMode[]}
          sanitize={(html) => sanitizeContentHtml(html, { scope: placeholderScope(ph.key) })}
          rows={ph.type === "html" ? 6 : 5}
          fullWidth
          data-testid={testId}
        />
      );
    case "image":
      return <ImagePlaceholderControl label={label} value={value} onChange={onChange} testId={testId} />;
    case "resultField":
    case "text":
      return (
        <Input
          label={label}
          size="m"
          fullWidth
          value={typeof value === "string" ? value : value == null ? "" : String(value)}
          maxLength={ph.maxLength}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
        />
      );
  }
}

/**
 * Control for one page PROPERTY (`settings[]`, PRD-22). Property types are their
 * own closed registry — `number` / `boolean` / `select` live here rather than
 * among placeholders, because they configure the page instead of filling the
 * layout. `sequence` gets the identifier picker.
 */
export function SettingControl(props: {
  setting: ContentTemplateSetting;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Identifiers already used in the test — choices for the `sequence` type. */
  sequenceIds: string[];
  /** Size of the run this page currently belongs to (0 = not in a sequence). */
  sequenceTotal: number;
  testId: string;
}) {
  const { setting: st, value, onChange, testId } = props;
  const label = (st.label ?? st.key) + (st.required ? " *" : "");

  if (!isSettingType(st.type)) {
    return (
      <div className="ou-formfield" data-testid={testId}>
        <span className="ou-formfield__lbl">{st.label ?? st.key}</span>
        <Banner
          tone="warning"
          size="sm"
          description={`Тип свойства «${st.type}» не поддерживается. Сохранённое значение не изменяется и остаётся в тесте.`}
          data-testid={`${testId}-unknown-type`}
        />
      </div>
    );
  }

  switch (st.type) {
    case "sequence":
      return (
        <SequenceSettingControl
          label={label}
          value={typeof value === "string" ? value : ""}
          onChange={(next) => onChange(next)}
          sequenceIds={props.sequenceIds}
          total={props.sequenceTotal}
          testId={testId}
        />
      );
    case "number":
      return (
        <NumberInput
          label={label}
          value={typeof value === "number" ? value : 0}
          onChange={(v) => onChange(v)}
          fullWidth
          data-testid={testId}
        />
      );
    case "boolean":
      return (
        <Switch
          label={label}
          // The manifest may explain WHEN a switch has an effect — «Радар компетенций»
          // is drawn only from three visible scales up (PRD-35 §6), and without the
          // description an author whose test has two sees a switch that does nothing
          // and no reason why. The report card already shows it; the structure did not.
          description={st.description}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={testId}
        />
      );
    case "select":
      return (
        <Select<string>
          label={label}
          size="m"
          fullWidth
          value={(value as string) || ""}
          options={(st.options ?? []).map((o) => ({ value: o, label: st.optionLabels?.[o] ?? o }))}
          onChange={(next) => onChange(next)}
          data-testid={testId}
        />
      );
    case "image":
      return <ImagePlaceholderControl label={label} value={value} onChange={onChange} testId={testId} />;
    case "text":
      return (
        <Input
          label={label}
          size="m"
          fullWidth
          value={typeof value === "string" ? value : value == null ? "" : String(value)}
          placeholder={typeof st.default === "string" ? st.default : undefined}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
        />
      );
  }
}

/**
 * The sequence identifier: chosen from what the test already uses, or created.
 * Free text was rejected on purpose — a typo (`Галерея` / `Галерея `) silently
 * splits the run in two and the author sees broken dots with no cause. The hint
 * reports the size of the current run, including the «одна страница» state where
 * no indicator is drawn yet (FR-19).
 */
function SequenceSettingControl(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  sequenceIds: string[];
  total: number;
  testId: string;
}) {
  const { value, onChange, sequenceIds, total, testId } = props;
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const ids = new Set(sequenceIds);
    if (value) ids.add(value);
    return Array.from(ids).map((id) => ({ value: id, label: id }));
  }, [sequenceIds, value]);

  const trimmed = query.trim();
  const canCreate = trimmed.length > 0 && !options.some((o) => o.value === trimmed);

  const hint = !value
    ? "Пусто — страница не входит в последовательность."
    : total >= 2
      ? `Подряд идущих страниц: ${total} — точки показываются`
      : "В последовательности 1 страница — точки не показываются. Добавьте рядом ещё одну страницу с тем же значением.";

  return (
    <Combobox<string>
      label={props.label}
      value={value || null}
      options={options}
      query={query}
      onQueryChange={setQuery}
      onChange={(next) => onChange(next ?? "")}
      placeholder="Не задана"
      hint={hint}
      fullWidth
      emptyMessage="Пока нет последовательностей"
      footerAction={
        canCreate ? (
          <button
            type="button"
            className="ou-combo__footer-action"
            onClick={() => {
              onChange(trimmed);
              setQuery("");
            }}
            data-testid={`${testId}-create`}
          >
            + Создать «{trimmed}»
          </button>
        ) : undefined
      }
      data-testid={testId}
    />
  );
}

/** Best-effort human file name from an uploaded media URL (`/uploads/media/...`). */
function imageNameFromUrl(url: string): string {
  try {
    const clean = url.split("?")[0].split("#")[0];
    const seg = clean.substring(clean.lastIndexOf("/") + 1);
    return decodeURIComponent(seg) || "изображение";
  } catch {
    return "изображение";
  }
}

/**
 * Upload control for `image`-typed page placeholders (PRD-1 content pages). Mirrors
 * the «Оформление» {@link MediaParamRow} (hidden file input behind a DS Button +
 * a filename chip with remove), but stores a PLAIN URL string — the unified
 * renderer emits `String(value)` for image placeholders
 * ({@link module:shared/template/render-screen}), so the design-section media
 * ENVELOPE (`{ url, name, ... }`) would render as `[object Object]`. Upload goes
 * through `POST /api/media/upload` (multer disk storage), the same endpoint the
 * design tab uses.
 */
function ImagePlaceholderControl(props: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  testId: string;
}) {
  const { value, onChange, testId } = props;
  const fieldId = useId();
  // Image placeholders store a PLAIN URL string. Be tolerant of a legacy media
  // envelope `{ url, name }` (e.g. copied from «Оформление» params, imported, or
  // hand-edited): surface its `.url` so the field isn't shown as empty, and heal
  // it on mount so the stray object never survives to render as `[object Object]`.
  const url =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string"
        ? (value as { url: string }).url
        : "";
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxSizeKb = 512;

  useEffect(() => {
    // Normalise a non-string value once, on mount (no-op for the common string case).
    if (typeof value !== "string") onChange(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > maxSizeKb * 1024) {
      setError(`Файл превышает ${maxSizeKb} КБ.`);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const res = await fetch("/api/media/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { url: string; originalName?: string };
      setUploadedName(body.originalName ?? null);
      onChange(body.url);
    } catch (err) {
      setError((err as Error)?.message ?? "Не удалось загрузить изображение");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="ou-formfield" data-testid={testId}>
      <label className="ou-formfield__lbl" htmlFor={fieldId}>
        {props.label}
      </label>
      <div className="design-media-row">
        {/* PRD-22: a thumbnail of what is actually loaded. The file name alone
            told the author nothing — least of all for a background image. */}
        <span
          className="image-field__preview"
          style={url ? { backgroundImage: `url("${url.replace(/"/g, "%22")}")` } : undefined}
          role={url ? "img" : undefined}
          aria-label={url ? "Предпросмотр изображения" : undefined}
          aria-hidden={url ? undefined : true}
          data-testid={`${testId}-preview`}
        />
        <Button
          id={fieldId}
          variant="secondary"
          size="s"
          leadingIcon={<Upload width={12} height={12} aria-hidden="true" />}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          loading={uploading}
          data-testid={`${testId}-upload`}
        >
          {uploading ? "Загрузка…" : url ? "Заменить изображение" : "Загрузить изображение"}
        </Button>
        {url && (
          <span className="design-media-chip" data-testid={`${testId}-chip`}>
            <ImageIcon className="design-media-chip__ico" width={14} height={14} aria-hidden="true" />
            <span className="design-media-chip__name">{uploadedName || imageNameFromUrl(url)}</span>
            <IconButton
              icon={<X width={12} height={12} aria-hidden="true" />}
              aria-label="Удалить изображение"
              variant="ghost"
              size="s"
              onClick={() => onChange("")}
              data-testid={`${testId}-remove`}
            />
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          style={{ display: "none" }}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
          data-testid={`${testId}-file`}
        />
      </div>
      <div className="ou-formfield__desc">PNG, JPEG, SVG или WebP; до {maxSizeKb} КБ.</div>
      {error && <Banner tone="error" size="sm" description={error} data-testid={`${testId}-error`} />}
    </div>
  );
}

// ─── Add page modal (variant picker) ─────────────────────────────────────────────

type AddOption =
  | { kind: "template"; key: string; label: string; description?: string; templateKey: string }
  | { kind: "html"; key: string; label: string; description?: string };

function AddPageModal(props: {
  ctx: AddContext | null;
  cp: UseContentPagesResult;
  designDraft?: { templateId: string; params?: Record<string, unknown> };
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { ctx, cp } = props;
  const options = useMemo<AddOption[]>(() => {
    const fromVariants: AddOption[] = cp.infoVariants.map((v) => ({
      kind: "template",
      key: `tpl:${v.key}`,
      label: v.label,
      description: v.description,
      templateKey: v.key,
    }));
    return [
      ...fromVariants,
      {
        kind: "html",
        key: "html",
        label: "Произвольный HTML",
        description: "HTML-разметка для нестандартных сценариев.",
      },
    ];
  }, [cp.infoVariants]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const open = ctx !== null;
  // PRD-7 S13.7-G16: case-insensitive filter over label + description, identical
  // to the ReplaceVariantModal search (S13.6-G28) so the two modals stay
  // visually and behaviourally consistent.
  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return options;
    return options.filter((o) =>
      `${o.label} ${o.description ?? ""}`.toLowerCase().includes(q),
    );
  }, [options, query]);
  const effectiveKey = selectedKey ?? filteredOptions[0]?.key ?? null;

  const handleAdd = () => {
    if (!ctx) return;
    const option = options.find((o) => o.key === effectiveKey);
    if (!option) return;
    const mode: ContentPageMode = option.kind === "html" ? "html" : "template";
    void cp
      .create({
        position: ctx.position,
        topicId: ctx.topicId,
        mode,
        type: "info",
        templateKey: option.kind === "template" ? option.templateKey : null,
        sortOrder: ctx.index,
        valuesJson: { values: {} },
      })
      .then((created) => {
        const ids = ctx.group.map((p) => p.id);
        ids.splice(ctx.index, 0, created.id);
        if (ids.length > 1) {
          void cp.reorder(ids.map((id, i) => ({ id, sortOrder: i })));
        }
        setSelectedKey(null);
        props.onCreated(created.id);
      })
      .catch(() => {
        /* error surfaced via cp.mutationError banner */
      });
  };

  return (
    <ModalDialog
      open={open}
      onClose={() => {
        setSelectedKey(null);
        setQuery("");
        props.onClose();
      }}
      size="xl"
      title="Добавить страницу"
      description={ctx ? `Выберите вариант для зоны «${ctx.zoneLabel}».` : undefined}
      footer={
        <>
          <Button
            variant="ghost"
            size="m"
            onClick={() => {
              setSelectedKey(null);
              setQuery("");
              props.onClose();
            }}
            data-testid="structure-add-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            size="m"
            onClick={handleAdd}
            disabled={cp.isCreating || !effectiveKey}
            loading={cp.isCreating}
            data-testid="structure-add-confirm"
          >
            {cp.isCreating ? "Добавление…" : "Добавить"}
          </Button>
        </>
      }
      data-testid="structure-add-modal"
    >
      {options.length > 3 && (
        <div className="variant-search">
          <Search
            width={14}
            height={14}
            className="variant-search__icon"
            aria-hidden="true"
          />
          <input
            type="search"
            className="variant-search__input"
            placeholder="Поиск по названию варианта…"
            aria-label="Поиск вариантов"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="structure-add-search"
          />
        </div>
      )}
      {filteredOptions.length === 0 ? (
        <div className="variant-search__empty" data-testid="structure-add-empty">
          Ничего не найдено
        </div>
      ) : (
        <VariantPreviewPicker
          options={filteredOptions.map((o) => {
            const v = o.kind === "template" ? cp.infoVariants.find((iv) => iv.key === o.templateKey) : undefined;
            return {
              key: o.key,
              label: o.label,
              description: o.description,
              variantKey: v?.key,
              kind: v?.kind,
              pageKind: v?.pageKind,
            };
          })}
          selectedKey={effectiveKey}
          onSelect={setSelectedKey}
          testIdPrefix="structure-add-option"
          templateId={props.designDraft?.templateId ?? "default"}
          params={props.designDraft?.params ?? {}}
          open={open}
        />
      )}
    </ModalDialog>
  );
}

// ─── Replace-variant modal (system pages, FR-46) ─────────────────────────────────

/**
 * Renders a single placeholder value as a short, readable string for the
 * diff-block list. HTML tags are stripped (richText fields), arrays/objects
 * are JSON-stringified, very long strings are truncated to 60 chars.
 */
function describePlaceholderValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "(пусто)";
  if (typeof raw === "string") {
    const stripped = raw.replace(/<[^>]+>/g, "").trim();
    if (stripped === "") return "(пусто)";
    return stripped.length > 60 ? `${stripped.slice(0, 60)}…` : stripped;
  }
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  try {
    const s = JSON.stringify(raw);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  } catch {
    return "(составное значение)";
  }
}

/** True for "non-empty" placeholder values - mirrors `isPlaceholderEmpty` in use-content-pages. */
function hasPlaceholderValue(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "string") return raw.trim() !== "";
  return true;
}

function ReplaceVariantModal(props: {
  ctx: ReplaceContext | null;
  cp: UseContentPagesResult;
  designDraft?: { templateId: string; params?: Record<string, unknown> };
  onClose: () => void;
}) {
  const { ctx, cp } = props;
  const page = ctx?.page ?? null;
  const variants = useMemo(
    () => (page ? cp.contentTemplates.filter((v) => v.kind === page.kind) : []),
    [cp.contentTemplates, page],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Reset transient state when the modal opens for a new page.
  useEffect(() => {
    if (page) {
      setSelectedKey(null);
      setQuery("");
    }
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentVariant = useMemo(
    () => variants.find((v) => v.key === page?.templateKey) ?? null,
    [variants, page?.templateKey],
  );
  // Plan Э5: when the page's own variant is unavailable, the modal opens on the
  // FIRST offered one (the substitute the learner hosts already render through)
  // instead of on a key that is not in the list — which left «Применить» disabled
  // and the page unmappable, the exact case the modal exists for.
  const effectiveKey = selectedKey ?? currentVariant?.key ?? variants[0]?.key ?? null;
  const selectedVariant = useMemo(
    () => variants.find((v) => v.key === effectiveKey) ?? null,
    [variants, effectiveKey],
  );

  // PRD-7 S13.6-G28: compute the set of current placeholder values that will
  // be lost when switching variants. Contract (PRD-1 §4.3.3): placeholder key
  // is the bridge between variants of the same kind - identical keys carry
  // their value forward, missing keys are dropped. We surface only the lost
  // ones in the warning diff-block; preserved values are shown silently in
  // the page expand after the switch.
  const lostFields = useMemo(() => {
    if (!page || !selectedVariant) return [];
    if (selectedVariant.key === page.templateKey) return [];
    const newKeys = new Set(selectedVariant.placeholders.map((p) => p.key));
    const currentValues = (page.valuesJson?.values ?? {}) as Record<string, unknown>;
    // Normally the fields at risk are those the CURRENT variant declares. When that
    // variant is unavailable (plan Э5) its declaration is unreachable, so the stored
    // values themselves are the source — otherwise the author would be asked to
    // confirm a switch whose losses could not be listed at all.
    const declared = currentVariant
      ? currentVariant.placeholders.map((ph) => ({ key: ph.key, label: ph.label ?? ph.key }))
      : Object.keys(currentValues).map((key) => ({ key, label: key }));
    return declared
      .filter((ph) => !newKeys.has(ph.key))
      .map((ph) => ({ ...ph, value: currentValues[ph.key] }))
      .filter((f) => hasPlaceholderValue(f.value));
  }, [page, currentVariant, selectedVariant]);

  // s-replace-no-fields (G29): the new variant declares zero placeholders -
  // the page becomes purely template-driven and any current values are lost.
  const isNoFields =
    selectedVariant !== null &&
    selectedVariant.placeholders.length === 0 &&
    selectedVariant.key !== page?.templateKey;

  // Filter variants by search query (case-insensitive, matches label OR description).
  const filteredVariants = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return variants;
    return variants.filter((v) => {
      const haystack = `${v.label} ${v.description ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [variants, query]);

  const handleApply = () => {
    if (!page || !effectiveKey || effectiveKey === page.templateKey) return;
    void cp
      .replaceVariant(page.id, effectiveKey)
      .then(() => {
        setSelectedKey(null);
        setQuery("");
        props.onClose();
      })
      .catch(() => {
        /* error surfaced via cp.mutationError banner */
      });
  };

  return (
    <ModalDialog
      open={page !== null}
      onClose={() => {
        setSelectedKey(null);
        setQuery("");
        props.onClose();
      }}
      size="xl"
      title="Сменить вариант страницы"
      description={page ? `Системная страница «${KIND_LABEL[page.kind] ?? page.kind}».` : undefined}
      footer={
        <>
          <Button
            variant="ghost"
            size="m"
            onClick={() => {
              setSelectedKey(null);
              setQuery("");
              props.onClose();
            }}
            data-testid="structure-replace-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            size="m"
            onClick={handleApply}
            disabled={cp.isReplacingVariant || !effectiveKey || effectiveKey === page?.templateKey}
            loading={cp.isReplacingVariant}
            data-testid="structure-replace-confirm"
          >
            {cp.isReplacingVariant ? "Применение…" : "Применить"}
          </Button>
        </>
      }
      data-testid="structure-replace-modal"
    >
      {variants.length > 1 && (
        <div className="variant-search">
          <Search
            width={14}
            height={14}
            className="variant-search__icon"
            aria-hidden="true"
          />
          <input
            type="search"
            className="variant-search__input"
            placeholder="Поиск по названию варианта…"
            aria-label="Поиск вариантов"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="structure-replace-search"
          />
        </div>
      )}
      {filteredVariants.length === 0 ? (
        <div className="variant-search__empty" data-testid="structure-replace-empty">
          Ничего не найдено
        </div>
      ) : (
        <VariantPreviewPicker
          options={filteredVariants.map((v) => ({
            key: v.key,
            label: v.label,
            description: v.description,
            isCurrent: v.key === page?.templateKey,
            variantKey: v.key,
            kind: v.kind,
            pageKind: v.pageKind,
          }))}
          selectedKey={effectiveKey}
          onSelect={setSelectedKey}
          testIdPrefix="structure-replace-option"
          templateId={previewTemplateId(cp, props.designDraft?.templateId, page ?? { kind: null })}
          params={props.designDraft?.params ?? {}}
          // PRD-22: the page keeps its properties across the switch, so the preview
          // of a variant with an illustration shows THIS page's picture.
          pageSettings={(page?.settingsJson as Record<string, unknown> | null) ?? null}
          open={page !== null}
        />
      )}
      {lostFields.length > 0 && (
        <div className="diff-block" data-testid="structure-replace-diff">
          <div className="diff-block__group">
            <div className="diff-block__title">
              <AlertTriangle width={14} height={14} aria-hidden="true" />
              {isNoFields
                ? "Текущие настройки страницы будут потеряны"
                : "Часть настроек не переносится"}
            </div>
            <ul className="diff-block__list">
              {lostFields.map((f) => (
                <li className="diff-block__item" key={f.key}>
                  <span className="diff-block__field-name">{f.label}:</span>
                  <span className="diff-block__field-value">
                    «{describePlaceholderValue(f.value)}»
                  </span>
                </li>
              ))}
            </ul>
            <p className="diff-block__meta">
              {isNoFields
                ? "У нового варианта нет редактируемых полей — содержимое страницы будет полностью задано шаблоном."
                : "У нового варианта таких полей нет."}
            </p>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}

// VariantList moved to ./variant-preview-picker (reused as the picker's left pane).
