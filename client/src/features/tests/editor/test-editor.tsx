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
 * Components: leans on `@skillum/ui-kit` for `Tabs`, `Tag`, `IconButton`,
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
import type * as React from "react";
import { AlertTriangle, ArrowRight, Loader2, X, XCircle } from "lucide-react";
import {
  Banner,
  Button,
  EmptyState,
  IconButton,
  ModalDialog,
  Tag,
  Tabs,
  type TabItem,
  useToast,
} from "@skillum/ui-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useTestEditor,
  type EditorTabKey,
  type TabStatus,
  type UseTestEditorOptions,
  type UseTestEditorResult,
} from "./use-test-editor";
import { apiToEditorModel, type ApiTestResponse } from "./test-editor.mappers";
import type { TestEditorModel, ValidationIssue } from "./test-editor.types";
import { buildFieldErrorIndex, buildIssueLevel, REVEAL_EVENT } from "./field-errors";
import { useDesignSettings } from "./use-design-settings";
import { useContentPages, hasStructureErrors, hasStructureWarnings } from "./use-content-pages";
import {
  CompositionTab,
  FeedbackTab,
  MainTab,
  RulesTab,
  ScoringTab,
} from "./sections/editor-tabs";
import { DesignSection } from "./sections/design-section";
import { ScenarioTaskSection } from "./sections/scenario-task-section";
import { describeFeasibilityState } from "@/features/content-protection/issue-text";
import { ReviewPanel } from "../review/review-panel";
import type { ReviewAnchorItem } from "../review/review-comment-form";
import { useReviewComments } from "../review/use-review-comments";
import { QuestionEditorDrawer } from "@/features/questions/question-editor-drawer";
import type { Question, Topic } from "@shared/schema";
import { useOptionalAuth } from "@/lib/auth";

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
  /**
   * Тест создан «Применить»-ем. Ящик при этом НЕ закрывается: автор продолжает
   * работу с уже созданным тестом, поэтому владелец состояния обязан переключить
   * ящик из режима создания в режим правки этого идентификатора.
   *
   * Не передан — ящик закрывается, как раньше.
   */
  onCreated?: (testId: string) => void;
  /**
   * Tab to open on. Lets a caller send the author straight to the work that
   * prompted the opening — the tests list points at «Структура» for a test whose
   * pages need mapping (PRD-22, plan Э6). Defaults to «Основное».
   */
  initialTab?: EditorTabKey;
  /**
   * PRD-52: ветка комментариев, раскрываемая по ссылке `?review=<id>`. Ящик её не
   * ищет — просто передаёт панели, которая раскроет и подсветит нужную.
   */
  focusReviewThreadId?: string;
  /**
   * Замечания выполнимости выдачи, прочитанные после успешного сохранения
   * (PRD-15 FR-05). Показывать их ВНУТРИ ящика нельзя: сохранение его закрывает,
   * — поэтому строки уходят наверх, списку тестов, в тот же advisory-диалог, что
   * и замечания публикации.
   */
  onFeasibilityNotes?: (notes: string[]) => void;
};

export type TestEditorViewProps = {
  /** Whether the Drawer is mounted and visible. */
  open: boolean;
  /** Invoked when the user closes the Drawer (or the close confirmation). */
  onClose: () => void;
  /** Editor state (typically the result of {@link useTestEditor}). */
  editor: UseTestEditorResult;
  /** Tab to open on; defaults to «Основное». See {@link TestEditorProps.initialTab}. */
  initialTab?: EditorTabKey;
  /** См. {@link TestEditorProps.focusReviewThreadId}. */
  focusReviewThreadId?: string;
  /** See {@link TestEditorProps.onFeasibilityNotes}. */
  onFeasibilityNotes?: (notes: string[]) => void;
};

/**
 * Порядок вкладок ящика (план «перестройка настроек редактора теста», §3.1). Вкладка
 * отвечает на ОДИН вопрос автора и идёт в том порядке, в каком он их задаёт: что это
 * за тест -> из чего собран -> как идёт -> как оценивается -> что видит участник ->
 * как выглядит -> что о нём сказали коллеги.
 */
const TAB_ORDER: EditorTabKey[] = [
  "main",
  "composition",
  "rules",
  "scoring",
  "feedback",
  "design",
  "review",
];

const TAB_LABELS: Record<EditorTabKey, string> = {
  main: "Основное",
  composition: "Состав и сценарий",
  rules: "Правила прохождения",
  scoring: "Оценка результата",
  feedback: "Обратная связь и итоги",
  design: "Оформление",
  review: "Комментарии",
};

/**
 * Адрес поля с ошибкой: в какой вкладке его искать (FR-20c). После перестройки ящика
 * адреса другие — состав и сценарий в одной вкладке, вердикт уехал к оценке, — поэтому
 * карта переписана целиком, а не дополнена.
 */
function tabForField(field: string): EditorTabKey {
  if (field === "sections" || field.startsWith("sections[") || field.startsWith("sections.")) {
    return "composition";
  }
  if (field === "flowMode" || field.startsWith("adaptive")) return "composition";
  // «Сценарий в ИС»: банк сценариев — на вкладке «Задание» (ключ той же вкладки).
  if (field === "scenario") return "composition";
  if (field.startsWith("scoring") || field.startsWith("passRules")) return "scoring";
  if (field.startsWith("scales") || field.startsWith("resultVariables")) return "scoring";
  if (field.startsWith("retakePolicy") || field.startsWith("runtime")) return "rules";
  return "main";
}

/**
 * Русское склонение слова «поле» при числе (2 поля, 5 полей).
 */
function pluralFields(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "полей";
  const mod10 = n % 10;
  if (mod10 === 1) return "поле";
  if (mod10 >= 2 && mod10 <= 4) return "поля";
  return "полей";
}

/**
 * Строка баннера, называющая САМУ проблему: сообщение первой находки плюс хвост
 * «Ещё N полей» — остальные автор увидит на месте, когда исправит эту.
 *
 * Перечислять все сообщения нельзя: их бывает десяток, и баннер вытеснил бы форму.
 * Молчать тоже нельзя — контракт «Индикация проблем» требует от баннера «сколько
 * проблем И В ЧЁМ ОНИ», а до этого он печатал только число.
 *
 * @param issues - Находки одного уровня (ошибки или предупреждения).
 * @param fieldCount - Сколько РАЗНЫХ адресов они занимают (то же число, что в заголовке).
 * @returns Готовая строка или `null`, если находок нет.
 */
function summarizeIssues(issues: ValidationIssue[], fieldCount: number): string | null {
  const first = issues[0];
  if (!first) return null;
  const rest = Math.max(0, fieldCount - 1);
  return rest === 0 ? first.message : `${first.message} Ещё ${rest} ${pluralFields(rest)}.`;
}

/**
 * Ближайший якорь `[data-field]` к адресу `field`: точное совпадение, иначе самый
 * ДЛИННЫЙ путь-предок.
 *
 * Длина решает потому, что адреса вложены друг в друга: у темы есть и общий
 * `sections` (кнопка «Добавить тему»), и `sections[0]` (карточка), и
 * `sections[0].drawCount` (поле). Прежний отбор брал первый подходящий в порядке
 * DOM, а кнопка добавления стоит ВЫШЕ карточек — поэтому переход к ошибке внутри
 * темы приводил автора к добавлению новой темы.
 *
 * @param root - Корень ящика редактора.
 * @param field - Адрес поля из находки проверки.
 * @returns Элемент-якорь или `null`, если подходящего адреса в DOM нет.
 */
function findFieldAnchor(root: HTMLElement, field: string): HTMLElement | null {
  const exact = root.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (exact) return exact;
  let best: HTMLElement | null = null;
  let bestLength = -1;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-field]"))) {
    const f = el.dataset.field;
    if (f === undefined) continue;
    if (!(field.startsWith(`${f}.`) || field.startsWith(`${f}[`))) continue;
    if (f.length > bestLength) {
      best = el;
      bestLength = f.length;
    }
  }
  return best;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Wide Drawer hosting the test editor. Thin wrapper that owns the
 * {@link useTestEditor} hook and delegates rendering to
 * {@link TestEditorView}.
 */
export function TestEditor(props: TestEditorProps): React.JSX.Element | null {
  const { testId, createMode, open, onClose } = props;
  const options = useMemo<UseTestEditorOptions | null>(() => {
    if (!open) return null;
    if (createMode) return { mode: "create", folderId: createMode.folderId };
    if (testId) return { mode: "edit", testId };
    return null;
  }, [open, createMode, testId]);
  const editor = useTestEditor(options);

  const { onCreated } = props;
  useEffect(() => {
    if (editor.createdId === null) return;
    const id = editor.createdId;
    editor.consumeCreatedId();
    // «Применить» создало тест и ящик не закрывает: работу продолжают с СОЗДАННЫМ
    // тестом, а для этого владелец состояния переводит ящик в режим правки. Без
    // обработчика поведение прежнее — закрыть.
    if (onCreated) onCreated(id);
    else onClose();
  }, [editor.createdId, editor, onClose, onCreated]);

  return (
    <TestEditorView
      open={open}
      onClose={onClose}
      editor={editor}
      initialTab={props.initialTab}
      focusReviewThreadId={props.focusReviewThreadId}
      onFeasibilityNotes={props.onFeasibilityNotes}
    />
  );
}

/**
 * Presentational Drawer that consumes a {@link UseTestEditorResult}.
 * Exported separately so tests can render a single shared editor instance
 * while exercising both `updateModel` and the Drawer's UI side-effects.
 */
export function TestEditorView(props: TestEditorViewProps): React.JSX.Element | null {
  const { open, onClose, editor } = props;
  /**
   * Вкладка по умолчанию — «Основное» (решение владельца 2026-09-22; открытый вопрос
   * приёмки эскизов, раздел A). Она отвечает на первый вопрос автора — что это за тест, —
   * и держит обязательное название. Пока ящик открывался на «Составе и сценарии», новый
   * тест встречал автора баннером «Название обязательно» и единственной видимой точкой у
   * «Состава»: поле, о котором шла речь, лежало на соседней вкладке.
   */
  const [activeTab, setActiveTab] = useState<EditorTabKey>(props.initialTab ?? "main");
  /**
   * PRD-52 FR-28: вопрос, открытый по переходу из комментария. Ящик редактора
   * вопроса монтируется ТОЛЬКО когда открыт: он тянет за собой охрану контента и
   * свои запросы, и держать его в ящике теста всё время — плата за то, что нужно
   * в редком случае.
   */
  const [reviewQuestionId, setReviewQuestionId] = useState<string | null>(null);
  /**
   * «Вопросы теста» → «Добавить вопрос»: тема нового вопроса. Тот же ящик вопроса, что
   * в «Темах и вопросах», в режиме создания; монтируется только пока открыт.
   */
  const [newQuestionTopicId, setNewQuestionTopicId] = useState<string | null>(null);
  const questionDrawerOpen = Boolean(reviewQuestionId) || Boolean(newQuestionTopicId);
  const reviewQuestions = useQuery<Question[]>({
    queryKey: ["/api/questions"],
    // Нужны в двух местах: открыть карточку вопроса по якорю и предложить вопросы
    // раздела во втором поле формы комментария. Второе — сразу на вкладке.
    enabled: questionDrawerOpen || activeTab === "review",
  });
  const reviewTopics = useQuery<Topic[]>({
    queryKey: ["/api/topics"],
    enabled: questionDrawerOpen,
  });
  // Подсказки подтем для ящика вопроса — как в «Темах и вопросах»: все теги банка.
  const tagSuggestions = useMemo(
    () =>
      questionDrawerOpen
        ? [...new Set((reviewQuestions.data ?? []).flatMap((q) => q.tags ?? []))].sort()
        : [],
    [questionDrawerOpen, reviewQuestions.data],
  );
  const reviewQuestion = reviewQuestionId
    ? (reviewQuestions.data ?? []).find((q) => q.id === reviewQuestionId) ?? null
    : null;
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);

  // Hoist design hook here so the unified drawer footer «Сохранить» drives
  // both the test-settings PUT and the design-settings PUT in a single
  // action (per wireframe prd7-design-tab.html — single footer save).
  //
  // В режиме создания теста ещё нет, поэтому хук получает привязку к черновику
  // редактора: набранное оформление хранится ТАМ и уезжает вместе с созданием
  // (`templateId` — телом создания, остальное — сразу после INSERT). Сам хук работает
  // как обычно: тянет манифест и правит этот черновик, так что панели не знают, в
  // каком режиме их открыли.
  const design = useDesignSettings(
    editor.model?.id,
    editor.mode === "create" && editor.model
      ? {
          draft: editor.model.design ?? { templateId: "default", params: {} },
          onChange: (next) => editor.updateModel((m) => ({ ...m, design: next })),
        }
      : undefined,
  );

  const { push: toast } = useToast();
  // PRD-52: свои комментарии подписываются «Вы» — панель отличает их по идентификатору.
  const auth = useOptionalAuth();

  // Hoist content-pages here too so the «Структура» section shares one hook
  // instance with the drawer — letting the tab reflect content-page warnings
  // (missing variant / unfilled required fields) in its status dot.
  // Pass the «Оформление» DRAFT template id so the variant catalogue (and the
  // «Сменить вариант» / add-page options) follows the in-progress template
  // selection immediately, before the design is saved.
  // В режиме создания страниц ещё нет: хук получает план — сценарий и темы, — и
  // ПРЕДСКАЗЫВАЕТ системные узлы тем же планировщиком, которым сервер разложит их в
  // транзакции создания. Автор настраивает структуру сразу, а сохранение дописывает
  // её по настоящим идентификаторам.
  const contentPages = useContentPages(
    editor.model?.id,
    design.draft.templateId,
    editor.mode === "create" && editor.model
      ? {
          flowMode: editor.model.flowMode,
          topicIds: editor.model.sections.map((s) => s.topicId),
        }
      : undefined,
  );
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
  // The Drawer stays mounted between openings, so the initial tab has to be
  // re-applied on each open — otherwise only the very first opening honours it.
  useEffect(() => {
    if (open) setActiveTab(props.initialTab ?? "main");
  }, [open, props.initialTab]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      // NFR-19: фокус уходит в ТЕЛО ящика. На первой вкладке он читался как «вы
      // здесь», и стрелки листали вкладки вместо прокрутки содержимого.
      const body = drawerRef.current?.querySelector<HTMLElement>(".ou-drawer__body");
      body?.focus();
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
  // design-settings draft and the content-pages «Структура» draft. All three are
  // buffered locally and committed together by «Сохранить»; `contentPages.isDirty`
  // lights up «Сохранить» after add / edit / drag / reorder / variant change.
  const combinedDirty = editor.isDirty || design.isDirty || contentPages.isDirty;
  const combinedSaving = editor.isSaving || design.isSaving;
  // Публикация НЕ запирает редактор. По BRD (раздел 4.7, BRC-20) публикуется
  // снапшот: доставка обслуживается им, а рабочая версия остаётся редактируемой
  // всегда, и правки не влияют на выдачу до переопубликации. Прежний замок был из
  // PRD-7 (`s-readonly`, до появления снапшотов) и пережил PRD-15 блок B: он
  // отбирал у автора правку шкал, показателей, оценки и структуры опубликованного
  // теста, хотя чинить методику после публикации — обычное дело. Признак
  // «опубликован, есть неопубликованные изменения» и действие «Опубликовать
  // изменения» (FR-12) живут в списке тестов и приходят с сервера в `publication`.

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
  // Предупреждения считаются отдельно: у них своя строка и свой переход. Сливать их
  // с ошибками в один баннер нельзя — автор перестанет понимать, что держит сохранение
  // (контракт «Индикация проблем», правило про два баннера).
  const warningFieldCount = useMemo(
    () => new Set(editor.validation.warnings.map((w) => w.field)).size,
    [editor.validation.warnings],
  );

  // Контракт «Индикация проблем»: баннер говорит, СКОЛЬКО проблем и В ЧЁМ ОНИ.
  // Один счётчик оставлял автора ни с чем, когда виноватое поле лежит в свёрнутой
  // карточке: на экране «Поля с ошибками: 1» и ни одной пометки.
  const errorSummary = useMemo(
    () => summarizeIssues(editor.validation.errors, errorFieldCount),
    [editor.validation.errors, errorFieldCount],
  );
  const warningSummary = useMemo(
    () => summarizeIssues(editor.validation.warnings, warningFieldCount),
    [editor.validation.warnings, warningFieldCount],
  );

  // FR-20c: per-field error index passed to every section so the exact
  // offending control is marked invalid (not just the tab badge / banner).
  const fieldErrors = useMemo(
    () => buildFieldErrorIndex(editor.validation.errors),
    [editor.validation.errors],
  );

  // Уровень проблемы по адресу — для точек на пунктах рейла: точка показывает ХУДШИЙ
  // уровень внутри подраздела, а индекс ошибок знает только ошибки.
  const issueLevel = useMemo(
    () => buildIssueLevel([...editor.validation.errors, ...editor.validation.warnings]),
    [editor.validation.errors, editor.validation.warnings],
  );

  /**
   * FR-20c: switch to the tab owning `field`, then scroll/focus the matching
   * input. Anchors are `data-field` attributes on the section formfields; an
   * exact match wins, otherwise the CLOSEST ancestor path (see
   * {@link findFieldAnchor}). Focus lands on the first focusable control inside it.
   *
   * Карточку, внутри которой лежит адрес, переход РАСКРЫВАЕТ: тело свёрнутой карточки
   * не смонтировано, поэтому ни точного якоря, ни сообщения об ошибке в DOM нет, и
   * автор приезжал к молчащей карточке (а до якоря на самой карточке — и вовсе к
   * кнопке «Добавить тему»: общий адрес `sections` висит на ней).
   */
  const goToError = useCallback((field: string) => {
    setActiveTab(tabForField(field));
    /**
     * Прокрутить к якорю и поставить фокус на его поле.
     *
     * @returns `false` — поле ещё скрыто (браузер не принимает фокус на невидимом
     * элементе), значит раскрытие карточки не доехало и попытку надо повторить.
     */
    const land = (anchor: HTMLElement): boolean => {
      anchor.scrollIntoView?.({ block: "center" });
      // Поле вперёд кнопок: у числового поля DS первыми в разметке идут стрелки
      // «Уменьшить»/«Увеличить», и фокус доставался им — автор приезжал к ошибке,
      // а под курсором оказывалось действие, меняющее значение.
      const control = anchor.matches("input, textarea, select, button, [tabindex]")
        ? anchor
        : anchor.querySelector<HTMLElement>("input, textarea, select") ??
          anchor.querySelector<HTMLElement>("button, [tabindex]");
      control?.focus();
      const landed = control == null || document.activeElement === control;
      // Программный `focus()` не считается «видимым» фокусом: `:focus-visible` браузер
      // ставит по клавиатуре, а не по вызову из кода, — и после перехода поле выглядит
      // ровно как соседние. Кольцо ставим сами и снимаем, когда поле покинут; на
      // неудавшейся попытке не ставим вовсе — снять его было бы уже нечем.
      const box = anchor.matches(".ou-field, .ou-textarea, .ou-select")
        ? anchor
        : anchor.querySelector<HTMLElement>(".ou-field, .ou-textarea, .ou-select");
      if (box && landed) {
        box.classList.add("is-focused");
        control?.addEventListener("blur", () => box.classList.remove("is-focused"), { once: true });
      }
      return landed;
    };
    // Defer to the next macrotask so the freshly-activated tab has rendered.
    window.setTimeout(() => {
      const root = drawerRef.current;
      if (!root) return;
      const anchor = findFieldAnchor(root, field);
      if (!anchor) return;
      // Сначала просим раскрыться всё, внутри чего лежит адрес. Событие ВСПЛЫВАЕТ,
      // поэтому вложенность разбирается сама: каждая свёрнутая карточка на пути
      // слышит его и открывается. Угадывать это по DOM нельзя — тело свёрнутой
      // карточки остаётся в разметке (её прячет CSS), так что и «точный» якорь
      // находится, и фокус на нём молча не встаёт: автор приезжал в никуда.
      anchor.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }));
      // Раскрытие доезжает не мгновенно, а пока карточка закрыта, поле не принимает
      // фокус. Пробуем несколько кадров подряд и сдаёмся, чтобы не крутиться вечно.
      const tryLand = (attempt: number) => {
        const root2 = drawerRef.current;
        if (!root2) return;
        if (land(findFieldAnchor(root2, field) ?? anchor)) return;
        if (attempt < 5) window.setTimeout(() => tryLand(attempt + 1), 32);
      };
      tryLand(0);
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
    const wasDirty = editor.isDirty || design.isDirty || contentPages.isDirty;
    // Идентификатор только что созданного теста читается СРАЗУ после сохранения, без
    // ожиданий между: дальше идут `await`, а ящик закрывается по появлению этого
    // идентификатора, и между ними успевает встать перерисовка.
    let createdId: string | null = null;
    if (editor.isDirty) {
      const ok = await editor.save();
      if (!ok) return false;
      createdId = editor.getCreatedId();
    }
    if (design.isDirty) {
      await design.save();
    }
    // Commit the «Структура» draft AFTER the design — so a template switch is
    // persisted first and the content pages validate/persist against it. On a
    // commit failure keep the drawer open (error surfaced via the structure banner).
    //
    // Идентификатор только что созданного теста читается СИНХРОННО (`getCreatedId`):
    // до этого момента структура была предсказанием, и дописывать её надо по тому
    // адресу, который вернуло создание, а не ждать перерисовки.
    if (contentPages.isDirty) {
      try {
        await contentPages.commit(createdId ?? undefined);
      } catch {
        // Тест уже создан, а дописать структуру не удалось: ящик всё равно закроется
        // (его закрывает появление идентификатора), поэтому баннер внутри никто не
        // увидит — говорим отдельно и называем, что делать.
        if (createdId) {
          toast({
            tone: "success", title: "Тест создан, но структуру дописать не удалось",
            description: "Откройте тест и сохраните структуру ещё раз.",
          });
        }
        return false;
      }
    }
    if (wasDirty) {
      toast({ tone: "success", title: "Изменения сохранены" });
      // Refresh the tests list so its server-computed columns re-run — notably the
      // PRD-22 «недоступный вариант» mark (`unmappedPageCount`), which otherwise
      // kept its stale count after the author remapped the pages here.
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
    }
    return true;
  }, [design, editor, contentPages, toast, queryClient]);

  // PRD-15 FR-05: сохранили — и сразу сказали, если выдавать вопросы по этому
  // составу нечем. Строки уходят наверх: ящик закрывается этим же обработчиком.
  const reportFeasibility = useCallback(() => {
    const findings = editor.getFeasibility();
    if (findings.length === 0) return;
    props.onFeasibilityNotes?.(
      findings.map(
        (finding) => `${finding.topicName}: ${finding.issues.map(describeFeasibilityState).join("; ")}`,
      ),
    );
  }, [editor, props]);

  /**
   * «Применить» — записать набранное и ОСТАТЬСЯ в ящике. Закрытие — отдельное
   * действие («Закрыть»), поэтому здесь его нет: автор применяет правки по ходу
   * работы столько раз, сколько нужно.
   *
   * В режиме создания это же нажатие создаёт тест; ящик остаётся открытым и
   * переключается на созданный (см. `onCreated`).
   */
  const handleApply = useCallback(async () => {
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
    reportFeasibility();
  }, [saveAll, saveDisabled, editor.model?.id, editor.validation.warnings.length, queryClient, reportFeasibility]);

  const handleSaveAndExit = useCallback(async () => {
    if (hasErrors) return;
    const ok = await saveAll();
    if (!ok) return;
    setCloseDialogOpen(false);
    reportFeasibility();
    onClose();
  }, [hasErrors, onClose, saveAll]);

  const handleExitWithoutSave = useCallback(() => {
    setCloseDialogOpen(false);
    editor.reset();
    design.revert();
    // Discard the buffered «Структура» draft so exit-without-save rolls back add /
    // edit / reorder / variant changes too (full rollback).
    contentPages.discard();
    onClose();
  }, [contentPages, design, editor, onClose]);

  const statusTag = useMemo(() => deriveStatusTag(editor, combinedDirty), [editor, combinedDirty]);

  /**
   * Содержимое разделов для второго поля формы комментария: вопросы банка и страницы
   * содержания этого теста. Собирается здесь, а не в панели: состав теста знает ящик,
   * а панель не должна ходить за ним сама.
   */
  const reviewAnchorItems = useMemo<ReviewAnchorItem[]>(() => {
    const topicIds = new Set((editor.model?.sections ?? []).map((s) => s.topicId));
    const questions = (reviewQuestions.data ?? [])
      .filter((q) => q.topicId && topicIds.has(q.topicId))
      .map((q, index) => ({
        id: q.id,
        // Формулировка бывает длинной, и в списке от неё нужен только опознавательный
        // кусок — номер несёт остальное.
        label: `Вопрос ${index + 1}: ${(q.prompt ?? "").slice(0, 60)}`,
        kind: "question" as const,
        topicId: q.topicId ?? null,
      }));
    const pages = contentPages.pages
      .filter((page) => page.topicId && topicIds.has(page.topicId))
      .map((page) => ({
        id: page.id,
        label: `Страница: ${page.templateKey ?? page.type}`,
        kind: "content-page" as const,
        topicId: page.topicId,
      }));
    return [...questions, ...pages];
  }, [editor.model?.sections, reviewQuestions.data, contentPages.pages]);

  // Счётчик открытых веток на вкладке. Запрос тот же, что у панели рецензирования, —
  // React Query отдаёт его из кэша, второго обращения к серверу не будет.
  const { openCount: reviewOpenCount } = useReviewComments(editor.model?.id ?? "", {
    enabled: Boolean(editor.model?.id) && editor.mode !== "create",
  });

  const tabItems = useMemo<TabItem<EditorTabKey>[]>(
    () =>
      TAB_ORDER
        // PRD-52: комментарии привязаны к СУЩЕСТВУЮЩЕМУ тесту. У создаваемого ветки жить
        // негде — вкладка появляется у сохранённого. Признак берётся из РЕЖИМА ящика, а не
        // из загруженной модели: иначе полоса вкладок дёргалась бы по приходу ответа.
        .filter((tab) => tab !== "review" || editor.mode !== "create")
        .map((tab) => {
          const base = editor.tabStatuses[tab];
          // The «Структура» tab folds in content-page warnings (missing variant /
          // unfilled required fields) on top of its own draft status.
          const status =
            tab === "composition"
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
                {/* «Сценарий в ИС»: вкладка состава у теста «Сценарий» называется «Задание». */}
                {tab === "composition" && editor.model?.mode === "scenario" ? "Задание" : TAB_LABELS[tab]}
                {/* PRD-52: на вкладке комментариев — счётчик ОТКРЫТЫХ веток. Точка
                    состояния говорит «тут что-то есть», а число — сколько ещё ждёт
                    ответа, и ради него не нужно открывать вкладку. */}
                {tab === "review" && reviewOpenCount > 0 && (
                  <Tag tone="warning" size="s" data-testid="tab-review-open-count">
                    {reviewOpenCount}
                  </Tag>
                )}
                <StatusBadge status={status} />
              </>
            ),
          };
        }),
    [editor.mode, editor.model?.mode, editor.tabStatuses, structureWarn, reviewOpenCount],
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
      className="ou-drawer-root ou-drawer-root--right"
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
            // Tabs that render an `ou-drawer__split` (rail + content) need the
            // flush body so the split fills the full height — otherwise a short
            // pane (e.g. the Scales empty state) leaves a gap below.
            (activeTab === "main" || activeTab === "review" ? "" : " ou-drawer__body--flush")
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

            `display: contents` on the wrapper is critical — without it the
            div becomes a flex child of .ou-drawer__body (which uses flex
            column layout), breaking the scroll cascade for direct content
            children (Composition / Settings / Design tabs lose scroll;
            Structure works only because it carries its own scroll
            container). With display:contents the wrapper is removed from
            layout but `inert` still propagates to its descendants.
          */}
          {/* React 19 types `inert` as a boolean and treats the old `""` as FALSE — the wrapper
              was never inert and the author could keep editing a draft being saved. */}
          <div className="tb-saving-inert-wrap" inert={combinedSaving || undefined}>
          {/* Стопка баннеров липнет ЦЕЛИКОМ: два sticky-баннера с одинаковым `top`
              наезжают друг на друга, и нижний закрывает верхний вместе с действием.
              Ошибки выше предупреждений — у них разные последствия. */}
          {(hasErrors || warningFieldCount > 0) && (
            <div className="tb-alerts" data-testid="test-editor-alerts">
              {hasErrors && (
                <Banner
                  tone="error"
                  title={`Поля с ошибками: ${errorFieldCount}`}
                  description={
                    errorSummary
                      ? `${errorSummary} Сохранение недоступно, пока есть ошибки.`
                      : "Исправьте отмеченные поля — сохранение недоступно, пока есть ошибки."
                  }
                  actions={
                    editor.validation.errors.length > 0
                      ? [
                          {
                            label: "Перейти к ошибкам",
                            onClick: () => goToError(editor.validation.errors[0].field),
                          },
                        ]
                      : undefined
                  }
                  data-testid="test-editor-error-summary"
                />
              )}
              {warningFieldCount > 0 && (
                <Banner
                  tone="warning"
                  title={`Предупреждения: ${warningFieldCount}`}
                  description={
                    warningSummary
                      ? `${warningSummary} Сохранить можно, но посмотрите — вероятно, задумано было иначе.`
                      : "Сохранить можно, но посмотрите — вероятно, задумано было иначе."
                  }
                  actions={[
                    {
                      label: "Перейти к предупреждениям",
                      onClick: () => goToError(editor.validation.warnings[0].field),
                    },
                  ]}
                  data-testid="test-editor-warning-summary"
                />
              )}
            </div>
          )}
          {editor.saveError && (
            <Banner
              tone="error"
              title="Не удалось сохранить тест"
              description={
                // Сбой на ДОЗАПИСИ: сам тест уже создан, повтор допишет остальное в
                // него же и второго теста не создаст. Без этой строки автор читает
                // «не удалось сохранить» и не знает, что тест уже есть.
                editor.mode === "create" && editor.getCreatedId()
                  ? `Тест создан, но часть настроек дописать не удалось: ${editor.saveError.message}. Нажмите «Сохранить» ещё раз — повтор дополнит этот же тест.`
                  : editor.saveError.message
              }
              onClose={editor.dismissSaveError}
              data-testid="test-editor-save-error"
            />
          )}
          {editor.model && activeTab === "main" && (
            <MainTab
              model={editor.model}
              updateModel={editor.updateModel}
              fieldErrors={fieldErrors}
              issueLevel={issueLevel}
            />
          )}
          {/* «Сценарий в ИС»: у теста «Сценарий» вместо состава и сценария прохождения — задание. */}
          {editor.model && activeTab === "composition" && editor.model.mode === "scenario" && (
            <ScenarioTaskSection
              model={editor.model}
              updateModel={editor.updateModel}
              testId={editor.model.id}
              content={contentPages}
              savedFlowMode={editor.savedFlowMode}
              designDraft={design.draft}
            />
          )}
          {editor.model && activeTab === "composition" && editor.model.mode !== "scenario" && (
            <CompositionTab
              model={editor.model}
              updateModel={editor.updateModel}
              fieldErrors={fieldErrors}
              issueLevel={issueLevel}
              testId={editor.model.id}
              content={contentPages}
              savedFlowMode={editor.savedFlowMode}
              designDraft={design.draft}
              onOpenQuestion={setReviewQuestionId}
              onCreateQuestion={setNewQuestionTopicId}
            />
          )}
          {editor.model && activeTab === "rules" && (
            <RulesTab
              model={editor.model}
              updateModel={editor.updateModel}
              fieldErrors={fieldErrors}
              issueLevel={issueLevel}
              // Параметры прогресса объявляет шаблон: рисуются они ЧЕРНОВИКОМ
              // «Оформления», иначе автор правил бы уже выбранный, но не сохранённый
              // шаблон вслепую.
              design={design}
            />
          )}
          {editor.model && activeTab === "scoring" && (
            <ScoringTab
              model={editor.model}
              updateModel={editor.updateModel}
              fieldErrors={fieldErrors}
              issueLevel={issueLevel}
              testId={editor.model.id}
            />
          )}
          {editor.model && activeTab === "feedback" && (
            <FeedbackTab
              model={editor.model}
              updateModel={editor.updateModel}
              fieldErrors={fieldErrors}
              issueLevel={issueLevel}
              design={design}
              // Э2.4: реестр «По вопросам» уводит правку в редактор вопроса. Открывается тем
              // же ящиком ПОВЕРХ, что и переход из комментария (PRD-52 FR-28): ящик теста
              // остаётся смонтированным, и автор возвращается на то же место реестра.
              onOpenQuestion={setReviewQuestionId}
            />
          )}
          {editor.model && activeTab === "design" && (
            <DesignSection
              testId={editor.model.id}
              design={design}
              // PRD-47 §6.2: облик отчёта правит `model.report` — хранение осталось
              // своей колонкой, переехал только элемент интерфейса.
              model={editor.model}
              updateModel={editor.updateModel}
            />
          )}
          {editor.model?.id && activeTab === "review" && (
            <div className="tb-settings-content" data-testid="settings-pane-review">
              <ReviewPanel
                testId={editor.model.id}
                mode="editor"
                canResolve
                currentUserId={auth?.user?.id}
                // Место комментария автор выбирает из РАЗДЕЛОВ этого теста: панель сама
                // не ходит за составом, его знает ящик.
                anchorOptions={{
                  topics: editor.model.sections.map((s) => ({ id: s.topicId, name: s.topicName })),
                  items: reviewAnchorItems,
                }}
                onNavigate={(target) => {
                  // Вопрос открывается ЯЩИКОМ ПОВЕРХ этого: ящик теста остаётся
                  // смонтированным, поэтому после правки автор возвращается в то же
                  // место списка комментариев, а не собирает контекст заново.
                  if (target.target === "question-editor") setReviewQuestionId(target.questionId);
                  else if (target.target === "test-editor") setActiveTab(target.tab);
                }}
                focusThreadId={props.focusReviewThreadId}
              />
            </div>
          )}
          {!editor.model && <TabPlaceholder tab={activeTab} />}
          {reviewQuestionId ? (
            <QuestionEditorDrawer
              open={Boolean(reviewQuestion)}
              question={reviewQuestion}
              topics={reviewTopics.data ?? []}
              tagSuggestions={tagSuggestions}
              onClose={() => setReviewQuestionId(null)}
              onSaved={() => setReviewQuestionId(null)}
            />
          ) : newQuestionTopicId ? (
            <QuestionEditorDrawer
              open
              question={null}
              defaultTopicId={newQuestionTopicId}
              topics={reviewTopics.data ?? []}
              tagSuggestions={tagSuggestions}
              onClose={() => setNewQuestionTopicId(null)}
              onSaved={() => setNewQuestionTopicId(null)}
            />
          ) : null}
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
          data-state={combinedDirty ? "dirty" : "default"}
        >
          {/* Причина, по которой «Сохранить» заперто. Кнопка `disabled` не читается
              скринридером, и без этой строки блокировка выглядит поломкой. */}
          {hasErrors && (
            <span id="test-editor-save-blocked" className="ou-sr-only">
              Сначала исправьте ошибки в выделенных секциях.
            </span>
          )}
          {/* Тег состояния и список правок нужны только когда правки есть; три
              действия стоят всегда и запираются по смыслу — прыгающий подвал хуже
              заперной кнопки, потому что кнопка на месте, а состав кнопок нет. */}
          {combinedDirty && (
            <>
              <Tag tone="warning" data-testid="test-editor-foot-dirty-tag">
                Изменено
              </Tag>
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
            </>
          )}
          <Button
            variant="secondary"
            size="m"
            // Отказ от набранного: откатывает черновик и закрывает ящик СРАЗУ, без
            // вопроса «сохранить перед закрытием» — автор уже сказал, чего хочет.
            // Вопрос принадлежит неоднозначным путям выхода: «Закрыть», крестику и
            // клику по подложке.
            onClick={handleExitWithoutSave}
            disabled={!combinedDirty || combinedSaving}
            data-testid="test-editor-cancel"
          >
            Отменить
          </Button>
          <Button
            variant="primary"
            size="m"
            disabled={saveDisabled}
            aria-disabled={saveDisabled ? "true" : "false"}
            aria-describedby={hasErrors ? "test-editor-save-blocked" : undefined}
            onClick={handleApply}
            loading={combinedSaving}
            data-testid="test-editor-save"
          >
            {combinedSaving ? "Сохранение…" : "Применить"}
          </Button>
          <Button
            variant="ghost"
            size="m"
            // Выход. Есть неприменённое — спрашиваем, как и крестик в шапке.
            // Свой `testid`: у крестика в шапке уже занят `test-editor-close`.
            onClick={requestClose}
            disabled={combinedSaving}
            data-testid="test-editor-foot-close"
          >
            Закрыть
          </Button>
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
  // Точка одна на весь ящик: вкладка, пункт рейла и карточка объекта показывают
  // состояние ОДНИМ классом `tb-status-dot`. Своя копия с другими размерами и другим
  // цветом «изменено» рассказывала бы про то же самое иначе.
  const cls = status.error
    ? "tb-status-dot tb-status-dot--err"
    : status.warning
      ? "tb-status-dot tb-status-dot--warn"
      : status.dirty
        ? "tb-status-dot tb-status-dot--warn"
        : null;
  if (!cls) return null;
  const aria = status.error
    ? "Есть ошибки"
    : status.warning
      ? "Есть предупреждения"
      : "Есть несохранённые изменения";
  return <span className={cls} aria-label={aria} />;
}

function TabPlaceholder({ tab }: { tab: EditorTabKey }) {
  const desc: Record<EditorTabKey, string> = {
    main: "Название, описание, режим теста и интеграция.",
    composition: "Темы и выборка вопросов, уровни адаптивного теста, сценарий.",
    rules: "Навигация, что видно во время прохождения, ограничения и защита контента.",
    scoring: "Цена ответа, вердикт теста и тем, шкалы и показатели.",
    feedback: "Что участник узнаёт о результате: итоги, тексты и отчёт.",
    design: "Шаблон и объявленный им облик: цвета, шрифты, фоны и логотип.",
    review: "Комментарии коллег к этому тесту.",
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
                      <ArrowRight size={12} className="tb-changes-popover__arrow" aria-hidden="true" />
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
    main: [],
    composition: [],
    rules: [],
    scoring: [],
    feedback: [],
    design: [],
    review: [],
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
      tab: "main",
      field: "title",
      label: "Название",
      oldValue: snap.basic.title,
      newValue: draft.basic.title,
    },
    {
      tab: "main",
      field: "description",
      label: "Описание",
      oldValue: snap.basic.description || "не задано",
      newValue: draft.basic.description || "не задано",
    },
    {
      tab: "main",
      field: "mode",
      label: "Режим теста",
      oldValue: fmtMode(snap.mode),
      newValue: fmtMode(draft.mode),
    },
    {
      tab: "composition",
      field: "flowMode",
      label: "Сценарий прохождения",
      oldValue: fmtFlow(snap.flowMode),
      newValue: fmtFlow(draft.flowMode),
    },
    {
      tab: "rules",
      field: "timeLimitMinutes",
      label: "Лимит времени",
      oldValue: fmtMinutes(snap.runtime.timeLimitMinutes),
      newValue: fmtMinutes(draft.runtime.timeLimitMinutes),
    },
    {
      tab: "rules",
      field: "maxAttempts",
      label: "Максимум попыток",
      oldValue: fmtAttempts(snap.runtime.maxAttempts),
      newValue: fmtAttempts(draft.runtime.maxAttempts),
    },
    {
      tab: "feedback",
      field: "showCorrectAnswers",
      label: "Показывать правильные ответы после ответа",
      oldValue: fmtBool(snap.runtime.showCorrectAnswers),
      newValue: fmtBool(draft.runtime.showCorrectAnswers),
    },
    {
      tab: "main",
      field: "webhookUrl",
      label: "Webhook URL",
      oldValue: snap.basic.webhookUrl || "не задан",
      newValue: draft.basic.webhookUrl || "не задан",
    },
    {
      tab: "main",
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
      // Размер m — как в эскизе. Три действия в него помещаются: замер утверждённого
      // эскиза даёт 456px кнопок на 560px модалки. Таблица различий узкая (две
      // колонки значений), и её ширины хватает.
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
            title="Записать ваши изменения поверх серверной версии. Чужие правки будут перезаписаны."
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
            title="Загрузить серверную версию. Ваши несохранённые правки будут потеряны."
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
      aria-label="Различия версий"
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
      label: "Показывать правильные ответы после ответа",
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

import type { TagProps } from "@skillum/ui-kit";

/**
 * Тег в шапке ящика.
 *
 * `dirty` приходит СНАРУЖИ и равен тому же признаку, по которому живёт подвал:
 * несохранённой бывает не только правка настроек, но и оформление, и структура
 * страниц. Пока тег считал только черновик настроек, правка оформления давала
 * «грязный» подвал при спокойной шапке.
 */
function deriveStatusTag(
  editor: ReturnType<typeof useTestEditor>,
  dirty: boolean,
): {
  tone: TagProps["tone"];
  label: string;
  ariaLabel: string;
} {
  // A-17: об ошибках говорят точки и баннер — три места на проблему, и тег шапки в
  // их число не входит (контракт «Индикация проблем»). Подменяя статус публикации,
  // тег отнимал у автора единственное место, где виден этот статус.
  if (dirty) {
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
