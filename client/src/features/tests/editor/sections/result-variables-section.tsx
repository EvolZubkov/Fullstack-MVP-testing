/**
 * @module features/tests/editor/sections/result-variables-section
 * @description «Показатели» editor tab (PRD-2). Lists the test's result
 * variables as reorderable accordion cards, each editing one variable: name,
 * label, type, course-status control, formula (DSL editor or a small visual
 * builder) and LMS publication. Edits flow into the test draft via
 * `updateModel`; the single drawer «Сохранить» persists them through the
 * diff-on-save orchestrator (see use-test-editor / result-variables-api).
 *
 * Source of truth for the layout: docs/wireframes/approved/prd2-prd5-scoring-tabs.html
 * (states s-indicators / list / builder / error / empty).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  Button,
  EmptyState,
  IconButton,
  Input,
  Select,
  SegmentedControl,
  Switch,
  Textarea,
} from "@universityrt/ui-kit";
import { ChevronDown, GripVertical, Plus, Trash2 } from "lucide-react";
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
import {
  validateResultVariableFormula,
  type ResultVariableFormulaValidation,
} from "../result-variables-api";

export type ResultVariablesSectionProps = {
  model: TestEditorModel;
  /** Test id; `undefined` in create mode — disables live formula validation. */
  testId?: string;
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  readOnly?: boolean;
};

const TYPE_OPTIONS: Array<{ value: ResultVariableType; label: string }> = [
  { value: "number", label: "Число" },
  { value: "string", label: "Строка" },
  { value: "boolean", label: "Булево" },
];

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

type TopicRef = { id: string; name: string };

/** A stable per-row key: server id when persisted, else a synthesized draft id. */
function rowKey(v: ResultVariableModel, index: number): string {
  return v.id ?? `draft-${index}-${v.name || "new"}`;
}

function emptyVariable(sortOrder: number): ResultVariableModel {
  return {
    name: "",
    label: "",
    type: "number",
    formula: "",
    showToLearner: false,
    scormTarget: "both",
    controlsStatus: "none",
    sortOrder,
  };
}

export function ResultVariablesSection({
  model,
  testId,
  updateModel,
  readOnly = false,
}: ResultVariablesSectionProps) {
  const vars = model.resultVariables;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Topics feed the visual builder's «source» picker (topicById(...)).
  const topics = useMemo(
    () => model.sections.map((s) => ({ id: s.topicId, name: s.topicName })),
    [model.sections],
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

  return (
    <div className="tb-settings-content" data-testid="metrics-section">
      <div className="wf-list-head">
        <div className="tb-section-label">
          Показатели результата{vars.length > 1 ? " · порядок вычисления" : ""}
        </div>
        {!readOnly && (
          <Button
            variant="ghost"
            size="s"
            onClick={addVariable}
            data-testid="metrics-add"
          >
            <Plus width={16} height={16} aria-hidden="true" /> Добавить показатель
          </Button>
        )}
      </div>

      {vars.length === 0 ? (
        <EmptyState
          layout="inline"
          well
          title="Пока нет показателей"
          description="Показатель — это формула над результатами теста (категория, флаг, итоговый вердикт). Добавьте первый показатель."
          data-testid="metrics-empty"
        />
      ) : (
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
                  testId={testId}
                  readOnly={readOnly}
                  expanded={expandedKey === key}
                  onToggle={() => setExpandedKey((cur) => (cur === key ? null : key))}
                  onChange={(patch) => updateVar(index, patch)}
                  onRemove={() => removeVariable(index)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// ─── Per-variable card ────────────────────────────────────────────────────────

type CardProps = {
  id: string;
  index: number;
  variable: ResultVariableModel;
  topics: TopicRef[];
  testId?: string;
  readOnly: boolean;
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
            testId={props.testId}
            readOnly={readOnly}
            onChange={props.onChange}
          />
        </div>
      )}
    </section>
  );
}

// ─── Variable form ────────────────────────────────────────────────────────────

type FormProps = {
  variable: ResultVariableModel;
  index: number;
  topics: TopicRef[];
  testId?: string;
  readOnly: boolean;
  onChange: (patch: Partial<ResultVariableModel>) => void;
};

function VariableForm({ variable: v, index, topics, testId, readOnly, onChange }: FormProps) {
  const validation = useFormulaValidation(testId, v, index);
  const statusTypeError = v.controlsStatus !== "none" && v.type !== "boolean";
  const [formulaMode, setFormulaMode] = useState<"builder" | "dsl">("dsl");

  return (
    <>
      <div className="wf-grid-2">
        <Input
          size="m"
          fullWidth
          label="Имя *"
          value={v.name}
          disabled={readOnly}
          placeholder="напр. burnout_category"
          onChange={(e) => onChange({ name: e.target.value })}
          data-testid={`metrics-name-${index}`}
        />
        <Input
          size="m"
          fullWidth
          label="Метка"
          value={v.label}
          disabled={readOnly}
          onChange={(e) => onChange({ label: e.target.value })}
          data-testid={`metrics-label-${index}`}
        />
        <Select<ResultVariableType>
          size="m"
          fullWidth
          label="Тип"
          value={v.type}
          disabled={readOnly}
          options={TYPE_OPTIONS}
          onChange={(value) => onChange({ type: value })}
          data-testid={`metrics-type-${index}`}
        />
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
      </div>
      {statusTypeError && (
        <Banner
          tone="error"
          size="sm"
          description="Управление статусом доступно только для показателей типа «булево». Измените тип или сбросьте в «Нет»."
        />
      )}

      <hr className="wf-sep" />

      <div className="ou-formfield">
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
          <Textarea
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
        ) : (
          <FormulaBuilder variable={v} topics={topics} readOnly={readOnly} onChange={onChange} />
        )}
      </div>
      {validation.banner && (
        <Banner tone={validation.banner.tone} size="sm" description={validation.banner.text} />
      )}

      <hr className="wf-sep" />

      <Switch
        label="Показывать результат обучающемуся"
        checked={v.showToLearner}
        disabled={readOnly}
        onChange={(e) => onChange({ showToLearner: e.target.checked })}
        data-testid={`metrics-show-${index}`}
      />
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
    </>
  );
}

// ─── Visual formula builder ───────────────────────────────────────────────────

type BuilderTemplate = "topic_threshold" | "percent_threshold" | "level";

const TEMPLATE_OPTIONS: Array<{ value: BuilderTemplate; label: string }> = [
  { value: "topic_threshold", label: "Порог по теме" },
  { value: "percent_threshold", label: "Порог по общему проценту" },
  { value: "level", label: "Категория по уровням" },
];

const OPERATOR_OPTIONS = [
  { value: ">=", label: "≥" },
  { value: ">", label: ">" },
  { value: "=", label: "=" },
  { value: "<=", label: "≤" },
  { value: "<", label: "<" },
];

function generateFormula(t: BuilderTemplate, source: string, op: string, threshold: string): string {
  const th = threshold.trim() === "" ? "0" : threshold.trim();
  if (t === "level") {
    return 'IF(percent >= 90, "Expert", IF(percent >= 70, "Advanced", "Beginner"))';
  }
  if (t === "topic_threshold" && source) {
    return `topicById("${source}").percent ${op} ${th}`;
  }
  return `percent ${op} ${th}`;
}

/**
 * Small visual builder matching the «Конструктор» state of the wireframe: pick a
 * template and (for threshold templates) a source / operator / threshold; the
 * generated DSL is shown read-only and written into the variable's formula on
 * every field change. Editing existing formulas stays on the DSL tab — the
 * builder always emits a fresh expression.
 */
function FormulaBuilder({
  variable: v,
  topics,
  readOnly,
  onChange,
}: {
  variable: ResultVariableModel;
  topics: TopicRef[];
  readOnly: boolean;
  onChange: (patch: Partial<ResultVariableModel>) => void;
}) {
  const [template, setTemplate] = useState<BuilderTemplate>("topic_threshold");
  const [source, setSource] = useState<string>(topics[0]?.id ?? "");
  const [op, setOp] = useState<string>(">=");
  const [threshold, setThreshold] = useState<string>("70");

  const apply = (t: BuilderTemplate, s: string, o: string, th: string) => {
    setTemplate(t);
    setSource(s);
    setOp(o);
    setThreshold(th);
    if (!readOnly) onChange({ formula: generateFormula(t, s, o, th) });
  };

  const showCondition = template !== "level";
  const generated = generateFormula(template, source, op, threshold);

  return (
    <div className="tb-formula-builder">
      <Select<BuilderTemplate>
        size="m"
        fullWidth
        label="Шаблон"
        value={template}
        disabled={readOnly}
        options={TEMPLATE_OPTIONS}
        onChange={(value) => apply(value, source, op, threshold)}
      />

      {showCondition && (
        <div className="wf-grid-2">
          {template === "topic_threshold" && (
            <Select<string>
              size="m"
              fullWidth
              label="Тема"
              value={source}
              disabled={readOnly || topics.length === 0}
              options={
                topics.length > 0
                  ? topics.map((t) => ({ value: t.id, label: t.name }))
                  : [{ value: "", label: "Нет тем" }]
              }
              onChange={(value) => apply(template, value, op, threshold)}
            />
          )}
          <Select<string>
            size="m"
            fullWidth
            label="Оператор"
            value={op}
            disabled={readOnly}
            options={OPERATOR_OPTIONS}
            onChange={(value) => apply(template, source, value, threshold)}
          />
        </div>
      )}

      {showCondition && (
        <Input
          size="m"
          fullWidth
          label="Порог"
          value={threshold}
          disabled={readOnly}
          onChange={(e) => apply(template, source, op, e.target.value)}
        />
      )}

      <Textarea
        size="m"
        fullWidth
        rows={2}
        readOnly
        value={generated}
        label="Сгенерированная формула (только чтение)"
        aria-label="Сгенерированная формула"
      />
    </div>
  );
}

// ─── Live formula validation ──────────────────────────────────────────────────

type FormulaBanner = { tone: "success" | "error" | "info"; text: string };

/**
 * Debounced (400 ms, NFR-18 / PRD-2 A0) live validation of the formula against
 * the test context. No-op in create mode (no `testId`) — the formula is then
 * only checked server-side on the first save.
 */
function useFormulaValidation(
  testId: string | undefined,
  v: ResultVariableModel,
  index: number,
): { banner: FormulaBanner | null } {
  const [banner, setBanner] = useState<FormulaBanner | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!testId || !v.formula.trim()) {
      setBanner(null);
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
        .then((res) => setBanner(toBanner(res, v.type)))
        .catch(() => setBanner(null));
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [testId, v.formula, v.type, v.id, index]);

  return { banner };
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
