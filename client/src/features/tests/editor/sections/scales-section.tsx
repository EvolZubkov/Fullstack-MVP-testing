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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  Input,
  ModalDialog,
  SegmentedControl,
  Select,
  Switch,
} from "@universityrt/ui-kit";
import { ChevronDown, Plus, Trash2 } from "lucide-react";

import type {
  ScaleAggregation,
  ScaleBandModel,
  ScaleModel,
  ScaleScormTarget,
  TestEditorModel,
} from "../test-editor.types";
import {
  loadScalePreviewContext,
  previewScales,
  type PreviewAnswer,
  type PreviewQuestionContext,
  type ScalePreviewResult,
} from "../scales-api";

export type ScalesSectionProps = {
  model: TestEditorModel;
  /** Test id; `undefined` in create mode — disables the calculation preview. */
  testId?: string;
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  readOnly?: boolean;
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
    const min = Number(minRaw);
    const max = Number(maxRaw);
    if (minRaw === "" || maxRaw === "" || Number.isNaN(min) || Number.isNaN(max)) {
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

  return (
    <div className="ou-drawer__split" data-testid="scales-split">
      <nav className="ou-drawer__rail" aria-label="Подразделы шкал">
        <button
          type="button"
          className={"ou-drawer__rail-item" + (subTab === "list" ? " is-active" : "")}
          aria-current={subTab === "list" ? "page" : undefined}
          onClick={() => setSubTab("list")}
        >
          Список шкал
        </button>
        <button
          type="button"
          className={"ou-drawer__rail-item" + (subTab === "contributions" ? " is-active" : "")}
          aria-current={subTab === "contributions" ? "page" : undefined}
          onClick={() => setSubTab("contributions")}
        >
          Вклады вопросов
        </button>
      </nav>
      <div className="tb-settings-content" data-testid={`scales-pane-${subTab}`}>
        {subTab === "list" ? (
          <ScalesListPane model={model} testId={testId} updateModel={updateModel} readOnly={readOnly} />
        ) : (
          <EmptyState
            layout="inline"
            well
            title="Вклады вопросов — скоро"
            description="Матрица «вариант × шкала» (числовые вклады ответов в шкалы) появится в следующем инкременте. Пока задайте сами шкалы в разделе «Список шкал»."
            data-testid="scales-contributions-placeholder"
          />
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
      setScales(scales.filter((_, i) => i !== index).map((s, i) => ({ ...s, sortOrder: i })));
    },
    [scales, setScales],
  );

  const anyError = useMemo(
    () => scales.some((s, i) => keyErrorOf(s, i, scales) !== null || bandErrorOf(s) !== null),
    [scales],
  );

  if (scales.length === 0) {
    return (
      <EmptyState
        layout="page"
        well
        title="Пока нет шкал"
        description="Шкала измеряет компетенцию или признак: суммирует вклады вопросов, нормализует и даёт уровень. Добавьте первую шкалу теста."
        actions={
          !readOnly ? (
            <Button
              variant="primary"
              size="s"
              leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
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
      <div className="flex items-center justify-between mb-3">
        <div className="tb-section-label">Шкалы теста</div>
        <div className="flex items-center gap-2">
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
              leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={addScale}
              data-testid="scales-add"
            >
              Добавить шкалу
            </Button>
          )}
        </div>
      </div>

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
  readOnly: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ScaleModel>) => void;
  onRemove: () => void;
};

function ScaleCard({ index, scale: s, scales, readOnly, expanded, onToggle, onChange, onRemove }: ScaleCardProps) {
  const keyError = keyErrorOf(s, index, scales);
  const bandError = bandErrorOf(s);
  const hasError = keyError !== null || bandError !== null;

  const heading = `${s.key ? s.key.toUpperCase() : "новая шкала"}${s.label ? ` — ${s.label}` : ""}`;
  const recalc = recalcOf(s);
  const subtitle = [
    AGG_LABEL[s.aggregation],
    RECALC_LABEL[recalc],
    s.bands.length > 0 ? pluralBands(s.bands.length) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const dotClass = hasError ? "tb-status-dot--err" : "tb-status-dot--ok";

  return (
    <section
      className={"ou-card ou-card--outlined ou-card--sm tb-level-card" + (expanded ? "" : " is-collapsed")}
      data-testid={`scales-card-${index}`}
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
      <div className="grid grid-cols-2 gap-3">
        <Input
          size="m"
          fullWidth
          label="Ключ *"
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
      </div>

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

      <hr className="wf-sep" />
      <Switch
        label="Показывать результат обучающемуся"
        checked={s.showToLearner}
        disabled={readOnly}
        onChange={(e) => onChange({ showToLearner: e.target.checked })}
        data-testid={`scales-show-${index}`}
      />
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
      <table className="tb-table tb-table--mb" data-testid={`scales-bands-${index}`}>
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
          leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
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
              {q.type === "single" ? (
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
                <div className="flex flex-col gap-1">
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
                </div>
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
