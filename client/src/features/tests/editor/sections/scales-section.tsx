/**
 * @module features/tests/editor/sections/scales-section
 * @description «Шкалы» editor tab (PRD-5). A two-pane Drawer split: «Список
 * шкал» edits the test's measurement scales (key, label, aggregation,
 * normalization/direction, interpretation bands, LMS publication) and «Вклады
 * вопросов» — the contribution matrix — lands in a follow-up increment (B4b).
 * Edits flow into the test draft via `updateModel`; the single drawer
 * «Сохранить» persists them through the diff-on-save orchestrator (see
 * use-test-editor / scales-api). The «Предпросмотр расчёта» action runs the
 * shared scale engine over demo answers via the preview endpoint.
 *
 * Source of truth for the layout:
 * docs/wireframes/approved/prd2-prd5-scoring-tabs.html (states s-scales /
 * s-scales-empty / s-scale-error / s-preview-calc). Composite scales
 * (s-scale-advanced, source = other scales) are deferred — the engine does not
 * yet compute scale-of-scales — so that source option is shown disabled.
 */

import { type CSSProperties, Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  Checkbox,
  Cluster,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  Grid,
  IconButton,
  Input,
  ModalDialog,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Tag,
} from "@universityrt/ui-kit";
import { Check, ChevronDown, ChevronRight, Info, Plus, Trash2 } from "lucide-react";

import type {
  QuestionMeasurementModel,
  ScaleAggregation,
  ScaleBandModel,
  ScaleModel,
  ScaleScormTarget,
  TestEditorModel,
} from "../test-editor.types";
import {
  loadContributionQuestions,
  loadScalePreviewContext,
  previewScales,
  type ContributionQuestion,
  type ContributionUnit,
  type PreviewAnswer,
  type PreviewQuestionContext,
  type ScalePreviewResult,
} from "../scales-api";
import type { FieldErrorIndex } from "../field-errors";
import { formatAuthorNumber, parseAuthorNumber, sanitizeAuthorNumberInput } from "../numeric-input";
import { FoldAllButtons, useSectionFold } from "./section-fold";
import { isSingleIndexChoice } from "@shared/questions/question-type";

// Вывод шкал ученику — отдельный PRD (дальняя перспектива). До него тогл
// «Показывать результат обучающемуся» скрыт; поле showToLearner сохранено в модели.
const SHOW_LEARNER_RESULT_TOGGLE: boolean = false;

export type ScalesSectionProps = {
  model: TestEditorModel;
  /** Test id; `undefined` in create mode — disables the calculation preview. */
  testId?: string;
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  readOnly?: boolean;
  /**
   * FR-20c: accepted for a uniform section contract, but unused — Scales
   * already surfaces field errors locally via {@link validateScale}
   * (`keyError` → `Input error`). The central index would duplicate it.
   */
  fieldErrors?: FieldErrorIndex;
};

type ScalesSubTab = "list" | "contributions";

/** The combined «Пересчёт итога» control maps to a (normalization, direction) pair. */
type RecalcValue = "none" | "percent" | "inverse";

const AGG_OPTIONS: Array<{ value: ScaleAggregation; label: string }> = [
  { value: "sum", label: "Сумма" },
  { value: "avg", label: "Среднее" },
  { value: "weighted_avg", label: "Взвешенное среднее" },
  { value: "max", label: "Максимум" },
  { value: "min", label: "Минимум" },
];

const RECALC_OPTIONS: Array<{ value: RecalcValue; label: string }> = [
  { value: "none", label: "Нет" },
  { value: "percent", label: "Проценты" },
  { value: "inverse", label: "Инверсия" },
];

const TARGET_OPTIONS: Array<{ value: ScaleScormTarget; label: string }> = [
  { value: "none", label: "Не передавать" },
  { value: "suspend_data", label: "Только в пакете" },
  { value: "interaction", label: "Столбцом в отчёте" },
  { value: "both", label: "И то, и другое" },
];

const AGG_LABEL: Record<ScaleAggregation, string> = {
  sum: "сумма",
  avg: "среднее",
  weighted_avg: "взвеш. среднее",
  max: "максимум",
  min: "минимум",
};

const RECALC_LABEL: Record<RecalcValue, string> = {
  none: "без пересчёта",
  percent: "проценты",
  inverse: "инверсия",
};

const SCALE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

let localKeyCounter = 0;

function recalcOf(s: ScaleModel): RecalcValue {
  if (s.normalization !== "percent") return "none";
  return s.direction === "inverse" ? "inverse" : "percent";
}

function recalcPatch(v: RecalcValue): Pick<ScaleModel, "normalization" | "direction"> {
  if (v === "none") return { normalization: "none", direction: "positive" };
  if (v === "percent") return { normalization: "percent", direction: "positive" };
  return { normalization: "percent", direction: "inverse" };
}

function emptyBand(): ScaleBandModel {
  localKeyCounter += 1;
  return { clientKey: `band-${localKeyCounter}`, min: "", max: "", label: "", level: "" };
}

function emptyScale(sortOrder: number): ScaleModel {
  localKeyCounter += 1;
  return {
    clientKey: `scale-${localKeyCounter}`,
    key: "",
    label: "",
    type: "number",
    aggregation: "sum",
    normalization: "none",
    direction: "positive",
    bands: [],
    showToLearner: false,
    scormTarget: "none",
    sortOrder,
  };
}

/** Stable per-row key: the server id once persisted, else the client key. */
function rowKey(s: ScaleModel, index: number): string {
  return s.id ?? s.clientKey ?? `row-${index}`;
}

function pluralBands(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} диапазон`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} диапазона`;
  return `${n} диапазонов`;
}

function pluralQuestions(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вопрос`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} вопроса`;
  return `${n} вопросов`;
}

/** The blocking key error for one scale (empty / grammar / duplicate), else null. */
function keyErrorOf(s: ScaleModel, index: number, scales: ScaleModel[]): string | null {
  if (!s.key.trim()) return "Укажите ключ шкалы.";
  if (!SCALE_KEY_RE.test(s.key)) {
    return "Ключ: строчная буква в начале; буквы/цифры/подчёркивание; до 64 символов.";
  }
  const firstWithKey = scales.findIndex((o) => o.key === s.key);
  if (firstWithKey !== index) return `Ключ «${s.key}» уже используется другой шкалой.`;
  return null;
}

/** Blocking band error message for one scale (numeric/order/overlap), else null. */
function bandErrorOf(s: ScaleModel): string | null {
  let prevMax: number | null = null;
  for (let j = 0; j < s.bands.length; j++) {
    const b = s.bands[j];
    const minRaw = b.min.trim();
    const maxRaw = b.max.trim();
    if (minRaw === "" && maxRaw === "" && b.label.trim() === "" && b.level.trim() === "") continue;
    const min = parseAuthorNumber(minRaw);
    const max = parseAuthorNumber(maxRaw);
    if (min === null || max === null) {
      return `Диапазон ${j + 1}: укажите числовые min и max.`;
    }
    if (min > max) return `Диапазон ${j + 1}: min не может быть больше max.`;
    if (prevMax !== null && min <= prevMax) {
      return `Диапазон ${j + 1}: пересекается с предыдущим. Вводите по возрастанию raw без пересечений.`;
    }
    prevMax = max;
  }
  return null;
}

export function ScalesSection({ model, testId, updateModel, readOnly = false }: ScalesSectionProps) {
  const [subTab, setSubTab] = useState<ScalesSubTab>("list");

  // «Вклады вопросов» is meaningless without at least one scale (nothing to
  // contribute to), so its rail item is disabled until a scale exists. If the
  // last scale is removed while on it, fall back to «Список шкал».
  const hasScales = useMemo(() => model.scales.some((s) => s.key.trim() !== ""), [model.scales]);
  const effectiveTab: ScalesSubTab = subTab === "contributions" && hasScales ? "contributions" : "list";

  return (
    <div className="ou-drawer__split" data-testid="scales-split">
      <nav className="ou-drawer__rail" aria-label="Подразделы шкал">
        <button
          type="button"
          className={"ou-drawer__rail-item" + (effectiveTab === "list" ? " is-active" : "")}
          aria-current={effectiveTab === "list" ? "page" : undefined}
          onClick={() => setSubTab("list")}
        >
          Список шкал
        </button>
        <button
          type="button"
          className={"ou-drawer__rail-item" + (effectiveTab === "contributions" ? " is-active" : "")}
          aria-current={effectiveTab === "contributions" ? "page" : undefined}
          disabled={!hasScales}
          title={!hasScales ? "Сначала добавьте шкалу в разделе «Список шкал»" : undefined}
          onClick={() => setSubTab("contributions")}
          data-testid="scales-rail-contributions"
        >
          Вклады вопросов
        </button>
      </nav>
      <div className="tb-settings-content" data-testid={`scales-pane-${effectiveTab}`}>
        {effectiveTab === "list" ? (
          <ScalesListPane model={model} testId={testId} updateModel={updateModel} readOnly={readOnly} />
        ) : (
          <ContributionsPane model={model} updateModel={updateModel} readOnly={readOnly} />
        )}
      </div>
    </div>
  );
}

// ─── «Список шкал» pane ─────────────────────────────────────────────────────────

function ScalesListPane({
  model,
  testId,
  updateModel,
  readOnly,
}: {
  model: TestEditorModel;
  testId?: string;
  updateModel: ScalesSectionProps["updateModel"];
  readOnly: boolean;
}) {
  const scales = model.scales;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const setScales = useCallback(
    (next: ScaleModel[]) => updateModel((m) => ({ ...m, scales: next })),
    [updateModel],
  );

  const updateScale = useCallback(
    (index: number, patch: Partial<ScaleModel>) => {
      updateModel((m) => ({
        ...m,
        scales: m.scales.map((s, i) => (i === index ? { ...s, ...patch } : s)),
      }));
    },
    [updateModel],
  );

  const addScale = useCallback(() => {
    const created = emptyScale(scales.length);
    setScales([...scales, created]);
    setExpandedKey(rowKey(created, scales.length));
  }, [scales, setScales]);

  const removeScale = useCallback(
    (index: number) => {
      const removedKey = scales[index]?.key;
      updateModel((m) => ({
        ...m,
        scales: m.scales.filter((_, i) => i !== index).map((s, i) => ({ ...s, sortOrder: i })),
        // Drop the deleted scale's contributions so coverage/dirty stay accurate.
        measurements: removedKey ? m.measurements.filter((x) => x.scaleKey !== removedKey) : m.measurements,
      }));
    },
    [scales, updateModel],
  );

  const anyError = useMemo(
    () => scales.some((s, i) => keyErrorOf(s, i, scales) !== null || bandErrorOf(s) !== null),
    [scales],
  );

  // Coverage: distinct measured questions per scale key (drives the card subtitle
  // «N вопросов» and the «no contributions» warning dot).
  const coverageByKey = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const meas of model.measurements) {
      const set = map.get(meas.scaleKey) ?? new Set<string>();
      set.add(meas.questionId);
      map.set(meas.scaleKey, set);
    }
    return map;
  }, [model.measurements]);

  if (scales.length === 0) {
    return (
      <EmptyState
        layout="page"
        well
        art={<Info aria-hidden="true" />}
        title="Пока нет шкал"
        description="Шкала измеряет компетенцию или признак: суммирует вклады вопросов, нормализует и даёт уровень. Добавьте первую шкалу теста."
        actions={
          !readOnly ? (
            <Button
              variant="primary"
              size="s"
              leadingIcon={<Plus size={16} aria-hidden="true" />}
              onClick={addScale}
              data-testid="scales-empty-add"
            >
              Добавить шкалу
            </Button>
          ) : undefined
        }
        data-testid="scales-empty"
      />
    );
  }

  return (
    <>
      <Cluster justify="between" gap={0} wrap={false} style={{ marginBottom: "var(--ou-space-3)" }}>
        <div className="tb-section-label">Шкалы теста</div>
        <Cluster gap={2} wrap={false}>
          <Button
            variant="ghost"
            size="s"
            disabled={!testId}
            onClick={() => setPreviewOpen(true)}
            data-testid="scales-preview-open"
          >
            Предпросмотр расчёта
          </Button>
          {!readOnly && (
            <Button
              variant="ghost"
              size="s"
              leadingIcon={<Plus size={16} aria-hidden="true" />}
              onClick={addScale}
              data-testid="scales-add"
            >
              Добавить шкалу
            </Button>
          )}
        </Cluster>
      </Cluster>

      {anyError && (
        <Banner
          tone="error"
          size="sm"
          description="Есть ошибки в шкалах. Сохранение заблокировано до их исправления."
          data-testid="scales-error-banner"
        />
      )}

      {scales.map((scale, index) => {
          const key = rowKey(scale, index);
          return (
            <ScaleCard
              key={key}
              index={index}
              scale={scale}
              scales={scales}
              coverage={coverageByKey.get(scale.key)?.size ?? 0}
              readOnly={readOnly}
              expanded={expandedKey === key}
              onToggle={() => setExpandedKey((cur) => (cur === key ? null : key))}
              onChange={(patch) => updateScale(index, patch)}
              onRemove={() => removeScale(index)}
            />
          );
      })}

      {previewOpen && testId && (
        <ScalePreviewModal testId={testId} onClose={() => setPreviewOpen(false)} />
      )}
    </>
  );
}

// ─── Per-scale card ─────────────────────────────────────────────────────────────

type ScaleCardProps = {
  index: number;
  scale: ScaleModel;
  scales: ScaleModel[];
  /** Distinct questions contributing to this scale (drives subtitle + warn dot). */
  coverage: number;
  readOnly: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ScaleModel>) => void;
  onRemove: () => void;
};

function ScaleCard({ index, scale: s, scales, coverage, readOnly, expanded, onToggle, onChange, onRemove }: ScaleCardProps) {
  const keyError = keyErrorOf(s, index, scales);
  const bandError = bandErrorOf(s);
  const hasError = keyError !== null || bandError !== null;

  const heading = `${s.key ? s.key.toUpperCase() : "новая шкала"}${s.label ? ` — ${s.label}` : ""}`;
  const recalc = recalcOf(s);
  const subtitle = [
    AGG_LABEL[s.aggregation],
    RECALC_LABEL[recalc],
    s.bands.length > 0 ? pluralBands(s.bands.length) : null,
    coverage > 0 ? pluralQuestions(coverage) : "без вкладов",
  ]
    .filter(Boolean)
    .join(" · ");

  // err blocks save; warn flags a scale with no contributions yet (soft).
  const dotClass = hasError
    ? "tb-status-dot--err"
    : coverage === 0
      ? "tb-status-dot--warn"
      : "tb-status-dot--ok";

  return (
    <section
      className={"ou-card ou-card--outlined ou-card--sm tb-level-card" + (expanded ? "" : " is-collapsed")}
      data-testid={`scales-card-${index}`}
      data-field={`scales[${index}]`}
    >
      <header className="ou-card__header tb-level-card__head">
        <span className={"tb-status-dot " + dotClass} aria-hidden="true"></span>
        <div className="ou-card__heading tb-level-card__heading">
          <h5 className="ou-card__title tb-level-card__title">{heading}</h5>
          <p className="ou-card__subtitle tb-level-card__summary">{subtitle}</p>
        </div>
        <div className="ou-card__trail tb-level-card__trail">
          {!readOnly && (
            <IconButton
              icon={<Trash2 width={14} height={14} aria-hidden="true" />}
              aria-label="Удалить шкалу"
              variant="ghost"
              size="s"
              onClick={onRemove}
              data-testid={`scales-remove-${index}`}
            />
          )}
          <button
            type="button"
            className="tb-level-card__chev"
            aria-label={expanded ? "Свернуть шкалу" : "Развернуть шкалу"}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            <ChevronDown width={16} height={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {expanded && (
        <div className="ou-card__body tb-level-card__body">
          <ScaleForm
            scale={s}
            index={index}
            readOnly={readOnly}
            keyError={keyError}
            bandError={bandError}
            onChange={onChange}
          />
        </div>
      )}
    </section>
  );
}

// ─── Scale form ─────────────────────────────────────────────────────────────────

function ScaleForm({
  scale: s,
  index,
  readOnly,
  keyError,
  bandError,
  onChange,
}: {
  scale: ScaleModel;
  index: number;
  readOnly: boolean;
  keyError: string | null;
  bandError: string | null;
  onChange: (patch: Partial<ScaleModel>) => void;
}) {
  const setBands = (bands: ScaleBandModel[]) => onChange({ bands });

  return (
    <>
      <Grid cols={2} gap={3}>
        <Input
          size="m"
          fullWidth
          label="Ключ"
          required
          value={s.key}
          disabled={readOnly}
          error={keyError ?? undefined}
          placeholder="напр. ee"
          onChange={(e) => onChange({ key: e.target.value })}
          data-testid={`scales-key-${index}`}
        />
        <Input
          size="m"
          fullWidth
          label="Метка"
          value={s.label}
          disabled={readOnly}
          onChange={(e) => onChange({ label: e.target.value })}
          data-testid={`scales-label-${index}`}
        />
        <Select<ScaleAggregation>
          size="m"
          fullWidth
          label="Агрегация"
          value={s.aggregation}
          disabled={readOnly}
          options={AGG_OPTIONS}
          onChange={(value) => onChange({ aggregation: value })}
          data-testid={`scales-agg-${index}`}
        />
        <div className="ou-formfield">
          <label className="ou-formfield__lbl">Источник</label>
          <SegmentedControl<"questions" | "scales">
            size="m"
            value="questions"
            aria-label="Источник шкалы"
            items={[
              { value: "questions", label: "Вопросы" },
              { value: "scales", label: "Другие шкалы", disabled: true },
            ]}
            onChange={() => {
              /* composite scales (source = other scales) are deferred; questions only */
            }}
          />
          <p className="ou-formfield__desc">
            «Другие шкалы» пока недоступны — расчёт шкалы из других шкал ещё не
            реализован.
          </p>
        </div>
        <Select<RecalcValue>
          size="m"
          fullWidth
          label="Пересчёт итога"
          value={recalcOf(s)}
          disabled={readOnly}
          options={RECALC_OPTIONS}
          onChange={(value) => onChange(recalcPatch(value))}
          data-testid={`scales-recalc-${index}`}
        />
        <Select<ScaleScormTarget>
          size="m"
          fullWidth
          label="Передавать в LMS"
          value={s.scormTarget}
          disabled={readOnly}
          options={TARGET_OPTIONS}
          onChange={(value) => onChange({ scormTarget: value })}
          data-testid={`scales-target-${index}`}
        />
      </Grid>

      <hr className="wf-sep" />
      <div className="tb-section-label">Диапазоны (пороги) → уровень</div>
      <BandsEditor bands={s.bands} index={index} readOnly={readOnly} onChange={setBands} />
      {bandError && <Banner tone="error" size="sm" description={bandError} />}
      <Banner
        tone="info"
        size="sm"
        description={
          "«Уровень» — произвольный код (напр. high / passed), публикуется в scale.{key}.level " +
          "для формул показателей. «Метка» необязательна: пусто → обучающемуся показывается код. " +
          "Диапазоны вводятся по возрастанию raw, не пересекаются."
        }
      />

      {SHOW_LEARNER_RESULT_TOGGLE && (
        <>
          <hr className="wf-sep" />
          <Switch
            label="Показывать результат обучающемуся"
            checked={s.showToLearner}
            disabled={readOnly}
            onChange={(e) => onChange({ showToLearner: e.target.checked })}
            data-testid={`scales-show-${index}`}
          />
        </>
      )}
    </>
  );
}

// ─── Bands editor ───────────────────────────────────────────────────────────────

function BandsEditor({
  bands,
  index,
  readOnly,
  onChange,
}: {
  bands: ScaleBandModel[];
  index: number;
  readOnly: boolean;
  onChange: (bands: ScaleBandModel[]) => void;
}) {
  const update = (j: number, patch: Partial<ScaleBandModel>) =>
    onChange(bands.map((b, i) => (i === j ? { ...b, ...patch } : b)));
  const remove = (j: number) => onChange(bands.filter((_, i) => i !== j));
  const add = () => onChange([...bands, emptyBand()]);

  return (
    <>
      <table className="tb-table tb-table--mb tb-bands-table" data-testid={`scales-bands-${index}`}>
        <colgroup>
          <col />
          <col />
          <col />
          <col />
          <col className="tb-bands-table__act" />
        </colgroup>
        <thead>
          <tr>
            <th>min</th>
            <th>max</th>
            <th>Метка (опц.)</th>
            <th>Уровень</th>
            <th><span className="sr-only">Действия</span></th>
          </tr>
        </thead>
        <tbody>
          {bands.length === 0 ? (
            <tr>
              <td colSpan={5}><span className="tb-card-desc">Диапазоны не заданы</span></td>
            </tr>
          ) : (
            bands.map((b, j) => {
              const k = b.clientKey ?? `band-${j}`;
              return (
                <tr key={k}>
                  <td>
                    <Input
                      size="s"
                      value={b.min}
                      disabled={readOnly}
                      aria-label={`min диапазона ${j + 1}`}
                      onChange={(e) => update(j, { min: e.target.value })}
                    />
                  </td>
                  <td>
                    <Input
                      size="s"
                      value={b.max}
                      disabled={readOnly}
                      aria-label={`max диапазона ${j + 1}`}
                      onChange={(e) => update(j, { max: e.target.value })}
                    />
                  </td>
                  <td>
                    <Input
                      size="s"
                      value={b.label}
                      disabled={readOnly}
                      placeholder="(опционально)"
                      aria-label={`метка диапазона ${j + 1}`}
                      onChange={(e) => update(j, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <Input
                      size="s"
                      value={b.level}
                      disabled={readOnly}
                      placeholder="напр. high"
                      aria-label={`уровень диапазона ${j + 1}`}
                      onChange={(e) => update(j, { level: e.target.value })}
                    />
                  </td>
                  <td>
                    {!readOnly && (
                      <IconButton
                        icon={<Trash2 width={14} height={14} aria-hidden="true" />}
                        aria-label={`Удалить диапазон ${j + 1}`}
                        variant="ghost"
                        size="s"
                        onClick={() => remove(j)}
                      />
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {!readOnly && (
        <Button
          variant="ghost"
          size="s"
          leadingIcon={<Plus size={16} aria-hidden="true" />}
          onClick={add}
          data-testid={`scales-band-add-${index}`}
        >
          Добавить диапазон
        </Button>
      )}
    </>
  );
}

// ─── Calculation preview modal ────────────────────────────────────────────────────

function ScalePreviewModal({ testId, onClose }: { testId: string; onClose: () => void }) {
  const [context, setContext] = useState<PreviewQuestionContext[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, PreviewAnswer>>({});
  const [result, setResult] = useState<ScalePreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazily load the demo-answer context (measured questions + their units).
  useEffect(() => {
    let alive = true;
    loadScalePreviewContext(testId)
      .then((ctx) => {
        if (alive) setContext(ctx);
      })
      .catch(() => {
        if (alive) setError("Не удалось загрузить вопросы для предпросмотра.");
      });
    return () => {
      alive = false;
    };
  }, [testId]);

  const setSingle = (questionId: string, value: number | null) =>
    setAnswers((a) => ({ ...a, [questionId]: value }));

  const toggleMultiple = (questionId: string, optionIndex: number, on: boolean) =>
    setAnswers((a) => {
      const cur = Array.isArray(a[questionId]) ? (a[questionId] as number[]) : [];
      const next = on ? [...cur, optionIndex] : cur.filter((i) => i !== optionIndex);
      return { ...a, [questionId]: next };
    });

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await previewScales(testId, answers));
    } catch {
      setError("Не удалось рассчитать. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }, [testId, answers]);

  const supported = (context ?? []).filter((q) => q.supported);
  const unsupported = (context ?? []).filter((q) => !q.supported);

  return (
    <ModalDialog
      open
      onClose={onClose}
      size="l"
      title="Предпросмотр расчёта"
      description="Проверка на демо-ответе — авторский расчёт (raw / percent / уровень), не вид обучающегося"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
          <Button variant="primary" onClick={run} disabled={loading} data-testid="scales-preview-run">
            {loading ? "Расчёт…" : "Рассчитать"}
          </Button>
        </>
      }
      data-testid="scales-preview-modal"
    >
      {error && <Banner tone="error" size="sm" description={error} />}

      {context === null ? (
        <p className="tb-card-desc">Загрузка…</p>
      ) : context.length === 0 ? (
        <Banner
          tone="info"
          size="sm"
          description="Ни один вопрос пока не вносит вклад в шкалы. Задайте вклады во вкладке «Вклады вопросов», чтобы расчёт был содержательным."
        />
      ) : (
        <>
          <div className="tb-section-label">Демо-ответ</div>
          {supported.map((q) => (
            <div className="ou-formfield" key={q.id}>
              <label className="ou-formfield__lbl">{q.prompt}</label>
              {/* Демо-ответ шкалы — тот же выбор ОДНОЙ единицы, что у одиночного
                  выбора: список градаций (PRD-26). */}
              {isSingleIndexChoice(q.type) ? (
                <Select<string>
                  size="m"
                  fullWidth
                  value={typeof answers[q.id] === "number" ? String(answers[q.id]) : ""}
                  options={[
                    { value: "", label: "— не отвечено —" },
                    ...q.units.map((u) => ({ value: u.sourceKey, label: u.label })),
                  ]}
                  onChange={(value) => setSingle(q.id, value === "" ? null : Number(value))}
                />
              ) : (
                <Stack gap={1}>
                  {q.units.map((u) => {
                    const selected = Array.isArray(answers[q.id])
                      ? (answers[q.id] as number[]).includes(Number(u.sourceKey))
                      : false;
                    return (
                      <Checkbox
                        key={u.sourceKey}
                        label={u.label}
                        checked={selected}
                        onChange={(e) => toggleMultiple(q.id, Number(u.sourceKey), e.target.checked)}
                      />
                    );
                  })}
                </Stack>
              )}
            </div>
          ))}

          {unsupported.length > 0 && (
            <Banner
              tone="info"
              size="sm"
              description={`Предпросмотр демо-ответа для сопоставления/ранжирования появится вместе с матрицей вкладов. Вопросов этих типов со вкладами: ${unsupported.length}.`}
            />
          )}
        </>
      )}

      {result && (
        <table className="tb-table tb-table--mb" data-testid="scales-preview-table">
          <thead>
            <tr>
              <th>Шкала</th>
              <th>raw</th>
              <th>percent</th>
              <th>уровень</th>
              <th>scale.* (доступно в показателях)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(result.values).map(([key, v]) => (
              <tr key={key}>
                <td>{key}</td>
                <td>{v.hasValue ? round(v.raw) : "—"}</td>
                <td>{v.hasValue && v.percent ? round(v.percent) : "—"}</td>
                <td>
                  {v.level ? (
                    <span className="ou-tag ou-tag--neutral ou-tag--outline">{v.label || v.level}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="tb-table__cell--nowrap">scale.{key}.level</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result && result.errors.length > 0 && (
        <Banner tone="warning" size="sm" description={result.errors.map((e) => `${e.key}: ${e.message}`).join("; ")} />
      )}
    </ModalDialog>
  );
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// ─── «Вклады вопросов» pane (contributions matrix) ────────────────────────────────

const UNIT_HEADER: Record<ContributionQuestion["type"], string> = {
  single: "Вариант ответа",
  multiple: "Вариант ответа",
  matching: "Пара ответа (левый → правый)",
  ranking: "Размещение (элемент @ позиция)",
  scale: "Градация шкалы",
};

const QTYPE_LABEL: Record<ContributionQuestion["type"], string> = {
  single: "один выбор",
  multiple: "несколько выборов",
  matching: "сопоставление",
  ranking: "ранжирование",
  scale: "шкала",
};

const UNIT_HINT: Partial<Record<ContributionQuestion["type"], string>> = {
  matching:
    "Строка = направленная пара «левый → правый». Активна каждая фактически составленная пара, независимо от корректности.",
  ranking:
    "Строка = размещение «элемент @ позиция»: один элемент на разных позициях может вкладывать разное. Активно фактическое размещение.",
};

function cellKey(questionId: string, sourceType: string, sourceKey: string, scaleKey: string): string {
  return `${questionId}|${sourceType}|${sourceKey}|${scaleKey}`;
}

/**
 * A scale key is a single unbreakable word ("EMOTIONAL_EXHAUSTION"): an underscore
 * offers no line-break opportunity, so in the fixed-width matrix column the header
 * would overflow onto its neighbours. Emit an explicit <wbr> after each underscore
 * so the key wraps at its own segment boundaries instead of mid-word.
 */
function scaleKeyHeader(key: string): ReactNode {
  const parts = key.toUpperCase().split(/(?<=_)/);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && <wbr />}
    </Fragment>
  ));
}

/**
 * «Вклады вопросов»: the contribution matrix. Each measured question is a card;
 * expanded, it shows a «unit × scale» grid where the author types the explicit
 * numeric contribution of each answer unit into each scale (empty = no row; 0 and
 * negatives valid). The scale columns are the test's scales (referenced by key);
 * contributions persist per question on the single «Сохранить».
 */
function ContributionsPane({
  model,
  updateModel,
  readOnly,
}: {
  model: TestEditorModel;
  updateModel: ScalesSectionProps["updateModel"];
  readOnly: boolean;
}) {
  const [questions, setQuestions] = useState<ContributionQuestion[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const topicIds = useMemo(() => model.sections.map((s) => s.topicId), [model.sections]);
  const scales = useMemo(() => model.scales.filter((s) => s.key.trim() !== ""), [model.scales]);

  useEffect(() => {
    let alive = true;
    setLoadError(false);
    loadContributionQuestions(topicIds)
      .then((qs) => alive && setQuestions(qs))
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [topicIds]);

  const cellMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of model.measurements) {
      map.set(cellKey(m.questionId, m.sourceType, m.sourceKey ?? "", m.scaleKey), m.value);
    }
    return map;
  }, [model.measurements]);

  const contributedByQ = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const m of model.measurements) {
      const set = map.get(m.questionId) ?? new Set<string>();
      set.add(m.scaleKey);
      map.set(m.questionId, set);
    }
    return map;
  }, [model.measurements]);

  // Group the (flat) loaded questions by section, in section order, keeping a
  // running global number for the card headings/testids. Empty sections are
  // skipped. Folding mirrors the «Оценка» tab (shared `useSectionFold`).
  const groups = useMemo(() => {
    const byTopic = new Map<string, ContributionQuestion[]>();
    for (const q of questions ?? []) {
      const list = byTopic.get(q.topicId);
      if (list) list.push(q);
      else byTopic.set(q.topicId, [q]);
    }
    let counter = 0;
    const out: { topicId: string; topicName: string; items: { q: ContributionQuestion; index: number }[] }[] = [];
    for (const s of model.sections) {
      const list = byTopic.get(s.topicId) ?? [];
      if (list.length === 0) continue;
      out.push({
        topicId: s.topicId,
        topicName: s.topicName,
        items: list.map((q) => ({ q, index: counter++ })),
      });
    }
    return out;
  }, [questions, model.sections]);
  const fold = useSectionFold(groups.map((g) => g.topicId));

  const setCell = useCallback(
    (questionId: string, unit: ContributionUnit, scaleKey: string, value: number | null) => {
      updateModel((m) => {
        const others = m.measurements.filter(
          (x) =>
            !(
              x.questionId === questionId &&
              x.sourceType === unit.sourceType &&
              x.sourceKey === unit.sourceKey &&
              x.scaleKey === scaleKey
            ),
        );
        if (value === null) return { ...m, measurements: others };
        const row: QuestionMeasurementModel = {
          questionId,
          scaleKey,
          sourceType: unit.sourceType,
          sourceKey: unit.sourceKey,
          value,
          weight: 1,
        };
        return { ...m, measurements: [...others, row] };
      });
    },
    [updateModel],
  );

  if (loadError) {
    return <Banner tone="error" size="sm" description="Не удалось загрузить вопросы теста." />;
  }
  if (questions === null) {
    return <p className="tb-card-desc">Загрузка вопросов…</p>;
  }
  if (questions.length === 0) {
    return (
      <EmptyState
        layout="inline"
        well
        title="В тесте пока нет вопросов"
        description="Добавьте темы и вопросы во вкладке «Состав», затем задайте их вклады в шкалы."
        data-testid="contributions-no-questions"
      />
    );
  }

  const uncovered = questions.filter((q) => !contributedByQ.has(q.id)).length;

  return (
    <>
      {scales.length === 0 ? (
        <Banner
          tone="info"
          size="sm"
          description="Сначала добавьте хотя бы одну шкалу в разделе «Список шкал» — тогда здесь появятся столбцы для вкладов."
          data-testid="contributions-no-scales"
        />
      ) : (
        uncovered > 0 && (
          <Banner
            tone="warning"
            size="sm"
            description={`${pluralQuestions(uncovered)} пока не привязаны ни к одной шкале — проверьте покрытие.`}
            data-testid="contributions-coverage-banner"
          />
        )
      )}

      {groups.length > 0 && (
        <div className="tb-fold-toolbar">
          <FoldAllButtons fold={fold} testIdPrefix="contrib" />
        </div>
      )}

      {groups.map((group) => {
        const open = fold.isOpen(group.topicId);
        // Coverage reflected at the section level (only meaningful with scales).
        const sectionUncovered = group.items.filter(({ q }) => !contributedByQ.has(q.id)).length;
        return (
          <div className="tb-fold-sec" key={group.topicId} data-testid={`contrib-sec-${group.topicId}`}>
            <Collapsible open={open} onOpenChange={() => fold.toggle(group.topicId)}>
              <div className="tb-fold-sec-head">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="tb-fold-trigger"
                    aria-label={open ? `Свернуть секцию ${group.topicName}` : `Развернуть секцию ${group.topicName}`}
                    data-testid={`contrib-sec-toggle-${group.topicId}`}
                  >
                    {open
                      ? <ChevronDown className="tb-fold-chev" width={16} height={16} aria-hidden="true" />
                      : <ChevronRight className="tb-fold-chev" width={16} height={16} aria-hidden="true" />}
                    <span className="tb-fold-sec-name">{group.topicName}</span>
                  </button>
                </CollapsibleTrigger>
                {scales.length > 0 && sectionUncovered > 0 && (
                  <span
                    className="ou-tag ou-tag--warning ou-tag--outline"
                    data-testid={`contrib-sec-uncovered-${group.topicId}`}
                  >
                    {sectionUncovered} не привязано
                  </span>
                )}
                <span className="ou-tag ou-tag--neutral ou-tag--outline">{pluralQuestions(group.items.length)}</span>
              </div>
              <CollapsibleContent>
                <div className="tb-fold-sec__body">
                  {group.items.map(({ q, index }) => (
                    <QuestionContribCard
                      key={q.id}
                      index={index}
                      question={q}
                      scales={scales}
                      contributed={contributedByQ.get(q.id) ?? new Set()}
                      cellMap={cellMap}
                      readOnly={readOnly}
                      expanded={expandedId === q.id}
                      onToggle={() => setExpandedId((cur) => (cur === q.id ? null : q.id))}
                      onSetCell={setCell}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}
    </>
  );
}

// ─── Per-question contribution card ────────────────────────────────────────────────

function QuestionContribCard({
  index,
  question: q,
  scales,
  contributed,
  cellMap,
  readOnly,
  expanded,
  onToggle,
  onSetCell,
}: {
  index: number;
  question: ContributionQuestion;
  scales: ScaleModel[];
  contributed: Set<string>;
  cellMap: Map<string, number>;
  readOnly: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSetCell: (questionId: string, unit: ContributionUnit, scaleKey: string, value: number | null) => void;
}) {
  // The pane is reached only when the test has at least one scale (the rail item
  // is disabled otherwise), so «не привязан» here is always actionable: amber if
  // the question contributes to no scale, green once it contributes to ≥1.
  const measured = contributed.size > 0;
  const dotClass = measured ? "tb-status-dot--ok" : "tb-status-dot--warn";
  const heading = `${index + 1}. ${q.prompt}`;
  const hint = UNIT_HINT[q.type];

  return (
    <section
      className={"ou-card ou-card--outlined ou-card--sm tb-level-card" + (expanded ? "" : " is-collapsed")}
      data-testid={`contrib-card-${index}`}
    >
      <header className="ou-card__header tb-level-card__head">
        <span className={"tb-status-dot " + dotClass} aria-hidden="true"></span>
        <div className="ou-card__heading tb-level-card__heading">
          <h5 className="ou-card__title tb-level-card__title">{heading}</h5>
          <p className="ou-card__subtitle tb-level-card__summary">
            {QTYPE_LABEL[q.type]}
            {scales
              .filter((s) => contributed.has(s.key))
              .map((s) => (
                <Tag key={s.key} tone="neutral" variant="outline" style={{ marginInlineStart: "var(--ou-space-2)" }} title={s.label}>
                  {s.key.toUpperCase()}
                </Tag>
              ))}
            {!measured && " · не привязан"}
          </p>
        </div>
        <div className="ou-card__trail tb-level-card__trail">
          <button
            type="button"
            className="tb-level-card__chev"
            aria-label={expanded ? "Свернуть вопрос" : "Развернуть вопрос"}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            <ChevronDown width={16} height={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {expanded && (
        <div className="ou-card__body tb-level-card__body">
          {scales.length === 0 ? (
            <p className="tb-card-desc">Добавьте шкалы, чтобы задать вклады.</p>
          ) : q.units.length === 0 ? (
            <p className="tb-card-desc">У вопроса нет единиц ответа для измерения.</p>
          ) : (
            <div className="tb-contrib-grid-wrap">
              <table
                className="tb-table tb-table--mb tb-contrib-grid"
                style={{ "--tb-contrib-cols": scales.length } as CSSProperties}
                data-testid={`contrib-grid-${index}`}
              >
                <thead>
                  <tr>
                    <th className="tb-contrib-grid__unit-col">{UNIT_HEADER[q.type]}</th>
                    {scales.map((s) => (
                      <th key={s.key} className="tb-contrib-grid__val-col" title={s.label || s.key}>
                        {scaleKeyHeader(s.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.units.map((unit) => (
                    <tr key={`${unit.sourceType}:${unit.sourceKey}`}>
                      <td className="tb-contrib-grid__unit-col">
                        <span className="tb-contrib-grid__unit">
                          <span className="tb-contrib-grid__check">
                            {unit.correct && (
                              <Check width={16} height={16} role="img" aria-label="Верный вариант" />
                            )}
                          </span>
                          <span className="tb-contrib-grid__unit-text">{unit.label}</span>
                        </span>
                      </td>
                      {scales.map((s) => (
                        <td key={s.key} className="tb-contrib-grid__val-col">
                          <MatrixCell
                            value={cellMap.get(cellKey(q.id, unit.sourceType, unit.sourceKey, s.key))}
                            disabled={readOnly}
                            ariaLabel={`Вклад «${unit.label}» в шкалу ${s.key}`}
                            onCommit={(v) => onSetCell(q.id, unit, s.key, v)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hint && q.units.length > 0 && scales.length > 0 && (
            <Banner tone="info" size="sm" description={hint} />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One numeric contribution cell. Holds local text so intermediate states ("-",
 * "0,", "-0") are typable; the author enters fractional values with a comma
 * decimal separator (ru locale — a dot is accepted and shown as a comma) and
 * negatives are preserved. Commits a parsed number (or null to clear) to the
 * model. The external re-sync only fires when the model value differs from what
 * the field already denotes, so a live commit never clobbers an in-progress
 * edit (which previously flipped e.g. "-0" back to "0").
 */
function MatrixCell({
  value,
  disabled,
  ariaLabel,
  onCommit,
}: {
  value: number | undefined;
  disabled: boolean;
  ariaLabel: string;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : formatAuthorNumber(value));

  useEffect(() => {
    const current = text.trim() === "" ? null : parseAuthorNumber(text);
    const target = value === undefined ? null : value;
    if (current !== target) setText(value === undefined ? "" : formatAuthorNumber(value));
    // Only `value` drives the re-sync; `text` is the live buffer we protect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      size="s"
      fullWidth
      value={text}
      disabled={disabled}
      inputMode="decimal"
      aria-label={ariaLabel}
      onChange={(e) => {
        const t = sanitizeAuthorNumberInput(e.target.value);
        setText(t);
        if (t.trim() === "") {
          onCommit(null);
          return;
        }
        const n = parseAuthorNumber(t);
        if (n !== null) onCommit(n);
      }}
    />
  );
}
