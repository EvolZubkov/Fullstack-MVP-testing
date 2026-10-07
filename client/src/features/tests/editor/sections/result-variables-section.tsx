/**
 * @module features/tests/editor/sections/result-variables-section
 * @description «Показатели» editor tab (PRD-2). Lists the test's result
 * variables as reorderable accordion cards. Each card is three blocks:
 * (1) Имя · Метка, (2) Формула (Конструктор/DSL → шаблон → расчёт), (3) Вывод
 * (видимость для обучающегося + управление статусом — только для булевых — +
 * передача в LMS). The result type
 * is DERIVED (template in the constructor, inferred from the formula in DSL mode)
 * — there is no manual «Тип» field. Edits flow into the test draft via
 * `updateModel`; the single drawer «Сохранить» persists them through the
 * diff-on-save orchestrator (see use-test-editor / result-variables-api).
 *
 * Source of truth for the layout: docs/wireframes/approved/prd2-prd5-scoring-tabs.html
 * (states s-indicators / порог / категория / взвеш / вердикт / DSL+функции).
 * Pure DSL generation lives in {@link module:features/tests/editor/result-variables-builder}.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  Button,
  EmptyState,
  FormActions,
  FormSection,
  Grid,
  IconButton,
  Input,
  ModalDialog,
  Select,
  SegmentedControl,
  Switch,
  Textarea,
} from "@skillum/ui-kit";
import { ChevronDown, GripVertical, Info, Plus, Trash2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  collectStringLiterals,
  findUnknownOutcomes,
  readScaleGroup,
  resolveScaleGroup,
} from "@shared/formula/outcome-literals";
import { parseGroupThreshold } from "@shared/formula/scale-group";
import { outcomeMatchKey } from "@shared/scales/interpretation";
import { profileMatrix, type ProfileMatrixRow } from "../profile-matrix";
import { PROFILE_THRESHOLD_MESSAGE, profileFindings, profileSetCountHint } from "../profile-diagnostics";

import type { LearnerVisibility, Valence } from "@shared/scales/interpretation";

import type {
  OutcomeModel,
  ResultVariableControlsStatus,
  ResultVariableModel,
  ResultVariableScormTarget,
  ResultVariableType,
  TestEditorModel,
} from "../test-editor.types";
import { EMPTY_FIELD_ERRORS, type FieldErrorIndex } from "../field-errors";
import {
  validateResultVariableFormula,
  type ResultVariableFormulaValidation,
} from "../result-variables-api";
import { FoldAllButtons, useSectionFold } from "./section-fold";
import {
  TEMPLATE_OPTIONS,
  TEMPLATE_TYPE,
  NUM_OPERATORS,
  LEVEL_OPERATORS,
  DSL_FUNCTION_GROUPS,
  thresholdDsl,
  verdictDsl,
  categoryDsl,
  weightedDsl,
  buildProfileFormula,
  defaultCondition,
  elementOptions,
  propertyOptions,
  levelOptions,
  firstProperty,
  unitOf,
  type BuilderTemplate,
  type Condition,
  type ScaleRef,
  type TopicRef,
} from "../result-variables-builder";
import {
  bandSpan,
  CardSlotToggles,
  DomainFields,
  VALENCE_OPTIONS,
  VISIBILITY_OPTIONS,
} from "./scales-section";
import { reachesLmsReport } from "@shared/lms-export/meta";
import { LevelsEditor } from "./levels-editor";
import { OutcomesEditor } from "./outcomes-editor";

const STATUS_OPTIONS: Array<{ value: ResultVariableControlsStatus; label: string }> = [
  { value: "none", label: "Не управляет" },
  { value: "success", label: "Ставит «Пройден», когда истина" },
  { value: "completion", label: "Ставит «Завершён», когда истина" },
];

const TARGET_OPTIONS: Array<{ value: ResultVariableScormTarget; label: string }> = [
  { value: "none", label: "Не передавать" },
  { value: "suspend_data", label: "Только в пакете" },
  { value: "interaction", label: "Столбцом в отчёте" },
  { value: "both", label: "И то, и другое" },
];

const TYPE_LABEL: Record<ResultVariableType, string> = {
  number: "число",
  string: "строка",
  boolean: "булево",
};

let localKeyCounter = 0;

/**
 * Stable per-row key: the server id once persisted, else the client key assigned
 * at creation. Must not depend on editable fields, or typing into the row would
 * remount the card (losing focus and the expanded state).
 */
function rowKey(v: ResultVariableModel, index: number): string {
  return v.id ?? v.clientKey ?? `row-${index}`;
}

function emptyVariable(sortOrder: number): ResultVariableModel {
  localKeyCounter += 1;
  return {
    clientKey: `rv-${localKeyCounter}`,
    name: "",
    label: "",
    type: "boolean",
    formula: "",
    learnerVisibility: "hidden",
    scormTarget: "both",
    controlsStatus: "none",
    bands: [],
    outcomes: [],
    domainMin: null,
    domainMax: null,
    valence: "none",
    sortOrder,
  };
}

export type ResultVariablesSectionProps = {
  model: TestEditorModel;
  /** Test id; `undefined` in create mode — disables live formula validation. */
  testId?: string;
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  readOnly?: boolean;
  /** FR-20c: per-field validation errors for inline highlighting. */
  fieldErrors?: FieldErrorIndex;
};

export function ResultVariablesSection({
  model,
  testId,
  updateModel,
  readOnly = false,
  fieldErrors = EMPTY_FIELD_ERRORS,
}: ResultVariablesSectionProps) {
  const vars = model.resultVariables;

  /**
   * Свёртка карточек показателя. Прежде это был аккордеон на одну открытую карточку:
   * раскрыть второй показатель значило закрыть первый, и сравнить два рядом было нельзя,
   * а «развернуть все» такой моделью не выражается вовсе. Теперь — та же свёртка, что у
   * остальных списков ящика: открыто может быть сколько угодно, и есть пара кнопок.
   * `startCollapsed`, потому что список открывается свёрнутым, как и раньше; новый
   * показатель в набор свёрнутых не попадает и появляется раскрытым.
   */
  const fold = useSectionFold(
    vars.map((v, i) => rowKey(v, i)),
    true,
  );

  /** Формула соседа по имени: карточке нужно пройти по `var()` (см. `carriedProfile`). */
  const formulaOf = useCallback(
    (name: string) => vars.find((x) => x.name === name)?.formula,
    [vars],
  );

  // Topics feed the «Элемент» picker (topicById(...)) — by name for the author,
  // by id in the generated DSL.
  const topics = useMemo<TopicRef[]>(
    () => model.sections.map((s) => ({ id: s.topicId, name: s.topicName, code: s.topicCode ?? null })),
    [model.sections],
  );

  // Scales feed the «Элемент» / «Шкала» pickers (scaleById(...)) — by label/key
  // and, for the «Категория» template, the band levels of each scale.
  const scales = useMemo<ScaleRef[]>(
    () =>
      model.scales.map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description,
        normalization: s.normalization,
        levels: Array.from(
          new Set(s.bands.map((b) => b.level.trim()).filter((l) => l !== "")),
        ),
      })),
    [model.scales],
  );

  const setVars = useCallback(
    (next: ResultVariableModel[]) => {
      updateModel((m) => ({ ...m, resultVariables: next }));
    },
    [updateModel],
  );

  const updateVar = useCallback(
    (index: number, patch: Partial<ResultVariableModel>) => {
      updateModel((m) => ({
        ...m,
        resultVariables: m.resultVariables.map((v, i) =>
          i === index ? { ...v, ...patch } : v,
        ),
      }));
    },
    [updateModel],
  );

  const addVariable = useCallback(() => {
    setVars([...vars, emptyVariable(vars.length)]);
  }, [vars, setVars]);

  const removeVariable = useCallback(
    (index: number) => {
      setVars(vars.filter((_, i) => i !== index).map((v, i) => ({ ...v, sortOrder: i })));
    },
    [vars, setVars],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = vars.findIndex((v, i) => rowKey(v, i) === active.id);
      const to = vars.findIndex((v, i) => rowKey(v, i) === over.id);
      if (from < 0 || to < 0) return;
      const next = [...vars];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setVars(next.map((v, i) => ({ ...v, sortOrder: i })));
    },
    [vars, setVars],
  );

  const ids = useMemo(() => vars.map((v, i) => rowKey(v, i)), [vars]);

  // Empty tab: a full-page DS empty state with the primary action inside (no
  // header row), per docs/wireframes/approved/prd2-prd5-scoring-tabs.html
  // (s-indicators-empty) — mirrors the «Список шкал» empty state.
  if (vars.length === 0) {
    return (
      <div className="tb-settings-content" data-testid="metrics-section">
        <EmptyState
          layout="page"
          well
          art={<Info aria-hidden="true" />}
          title="Пока нет показателей"
          description="Показатель — это формула над результатами теста (категория, флаг, итоговый вердикт). Добавьте первый показатель."
          actions={
            !readOnly ? (
              <Button
                variant="primary"
                size="s"
                leadingIcon={<Plus size={16} aria-hidden="true" />}
                onClick={addVariable}
                data-testid="metrics-empty-add"
              >
                Добавить показатель
              </Button>
            ) : undefined
          }
          data-testid="metrics-empty"
        />
      </div>
    );
  }

  return (
    <div className="tb-settings-content" data-testid="metrics-section">
      <FormSection stacked title="Показатели">
        {/* Строка действий рисуется и в режиме чтения: свёртка — это навигация по
            списку, а не правка, и читателю она нужна не меньше. */}
        {(!readOnly || vars.length > 1) && (
          <FormActions align="between">
            {!readOnly ? (
              <Button
                variant="ghost"
                size="s"
                leadingIcon={<Plus size={16} aria-hidden="true" />}
                onClick={addVariable}
                data-testid="metrics-add"
              >
                Добавить показатель
              </Button>
            ) : (
              <span />
            )}
            {vars.length > 1 && <FoldAllButtons fold={fold} testIdPrefix="metrics" />}
          </FormActions>
        )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {vars.map((variable, index) => {
            const key = rowKey(variable, index);
            return (
              <SortableVariableCard
                key={key}
                id={key}
                index={index}
                variable={variable}
                topics={topics}
                scales={scales}
                testId={testId}
                readOnly={readOnly}
                fieldErrors={fieldErrors}
                formulaOf={formulaOf}
                expanded={fold.isOpen(key)}
                onToggle={() => fold.toggle(key)}
                onChange={(patch) => updateVar(index, patch)}
                onRemove={() => removeVariable(index)}
              />
            );
          })}
        </SortableContext>
      </DndContext>
      </FormSection>
    </div>
  );
}

// ─── Per-variable card ────────────────────────────────────────────────────────

type CardProps = {
  id: string;
  index: number;
  variable: ResultVariableModel;
  topics: TopicRef[];
  scales: ScaleRef[];
  testId?: string;
  readOnly: boolean;
  fieldErrors: FieldErrorIndex;
  formulaOf: (name: string) => string | undefined;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ResultVariableModel>) => void;
  onRemove: () => void;
};

function SortableVariableCard(props: CardProps) {
  const { variable: v, expanded, readOnly } = props;
  const sortable = useSortable({ id: props.id, disabled: readOnly });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : undefined,
  };

  const subtitle = [
    TYPE_LABEL[v.type],
    `порядок ${props.index + 1}`,
    v.controlsStatus !== "none" ? "управляет статусом" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const heading = `${v.name || "новый показатель"}${v.label ? ` — ${v.label}` : ""}`;

  // Контракт «Индикация проблем»: свёрнутая карточка сама говорит об ошибке внутри
  // себя — точкой в шапке. Тело живёт только развёрнутым, и без точки карточка
  // молчала бы о проблеме, которую сводный баннер уже посчитал. `has` матчит и
  // потомков: точка загорается от любой ошибки внутри показателя.
  const hasIssue = props.fieldErrors.has(`resultVariables[${props.index}]`);
  // Находки самого показателя (PRD-53, профиль) адресованы КАРТОЧКЕ целиком —
  // отдельного поля у них нет.
  const cardError = props.fieldErrors.get(`resultVariables[${props.index}]`);

  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      className={"ou-card ou-card--outlined ou-card--sm tb-level-card" + (expanded ? "" : " is-collapsed")}
      data-testid={`metrics-card-${props.index}`}
      data-field={`resultVariables[${props.index}]`}
    >
      <header className="ou-card__header tb-level-card__head">
        {hasIssue && (
          <span
            className="tb-status-dot tb-status-dot--err"
            aria-label="Есть ошибки"
            data-testid={`metrics-card-dot-${props.index}`}
          />
        )}
        {!readOnly && (
          <button
            type="button"
            className="tb-level-card__chev"
            aria-label="Перетащить показатель"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical width={16} height={16} aria-hidden="true" />
          </button>
        )}
        <div className="ou-card__heading tb-level-card__heading">
          <h5 className="ou-card__title tb-level-card__title">{heading}</h5>
          <p className="ou-card__subtitle tb-level-card__summary">{subtitle}</p>
        </div>
        <div className="ou-card__trail tb-level-card__trail">
          {!readOnly && (
            <IconButton
              icon={<Trash2 width={14} height={14} aria-hidden="true" />}
              aria-label="Удалить показатель"
              variant="ghost"
              size="s"
              onClick={props.onRemove}
              data-testid={`metrics-remove-${props.index}`}
            />
          )}
          <button
            type="button"
            className="tb-level-card__chev"
            aria-label={expanded ? "Свернуть показатель" : "Развернуть показатель"}
            aria-expanded={expanded ? "true" : "false"}
            onClick={props.onToggle}
          >
            <ChevronDown width={16} height={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {expanded && (
        <div className="ou-card__body tb-level-card__body">
          {cardError && (
            <Banner
              tone="error"
              size="sm"
              description={cardError}
              data-testid={`metrics-card-error-${props.index}`}
            />
          )}
          <VariableForm
            variable={v}
            index={props.index}
            topics={props.topics}
            scales={props.scales}
            testId={props.testId}
            readOnly={readOnly}
            fieldErrors={props.fieldErrors}
            formulaOf={props.formulaOf}
            onChange={props.onChange}
          />
        </div>
      )}
    </section>
  );
}

// ─── Variable form (3 blocks: Имя·Метка / Формула / Вывод) ─────────────────────

type FormProps = {
  variable: ResultVariableModel;
  index: number;
  topics: TopicRef[];
  scales: ScaleRef[];
  testId?: string;
  readOnly: boolean;
  fieldErrors: FieldErrorIndex;
  /** Формула показателя по имени — чтобы пройти по `var()` (см. `carriedProfile`). */
  formulaOf: (name: string) => string | undefined;
  onChange: (patch: Partial<ResultVariableModel>) => void;
};

function VariableForm({ variable: v, index, topics, scales, testId, readOnly, fieldErrors, formulaOf, onChange }: FormProps) {
  // New (empty) variables open in the constructor; existing ones open in DSL so
  // the real stored formula is shown verbatim (the builder does not round-trip).
  //
  // Исключение — профиль (PRD-53): его форма ЧИТАЕТСЯ обратно из источника, группа и
  // порог восстанавливаются точно. Показывать вместо неё сырой DSL значило бы прятать
  // единственный экран, где эту механику настраивают, — и спорить с кнопками матрицы
  // и предупреждениями, которые карточка печатает по той же формуле ниже.
  const [formulaMode, setFormulaMode] = useState<"builder" | "dsl">(
    v.formula.trim() === "" || readScaleGroup(v.formula) ? "builder" : "dsl",
  );
  const validation = useFormulaValidation(testId, v, index, formulaMode === "builder");

  // In DSL mode the validator's inferred return type becomes the variable type —
  // there is no manual «Тип» field. The builder sets the type per template.
  // `unknown` (var()/mixed IF) is ignored — the prior type is kept.
  const rt = validation.result && validation.result.valid ? validation.result.returnType : undefined;
  const inferred: ResultVariableType | undefined =
    rt === "number" || rt === "string" || rt === "boolean" ? rt : undefined;
  useEffect(() => {
    if (formulaMode !== "dsl" || !inferred || inferred === v.type) return;
    onChange({ type: inferred, ...(inferred !== "boolean" ? { controlsStatus: "none" as const } : {}) });
  }, [formulaMode, inferred, v.type, onChange]);

  const isBoolean = v.type === "boolean";

  const declaredCodes = useMemo(
    () => v.outcomes.map((o) => o.code.trim()).filter((c) => c !== ""),
    [v.outcomes],
  );

  /**
   * PRD-29 Task 15: codes the formula can return that the list does not declare —
   * the WARNING. Suppressed while the list is empty (`findUnknownOutcomes`): an
   * author who has not started declaring outcomes is not doing anything wrong yet.
   */
  const unknownOutcomeCodes = useMemo(
    () => findUnknownOutcomes(v.formula, declaredCodes),
    [v.formula, declaredCodes],
  );

  /**
   * The same codes as SUGGESTIONS — deliberately NOT suppressed on an empty list.
   * Seeding an imported formula's outcome list in one click is the main scenario
   * (PRD-29 §5.1), and it happens precisely when nothing is declared yet; reusing
   * the warning's suppression here would switch the feature off exactly when it is
   * needed most.
   */
  const suggestedOutcomeCodes = useMemo(
    () => collectStringLiterals(v.formula).filter((code) => !declaredCodes.includes(code)),
    [v.formula, declaredCodes],
  );

  /**
   * PRD-53: the profile group the SAVED formula declares. Read from the source rather
   * than from the builder's form state, so the matrix generator and the warnings hold
   * for an indicator opened fresh — and for one whose source the author wrote by hand.
   */
  const profile = useMemo(() => readScaleGroup(v.formula), [v.formula]);

  /**
   * Профиль, который показатель НЕСЁТ, — свой или взятый по `var()` у соседа.
   *
   * Отличается от `profile` ровно в одном месте — карточке «шкалы вне профиля»: её поля
   * правятся там, где она печатается, а печатается она у владельца, который не обязан
   * быть вычислителем (см. `resolveScaleGroup`). Всё остальное — форма шаблона, генератор
   * матрицы, диагностика порога — остаётся у того, кто СЧИТАЕТ: у читателя ни порога, ни
   * группы нет, и предлагать их правку значило бы предлагать править чужое.
   */
  const carriedProfile = useMemo(
    () => resolveScaleGroup(v.formula, formulaOf),
    [v.formula, formulaOf],
  );

  // DSL «Функции» reference + insert-at-cursor.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [fnOpen, setFnOpen] = useState(false);
  const insertAtCursor = useCallback(
    (snippet: string) => {
      const ta = textareaRef.current;
      const cur = v.formula;
      const start = ta?.selectionStart ?? cur.length;
      const end = ta?.selectionEnd ?? cur.length;
      onChange({ formula: cur.slice(0, start) + snippet + cur.slice(end) });
      setFnOpen(false);
      // Restore focus + caret after the inserted snippet once React re-renders.
      requestAnimationFrame(() => {
        const t = textareaRef.current;
        if (!t) return;
        t.focus();
        const pos = start + snippet.length;
        t.setSelectionRange(pos, pos);
      });
    },
    [v.formula, onChange],
  );

  // Контракт «Индикация проблем»: у каждой ошибки — своя пометка НА МЕСТЕ. Адреса
  // читаются один раз: ниже они нужны и полю, и баннеру-заместителю там, где поля
  // на экране может не быть (конструктор формулы; управление статусом у небулева).
  const formulaError = fieldErrors.get(`resultVariables[${index}].formula`);
  const controlsStatusError = fieldErrors.get(`resultVariables[${index}].controlsStatus`);

  return (
    <>
      <Grid cols={2} gap={3}>
        <div data-field={`resultVariables[${index}].name`}>
          <Input
            size="m"
            fullWidth
            label="Имя показателя"
            required
            value={v.name}
            disabled={readOnly}
            placeholder="напр. burnout_category"
            error={fieldErrors.get(`resultVariables[${index}].name`)}
            onChange={(e) => onChange({ name: e.target.value })}
            data-testid={`metrics-name-${index}`}
          />
        </div>
        <Input
          size="m"
          fullWidth
          label="Метка"
          value={v.label}
          disabled={readOnly}
          error={fieldErrors.get(`resultVariables[${index}].label`)}
          onChange={(e) => onChange({ label: e.target.value })}
          data-testid={`metrics-label-${index}`}
        />
      </Grid>

      <div className="ou-formfield" data-field={`resultVariables[${index}].formula`}>
        <label className="ou-formfield__lbl">Формула</label>
        <SegmentedControl<"builder" | "dsl">
          size="s"
          value={formulaMode}
          aria-label="Режим редактора формулы"
          items={[
            { value: "builder", label: "Конструктор" },
            { value: "dsl", label: "DSL" },
          ]}
          onChange={(value) => setFormulaMode(value)}
        />
        {formulaMode === "dsl" ? (
          <>
            <div className="tb-fn-toolbar">
              <Button
                variant="secondary"
                size="s"
                leadingIcon={<Info size={16} aria-hidden="true" />}
                onClick={() => setFnOpen(true)}
                disabled={readOnly}
                data-testid={`metrics-fn-open-${index}`}
              >
                Функции
              </Button>
            </div>
            <Textarea
              ref={textareaRef}
              size="m"
              fullWidth
              rows={4}
              value={v.formula}
              disabled={readOnly}
              error={formulaError}
              placeholder='напр. IF(percent >= 75, "Зачёт", "Незачёт")'
              aria-label="Формула DSL"
              onChange={(e) => onChange({ formula: e.target.value })}
              data-testid={`metrics-formula-${index}`}
            />
          </>
        ) : (
          <>
            <FormulaBuilder variable={v} topics={topics} scales={scales} readOnly={readOnly} onChange={onChange} />
            {/* В конструкторе поля «формула» нет — её собирают из частей, — поэтому
                ошибку показывает баннер на месте, а не `error` у поля. */}
            {formulaError && (
              <Banner
                tone="error"
                size="sm"
                description={formulaError}
                data-testid={`metrics-formula-error-${index}`}
              />
            )}
          </>
        )}
      </div>
      {fnOpen && <FunctionReferenceModal onClose={() => setFnOpen(false)} onInsert={insertAtCursor} />}
      {validation.banner && (
        <Banner tone={validation.banner.tone} size="sm" description={validation.banner.text} />
      )}

      {/* PRD-29: the indicator's interpretation. A numeric result is interpreted by
          INTERVAL (the same editor the scales tab uses); a string or boolean one has
          no intervals — the formula returns a CODE, so the author enumerates them. */}
      {profile && (
        <ProfileDiagnostics variable={v} scales={scales} index={index} />
      )}
      {/* Заголовок блока — из ствола (`ou-formfield__lbl`): приёмка ящика по эскизам
          привела к нему ВСЕ подписи блоков, и своя разметка тут разошлась бы с ними. */}
      <label className="ou-formfield__lbl">Толкование результата</label>
      {profile && !readOnly && (
        <div className="tb-rows-actions" data-testid={`metrics-profile-matrix-${index}`}>
          <Button
            variant="ghost"
            size="s"
            leadingIcon={<Plus size={16} aria-hidden="true" />}
            disabled={profile.keys.length < 2}
            onClick={() => onChange({ outcomes: addMissingOutcomes(v.outcomes, profileMatrix(profile.keys, scales)) })}
            data-testid={`metrics-profile-build-${index}`}
          >
            Собрать наборы
          </Button>
          <Button
            variant="ghost"
            size="s"
            leadingIcon={<Plus size={16} aria-hidden="true" />}
            disabled={profile.keys.length < 2}
            onClick={() =>
              onChange({
                outcomes: addMissingOutcomes(v.outcomes, profileMatrix(profile.keys, scales, { byCountOnly: true })),
              })
            }
            data-testid={`metrics-profile-build-counts-${index}`}
          >
            Заготовки по размеру набора
          </Button>
        </div>
      )}
      {v.type === "number" ? (
        <>
          <LevelsEditor
            bands={v.bands}
            index={index}
            readOnly={readOnly}
            // У показателя шкалы нет — лента показывает покрытие ЕГО значений.
            coverLabel="Покрытие"
            valence={v.valence}
            testIdPrefix="metrics"
            domain={v.domainMin !== null && v.domainMax !== null
              ? { min: v.domainMin, max: v.domainMax }
              : null}
            onChange={(bands) => onChange({ bands })}
          />
          {/* PRD-29+: same domain+valence mechanics as the «Шкалы» tab — a numeric
              indicator degrades exactly the same way without an explicit domain
              (span of its bands), so it reuses the shared component rather than a
              second copy. No «Рассчитать по вкладам»: an indicator's value comes
              from a formula, not enumerated question contributions, so there is
              nothing to suggest a range from. */}
          <span className="ou-formfield__lbl">Границы показателя</span>
          <DomainFields
            domainMin={v.domainMin}
            domainMax={v.domainMax}
            readOnly={readOnly}
            testIdPrefix="metrics"
            index={index}
            seed={bandSpan(v) ?? { min: 0, max: 0 }}
            switchLabel="Задать границы вручную"
            switchDescription="Выключено — границы берутся из охвата уровней."
            minLabel="Минимум"
            maxLabel="Максимум"
            onChange={onChange}
          />
          {/* Направление и видимость — пара в одной строке: оба отвечают на вопрос «как
              этот показатель прочитают», и разносить их по разным разделам значило бы
              заставлять автора решать половину вопроса дважды. */}
          <Grid cols={2} gap={3}>
            <Select<Valence>
              size="m"
              fullWidth
              label="Благоприятное направление"
              value={v.valence}
              disabled={readOnly}
              options={VALENCE_OPTIONS}
              onChange={(value) => onChange({ valence: value })}
              data-testid={`metrics-valence-${index}`}
            />
            <Select<LearnerVisibility>
              size="m"
              fullWidth
              label="Показывать обучающемуся"
              value={v.learnerVisibility}
              disabled={readOnly}
              options={VISIBILITY_OPTIONS}
              onChange={(value) => onChange({ learnerVisibility: value })}
              data-testid={`metrics-visibility-${index}`}
            />
          </Grid>
        </>
      ) : (
        <OutcomesEditor
          outcomes={v.outcomes}
          index={index}
          readOnly={readOnly}
          onChange={(outcomes) => onChange({ outcomes })}
          suggestedCodes={suggestedOutcomeCodes}
        />
      )}
      {v.type !== "number" && unknownOutcomeCodes.length > 0 && (
        <Banner
          tone="warning"
          size="sm"
          description={`В формуле встречаются коды, которых нет в перечне: ${unknownOutcomeCodes.join(", ")}. Сохранение не заблокировано — добавьте их в перечень ниже.`}
          data-testid={`metrics-unknown-outcomes-${index}`}
        />
      )}
      {/* Блок «вне профиля» стоит ЗА толкованием и ПЕРЕД «Выводом»: он про то, что
          участник прочитает, а не про то, куда показатель уедет. Порядок из эскиза
          `prd53-profile-indicator.html`. */}
      {carriedProfile && (
        <>
          <hr className="wf-sep" />
          <RestScalesFields
            value={v.restScales}
            groupKeys={carriedProfile.keys}
            readOnly={readOnly}
            index={index}
            onChange={onChange}
          />
        </>
      )}
      {/* PRD-29 (дефект D-1): без управления видимостью `learnerVisibility` навсегда
          остаётся `hidden`, и вердикт методики — то, ради чего измерительный тест и
          существует, — до обучающегося не доходит. У числового показателя это поле стоит
          парой к направлению, выше; здесь — для остальных типов. */}
      {v.type !== "number" && (
        <>
          <label className="ou-formfield__lbl">Вывод</label>
          <Grid cols={2} gap={3}>
            <Select<LearnerVisibility>
              size="m"
              fullWidth
              label="Показывать обучающемуся"
              value={v.learnerVisibility}
              disabled={readOnly}
              options={VISIBILITY_OPTIONS}
              onChange={(value) => onChange({ learnerVisibility: value })}
              data-testid={`metrics-visibility-${index}`}
            />
            {isBoolean && (
              <div data-field={`resultVariables[${index}].controlsStatus`}>
                <Select<ResultVariableControlsStatus>
                  size="m"
                  fullWidth
                  label="Управление статусом курса"
                  hint="Доступно только для показателей типа «да/нет»."
                  value={v.controlsStatus}
                  disabled={readOnly}
                  error={controlsStatusError}
                  options={STATUS_OPTIONS}
                  onChange={(value) => onChange({ controlsStatus: value })}
                  data-testid={`metrics-status-${index}`}
                />
              </div>
            )}
          </Grid>
        </>
      )}
      {/* «Тип не булев, а управление статусом задано» — ошибка поля, которого в этом
          случае на экране НЕТ: селектор показывается только булеву. Без этой строки
          сообщение жило бы только в сводном баннере, а пометить было бы нечего. */}
      {!isBoolean && controlsStatusError && (
        <div data-field={`resultVariables[${index}].controlsStatus`}>
          <Banner
            tone="error"
            size="sm"
            description={controlsStatusError}
            data-testid={`metrics-status-error-${index}`}
          />
        </div>
      )}
      {/* D-48: выдача в LMS — не пара к видимости, а отдельное решение о другом
          адресате: одно про экран обучающегося, другое про запись в систему. */}
      <Select<ResultVariableScormTarget>
        size="m"
        fullWidth
        label="Передавать в LMS"
        value={v.scormTarget}
        disabled={readOnly}
        options={TARGET_OPTIONS}
        // PRD-54, решение 13: показатель вне отчёта LMS выпадает из аналитики по его выгрузке.
        hint={reachesLmsReport(v.scormTarget) ? undefined : "Аналитика по выгрузке отчёта LMS этот показатель не увидит"}
        onChange={(value) => onChange({ scormTarget: value })}
        data-testid={`metrics-target-${index}`}
      />

      {/* PRD-49 §6: the card's other slots. «Показывать обучающемуся» above governs the
          VALUE slot only, so without these two an author who needs a card with just an
          explanation has to blank the level label — which prints the level CODE instead. */}
      <CardSlotToggles
        showName={v.showName}
        showLevel={v.showLevel}
        readOnly={readOnly}
        testIdPrefix="metrics"
        index={index}
        onChange={onChange}
      />
    </>
  );
}

// ─── Visual formula builder (4 templates over one condition primitive) ─────────

function FormulaBuilder({
  variable: v,
  topics,
  scales,
  readOnly,
  onChange,
}: {
  variable: ResultVariableModel;
  topics: TopicRef[];
  scales: ScaleRef[];
  readOnly: boolean;
  onChange: (patch: Partial<ResultVariableModel>) => void;
}) {
  // Открывая показатель-профиль, конструктор показывает ЕГО шаблон, а не «Порог»:
  // ниже уже стоят кнопки матрицы и предупреждения, прочитанные из той же формулы,
  // и селект, говорящий «Порог», спорил бы с ними на одном экране. Для остальных
  // шаблонов начальное значение прежнее — их формулу обратно не разобрать.
  const [template, setTemplate] = useState<BuilderTemplate>(() =>
    readScaleGroup(v.formula) ? "profile" : "threshold",
  );
  const [conditions, setConditions] = useState<Condition[]>(() => [defaultCondition(scales)]);
  const [catScale, setCatScale] = useState<string>(() => scales[0]?.key ?? "");
  const [catRows, setCatRows] = useState<Array<{ level: string; label: string }>>(() => [{ level: "", label: "" }]);
  const [catElse, setCatElse] = useState("Недостаточно");
  const [wRows, setWRows] = useState<Array<{ scaleKey: string; weight: string }>>(
    () => [{ scaleKey: scales[0]?.key ?? "", weight: "1" }],
  );
  // PRD-53 §5.1. Seeded from the formula when the card already holds a profile, so
  // reopening an indicator shows the group it was saved with instead of an empty form.
  const savedGroup = useMemo(() => readScaleGroup(v.formula), [v.formula]);
  const [pKeys, setPKeys] = useState<string[]>(() => savedGroup?.keys ?? []);
  const [pThreshold, setPThreshold] = useState(() =>
    String(savedGroup ? parseGroupThreshold(savedGroup.threshold)?.value ?? 0 : 0),
  );
  const [pUnit, setPUnit] = useState<"abs" | "pct">(() =>
    savedGroup && parseGroupThreshold(savedGroup.threshold)?.kind === "pct" ? "pct" : "abs",
  );

  const generated = useMemo(() => {
    switch (template) {
      case "threshold":
        return thresholdDsl(conditions[0] ?? defaultCondition(scales), topics);
      case "verdict":
        return verdictDsl(conditions, topics);
      case "category":
        return categoryDsl(catScale, catRows, catElse);
      case "weighted":
        return weightedDsl(wRows);
      case "profile":
        // A blank threshold is a half-typed number, not a zero: keeping the last valid
        // value out of the formula would rewrite the indicator on every keystroke.
        return buildProfileFormula({ keys: pKeys, threshold: Number(pThreshold) || 0, unit: pUnit });
      default:
        return "";
    }
  }, [template, conditions, catScale, catRows, catElse, wRows, pKeys, pThreshold, pUnit, scales, topics]);

  // Write the canonical DSL (and derived type) into the model immediately — on
  // mount for a fresh variable and on every builder change — so the formula is
  // never «phantom-empty» (the previous builder only wrote on field edits). An
  // existing formula is NOT clobbered on mount.
  const firstRun = useRef(true);
  const lastWritten = useRef<string | null>(null);
  useEffect(() => {
    if (readOnly) return;
    if (firstRun.current) {
      firstRun.current = false;
      if (v.formula.trim() !== "") {
        lastWritten.current = generated;
        return;
      }
    }
    if (generated === lastWritten.current) return;
    lastWritten.current = generated;
    const type = TEMPLATE_TYPE[template];
    onChange({ formula: generated, type, ...(type !== "boolean" ? { controlsStatus: "none" as const } : {}) });
  }, [generated, template, readOnly, onChange, v.formula]);

  // Ошибки по ТЕКУЩЕМУ состоянию формы: тот же расчёт, что кладёт находки в общий контур,
  // но спрошенный о ещё не записанной формуле — иначе сообщение отставало бы на такт.
  const formErrors = useMemo(() => {
    const map = new Map<string, string>();
    if (template !== "profile") return map;
    for (const f of profileFindings({ ...v, formula: generated }, scales)) {
      if (f.severity === "error" && !map.has(f.code)) map.set(f.code, f.message);
    }
    return map;
  }, [template, v, generated, scales]);

  const scaleOpts = scales.map((s) => ({ value: s.key, label: s.label || s.key }));
  const noScales = scaleOpts.length === 0;

  return (
    <div className="tb-formula-builder">
      <Select<BuilderTemplate>
        size="m"
        fullWidth
        label="Шаблон"
        value={template}
        disabled={readOnly}
        options={TEMPLATE_OPTIONS}
        onChange={(value) => setTemplate(value)}
      />

      {template === "threshold" && (
        <div className="ou-formfield">
          <label className="ou-formfield__lbl">Условие</label>
          <ConditionRow
            cond={conditions[0] ?? defaultCondition(scales)}
            topics={topics}
            scales={scales}
            readOnly={readOnly}
            onChange={(c) => setConditions([c])}
          />
        </div>
      )}

      {template === "verdict" && (
        <div className="ou-formfield">
          <label className="ou-formfield__lbl">Условия</label>
          <div className="tb-rows">
            {conditions.map((c, i) => (
              <ConditionRow
                key={i}
                cond={c}
                topics={topics}
                scales={scales}
                readOnly={readOnly}
                onChange={(nc) => setConditions(conditions.map((x, j) => (j === i ? nc : x)))}
                onRemove={
                  conditions.length > 1
                    ? () => setConditions(conditions.filter((_, j) => j !== i))
                    : undefined
                }
              />
            ))}
          </div>
          {!readOnly && (
            <div className="tb-rows-actions">
              <Button
                variant="ghost"
                size="s"
                leadingIcon={<Plus size={16} aria-hidden="true" />}
                onClick={() => setConditions([...conditions, defaultCondition(scales)])}
              >
                Добавить условие
              </Button>
            </div>
          )}
        </div>
      )}

      {template === "category" && (
        <>
          <Select
            size="m"
            fullWidth
            label="Шкала"
            value={catScale}
            disabled={readOnly || noScales}
            options={noScales ? [{ value: "", label: "Нет шкал" }] : scaleOpts}
            onChange={(value) => setCatScale(value)}
          />
          <div className="ou-formfield">
            <label className="ou-formfield__lbl">Уровень шкалы → значение показателя</label>
            <div className="tb-rows">
              {catRows.map((r, i) => {
                const lvlOpts = levelOptions(`scale:${catScale}`, scales);
                return (
                  <div className="tb-cond-row" key={i}>
                    <Select
                      size="s"
                      aria-label="Уровень шкалы"
                      value={r.level}
                      disabled={readOnly}
                      options={lvlOpts.length ? lvlOpts : [{ value: "", label: "—" }]}
                      onChange={(level) => setCatRows(catRows.map((x, j) => (j === i ? { ...x, level } : x)))}
                    />
                    <span className="tb-cond-sep" aria-hidden="true">→</span>
                    <div className="tb-cond-row__grow">
                      <Input
                        fullWidth
                        size="s"
                        aria-label="Значение показателя"
                        value={r.label}
                        disabled={readOnly}
                        onChange={(e) =>
                          setCatRows(catRows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                        }
                      />
                    </div>
                    {!readOnly && catRows.length > 1 && (
                      <IconButton
                        icon={<Trash2 width={14} height={14} aria-hidden="true" />}
                        aria-label="Удалить уровень"
                        variant="ghost"
                        size="s"
                        onClick={() => setCatRows(catRows.filter((_, j) => j !== i))}
                      />
                    )}
                  </div>
                );
              })}
              <div className="tb-cond-row">
                <span className="tb-cond-sep" aria-hidden="true">иначе →</span>
                <div className="tb-cond-row__grow">
                  <Input
                    fullWidth
                    size="s"
                    aria-label="Значение «иначе»"
                    value={catElse}
                    disabled={readOnly}
                    onChange={(e) => setCatElse(e.target.value)}
                  />
                </div>
              </div>
            </div>
            {!readOnly && (
              <div className="tb-rows-actions">
                <Button
                  variant="ghost"
                  size="s"
                  leadingIcon={<Plus size={16} aria-hidden="true" />}
                  onClick={() => setCatRows([...catRows, { level: "", label: "" }])}
                >
                  Добавить уровень
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {template === "weighted" && (
        <div className="ou-formfield">
          <label className="ou-formfield__lbl">Слагаемые: шкала × вес</label>
          <div className="tb-rows">
            {wRows.map((r, i) => (
              <div className="tb-cond-row" key={i}>
                <div className="tb-cond-row__grow">
                  <Select
                    fullWidth
                    size="s"
                    aria-label="Шкала"
                    value={r.scaleKey}
                    disabled={readOnly || noScales}
                    options={noScales ? [{ value: "", label: "Нет шкал" }] : scaleOpts}
                    onChange={(scaleKey) => setWRows(wRows.map((x, j) => (j === i ? { ...x, scaleKey } : x)))}
                  />
                </div>
                <span className="tb-cond-sep" aria-hidden="true">× вес</span>
                <Input
                  size="s"
                  aria-label="Вес"
                  value={r.weight}
                  disabled={readOnly}
                  onChange={(e) => setWRows(wRows.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
                />
                {!readOnly && wRows.length > 1 && (
                  <IconButton
                    icon={<Trash2 width={14} height={14} aria-hidden="true" />}
                    aria-label="Удалить слагаемое"
                    variant="ghost"
                    size="s"
                    onClick={() => setWRows(wRows.filter((_, j) => j !== i))}
                  />
                )}
              </div>
            ))}
          </div>
          {!readOnly && (
            <div className="tb-rows-actions">
              <Button
                variant="ghost"
                size="s"
                leadingIcon={<Plus size={16} aria-hidden="true" />}
                onClick={() => setWRows([...wRows, { scaleKey: scales[0]?.key ?? "", weight: "1" }])}
              >
                Добавить слагаемое
              </Button>
            </div>
          )}
        </div>
      )}

      {template === "profile" && (
        <ProfileTemplateFields
          scales={scales}
          errors={formErrors}
          keys={pKeys}
          threshold={pThreshold}
          unit={pUnit}
          readOnly={readOnly}
          onKeys={setPKeys}
          onThreshold={setPThreshold}
          onUnit={setPUnit}
        />
      )}
      {/* Что получится: собранное выражение показывается ДО того, как автор переключится
          на ручной режим. Конструктор пишет ту же строку в модель, и увидеть её здесь —
          единственный способ понять, что именно посчитает движок. */}
      <div className="ou-formfield">
        <label className="ou-formfield__lbl">Что получится</label>
        <div className="tb-formula-preview" data-testid="metrics-formula-generated">
          {generated || "—"}
        </div>
        <span className="ou-formfield__desc">
          Выражение собирается конструктором; переключение на «Выражение» оставляет его как есть.
        </span>
      </div>
    </div>
  );
}

/**
 * Блок «шкалы вне профиля» (PRD-53 §4.4).
 *
 * `keys` пишутся ВСЕГДА из группы формулы, а не накапливаются: блок печатает шкалы
 * группы, не вошедшие в профиль, и группа, разошедшаяся с формулой, дала бы карточку
 * про шкалы, которые в профиле не участвуют.
 */
function RestScalesFields({
  value,
  groupKeys,
  readOnly,
  index,
  onChange,
}: {
  value: ResultVariableModel["restScales"];
  groupKeys: string[];
  readOnly: boolean;
  index: number;
  onChange: (patch: Partial<ResultVariableModel>) => void;
}) {
  const show = value?.show === true;
  return (
    <>
      <Switch
        size="m"
        label="Показывать шкалы вне профиля"
        checked={show}
        disabled={readOnly}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange({ restScales: { show: e.target.checked, label: value?.label ?? "", keys: groupKeys } })
        }
        data-testid={`metrics-rest-show-${index}`}
      />
      {show && (
        <div className="ou-formfield">
          <Input
            size="m"
            fullWidth
            label="Заголовок блока"
            value={value?.label ?? ""}
            disabled={readOnly}
            onChange={(e) => onChange({ restScales: { show: true, label: e.target.value, keys: groupKeys } })}
            data-testid={`metrics-rest-label-${index}`}
          />
        </div>
      )}
      {show && (
        <Banner
          tone="info"
          size="sm"
          description="Блок печатает шкалы группы, не вошедшие в профиль, по убыванию балла. Текст берётся из описания самой шкалы."
        />
      )}
    </>
  );
}

// ─── «Профиль по группе шкал» (PRD-53 §5.2, §5.3.2) ───────────────────────────

/**
 * Добавить недостающие заготовки, не тронув заполненные.
 *
 * Сравнение — по НАБОРУ, тем же ключом, что и в рантайме: иначе исход `pro+cel`,
 * набранный автором вручную, считался бы отсутствующим и генератор завёл бы дубль
 * `cel+pro`, который никогда не сработает — первым в списке стоял бы чужой.
 */
function addMissingOutcomes(existing: OutcomeModel[], rows: ProfileMatrixRow[]): OutcomeModel[] {
  const known = new Set(existing.map((o) => outcomeMatchKey(o.code.trim())).filter((c) => c !== ""));
  const added: OutcomeModel[] = [];
  for (const row of rows) {
    if (known.has(outcomeMatchKey(row.code))) continue;
    known.add(outcomeMatchKey(row.code));
    localKeyCounter += 1;
    added.push({ clientKey: `oc-${localKeyCounter}`, code: row.code, label: row.label, text: "", tone: "" });
  }
  return added.length === 0 ? existing : [...existing, ...added];
}

/**
 * Находки формы: то, чего валидатор формулы увидеть не может (PRD-53 §5.3.2).
 *
 * Расчёт НЕ здесь: он один на всех в `profile-diagnostics` и оттуда же попадает в общий
 * контур индикации через `validateTestEditor` — точка на вкладке, сводный баннер, переход
 * по якорю (`docs/architecture/test-editor-contracts.md`). Секция только печатает то же
 * самое у карточки: контракт требует пометки у самого элемента, а карточка может быть
 * ниже сгиба, и один баннер вверху формы автора до неё не доведёт.
 */
function ProfileDiagnostics({
  variable,
  scales,
  index,
}: {
  variable: ResultVariableModel;
  scales: ScaleRef[];
  index: number;
}) {
  const findings = useMemo(() => profileFindings(variable, scales), [variable, scales]);
  const hint = useMemo(() => profileSetCountHint(variable), [variable]);

  return (
    <>
      {findings
        .filter((f) => f.severity === "warning")
        .map((f) => (
          <Banner
            key={f.code}
            tone="warning"
            size="sm"
            description={f.message}
            data-testid={`metrics-${f.code.replace(/_/g, "-")}-${index}`}
          />
        ))}
      {hint && (
        <Banner tone="warning" size="sm" description={hint} data-testid={`metrics-profile-many-${index}`} />
      )}
    </>
  );
}

// ─── «Профиль по группе шкал» (PRD-53 §5.1) ───────────────────────────────────

const THRESHOLD_UNITS: Array<{ value: "abs" | "pct"; label: string }> = [
  { value: "abs", label: "баллы" },
  { value: "pct", label: "% от максимума" },
];

/**
 * Форма пятого шаблона: группа шкал и порог верхней зоны.
 *
 * Шкалы перечислены ТУМБЛЕРАМИ, а не мультиселектом: группа почти всегда — это все
 * шкалы методики или все, кроме одной-двух, и в таком списке важнее видеть невыбранные,
 * чем экономить высоту. Порядок ключей — авторский порядок шкал теста, тот же, что даёт
 * канонический код набора; поэтому группа собирается фильтром по `scales`, а не в порядке
 * нажатий.
 *
 * Удалённая из теста шкала группы (PRD-53 §5.3.4, FR-33) остаётся в списке отдельной
 * отключённой строкой: иначе автор видит ошибку про её ключ и не может её снять.
 */
function ProfileTemplateFields({
  scales,
  keys,
  threshold,
  unit,
  errors,
  readOnly,
  onKeys,
  onThreshold,
  onUnit,
}: {
  scales: ScaleRef[];
  keys: string[];
  threshold: string;
  unit: "abs" | "pct";
  /** Сообщения общего расчёта по ТЕКУЩЕМУ состоянию формы, по коду находки. */
  errors: Map<string, string>;
  readOnly: boolean;
  onKeys: (keys: string[]) => void;
  onThreshold: (value: string) => void;
  onUnit: (unit: "abs" | "pct") => void;
}) {
  const selected = useMemo(() => new Set(keys), [keys]);
  const missing = useMemo(
    () => keys.filter((k) => !scales.some((s) => s.key === k)),
    [keys, scales],
  );
  // Порог проверяется по НАБРАННОМУ значению, а не по формуле: отрицательное число
  // делает формулу неразбираемой, и находка по модели до автора не доходит вовсе.
  // Правило при этом одно — тот же parseGroupThreshold и тот же текст.
  const thresholdError =
    parseGroupThreshold(unit === "pct" ? `${threshold}%` : Number(threshold)) === null
      ? PROFILE_THRESHOLD_MESSAGE
      : undefined;

  const toggle = useCallback(
    (key: string, on: boolean) => {
      const next = new Set(selected);
      if (on) next.add(key);
      else next.delete(key);
      // Авторский порядок, а не порядок нажатий: он же определяет код набора.
      onKeys(scales.map((s) => s.key).filter((k) => next.has(k)));
    },
    [selected, scales, onKeys],
  );


  return (
    <>
      <div className="ou-formfield" data-testid="metrics-profile-group">
        <label className="ou-formfield__lbl">
          Шкалы группы <span className="ou-formfield__lbl-req" aria-hidden="true">*</span>
        </label>
        {scales.length === 0 ? (
          <Banner
            tone="warning"
            size="sm"
            description="У теста нет шкал. Профиль сравнивает шкалы между собой — заведите их на вкладке «Шкалы»."
          />
        ) : (
          <div className="tb-profile-scales">
            {scales.map((s) => (
              <Switch
                key={s.key}
                size="m"
                label={
                  <>
                    {s.label || s.key} <span className="tb-cond-sep">{s.key}</span>
                  </>
                }
                checked={selected.has(s.key)}
                disabled={readOnly}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggle(s.key, e.target.checked)}
                data-testid={`metrics-profile-scale-${s.key}`}
              />
            ))}
            {missing.map((key) => (
              <Switch
                key={key}
                size="m"
                label={
                  <>
                    {key} <span className="tb-cond-sep">шкала удалена из теста</span>
                  </>
                }
                checked
                disabled
                data-testid={`metrics-profile-missing-${key}`}
              />
            ))}
          </div>
        )}
        {errors.get("profile_group_small") && (
          <div className="ou-formfield__msg ou-formfield__msg--error" data-testid="metrics-profile-group-error">
            {errors.get("profile_group_small")}
          </div>
        )}
      </div>

      <div className="ou-formfield">
        <label className="ou-formfield__lbl" htmlFor="metrics-profile-threshold">
          Порог верхней зоны
        </label>
        <div className="tb-cond-row">
          <Input
            size="s"
            id="metrics-profile-threshold"
            value={threshold}
            disabled={readOnly}
            error={thresholdError}
            onChange={(e) => onThreshold(e.target.value)}
            data-testid="metrics-profile-threshold"
          />
          <SegmentedControl<"abs" | "pct">
            size="s"
            items={THRESHOLD_UNITS}
            value={unit}
            onChange={(value) => !readOnly && onUnit(value)}
          />
        </div>
      </div>

      <Banner
        tone="info"
        size="sm"
        description={`Шкала входит в профиль, если отстала от максимума по группе не больше чем на порог. Граница включается: отставание ровно на ${threshold || 0} — ещё профиль.`}
      />
    </>
  );
}

// ─── Condition primitive (Элемент + Свойство + Оператор + Значение) ────────────

function ConditionRow({
  cond,
  topics,
  scales,
  readOnly,
  onChange,
  onRemove,
}: {
  cond: Condition;
  topics: TopicRef[];
  scales: ScaleRef[];
  readOnly: boolean;
  onChange: (c: Condition) => void;
  onRemove?: () => void;
}) {
  const unit = unitOf(cond.element, cond.property);
  const elemOpts = elementOptions(topics, scales);
  const propOpts = propertyOptions(cond.element);
  const lvlOpts = levelOptions(cond.element, scales);
  const opOpts = unit === "level" ? LEVEL_OPERATORS : NUM_OPERATORS;

  return (
    <div className="tb-cond-row">
      <div className="tb-cond-row__grow">
        <Select
          fullWidth
          size="s"
          aria-label="Элемент"
          options={elemOpts}
          value={cond.element}
          disabled={readOnly}
          onChange={(element) => onChange({ ...cond, element, property: firstProperty(element) })}
        />
      </div>
      <Select
        size="s"
        aria-label="Свойство"
        options={propOpts}
        value={cond.property}
        disabled={readOnly}
        onChange={(property) => onChange({ ...cond, property })}
      />
      {unit !== "bool" && (
        <Select
          size="s"
          aria-label="Оператор"
          options={opOpts}
          value={cond.op}
          disabled={readOnly}
          onChange={(op) => onChange({ ...cond, op })}
        />
      )}
      {unit === "num" && (
        <Input
          size="s"
          aria-label="Значение"
          value={cond.value}
          disabled={readOnly}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
        />
      )}
      {unit === "level" && (
        <Select
          size="s"
          aria-label="Уровень"
          options={lvlOpts.length ? lvlOpts : [{ value: "", label: "—" }]}
          value={cond.value}
          disabled={readOnly}
          onChange={(value) => onChange({ ...cond, value })}
        />
      )}
      {onRemove && !readOnly && (
        <IconButton
          icon={<Trash2 width={14} height={14} aria-hidden="true" />}
          aria-label="Удалить условие"
          variant="ghost"
          size="s"
          onClick={onRemove}
        />
      )}
    </div>
  );
}

// ─── DSL «Функции» reference modal ─────────────────────────────────────────────

function FunctionReferenceModal({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (snippet: string) => void;
}) {
  return (
    <ModalDialog
      open
      onClose={onClose}
      size="l"
      title="Функции"
      description="Источники и функции DSL. «Вставить» добавляет запись в редактор по позиции курсора"
      footer={
        <Button variant="ghost" size="m" onClick={onClose} data-testid="metrics-fn-close">
          Закрыть
        </Button>
      }
    >
      <div data-testid="metrics-fn-modal">
        {DSL_FUNCTION_GROUPS.map((g) => (
          <div className="tb-fn-group" key={g.title}>
            <div className="tb-fn-group__title">{g.title}</div>
            {g.items.map((it) => (
              <div className="tb-fn-row" key={it.sig}>
                <code className="tb-fn-sig">{it.sig}</code>
                <span className="tb-fn-desc">{it.desc}</span>
                <Button variant="ghost" size="s" onClick={() => onInsert(it.insert)}>
                  Вставить
                </Button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </ModalDialog>
  );
}

// ─── Live formula validation ──────────────────────────────────────────────────

type FormulaBanner = { tone: "success" | "error" | "info"; text: string };

/**
 * Debounced (400 ms, NFR-18 / PRD-2 A0) live validation of the formula against
 * the test context. No-op in create mode (no `testId`) — the formula is then
 * only checked server-side on the first save. Returns the raw validation result
 * too, so the form can adopt the inferred return type in DSL mode.
 */
/**
 * Памятки, адресованные тому, кто пишет ИСТОЧНИК руками (PRD-53 FR-27).
 *
 * Валидатор формулы видит только строку и потому вместо проверки печатает правило:
 * «коды исходов должны быть наборами ключей шкал». В конструкторе коды заводит
 * генератор матрицы, автор их не набирает — и памятка там не подсказка, а шум,
 * который вдобавок навсегда занимает единственную строку баннера и не даёт автору
 * профиля увидеть подтверждение «синтаксис корректен». В режиме DSL она остаётся.
 */
const BUILDER_SILENCED_CODES = new Set(["scale-group-code"]);

/**
 * Находки валидатора, которые форма профиля печатает САМА — и в обоих режимах.
 *
 * Условие «разная нормализация при абсолютном пороге» видят оба: валидатор через
 * `refs.scaleNormalizations`, форма — по шкалам теста. Но находка формы не только
 * печатается у карточки, она ещё и кормит общий контур индикации (точка на вкладке,
 * сводный баннер, переход по якорю), куда ответ валидатора не идёт, — поэтому убирать
 * надо копию ВАЛИДАТОРА, а не её. Приёмка 2026-09-07 застала оба баннера подряд:
 * различались они одной точкой в конце.
 */
const CARD_DUPLICATED_CODES = new Set(["scale-group-normalization"]);

function useFormulaValidation(
  testId: string | undefined,
  v: ResultVariableModel,
  index: number,
  /** Открыт конструктор (а не DSL): часть памяток адресована не этому автору. */
  inBuilder: boolean,
): { banner: FormulaBanner | null; result: ResultVariableFormulaValidation | null } {
  const [banner, setBanner] = useState<FormulaBanner | null>(null);
  const [result, setResult] = useState<ResultVariableFormulaValidation | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!testId || !v.formula.trim()) {
      setBanner(null);
      setResult(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      validateResultVariableFormula(testId, {
        formula: v.formula,
        type: v.type,
        sortOrder: index,
        excludeId: v.id,
      })
        .then((raw) => {
          const res = {
            ...raw,
            warnings: raw.warnings.filter(
              (w) =>
                !CARD_DUPLICATED_CODES.has(w.code ?? "") &&
                !(inBuilder && BUILDER_SILENCED_CODES.has(w.code ?? "")),
            ),
          };
          setResult(res);
          setBanner(toBanner(res, v.type));
        })
        .catch(() => {
          setBanner(null);
          setResult(null);
        });
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [testId, v.formula, v.type, v.id, index, inBuilder]);

  return { banner, result };
}

function toBanner(
  res: ResultVariableFormulaValidation,
  expected: ResultVariableType,
): FormulaBanner {
  if (!res.valid) {
    const first = res.errors[0];
    return { tone: "error", text: first ? first.message : "Невалидная формула." };
  }
  const typeName = TYPE_LABEL[res.returnType ?? expected];
  if (res.warnings.length > 0) {
    return { tone: "info", text: res.warnings[0].message };
  }
  return { tone: "success", text: `Синтаксис корректен. Тип возврата — ${typeName}.` };
}
