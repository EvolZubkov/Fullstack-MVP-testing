/**
 * @module features/tests/editor/test-editor
 * @description Wide Drawer container for the test settings editor (PRD-7
 * §1.10, FR-04, FR-05, FR-25a..k, FR-43, NFR-17..21).
 *
 * The DOM matches the approved wireframe
 * `docs/wireframes/approved/prd7-editor-drawer.html` (state `s-default`)
 * one-to-one: `ou-drawer-root` with backdrop, `ou-drawer--xl --right`,
 * `ou-drawer__head` with title + status / version tags + close button,
 * `ou-tabs--underline --m` with four tabs (Состав / Настройки / Оформление /
 * Структура), scrollable `ou-drawer__body` and `ou-drawer__foot` with a
 * single `Сохранить` primary action plus `Показать изменения` popover (FR-25a,
 * FR-25c) and the close confirmation modal (FR-05 / FR-05a).
 *
 * Section bodies are intentionally rendered as DS `ou-empty--inline` stubs in
 * this phase — domain section components ship separately.
 *
 * Anti-goals (per task contract):
 *   - No shadcn/ui components (Dialog/Sheet/Tabs) — they do not match the DS.
 *   - No local `wf-*` classes — those are wireframe-only meta.
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
import {
  useTestEditor,
  type EditorTabKey,
  type TabStatus,
  type UseTestEditorOptions,
  type UseTestEditorResult,
} from "./use-test-editor";
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

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Wide Drawer hosting the test editor. Thin wrapper that owns the
 * {@link useTestEditor} hook and delegates rendering to
 * {@link TestEditorView}. The split lets tests drive a shared hook instance.
 *
 * Edit vs create mode is derived from props: `createMode` wins over `testId`.
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

  // Auto-close the Drawer once a create POST succeeds. The list refetches
  // automatically (mutation already invalidates `/api/tests`).
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

  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstTabRef = useRef<HTMLButtonElement | null>(null);

  // NFR-19: focus the first interactive element on open.
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      // Tabs are the canonical first interactive node in the Drawer header.
      firstTabRef.current?.focus();
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

  const requestClose = useCallback(() => {
    if (editor.isSaving) return;
    if (editor.isDirty) {
      setCloseDialogOpen(true);
      return;
    }
    onClose();
  }, [editor.isDirty, editor.isSaving, onClose]);

  const hasErrors = editor.validation.errors.length > 0;
  const saveDisabled = !editor.isDirty || hasErrors || editor.isSaving;

  const handleSave = useCallback(async () => {
    if (saveDisabled) return;
    await editor.save();
  }, [editor, saveDisabled]);

  const handleSaveAndExit = useCallback(async () => {
    if (hasErrors) return;
    await editor.save();
    setCloseDialogOpen(false);
    onClose();
  }, [editor, hasErrors, onClose]);

  const handleExitWithoutSave = useCallback(() => {
    setCloseDialogOpen(false);
    editor.reset();
    onClose();
  }, [editor, onClose]);

  const statusTag = useMemo(() => deriveStatusTag(editor), [editor]);

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
          <span className={statusTag.className} aria-label={statusTag.ariaLabel}>
            {statusTag.label}
          </span>
          <span className="ou-tag ou-tag--neutral ou-tag--outline">v{version}</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="ou-drawer__close"
            onClick={requestClose}
            disabled={editor.isSaving}
            aria-label={
              editor.isSaving
                ? "Закрыть редактор (недоступно при сохранении)"
                : "Закрыть редактор"
            }
            data-testid="test-editor-close"
          >
            <CloseIcon />
          </button>
        </header>

        <nav className="ou-tabs ou-tabs--underline ou-tabs--m">
          <div
            className="ou-tabs__list"
            role="tablist"
            aria-label="Разделы редактора"
          >
            {TAB_ORDER.map((tab, index) => (
              <button
                key={tab}
                ref={index === 0 ? firstTabRef : undefined}
                type="button"
                className={
                  "ou-tabs__tab" + (tab === activeTab ? " is-active" : "")
                }
                role="tab"
                aria-selected={tab === activeTab}
                aria-label={ariaLabelForTab(tab, editor.tabStatuses[tab])}
                onClick={() => setActiveTab(tab)}
                data-testid={`test-editor-tab-${tab}`}
              >
                {TAB_LABELS[tab]}
                <StatusDot status={editor.tabStatuses[tab]} />
              </button>
            ))}
          </div>
        </nav>

        <div
          className={
            "ou-drawer__body" +
            (activeTab === "settings" || activeTab === "design"
              ? " ou-drawer__body--flush"
              : "")
          }
          tabIndex={0}
          data-testid="test-editor-body"
        >
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
            <DesignSection testId={editor.model.id} />
          )}
          {editor.model && activeTab === "structure" && (
            <StructureSection model={editor.model} testId={editor.model.id} />
          )}
          {!editor.model && <TabPlaceholder tab={activeTab} />}
        </div>

        <footer className="ou-drawer__foot">
          <button
            type="button"
            className="ou-btn ou-btn--secondary ou-btn--m"
            onClick={requestClose}
            disabled={editor.isSaving}
            data-testid="test-editor-cancel"
          >
            Закрыть
          </button>
          {editor.isDirty && (
            <div className="tb-changes-anchor">
              <button
                type="button"
                className="ou-btn ou-btn--ghost ou-btn--m"
                aria-expanded={changesOpen}
                aria-controls="test-editor-changes-popover"
                onClick={() => setChangesOpen((v) => !v)}
                data-testid="test-editor-show-changes"
              >
                Показать изменения
              </button>
              {changesOpen && (
                <ChangesPopover
                  tabStatuses={editor.tabStatuses}
                  onClose={() => setChangesOpen(false)}
                />
              )}
            </div>
          )}
          <button
            type="button"
            className="ou-btn ou-btn--primary ou-btn--m"
            disabled={saveDisabled}
            aria-disabled={saveDisabled}
            onClick={handleSave}
            data-testid="test-editor-save"
          >
            {editor.isSaving ? "Сохранение…" : "Сохранить"}
          </button>
        </footer>
      </aside>

      {closeDialogOpen && (
        <CloseConfirmDialog
          hasErrors={hasErrors}
          onCancel={() => setCloseDialogOpen(false)}
          onExitWithoutSave={handleExitWithoutSave}
          onSaveAndExit={handleSaveAndExit}
        />
      )}

      {editor.conflict !== null && (
        <ConflictDialog
          onCancel={editor.dismissConflict}
          onReload={editor.resolveConflictReload}
          onOverwrite={editor.resolveConflictOverwrite}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: TabStatus }) {
  if (status.error) {
    return <span className="status-dot error" aria-hidden="true" />;
  }
  if (status.warning) {
    return <span className="status-dot warn" aria-hidden="true" />;
  }
  if (status.dirty) {
    return <span className="status-dot dirty" aria-hidden="true" />;
  }
  return null;
}

function ariaLabelForTab(tab: EditorTabKey, status: TabStatus): string {
  const base = TAB_LABELS[tab];
  if (status.error) return `${base}, есть блокирующие ошибки`;
  if (status.warning) return `${base}, есть предупреждения`;
  if (status.dirty) return `${base}, есть изменения`;
  return base;
}

function TabPlaceholder({ tab }: { tab: EditorTabKey }) {
  const desc: Record<EditorTabKey, string> = {
    composition: "Темы и выборка вопросов — наполнение тестом.",
    settings: "Параметры прохождения, ограничения, обратная связь.",
    design: "Цвета, шрифты, фоны и логотип.",
    structure: "Порядок вопросов, страницы и секции.",
  };
  return (
    <div
      className="ou-empty ou-empty--inline ou-empty--well"
      data-testid={`test-editor-tab-body-${tab}`}
    >
      <div className="ou-empty__content">
        <div className="ou-empty__title">{TAB_LABELS[tab]}</div>
        <div className="ou-empty__desc">{desc[tab]}</div>
      </div>
    </div>
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
        <button
          type="button"
          className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
          aria-label="Закрыть список изменений"
          onClick={props.onClose}
        >
          <CloseIcon size={14} />
        </button>
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
  hasErrors: boolean;
  onCancel: () => void;
  onExitWithoutSave: () => void;
  onSaveAndExit: () => Promise<void>;
}) {
  const titleId = "tb-close-confirm-title";
  return (
    <div
      className="ou-modal-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="test-editor-close-confirm"
    >
      <div className="ou-modal__backdrop" onClick={props.onCancel} />
      <div className="ou-modal ou-modal--m">
        <div className="ou-modal__head ou-modal__head--icon">
          <span
            className={
              "ou-modal__icon " +
              (props.hasErrors
                ? "ou-modal__icon--danger"
                : "ou-modal__icon--warning")
            }
            aria-hidden="true"
          >
            {props.hasErrors ? <XCircleIcon /> : <WarnIcon />}
          </span>
          <div className="ou-modal__head-text">
            <h2 id={titleId} className="ou-modal__title">
              {props.hasErrors
                ? "Есть несохранённые изменения и ошибки"
                : "Есть несохранённые изменения"}
            </h2>
          </div>
        </div>
        <div className="ou-modal__body">
          <p>
            {props.hasErrors
              ? "Вы внесли изменения, но некоторые поля содержат ошибки. Сохранение сейчас невозможно."
              : "Вы внесли изменения в тест. Что хотите сделать перед закрытием?"}
          </p>
        </div>
        <div className="ou-modal__foot">
          <button
            type="button"
            className="ou-btn ou-btn--ghost ou-btn--m"
            onClick={props.onCancel}
            data-testid="test-editor-close-confirm-cancel"
          >
            Отмена
          </button>
          <button
            type="button"
            className="ou-btn ou-btn--secondary ou-btn--m"
            onClick={props.onExitWithoutSave}
            data-testid="test-editor-close-confirm-discard"
          >
            Выйти без сохранения
          </button>
          <button
            type="button"
            className="ou-btn ou-btn--primary ou-btn--m"
            disabled={props.hasErrors}
            aria-disabled={props.hasErrors}
            title={
              props.hasErrors ? "Исправьте ошибки перед сохранением" : undefined
            }
            onClick={() => {
              void props.onSaveAndExit();
            }}
            data-testid="test-editor-close-confirm-save"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function ConflictDialog(props: {
  onCancel: () => void;
  onReload: () => Promise<void>;
  onOverwrite: () => Promise<void>;
}) {
  const titleId = "tb-conflict-title";
  return (
    <div
      className="ou-modal-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="test-editor-conflict"
    >
      <div className="ou-modal__backdrop" onClick={props.onCancel} />
      <div className="ou-modal ou-modal--m">
        <div className="ou-modal__head ou-modal__head--icon">
          <span
            className="ou-modal__icon ou-modal__icon--warning"
            aria-hidden="true"
          >
            <WarnIcon />
          </span>
          <div className="ou-modal__head-text">
            <p className="ou-modal__title" id={titleId}>
              Конфликт версий
            </p>
            <p className="ou-modal__desc">
              Тест был изменён другим пользователем пока вы редактировали
            </p>
          </div>
        </div>
        <div className="ou-modal__body">
          <p>Кто-то сохранил свои правки раньше вас. Выберите, как разрешить конфликт:</p>
        </div>
        <div className="ou-modal__foot">
          <button
            type="button"
            className="ou-btn ou-btn--ghost ou-btn--m"
            onClick={props.onCancel}
            data-testid="test-editor-conflict-cancel"
          >
            Отмена
          </button>
          <button
            type="button"
            className="ou-btn ou-btn--destructive ou-btn--m"
            title="Записать ваши изменения поверх серверной версии."
            onClick={() => {
              void props.onOverwrite();
            }}
            data-testid="test-editor-conflict-overwrite"
          >
            Сохранить поверх
          </button>
          <button
            type="button"
            className="ou-btn ou-btn--primary ou-btn--m"
            autoFocus
            title="Загрузить серверную версию."
            onClick={() => {
              void props.onReload();
            }}
            data-testid="test-editor-conflict-reload"
          >
            Обновить данные
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Status tag derivation ────────────────────────────────────────────────────

function deriveStatusTag(editor: ReturnType<typeof useTestEditor>): {
  className: string;
  label: string;
  ariaLabel: string;
} {
  const hasErrors = editor.validation.errors.length > 0;
  if (hasErrors) {
    return {
      className: "ou-tag ou-tag--error ou-tag--outline",
      label: "Есть ошибки",
      ariaLabel: "Статус: есть блокирующие ошибки",
    };
  }
  if (editor.isDirty) {
    return {
      className: "ou-tag ou-tag--warning ou-tag--outline",
      label: "Изменено",
      ariaLabel: "Статус: есть несохранённые изменения",
    };
  }
  const status = editor.model?.basic.status;
  if (status === "published") {
    return {
      className: "ou-tag ou-tag--success ou-tag--outline",
      label: "Опубликован",
      ariaLabel: "Статус: опубликован",
    };
  }
  if (status === "archived") {
    return {
      className: "ou-tag ou-tag--neutral ou-tag--outline",
      label: "Архив",
      ariaLabel: "Статус: архив",
    };
  }
  return {
    className: "ou-tag ou-tag--neutral ou-tag--outline",
    label: "Черновик",
    ariaLabel: "Статус: черновик",
  };
}

// ─── Inline icons (Lucide-style stroke SVGs) ──────────────────────────────────

function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
