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
import { AlertTriangle, X, XCircle } from "lucide-react";
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
import { useDesignSettings } from "./use-design-settings";
import { useContentPages, hasStructureWarnings } from "./use-content-pages";
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

  // Hoist content-pages here too so the «Структура» section shares one hook
  // instance with the drawer — letting the tab reflect content-page warnings
  // (missing variant / unfilled required fields) in its status dot.
  const contentPages = useContentPages(editor.model?.id);
  const structureWarn = useMemo(
    () => hasStructureWarnings(contentPages.pages, contentPages.contentTemplates),
    [contentPages.pages, contentPages.contentTemplates],
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

  // Combined dirty / saving flags spanning the test-settings draft and the
  // design-settings draft.
  const combinedDirty = editor.isDirty || design.isDirty;
  const combinedSaving = editor.isSaving || design.isSaving;

  const requestClose = useCallback(() => {
    if (combinedSaving) return;
    if (combinedDirty) {
      setCloseDialogOpen(true);
      return;
    }
    onClose();
  }, [combinedDirty, combinedSaving, onClose]);

  const hasErrors = editor.validation.errors.length > 0;
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
    if (editor.isDirty) {
      const ok = await editor.save();
      if (!ok) return false;
    }
    if (design.isDirty) {
      await design.save();
    }
    return true;
  }, [design, editor]);

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
    onClose();
  }, [design, editor, onClose]);

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
            "ou-drawer__body" +
            (activeTab === "settings" || activeTab === "design"
              ? " ou-drawer__body--flush"
              : "")
          }
          tabIndex={0}
          data-testid="test-editor-body"
        >
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
            />
          )}
          {!editor.model && <TabPlaceholder tab={activeTab} />}
        </div>

        <footer className="ou-drawer__foot">
          {combinedDirty ? (
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
            </>
          ) : (
            <Button
              variant="ghost"
              size="m"
              onClick={requestClose}
              disabled={combinedSaving}
              data-testid="test-editor-cancel"
            >
              Закрыть
            </Button>
          )}
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
        </footer>
      </aside>

      <CloseConfirmDialog
        open={closeDialogOpen}
        hasErrors={hasErrors}
        onCancel={() => setCloseDialogOpen(false)}
        onExitWithoutSave={handleExitWithoutSave}
        onSaveAndExit={handleSaveAndExit}
      />

      <ConflictDialog
        open={editor.conflict !== null}
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
  onClose: () => void;
}) {
  const dirtyTabs = TAB_ORDER.filter((tab) => props.tabStatuses[tab].dirty);
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
            &nbsp;({dirtyTabs.length})
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
          dirtyTabs.map((tab) => (
            <div
              key={tab}
              className="tb-changes-popover__group"
              aria-label={`Изменения во вкладке ${TAB_LABELS[tab]}`}
            >
              <div className="tb-changes-popover__group-title">
                {TAB_LABELS[tab]}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CloseConfirmDialog(props: {
  open: boolean;
  hasErrors: boolean;
  onCancel: () => void;
  onExitWithoutSave: () => void;
  onSaveAndExit: () => Promise<void>;
}) {
  return (
    <ModalDialog
      open={props.open}
      onClose={props.onCancel}
      size="m"
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
    </ModalDialog>
  );
}

function ConflictDialog(props: {
  open: boolean;
  onCancel: () => void;
  onReload: () => Promise<void>;
  onOverwrite: () => Promise<void>;
}) {
  return (
    <ModalDialog
      open={props.open}
      onClose={props.onCancel}
      size="m"
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
    </ModalDialog>
  );
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
