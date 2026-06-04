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
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
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
import type { EligibilityPluginRef, RetakePolicy } from "@shared/schema";
import {
  FeedbackEditorModal,
  type FeedbackEditorValue,
} from "./feedback-editor-modal";
import type {
  AdaptiveLevelConfig,
  AdaptiveLinkConfig,
  AdaptiveTopicConfig,
  FeedbackAsset,
  FeedbackContent,
  FeedbackLink,
  FlowMode,
  OverallPassRule,
  OverallPassType,
  PassDecisionPolicy,
  TestEditorModel,
  TopicPassRule,
} from "../test-editor.types";

// ─── Public API ───────────────────────────────────────────────────────────────

export type SettingsSectionProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
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

export function SettingsSection({ model, updateModel }: SettingsSectionProps) {
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
            {item.key === "adaptive" && hasAdaptiveError && (
              <span
                className="tb-status-dot tb-status-dot--err"
                aria-label="Ошибка"
              />
            )}
            {item.key === "adaptive" && hasAdaptiveWarning && (
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
          <BasicPane model={model} updateModel={updateModel} />
        )}
        {effectiveActive === "pass-rules" && (
          <PassRulesPane model={model} updateModel={updateModel} />
        )}
        {effectiveActive === "limits" && (
          <LimitsPane model={model} updateModel={updateModel} />
        )}
        {effectiveActive === "retake" && (
          <RetakePane model={model} updateModel={updateModel} />
        )}
        {effectiveActive === "integration" && (
          <IntegrationPane model={model} updateModel={updateModel} />
        )}
        {effectiveActive === "adaptive" && isAdaptive && (
          <AdaptivePane model={model} updateModel={updateModel} />
        )}
      </div>
    </div>
  );
}

/** Backwards-compatible re-export under the old skeleton name. */
export const BasicSettingsSection = SettingsSection;

// ─── Sub-pane: Основное ───────────────────────────────────────────────────────

function BasicPane({ model, updateModel }: SettingsSectionProps) {
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
          label="Название *"
          value={model.basic.title}
          placeholder="Введите название теста"
          required
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

      <Card variant="outlined" data-testid="settings-feedback-card">
        <CardHeader title="Общая обратная связь теста" />
        <CardBody>
          <TestFeedbackTrigger
            feedback={model.basic.feedback}
            links={model.basic.feedbackLinks}
            assets={model.basic.feedbackAssets}
            onSave={(next) => {
              updateModel((m) => ({
                ...m,
                basic: {
                  ...m.basic,
                  feedback: { format: next.format, text: next.text },
                  feedbackLinks: next.links,
                  feedbackAssets: next.assets,
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
                  runtime: { ...m.runtime, showCorrectAnswers: checked },
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

  function setAllSectionsTo(source: "inherit_test") {
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
            if (!checked) {
              setAllSectionsTo("inherit_test");
            }
            // Switching ON: leave inherit_test rows as-is — the table renders
            // them with empty inputs (placeholder «Без ограничения»). The
            // author opts into a custom limit by typing a positive number.
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
              value={policy.cooldownPeriodDays}
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
    </>
  );
}

// ─── Sub-pane: Интеграция ─────────────────────────────────────────────────────

function IntegrationPane({ model, updateModel }: SettingsSectionProps) {
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

function PassRulesPane({ model, updateModel }: SettingsSectionProps) {
  return (
    <>
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
                    onSourceChange={(source) =>
                      updateModel((m) => ({
                        ...m,
                        passRules: {
                          ...m.passRules,
                          byTopic: {
                            ...m.passRules.byTopic,
                            [section.topicId]: buildTopicRuleBySource(source, rule),
                          },
                        },
                      }))
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
  onSourceChange: (source: TopicPassRule["source"]) => void;
  onCustomTypeChange: (type: "percent" | "absolute") => void;
  onCustomValueChange: (value: number) => void;
}) {
  const isCustom = props.rule.source === "custom";
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
            ]}
            onChange={(value) => props.onSourceChange(value)}
            data-testid={`pass-topic-source-${props.topicId}`}
          />
        </td>
      </tr>
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
): TopicPassRule {
  if (source === "inherit_overall") return { source: "inherit_overall" };
  if (source === "none") return { source: "none" };
  if (prev.source === "custom") return prev;
  return { source: "custom", type: "percent", value: 70 };
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
              leadingIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
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
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
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
  onSave: (next: {
    format: FeedbackContent["format"];
    text: string;
    links: FeedbackLink[];
    assets: FeedbackAsset[];
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const isEmpty =
    props.feedback.text.trim() === "" &&
    props.links.length === 0 &&
    props.assets.length === 0;
  const preview =
    props.feedback.text.trim() !== ""
      ? props.feedback.text.replace(/<[^>]+>/g, "").slice(0, 80)
      : "Не задано - нажмите для редактирования";
  // Compact meta line: «N ссыл..., M PDF» rendered alongside the preview.
  // Pluralisation matches FeedbackEditTrigger for visual consistency.
  const metaParts: string[] = [];
  if (props.links.length > 0) {
    const n = props.links.length;
    const word = n === 1 ? "ка" : n >= 2 && n <= 4 ? "ки" : "ок";
    metaParts.push(`${n} ссыл${word}`);
  }
  if (props.assets.length > 0) {
    metaParts.push(`${props.assets.length} PDF`);
  }

  return (
    <>
      <label className="ou-formfield__lbl">Обратная связь после прохождения</label>
      <button
        type="button"
        className={"tb-feedback-preview" + (isEmpty ? " is-empty" : "")}
        onClick={() => setOpen(true)}
        aria-label="Редактировать обратную связь теста"
        data-testid="settings-feedback-trigger"
      >
        <span className="tb-feedback-preview__text">
          <span className="tb-feedback-preview__snippet">{preview}</span>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        {metaParts.length > 0 && (
          <span className="tb-feedback-preview__meta">
            {metaParts.join(" · ")}
          </span>
        )}
      </button>
      <FeedbackEditorModal
        open={open}
        title="Общая обратная связь теста"
        description="Текст и материалы, которые обучающийся увидит после завершения теста."
        value={{
          format: props.feedback.format,
          text: props.feedback.text,
          links: props.links,
          assets: props.assets,
        }}
        onCancel={() => setOpen(false)}
        onSave={(v: FeedbackEditorValue) => {
          props.onSave({
            format: v.format,
            text: v.text,
            links: v.links,
            assets: v.assets,
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
  const preview =
    props.text.trim() !== ""
      ? props.text.replace(/<[^>]+>/g, "").slice(0, 80)
      : "Не задано — нажмите для редактирования";
  const isEmpty = props.text.trim() === "" && props.links.length === 0;

  return (
    <>
      <label className="ou-formfield__lbl">{props.label}</label>
      <button
        type="button"
        className={
          "tb-feedback-preview" + (isEmpty ? " is-empty" : "")
        }
        onClick={() => setOpen(true)}
        aria-label={props.buttonAriaLabel}
        data-testid={props.testId}
      >
        <span className="tb-feedback-preview__text">
          <span className="tb-feedback-preview__snippet">{preview}</span>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        {(props.links.length > 0) && (
          <span className="tb-feedback-preview__meta">
            {props.links.length} ссыл
            {props.links.length === 1
              ? "ка"
              : props.links.length >= 2 && props.links.length <= 4
                ? "ки"
                : "ок"}
          </span>
        )}
      </button>
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
