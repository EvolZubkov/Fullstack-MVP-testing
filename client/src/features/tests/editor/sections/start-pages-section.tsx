/**
 * @module features/tests/editor/sections/start-pages-section
 * @description Editor section for the «Структура» tab (PRD-7 wireframes
 * `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`,
 * `prd7-structure-router.html`; closeout of PRD-1 §4).
 *
 * Rendering is **kind-aware** (PRD-1 §4.3), not position-tuple-based: system
 * pages are placed by their `kind` into semantic zones, author pages by their
 * position/topic into editable groups.
 *   - `intro`   (singleton) → «До теста» zone, read-only + variant switch.
 *   - `summary` (singleton) → «После теста» zone, read-only + variant switch.
 *   - `router`  (singleton) → «Маршрутизатор» zone (router_by_topics).
 *   - `questions` → one row per topic (per-topic modes) or one flat row
 *     (linear_flat), enriched with the section's question count; read-only +
 *     variant switch. NOT duplicated with a synthetic row.
 *   - `info` (author) → editable rows in «До/После теста» and per-topic
 *     before/after groups: add (insert-row + variant modal), inline-expand
 *     edit, drag-reorder, delete.
 *
 * System rows expose «Сменить вариант» (FR-46 / PRD-1 §4.3.3) — disabled when
 * the active template declares a single variant of that kind. Structural
 * classes live in `client/src/styles/tb-components.css`; controls use
 * `@universityrt/ui-kit`.
 */
import { useMemo, useState } from "react";
import {
  ChevronRight,
  FileText,
  GripVertical,
  HelpCircle,
  Info,
  Layout,
  MoreHorizontal,
  Plus,
  Route,
} from "lucide-react";
import {
  Banner,
  Button,
  Input,
  Menu,
  MenuItem,
  MenuTrigger,
  ModalDialog,
  NumberInput,
  Select,
  Switch,
  Tag,
  Textarea,
} from "@universityrt/ui-kit";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
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
  type ContentTemplateVariant,
  type UseContentPagesResult,
} from "../use-content-pages";
import type { TestEditorModel } from "../test-editor.types";

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
};

/** Backwards-compatible alias: original skeleton lived under this name. */
export type StartPagesSectionProps = StructureSectionProps;

const FLOW_LABEL: Record<TestEditorModel["flowMode"], string> = {
  linear_flat: "Последовательный",
  linear_by_topics: "Последовательный по темам",
  router_by_topics: "Маршрутизатор по темам",
  mixed: "Смешанный (устаревший)",
};

const KIND_LABEL: Record<string, string> = {
  intro: "Введение",
  info: "Материал",
  summary: "Итоги",
  router: "Маршрутизатор",
  questions: "Вопросы",
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

function pageTitle(page: ContentPage): string {
  const values = page.valuesJson?.values ?? {};
  return (
    (values.title as string | undefined) ||
    (values.heading as string | undefined) ||
    KIND_LABEL[page.kind] ||
    "Страница"
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

/**
 * Computes the new `sortOrder` list for a same-zone reorder — dragging
 * `activeId` onto `overId` inside `zone` (already sorted). Returns `null` for a
 * no-op. Pure, so the reorder math is unit-tested independently of the @dnd-kit
 * sensors (which need real DOM measurements unavailable in jsdom).
 */
export function computeZoneReorder<T extends { id: string }>(
  zone: T[],
  activeId: string,
  overId: string,
): Array<{ id: string; sortOrder: number }> | null {
  const from = zone.findIndex((p) => p.id === activeId);
  const to = zone.findIndex((p) => p.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  return arrayMove(zone, from, to).map((p, i) => ({ id: p.id, sortOrder: i }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StructureSection({ model, testId, content: contentProp }: StructureSectionProps) {
  // Fallback hook so the section works standalone (component tests) when the
  // drawer has not hoisted the hook. Mirrors design-section's pattern.
  const fallback = useContentPages(contentProp ? undefined : testId);
  const cp = contentProp ?? fallback;

  const [addCtx, setAddCtx] = useState<AddContext | null>(null);
  const [replaceCtx, setReplaceCtx] = useState<ReplaceContext | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handlers: ZoneHandlers = {
    cp,
    expandedId,
    setExpandedId,
    onAdd: setAddCtx,
    onReplaceVariant: (page) => setReplaceCtx({ page }),
  };

  return (
    <div data-testid="structure-section">
      <FlowModeBar mode={model.flowMode} />

      {testId === undefined ? (
        <CreateModeNotice />
      ) : cp.isLoading ? (
        <LoadingNotice />
      ) : cp.error ? (
        <ErrorNotice message={cp.error.message} />
      ) : (
        <ZonesBlock model={model} handlers={handlers} />
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
        onClose={() => setAddCtx(null)}
        onCreated={(id) => {
          setAddCtx(null);
          setExpandedId(id);
        }}
      />
      <ReplaceVariantModal ctx={replaceCtx} cp={cp} onClose={() => setReplaceCtx(null)} />
    </div>
  );
}

/** Backwards-compatible re-export under the old skeleton name. */
export const StartPagesSection = StructureSection;

// ─── Top banner ───────────────────────────────────────────────────────────────

function FlowModeBar({ mode }: { mode: TestEditorModel["flowMode"] }) {
  return (
    <div className="flow-mode-bar" data-testid="structure-mode-banner">
      <Layout className="h-3.5 w-3.5" aria-hidden="true" />
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
};

function ZonesBlock(props: { model: TestEditorModel; handlers: ZoneHandlers }) {
  const { model, handlers } = props;
  const pages = handlers.cp.pages;

  // Hooks must run unconditionally, before the «no topics» early return.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const infoIn = (position: ContentPagePosition, topicId: string | null) =>
    pages
      .filter((p) => p.kind === "info" && p.position === position && p.topicId === topicId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  const systemSingleton = (kind: ContentPageKind) =>
    pages.find((p) => p.kind === kind && p.topicId === null) ?? null;
  const questionsForTopic = (tid: string) =>
    pages.find((p) => p.kind === "questions" && p.topicId === tid) ?? null;

  const activePage = activeId ? pages.find((p) => p.id === activeId) ?? null : null;

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

  // DnD reorder of author pages. Stage A: reorder within the same zone (drop a
  // row onto another row of the same position+topic). Cross-zone moves are
  // added in a follow-up step.
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeP = pages.find((p) => p.id === active.id);
    const overP = pages.find((p) => p.id === over.id);
    if (!activeP || !overP) return;
    if (overP.position === activeP.position && overP.topicId === activeP.topicId) {
      const next = computeZoneReorder(
        infoIn(activeP.position, activeP.topicId),
        String(active.id),
        String(over.id),
      );
      if (next) void handlers.cp.reorder(next);
    }
  };

  if (model.sections.length === 0) {
    return (
      <Banner
        tone="info"
        title="Тем пока нет"
        description="Добавьте темы во вкладке «Состав» — здесь они появятся в порядке прохождения."
        data-testid="structure-empty"
      />
    );
  }

  const intro = systemSingleton("intro");
  const summary = systemSingleton("summary");
  const router = systemSingleton("router");

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
    <div data-testid="structure-section-list">
      <Zone title="До теста" testId="structure-zone-before-test">
        {intro && (
          <SystemPageRow
            page={intro}
            title={pageTitle(intro)}
            handlers={handlers}
            testId="structure-system-intro"
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

      {router && (
        <Zone title="Маршрутизатор" testId="structure-zone-router">
          <SystemPageRow
            page={router}
            title={pageTitle(router)}
            handlers={handlers}
            icon="router"
            testId="structure-system-router"
          />
        </Zone>
      )}

      {model.flowMode === "linear_flat" ? (
        <Zone title="Внутри теста" testId="structure-zone-questions">
          <QuestionsRow
            page={systemSingleton("questions")}
            countLabel={flatCountLabel(model)}
            handlers={handlers}
            testId="structure-flat-questions-row"
          />
        </Zone>
      ) : (
        model.sections.map((section, idx) => (
          <TopicBlock
            key={section.topicId}
            index={idx + 1}
            section={section}
            before={infoIn("before_topic", section.topicId)}
            after={infoIn("after_topic", section.topicId)}
            questions={questionsForTopic(section.topicId)}
            handlers={handlers}
          />
        ))
      )}

      <Zone title="После теста" testId="structure-zone-after-test">
        {summary && (
          <SystemPageRow
            page={summary}
            title={pageTitle(summary)}
            handlers={handlers}
            testId="structure-system-summary"
          />
        )}
        <AuthorPageGroup
          pages={infoIn("after", null)}
          position="after"
          topicId={null}
          zoneLabel="После теста"
          handlers={handlers}
        />
      </Zone>
    </div>
      <DragOverlay>
        {activePage ? (
          <div className="page-row dragging" data-testid="structure-drag-overlay">
            <span className="drag-handle">
              <GripVertical className="h-3.5 w-3.5" />
            </span>
            <span className="page-variant-badge">{KIND_LABEL[activePage.kind] ?? "Материал"}</span>
            <span className="page-title">{pageTitle(activePage)}</span>
          </div>
        ) : null}
      </DragOverlay>
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
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        {props.title}
      </div>
      <div className="topic-body">{props.children}</div>
    </section>
  );
}

function TopicBlock(props: {
  index: number;
  section: TestEditorModel["sections"][number];
  before: ContentPage[];
  after: ContentPage[];
  questions: ContentPage | null;
  handlers: ZoneHandlers;
}) {
  const { section } = props;
  return (
    <section className="topic-block" data-testid={`structure-zone-topic-${section.topicId}`}>
      <div className="topic-header">
        <span className="topic-name">
          {props.index}. {section.topicName}
        </span>
        <span className="topic-count">
          {section.drawCount} из {section.maxQuestions} вопросов
        </span>
      </div>
      <div className="topic-body">
        <AuthorPageGroup
          pages={props.before}
          position="before_topic"
          topicId={section.topicId}
          zoneLabel={`«${section.topicName}» — до темы`}
          handlers={props.handlers}
        />
        <QuestionsRow
          page={props.questions}
          countLabel={`${section.drawCount} из ${section.maxQuestions} вопросов темы «${section.topicName}»`}
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
        <HelpCircle className="page-icon h-3.5 w-3.5" aria-hidden="true" />
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
  icon?: "questions" | "router" | "content";
  testId: string;
}) {
  const { page, handlers } = props;
  const { cp } = handlers;
  const variants = cp.contentTemplates.filter((v) => v.kind === page.kind);
  const variant = variants.find((v) => v.key === page.templateKey);
  const badge = variant?.label ?? KIND_LABEL[page.kind] ?? page.kind;
  const canSwitch = variants.length > 1;

  const Icon = props.icon === "router" ? Route : props.icon === "questions" ? HelpCircle : FileText;

  return (
    <div
      className={
        "page-row page-row--system" + (page.kind === "questions" ? " page-row--questions" : "")
      }
      data-testid={props.testId}
      data-kind={page.kind}
    >
      <Icon className="page-icon h-3.5 w-3.5" aria-hidden="true" />
      <span className="page-variant-badge">{badge}</span>
      <span className="page-title">{props.title}</span>
      <div className="page-actions">
        <MenuTrigger
          placement="bottom-end"
          trigger={
            <button
              type="button"
              className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
              aria-label={`Действия для системной страницы «${badge}»`}
              data-testid={`${props.testId}-actions`}
            >
              <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
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
          </Menu>
        </MenuTrigger>
      </div>
      {canSwitch && (
        <div className="page-row__meta">
          <Tag tone="info" size="s" data-testid={`${props.testId}-variant-hint`}>
            <Info className="h-3 w-3" aria-hidden="true" />
            Доступно вариантов: {variants.length}
          </Tag>
        </div>
      )}
    </div>
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

  return (
    <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
      <InsertRow onClick={() => insert(0)} testId={`structure-insert-${slug}-0`} />
      {pages.map((page, idx) => (
        <div key={page.id}>
          <AuthorPageRow
            page={page}
            cp={handlers.cp}
            expanded={handlers.expandedId === page.id}
            onToggleExpand={() =>
              handlers.setExpandedId(handlers.expandedId === page.id ? null : page.id)
            }
          />
          <InsertRow onClick={() => insert(idx + 1)} testId={`structure-insert-${slug}-${idx + 1}`} />
        </div>
      ))}
    </SortableContext>
  );
}

function InsertRow(props: { onClick: () => void; testId: string }) {
  return (
    <div className="insert-row">
      <div className="insert-row-line" aria-hidden="true" />
      <button type="button" className="insert-btn" onClick={props.onClick} data-testid={props.testId}>
        <Plus className="h-3 w-3" aria-hidden="true" /> Добавить страницу
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
}) {
  const { page, cp } = props;
  const [confirming, setConfirming] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id });
  const dragStyle = { transform: CSS.Transform.toString(transform), transition };

  const variant = cp.contentTemplates.find((v) => v.key === page.templateKey);
  const values = page.valuesJson?.values ?? {};
  const missing = missingRequired(variant, values);
  const hasWarn = page.templateKeyMissing || missing.length > 0;

  const title = pageTitle(page);
  const badge = variant?.label ?? KIND_LABEL[page.kind] ?? page.kind;

  return (
    <>
      <div
        ref={setNodeRef}
        style={dragStyle}
        className={
          "page-row" +
          (hasWarn ? " page-row--warn" : "") +
          (props.expanded ? " is-expanded" : "") +
          (isDragging ? " dragging" : "")
        }
        data-testid={`structure-page-row-${page.id}`}
      >
        <span
          className="drag-handle"
          data-testid={`structure-page-grip-${page.id}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <button
          type="button"
          className="page-expand-toggle"
          aria-expanded={props.expanded ? "true" : "false"}
          aria-label={props.expanded ? "Свернуть" : "Развернуть"}
          onClick={props.onToggleExpand}
          data-testid={`structure-page-expand-${page.id}`}
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span className="page-variant-badge">{badge}</span>
        <span className="page-title">{title}</span>
        <div className="page-actions">
          {!confirming ? (
            <MenuTrigger
              placement="bottom-end"
              trigger={
                <button
                  type="button"
                  className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
                  aria-label={`Действия для страницы ${title}`}
                  data-testid={`structure-page-actions-${page.id}`}
                >
                  <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
                </button>
              }
            >
              <Menu size="sm">
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
        {hasWarn && (
          <div className="page-row__meta">
            {page.templateKeyMissing && (
              <Tag tone="warning" size="s" data-testid={`structure-page-missing-${page.id}`}>
                <Info className="h-3 w-3" aria-hidden="true" />
                Шаблон страницы недоступен
              </Tag>
            )}
            {missing.length > 0 && (
              <Tag tone="warning" size="s" data-testid={`structure-page-required-${page.id}`}>
                <Info className="h-3 w-3" aria-hidden="true" />
                Не заполнено обязательных полей: {missing.length}
              </Tag>
            )}
          </div>
        )}
      </div>

      {props.expanded && (
        <PageEditForm page={page} variant={variant} cp={cp} onDone={props.onToggleExpand} />
      )}
    </>
  );
}

// ─── Inline edit form ────────────────────────────────────────────────────────────

function PageEditForm(props: {
  page: ContentPage;
  variant: ContentTemplateVariant | undefined;
  cp: UseContentPagesResult;
  onDone: () => void;
}) {
  const { page, variant, cp } = props;
  const [values, setValues] = useState<Record<string, unknown>>(
    () => ({ ...(page.valuesJson?.values ?? {}) }),
  );
  const [styles, setStyles] = useState<Record<string, { fontSize?: number }>>(
    () => ({ ...((page.valuesJson?.placeholderStyles as Record<string, { fontSize?: number }>) ?? {}) }),
  );

  const setValue = (key: string, v: unknown) => setValues((p) => ({ ...p, [key]: v }));
  const setStyle = (key: string, s: { fontSize?: number }) => setStyles((p) => ({ ...p, [key]: s }));

  const save = () => {
    void cp
      .update(page.id, { valuesJson: { values, placeholderStyles: styles } })
      .then(() => props.onDone())
      .catch(() => {
        /* error surfaced via cp.mutationError banner */
      });
  };

  const placeholders: ContentTemplatePlaceholder[] =
    page.mode === "html"
      ? [{ key: "__html", type: "html", label: "HTML-содержимое" }]
      : variant?.placeholders ?? [];

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
      <div className="page-row-expand-actions">
        <Button
          variant="ghost"
          size="s"
          onClick={props.onDone}
          data-testid={`structure-page-edit-cancel-${page.id}`}
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="s"
          onClick={save}
          disabled={cp.isUpdating}
          loading={cp.isUpdating}
          data-testid={`structure-page-edit-save-${page.id}`}
        >
          {cp.isUpdating ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
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

  switch (ph.type) {
    case "textarea":
    case "richText":
    case "html":
      return (
        <Textarea
          label={label}
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          rows={ph.type === "html" ? 6 : 5}
          fullWidth
          placeholder={ph.type === "html" ? "<p>Введите HTML</p>" : "Поддерживается базовый HTML"}
          data-testid={testId}
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
          options={(ph.options ?? []).map((o) => ({ value: o, label: o }))}
          onChange={(next) => onChange(next)}
          data-testid={testId}
        />
      );
    case "text":
    default:
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

// ─── Add page modal (variant picker) ─────────────────────────────────────────────

type AddOption =
  | { kind: "template"; key: string; label: string; description?: string; templateKey: string }
  | { kind: "html"; key: string; label: string; description?: string };

function AddPageModal(props: {
  ctx: AddContext | null;
  cp: UseContentPagesResult;
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
  const open = ctx !== null;
  const effectiveKey = selectedKey ?? options[0]?.key ?? null;

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
        props.onClose();
      }}
      size="m"
      title="Добавить страницу"
      description={ctx ? `Выберите вариант для зоны «${ctx.zoneLabel}».` : undefined}
      footer={
        <>
          <Button
            variant="ghost"
            size="m"
            onClick={() => {
              setSelectedKey(null);
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
      <VariantList
        options={options.map((o) => ({ key: o.key, label: o.label, description: o.description }))}
        selectedKey={effectiveKey}
        onSelect={setSelectedKey}
        testIdPrefix="structure-add-option"
      />
    </ModalDialog>
  );
}

// ─── Replace-variant modal (system pages, FR-46) ─────────────────────────────────

function ReplaceVariantModal(props: {
  ctx: ReplaceContext | null;
  cp: UseContentPagesResult;
  onClose: () => void;
}) {
  const { ctx, cp } = props;
  const page = ctx?.page ?? null;
  const variants = useMemo(
    () => (page ? cp.contentTemplates.filter((v) => v.kind === page.kind) : []),
    [cp.contentTemplates, page],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const effectiveKey = selectedKey ?? page?.templateKey ?? variants[0]?.key ?? null;

  const handleApply = () => {
    if (!page || !effectiveKey || effectiveKey === page.templateKey) return;
    void cp
      .replaceVariant(page.id, effectiveKey)
      .then(() => {
        setSelectedKey(null);
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
        props.onClose();
      }}
      size="m"
      title="Сменить вариант страницы"
      description={page ? `Системная страница «${KIND_LABEL[page.kind] ?? page.kind}».` : undefined}
      footer={
        <>
          <Button
            variant="ghost"
            size="m"
            onClick={() => {
              setSelectedKey(null);
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
      <VariantList
        options={variants.map((v) => ({
          key: v.key,
          label: v.label + (v.key === page?.templateKey ? " (текущий)" : ""),
          description: v.description,
        }))}
        selectedKey={effectiveKey}
        onSelect={setSelectedKey}
        testIdPrefix="structure-replace-option"
      />
    </ModalDialog>
  );
}

// ─── Variant list (shared listbox) ───────────────────────────────────────────────

function VariantList(props: {
  options: Array<{ key: string; label: string; description?: string }>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  testIdPrefix: string;
}) {
  return (
    <ul className="variant-list" role="listbox" aria-label="Варианты страниц">
      {props.options.map((o) => {
        const selected = o.key === props.selectedKey;
        return (
          <li
            key={o.key}
            className={"variant-list__item" + (selected ? " is-selected" : "")}
            role="option"
            aria-selected={selected ? "true" : "false"}
            tabIndex={0}
            onClick={() => props.onSelect(o.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                props.onSelect(o.key);
              }
            }}
            data-testid={`${props.testIdPrefix}-${o.key}`}
          >
            <div>
              <div className="variant-list__name">{o.label}</div>
              {o.description && <div className="variant-list__desc">{o.description}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
