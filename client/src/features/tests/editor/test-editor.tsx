/**
 * @module features/tests/editor/test-editor
 * @description Wide Drawer container for the test settings editor (PRD-7
 * §1.10, FR-04, FR-05, FR-25a..k, FR-43, NFR-17..21).
 *
 * Layout matches `docs/wireframes/approved/prd7-editor-drawer.html`:
 * `ou-drawer-root` with backdrop, `ou-drawer--xl --right`, header with
 * title + status / version tags + close button, `Tabs` row (4 sections),
 * scrollable body and footer with `Сохранить` + `Показать изменения` popover
 * (FR-25a / FR-25c) and the close confirmation modal (FR-05 / FR-05a).
 *
 * Components: leans on `@universityrt/ui-kit` for `Tabs`, `Tag`, `IconButton`,
 * `Button`, `EmptyState` and the two `ModalDialog`s (close confirm / version
 * conflict). The Drawer shell itself stays as manual `.ou-drawer*` markup
 * because the ui-kit `Drawer` does not support a tabs row between the head
 * and the body.
 *
 * Anti-goals (per task contract):
 *   - No shadcn/ui components.
 *   - No persistence of the draft to `localStorage` / `sessionStorage`
 *     (FR-25j); the in-memory draft lives in {@link useTestEditor}.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Loader2, X, XCircle } from "lucide-react";
import {
  Banner,
  Button,
  EmptyState,
  IconButton,
  ModalDialog,
  Tag,
  Tabs,
  type TabItem,
} from "@universityrt/ui-kit";
import { useQueryClient } from "@tanstack/react-query";
import {
  useTestEditor,
  type EditorTabKey,
  type TabStatus,
  type UseTestEditorOptions,
  type UseTestEditorResult,
} from "./use-test-editor";
import { apiToEditorModel, type ApiTestResponse } from "./test-editor.mappers";
import type { TestEditorModel } from "./test-editor.types";
import { useDesignSettings } from "./use-design-settings";
import { useContentPages, hasStructureErrors, hasStructureWarnings } from "./use-content-pages";
import { useToast } from "@/hooks/use-toast";
import { CompositionSection } from "./sections/topics-structure-section";
import { SettingsSection } from "./sections/basic-settings-section";
import { DesignSection } from "./sections/design-section";
import { StructureSection } from "./sections/start-pages-section";

// ─── Public API ───────────────────────────────────────────────────────────────

export type TestEditorProps = {
  /** Identifier of the test to edit (mutually exclusive with `createMode`). */
  testId?: string;
  /**
   * Open the Drawer in create mode for a brand-new test. `folderId` is the
   * destination folder chosen via the FAB folder-pick modal (`null` = root).
   * When set, `testId` is ignored.
   */
  createMode?: { folderId: string | null };
  /** Whether the Drawer is mounted and visible. */
  open: boolean;
  /** Invoked when the user closes the Drawer (or the close confirmation). */
  onClose: () => void;
};

export type TestEditorViewProps = {
  /** Whether the Drawer is mounted and visible. */
  open: boolean;
  /** Invoked when the user closes the Drawer (or the close confirmation). */
  onClose: () => void;
  /** Editor state (typically the result of {@link useTestEditor}). */
  editor: UseTestEditorResult;
};

const TAB_ORDER: EditorTabKey[] = [
  "composition",
  "settings",
  "design",
  "structure",
];

const TAB_LABELS: Record<EditorTabKey, string> = {
  composition: "Состав",
  settings: "Настройки",
  design: "Оформление",
  structure: "Структура",
};

/**
 * Maps a {@link ValidationIssue} `field` path to the editor tab that renders it
 * (FR-20c anchor navigation). `sections*` live in the Состав tab; everything
 * else (`basic.*`, `passRules.*`, `adaptive.*`) is edited in the Настройки tab.
 */
function tabForField(field: string): EditorTabKey {
  if (field === "sections" || field.startsWith("sections[") || field.startsWith("sections.")) {
    return "composition";
  }
  return "settings";
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Wide Drawer hosting the test editor. Thin wrapper that owns the
 * {@link useTestEditor} hook and delegates rendering to
 * {@link TestEditorView}.
 */
export function TestEditor(props: TestEditorProps): JSX.Element | null {
  const { testId, createMode, open, onClose } = props;
  const options = useMemo<UseTestEditorOptions | null>(() => {
    if (!open) return null;
    if (createMode) return { mode: "create", folderId: createMode.folderId };
    if (testId) return { mode: "edit", testId };
    return null;
  }, [open, createMode, testId]);
  const editor = useTestEditor(options);

  useEffect(() => {
    if (editor.createdId !== null) {
      editor.consumeCreatedId();
      onClose();
    }
  }, [editor.createdId, editor, onClose]);

  return <TestEditorView open={open} onClose={onClose} editor={editor} />;
}

/**
 * Presentational Drawer that consumes a {@link UseTestEditorResult}.
 * Exported separately so tests can render a single shared editor instance
 * while exercising both `updateModel` and the Drawer's UI side-effects.
 */
export function TestEditorView(props: TestEditorViewProps): JSX.Element | null {
  const { open, onClose, editor } = props;
  const [activeTab, setActiveTab] = useState<EditorTabKey>("composition");
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);

  // Hoist design hook here so the unified drawer footer «Сохранить» drives
  // both the test-settings PUT and the design-settings PUT in a single
  // action (per wireframe prd7-design-tab.html — single footer save).
  const design = useDesignSettings(editor.model?.id);

  const { toast } = useToast();

  // Hoist content-pages here too so the «Структура» section shares one hook
  // instance with the drawer — letting the tab reflect content-page warnings
  // (missing variant / unfilled required fields) in its status dot.
  const contentPages = useContentPages(editor.model?.id);
  // Required-empty in any author page → Save is blocked (error).
  // templateKeyMissing → status-dot warning only (does not block Save).
  const structureErr = useMemo(
    () => hasStructureErrors(contentPages.pages, contentPages.contentTemplates),
    [contentPages.pages, contentPages.contentTemplates],
  );
  const structureWarn = useMemo(
    () => hasStructureWarnings(contentPages.pages),
    [contentPages.pages],
  );

  const queryClient = useQueryClient();

  const drawerRef = useRef<HTMLElement | null>(null);

  // NFR-19: focus the first interactive element (the first tab) on open.
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      const firstTab = drawerRef.current?.querySelector<HTMLButtonElement>(
        '[role="tab"]',
      );
      firstTab?.focus();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open]);

  // NFR-20: trap Tab / Shift+Tab inside the Drawer while it is open.
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusables = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !drawer.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    drawer.addEventListener("keydown", handleKey);
    return () => drawer.removeEventListener("keydown", handleKey);
  }, [open]);

  // Combined dirty / saving flags spanning the test-settings draft, the
  // design-settings draft and the content-pages «Структура» tab. Structure
  // mutations write directly to the API (no draft), so `contentPages.hasMutated`
  // is the bridge: it lights up «Сохранить» after add / drag / reorder.
  const combinedDirty = editor.isDirty || design.isDirty || contentPages.hasMutated;
  const combinedSaving = editor.isSaving || design.isSaving;
  // Read-only when the test is published. Structure tab already enforces
  // this internally (drag-handles disabled, no row-menu, fieldset-disabled
  // expand); the drawer footer collapses to a single «Закрыть» button per
  // wireframe `s-readonly` (prd7-structure-linear-by-topics.html). Other tabs
  // (Composition/Settings/Design) do not yet propagate the flag — until they
  // do, the close-confirm guard remains in place to avoid silent edit loss
  // from those tabs while published.
  const isReadOnly = editor.model?.basic.status === "published";

  const requestClose = useCallback(() => {
    if (combinedSaving) return;
    if (combinedDirty) {
      setCloseDialogOpen(true);
      return;
    }
    onClose();
  }, [combinedDirty, combinedSaving, onClose]);

  // `hasErrors` blocks Save: test-settings validation errors OR a required
  // placeholder left empty in any author content page (PRD-1 §4.3.6).
  const hasErrors = editor.validation.errors.length > 0 || structureErr;
  const saveDisabled = !combinedDirty || hasErrors || combinedSaving;

  // FR-20c: distinct count of fields carrying a blocking error (for the summary
  // banner) and anchor navigation to the first offending field.
  const errorFieldCount = useMemo(
    () => new Set(editor.validation.errors.map((e) => e.field)).size,
    [editor.validation.errors],
  );

  /**
   * FR-20c: switch to the tab owning `field`, then scroll/focus the matching
   * input. Anchors are `data-field` attributes on the section formfields; an
   * exact match wins, otherwise the nearest ancestor path (for nested array
   * fields) is used. Focus lands on the first focusable control inside it.
   */
  const goToError = useCallback((field: string) => {
    setActiveTab(tabForField(field));
    // Defer to the next macrotask so the freshly-activated tab has rendered.
    window.setTimeout(() => {
      const root = drawerRef.current;
      if (!root) return;
      let anchor = root.querySelector<HTMLElement>(`[data-field="${field}"]`);
      if (!anchor) {
        anchor = Array.from(root.querySelectorAll<HTMLElement>("[data-field]")).find((el) => {
          const f = el.dataset.field;
          return f !== undefined && (field === f || field.startsWith(`${f}.`) || field.startsWith(`${f}[`));
        }) ?? null;
      }
      if (!anchor) return;
      anchor.scrollIntoView?.({ block: "center" });
      const control = anchor.matches("input, textarea, select, button, [tabindex]")
        ? anchor
        : anchor.querySelector<HTMLElement>("input, textarea, select, button, [tabindex]");
      control?.focus();
    }, 0);
  }, []);

  // Unified save: persist whichever drafts are dirty. Test-settings first
  // (its PUT controls `expectedVersion` ordering); design after, since its
  // endpoint is independent. Returns `true` only when every dirty draft was
  // actually persisted — the editor stays open otherwise (so a 400/5xx
  // doesn't get masked by a friendly close + triangle-alert).
  const saveAll = useCallback(async (): Promise<boolean> => {
    // Snapshot dirty flags BEFORE the saves — by the time we toast, the hooks
    // have already cleared their own state. The Save button covers all three
    // sources (test-settings draft, design draft, content-page mutations); the
    // toast confirms the user's action succeeded for whichever was dirty.
    const wasDirty = editor.isDirty || design.isDirty || contentPages.hasMutated;
    if (editor.isDirty) {
      const ok = await editor.save();
      if (!ok) return false;
    }
    if (design.isDirty) {
      await design.save();
    }
    // Content-page mutations are already persisted at the API call site (no
    // draft); clearing the bridge flag deactivates «Сохранить» until the next
    // structure edit.
    contentPages.resetMutated();
    if (wasDirty) {
      toast({ title: "Изменения сохранены" });
    }
    return true;
  }, [design, editor, contentPages, toast]);

  const handleSave = useCallback(async () => {
    if (saveDisabled) return;
    const ok = await saveAll();
    if (!ok) return;
    // Persist warning state so the test list can show the triangle-alert indicator.
    const testId = editor.model?.id;
    if (testId) {
      queryClient.setQueryData(
        ["test-warnings", testId],
        editor.validation.warnings.length > 0,
      );
    }
    onClose();
  }, [saveAll, saveDisabled, onClose, editor.model?.id, editor.validation.warnings.length, queryClient]);

  const handleSaveAndExit = useCallback(async () => {
    if (hasErrors) return;
    const ok = await saveAll();
    if (!ok) return;
    setCloseDialogOpen(false);
    onClose();
  }, [hasErrors, onClose, saveAll]);

  const handleExitWithoutSave = useCallback(() => {
    setCloseDialogOpen(false);
    editor.reset();
    design.revert();
    // Content-page mutations are already persisted; clearing the bridge flag
    // ensures the next open of the drawer doesn't start with a stale dirty.
    contentPages.resetMutated();
    onClose();
  }, [contentPages, design, editor, onClose]);

  const statusTag = useMemo(() => deriveStatusTag(editor), [editor]);

  const tabItems = useMemo<TabItem<EditorTabKey>[]>(
    () =>
      TAB_ORDER.map((tab) => {
        const base = editor.tabStatuses[tab];
        // The «Структура» tab folds in content-page warnings (missing variant /
        // unfilled required fields) on top of its own draft status.
        const status =
          tab === "structure"
            ? { ...base, warning: base.warning || structureWarn }
            : base;
        // Per prd7-editor-drawer.html the dirty/warn/error indicator is a
        // small inline dot rendered INSIDE the tab label (not in the badge
        // pill slot). Using the `badge` prop would wrap it in
        // `.ou-tabs__badge` (an 18×18 chip designed for counts/labels) —
        // that doesn't match the wireframe. So we compose label+dot here.
        return {
          id: tab,
          label: (
            <>
              {TAB_LABELS[tab]}
              <StatusBadge status={status} />
            </>
          ),
        };
      }),
    [editor.tabStatuses, structureWarn],
  );

  if (!open) return null;

  const title =
    editor.model?.basic.title && editor.model.basic.title.trim() !== ""
      ? editor.model.basic.title
      : editor.mode === "create"
        ? "Новый тест"
        : "Редактор теста";
  const version = editor.model?.version ?? 1;
  const titleId = "tb-test-editor-title";

  return (
    <div
      className="ou-drawer-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="test-editor-root"
    >
      <div
        className="ou-drawer__backdrop"
        onClick={requestClose}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        className="ou-drawer ou-drawer--xl ou-drawer--right"
      >
        <header className="ou-drawer__head">
          <div className="ou-drawer__head-text">
            <h1 id={titleId} className="ou-drawer__title">
              {title}
            </h1>
          </div>
          <Tag
            tone={statusTag.tone}
            variant="outline"
            aria-label={statusTag.ariaLabel}
            data-testid="test-editor-status-tag"
          >
            {statusTag.label}
          </Tag>
          <Tag tone="neutral" variant="outline" data-testid="test-editor-version-tag">
            v{version}
          </Tag>
          <IconButton
            icon={<X size={16} aria-hidden="true" />}
            aria-label={
              combinedSaving
                ? "Закрыть редактор (недоступно при сохранении)"
                : "Закрыть редактор"
            }
            size="s"
            variant="ghost"
            disabled={combinedSaving}
            onClick={requestClose}
            className="ou-drawer__close"
            data-testid="test-editor-close"
          />
        </header>

        <Tabs<EditorTabKey>
          variant="underline"
          size="m"
          items={tabItems}
          value={activeTab}
          onChange={setActiveTab}
          hidePanel
          aria-label="Разделы редактора"
        />

        <div
          // `Tabs` runs with `hidePanel`, so it renders only the tab strip; this
          // container is the active tab's panel. Mark it as such so the tab's
          // `aria-controls="panel-<key>"` resolves and the panel is labelled by
          // its tab (a11y: resolves axe `aria-valid-attr-value` on the tablist).
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          className={
            "ou-drawer__body tb-saving-host" +
            (activeTab === "settings" || activeTab === "design"
              ? " ou-drawer__body--flush"
              : "")
          }
          tabIndex={0}
          data-testid="test-editor-body"
        >
          {/*
            PRD-7 S13.7-G1: while a save is in flight, lay an overlay over the
            scrollable body and mark the inner content as `inert` so the
            author cannot continue editing the now-stale draft. The overlay
            sits inside `tb-saving-host` (the body itself) so it covers tabs
            of all four sections without leaking into header / footer.
            `inert` is a native attribute (HTMLAttributes) supported by React
            and modern browsers; older browsers fall back to a visual block
            via the overlay's pointer-events.
          */}
          {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
          {/* @ts-expect-error inert attribute lacks types in older React/dom-lib versions */}
          <div inert={combinedSaving ? "" : undefined}>
          {hasErrors && (
            <Banner
              tone="error"
              title={`Поля с ошибками: ${errorFieldCount}`}
              description="Исправьте отмеченные поля — сохранение недоступно, пока есть ошибки."
              actions={[
                {
                  label: "Перейти к ошибкам",
                  onClick: () => goToError(editor.validation.errors[0].field),
                },
              ]}
              data-testid="test-editor-error-summary"
            />
          )}
          {editor.saveError && (
            <Banner
              tone="error"
              title="Не удалось сохранить тест"
              description={editor.saveError.message}
              onClose={editor.dismissSaveError}
              data-testid="test-editor-save-error"
            />
          )}
          {editor.model && activeTab === "composition" && (
            <CompositionSection
              model={editor.model}
              updateModel={editor.updateModel}
            />
          )}
          {editor.model && activeTab === "settings" && (
            <SettingsSection
              model={editor.model}
              updateModel={editor.updateModel}
            />
          )}
          {editor.model && activeTab === "design" && (
            <DesignSection testId={editor.model.id} design={design} />
          )}
          {editor.model && activeTab === "structure" && (
            <StructureSection
              model={editor.model}
              testId={editor.model.id}
              content={contentPages}
              savedFlowMode={editor.savedFlowMode}
              onGoToComposition={() => setActiveTab("composition")}
              updateModel={editor.updateModel}
              readOnly={editor.model.basic.status === "published"}
            />
          )}
          {!editor.model && <TabPlaceholder tab={activeTab} />}
          </div>
          {combinedSaving && (
            <div
              className="tb-saving-overlay"
              role="status"
              aria-live="polite"
              aria-label="Сохранение в процессе"
              data-testid="test-editor-saving-overlay"
            >
              <div className="tb-saving-overlay__bd" aria-hidden="true" />
              <div className="tb-saving-overlay__inner">
                <span className="tb-saving-overlay__spinner spin" aria-hidden="true">
                  <Loader2 size={28} />
                </span>
                <span className="tb-saving-overlay__text">Сохранение…</span>
              </div>
            </div>
          )}
        </div>

        <footer
          className="ou-drawer__foot"
          data-testid="test-editor-foot"
          data-state={isReadOnly ? "readonly" : combinedDirty ? "dirty" : "default"}
        >
          {isReadOnly ? (
            // s-readonly per wireframe prd7-structure-linear-by-topics.html
            // (footer: single ghost «Закрыть»). No Save / no Cancel / no
            // changes-popover — published tests are read-only at the Drawer
            // level. Status tag «Опубликован» in the header already signals
            // mode. `requestClose` still guards against silent edit loss if
            // Composition/Settings/Design (not yet read-only) were dirtied.
            <Button
              variant="ghost"
              size="m"
              onClick={requestClose}
              data-testid="test-editor-cancel"
            >
              Закрыть
            </Button>
          ) : combinedDirty ? (
            <>
              <div className="tb-changes-anchor">
                <Button
                  variant="ghost"
                  size="m"
                  aria-expanded={changesOpen ? "true" : "false"}
                  aria-controls="test-editor-changes-popover"
                  onClick={() => setChangesOpen((v) => !v)}
                  data-testid="test-editor-show-changes"
                >
                  Показать изменения
                </Button>
                {changesOpen && (
                  <ChangesPopover
                    tabStatuses={editor.tabStatuses}
                    snapshot={editor.snapshot}
                    model={editor.model}
                    onClose={() => setChangesOpen(false)}
                  />
                )}
              </div>
              <Button
                variant="secondary"
                size="m"
                // Explicit cancel: discard the draft and close immediately, with no
                // "save before closing?" prompt (that prompt belongs to the ambiguous
                // header «×» / backdrop). The user already declared intent to cancel.
                onClick={handleExitWithoutSave}
                disabled={combinedSaving}
                data-testid="test-editor-cancel"
              >
                Отменить
              </Button>
              <Button
                variant="primary"
                size="m"
                disabled={saveDisabled}
                aria-disabled={saveDisabled ? "true" : "false"}
                onClick={handleSave}
                loading={combinedSaving}
                data-testid="test-editor-save"
              >
                {combinedSaving ? "Сохранение…" : "Сохранить"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="m"
                onClick={requestClose}
                disabled={combinedSaving}
                data-testid="test-editor-cancel"
              >
                Закрыть
              </Button>
              <Button
                variant="primary"
                size="m"
                disabled={saveDisabled}
                aria-disabled={saveDisabled ? "true" : "false"}
                onClick={handleSave}
                loading={combinedSaving}
                data-testid="test-editor-save"
              >
                {combinedSaving ? "Сохранение…" : "Сохранить"}
              </Button>
            </>
          )}
        </footer>
      </aside>

      <CloseConfirmDialog
        open={closeDialogOpen}
        hasErrors={hasErrors}
        tabStatuses={editor.tabStatuses}
        errorFieldCount={errorFieldCount}
        firstErrorField={editor.validation.errors[0]?.field ?? null}
        onGoToFirstError={() => {
          if (editor.validation.errors[0]) {
            setCloseDialogOpen(false);
            goToError(editor.validation.errors[0].field);
          }
        }}
        onCancel={() => setCloseDialogOpen(false)}
        onExitWithoutSave={handleExitWithoutSave}
        onSaveAndExit={handleSaveAndExit}
      />

      <ConflictDialog
        open={editor.conflict !== null}
        testId={editor.model?.id}
        localModel={editor.model}
        onCancel={editor.dismissConflict}
        onReload={editor.resolveConflictReload}
        onOverwrite={editor.resolveConflictOverwrite}
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Small coloured dot rendered as a tab badge. Returns a non-empty React node
 * even when the status is clean (uses `aria-hidden`) so the tabs row keeps
 * stable layout (badge slot reserved).
 */
function StatusBadge({ status }: { status: TabStatus }) {
  const cls = status.error
    ? "status-dot error"
    : status.warning
      ? "status-dot warn"
      : status.dirty
        ? "status-dot dirty"
        : null;
  if (!cls) return null;
  const aria = status.error
    ? "есть блокирующие ошибки"
    : status.warning
      ? "есть предупреждения"
      : "есть изменения";
  return <span className={cls} aria-label={aria} />;
}

function TabPlaceholder({ tab }: { tab: EditorTabKey }) {
  const desc: Record<EditorTabKey, string> = {
    composition: "Темы и выборка вопросов — наполнение тестом.",
    settings: "Параметры прохождения, ограничения, обратная связь.",
    design: "Цвета, шрифты, фоны и логотип.",
    structure: "Порядок вопросов, страницы и секции.",
  };
  return (
    <EmptyState
      layout="inline"
      well
      title={TAB_LABELS[tab]}
      description={desc[tab]}
      data-testid={`test-editor-tab-body-${tab}`}
    />
  );
}

function ChangesPopover(props: {
  tabStatuses: Record<EditorTabKey, TabStatus>;
  /** PRD-7 S13.7-G2: needed to compute per-field diff for each dirty tab. */
  snapshot: TestEditorModel | null;
  model: TestEditorModel | null;
  onClose: () => void;
}) {
  const dirtyTabs = TAB_ORDER.filter((tab) => props.tabStatuses[tab].dirty);
  const fieldDiffs = useMemo(
    () =>
      props.snapshot && props.model
        ? collectChangesByTab(props.snapshot, props.model)
        : ({} as Record<EditorTabKey, FieldDiff[]>),
    [props.snapshot, props.model],
  );
  const totalFields = dirtyTabs.reduce(
    (sum, tab) => sum + (fieldDiffs[tab]?.length ?? 0),
    0,
  );
  return (
    <div
      className="tb-changes-popover"
      id="test-editor-changes-popover"
      role="dialog"
      aria-modal="false"
      aria-labelledby="test-editor-changes-title"
      data-testid="test-editor-changes-popover"
    >
      <div className="tb-changes-popover__header">
        <span>
          <span
            className="tb-changes-popover__title"
            id="test-editor-changes-title"
          >
            Изменения в черновике
          </span>
          <span className="tb-changes-popover__count">
            &nbsp;({totalFields > 0 ? totalFields : dirtyTabs.length})
          </span>
        </span>
        <IconButton
          icon={<X size={14} aria-hidden="true" />}
          aria-label="Закрыть список изменений"
          variant="ghost"
          size="s"
          onClick={props.onClose}
        />
      </div>
      <div className="tb-changes-popover__body">
        {dirtyTabs.length === 0 ? (
          <div className="tb-changes-popover__group">
            <div className="tb-changes-popover__group-title">Нет изменений</div>
          </div>
        ) : (
          dirtyTabs.map((tab) => {
            const diffs = fieldDiffs[tab] ?? [];
            return (
              <div
                key={tab}
                className="tb-changes-popover__group"
                aria-label={`Изменения во вкладке ${TAB_LABELS[tab]}`}
                data-testid={`test-editor-changes-group-${tab}`}
              >
                <div className="tb-changes-popover__group-title">
                  {TAB_LABELS[tab]}
                  {diffs.length > 0 && (
                    <>
                      {" · "}
                      {diffs.length}{" "}
                      {diffs.length === 1
                        ? "изменение"
                        : diffs.length >= 2 && diffs.length <= 4
                          ? "изменения"
                          : "изменений"}
                    </>
                  )}
                </div>
                {diffs.length === 0 ? (
                  <div className="tb-changes-popover__item">
                    <span className="tb-changes-popover__label">
                      Структурные изменения (раскрыть детали невозможно).
                    </span>
                  </div>
                ) : (
                  diffs.map((d) => (
                    <div
                      key={d.field}
                      className="tb-changes-popover__item"
                      data-testid={`test-editor-changes-item-${d.field}`}
                    >
                      <span className="tb-changes-popover__label">{d.label}</span>
                      <span className="tb-changes-popover__old">{d.old}</span>
                      <span className="tb-changes-popover__arrow">→</span>
                      <span className="tb-changes-popover__new">{d.next}</span>
                    </div>
                  ))
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** One row in the changes-popover diff. */
type FieldDiff = { field: string; label: string; old: string; next: string };

/**
 * PRD-7 S13.7-G2: computes per-field diff between the last saved snapshot
 * and the current draft, grouped by editor tab. Only top-level, primitive
 * fields are compared — structural changes (sections, pass-rules, adaptive)
 * are flagged with a generic «Структурные изменения» line.
 */
function collectChangesByTab(
  snap: TestEditorModel,
  draft: TestEditorModel,
): Record<EditorTabKey, FieldDiff[]> {
  const result: Record<EditorTabKey, FieldDiff[]> = {
    composition: [],
    settings: [],
    design: [],
    structure: [],
  };

  const fmtBool = (v: boolean) => (v ? "Да" : "Нет");
  const fmtMinutes = (v: number | null) => (v == null ? "не задан" : `${v} мин`);
  const fmtAttempts = (v: number | null) => (v == null ? "без ограничения" : String(v));
  const fmtMode = (v: TestEditorModel["mode"]) =>
    v === "adaptive" ? "Адаптивный" : "Стандартный";
  const fmtFlow = (v: TestEditorModel["flowMode"]) =>
    ({
      linear_flat: "Линейный",
      linear_by_topics: "Линейный по темам",
      router_by_topics: "Через страницу-маршрутизатор",
    })[v] ?? v;

  const candidates: Array<
    Omit<FieldDiff, "old" | "next"> & {
      tab: EditorTabKey;
      oldValue: string;
      newValue: string;
    }
  > = [
    {
      tab: "settings",
      field: "title",
      label: "Название",
      oldValue: snap.basic.title,
      newValue: draft.basic.title,
    },
    {
      tab: "settings",
      field: "description",
      label: "Описание",
      oldValue: snap.basic.description || "не задано",
      newValue: draft.basic.description || "не задано",
    },
    {
      tab: "settings",
      field: "mode",
      label: "Режим теста",
      oldValue: fmtMode(snap.mode),
      newValue: fmtMode(draft.mode),
    },
    {
      tab: "settings",
      field: "flowMode",
      label: "Сценарий прохождения",
      oldValue: fmtFlow(snap.flowMode),
      newValue: fmtFlow(draft.flowMode),
    },
    {
      tab: "settings",
      field: "timeLimitMinutes",
      label: "Лимит времени",
      oldValue: fmtMinutes(snap.runtime.timeLimitMinutes),
      newValue: fmtMinutes(draft.runtime.timeLimitMinutes),
    },
    {
      tab: "settings",
      field: "maxAttempts",
      label: "Максимум попыток",
      oldValue: fmtAttempts(snap.runtime.maxAttempts),
      newValue: fmtAttempts(draft.runtime.maxAttempts),
    },
    {
      tab: "settings",
      field: "showCorrectAnswers",
      label: "Показывать правильные ответы",
      oldValue: fmtBool(snap.runtime.showCorrectAnswers),
      newValue: fmtBool(draft.runtime.showCorrectAnswers),
    },
    {
      tab: "settings",
      field: "webhookUrl",
      label: "Webhook URL",
      oldValue: snap.basic.webhookUrl || "не задан",
      newValue: draft.basic.webhookUrl || "не задан",
    },
    {
      tab: "settings",
      field: "telemetryEnabled",
      label: "Телеметрия",
      oldValue: fmtBool(snap.basic.telemetryEnabled),
      newValue: fmtBool(draft.basic.telemetryEnabled),
    },
  ];

  for (const c of candidates) {
    if (c.oldValue !== c.newValue) {
      result[c.tab].push({
        field: c.field,
        label: c.label,
        old: c.oldValue,
        next: c.newValue,
      });
    }
  }

  return result;
}

function CloseConfirmDialog(props: {
  open: boolean;
  hasErrors: boolean;
  /** PRD-7 S13.7-G30: dirty-tab chip group. */
  tabStatuses: Record<EditorTabKey, TabStatus>;
  /** PRD-7 S13.7-G31: error count surfaced in the inline error banner. */
  errorFieldCount: number;
  /** Field id of the first error — used for «Перейти к первой ошибке» CTA. */
  firstErrorField: string | null;
  onGoToFirstError: () => void;
  onCancel: () => void;
  onExitWithoutSave: () => void;
  onSaveAndExit: () => Promise<void>;
}) {
  const dirtyTabs = TAB_ORDER.filter((tab) => props.tabStatuses[tab].dirty);
  return (
    <ModalDialog
      open={props.open}
      onClose={props.onCancel}
      // size "l": the three actions («Продолжить редактирование» / «Выйти без
      // сохранения» / «Сохранить») do not fit a medium modal and overflow.
      size="l"
      icon={props.hasErrors ? <XCircle size={20} /> : <AlertTriangle size={20} />}
      iconTone={props.hasErrors ? "danger" : "warning"}
      title={
        props.hasErrors
          ? "Есть несохранённые изменения и ошибки"
          : "Есть несохранённые изменения"
      }
      footer={
        <>
          <Button
            variant="ghost"
            size="m"
            onClick={props.onCancel}
            data-testid="test-editor-close-confirm-cancel"
          >
            Продолжить редактирование
          </Button>
          <Button
            variant="secondary"
            size="m"
            onClick={props.onExitWithoutSave}
            data-testid="test-editor-close-confirm-discard"
          >
            Выйти без сохранения
          </Button>
          <Button
            variant="primary"
            size="m"
            disabled={props.hasErrors}
            title={
              props.hasErrors ? "Исправьте ошибки перед сохранением" : undefined
            }
            onClick={() => {
              void props.onSaveAndExit();
            }}
            data-testid="test-editor-close-confirm-save"
          >
            Сохранить
          </Button>
        </>
      }
      data-testid="test-editor-close-confirm"
    >
      <p>
        {props.hasErrors
          ? "Вы внесли изменения, но некоторые поля содержат ошибки. Сохранение сейчас невозможно."
          : "Вы внесли изменения в тест. Что хотите сделать перед закрытием?"}
      </p>
      {/* G31: inline error-banner with «Перейти к первой ошибке» CTA. */}
      {props.hasErrors && props.errorFieldCount > 0 && (
        <Banner
          tone="error"
          description={`${props.errorFieldCount} ${props.errorFieldCount === 1 ? "ошибка" : props.errorFieldCount >= 2 && props.errorFieldCount <= 4 ? "ошибки" : "ошибок"} во вкладке «${TAB_LABELS[tabForField(props.firstErrorField ?? "")]}».`}
          actions={
            props.firstErrorField
              ? [
                  {
                    label: "Перейти к первой ошибке",
                    onClick: props.onGoToFirstError,
                  },
                ]
              : undefined
          }
          data-testid="test-editor-close-confirm-error-banner"
        />
      )}
      {/* G30: chips listing the dirty tabs (Tag neutral). */}
      {dirtyTabs.length > 0 && (
        <div
          className="tb-close-confirm-chips"
          aria-label="Изменённые разделы"
          data-testid="test-editor-close-confirm-chips"
        >
          {dirtyTabs.map((tab) => (
            <Tag
              key={tab}
              tone="neutral"
              variant="outline"
              data-testid={`test-editor-close-confirm-chip-${tab}`}
            >
              {TAB_LABELS[tab]}
            </Tag>
          ))}
        </div>
      )}
    </ModalDialog>
  );
}

function ConflictDialog(props: {
  open: boolean;
  testId: string | undefined;
  localModel: TestEditorModel | null;
  onCancel: () => void;
  onReload: () => Promise<void>;
  onOverwrite: () => Promise<void>;
}) {
  return (
    <ModalDialog
      open={props.open}
      onClose={props.onCancel}
      // size "l" so the three actions + the diff-table fit without overflow.
      size="l"
      icon={<AlertTriangle size={20} />}
      iconTone="warning"
      title="Конфликт версий"
      description="Тест был изменён другим пользователем пока вы редактировали"
      footer={
        <>
          <Button
            variant="ghost"
            size="m"
            onClick={props.onCancel}
            data-testid="test-editor-conflict-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="destructive"
            size="m"
            title="Записать ваши изменения поверх серверной версии."
            onClick={() => {
              void props.onOverwrite();
            }}
            data-testid="test-editor-conflict-overwrite"
          >
            Сохранить поверх
          </Button>
          <Button
            variant="primary"
            size="m"
            autoFocus
            title="Загрузить серверную версию."
            onClick={() => {
              void props.onReload();
            }}
            data-testid="test-editor-conflict-reload"
          >
            Обновить данные
          </Button>
        </>
      }
      data-testid="test-editor-conflict"
    >
      <p>
        Кто-то сохранил свои правки раньше вас. Выберите, как разрешить конфликт:
      </p>
      {props.open && props.testId && props.localModel && (
        <ConflictDiffTable testId={props.testId} localModel={props.localModel} />
      )}
    </ModalDialog>
  );
}

/**
 * PRD-7 S13.7-G5: diff-table «Поле / На сервере / Ваши изменения» rendered
 * inside the conflict dialog. Fetches the server snapshot on mount (one-shot,
 * scoped to the test), parses it via {@link apiToEditorModel}, and lists the
 * basic top-level fields whose values differ between local draft and server.
 * Deeper structural diffs (sections / pass-rules / adaptive) are intentionally
 * out of scope — the wireframe lists just the high-signal fields (title,
 * description, mode, flowMode, runtime limits) and that's what we render.
 */
function ConflictDiffTable(props: { testId: string; localModel: TestEditorModel }) {
  const [server, setServer] = useState<TestEditorModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tests/${props.testId}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = (await res.json()) as ApiTestResponse;
        if (cancelled) return;
        setServer(apiToEditorModel(raw));
      } catch (err) {
        if (cancelled) return;
        setLoadError((err as Error).message ?? "Не удалось загрузить серверную версию");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.testId]);

  if (loadError) {
    return (
      <Banner
        tone="error"
        size="sm"
        description={`Не удалось загрузить серверную версию для сравнения: ${loadError}`}
        data-testid="test-editor-conflict-diff-error"
      />
    );
  }
  if (!server) {
    return (
      <p
        className="tb-conflict-diff__loading"
        data-testid="test-editor-conflict-diff-loading"
      >
        Загружаем серверную версию для сравнения…
      </p>
    );
  }

  const rows = collectConflictRows(server, props.localModel);
  if (rows.length === 0) {
    return (
      <p data-testid="test-editor-conflict-diff-empty">
        Изменения затронули поля, не покрытые этим сравнением. Используйте
        «Обновить данные», чтобы загрузить серверную версию.
      </p>
    );
  }
  return (
    <table
      className="tb-conflict-diff"
      aria-label="Сравнение версий"
      data-testid="test-editor-conflict-diff"
    >
      <thead>
        <tr>
          <th>Поле</th>
          <th>На сервере</th>
          <th>Ваши изменения</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.field} data-testid={`test-editor-conflict-diff-row-${r.field}`}>
            <td>{r.label}</td>
            <td>{r.server}</td>
            <td>{r.local}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One row in the conflict diff-table. */
type ConflictDiffRow = { field: string; label: string; server: string; local: string };

/**
 * Computes a compact list of top-level fields whose values differ between the
 * server snapshot and the local draft. Booleans render as Да/Нет, nullables
 * as «не задано», `flowMode` and `mode` translate to their human labels.
 */
function collectConflictRows(
  server: TestEditorModel,
  local: TestEditorModel,
): ConflictDiffRow[] {
  const fmtBool = (v: boolean) => (v ? "Да" : "Нет");
  const fmtMinutes = (v: number | null) => (v == null ? "не задано" : `${v} мин`);
  const fmtAttempts = (v: number | null) => (v == null ? "без ограничения" : String(v));
  const fmtMode = (v: TestEditorModel["mode"]) =>
    v === "adaptive" ? "Адаптивный" : "Стандартный";
  const fmtFlow = (v: TestEditorModel["flowMode"]) =>
    ({
      linear_flat: "Линейный",
      linear_by_topics: "Линейный по темам",
      router_by_topics: "Через страницу-маршрутизатор",
    })[v] ?? v;

  const candidates: Array<Omit<ConflictDiffRow, "server" | "local"> & {
    serverValue: string;
    localValue: string;
  }> = [
    {
      field: "title",
      label: "Название",
      serverValue: server.basic.title,
      localValue: local.basic.title,
    },
    {
      field: "description",
      label: "Описание",
      serverValue: server.basic.description || "не задано",
      localValue: local.basic.description || "не задано",
    },
    {
      field: "mode",
      label: "Режим теста",
      serverValue: fmtMode(server.mode),
      localValue: fmtMode(local.mode),
    },
    {
      field: "flowMode",
      label: "Сценарий прохождения",
      serverValue: fmtFlow(server.flowMode),
      localValue: fmtFlow(local.flowMode),
    },
    {
      field: "timeLimitMinutes",
      label: "Лимит времени",
      serverValue: fmtMinutes(server.runtime.timeLimitMinutes),
      localValue: fmtMinutes(local.runtime.timeLimitMinutes),
    },
    {
      field: "maxAttempts",
      label: "Максимум попыток",
      serverValue: fmtAttempts(server.runtime.maxAttempts),
      localValue: fmtAttempts(local.runtime.maxAttempts),
    },
    {
      field: "showCorrectAnswers",
      label: "Показывать правильные ответы",
      serverValue: fmtBool(server.runtime.showCorrectAnswers),
      localValue: fmtBool(local.runtime.showCorrectAnswers),
    },
    {
      field: "webhookUrl",
      label: "Webhook URL",
      serverValue: server.basic.webhookUrl || "не задан",
      localValue: local.basic.webhookUrl || "не задан",
    },
  ];

  return candidates
    .filter((c) => c.serverValue !== c.localValue)
    .map(({ serverValue, localValue, ...rest }) => ({
      ...rest,
      server: serverValue,
      local: localValue,
    }));
}

// ─── Status tag derivation ────────────────────────────────────────────────────

import type { TagProps } from "@universityrt/ui-kit";

function deriveStatusTag(editor: ReturnType<typeof useTestEditor>): {
  tone: TagProps["tone"];
  label: string;
  ariaLabel: string;
} {
  const hasErrors = editor.validation.errors.length > 0;
  if (hasErrors) {
    return {
      tone: "error",
      label: "Есть ошибки",
      ariaLabel: "Статус: есть блокирующие ошибки",
    };
  }
  if (editor.isDirty) {
    return {
      tone: "warning",
      label: "Изменено",
      ariaLabel: "Статус: есть несохранённые изменения",
    };
  }
  const status = editor.model?.basic.status;
  if (status === "published") {
    return {
      tone: "success",
      label: "Опубликован",
      ariaLabel: "Статус: опубликован",
    };
  }
  if (status === "archived") {
    return {
      tone: "neutral",
      label: "Архив",
      ariaLabel: "Статус: архив",
    };
  }
  return {
    tone: "neutral",
    label: "Черновик",
    ariaLabel: "Статус: черновик",
  };
}
