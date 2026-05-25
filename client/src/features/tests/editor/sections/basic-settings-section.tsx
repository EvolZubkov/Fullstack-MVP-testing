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
 *   - «Правила прохождения» — banner stub pointing at the next ticket; full
 *                            pass-rules + per-topic rules + decision policy UI
 *                            is significant and ships separately
 *   - «Адаптивный режим»   — banner stub; full adaptive-levels editor ships
 *                            separately
 *
 * Each editable field is bound to the editor draft via `updateModel`. The
 * Drawer is responsible for save / validation / dirty tracking — this
 * section just renders inputs and reports changes.
 */
import { useState } from "react";
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
import type {
  AdaptiveLevelConfig,
  AdaptiveLinkConfig,
  AdaptiveTopicConfig,
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

type RailKey = "basic" | "pass-rules" | "limits" | "integration" | "adaptive";

const RAIL_ITEMS: { key: RailKey; label: string }[] = [
  { key: "basic", label: "Основное" },
  { key: "pass-rules", label: "Правила прохождения" },
  { key: "limits", label: "Ограничения" },
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
  return (
    <>
      <div className="ou-formfield">
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
          onChange={(value) => updateModel((m) => ({ ...m, mode: value }))}
        />
      </div>

      <div className="ou-formfield">
        <Select<FlowMode>
          id="settings-flow-mode"
          size="m"
          fullWidth
          label="Сценарий прохождения"
          value={model.flowMode}
          options={[
            { value: "linear_flat", label: "Линейный" },
            { value: "linear_by_topics", label: "Линейный по темам" },
            { value: "router_by_topics", label: "Маршрутизатор по темам" },
          ]}
          onChange={(value) => updateModel((m) => ({ ...m, flowMode: value }))}
          data-testid="settings-flow-mode"
        />
      </div>
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
    </>
  );
}

// ─── Sub-pane: Интеграция ─────────────────────────────────────────────────────

function IntegrationPane({ model, updateModel }: SettingsSectionProps) {
  return (
    <>
      <div className="ou-formfield">
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

// ─── Sub-panes: stubs for deferred work ───────────────────────────────────────

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
              <div className="ou-formfield">
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
                <th scope="col" className="tb-pass-table__req-col">
                  Обязательная
                </th>
              </tr>
            </thead>
            <tbody>
              {model.sections.map((section, idx) => {
                const rule: TopicPassRule =
                  model.passRules.byTopic[section.topicId] ?? { source: "inherit_overall" };
                return (
                  <PassTopicRow
                    key={section.topicId}
                    topicId={section.topicId}
                    topicName={section.topicName}
                    required={section.required}
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
                    onRequiredToggle={(required) =>
                      updateModel((m) => ({
                        ...m,
                        sections: m.sections.map((s, i) =>
                          i === idx ? { ...s, required } : s,
                        ),
                      }))
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
  required: boolean;
  rule: TopicPassRule;
  onSourceChange: (source: TopicPassRule["source"]) => void;
  onCustomTypeChange: (type: "percent" | "absolute") => void;
  onCustomValueChange: (value: number) => void;
  onRequiredToggle: (required: boolean) => void;
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
        <td className="tb-pass-table__req-col">
          <Switch
            checked={props.required}
            onChange={(e) => {
              const checked = e.target.checked;
              props.onRequiredToggle(checked);
            }}
            aria-label={`Тема обязательная: ${props.topicName}`}
            data-testid={`pass-topic-required-${props.topicId}`}
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
          <td className="tb-pass-table__req-col" />
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

  // Validation per FR-17: an adaptive topic is "valid" when it has at least
  // one level configured. Status-dot color reflects this; subtitle echoes
  // «валидно» / «невалидно».
  const isValid = topic.levels.length >= 1;
  const statusTone: "ok" | "err" = isValid ? "ok" : "err";
  const statusLabel = isValid ? "валидно" : "невалидно";
  const levelsPlural =
    topic.levels.length === 1
      ? "уровень"
      : topic.levels.length >= 2 && topic.levels.length <= 4
        ? "уровня"
        : "уровней";
  const subtitle = `${questionCount} вопросов · ${topic.levels.length} ${levelsPlural} · ${statusLabel}`;

  return (
    <div
      className={"ou-acc__item" + (open ? " is-open" : "")}
      data-testid={`adaptive-topic-${topic.topicId}`}
    >
      <button
        type="button"
        className="ou-acc__trigger tb-adaptive-topics__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open ? "true" : "false"}
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
      {open && (
        <div className="ou-acc__body" data-testid={`adaptive-topic-body-${topic.topicId}`}>
          <div className="ou-formfield">
            <Textarea
              id={`adaptive-topic-failure-${topic.topicId}`}
              size="s"
              fullWidth
              rows={2}
              label="Обратная связь при не пройденном уровне"
              value={topic.failureFeedback ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                props.onFailureFeedbackChange(value);
              }}
              data-testid={`adaptive-topic-failure-${topic.topicId}`}
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
              aria-label={`Удалить уровень ${level.levelName}`}
              data-testid={`${testIdBase}-remove`}
            />
            <button
              type="button"
              className="tb-level-card__chev"
              aria-expanded={collapsed ? "false" : "true"}
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
          <Textarea
            id={`${testIdBase}-feedback`}
            size="s"
            fullWidth
            rows={2}
            label="Обратная связь для уровня"
            value={level.feedback ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              props.onChange({ feedback: value === "" ? null : value });
            }}
            data-testid={`${testIdBase}-feedback`}
          />
        </div>
        <AdaptiveLevelLinks
          testIdBase={testIdBase}
          links={level.links}
          onChange={(links) => props.onChange({ links })}
        />
      </CardBody>
    </Card>
  );
}

function AdaptiveLevelLinks(props: {
  testIdBase: string;
  links: AdaptiveLinkConfig[];
  onChange: (links: AdaptiveLinkConfig[]) => void;
}) {
  return (
    <div className="ou-formfield">
      <label className="ou-formfield__lbl">Ссылки на материалы</label>
      {props.links.map((link, i) => (
        <div
          key={i}
          className="tb-link-row"
          data-testid={`${props.testIdBase}-link-${i}`}
        >
          <input
            className="ou-field__input tb-link-row__label"
            type="text"
            value={link.title}
            placeholder="Название ссылки"
            onChange={(e) => {
              const value = e.target.value;
              const next = [...props.links];
              next[i] = { ...next[i], title: value };
              props.onChange(next);
            }}
            aria-label={`Название ссылки ${i + 1}`}
            data-testid={`${props.testIdBase}-link-${i}-title`}
          />
          <input
            className="ou-field__input tb-link-row__url"
            type="url"
            value={link.url}
            placeholder="https://…"
            onChange={(e) => {
              const value = e.target.value;
              const next = [...props.links];
              next[i] = { ...next[i], url: value };
              props.onChange(next);
            }}
            aria-label={`URL ссылки ${i + 1}`}
            data-testid={`${props.testIdBase}-link-${i}-url`}
          />
          <button
            type="button"
            className="ou-btn ou-btn--ghost ou-btn--s"
            onClick={() => {
              const next = [...props.links];
              next.splice(i, 1);
              props.onChange(next);
            }}
            aria-label={`Удалить ссылку ${i + 1}`}
            data-testid={`${props.testIdBase}-link-${i}-remove`}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ou-btn ou-btn--secondary ou-btn--s"
        onClick={() => props.onChange([...props.links, { title: "", url: "" }])}
        data-testid={`${props.testIdBase}-add-link`}
      >
        + Добавить ссылку
      </button>
    </div>
  );
}
