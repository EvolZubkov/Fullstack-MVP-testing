/**
 * @module features/tests/editor/sections/topics-structure-section
 * @description Editor section for the «Состав» tab (PRD-7 wireframe
 * `prd7-editor-drawer.html` state s-default / s-feedback-edit).
 *
 * Renders the list of topics that make up the test as `tb-topic-row`s with:
 *   - header: topic name + «Обязательная» tag + total questions in the topic
 *   - body: draw-count number input (range 1..maxQuestions) and a feedback
 *     preview block; clicking the preview opens FeedbackEditorModal (FR-36/37)
 *   - per-row remove button (small ghost X) that drops the section from the
 *     draft
 *
 * A «+ Добавить тему» button at the bottom opens a topic picker modal listing
 * topics not yet in the test; clicking one appends a new section with a
 * default `drawCount` of `min(maxQuestions, 5)` and `required: false`.
 *
 * The «Обязательная» switch is rendered in the topic-row header (right side,
 * before the remove button). Its previous location — the «Настройки → Правила
 * прохождения» table column — has been retired; this is the single point of
 * control for `sections[].required`.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { DrawBlueprint, FormSet, Topic } from "@shared/schema";
import { normalizeTag, tagKey, TAG_MAX_LENGTH } from "@shared/tags";
import {
  Banner,
  Button,
  EmptyState,
  IconButton,
  Input,
  ModalDialog,
  NumberInput,
  Select,
  SegmentedControl,
  Switch,
  Tag,
} from "@universityrt/ui-kit";
import { effectiveSectionOrder, type TestQuestionOrder } from "@shared/draw/assemble-delivery";
import { FeedbackEditorModal } from "./feedback-editor-modal";
import { VariantsEditor } from "./variants-editor";
import { FeedbackPreview as SharedFeedbackPreview } from "./feedback-preview";
import type {
  EditorSection,
  TestEditorModel,
} from "../test-editor.types";
import { applyFormSetChange } from "../test-editor.mappers";
import { EMPTY_FIELD_ERRORS, type FieldErrorIndex } from "../field-errors";

// ─── Public API ───────────────────────────────────────────────────────────────

export type CompositionSectionProps = {
  /** Current draft model. */
  model: TestEditorModel;
  /** Editor draft mutator (forwarded from {@link useTestEditor}). */
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
  /** FR-20c: per-field validation errors for inline highlighting. */
  fieldErrors?: FieldErrorIndex;
};

/** Backwards-compatible alias: original skeleton lived under this name. */
export type TopicsStructureSectionProps = CompositionSectionProps;

type TopicWithQuestionCount = Topic & { questionCount: number };

async function fetchTopicsWithCount(): Promise<TopicWithQuestionCount[]> {
  const res = await fetch("/api/topics", { credentials: "include" });
  if (!res.ok) {
    throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  }
  return res.json() as Promise<TopicWithQuestionCount[]>;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * PRD-30 (эскиз approved/prd30-test-level-order.html): подписи значений порядка.
 * Одни и те же во всех режимах прохождения — уточнение «внутри темы» относится к
 * состоянию, а не к значению, поэтому живёт в хвосте строки, а не в списке.
 */
const TEST_ORDER_OPTIONS: { value: TestQuestionOrder; label: string }[] = [
  { value: "fixed", label: "Фиксированный порядок" },
  { value: "random", label: "Перемешивание" },
  { value: "shuffle_all", label: "Полное перемешивание" },
];

/** Хвост строки теста: что именно значение делает в текущем режиме. */
const TEST_ORDER_HINTS: Record<TestQuestionOrder, (flatFlow: boolean) => string> = {
  fixed: () => "темы идут в порядке списка, вопросы — по индексу, заданному в теме",
  random: (flatFlow) =>
    flatFlow
      ? "вопросы перемешиваются внутри темы, темы идут в порядке списка"
      : "вопросы перемешиваются внутри темы",
  shuffle_all: () => "вопросы всех тем идут одним перемешанным потоком",
};

/** Значение «как в тесте» у темы — в модели это `null` (FR-18). */
const INHERIT = "inherit";

const TOPIC_ORDER_OPTIONS = [
  { value: INHERIT, label: "Как в тесте" },
  { value: "fixed", label: "Фиксированный порядок" },
  { value: "random", label: "Перемешивание" },
];

/**
 * Хвост строки темы. При наследовании он обязателен: «Как в тесте» само по себе
 * не говорит, ЧТО именно тема унаследовала.
 */
function questionOrderHint(
  effective: "random" | "fixed",
  inherited: boolean,
  variantsOn: boolean,
  testOrder: TestQuestionOrder,
): string {
  if (effective === "fixed") {
    return variantsOn ? "в порядке списка варианта" : "по индексу, заданному в теме";
  }
  // FR-19: в общем потоке вопросы такой темы уходят к остальным поштучно.
  if (inherited && testOrder === "shuffle_all") return "вопросы темы уходят в общий поток";
  return "вопросы темы перемешиваются при каждой попытке";
}

export function CompositionSection({ model, updateModel, fieldErrors = EMPTY_FIELD_ERRORS }: CompositionSectionProps) {
  const { data: allTopics = [], isSuccess: topicsLoaded } = useQuery<TopicWithQuestionCount[]>({
    queryKey: ["/api/topics"],
    queryFn: fetchTopicsWithCount,
  });
  // PRD-11: real sub-topic tags per topic, for the draw-quota Select (FR-07).
  const { data: allQuestions = [] } = useQuery<QuestionTagRow[]>({
    queryKey: ["/api/questions"],
  });
  const tagsByTopic = useMemo(() => buildTagsByTopic(allQuestions), [allQuestions]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const usedTopicIds = useMemo(
    () => new Set(model.sections.map((s) => s.topicId)),
    [model.sections],
  );
  const availableTopics = useMemo(
    () => allTopics.filter((t) => !usedTopicIds.has(t.id)),
    [allTopics, usedTopicIds],
  );
  // PRD-15 E-11: /api/topics is visibility-scoped, so a section whose topicId is
  // absent here references a topic the author can no longer see.
  const visibleTopicIds = useMemo(() => new Set(allTopics.map((t) => t.id)), [allTopics]);

  const updateSection = (topicId: string, patch: Partial<EditorSection>) => {
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((s) =>
        s.topicId === topicId ? { ...s, ...patch } : s,
      ),
    }));
  };

  const removeSection = (topicId: string) => {
    updateModel((m) => ({
      ...m,
      sections: m.sections.filter((s) => s.topicId !== topicId),
      passRules: {
        ...m.passRules,
        byTopic: Object.fromEntries(
          Object.entries(m.passRules.byTopic).filter(([id]) => id !== topicId),
        ),
      },
    }));
  };

  const addTopic = (topic: TopicWithQuestionCount) => {
    const drawCount = Math.min(topic.questionCount, 5) || 1;
    updateModel((m) => ({
      ...m,
      sections: [
        ...m.sections,
        {
          topicId: topic.id,
          topicName: topic.name,
          maxQuestions: topic.questionCount,
          drawCount,
          drawAll: false,
          required: false,
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
          feedbackEvents: [],
          drawBlueprint: null,
          defaultPoints: null,
        },
      ],
    }));
    setPickerOpen(false);
  };

  // PRD-30 FR-16: absent = «перемешивание», today's behaviour of every test.
  const testOrder: TestQuestionOrder = model.questionOrder ?? "random";
  const flatFlow = model.flowMode === "linear_flat";

  return (
    <>
      {model.mode === "adaptive" && (
        <Banner
          tone="info"
          title="Тест в адаптивном режиме"
          description="Настройки уровней сложности и связки тем — во вкладке «Настройки → Адаптивный режим»."
          data-testid="composition-adaptive-banner"
        />
      )}
      <div className="tb-section-label">Темы и выборка вопросов</div>

      {/* PRD-30 FR-16/FR-17 (эскиз approved/prd30-test-level-order.html): the
          test-wide rule stands ABOVE the topic list — first the common rule,
          then the topics that inherit it. «Полное перемешивание» is offered only
          in the flat flow: the sectional flows carry the section screens on the
          topic boundary, so there is nothing to mix across. */}
      <div className="tb-test-order-row">
        <span className="tb-test-order-row__label">Порядок выдачи вопросов</span>
        <Select
          size="s"
          value={testOrder}
          onChange={(value) => updateModel((m) => ({ ...m, questionOrder: value }))}
          options={flatFlow ? TEST_ORDER_OPTIONS : TEST_ORDER_OPTIONS.slice(0, 2)}
          aria-label="Порядок выдачи вопросов в тесте"
          data-testid="test-question-order"
        />
        <span className="tb-test-order-row__hint">{TEST_ORDER_HINTS[testOrder](flatFlow)}</span>
      </div>

      {model.sections.length === 0 && (
        <EmptyState
          layout="inline"
          well
          title="Пока нет ни одной темы"
          description="Добавьте темы, из которых будут отбираться вопросы. Минимум одна тема обязательна для сохранения теста (FR-12)."
          data-testid="composition-empty"
        />
      )}

      {model.sections.map((section, index) => (
        <TopicRow
          key={section.topicId}
          index={index}
          section={section}
          unavailable={topicsLoaded && !visibleTopicIds.has(section.topicId)}
          adaptive={model.mode === "adaptive"}
          drawCountError={fieldErrors.get(`sections[${index}].drawCount`)}
          blueprintError={fieldErrors.get(`sections[${index}].drawBlueprintJson`)}
          variantsError={fieldErrors.get(`sections[${index}].formSetJson`)}
          topicTags={tagsByTopic.get(section.topicId)?.tags ?? []}
          availByKey={tagsByTopic.get(section.topicId)?.availByKey ?? {}}
          onChangeDrawCount={(n) => updateSection(section.topicId, { drawCount: n })}
          onToggleDrawAll={(drawAll) =>
            updateSection(section.topicId, {
              drawAll,
              // Turning "all" on snapshots the current max into drawCount so the
              // (disabled) number field reads sensibly and the persisted value is
              // valid; the real "all" is resolved dynamically at export time.
              ...(drawAll ? { drawCount: Math.max(section.maxQuestions, 1) } : {}),
            })
          }
          onChangeQuestionOrder={(order) => updateSection(section.topicId, { questionOrder: order })}
          testOrder={testOrder}
          onToggleRequired={(required) =>
            updateSection(section.topicId, { required })
          }
          onChangeBlueprint={(bp) => updateSection(section.topicId, { drawBlueprint: bp })}
          // PRD-24: changing the variant set also re-syncs the topic's per-variant
          // pass rule (seed added / drop removed / normalise when mode goes off).
          onChangeFormSet={(formSet) =>
            updateModel((m) => applyFormSetChange(m, section.topicId, formSet))
          }
          onRemove={() => removeSection(section.topicId)}
          onSaveFeedback={(patch) => updateSection(section.topicId, patch)}
        />
      ))}

      <Button
        variant="secondary"
        size="m"
        fullWidth
        leadingIcon={<Plus size={16} aria-hidden="true" />}
        onClick={() => setPickerOpen(true)}
        data-testid="composition-add-topic"
        data-field="sections"
      >
        Добавить тему
      </Button>

      <TopicPickerModal
        open={pickerOpen}
        topics={availableTopics}
        onPick={addTopic}
        onCancel={() => setPickerOpen(false)}
      />
    </>
  );
}

/** Backwards-compatible re-export under the old skeleton name. */
export const TopicsStructureSection = CompositionSection;

// ─── Sub-components ───────────────────────────────────────────────────────────

function TopicRow(props: {
  /** Position in `model.sections`; feeds the `sections[i]` FR-20c anchor. */
  index: number;
  section: EditorSection;
  /** Test runs in adaptive mode — forces "draw all" on + locks the controls. */
  adaptive: boolean;
  /** FR-20c: validation message for this section's draw count (red state). */
  drawCountError?: string;
  /** FR-20c: validation message for this section's draw blueprint quotas. */
  blueprintError?: string;
  /** Distinct sub-topic tags of this topic's questions (PRD-11 quota Select). */
  topicTags: string[];
  /** How many questions carry each tag key (shortfall indicator). */
  availByKey: Record<string, number>;
  onChangeDrawCount: (n: number) => void;
  /** Toggle the manual "draw the whole topic" flag. */
  onToggleDrawAll: (drawAll: boolean) => void;
  /** PRD-30 FR-18: set the topic's override (`null` = «как в тесте»). */
  onChangeQuestionOrder: (order: "random" | "fixed" | null) => void;
  /** PRD-30 FR-16: the test-wide order this topic inherits when it has none. */
  testOrder: TestQuestionOrder;
  onToggleRequired: (required: boolean) => void;
  /** Replace this section's draw blueprint (`null` = uniform draw). */
  onChangeBlueprint: (bp: DrawBlueprint | null) => void;
  /** PRD-17 (BR-12): replace this section's variant set (`null` = variants off). */
  onChangeFormSet: (formSet: FormSet | null) => void;
  /** FR-20c: validation message for this section's variants. */
  variantsError?: string;
  onRemove: () => void;
  /** Called with a partial EditorSection patch when feedback is saved. */
  onSaveFeedback: (patch: Partial<EditorSection>) => void;
  /** PRD-15 E-11: the author can no longer see this section's topic (grant
   * revoked / made private). The test still works and saves; only new draws
   * from this topic are blocked. */
  unavailable?: boolean;
}) {
  const { section } = props;
  const maxQ = Math.max(section.maxQuestions, 1);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Adaptive mode forces "draw all" on every topic (the per-level questionsCount
  // governs how many are shown); the stored manual `drawAll` is preserved so
  // leaving adaptive restores it. The switch + count field lock while adaptive.
  const effectiveDrawAll = props.adaptive || section.drawAll;
  // PRD-17: variants mode is for standard delivery only; in adaptive the section
  // draws by difficulty levels, so the variant set is ignored and not edited.
  const variantsOn = !props.adaptive && section.formSet != null;

  // Author request (UX): never HIDE the mutually-exclusive controls — show them
  // DISABLED instead, so the card never appears to silently "lose" settings.
  // Variants mode overrides the whole-topic draw; "draw all" overrides the
  // partial-draw quotas. `partialDrawLocked` covers both the count field and the
  // quota editor (a partial draw is the only thing they apply to).
  const drawAllDisabled = props.adaptive || variantsOn;
  const partialDrawLocked = effectiveDrawAll || variantsOn;
  const quotaReason = variantsOn
    ? "Недоступно: активен режим «Варианты теста» — вопросы берутся из выпавшего варианта целиком."
    : effectiveDrawAll
      ? "Недоступно: выдаётся вся тема. Квоты применяются только к частичной выборке."
      : undefined;
  // The draw-count error only applies to an editable partial whole-topic draw.
  const drawCountError = !partialDrawLocked ? props.drawCountError : undefined;
  // PRD-30 FR-18: the topic's value is an OVERRIDE; null = «как в тесте», and
  // the order it then delivers in comes from the test.
  const effectiveOrder = effectiveSectionOrder(props.testOrder, section.questionOrder);

  return (
    <>
      <div className="tb-topic-row" data-testid={`topic-row-${section.topicId}`}>
        <div className="tb-topic-row__header">
          <span className="tb-topic-row__name">{section.topicName}</span>
          {props.unavailable && (
            <Tag tone="warning" size="s" data-testid={`topic-unavailable-${section.topicId}`}>
              Тема недоступна
            </Tag>
          )}
          <span className="tb-topic-row__count">
            {section.maxQuestions} вопрос{plural(section.maxQuestions)}
          </span>
          <label className="tb-topic-row__required">
            <Switch
              checked={section.required}
              onChange={(e) => props.onToggleRequired(e.target.checked)}
              aria-label={`Тема обязательная: ${section.topicName}`}
              data-testid={`topic-required-${section.topicId}`}
            />
            <span className="tb-topic-row__required-lbl">Обязательная</span>
          </label>
          <IconButton
            icon={<X size={14} aria-hidden="true" />}
            aria-label={`Убрать тему «${section.topicName}»`}
            variant="ghost"
            size="s"
            onClick={props.onRemove}
            data-testid={`topic-remove-${section.topicId}`}
          />
        </div>
        <div className="tb-topic-row__body">
          {/* PRD-17: variants mode overrides the whole-topic draw (the source
              becomes the drawn variant, delivered whole), and "draw all" overrides
              the partial-draw quotas. Per author request these controls are kept
              VISIBLE but DISABLED in those cases instead of being hidden, so the
              card never looks like it silently dropped settings. */}
          <label className="tb-draw-all-row">
            <Switch
              checked={effectiveDrawAll}
              disabled={drawAllDisabled}
              onChange={(e) => props.onToggleDrawAll(e.target.checked)}
              aria-label={`Все вопросы темы: ${section.topicName}`}
              data-testid={`topic-drawall-${section.topicId}`}
            />
            <span className="tb-draw-all-row__lbl">Все вопросы темы</span>
            {props.adaptive ? (
              <span className="tb-draw-all-row__hint">включено адаптивным режимом</span>
            ) : variantsOn ? (
              <span className="tb-draw-all-row__hint">отключено в режиме вариантов</span>
            ) : null}
          </label>
          <div
            className="tb-draw-count-row"
            data-field={`sections[${props.index}].drawCount`}
            data-invalid={drawCountError ? "true" : undefined}
          >
            <span className="tb-draw-count-row__label">Вопросов в тест</span>
            <NumberInput
              size="s"
              value={effectiveDrawAll ? maxQ : section.drawCount}
              min={1}
              max={maxQ}
              disabled={partialDrawLocked}
              invalid={Boolean(drawCountError)}
              aria-label={`Количество вопросов из темы ${section.topicName}`}
              data-testid={`topic-drawcount-${section.topicId}`}
              onChange={(next) => props.onChangeDrawCount(next)}
            />
            <span className="tb-draw-count-row__max">из {section.maxQuestions}</span>
          </div>
          {drawCountError && (
            <p className="tb-field-error" role="alert" data-testid={`topic-drawcount-error-${section.topicId}`}>
              {drawCountError}
            </p>
          )}

          {/* PRD-30 FR-02/FR-18 (эскиз approved/prd30-test-level-order.html): the
              delivery-order control sits right under «Вопросов в тест», so the
              three delivery parameters read as one row — how many, in what
              order, in what slices. Three positions, so a Select, not a switch:
              a topic may also say «как в тесте», which is its default. */}
          <div className="tb-question-order-row">
            <span className="tb-question-order-row__lbl">Порядок вопросов</span>
            <Select
              size="s"
              value={section.questionOrder ?? INHERIT}
              onChange={(value) =>
                props.onChangeQuestionOrder(value === INHERIT ? null : (value as "random" | "fixed"))
              }
              options={TOPIC_ORDER_OPTIONS}
              aria-label={`Порядок вопросов: ${section.topicName}`}
              data-testid={`topic-question-order-${section.topicId}`}
            />
            {/* FR-18: shown ONLY on an override — its presence is also what marks
                the topic as overriding, so the row needs no «изменено» badge.
                Same control as «Оформление» uses to drop a colour override. */}
            {section.questionOrder != null && (
              <IconButton
                icon={<RotateCcw width={14} height={14} aria-hidden="true" />}
                aria-label={`Вернуть порядок как в тесте: ${section.topicName}`}
                title="Как в тесте"
                variant="ghost"
                size="s"
                onClick={() => props.onChangeQuestionOrder(null)}
                data-testid={`topic-question-order-reset-${section.topicId}`}
              />
            )}
            <span className="tb-question-order-row__hint">
              {questionOrderHint(effectiveOrder, section.questionOrder == null, variantsOn, props.testOrder)}
            </span>
          </div>

          <QuotaEditor
            topicId={section.topicId}
            topicName={section.topicName}
            drawCount={section.drawCount}
            blueprint={section.drawBlueprint ?? null}
            topicTags={props.topicTags}
            availByKey={props.availByKey}
            onChange={props.onChangeBlueprint}
            disabled={partialDrawLocked}
            disabledReason={quotaReason}
          />

          {/* PRD-17 (BR-12): fixed variants. In adaptive mode the section draws by
              difficulty levels, so the editor is shown DISABLED (not hidden). */}
          <VariantsEditor
            topicId={section.topicId}
            topicName={section.topicName}
            formSet={section.formSet ?? null}
            onChange={props.onChangeFormSet}
            error={props.variantsError}
            disabled={props.adaptive}
          />

          <div className="tb-card-desc">Обратная связь по теме</div>
          {/* Clicking the preview opens FeedbackEditorModal (FR-36 / FR-37). */}
          <FeedbackPreview
            section={section}
            onEdit={() => setFeedbackOpen(true)}
          />
        </div>
      </div>
      <FeedbackEditorModal
        open={feedbackOpen}
        title={`Обратная связь по теме «${section.topicName}»`}
        description="Показывается учащемуся после прохождения темы"
        value={{
          format: section.feedback.format,
          text: section.feedback.text,
          links: section.feedbackLinks,
          assets: section.feedbackAssets,
          events: section.feedbackEvents,
        }}
        onCancel={() => setFeedbackOpen(false)}
        onSave={(v) => {
          props.onSaveFeedback({
            feedback: { format: v.format, text: v.text },
            feedbackLinks: v.links,
            feedbackAssets: v.assets,
            feedbackEvents: v.events ?? [],
          });
          setFeedbackOpen(false);
        }}
        testId={`feedback-editor-topic-${section.topicId}`}
      />
    </>
  );
}

/**
 * PRD-11 draw-quota editor inside a topic row. A switch enables an inline per-tag
 * quota table (no modal — the config is small). The tag Select offers the topic's
 * REAL question tags (FR-07); `count` is a NumberInput capped at `drawCount`; the
 * per-tag mode is a SegmentedControl (Ровно=exact / Не менее=min). Σ quota counts
 * must not exceed `drawCount` (FR-05 → error, blocks save); a per-tag shortfall
 * (available < count) is a non-blocking warning (FR-06). Absence of a blueprint =
 * uniform draw (FR-02). Mirrors docs/wireframes/prd11-draw-quotas.html (approved).
 */
function QuotaEditor(props: {
  topicId: string;
  topicName: string;
  drawCount: number;
  blueprint: DrawBlueprint | null;
  topicTags: string[];
  availByKey: Record<string, number>;
  onChange: (bp: DrawBlueprint | null) => void;
  /** Force the whole editor disabled (drawing the whole topic / variants mode). */
  disabled?: boolean;
  /** Why the editor is force-disabled — shown in place of the off-state hint. */
  disabledReason?: string;
}) {
  const { topicId, topicName, drawCount, blueprint, topicTags, availByKey, onChange } = props;
  const forcedDisabled = props.disabled ?? false;
  const enabled = blueprint != null;
  const noTags = topicTags.length === 0;
  // When force-disabled the toggle stays visible (greyed) but the editing table
  // collapses — its config is preserved in the draft, just not applied here.
  const expanded = enabled && !forcedDisabled;
  const strata = blueprint?.strata ?? [];

  const usedKeys = new Set(strata.map((s) => tagKey(s.tag)));
  const unusedTags = topicTags.filter((t) => !usedKeys.has(tagKey(t)));
  const availOf = (tag: string) => availByKey[tagKey(tag)] ?? 0;
  const sum = strata.reduce((acc, s) => acc + (s.count || 0), 0);
  const remainder = Math.max(0, drawCount - sum);
  const overflow = sum > drawCount;
  const anyShortfall = strata.some((s) => s.count > availOf(s.tag));
  // Mirror the server drawStratumSchema: a tag must be 1–TAG_MAX_LENGTH chars after
  // normalization. An empty/blank tag (e.g. a stale blueprint whose tag was cleared)
  // would be rejected with an HTTP 400 on save — flag it here so it can't slip through.
  const badTag = (tag: string) => {
    const t = normalizeTag(tag ?? "");
    return t.length < 1 || t.length > TAG_MAX_LENGTH;
  };
  const anyBadTag = strata.some((s) => badTag(s.tag));

  const setStrata = (next: DrawBlueprint["strata"]) => onChange({ strata: next });
  const toggle = (on: boolean) => {
    if (!on) return onChange(null);
    if (noTags) return;
    onChange({ strata: [{ tag: topicTags[0], count: 1, mode: "exact" }] });
  };
  const addStratum = () => {
    if (unusedTags.length === 0) return;
    setStrata([...strata, { tag: unusedTags[0], count: 1, mode: "exact" }]);
  };
  const updateStratum = (i: number, patch: Partial<DrawBlueprint["strata"][number]>) =>
    setStrata(strata.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeStratum = (i: number) => setStrata(strata.filter((_, idx) => idx !== i));

  return (
    <>
      <label className="tb-quota-toggle">
        <Switch
          checked={enabled}
          disabled={noTags || forcedDisabled}
          onChange={(e) => toggle(e.target.checked)}
          aria-label={`Квоты по подтемам: ${topicName}`}
          data-testid={`topic-quota-toggle-${topicId}`}
        />
        <span className="tb-section-label">
          <Layers size={14} aria-hidden="true" />
          Квоты по подтемам (тегам)
        </span>
      </label>

      {forcedDisabled ? (
        <div className="tb-card-desc" data-testid={`topic-quota-locked-${topicId}`}>
          {props.disabledReason}
        </div>
      ) : noTags ? (
        <div className="tb-card-desc" data-testid={`topic-quota-notags-${topicId}`}>
          У вопросов темы нет тегов — добавьте теги в разделе «Вопросы», чтобы задавать квоты по подтемам.
        </div>
      ) : !enabled ? (
        <div className="tb-card-desc">
          Выключено — выдача равномерная (случайные вопросы из всей темы). Включите, чтобы гарантировать покрытие подтем.
        </div>
      ) : null}

      {expanded && (
        <div className="tb-quota-block" data-testid={`topic-quota-block-${topicId}`}>
          {anyBadTag && (
            <Banner
              tone="error"
              variant="subtle"
              role="alert"
              description={`Не выбран тег для квоты (тег обязателен, 1–${TAG_MAX_LENGTH} символов). Сохранение заблокировано до исправления.`}
              data-testid={`topic-quota-tag-error-${topicId}`}
            />
          )}
          {overflow && (
            <Banner
              tone="error"
              variant="subtle"
              role="alert"
              description={`Сумма квот (${sum}) превышает «Вопросов в тест» (${drawCount}). Квоты — это срезы внутри выборки. Сохранение заблокировано до исправления.`}
              data-testid={`topic-quota-error-${topicId}`}
            />
          )}
          {!overflow && !anyBadTag && anyShortfall && (
            <Banner
              tone="warning"
              variant="subtle"
              role="status"
              description="Для некоторых подтем вопросов меньше квоты — выдастся сколько есть, это не блокирует сохранение."
              data-testid={`topic-quota-warning-${topicId}`}
            />
          )}

          <table className="tb-table">
            <thead>
              <tr>
                <th>Подтема (тег вопроса)</th>
                <th>Сколько</th>
                <th>Режим</th>
                {anyShortfall && <th>Доступно</th>}
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {strata.map((s, i) => {
                const avail = availOf(s.tag);
                const short = s.count > avail;
                const options = topicTags
                  .filter((t) => tagKey(t) === tagKey(s.tag) || !usedKeys.has(tagKey(t)))
                  .map((t) => ({ value: t, label: t }));
                return (
                  <tr key={`${tagKey(s.tag)}-${i}`}>
                    <td>
                      <Select
                        size="m"
                        fullWidth
                        value={s.tag}
                        options={options}
                        tone={badTag(s.tag) ? "error" : undefined}
                        onChange={(v) => updateStratum(i, { tag: v })}
                        aria-label={`Подтема для квоты ${i + 1}`}
                        data-testid={`quota-tag-${topicId}-${i}`}
                      />
                    </td>
                    <td>
                      <NumberInput
                        size="s"
                        value={s.count}
                        min={1}
                        max={drawCount}
                        invalid={overflow}
                        onChange={(n) => updateStratum(i, { count: n })}
                        aria-label={`Сколько вопросов для подтемы «${s.tag}»`}
                        data-testid={`quota-count-${topicId}-${i}`}
                      />
                    </td>
                    <td>
                      <SegmentedControl<"exact" | "min">
                        size="s"
                        value={s.mode ?? "exact"}
                        items={[
                          { value: "exact", label: "Ровно" },
                          { value: "min", label: "Не менее" },
                        ]}
                        onChange={(v) => updateStratum(i, { mode: v })}
                        aria-label={`Режим квоты для подтемы «${s.tag}»`}
                      />
                    </td>
                    {anyShortfall && (
                      <td>
                        {short ? (
                          <Tag tone="warning" size="s">{avail}</Tag>
                        ) : (
                          <span className="tb-quota-block__avail">{avail}</span>
                        )}
                      </td>
                    )}
                    <td>
                      <IconButton
                        icon={<Trash2 size={14} aria-hidden="true" />}
                        variant="ghost"
                        size="s"
                        aria-label={`Удалить квоту «${s.tag}»`}
                        onClick={() => removeStratum(i)}
                        data-testid={`quota-remove-${topicId}-${i}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="tb-quota-actions">
            <Button
              variant="ghost"
              size="s"
              leadingIcon={<Plus size={16} aria-hidden="true" />}
              disabled={unusedTags.length === 0}
              onClick={addStratum}
              data-testid={`quota-add-${topicId}`}
            >
              Добавить квоту
            </Button>
          </div>

          <div className={`tb-quota-sum${overflow ? " is-error" : ""}`}>
            <span>
              {overflow
                ? `Σ квот: ${sum} из ${drawCount} — превышение на ${sum - drawCount}`
                : `Σ квот: ${sum} из ${drawCount} · остаток ${remainder}`}
            </span>
            {overflow ? (
              <Tag tone="error" size="s">ошибка</Tag>
            ) : anyShortfall ? (
              <Tag tone="warning" size="s">нехватка по тегу</Tag>
            ) : (
              <Tag tone="success" size="s">в пределах выборки</Tag>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Read-only preview of topic feedback content. When `onEdit` is provided,
 * renders as a clickable `div[role="button"]` (not `<button>`) so that rich
 * HTML content from the RTE — which includes block elements like `<p>` — is
 * valid inside the container. A `<button>` cannot contain block-level children.
 */
function FeedbackPreview({
  section,
  onEdit,
}: {
  section: EditorSection;
  onEdit?: () => void;
}) {
  // TD-02: delegate to the shared grouped-list preview (Документы / Курсы /
  // Мероприятия) with a pencil edit trigger.
  return (
    <SharedFeedbackPreview
      format={section.feedback.format}
      text={section.feedback.text}
      links={section.feedbackLinks}
      assets={section.feedbackAssets}
      events={section.feedbackEvents}
      onEdit={onEdit}
      editAriaLabel="Редактировать обратную связь по теме"
      emptyLabel={
        onEdit
          ? "Не задано — нажмите для редактирования"
          : "Не задано — обратная связь по теме пока не настроена"
      }
      testId={`feedback-preview-${section.topicId}`}
    />
  );
}

function TopicPickerModal(props: {
  open: boolean;
  topics: TopicWithQuestionCount[];
  onPick: (topic: TopicWithQuestionCount) => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = props.topics.filter((t) =>
    t.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <ModalDialog
      open={props.open}
      onClose={props.onCancel}
      size="m"
      title="Добавить тему"
      description="Выберите тему, вопросы из которой попадут в тест."
      footer={
        <Button
          variant="ghost"
          size="s"
          onClick={props.onCancel}
          data-testid="topic-picker-cancel"
        >
          Отмена
        </Button>
      }
      data-testid="topic-picker-modal"
    >
      <Input
        size="m"
        fullWidth
        placeholder="Поиск по названию..."
        aria-label="Поиск темы"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
        className="tb-topic-picker__search"
        data-testid="topic-picker-search"
      />
      <ul className="tb-topic-picker__list">
        {filtered.length === 0 && (
          <li className="tb-topic-picker__empty">
            {props.topics.length === 0
              ? "Все темы уже добавлены в тест"
              : "Ничего не найдено"}
          </li>
        )}
        {filtered.map((topic) => (
          <li key={topic.id}>
            <button
              type="button"
              className="tb-topic-picker__item"
              onClick={() => props.onPick(topic)}
              data-testid={`topic-picker-item-${topic.id}`}
            >
              <span>{topic.name}</span>
              <span className="tb-topic-picker__item-count">
                {topic.questionCount} вопрос{plural(topic.questionCount)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ModalDialog>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal shape of `/api/questions` rows the quota editor needs. */
type QuestionTagRow = { topicId: string; tags?: string[] };

/** Per-topic tag index: distinct display tags + how many questions carry each key. */
type TopicTagInfo = { tags: string[]; availByKey: Record<string, number> };

/**
 * Build a `topicId -> {tags, availByKey}` index from the question bank. `tags`
 * holds the distinct display forms (deduped case-insensitively) sorted for a
 * stable Select order; `availByKey` counts how many questions carry each tag key
 * (a question with several tags counts once per distinct key) — the per-tag
 * availability used for the shortfall indicator (FR-06).
 */
function buildTagsByTopic(questions: QuestionTagRow[]): Map<string, TopicTagInfo> {
  const map = new Map<string, TopicTagInfo>();
  for (const q of questions) {
    if (!q || typeof q.topicId !== "string") continue;
    let info = map.get(q.topicId);
    if (!info) {
      info = { tags: [], availByKey: {} };
      map.set(q.topicId, info);
    }
    const seen = new Set<string>();
    for (const raw of Array.isArray(q.tags) ? q.tags : []) {
      const key = tagKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      info.availByKey[key] = (info.availByKey[key] ?? 0) + 1;
      if (!info.tags.some((x) => tagKey(x) === key)) info.tags.push(raw);
    }
  }
  for (const info of map.values()) info.tags.sort((a, b) => a.localeCompare(b, "ru"));
  return map;
}

function plural(
  n: number,
  one: string = "",
  few: string = "а",
  many: string = "ов",
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
