/**
 * @module features/tests/editor/sections/basic-settings-section
 * @description Editor section for the «Настройки» tab (PRD-7 wireframe
 * `prd7-editor-settings-tab.html` — state `basic` / `limits` / `integration`).
 *
 * Layout: split rail (5 sub-sections) + content pane. Currently implemented
 * sub-sections:
 *
 *   - «Основное»          — title (required), description, mode toggle
 *                            (standard / adaptive), flowMode select
 *   - «Ограничения»       — timeLimitMinutes, maxAttempts, showCorrectAnswers
 *   - «Интеграция»        — webhookUrl, telemetryEnabled
 *   - «Правила прохождения» — passDecisionPolicy + per-topic pass rules
 *   - «Адаптивный режим»   — adaptive levels editor (hidden when mode !== "adaptive")
 *
 * Each editable field is bound to the editor draft via `updateModel`. The
 * Drawer is responsible for save / validation / dirty tracking — this
 * section just renders inputs and reports changes.
 */
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Trash2 } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  NumberInput,
  RadioGroup,
  SegmentedControl,
  Select,
  Switch,
  Textarea,
} from "@universityrt/ui-kit";
import type { EligibilityPluginRef, Form, RetakePolicy } from "@shared/schema";
import { resolveEffectiveScoring } from "@shared/scoring/effective-scoring";
// PRD-31: the clamp is shared with the mapper so the field and a value read back
// from the server can never disagree about the valid range.
import { clampIntervalHours } from "../test-editor.mappers";
import {
  FeedbackEditorModal,
  type FeedbackEditorValue,
} from "./feedback-editor-modal";
import { FeedbackPreview } from "./feedback-preview";
import { ReportSettingsCard } from "./report-settings-card";
import type {
  AdaptiveLevelConfig,
  AdaptiveLinkConfig,
  AdaptiveTopicConfig,
  EditorSection,
  FeedbackAsset,
  FeedbackContent,
  FeedbackEvent,
  FeedbackLink,
  FlowMode,
  OverallPassRule,
  OverallPassType,
  PassDecisionPolicy,
  TestEditorModel,
  TopicPassRule,
} from "../test-editor.types";
import { EMPTY_FIELD_ERRORS, type FieldErrorIndex } from "../field-errors";

// ─── Public API ───────────────────────────────────────────────────────────────

export type SettingsSectionProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
  /** FR-20c: per-field validation errors for inline highlighting. */
  fieldErrors?: FieldErrorIndex;
  /** PRD-27: черновой шаблон вкладки «Оформление» — каталог видов отчёта считается на нём (§4.2). */
  draftTemplateId?: string;
  /** PRD-27: черновой брендинг вкладки «Оформление» — им красится предпросмотр отчёта. */
  draftDesignParams?: Record<string, unknown>;
};

/** Backwards-compatible alias: original skeleton lived under this name. */
export type BasicSettingsSectionProps = SettingsSectionProps;

type RailKey =
  | "basic"
  | "pass-rules"
  | "limits"
  | "retake"
  | "integration"
  | "adaptive";

const RAIL_ITEMS: { key: RailKey; label: string }[] = [
  { key: "basic", label: "Основное" },
  { key: "pass-rules", label: "Правила прохождения" },
  { key: "limits", label: "Ограничения" },
  { key: "retake", label: "Повторное прохождение" },
  { key: "integration", label: "Интеграция" },
  { key: "adaptive", label: "Адаптивный режим" },
];

// ─── Component ────────────────────────────────────────────────────────────────

/** FR-20c: which validated field paths live under each settings sub-pane. */
const RAIL_ERROR_PREFIXES: Record<RailKey, string[]> = {
  basic: ["basic.title", "flowMode"],
  "pass-rules": ["passRules"],
  limits: [],
  retake: [],
  integration: ["basic.webhookUrl"],
  adaptive: ["adaptive"],
};

export function SettingsSection({
  model,
  updateModel,
  fieldErrors = EMPTY_FIELD_ERRORS,
  draftTemplateId,
  draftDesignParams,
}: SettingsSectionProps) {
  const [active, setActive] = useState<RailKey>("basic");
  // Per requirements: «Адаптивный режим» sub-section is only relevant when
  // the test itself runs in adaptive mode. Hide the rail item in standard
  // mode; if it was active, fall back to the previous tab.
  const isAdaptive = model.mode === "adaptive";
  const visibleRailItems = isAdaptive
    ? RAIL_ITEMS
    : RAIL_ITEMS.filter((it) => it.key !== "adaptive");
  const effectiveActive: RailKey =
    active === "adaptive" && !isAdaptive ? "basic" : active;

  // Error dot: no topic is enabled (stop-factor for adaptive mode).
  const hasAdaptiveError =
    isAdaptive &&
    model.sections.length > 0 &&
    !model.adaptive.topics.some((t) => t.enabled);
  // Warning dot: at least one enabled topic has fewer than 2 levels.
  const hasAdaptiveWarning =
    isAdaptive &&
    !hasAdaptiveError &&
    model.sections.some((section) => {
      const topic = model.adaptive.topics.find((t) => t.topicId === section.topicId);
      return topic?.enabled && topic.levels.length < 2;
    });

  return (
    <div className="ou-drawer__split" data-testid="settings-split">
      <nav className="ou-drawer__rail" aria-label="Подразделы настроек">
        {visibleRailItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={
              "ou-drawer__rail-item" +
              (effectiveActive === item.key ? " is-active" : "")
            }
            aria-current={effectiveActive === item.key ? "page" : undefined}
            onClick={() => setActive(item.key)}
            data-testid={`settings-rail-${item.key}`}
          >
            {item.label}
            {/* FR-20c: error dot when any validated field in this pane is invalid.
                Adaptive keeps its dedicated stop-factor check below. */}
            {item.key !== "adaptive" &&
              RAIL_ERROR_PREFIXES[item.key].some((p) => fieldErrors.has(p)) && (
                <span
                  className="tb-status-dot tb-status-dot--err"
                  aria-label="Ошибка"
                />
              )}
            {item.key === "adaptive" && (hasAdaptiveError || fieldErrors.has("adaptive")) && (
              <span
                className="tb-status-dot tb-status-dot--err"
                aria-label="Ошибка"
              />
            )}
            {item.key === "adaptive" && hasAdaptiveWarning && !fieldErrors.has("adaptive") && (
              <span
                className="tb-status-dot tb-status-dot--warn"
                aria-label="Требует внимания"
              />
            )}
          </button>
        ))}
      </nav>
      <div
        className="tb-settings-content"
        data-testid={`settings-pane-${effectiveActive}`}
      >
        {effectiveActive === "basic" && (
          <BasicPane
            model={model}
            updateModel={updateModel}
            fieldErrors={fieldErrors}
            draftTemplateId={draftTemplateId}
            draftDesignParams={draftDesignParams}
          />
        )}
        {effectiveActive === "pass-rules" && (
          <PassRulesPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
        )}
        {effectiveActive === "limits" && (
          <LimitsPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
        )}
        {effectiveActive === "retake" && (
          <RetakePane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
        )}
        {effectiveActive === "integration" && (
          <IntegrationPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
        )}
        {effectiveActive === "adaptive" && isAdaptive && (
          <AdaptivePane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
        )}
      </div>
    </div>
  );
}

/** Backwards-compatible re-export under the old skeleton name. */
export const BasicSettingsSection = SettingsSection;

// ─── Sub-pane: Основное ───────────────────────────────────────────────────────

function BasicPane({
  model,
  updateModel,
  fieldErrors = EMPTY_FIELD_ERRORS,
  draftTemplateId,
  draftDesignParams,
}: SettingsSectionProps) {
  // PRD-7 S13.2-G7: «Общая обратная связь теста» card. The model already
  // carries the underlying fields (basic.feedback / feedbackLinks /
  // feedbackAssets), populated by the API on load (PRD-7 S2). This UI block
  // is the missing surface that lets the author edit them via the unified
  // FeedbackEditorModal, identical to topic-level feedback elsewhere.
  return (
    <>
      <div className="ou-formfield" data-field="basic.title">
        <Input
          id="settings-title"
          size="m"
          fullWidth
          label="Название"
          value={model.basic.title}
          placeholder="Введите название теста"
          required
          error={fieldErrors.get("basic.title")}
          onChange={(e) => {
            const value = e.target.value;
            updateModel((m) => ({
              ...m,
              basic: { ...m.basic, title: value },
            }));
          }}
          data-testid="settings-title-input"
        />
      </div>

      <div className="ou-formfield">
        <Textarea
          id="settings-description"
          size="m"
          fullWidth
          rows={3}
          label="Описание"
          value={model.basic.description}
          placeholder="Опишите цели теста и аудиторию"
          onChange={(e) => {
            const value = e.target.value;
            updateModel((m) => ({
              ...m,
              basic: { ...m.basic, description: value },
            }));
          }}
          data-testid="settings-description-input"
        />
      </div>

      <hr className="wf-sep" />

      <div className="ou-formfield" data-testid="settings-mode-group">
        <label className="ou-formfield__lbl">Режим теста</label>
        <SegmentedControl<"standard" | "adaptive">
          size="m"
          value={model.mode}
          aria-label="Режим теста"
          items={[
            { value: "standard", label: "Стандартный" },
            { value: "adaptive", label: "Адаптивный" },
          ]}
          onChange={(value) => {
              updateModel((m) => {
                if (value === "adaptive" && m.mode !== "adaptive" && m.sections.length > 0) {
                  const existingTopics = m.adaptive.topics;
                  const updatedTopics = m.sections.map((section) => {
                    const existing = existingTopics.find((t) => t.topicId === section.topicId);
                    if (existing && existing.levels.length > 0) return existing;
                    return {
                      topicId: section.topicId,
                      topicName: section.topicName,
                      failureFeedback: existing?.failureFeedback ?? null,
                      levels: [makeDefaultLevel(0)],
                      enabled: existing?.enabled ?? false,
                    };
                  });
                  const otherTopics = existingTopics.filter(
                    (t) => !m.sections.some((s) => s.topicId === t.topicId),
                  );
                  return {
                    ...m,
                    mode: value,
                    adaptive: { ...m.adaptive, topics: [...updatedTopics, ...otherTopics] },
                  };
                }
                return { ...m, mode: value };
              });
            }}
        />
      </div>

      <div className="ou-formfield">
        <Select<FlowMode>
          id="settings-flow-mode"
          size="m"
          fullWidth
          label="Сценарий прохождения"
          value={model.flowMode}
          // PRD-4 v1.1 L1 guard: linear_flat is disabled when mode=adaptive
          // (the (adaptive, linear_flat) combo is deferred to a future PRD).
          options={[
            {
              value: "linear_flat",
              label:
                model.mode === "adaptive"
                  ? "Линейный — недоступно в адаптивном режиме"
                  : "Линейный",
              disabled: model.mode === "adaptive",
            },
            { value: "linear_by_topics", label: "Линейный по темам" },
            { value: "router_by_topics", label: "Через страницу-маршрутизатор" },
          ]}
          onChange={(value) => updateModel((m) => ({ ...m, flowMode: value }))}
          data-testid="settings-flow-mode"
        />
        {model.mode === "adaptive" && model.flowMode === "linear_flat" && (
          <Banner
            tone="warning"
            size="sm"
            title="Адаптивный режим несовместим с линейным сценарием"
            description="Выберите «Линейный по темам» или «Через страницу-маршрутизатор» — адаптивная выдача вопросов требует разделения теста по темам."
            data-testid="settings-flow-mode-adaptive-flat-warning"
          />
        )}
      </div>

      <hr className="wf-sep" />

      <ReportSettingsCard
        mode={model.mode}
        draftTemplateId={draftTemplateId}
        designParams={draftDesignParams}
        value={model.report ?? {}}
        readOnly={model.basic.status === "published"}
        onChange={(next) => updateModel((m) => ({ ...m, report: next }))}
        // FR-18: предпросмотр строится на РЕАЛЬНОЙ структуре редактируемого теста —
        // его названии и разделах; демонстрационные только числа и вердикты.
        testName={model.basic.title}
        sections={model.sections.map((s) => ({
          topicId: s.topicId,
          topicName: s.topicName,
          questionCount: s.drawCount,
        }))}
        levelNames={
          model.mode === "adaptive"
            ? (model.adaptive.topics.find((t) => t.enabled)?.levels ?? []).map((l) => l.levelName)
            : undefined
        }
      />

      <hr className="wf-sep" />

      <Card variant="outlined" data-testid="settings-feedback-card">
        <CardHeader title="Общая обратная связь теста" />
        <CardBody>
          <TestFeedbackTrigger
            feedback={model.basic.feedback}
            links={model.basic.feedbackLinks}
            assets={model.basic.feedbackAssets}
            events={model.basic.feedbackEvents}
            onSave={(next) => {
              updateModel((m) => ({
                ...m,
                basic: {
                  ...m.basic,
                  feedback: { format: next.format, text: next.text },
                  feedbackLinks: next.links,
                  feedbackAssets: next.assets,
                  feedbackEvents: next.events,
                },
              }));
            }}
          />
          <hr className="wf-sep" />
          <div className="ou-formfield">
            <Switch
              label="Показывать правильные ответы после прохождения"
              checked={model.runtime.showCorrectAnswers}
              onChange={(e) => {
                const checked = e.target.checked;
                updateModel((m) => ({
                  ...m,
                  runtime: {
                    ...m.runtime,
                    showCorrectAnswers: checked,
                    // PRD-19 FR-04b: взаимоисключение — при показе правильных ответов
                    // изменение ответа недоступно.
                    allowAnswerChange: checked ? false : m.runtime.allowAnswerChange,
                  },
                }));
              }}
              data-testid="settings-show-correct-checkbox"
            />
          </div>
        </CardBody>
      </Card>
    </>
  );
}

// ─── Sub-pane: Ограничения ────────────────────────────────────────────────────

function LimitsPane({ model, updateModel }: SettingsSectionProps) {
  return (
    <>
      <div className="ou-formfield">
        <NumberInput
          id="settings-max-attempts"
          size="m"
          label="Максимум попыток"
          hint="Оставьте 0 для неограниченного числа попыток."
          value={model.runtime.maxAttempts ?? 0}
          min={0}
          data-testid="settings-max-attempts-input"
          onChange={(next) =>
            updateModel((m) => ({
              ...m,
              runtime: { ...m.runtime, maxAttempts: next === 0 ? null : next },
            }))
          }
        />
      </div>

      <div className="ou-formfield">
        <NumberInput
          id="settings-time-limit"
          size="m"
          label="Лимит времени теста"
          hint="Оставьте 0, чтобы не ограничивать."
          value={model.runtime.timeLimitMinutes ?? 0}
          min={0}
          suffix="минут"
          data-testid="settings-time-limit-input"
          onChange={(next) =>
            updateModel((m) => ({
              ...m,
              runtime: { ...m.runtime, timeLimitMinutes: next === 0 ? null : next },
            }))
          }
        />
      </div>
      <hr className="wf-sep" />
      <PerTopicLimitsBlock model={model} updateModel={updateModel} />
      {/* PRD-7 S13.2-G8: «Показывать правильные ответы» переехал в Основное
          → секция «Общая обратная связь теста» (вместе с feedback editor),
          per wireframe prd7-editor-settings-tab.html lines 820-837. */}
    </>
  );
}

// ─── Per-topic time-limits block (S13.3-G9/G10) ──────────────────────────────

/**
 * Per-topic time-limit block (PRD-7 S13.3-G9/G10). Renders the
 * «Индивидуальные лимиты для тем» switch and, when on, a table of NumberInput
 * rows per `model.sections` topic.
 *
 * Model semantics (per {@link SectionTimeLimit}):
 *   - `inherit_test` — topic uses the test-level limit (default).
 *   - `none`         — topic is unlimited (overrides the test-level limit).
 *   - `custom`       — explicit per-topic minutes value.
 *
 * Switch state is derived: ON when any section has a non-`inherit_test` limit.
 * Toggling OFF resets every section to `inherit_test`. Toggling ON leaves
 * sections alone — they appear in the table with empty inputs (placeholder
 * «Без ограничения»), which corresponds to `none` (i.e. unlimited). Typing
 * a positive number switches the section to `custom`. Clearing the field
 * (NumberInput emits 0) reverts to `none`, matching the wireframe placeholder.
 *
 * For `linear_flat` (no per-topic sections) the wireframe state
 * `s-limits-no-topics` hides the block; we render an info banner explaining
 * why the per-topic option is unavailable in this flow.
 */
function PerTopicLimitsBlock({ model, updateModel }: SettingsSectionProps) {
  const sections = model.sections;
  const hasCustomLimits = sections.some((s) => s.timeLimit.source !== "inherit_test");

  if (sections.length === 0) {
    return (
      <Banner
        tone="info"
        size="sm"
        description="Индивидуальные лимиты для тем доступны после добавления хотя бы одной темы во вкладке «Состав»."
        data-testid="settings-per-topic-no-topics"
      />
    );
  }

  function setAllSectionsTo(source: "inherit_test" | "none") {
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((s) => ({ ...s, timeLimit: { source } })),
    }));
  }

  function setSectionLimit(topicId: string, next: number) {
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((s) =>
        s.topicId === topicId
          ? {
              ...s,
              timeLimit:
                next > 0
                  ? { source: "custom", minutes: next }
                  : { source: "none" },
            }
          : s,
      ),
    }));
  }

  return (
    <>
      <div className="ou-formfield">
        <Switch
          label="Индивидуальные лимиты для тем"
          description="Если выключено, действует только общий лимит теста (см. выше)."
          checked={hasCustomLimits}
          onChange={(e) => {
            const checked = e.target.checked;
            if (checked) {
              // Switching ON: flip every inherit_test row to `none` (unlimited)
              // so `hasCustomLimits` becomes true, the switch stays ON, and the
              // table appears. Rows render with empty inputs (placeholder
              // «Без ограничения»); the author opts into a custom limit by
              // typing a positive number. Without this the derived `checked`
              // would snap straight back to OFF and the table never shows.
              setAllSectionsTo("none");
            } else {
              setAllSectionsTo("inherit_test");
            }
          }}
          data-testid="settings-per-topic-switch"
        />
      </div>
      {hasCustomLimits && (
        <table
          className="tb-table tb-table--mb"
          aria-label="Индивидуальные лимиты времени по темам"
          data-testid="settings-per-topic-table"
        >
          <thead>
            <tr>
              <th>Тема</th>
              <th>Лимит</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => {
              const current =
                section.timeLimit.source === "custom" ? section.timeLimit.minutes : 0;
              return (
                <tr key={section.topicId}>
                  <td>{section.topicName}</td>
                  <td>
                    <NumberInput
                      size="s"
                      aria-label={`Лимит для темы ${section.topicName}`}
                      value={current}
                      min={0}
                      suffix="минут"
                      placeholder="Без ограничения"
                      onChange={(next) => setSectionLimit(section.topicId, next)}
                      data-testid={`settings-per-topic-limit-${section.topicId}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

// ─── Sub-pane: Повторное прохождение (PRD-6) ──────────────────────────────────

/** Active eligibility plugin as served by `/api/tests/:id/available-eligibility-plugins`. */
type EligibilityPluginInfo = {
  key: string;
  name: string;
  version: string;
  description: string;
  bestEffort: boolean;
  configs: { id: string; name: string; version: string }[];
};

/**
 * «Повторное прохождение» pane (PRD-6, wireframe `prd6-retake-policy.html`).
 * Binds `model.retakePolicy`:
 *   - Switch        → `enabled` (off = legacy behaviour, FR-02)
 *   - NumberInput   → `cooldownPeriodDays` (1–3650 calendar days)
 *   - Select        → `eligibilityPlugin.key` (active registry; one config per
 *                     plugin auto-resolved server-side in Phase 1)
 *   - SegmentedControl → `eligibilityPlugin.failPolicy` (failOpen / failClosed)
 *
 * The plugin list is global; we query it by `model.id` (the test scope is only
 * for auth). A best-effort plugin (suspend_data) shows the reliability warning.
 */
function RetakePane({ model, updateModel }: SettingsSectionProps) {
  const testId = model.id;
  const { data } = useQuery<{ plugins: EligibilityPluginInfo[] }>({
    queryKey: [`/api/tests/${testId}/available-eligibility-plugins`],
    enabled: Boolean(testId),
  });
  const plugins = data?.plugins ?? [];

  const policy = model.retakePolicy;
  const enabled = policy.enabled;
  const plugin = policy.eligibilityPlugin ?? null;
  const currentKey = plugin?.key ?? "";
  const defaultPluginKey = plugins[0]?.key ?? "webtutor_cooldown";
  const selectedPlugin = plugins.find((p) => p.key === currentKey);
  const isBestEffort =
    selectedPlugin?.bestEffort ?? currentKey === "suspend_data_cooldown";

  const setPolicy = (patch: Partial<RetakePolicy>) =>
    updateModel((m) => ({ ...m, retakePolicy: { ...m.retakePolicy, ...patch } }));

  // PRD-31 barrier B. Independent of the switch above: a test may carry only the
  // hour interval, which is why `cooldownPeriodDays` became optional in the schema.
  const interval = policy.attemptInterval ?? null;
  const intervalOn = interval?.enabled === true;

  const setInterval = (patch: Partial<NonNullable<RetakePolicy["attemptInterval"]>>) =>
    updateModel((m) => ({
      ...m,
      retakePolicy: {
        ...m.retakePolicy,
        attemptInterval: {
          enabled: m.retakePolicy.attemptInterval?.enabled === true,
          hours: m.retakePolicy.attemptInterval?.hours ?? 24,
          ...patch,
        },
      },
    }));

  const setPlugin = (patch: Partial<EligibilityPluginRef>) =>
    updateModel((m) => {
      const base: EligibilityPluginRef =
        m.retakePolicy.eligibilityPlugin ?? { key: defaultPluginKey, failPolicy: "failOpen" };
      return {
        ...m,
        retakePolicy: { ...m.retakePolicy, eligibilityPlugin: { ...base, ...patch } },
      };
    });

  const pluginOptions = plugins.map((p) => ({ value: p.key, label: p.name }));
  // Keep the saved key selectable even before the list loads / on an unsaved test.
  if (currentKey && !pluginOptions.some((o) => o.value === currentKey)) {
    pluginOptions.unshift({ value: currentKey, label: currentKey });
  }

  return (
    <>
      <div className="ou-formfield">
        <Switch
          label="Ограничить повторное прохождение"
          description={
            enabled
              ? "Допуск проверяется до старта курса."
              : "Выключено — учащийся может перезапускать курс без ограничений (как сейчас)."
          }
          checked={enabled}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => {
              const next: RetakePolicy = { ...m.retakePolicy, enabled: checked };
              // Enabling with no plugin yet → seed the first active plugin so the
              // Select is never empty (wireframe s-on-webtutor).
              if (checked && !next.eligibilityPlugin) {
                next.eligibilityPlugin = { key: defaultPluginKey, failPolicy: "failOpen" };
              }
              return { ...m, retakePolicy: next };
            });
          }}
          data-testid="settings-retake-switch"
        />
      </div>

      {enabled && (
        <>
          <div className="ou-formfield">
            <NumberInput
              id="settings-retake-cooldown"
              size="m"
              label="Период охлаждения, календарных дней"
              hint="От 1 до 3650 дней."
              // PRD-31: the field is optional in the schema (a policy may carry the
              // hour interval alone), so the editor shows the default when barrier A
              // has never been configured. The value is only persisted once the
              // switch above is on, which is exactly when the schema requires it.
              value={policy.cooldownPeriodDays ?? 30}
              min={1}
              max={3650}
              data-testid="settings-retake-cooldown-input"
              onChange={(next) =>
                setPolicy({ cooldownPeriodDays: Math.min(3650, Math.max(1, next || 1)) })
              }
            />
          </div>

          <div className="ou-formfield">
            <Select<string>
              id="settings-retake-plugin"
              size="m"
              fullWidth
              label="Способ проверки (плагин)"
              value={currentKey}
              options={pluginOptions}
              onChange={(value) => setPlugin({ key: value })}
              data-testid="settings-retake-plugin"
            />
          </div>

          {isBestEffort && (
            <Banner
              tone="warning"
              size="sm"
              description="Надёжно работает только в пределах одной регистрации курса в LMS. Для строгого ограничения между новыми попытками используйте проверку через WebTutor."
              data-testid="settings-retake-besteffort-warning"
            />
          )}

          {currentKey === "webtutor_cooldown" && (
            <Banner
              tone="warning"
              size="sm"
              description="Проверка через WebTutor находит прошлые попытки по НАЗВАНИЮ курса. Ограничение сработает только если название курса (модуля) в WebTutor точно совпадает с названием этого теста. Если при загрузке в LMS курс назван иначе — период охлаждения применяться не будет."
              data-testid="settings-retake-webtutor-name-warning"
            />
          )}

          <div
            className="ou-formfield"
            data-testid="settings-retake-failpolicy-group"
          >
            <label className="ou-formfield__lbl">При ошибке проверки допуска</label>
            <SegmentedControl<"failOpen" | "failClosed">
              size="m"
              aria-label="Политика при ошибке проверки допуска"
              value={plugin?.failPolicy ?? "failOpen"}
              items={[
                { value: "failOpen", label: "Разрешить старт" },
                { value: "failClosed", label: "Заблокировать" },
              ]}
              onChange={(value) => setPlugin({ failPolicy: value })}
            />
            <div className="ou-formfield__desc">
              Если проверку не удалось выполнить — открыть курс или показать экран блокировки.
            </div>
          </div>
        </>
      )}

      {/* PRD-31 барьер B: интервал между попытками ВНУТРИ одного назначения.
          Отделён от группы выше, потому что барьеры независимы (FR-03) и стоят
          на разных границах: кулдаун — между назначениями, интервал — внутри. */}
      <div className="ou-card__divider" />

      <label className="ou-switch-field">
        <Switch
          size="m"
          checked={intervalOn}
          aria-label="Ограничение между попытками"
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              retakePolicy: {
                ...m.retakePolicy,
                // Часы сохраняются и при выключении: автор, выключивший барьер на
                // время, не должен вводить значение заново.
                attemptInterval: { enabled: checked, hours: m.retakePolicy.attemptInterval?.hours ?? 24 },
              },
            }));
          }}
          data-testid="settings-attempt-interval-switch"
        />
        <span className="ou-switch-field__text">
          <span className="ou-switch-field__label">Ограничение между попытками</span>
          <span className="ou-switch-field__desc">
            {intervalOn
              ? "Следующая попытка внутри назначения открывается не сразу."
              : "Выключено — попытки внутри одного назначения идут подряд."}
          </span>
        </span>
      </label>

      {intervalOn && (
        <>
          <div className="ou-formfield">
            <NumberInput
              id="settings-attempt-interval"
              size="m"
              label="Интервал, часов"
              hint="От 1 до 8760 часов (до года)."
              value={interval?.hours ?? 24}
              min={1}
              max={8760}
              data-testid="settings-attempt-interval-input"
              onChange={(next) => setInterval({ hours: clampIntervalHours(next) })}
            />
          </div>

          <Banner
            tone="info"
            size="sm"
            description={
              enabled
                ? "Период охлаждения действует между назначениями, ограничение между попытками — внутри одного назначения."
                : "Ограничение между попытками действует внутри одного назначения. Период охлаждения выше — между назначениями."
            }
            data-testid="settings-attempt-interval-note"
          />
        </>
      )}
    </>
  );
}

// ─── Sub-pane: Интеграция ─────────────────────────────────────────────────────

function IntegrationPane({ model, updateModel, fieldErrors = EMPTY_FIELD_ERRORS }: SettingsSectionProps) {
  return (
    <>
      <div className="ou-formfield" data-field="basic.webhookUrl">
        <Input
          id="settings-webhook"
          size="m"
          fullWidth
          label="Webhook URL"
          type="url"
          value={model.basic.webhookUrl}
          placeholder="https://example.com/webhook"
          error={fieldErrors.get("basic.webhookUrl")}
          onChange={(e) => {
            const value = e.target.value;
            updateModel((m) => ({
              ...m,
              basic: { ...m.basic, webhookUrl: value },
            }));
          }}
          data-testid="settings-webhook-input"
        />
        <div className="ou-formfield__desc">Оставьте пустым, если webhook не нужен.</div>
      </div>

      <div className="ou-formfield">
        <Switch
          label="Отправлять телеметрию о прохождении"
          checked={model.basic.telemetryEnabled}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              basic: { ...m.basic, telemetryEnabled: checked },
            }));
          }}
          data-testid="settings-telemetry-checkbox"
        />
      </div>
    </>
  );
}

// ─── Sub-pane: Правила прохождения ────────────────────────────────────────────

const DECISION_POLICIES: { value: PassDecisionPolicy; label: string }[] = [
  { value: "overall_only", label: "достигнут общий проходной порог теста" },
  {
    value: "overall_and_required_topics",
    label:
      "достигнут общий проходной порог и пройдены все обязательные темы",
  },
  { value: "required_topics_only", label: "пройдены все обязательные темы" },
  { value: "all_topics_passed", label: "пройдена каждая выбранная тема" },
];

function PassRulesPane({ model, updateModel, fieldErrors = EMPTY_FIELD_ERRORS }: SettingsSectionProps) {
  // PRD-19 (FR-04b): «изменение ответа» зависит от возврата ВКЛ и взаимоисключается с показом
  // правильных ответов (раздел «Ограничения»). showSectionResults — только для секционных.
  const changeDisabled =
    !model.runtime.allowReturnToUnanswered || model.runtime.showCorrectAnswers;
  const showSectionResultsApplicable =
    model.flowMode !== "linear_flat" && model.sections.length > 0;
  return (
    <>
      <div className="ou-formfield">
        <Switch
          label="Разрешить возврат к неотвеченным вопросам"
          description="Ученик может пропускать вопросы и возвращаться к ним до завершения. Включает карту-индикатор прогресса и экран обзора."
          checked={model.runtime.allowReturnToUnanswered}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              runtime: {
                ...m.runtime,
                allowReturnToUnanswered: checked,
                // изменение ответа невозможно без возврата
                allowAnswerChange: checked ? m.runtime.allowAnswerChange : false,
              },
            }));
          }}
          data-testid="settings-allow-return-checkbox"
        />
      </div>
      <div className="ou-formfield">
        <Switch
          label="Позволить изменять ответ до завершения"
          description="При возврате к уже отвеченному вопросу можно изменить ответ (до завершения раздела/теста)."
          checked={model.runtime.allowAnswerChange && !changeDisabled}
          disabled={changeDisabled}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              runtime: { ...m.runtime, allowAnswerChange: checked },
            }));
          }}
          data-testid="settings-allow-change-checkbox"
        />
        {changeDisabled && (
          <Banner
            tone="warning"
            size="sm"
            description={
              !model.runtime.allowReturnToUnanswered
                ? "Доступно только при включённом возврате к неотвеченным."
                : "Недоступно при включённом показе правильных ответов (раздел «Ограничения»): иначе ученик увидит правильный ответ и переправит свой."
            }
          />
        )}
      </div>
      {showSectionResultsApplicable && (
        <div className="ou-formfield">
          <Switch
            label="Показывать итоги раздела"
            description="После завершения раздела показывается экран с его результатом. Только для секционных тестов."
            checked={model.runtime.showSectionResults}
            onChange={(e) => {
              const checked = e.target.checked;
              updateModel((m) => ({
                ...m,
                runtime: { ...m.runtime, showSectionResults: checked },
              }));
            }}
            data-testid="settings-show-section-results-checkbox"
          />
        </div>
      )}

      <hr className="wf-sep" />

      {/* PRD-34: блок «Защита». Три переключателя НЕЗАВИСИМЫ (FR-02) — водяной знак и
          скрытие при потере фокуса осмысленны и без основной защиты, поэтому
          подчинённости между ними нет ни здесь, ни в базе. */}
      <div className="ou-formfield">
        <Switch
          label="Защищать текст задания от копирования"
          description="На экране вопроса и на экране обзора текст не выделяется, не копируется, не перетаскивается и не печатается. В тестовом прогоне автора защита не действует."
          checked={model.runtime.copyProtection}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              runtime: { ...m.runtime, copyProtection: checked },
            }));
          }}
          data-testid="settings-copy-protection-checkbox"
        />
      </div>
      <div className="ou-formfield">
        <Switch
          label="Показывать водяной знак"
          description="Поверх экранов вопроса, обзора, итогов раздела и итогов теста печатается обезличенный идентификатор и время. Снимок экрана остаётся возможным, но становится атрибутируемым."
          checked={model.runtime.protectionWatermark}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              runtime: { ...m.runtime, protectionWatermark: checked },
            }));
          }}
          data-testid="settings-protection-watermark-checkbox"
        />
      </div>
      <div className="ou-formfield">
        <Switch
          label="Скрывать задание при уходе из окна"
          description="Если ученик переключился на другую вкладку, задание закрывается заглушкой и открывается снова само, как только окно активно. Таймер и ответы не затрагиваются."
          checked={model.runtime.protectionHideOnBlur}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              runtime: { ...m.runtime, protectionHideOnBlur: checked },
            }));
          }}
          data-testid="settings-protection-hide-on-blur-checkbox"
        />
      </div>

      <hr className="wf-sep" />

      <Card
        variant="outlined"
        size="sm"
        className="tb-pass-card"
        data-testid="settings-pass-rules-card"
        data-field="passRules"
      >
        <CardHeader title="Тест пройден, если:" />
        <CardBody>
          <RadioGroup<PassDecisionPolicy>
            name="pass-decision-policy"
            value={model.passRules.decisionPolicy}
            options={DECISION_POLICIES}
            onChange={(value) =>
              updateModel((m) => ({
                ...m,
                passRules: { ...m.passRules, decisionPolicy: value },
              }))
            }
          />

          <hr className="wf-sep" />

          <div className="tb-pass-overall">
            <div className="ou-formfield">
              <Select<OverallPassType>
                id="pass-overall-type"
                size="m"
                fullWidth
                label="Тип общего правила"
                value={model.passRules.overall.type}
                options={[
                  { value: "percent", label: "Процент правильных ответов" },
                  { value: "absolute", label: "Сумма баллов" },
                  { value: "none", label: "Не задано" },
                ]}
                onChange={(value) =>
                  updateModel((m) => ({
                    ...m,
                    passRules: {
                      ...m.passRules,
                      overall: buildOverallByType(value, m.passRules.overall),
                    },
                  }))
                }
                data-testid="pass-overall-type"
              />
            </div>
            {model.passRules.overall.type !== "none" && (
              <div className="ou-formfield" data-field="passRules.overall.value">
                <NumberInput
                  id="pass-overall-value"
                  size="m"
                  label={
                    model.passRules.overall.type === "percent"
                      ? "Порог (%)"
                      : "Порог (баллы)"
                  }
                  value={model.passRules.overall.value}
                  min={0}
                  max={model.passRules.overall.type === "percent" ? 100 : undefined}
                  suffix={model.passRules.overall.type === "percent" ? "%" : undefined}
                  error={fieldErrors.get("passRules.overall.value")}
                  data-testid="pass-overall-value"
                  onChange={(next) =>
                    updateModel((m) => ({
                      ...m,
                      passRules: {
                        ...m.passRules,
                        overall: { ...m.passRules.overall, value: next },
                      },
                    }))
                  }
                />
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {model.sections.length > 0 && (
        <>
          <h3 className="tb-topics-title">Правила прохождения тем</h3>
          <table
            className="tb-table tb-pass-table"
            aria-label="Правила прохождения тем"
            data-testid="pass-rules-topics-table"
          >
            <thead>
              <tr>
                <th scope="col" className="tb-pass-table__topic-col">Тема</th>
                <th scope="col">Правило прохождения темы</th>
              </tr>
            </thead>
            <tbody>
              {model.sections.map((section) => {
                const rule: TopicPassRule =
                  model.passRules.byTopic[section.topicId] ?? { source: "inherit_overall" };
                return (
                  <PassTopicRow
                    key={section.topicId}
                    topicId={section.topicId}
                    topicName={section.topicName}
                    rule={rule}
                    forms={section.formSet?.forms}
                    variantMaxPoints={variantMaxPointsFor(model, section)}
                    fieldErrors={fieldErrors}
                    onSourceChange={(source) =>
                      updateModel((m) => ({
                        ...m,
                        passRules: {
                          ...m.passRules,
                          byTopic: {
                            ...m.passRules.byTopic,
                            [section.topicId]: buildTopicRuleBySource(source, rule, section, m),
                          },
                        },
                      }))
                    }
                    onVariantTypeChange={(formId, type) =>
                      updateModel((m) => updateVariantEntry(m, section.topicId, formId, (e) => ({ ...e, type })))
                    }
                    onVariantValueChange={(formId, value) =>
                      updateModel((m) => updateVariantEntry(m, section.topicId, formId, (e) => ({ ...e, value })))
                    }
                    onCustomTypeChange={(customType) =>
                      updateModel((m) => {
                        const current =
                          m.passRules.byTopic[section.topicId] ?? { source: "inherit_overall" };
                        if (current.source !== "custom") return m;
                        return {
                          ...m,
                          passRules: {
                            ...m.passRules,
                            byTopic: {
                              ...m.passRules.byTopic,
                              [section.topicId]: { ...current, type: customType },
                            },
                          },
                        };
                      })
                    }
                    onCustomValueChange={(value) =>
                      updateModel((m) => {
                        const current =
                          m.passRules.byTopic[section.topicId] ?? { source: "inherit_overall" };
                        if (current.source !== "custom") return m;
                        return {
                          ...m,
                          passRules: {
                            ...m.passRules,
                            byTopic: {
                              ...m.passRules.byTopic,
                              [section.topicId]: { ...current, value },
                            },
                          },
                        };
                      })
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {model.sections.length === 0 && (
        <div
          className="ou-banner ou-banner--info"
          role="status"
          data-testid="pass-rules-no-topics"
        >
          <div className="ou-banner__body">
            <div className="ou-banner__title">Сначала добавьте темы</div>
            <div className="ou-banner__desc">
              Перейдите во вкладку «Состав» и добавьте хотя бы одну тему — после
              этого здесь появится таблица правил прохождения тем.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PassTopicRow(props: {
  topicId: string;
  topicName: string;
  rule: TopicPassRule;
  /** PRD-24: the topic's variants (PRD-17). Empty = «По вариантам» is not offered. */
  forms?: Form[];
  /** PRD-24: Σ attainable points per variant id — shown as a hint for absolute thresholds. */
  variantMaxPoints?: Record<string, number>;
  fieldErrors?: FieldErrorIndex;
  onSourceChange: (source: TopicPassRule["source"]) => void;
  onCustomTypeChange: (type: "percent" | "absolute") => void;
  onCustomValueChange: (value: number) => void;
  onVariantTypeChange: (formId: string, type: "percent" | "absolute") => void;
  onVariantValueChange: (formId: string, value: number) => void;
}) {
  const isCustom = props.rule.source === "custom";
  const forms = props.forms ?? [];
  // FR-02: the per-variant rule only exists for a topic delivered as variants.
  const hasVariants = forms.length >= 2;
  return (
    <>
      <tr data-testid={`pass-topic-row-${props.topicId}`}>
        <td>{props.topicName}</td>
        <td>
          <Select<TopicPassRule["source"]>
            size="s"
            fullWidth
            value={props.rule.source}
            aria-label={`Правило прохождения темы ${props.topicName}`}
            options={[
              { value: "inherit_overall", label: "Как у теста" },
              { value: "custom", label: "Индивидуальное правило" },
              { value: "none", label: "Не проверять отдельно" },
              ...(hasVariants
                ? [{ value: "by_variant" as const, label: "По вариантам" }]
                : []),
            ]}
            onChange={(value) => props.onSourceChange(value)}
            data-testid={`pass-topic-source-${props.topicId}`}
          />
        </td>
      </tr>
      {props.rule.source === "by_variant" && hasVariants && (
        <tr
          className="tb-pass-table__detail"
          data-testid={`pass-topic-variants-${props.topicId}`}
        >
          <td />
          <td>
            <div className="tb-pass-table__variants">
              {forms.map((form, index) => {
                const entry = props.rule.source === "by_variant" ? props.rule.byForm[form.id] : undefined;
                const type = entry?.type ?? "percent";
                const label = form.label || `Вариант ${index + 1}`;
                const error = props.fieldErrors?.get(
                  `passRules.byTopic[${props.topicId}].byForm[${form.id}].value`,
                );
                // The ceiling an absolute threshold is capped by, printed under THAT
                // variant's threshold. A single line under the whole block read as
                // belonging to the last row — and said nothing about which variant it
                // measured. A percent threshold has no ceiling to state.
                const maxPoints = props.variantMaxPoints?.[form.id];
                const showMax = type === "absolute" && maxPoints != null;
                return (
                  <Fragment key={form.id}>
                    <span className="tb-pass-table__variant-label">{label}</span>
                    <div className="ou-formfield">
                      <Select<"percent" | "absolute">
                        size="s"
                        label="Тип"
                        value={type}
                        aria-label={`Тип порога варианта «${label}» темы ${props.topicName}`}
                        options={[
                          { value: "percent", label: "Процент" },
                          { value: "absolute", label: "Сумма баллов" },
                        ]}
                        onChange={(value) => props.onVariantTypeChange(form.id, value)}
                        data-testid={`pass-variant-type-${props.topicId}-${form.id}`}
                      />
                    </div>
                    <div className="ou-formfield">
                      <NumberInput
                        size="s"
                        value={entry?.value ?? 0}
                        min={0}
                        max={type === "percent" ? 100 : undefined}
                        suffix={type === "percent" ? "%" : undefined}
                        error={error}
                        aria-label={`Порог варианта «${label}» темы ${props.topicName}`}
                        data-testid={`pass-variant-value-${props.topicId}-${form.id}`}
                        onChange={(next) => props.onVariantValueChange(form.id, next)}
                      />
                    </div>
                    {showMax && (
                      <span
                        className="tb-pass-table__variant-hint"
                        data-testid={`pass-variant-max-${props.topicId}-${form.id}`}
                      >
                        макс. {maxPoints} баллов
                      </span>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </td>
        </tr>
      )}
      {isCustom && props.rule.source === "custom" && (
        <tr
          className="tb-pass-table__detail"
          data-testid={`pass-topic-detail-${props.topicId}`}
        >
          <td />
          <td>
            <div className="tb-pass-table__detail-inner">
              <div className="ou-formfield">
                <Select<"percent" | "absolute">
                  size="s"
                  label="Тип"
                  value={props.rule.type}
                  aria-label={`Тип индивидуального правила темы ${props.topicName}`}
                  options={[
                    { value: "percent", label: "Процент" },
                    { value: "absolute", label: "Сумма баллов" },
                  ]}
                  onChange={(value) => props.onCustomTypeChange(value)}
                  data-testid={`pass-topic-custom-type-${props.topicId}`}
                />
              </div>
              <div className="ou-formfield">
                <NumberInput
                  size="s"
                  label="Порог"
                  value={props.rule.value}
                  min={0}
                  max={props.rule.type === "percent" ? 100 : undefined}
                  suffix={props.rule.type === "percent" ? "%" : undefined}
                  aria-label={`Значение порога темы ${props.topicName}`}
                  data-testid={`pass-topic-custom-value-${props.topicId}`}
                  onChange={(next) => props.onCustomValueChange(next)}
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Build a fresh `OverallPassRule` with the requested type, preserving the
 * previous numeric value where it makes sense. `none` carries `value: 0`.
 */
function buildOverallByType(
  type: OverallPassType,
  prev: OverallPassRule,
): OverallPassRule {
  if (type === "none") return { type: "none", value: 0 };
  return { type, value: prev.value || (type === "percent" ? 70 : 0) };
}

/**
 * Build a `TopicPassRule` for the given source, carrying over reasonable
 * defaults from the previous rule. `custom` defaults to `percent` 70.
 */
function buildTopicRuleBySource(
  source: TopicPassRule["source"],
  prev: TopicPassRule,
  section?: EditorSection,
  model?: TestEditorModel,
): TopicPassRule {
  if (source === "inherit_overall") return { source: "inherit_overall" };
  if (source === "none") return { source: "none" };
  if (source === "by_variant") {
    // PRD-24: seed every variant so the rule is valid the moment it is picked —
    // an uncovered variant is a blocking error. Carry over the previous custom
    // threshold when there was one, else the test's overall percent.
    const seed =
      prev.source === "custom"
        ? { type: prev.type, value: prev.value }
        : {
            type: "percent" as const,
            value: model?.passRules.overall.type === "percent" ? model.passRules.overall.value : 70,
          };
    const byForm: Record<string, { type: "percent" | "absolute"; value: number }> = {};
    for (const form of section?.formSet?.forms ?? []) {
      byForm[form.id] = prev.source === "by_variant" ? (prev.byForm[form.id] ?? seed) : seed;
    }
    return { source: "by_variant", byForm };
  }
  if (prev.source === "custom") return prev;
  return { source: "custom", type: "percent", value: 70 };
}

/** PRD-24: patch ONE variant's threshold, leaving the rest of the rule intact. */
function updateVariantEntry(
  model: TestEditorModel,
  topicId: string,
  formId: string,
  patch: (entry: { type: "percent" | "absolute"; value: number }) => {
    type: "percent" | "absolute";
    value: number;
  },
): TestEditorModel {
  const rule = model.passRules.byTopic[topicId];
  if (rule?.source !== "by_variant") return model;
  const current = rule.byForm[formId] ?? { type: "percent" as const, value: 0 };
  return {
    ...model,
    passRules: {
      ...model.passRules,
      byTopic: {
        ...model.passRules.byTopic,
        [topicId]: { source: "by_variant", byForm: { ...rule.byForm, [formId]: patch(current) } },
      },
    },
  };
}

/**
 * PRD-24: Σ attainable points per variant, for the «макс. N баллов» hint next to an
 * absolute threshold. Same effective-price chain as the «Оценка» tab and validation
 * (override → section default → test default → system), so the hint and the
 * validation cap can never disagree.
 */
function variantMaxPointsFor(
  model: TestEditorModel,
  section: EditorSection,
): Record<string, number> {
  const forms = section.formSet?.forms ?? [];
  if (forms.length === 0) return {};
  const overrideByQuestion = new Map(model.scoring.questionOverrides.map((o) => [o.questionId, o]));
  const out: Record<string, number> = {};
  for (const form of forms) {
    out[form.id] = form.questionIds.reduce((sum, questionId) => {
      const override = overrideByQuestion.get(questionId);
      const effective = resolveEffectiveScoring({
        override: override
          ? {
              points: override.points,
              scoring: override.scoringJson,
              difficulty: override.difficulty,
              pinnedContentHash: override.pinnedContentHash,
            }
          : null,
        defaults: {
          sectionDefaultPoints: section.defaultPoints,
          testDefaultPoints: model.scoring.defaultQuestionPoints,
        },
      });
      return sum + effective.points;
    }, 0);
  }
  return out;
}

// ─── Sub-pane: Адаптивный режим ───────────────────────────────────────────────

/**
 * Lookup or synthesise an `AdaptiveTopicConfig & { enabled }` for the given
 * topic id. Used when sections gain a new topic that has no adaptive entry yet.
 */
function findOrCreateAdaptiveTopic(
  model: TestEditorModel,
  topicId: string,
  topicName: string,
): AdaptiveTopicConfig & { enabled: boolean } {
  const existing = model.adaptive.topics.find((t) => t.topicId === topicId);
  if (existing) return existing;
  return { topicId, topicName, failureFeedback: null, levels: [], enabled: false };
}

/** Build a new default adaptive level appended to the end of the stack. */
function makeDefaultLevel(index: number): AdaptiveLevelConfig {
  return {
    levelIndex: index,
    levelName: `Уровень ${index + 1}`,
    minDifficulty: 0,
    maxDifficulty: 100,
    questionsCount: 1,
    passThreshold: 50,
    passThresholdType: "percent",
    feedback: null,
    links: [],
  };
}

function AdaptivePane({ model, updateModel }: SettingsSectionProps) {
  // Parent (SettingsSection) only renders this pane when mode === "adaptive",
  // so the «mode=standard» fallback banner has been removed. If you need to
  // re-introduce it (e.g., for a quick preview from standard mode), restore
  // the rail-item visibility predicate in SettingsSection first.

  const upsertTopic = (
    topicId: string,
    patcher: (
      topic: AdaptiveTopicConfig & { enabled: boolean },
    ) => AdaptiveTopicConfig & { enabled: boolean },
  ) => {
    updateModel((m) => {
      const idx = m.adaptive.topics.findIndex((t) => t.topicId === topicId);
      if (idx === -1) {
        const section = m.sections.find((s) => s.topicId === topicId);
        if (!section) return m;
        const next = patcher({
          topicId,
          topicName: section.topicName,
          failureFeedback: null,
          levels: [],
          enabled: false,
        });
        return { ...m, adaptive: { ...m.adaptive, topics: [...m.adaptive.topics, next] } };
      }
      const updated = patcher(m.adaptive.topics[idx]);
      const topics = [...m.adaptive.topics];
      topics[idx] = updated;
      return { ...m, adaptive: { ...m.adaptive, topics } };
    });
  };

  return (
    <>

      <div className="ou-formfield">
        <Switch
          label="Показывать уровень сложности при прохождении"
          checked={model.adaptive.showDifficultyLevel}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              adaptive: {
                ...m.adaptive,
                showDifficultyLevel: checked,
                testSettings: { ...m.adaptive.testSettings, showDifficultyLevel: checked },
              },
            }));
          }}
          data-testid="adaptive-show-difficulty"
        />
      </div>

      <hr className="wf-sep" />

      <h3 className="tb-topics-title">Адаптивность по темам</h3>

      {model.sections.length === 0 ? (
        <Banner
          tone="info"
          title="Сначала добавьте темы"
          description="Адаптивность настраивается по темам теста. Перейдите во вкладку «Состав» и добавьте темы — после этого здесь появится список для настройки уровней."
          data-testid="adaptive-no-topics"
        />
      ) : (
        <div className="tb-adaptive-topics" data-testid="adaptive-topics-list">
          {model.sections.every((section) => {
            const topic = model.adaptive.topics.find((t) => t.topicId === section.topicId);
            return !topic || !topic.enabled;
          }) && (
            <Banner
              tone="error"
              title="Включите хотя бы одну тему"
              description="Адаптивный режим не будет работать, пока ни одна тема не активирована."
              data-testid="adaptive-no-enabled-topics"
            />
          )}
          {model.sections.map((section) => {
            const topic = findOrCreateAdaptiveTopic(
              model,
              section.topicId,
              section.topicName,
            );
            return (
              <AdaptiveTopicAccordion
                key={section.topicId}
                topic={topic}
                questionCount={section.maxQuestions}
                onToggleEnabled={(enabled) =>
                  upsertTopic(section.topicId, (t) => ({ ...t, enabled }))
                }
                onFailureFeedbackChange={(text) =>
                  upsertTopic(section.topicId, (t) => ({
                    ...t,
                    failureFeedback: text === "" ? null : text,
                  }))
                }
                onAddLevel={() =>
                  upsertTopic(section.topicId, (t) => ({
                    ...t,
                    levels: [...t.levels, makeDefaultLevel(t.levels.length)],
                  }))
                }
                onLevelChange={(levelIndex, patch) =>
                  upsertTopic(section.topicId, (t) => ({
                    ...t,
                    levels: t.levels.map((l) =>
                      l.levelIndex === levelIndex ? { ...l, ...patch } : l,
                    ),
                  }))
                }
                onLevelRemove={(levelIndex) =>
                  upsertTopic(section.topicId, (t) => ({
                    ...t,
                    levels: t.levels
                      .filter((l) => l.levelIndex !== levelIndex)
                      .map((l, i) => ({ ...l, levelIndex: i })),
                  }))
                }
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function AdaptiveTopicAccordion(props: {
  topic: AdaptiveTopicConfig & { enabled: boolean };
  questionCount: number;
  onToggleEnabled: (enabled: boolean) => void;
  onFailureFeedbackChange: (text: string) => void;
  onAddLevel: () => void;
  onLevelChange: (levelIndex: number, patch: Partial<AdaptiveLevelConfig>) => void;
  onLevelRemove: (levelIndex: number) => void;
}) {
  const { topic, questionCount } = props;
  const [open, setOpen] = useState(false);

  // Warning only applies to enabled topics: disabled topics are excluded from
  // the adaptive test logic so missing levels are not a problem there.
  const levelCount = topic.levels.length;
  const statusTone: "ok" | "warn" =
    !topic.enabled || levelCount >= 2 ? "ok" : "warn";
  const levelsPlural =
    levelCount === 1 ? "уровень" : levelCount >= 2 && levelCount <= 4 ? "уровня" : "уровней";
  const subtitle = `${questionCount} вопросов · ${levelCount} ${levelsPlural}`;
  const levelHint =
    topic.enabled && levelCount === 0
      ? "Добавьте уровни сложности"
      : topic.enabled && levelCount === 1
        ? "Добавьте ещё один уровень"
        : null;

  return (
    <div
      className={"ou-acc__item" + (open ? " is-open" : "")}
      data-testid={`adaptive-topic-${topic.topicId}`}
    >
      <button
        type="button"
        className="ou-acc__trigger tb-adaptive-topics__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={`adaptive-topic-toggle-${topic.topicId}`}
      >
        <span
          className={`tb-status-dot tb-status-dot--${statusTone}`}
          aria-hidden="true"
        />
        <span className="ou-acc__trigger-text">
          <span className="ou-acc__title">{topic.topicName}</span>
          <span className="ou-acc__subtitle">{subtitle}</span>
        </span>
        {/* Toggle is rendered INSIDE the trigger (per wireframe wf-adaptive)
           with stopPropagation so flipping the switch doesn't expand/collapse
           the accordion. Chev follows the toggle and is the right-most element. */}
        <span
          className="tb-adaptive-topics__toggle"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Switch
            checked={topic.enabled}
            onChange={(e) => {
              const checked = e.target.checked;
              props.onToggleEnabled(checked);
            }}
            aria-label={`Адаптивность включена для темы ${topic.topicName}`}
            data-testid={`adaptive-topic-enabled-${topic.topicId}`}
          />
          <span className="tb-adaptive-topics__toggle-lbl">
            {topic.enabled ? "Включено" : "Выключено"}
          </span>
        </span>
        <ChevronDown
          className="ou-acc__chev"
          width={18}
          height={18}
          aria-hidden="true"
        />
      </button>
      {levelHint !== null && (
        <div className="tb-adaptive-topics__level-banner">
          <Banner tone="warning" title={levelHint} data-testid={`adaptive-topic-hint-${topic.topicId}`} />
        </div>
      )}
      {open && (
        <div className="ou-acc__body" data-testid={`adaptive-topic-body-${topic.topicId}`}>
          <div className="ou-formfield">
            <FailureFeedbackEditor
              topicName={topic.topicName}
              topicId={topic.topicId}
              value={topic.failureFeedback ?? ""}
              onChange={props.onFailureFeedbackChange}
            />
          </div>

          <div className="tb-adaptive-section">
            <div className="tb-adaptive-section__head">
              <h4 className="tb-adaptive-section__title">Уровни сложности</h4>
              <div className="tb-adaptive-section__actions">
                <Button
                  variant="secondary"
                  size="s"
                  onClick={props.onAddLevel}
                  data-testid={`adaptive-add-level-${topic.topicId}`}
                >
                  + Добавить уровень
                </Button>
              </div>
            </div>

            {topic.levels.length === 0 ? (
              <div className="tb-card-desc">
                Уровней нет — добавьте хотя бы один. Минимум один уровень нужен
                для запуска адаптивного режима по теме (FR-17).
              </div>
            ) : (
              <div className="tb-adaptive-levels">
                {topic.levels.map((level) => (
                  <AdaptiveLevelCard
                    key={level.levelIndex}
                    topicId={topic.topicId}
                    level={level}
                    canRemove={topic.levels.length > 1}
                    onChange={(patch) => props.onLevelChange(level.levelIndex, patch)}
                    onRemove={() => props.onLevelRemove(level.levelIndex)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AdaptiveLevelCard(props: {
  topicId: string;
  level: AdaptiveLevelConfig;
  canRemove: boolean;
  onChange: (patch: Partial<AdaptiveLevelConfig>) => void;
  onRemove: () => void;
}) {
  const { level } = props;
  const [collapsed, setCollapsed] = useState(false);
  const testIdBase = `adaptive-level-${props.topicId}-${level.levelIndex}`;

  // Validation: a level is "valid" when min ≤ max, questions ≥ 1 and
  // threshold is within bounds. Defer richer rules until validation
  // pipeline is plugged in (FR-17 follow-up).
  const isValid =
    level.minDifficulty <= level.maxDifficulty &&
    level.questionsCount >= 1 &&
    level.passThreshold >= 0 &&
    (level.passThresholdType !== "percent" || level.passThreshold <= 100);
  const statusTone: "ok" | "err" = isValid ? "ok" : "err";
  const statusLabel = isValid ? "валидно" : "невалидно";

  return (
    <Card
      variant="outlined"
      size="sm"
      className={"tb-level-card" + (collapsed ? " is-collapsed" : "")}
      data-testid={testIdBase}
    >
      <CardHeader
        className="tb-level-card__head"
        lead={
          <span
            className={`tb-status-dot tb-status-dot--${statusTone}`}
            aria-label={`Состояние уровня: ${statusLabel}`}
            data-testid={`${testIdBase}-status`}
          />
        }
        title={level.levelName}
        subtitle={
          <>
            {level.minDifficulty}–{level.maxDifficulty} · {level.questionsCount} вопросов · {level.passThreshold}
            {level.passThresholdType === "percent" ? " %" : " б."} · {statusLabel}
          </>
        }
        trail={
          <>
            <Button
              variant="ghost"
              size="s"
              leadingIcon={<Trash2 size={14} aria-hidden="true" />}
              onClick={props.onRemove}
              disabled={!props.canRemove}
              aria-label={
                props.canRemove
                  ? `Удалить уровень ${level.levelName}`
                  : "Нельзя удалить единственный уровень"
              }
              title={props.canRemove ? undefined : "Должен оставаться хотя бы один уровень"}
              data-testid={`${testIdBase}-remove`}
            />
            <button
              type="button"
              className="tb-level-card__chev"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Раскрыть уровень" : "Свернуть уровень"}
              onClick={() => setCollapsed((v) => !v)}
              data-testid={`${testIdBase}-toggle`}
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </>
        }
      />
      <CardBody className="tb-level-card__body">
        <div className="tb-level-grid">
          <div className="ou-formfield">
            <Input
              id={`${testIdBase}-name`}
              size="s"
              fullWidth
              label="Название"
              value={level.levelName}
              onChange={(e) => {
                const value = e.target.value;
                props.onChange({ levelName: value });
              }}
              data-testid={`${testIdBase}-name`}
            />
          </div>
          <div className="ou-formfield">
            <NumberInput
              id={`${testIdBase}-min`}
              size="s"
              label="Сложность от"
              value={level.minDifficulty}
              min={0}
              max={100}
              data-testid={`${testIdBase}-min`}
              onChange={(next) => props.onChange({ minDifficulty: next })}
            />
          </div>
          <div className="ou-formfield">
            <NumberInput
              id={`${testIdBase}-max`}
              size="s"
              label="до"
              value={level.maxDifficulty}
              min={0}
              max={100}
              data-testid={`${testIdBase}-max`}
              onChange={(next) => props.onChange({ maxDifficulty: next })}
            />
          </div>
          <div className="ou-formfield">
            <NumberInput
              id={`${testIdBase}-questions`}
              size="s"
              label="Вопросов"
              value={level.questionsCount}
              min={1}
              data-testid={`${testIdBase}-questions`}
              onChange={(next) => props.onChange({ questionsCount: next })}
            />
          </div>
          <div className="ou-formfield">
            <Select<"percent" | "absolute">
              id={`${testIdBase}-threshold-type`}
              size="s"
              label="Тип порога"
              value={level.passThresholdType}
              options={[
                { value: "percent", label: "Процент" },
                { value: "absolute", label: "Сумма баллов" },
              ]}
              onChange={(value) => props.onChange({ passThresholdType: value })}
              data-testid={`${testIdBase}-threshold-type`}
            />
          </div>
          <div className="ou-formfield">
            <NumberInput
              id={`${testIdBase}-threshold`}
              size="s"
              label="Порог"
              value={level.passThreshold}
              min={0}
              max={level.passThresholdType === "percent" ? 100 : level.questionsCount}
              suffix={level.passThresholdType === "percent" ? "%" : "б."}
              data-testid={`${testIdBase}-threshold`}
              onChange={(next) => props.onChange({ passThreshold: next })}
            />
          </div>
        </div>
        <div className="ou-formfield">
          <LevelFeedbackEditor
            topicId={props.topicId}
            levelIndex={level.levelIndex}
            levelName={level.levelName}
            text={level.feedback ?? ""}
            links={level.links}
            onChange={({ text, links }) =>
              props.onChange({
                feedback: text === "" ? null : text,
                links,
              })
            }
          />
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Test-level feedback trigger (PRD-7 S13.2-G7, FR-36/FR-37). Opens the unified
 * FeedbackEditorModal pre-loaded with the test's `basic.feedback` /
 * `feedbackLinks` / `feedbackAssets`. Differs from {@link FeedbackEditTrigger}
 * (adaptive use): keeps the rich-text `format` field round-trip and persists
 * PDF assets - both required at the test scope per the wireframe section
 * «Общая обратная связь теста» (prd7-editor-settings-tab.html lines 710-839).
 */
function TestFeedbackTrigger(props: {
  feedback: FeedbackContent;
  links: FeedbackLink[];
  assets: FeedbackAsset[];
  events: FeedbackEvent[];
  onSave: (next: {
    format: FeedbackContent["format"];
    text: string;
    links: FeedbackLink[];
    assets: FeedbackAsset[];
    events: FeedbackEvent[];
  }) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <label className="ou-formfield__lbl">Обратная связь после прохождения</label>
      {/* TD-02: grouped-list preview (Документы / Курсы / Мероприятия) + pencil. */}
      <FeedbackPreview
        format={props.feedback.format}
        text={props.feedback.text}
        links={props.links}
        assets={props.assets}
        events={props.events}
        onEdit={() => setOpen(true)}
        editAriaLabel="Редактировать обратную связь теста"
        testId="settings-feedback-trigger"
      />
      <FeedbackEditorModal
        open={open}
        title="Общая обратная связь теста"
        description="Текст и материалы, которые обучающийся увидит после завершения теста."
        value={{
          format: props.feedback.format,
          text: props.feedback.text,
          links: props.links,
          assets: props.assets,
          events: props.events,
        }}
        onCancel={() => setOpen(false)}
        onSave={(v: FeedbackEditorValue) => {
          props.onSave({
            format: v.format,
            text: v.text,
            links: v.links,
            assets: v.assets,
            events: v.events ?? [],
          });
          setOpen(false);
        }}
        testId="settings-feedback-modal"
      />
    </>
  );
}

/**
 * Inline trigger that opens the unified FeedbackEditorModal (FR-36 / FR-37).
 * Shared base for «обратная связь при не пройденном уровне» (topic-level in
 * adaptive mode) and «обратная связь для уровня» (per-level inside an
 * adaptive level card). Only the modal title and stored value shape differ.
 */
function FeedbackEditTrigger(props: {
  label: string;
  buttonAriaLabel: string;
  modalTitle: string;
  modalDescription?: string;
  text: string;
  links: AdaptiveLinkConfig[];
  /** When true, hide the PDF section in the modal (e.g. for level feedback). */
  hideAssets?: boolean;
  onSave: (next: { text: string; links: AdaptiveLinkConfig[] }) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <label className="ou-formfield__lbl">{props.label}</label>
      {/* TD-02: standard grouped-list preview (here only «Курсы» links — assets
          and events are not used at the adaptive level), shared with test/topic
          feedback so the preview is identical at every level. */}
      <FeedbackPreview
        format="plain"
        text={props.text}
        links={props.links}
        assets={[]}
        events={[]}
        onEdit={() => setOpen(true)}
        editAriaLabel={props.buttonAriaLabel}
        testId={props.testId}
      />
      <FeedbackEditorModal
        open={open}
        title={props.modalTitle}
        description={props.modalDescription}
        value={{
          format: "plain",
          text: props.text,
          links: props.links,
          assets: [],
        }}
        hideAssets={props.hideAssets}
        hideEvents
        onCancel={() => setOpen(false)}
        onSave={(v: FeedbackEditorValue) => {
          props.onSave({ text: v.text, links: v.links });
          setOpen(false);
        }}
        testId={`${props.testId}-modal`}
      />
    </>
  );
}

function FailureFeedbackEditor(props: {
  topicName: string;
  topicId: string;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <FeedbackEditTrigger
      label="Обратная связь при не пройденном уровне"
      buttonAriaLabel={`Редактировать обратную связь темы ${props.topicName}`}
      modalTitle={`Обратная связь по теме «${props.topicName}»`}
      modalDescription="Показывается обучающемуся, если он не прошёл ни один уровень темы."
      text={props.value}
      links={[]}
      hideAssets
      onSave={({ text }) => props.onChange(text)}
      testId={`adaptive-topic-failure-${props.topicId}`}
    />
  );
}

function LevelFeedbackEditor(props: {
  topicId: string;
  levelIndex: number;
  levelName: string;
  text: string;
  links: AdaptiveLinkConfig[];
  onChange: (patch: { text: string; links: AdaptiveLinkConfig[] }) => void;
}) {
  const testIdBase = `adaptive-level-${props.topicId}-${props.levelIndex}`;
  return (
    <FeedbackEditTrigger
      label="Обратная связь для уровня"
      buttonAriaLabel={`Редактировать обратную связь уровня ${props.levelName}`}
      modalTitle={`Обратная связь уровня «${props.levelName}»`}
      modalDescription="Показывается обучающемуся при достижении этого уровня сложности."
      text={props.text}
      links={props.links}
      hideAssets
      onSave={props.onChange}
      testId={`${testIdBase}-feedback`}
    />
  );
}
