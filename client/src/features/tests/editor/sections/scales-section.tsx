/**
 * @module features/tests/editor/sections/scales-section
 * @description «Шкалы» — раздел рейла вкладки «Оценка результата» (PRD-5). Две
 * группы ОДНОЙ колонкой: «Шкалы теста» правит шкалы теста (ключ, метка,
 * агрегация, нормализация/направление, диапазоны толкования, публикация в LMS),
 * «Вклады вопросов» — матрица вкладов. Правки уходят в черновик теста через
 * `updateModel`; единственное «Сохранить» ящика пишет их через оркестратор
 * diff-on-save (use-test-editor / scales-api). «Предпросмотр расчёта» гоняет
 * общий движок шкал по демо-ответам через endpoint предпросмотра.
 *
 * Раскладка — по утверждённому эскизу перестройки редактора
 * `docs/wireframes/editor-settings-target.html` (вкладка «Оценка результата»,
 * пункт рейла «Шкалы»): рейл принадлежит ВКЛАДКЕ, поэтому своего под-рейла у
 * шкал нет — обе группы идут стопкой в одной колонке. Ранний эскиз PRD-5
 * `docs/wireframes/approved/prd2-prd5-scoring-tabs.html` (s-scales /
 * s-scales-empty / s-scale-error / s-preview-calc) остаётся источником по
 * СОДЕРЖИМОМУ карточек, но не по навигации. Составные шкалы (s-scale-advanced,
 * источник — другие шкалы) отложены: движок ещё не считает шкалу от шкал, —
 * поэтому этот вариант источника показан погашенным.
 */

import { type CSSProperties, Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  FormActions,
  FormField,
  FormSection,
  Grid,
  IconButton,
  Input,
  ModalDialog,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Tag,
  Textarea,
} from "@skillum/ui-kit";
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
import { parseAuthorNumber } from "../numeric-input";
import { isEmptyBandRow } from "../test-editor.validation";
import { FoldAllButtons, useSectionFold } from "./section-fold";
import { isSingleIndexChoice, distributesBudget, type QuestionType } from "@shared/questions/question-type";
import { achievableRange } from "@shared/scales/engine";
import type { AllocationSpec } from "@shared/questions/allocation";
import type { LearnerVisibility, Valence } from "@shared/scales/interpretation";
import { LevelsEditor } from "./levels-editor";
import { QuestionTypeIcon } from "./question-type-icon";
import { bandsToDraft, draftErrors } from "./levels-model";

export type ScalesSectionProps = {
  /**
   * Какую из двух панелей показывать. «Шкалы» — не один экран, а два, и выбор между
   * ними делает рейл вкладки (эскиз `docs/wireframes/ds-rail-nested.html`). Значение
   * по умолчанию оставлено ради вызовов, которым разделение не нужно.
   */
  pane?: "list" | "contributions";
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

/**
 * PRD-29. Which end of the scale is favourable — the methodologist's call, and it
 * differs BETWEEN scales of one test (the reference methodology has two scales
 * reading downwards and a third reading upwards). Unrelated to `direction`, which
 * only inverts the value during aggregation.
 */
/** Shared with the «Показатели» tab (result-variables-section): same wording for both. */
export const VALENCE_OPTIONS: Array<{ value: Valence; label: string }> = [
  { value: "higher_is_better", label: "Чем больше, тем лучше" },
  { value: "lower_is_better", label: "Чем больше, тем хуже" },
  { value: "none", label: "Без оценки" },
];

/**
 * PRD-29. The middle position is a working need of psychodiagnostics: the level may
 * be disclosed while the raw score stays hidden — a score invites self-diagnosis and
 * comparison between people.
 *
 * Shared with the «Показатели» tab (result-variables-section): one wording for both
 * tabs, because differing labels would read to the author as differing meaning.
 */
export const VISIBILITY_OPTIONS: Array<{ value: LearnerVisibility; label: string }> = [
  { value: "hidden", label: "Не показывать" },
  { value: "level", label: "Уровень и толкование" },
  { value: "level_and_value", label: "Уровень, толкование и значение" },
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

function emptyScale(sortOrder: number): ScaleModel {
  localKeyCounter += 1;
  return {
    clientKey: `scale-${localKeyCounter}`,
    key: "",
    label: "",
    description: "",
    type: "number",
    aggregation: "sum",
    normalization: "none",
    direction: "positive",
    bands: [],
    domainMin: null,
    domainMax: null,
    displayMax: null,
    valence: "none",
    learnerVisibility: "hidden",
    scormTarget: "none",
    sortOrder,
  };
}

/**
 * The numeric span a set of interpretation bands covers, or null when unusable.
 * Takes just `{ bands }` (not the full `ScaleModel`) so the «Показатели» tab's
 * numeric indicator — which has no other scale fields — can reuse it too.
 *
 * @public
 */
export function bandSpan(s: { bands: ScaleBandModel[] }): { min: number; max: number } | null {
  const mins: number[] = [];
  const maxes: number[] = [];
  for (const b of s.bands) {
    const min = parseAuthorNumber(b.min.trim());
    const max = parseAuthorNumber(b.max.trim());
    if (min === null || max === null) continue;
    mins.push(min);
    maxes.push(max);
  }
  if (mins.length === 0) return null;
  return { min: Math.min(...mins), max: Math.max(...maxes) };
}

/**
 * The domain the scale effectively has right now: the author's explicit bounds when
 * set, else the span of the bands (exactly what `parseScaleInterpretation` derives),
 * else the range computed from the contributions. The final `{0, 0}` only kicks in
 * for a scale with neither bands nor contributions — there is nothing to infer from,
 * and the author edits the seeded fields anyway.
 */
function effectiveDomain(
  s: ScaleModel,
  suggested: { min: number; max: number } | null,
): { min: number; max: number } {
  if (s.domainMin !== null && s.domainMax !== null) return { min: s.domainMin, max: s.domainMax };
  return bandSpan(s) ?? suggested ?? { min: 0, max: 0 };
}

/** Stable per-row key: the server id once persisted, else the client key. */
function rowKey(s: ScaleModel, index: number): string {
  return s.id ?? s.clientKey ?? `row-${index}`;
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

/**
 * Blocking band error for one scale, delegated to the levels model so the card
 * header, the save gate and the editor itself never disagree about what is wrong.
 *
 * Fully-empty rows — leftover «new» rows of the retired bands table — are dropped
 * first, using {@link isEmptyBandRow}, the very predicate the save gate applies.
 * Not a copy of it: the card's banner claims saving is blocked, so a card
 * complaining about a row the gate lets through would simply be lying. The gate
 * ignores such a row at ANY position, so this does too — and the level card still
 * shows «Укажите число» under the field itself, which is where the author can act.
 */
function bandErrorOf(s: ScaleModel): string | null {
  return draftErrors(bandsToDraft(s.bands.filter((b) => !isEmptyBandRow(b)))).blocking;
}

export function ScalesSection({
  pane = "list",
  model,
  testId,
  updateModel,
  readOnly = false,
}: ScalesSectionProps) {
  // Пустая вкладка (s-scales-empty): у теста нет ни одной шкалы — только пустое
  // состояние, без заголовка группы. Обёртка `FormSection` остаётся и здесь НАРОЧНО:
  // подмени её на голую панель — и React пересоздаст `ScalesListPane` на переходе
  // «0 шкал → 1», потеряв раскрытую карточку только что добавленной шкалы.
  const hasScales = model.scales.length > 0;

  // Матрицу вкладов без единой шкалы показывать нечем; рейл в этом случае и не даёт
  // на неё встать, но прямой вызов с `pane="contributions"` возможен — тогда честнее
  // показать список, чем пустую матрицу.
  if (pane === "contributions" && hasScales) {
    return (
      <FormSection title="Вклады вопросов" stacked data-testid="scales-pane-contributions">
        <ContributionsPane model={model} updateModel={updateModel} readOnly={readOnly} />
      </FormSection>
    );
  }

  return (
    <FormSection title={hasScales ? "Шкалы теста" : undefined} stacked data-testid="scales-pane-list">
      <ScalesListPane model={model} testId={testId} updateModel={updateModel} readOnly={readOnly} />
    </FormSection>
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

  /**
   * Свёртка карточек шкалы — та же, что у показателей и у остальных списков ящика.
   * Прежде это был аккордеон на одну открытую карточку: две шкалы рядом было не
   * сравнить, а «развернуть все» такой моделью не выражается. `startCollapsed`
   * сохраняет прежнее начальное состояние — список открывается свёрнутым.
   */
  const fold = useSectionFold(
    scales.map((s, i) => rowKey(s, i)),
    true,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  // PRD-29: `achievableRange` needs the question TYPES — without them a multiple
  // choice is read as a one-index pick and the computed maximum comes out wrong.
  // The editor model carries the contributions but not the types, so they are read
  // from the SAME source the contributions matrix uses.
  const [questionTypes, setQuestionTypes] = useState<Record<string, QuestionType> | null>(null);
  // PRD-44: домен шкалы у вопроса-распределения ограничен БЮДЖЕТОМ, поэтому одних
  // типов мало — без спецификаций домен такого вопроса схлопнулся бы в ноль, и
  // «Рассчитать по вкладам» предложило бы автору заниженную границу.
  const [budgets, setBudgets] = useState<Record<string, AllocationSpec>>({});
  const topicIds = useMemo(() => model.sections.map((s) => s.topicId), [model.sections]);

  useEffect(() => {
    let alive = true;
    loadContributionQuestions(topicIds)
      .then((questions) => {
        if (!alive) return;
        const types: Record<string, QuestionType> = {};
        const specs: Record<string, AllocationSpec> = {};
        for (const q of questions) {
          types[q.id] = q.type;
          if (q.allocation) specs[q.id] = q.allocation;
        }
        setQuestionTypes(types);
        setBudgets(specs);
      })
      .catch(() => {
        // Types unknown → the «Рассчитать по вкладам» button stays disabled rather
        // than seeding a domain computed from a guessed question type.
        if (alive) setQuestionTypes(null);
      });
    return () => {
      alive = false;
    };
  }, [topicIds]);

  /** The domain the contributions of one scale can actually reach, or null. */
  const suggestedDomainOf = useCallback(
    (s: ScaleModel): { min: number; max: number } | null => {
      if (questionTypes === null || s.key.trim() === "") return null;
      return achievableRange(
        model.measurements.filter((m) => m.scaleKey === s.key),
        s.aggregation,
        questionTypes,
        budgets,
      );
    },
    [questionTypes, budgets, model.measurements],
  );

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

  // Новая шкала в наборе свёрнутых не значится, поэтому появляется раскрытой сама.
  const addScale = useCallback(() => {
    setScales([...scales, emptyScale(scales.length)]);
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
      {/* Заголовок группы рисует `FormSection` секции — здесь только её действия. */}
      <FormActions align="between">
        <Button
          variant="ghost"
          size="s"
          disabled={!testId}
          onClick={() => setPreviewOpen(true)}
          data-testid="scales-preview-open"
        >
          Предпросмотр расчёта
        </Button>
        {/* Добавление и свёртка — одна группа у правого края: `ou-formactions__group`
            для того и есть, иначе `--between` растащило бы три кнопки по всей строке. */}
        <span className="ou-formactions__group">
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
          {scales.length > 1 && <FoldAllButtons fold={fold} testIdPrefix="scales" />}
        </span>
      </FormActions>

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
              suggestedDomain={suggestedDomainOf(scale)}
              readOnly={readOnly}
              expanded={fold.isOpen(key)}
              onToggle={() => fold.toggle(key)}
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
  /** PRD-29: the domain computed from the contributions; null when not computable. */
  suggestedDomain: { min: number; max: number } | null;
  readOnly: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ScaleModel>) => void;
  onRemove: () => void;
};

function ScaleCard({
  index,
  scale: s,
  scales,
  coverage,
  suggestedDomain,
  readOnly,
  expanded,
  onToggle,
  onChange,
  onRemove,
}: ScaleCardProps) {
  const keyError = keyErrorOf(s, index, scales);
  const bandError = bandErrorOf(s);
  const hasError = keyError !== null || bandError !== null;

  const heading = `${s.key ? s.key.toUpperCase() : "новая шкала"}${s.label ? ` — ${s.label}` : ""}`;
  const recalc = recalcOf(s);
  // Три члена, как в эскизе: агрегация, пересчёт, охват. Число уровней отсюда убрано —
  // уровни целиком видны в теле карточки, а в свёрнутом виде автор ищет здесь не их.
  const subtitle = [
    AGG_LABEL[s.aggregation],
    RECALC_LABEL[recalc],
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
            suggestedDomain={suggestedDomain}
            onChange={onChange}
          />
        </div>
      )}
    </section>
  );
}

// ─── Scale form ─────────────────────────────────────────────────────────────────

/**
 * The band error is NOT rendered here: {@link bandErrorOf} now returns the very
 * message {@link LevelsEditor} already shows in its own blocking banner, so a
 * second copy would print the same sentence twice under one card.
 */
function ScaleForm({
  scale: s,
  index,
  readOnly,
  keyError,
  suggestedDomain,
  onChange,
}: {
  scale: ScaleModel;
  index: number;
  readOnly: boolean;
  keyError: string | null;
  suggestedDomain: { min: number; max: number } | null;
  onChange: (patch: Partial<ScaleModel>) => void;
}) {
  const setBands = (bands: ScaleBandModel[]) => onChange({ bands });
  // Manual bounds are an explicit opt-in: 0 is a legal bound (every domain of the
  // reference methodology starts at zero), so «not set» can never be a value.
  const manualDomain = s.domainMin !== null && s.domainMax !== null;
  const domainDrift =
    manualDomain &&
    suggestedDomain !== null &&
    (suggestedDomain.min !== s.domainMin || suggestedDomain.max !== s.domainMax);

  return (
    <>
      <Grid cols={2} gap={4}>
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
      </Grid>

      {/* PRD-53 §4.4. Стоит с «Ключом» и «Меткой», а не в механике ниже: это про то,
          ЧТО шкала измеряет. Колонка была в базе и в книге Excel, но поля в редакторе
          не было, и блок «шкалы вне профиля» печатал одни названия. */}
      <div className="ou-formfield">
        <Textarea
          size="m"
          fullWidth
          rows={2}
          label="Описание"
          value={s.description}
          disabled={readOnly}
          hint="Показывается обучающемуся, когда шкала попала в блок «вне профиля» на экране итогов."
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange({ description: e.target.value })}
          data-testid={`scales-description-${index}`}
        />
      </div>

      <Grid cols={2} gap={3}>
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
          {/* Без пояснения под сегментом: «Другие шкалы» уже выключены, а выключенный
              выбор сам говорит, что он недоступен. */}
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

      {/* Подпись ПОЛЯ, а не раздела: уровни — одна настройка шкалы наравне с
          агрегацией, и линейка-разделитель вокруг неё разбивала бы тело карточки на
          части, которых в эскизе нет. Адрес публикации живёт здесь, а не в самом
          редакторе уровней: `LevelsEditor` служит и «Показателям», где пути
          `scale.<ключ>` не существует. */}
      <div className="ou-formfield">
        <label className="ou-formfield__lbl">Уровни шкалы</label>
        <span className="ou-formfield__desc">
          Код уровня публикуется как scale.{"{"}ключ{"}"}.level и доступен формулам показателей.
        </span>
        <LevelsEditor
          bands={s.bands}
          index={index}
          readOnly={readOnly}
          valence={s.valence}
          domain={s.domainMin !== null && s.domainMax !== null
            ? { min: s.domainMin, max: s.domainMax }
            : suggestedDomain}
          onChange={setBands}
        />
      </div>

      <DomainFields
        domainMin={s.domainMin}
        domainMax={s.domainMax}
        readOnly={readOnly}
        testIdPrefix="scales"
        index={index}
        seed={effectiveDomain(s, suggestedDomain)}
        groupLabel="Границы шкалы и показ результата"
        switchLabel="Задать границы шкалы вручную"
        switchDescription="Выключено — границы берутся из охвата уровней. Ноль — законная граница, а не признак «не задано»."
        minLabel="Минимум шкалы"
        maxLabel="Максимум шкалы"
        onChange={onChange}
      />

      <DisplayMaxField
        value={s.displayMax}
        readOnly={readOnly}
        index={index}
        seed={effectiveDomain(s, suggestedDomain).max}
        onChange={onChange}
      />

      {manualDomain && (
        <>
          <Button
            size="s"
            variant="secondary"
            disabled={readOnly || suggestedDomain === null}
            title={
              suggestedDomain === null
                ? "Расчёт доступен, когда у шкалы есть вклады вопросов"
                : undefined
            }
            onClick={() => {
              if (suggestedDomain === null) return;
              onChange({ domainMin: suggestedDomain.min, domainMax: suggestedDomain.max });
            }}
            data-testid={`scales-domain-suggest-${index}`}
          >
            Рассчитать по вкладам
          </Button>
          {domainDrift && suggestedDomain !== null && (
            // No silent recompute: the stored domain is the methodologist's decision,
            // and a contribution edit must not rewrite it behind their back.
            <Banner
              tone="warning"
              size="sm"
              description={
                `Заданные границы (${s.domainMin} … ${s.domainMax}) расходятся с расчётом по вкладам ` +
                `(${suggestedDomain.min} … ${suggestedDomain.max}). Пересчёт не выполняется автоматически.`
              }
              data-testid={`scales-domain-drift-${index}`}
            />
          )}
        </>
      )}

      <div className="ou-formgroup ou-formgroup--two">
        <div className="ou-formfield">
          <Select<Valence>
            size="m"
            fullWidth
            label="Благоприятное направление"
            value={s.valence}
            disabled={readOnly}
            options={VALENCE_OPTIONS}
            onChange={(value) => onChange({ valence: value })}
            data-testid={`scales-valence-${index}`}
          />
        </div>
        <div className="ou-formfield">
          <Select<LearnerVisibility>
            size="m"
            fullWidth
            label="Показывать обучающемуся"
            value={s.learnerVisibility}
            disabled={readOnly}
            options={VISIBILITY_OPTIONS}
            onChange={(value) => onChange({ learnerVisibility: value })}
            data-testid={`scales-visibility-${index}`}
          />
        </div>
      </div>

      {/* PRD-49 §6: the remaining slots of the same card, next to the control that
          already governs the value slot. */}
      <CardSlotToggles
        showName={s.showName}
        showLevel={s.showLevel}
        readOnly={readOnly}
        testIdPrefix="scales"
        index={index}
        onChange={onChange}
      />
    </>
  );
}

// ─── Domain fields ──────────────────────────────────────────────────────────────

/**
 * Manual-bounds toggle + min/max inputs — the domain half of a numeric
 * interpretation. Shared with the «Показатели» tab's NUMERIC indicator
 * (PRD-29+): both a scale and a numeric indicator degrade the same way without
 * an explicit domain (span of the bands), so a second copy would drift the
 * moment either side changed. The scale's OWN extra layer — the «Рассчитать по
 * вкладам» suggestion sourced from question contributions, which an indicator
 * has no equivalent of — stays in {@link ScaleForm}, rendered around this
 * component rather than inside it.
 *
 * Copy is passed in, not hard-coded, so the already-approved scale wording
 * («шкалы») stays byte-identical while the indicator gets its own.
 *
 * @public
 */
export function DomainFields({
  domainMin,
  domainMax,
  readOnly,
  testIdPrefix,
  index,
  seed,
  groupLabel,
  switchLabel,
  switchDescription,
  minLabel,
  maxLabel,
  onChange,
}: {
  domainMin: number | null;
  domainMax: number | null;
  readOnly: boolean;
  testIdPrefix: string;
  index: number;
  /** Bounds to seed the fields with the moment manual entry is switched on. */
  seed: { min: number; max: number };
  /**
   * Caption of the whole block, above the switch. Optional: the «Показатели» card
   * names the block itself, this one is named by the card that owns it.
   */
  groupLabel?: string;
  switchLabel: string;
  switchDescription: string;
  minLabel: string;
  maxLabel: string;
  onChange: (patch: { domainMin?: number | null; domainMax?: number | null }) => void;
}) {
  // Manual bounds are an explicit opt-in: 0 is a legal bound (every domain of the
  // reference methodology starts at zero), so «not set» can never be a value.
  const manualDomain = domainMin !== null && domainMax !== null;
  return (
    <>
      <div className="ou-formfield">
        {groupLabel && <label className="ou-formfield__lbl">{groupLabel}</label>}
        <Switch
          label={switchLabel}
          description={switchDescription}
          checked={manualDomain}
          disabled={readOnly}
          onChange={(e) => {
            if (!e.target.checked) {
              onChange({ domainMin: null, domainMax: null });
              return;
            }
            onChange({ domainMin: seed.min, domainMax: seed.max });
          }}
          data-testid={`${testIdPrefix}-domain-manual-${index}`}
        />
      </div>
      {manualDomain && (
        <div className="ou-formgroup ou-formgroup--two">
          <div className="ou-formfield">
            <NumberInput
              size="m"
              fullWidth
              label={minLabel}
              value={domainMin as number}
              disabled={readOnly}
              onChange={(next) => onChange({ domainMin: next })}
              data-testid={`${testIdPrefix}-domain-min-${index}`}
            />
          </div>
          <div className="ou-formfield">
            <NumberInput
              size="m"
              fullWidth
              label={maxLabel}
              value={domainMax as number}
              disabled={readOnly}
              onChange={(next) => onChange({ domainMax: next })}
              data-testid={`${testIdPrefix}-domain-max-${index}`}
            />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * PRD-49 §6: the two slot switches of the results card, shared by a scale and an
 * indicator — both render the SAME four-slot card (name, value, level, explanation),
 * so a second copy would drift the moment either side changed.
 *
 * The value slot is not here: it is already governed by «Показывать обучающемуся»
 * (`learner_visibility`), which these two stand next to.
 *
 * What is switched off is the DISPLAY of a slot, never its content, and it is switched
 * off on every LEARNER-FACING surface: the results screen, the section results and the
 * PDF report the learner takes away. Clearing the level label instead is what authors
 * used to do, and it does not work: a numeric band drops an empty label during
 * normalisation and the reader prints `label ?? level`, so the learner ends up looking
 * at the level CODE. The label also has to survive for the analytics and the export,
 * which read the data rather than the card.
 *
 * @public
 */
export function CardSlotToggles({
  showName,
  showLevel,
  readOnly,
  testIdPrefix,
  index,
  onChange,
}: {
  /** `undefined` = shown: the flag is stored only when the author switches it off. */
  showName: boolean | undefined;
  showLevel: boolean | undefined;
  readOnly: boolean;
  /** `scales` | `metrics` — the section this card belongs to. */
  testIdPrefix: string;
  index: number;
  onChange: (patch: { showName?: boolean; showLevel?: boolean }) => void;
}) {
  return (
    <FormField
      label="Слоты карточки"
      hint="Выключается показ слота — на экране итогов и в отчёте. Название и метка уровня остаются в данных: их берут аналитика и выгрузка."
      data-testid={`${testIdPrefix}-slots-${index}`}
    >
      <Stack gap={2}>
        <Switch
          label="Показывать название"
          checked={showName !== false}
          disabled={readOnly}
          onChange={(e) => onChange({ showName: e.target.checked })}
          data-testid={`${testIdPrefix}-show-name-${index}`}
        />
        <Switch
          label="Показывать уровень"
          checked={showLevel !== false}
          disabled={readOnly}
          onChange={(e) => onChange({ showLevel: e.target.checked })}
          data-testid={`${testIdPrefix}-show-level-${index}`}
        />
      </Stack>
    </FormField>
  );
}

/**
 * PRD-46 §6: how far a full ray of the radar stretches for THIS scale.
 *
 * Stands next to the domain because it is read against it, and is deliberately NOT part of
 * it: the domain says what the scale measures and drives the ruler and the band boundaries
 * in the card, while this number changes nothing but the size of a drawing.
 *
 * Opt-in through a switch, like the manual domain and for the same reason: absence is a
 * meaningful state («draw to the domain»), and a field pre-filled with the domain would make
 * every scale look deliberately limited.
 *
 * The description says plainly that the value is read only under one setting of the test —
 * otherwise an author sets it, sees no change on the results screen, and has nowhere to look.
 */
function DisplayMaxField(props: {
  value: number | null;
  readOnly: boolean;
  index: number;
  /** Bound the field starts from when switched on — the scale's own upper bound. */
  seed: number;
  onChange: (patch: { displayMax?: number | null }) => void;
}) {
  const { value, readOnly, index, seed, onChange } = props;
  return (
    <>
      <div className="ou-formfield">
        <Switch
          label="Задать предел показа на диаграмме"
          description="Читается, только когда у экрана итогов выбран предел оси «заданный автором»."
          checked={value !== null}
          disabled={readOnly}
          onChange={(e) => onChange({ displayMax: e.target.checked ? seed : null })}
          data-testid={`scales-display-max-manual-${index}`}
        />
      </div>
      {value !== null && (
        <div className="ou-formfield">
          <NumberInput
            size="m"
            fullWidth
            label="Предел показа"
            value={value}
            disabled={readOnly}
            onChange={(next) => onChange({ displayMax: next })}
            data-testid={`scales-display-max-${index}`}
          />
        </div>
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
  allocation: "Утверждение",
  short: "Ответ",
  blanks: "Пропуски",
  long: "Развёрнутый ответ",
  simulation: "Сценарий",
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
        description="Добавьте темы и вопросы во вкладке «Состав и сценарий», затем задайте их вклады в шкалы."
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
          description="Сначала задайте ключ хотя бы одной шкале выше, в группе «Шкалы теста», — тогда здесь появятся столбцы для вкладов."
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
                {/* Один тег — сколько вопросов в теме. О непривязанных говорит баннер
                    над списком и точка на самой карточке: третий счётчик тех же
                    вопросов в шапке свёртки повторял бы их обоих. */}
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
          {/* Тип вопроса — пиктограммой в заголовке, как в списке «Оценки»: словами он
              занимал первую половину подзаголовка, где автор ищет ключи шкал. */}
          <h5 className="ou-card__title tb-level-card__title">
            <QuestionTypeIcon type={q.type} />
            {heading}
          </h5>
          <p className="ou-card__subtitle tb-level-card__summary">
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
          {/* PRD-44 FR-48: шкалы, питаемые ОДНИМ распределением, не независимы — сумма
              их вкладов постоянна и равна бюджету. Прибавка одной означает убыль
              другой, поэтому полосы интерпретации и направление шкалы надо задавать с
              оглядкой на это, а сравнивать имеет смысл профиль внутри одного
              учащегося, а не величины между учащимися. Предупреждение стоит здесь, а
              не в списке шкал: связанность создаёт именно этот вопрос. */}
          {distributesBudget(q.type) && scales.length > 0 && q.units.length > 0 && (
            <Banner
              tone="info"
              variant="subtle"
              title="Шкалы этого вопроса связаны"
              description="Учащийся делит один бюджет, поэтому сумма вкладов постоянна: прибавка одной шкале означает убыль другой. Полосы интерпретации и направление задавайте с учётом этого, а сравнивайте профиль внутри одного учащегося, а не значения между учащимися."
            />
          )}
          {scales.length === 0 ? (
            <p className="tb-card-desc">Добавьте шкалы, чтобы задать вклады.</p>
          ) : q.units.length === 0 ? (
            <p className="tb-card-desc">У вопроса нет единиц ответа для измерения.</p>
          ) : (
            <div className="tb-contrib-grid-wrap">
              <table
                className="tb-table tb-table--mb tb-contrib-grid"
                aria-label="Вклады вариантов ответа в шкалы"
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
  return (
    <NumberInput
      size="s"
      fullWidth
      allowEmpty
      // Пусто — «вопрос в эту шкалу не вносит вклад», и это не то же, что вклад 0:
      // по пустым ячейкам считается предупреждение о непокрытых вопросах.
      value={value ?? null}
      disabled={disabled}
      inputMode="decimal"
      aria-label={ariaLabel}
      decLabel="Меньше"
      incLabel="Больше"
      onChange={(next) => onCommit(next)}
    />
  );
}
