/**
 * @module features/tests/editor/sections/result-variables-section
 * @description «Показатели» editor tab (PRD-2). Lists the test's result
 * variables as reorderable accordion cards. Each card is three blocks:
 * (1) Имя · Метка, (2) Формула (Конструктор/DSL → шаблон → расчёт), (3) Вывод
 * (управление статусом — только для булевых — + передача в LMS). The result type
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
  Cluster,
  EmptyState,
  Grid,
  IconButton,
  Input,
  ModalDialog,
  Select,
  SegmentedControl,
  Textarea,
} from "@universityrt/ui-kit";
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

import type {
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

const STATUS_OPTIONS: Array<{ value: ResultVariableControlsStatus; label: string }> = [
  { value: "none", label: "Нет" },
  { value: "success", label: "Успех (success_status)" },
  { value: "completion", label: "Завершение (completion_status)" },
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
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
    const created = emptyVariable(vars.length);
    const key = rowKey(created, vars.length);
    setVars([...vars, created]);
    setExpandedKey(key);
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
      <Cluster justify="between" gap={0} wrap={false} style={{ marginBottom: "var(--ou-space-3)" }}>
        <div className="tb-section-label">
          Показатели результата{vars.length > 1 ? " · порядок вычисления" : ""}
        </div>
        {!readOnly && (
          <Button
            variant="ghost"
            size="s"
            leadingIcon={<Plus size={16} aria-hidden="true" />}
            onClick={addVariable}
            data-testid="metrics-add"
          >
            Добавить показатель
          </Button>
        )}
      </Cluster>

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
                expanded={expandedKey === key}
                onToggle={() => setExpandedKey((cur) => (cur === key ? null : key))}
                onChange={(patch) => updateVar(index, patch)}
                onRemove={() => removeVariable(index)}
              />
            );
          })}
        </SortableContext>
      </DndContext>
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

  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      className={"ou-card ou-card--outlined ou-card--sm tb-level-card" + (expanded ? "" : " is-collapsed")}
      data-testid={`metrics-card-${props.index}`}
      data-field={`resultVariables[${props.index}]`}
    >
      <header className="ou-card__header tb-level-card__head">
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
          <VariableForm
            variable={v}
            index={props.index}
            topics={props.topics}
            scales={props.scales}
            testId={props.testId}
            readOnly={readOnly}
            fieldErrors={props.fieldErrors}
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
  onChange: (patch: Partial<ResultVariableModel>) => void;
};

function VariableForm({ variable: v, index, topics, scales, testId, readOnly, fieldErrors, onChange }: FormProps) {
  const validation = useFormulaValidation(testId, v, index);
  // New (empty) variables open in the constructor; existing ones open in DSL so
  // the real stored formula is shown verbatim (the builder does not round-trip).
  const [formulaMode, setFormulaMode] = useState<"builder" | "dsl">(
    v.formula.trim() === "" ? "builder" : "dsl",
  );

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

  return (
    <>
      <Grid cols={2} gap={3}>
        <div data-field={`resultVariables[${index}].name`}>
          <Input
            size="m"
            fullWidth
            label="Имя"
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

      <hr className="wf-sep" />

      <div className="ou-formfield" data-field={`resultVariables[${index}].formula`}>
        <label className="ou-formfield__lbl">Формула</label>
        <SegmentedControl<"builder" | "dsl">
          size="m"
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
              rows={5}
              value={v.formula}
              disabled={readOnly}
              placeholder='напр. IF(percent >= 75, "Зачёт", "Незачёт")'
              aria-label="Формула DSL"
              onChange={(e) => onChange({ formula: e.target.value })}
              data-testid={`metrics-formula-${index}`}
            />
          </>
        ) : (
          <FormulaBuilder variable={v} topics={topics} scales={scales} readOnly={readOnly} onChange={onChange} />
        )}
      </div>
      {fnOpen && <FunctionReferenceModal onClose={() => setFnOpen(false)} onInsert={insertAtCursor} />}
      {validation.banner && (
        <Banner tone={validation.banner.tone} size="sm" description={validation.banner.text} />
      )}

      <hr className="wf-sep" />

      <div className="tb-section-label">Вывод</div>
      <Grid cols={isBoolean ? 2 : 1} gap={3}>
        {isBoolean && (
          <Select<ResultVariableControlsStatus>
            size="m"
            fullWidth
            label="Управление статусом курса"
            value={v.controlsStatus}
            disabled={readOnly}
            options={STATUS_OPTIONS}
            onChange={(value) => onChange({ controlsStatus: value })}
            data-testid={`metrics-status-${index}`}
          />
        )}
        <Select<ResultVariableScormTarget>
          size="m"
          fullWidth
          label="Передавать в LMS"
          value={v.scormTarget}
          disabled={readOnly}
          options={TARGET_OPTIONS}
          onChange={(value) => onChange({ scormTarget: value })}
          data-testid={`metrics-target-${index}`}
        />
      </Grid>
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
  const [template, setTemplate] = useState<BuilderTemplate>("threshold");
  const [conditions, setConditions] = useState<Condition[]>(() => [defaultCondition(scales)]);
  const [catScale, setCatScale] = useState<string>(() => scales[0]?.key ?? "");
  const [catRows, setCatRows] = useState<Array<{ level: string; label: string }>>(() => [{ level: "", label: "" }]);
  const [catElse, setCatElse] = useState("Недостаточно");
  const [wRows, setWRows] = useState<Array<{ scaleKey: string; weight: string }>>(
    () => [{ scaleKey: scales[0]?.key ?? "", weight: "1" }],
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
      default:
        return "";
    }
  }, [template, conditions, catScale, catRows, catElse, wRows, scales, topics]);

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
          <label className="ou-formfield__lbl">Все условия должны выполняться (И)</label>
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
    </div>
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
function useFormulaValidation(
  testId: string | undefined,
  v: ResultVariableModel,
  index: number,
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
        .then((res) => {
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
  }, [testId, v.formula, v.type, v.id, index]);

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
