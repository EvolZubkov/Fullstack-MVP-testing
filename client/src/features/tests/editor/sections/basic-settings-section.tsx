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

  return (
    <div className="ou-drawer__split" data-testid="settings-split">
      <nav className="ou-drawer__rail" aria-label="Подразделы настроек">
        {RAIL_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={
              "ou-drawer__rail-item" + (active === item.key ? " is-active" : "")
            }
            aria-current={active === item.key ? "page" : undefined}
            onClick={() => setActive(item.key)}
            data-testid={`settings-rail-${item.key}`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="tb-settings-content" data-testid={`settings-pane-${active}`}>
        {active === "basic" && <BasicPane model={model} updateModel={updateModel} />}
        {active === "pass-rules" && (
          <PassRulesPane model={model} updateModel={updateModel} />
        )}
        {active === "limits" && <LimitsPane model={model} updateModel={updateModel} />}
        {active === "integration" && (
          <IntegrationPane model={model} updateModel={updateModel} />
        )}
        {active === "adaptive" && (
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
        <label className="ou-formfield__lbl" htmlFor="settings-title">
          Название
          <span className="ou-formfield__lbl-req" aria-hidden="true">*</span>
        </label>
        <div className="ou-field ou-field--m">
          <div className="ou-field__box">
            <input
              className="ou-field__input"
              id="settings-title"
              type="text"
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
        </div>
      </div>

      <div className="ou-formfield">
        <label className="ou-formfield__lbl" htmlFor="settings-description">
          Описание
        </label>
        <div className="ou-textarea ou-textarea--m">
          <div className="ou-textarea__box">
            <textarea
              className="ou-textarea__input"
              id="settings-description"
              rows={3}
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
        </div>
      </div>

      <hr className="wf-sep" />

      <div className="ou-formfield">
        <label className="ou-formfield__lbl">Режим теста</label>
        <div className="ou-seg" role="group" aria-label="Режим теста">
          <button
            type="button"
            className={"ou-seg__item" + (model.mode === "standard" ? " is-active" : "")}
            aria-pressed={model.mode === "standard" ? "true" : "false"}
            onClick={() => updateModel((m) => ({ ...m, mode: "standard" }))}
            data-testid="settings-mode-standard"
          >
            Стандартный
          </button>
          <button
            type="button"
            className={"ou-seg__item" + (model.mode === "adaptive" ? " is-active" : "")}
            aria-pressed={model.mode === "adaptive" ? "true" : "false"}
            onClick={() => updateModel((m) => ({ ...m, mode: "adaptive" }))}
            data-testid="settings-mode-adaptive"
          >
            Адаптивный
          </button>
        </div>
      </div>

      <div className="ou-formfield">
        <label className="ou-formfield__lbl" htmlFor="settings-flow-mode">
          Сценарий прохождения
        </label>
        <select
          id="settings-flow-mode"
          className="ou-field__input"
          value={model.flowMode}
          onChange={(e) => {
            const value = e.target.value as FlowMode;
            updateModel((m) => ({ ...m, flowMode: value }));
          }}
          data-testid="settings-flow-mode"
        >
          <option value="linear_flat">Линейный</option>
          <option value="linear_by_topics">Линейный по темам</option>
          <option value="router_by_topics">Маршрутизатор по темам</option>
        </select>
      </div>
    </>
  );
}

// ─── Sub-pane: Ограничения ────────────────────────────────────────────────────

function LimitsPane({ model, updateModel }: SettingsSectionProps) {
  return (
    <>
      <div className="ou-formfield">
        <label className="ou-formfield__lbl" htmlFor="settings-time-limit">
          Ограничение времени, минут
        </label>
        <div className="ou-field ou-field--m">
          <div className="ou-field__box">
            <input
              className="ou-field__input"
              id="settings-time-limit"
              type="number"
              min={1}
              value={model.runtime.timeLimitMinutes ?? ""}
              placeholder="Без ограничения"
              onChange={(e) => {
                const raw = e.target.value;
                const next = raw === "" ? null : Math.max(1, Number(raw) || 1);
                updateModel((m) => ({
                  ...m,
                  runtime: { ...m.runtime, timeLimitMinutes: next },
                }));
              }}
              data-testid="settings-time-limit-input"
            />
          </div>
        </div>
      </div>

      <div className="ou-formfield">
        <label className="ou-formfield__lbl" htmlFor="settings-max-attempts">
          Максимум попыток
        </label>
        <div className="ou-field ou-field--m">
          <div className="ou-field__box">
            <input
              className="ou-field__input"
              id="settings-max-attempts"
              type="number"
              min={1}
              value={model.runtime.maxAttempts ?? ""}
              placeholder="Не ограничено"
              onChange={(e) => {
                const raw = e.target.value;
                const next = raw === "" ? null : Math.max(1, Number(raw) || 1);
                updateModel((m) => ({
                  ...m,
                  runtime: { ...m.runtime, maxAttempts: next },
                }));
              }}
              data-testid="settings-max-attempts-input"
            />
          </div>
        </div>
      </div>

      <div className="ou-formfield">
        <label className="ou-formfield__lbl">
          <input
            type="checkbox"
            checked={model.runtime.showCorrectAnswers}
            onChange={(e) => {
              const checked = e.target.checked;
              updateModel((m) => ({
                ...m,
                runtime: { ...m.runtime, showCorrectAnswers: checked },
              }));
            }}
            data-testid="settings-show-correct-checkbox"
          />{" "}
          Показывать правильные ответы после прохождения
        </label>
      </div>
    </>
  );
}

// ─── Sub-pane: Интеграция ─────────────────────────────────────────────────────

function IntegrationPane({ model, updateModel }: SettingsSectionProps) {
  return (
    <>
      <div className="ou-formfield">
        <label className="ou-formfield__lbl" htmlFor="settings-webhook">
          Webhook URL
        </label>
        <div className="ou-field ou-field--m">
          <div className="ou-field__box">
            <input
              className="ou-field__input"
              id="settings-webhook"
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
        </div>
      </div>

      <div className="ou-formfield">
        <label className="ou-formfield__lbl">
          <input
            type="checkbox"
            checked={model.basic.telemetryEnabled}
            onChange={(e) => {
              const checked = e.target.checked;
              updateModel((m) => ({
                ...m,
                basic: { ...m.basic, telemetryEnabled: checked },
              }));
            }}
            data-testid="settings-telemetry-checkbox"
          />{" "}
          Отправлять телеметрию о прохождении
        </label>
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
      <section
        className="ou-card ou-card--outlined ou-card--sm tb-pass-card"
        data-testid="settings-pass-rules-card"
      >
        <header className="ou-card__header">
          <h3 className="ou-card__title">Тест пройден, если:</h3>
        </header>
        <div className="ou-card__body">
          <fieldset className="ou-radio-group ou-radio-group--vertical">
            <div className="ou-radio-group__items">
              {DECISION_POLICIES.map((policy) => {
                const checked = model.passRules.decisionPolicy === policy.value;
                return (
                  <label key={policy.value} className="ou-radio-field">
                    <span className={"ou-radio ou-radio--m" + (checked ? " is-on" : "")}>
                      <input
                        type="radio"
                        name="pass-decision-policy"
                        className="ou-radio__input"
                        checked={checked}
                        onChange={() =>
                          updateModel((m) => ({
                            ...m,
                            passRules: {
                              ...m.passRules,
                              decisionPolicy: policy.value,
                            },
                          }))
                        }
                        data-testid={`pass-policy-${policy.value}`}
                      />
                      <span className="ou-radio__ring">
                        <span className="ou-radio__dot" />
                      </span>
                    </span>
                    <span className="ou-radio-field__text">
                      <span className="ou-radio-field__label">{policy.label}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <hr className="wf-sep" />

          <div className="tb-pass-overall">
            <div className="ou-formfield">
              <label className="ou-formfield__lbl" htmlFor="pass-overall-type">
                Тип общего правила
              </label>
              <select
                id="pass-overall-type"
                className="ou-field__input"
                value={model.passRules.overall.type}
                onChange={(e) => {
                  const value = e.target.value as OverallPassType;
                  updateModel((m) => ({
                    ...m,
                    passRules: {
                      ...m.passRules,
                      overall: buildOverallByType(value, m.passRules.overall),
                    },
                  }));
                }}
                data-testid="pass-overall-type"
              >
                <option value="percent">Процент правильных ответов</option>
                <option value="absolute">Сумма баллов</option>
                <option value="none">Не задано</option>
              </select>
            </div>
            {model.passRules.overall.type !== "none" && (
              <div className="ou-formfield">
                <label className="ou-formfield__lbl" htmlFor="pass-overall-value">
                  Порог
                  {model.passRules.overall.type === "percent" ? " (%)" : " (баллы)"}
                </label>
                <div className="ou-field ou-field--m">
                  <div className="ou-field__box">
                    <input
                      id="pass-overall-value"
                      className="ou-field__input"
                      type="number"
                      min={0}
                      max={model.passRules.overall.type === "percent" ? 100 : undefined}
                      value={model.passRules.overall.value}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const next = Number.isFinite(raw) ? Math.max(0, raw) : 0;
                        updateModel((m) => ({
                          ...m,
                          passRules: {
                            ...m.passRules,
                            overall: { ...m.passRules.overall, value: next },
                          },
                        }));
                      }}
                      data-testid="pass-overall-value"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

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
          <select
            className="ou-field__input"
            value={props.rule.source}
            onChange={(e) => {
              const value = e.target.value as TopicPassRule["source"];
              props.onSourceChange(value);
            }}
            aria-label={`Правило прохождения темы ${props.topicName}`}
            data-testid={`pass-topic-source-${props.topicId}`}
          >
            <option value="inherit_overall">Как у теста</option>
            <option value="custom">Индивидуальное правило</option>
            <option value="none">Не проверять отдельно</option>
          </select>
        </td>
        <td className="tb-pass-table__req-col">
          <label>
            <input
              type="checkbox"
              checked={props.required}
              onChange={(e) => {
                const checked = e.target.checked;
                props.onRequiredToggle(checked);
              }}
              aria-label={`Тема обязательная: ${props.topicName}`}
              data-testid={`pass-topic-required-${props.topicId}`}
            />
          </label>
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
                <label className="ou-formfield__lbl">Тип</label>
                <select
                  className="ou-field__input"
                  value={props.rule.type}
                  onChange={(e) => {
                    const value = e.target.value as "percent" | "absolute";
                    props.onCustomTypeChange(value);
                  }}
                  aria-label={`Тип индивидуального правила темы ${props.topicName}`}
                  data-testid={`pass-topic-custom-type-${props.topicId}`}
                >
                  <option value="percent">Процент</option>
                  <option value="absolute">Сумма баллов</option>
                </select>
              </div>
              <div className="ou-formfield">
                <label className="ou-formfield__lbl">Порог</label>
                <div className="ou-field ou-field--s">
                  <div className="ou-field__box">
                    <input
                      className="ou-field__input"
                      type="number"
                      min={0}
                      max={props.rule.type === "percent" ? 100 : undefined}
                      value={props.rule.value}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const next = Number.isFinite(raw) ? Math.max(0, raw) : 0;
                        props.onCustomValueChange(next);
                      }}
                      aria-label={`Значение порога темы ${props.topicName}`}
                      data-testid={`pass-topic-custom-value-${props.topicId}`}
                    />
                  </div>
                </div>
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
  const isAdaptive = model.mode === "adaptive";

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
      {!isAdaptive && (
        <div
          className="ou-banner ou-banner--warning"
          role="status"
          data-testid="adaptive-mode-warning"
        >
          <div className="ou-banner__body">
            <div className="ou-banner__title">
              Сейчас режим теста — стандартный
            </div>
            <div className="ou-banner__desc">
              Настройки ниже будут применены только если в подразделе «Основное»
              переключить режим теста на «Адаптивный». Сейчас они сохраняются
              как draft, но не используются runtime'ом (FR-25h, FR-25i).
            </div>
          </div>
        </div>
      )}

      <div className="ou-formfield">
        <label className="ou-switch-field">
          <input
            type="checkbox"
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
          />{" "}
          Показывать уровень сложности при прохождении
        </label>
      </div>

      <hr className="wf-sep" />

      <h3 className="tb-topics-title">Адаптивность по темам</h3>

      {model.sections.length === 0 ? (
        <div
          className="ou-banner ou-banner--info"
          role="status"
          data-testid="adaptive-no-topics"
        >
          <div className="ou-banner__body">
            <div className="ou-banner__title">Сначала добавьте темы</div>
            <div className="ou-banner__desc">
              Адаптивность настраивается по темам теста. Перейдите во вкладку
              «Состав» и добавьте темы — после этого здесь появится список для
              настройки уровней.
            </div>
          </div>
        </div>
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
  onToggleEnabled: (enabled: boolean) => void;
  onFailureFeedbackChange: (text: string) => void;
  onAddLevel: () => void;
  onLevelChange: (levelIndex: number, patch: Partial<AdaptiveLevelConfig>) => void;
  onLevelRemove: (levelIndex: number) => void;
}) {
  const { topic } = props;
  const [open, setOpen] = useState(false);
  const subtitle = `${topic.levels.length} уровн${
    topic.levels.length === 1 ? "ь" : topic.levels.length >= 2 && topic.levels.length <= 4 ? "я" : "ей"
  } · ${topic.enabled ? "включено" : "выключено"}`;

  return (
    <div
      className={"ou-acc__item" + (open ? " is-open" : "")}
      data-testid={`adaptive-topic-${topic.topicId}`}
    >
      <div className="ou-acc__head tb-adaptive-topics__head">
        <button
          type="button"
          className="ou-acc__trigger tb-adaptive-topics__trigger"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid={`adaptive-topic-toggle-${topic.topicId}`}
        >
          <span className="ou-acc__trigger-text">
            <span className="ou-acc__title">{topic.topicName}</span>
            <span className="ou-acc__subtitle">{subtitle}</span>
          </span>
        </button>
        <label className="tb-adaptive-topics__toggle">
          <input
            type="checkbox"
            checked={topic.enabled}
            onChange={(e) => {
              const checked = e.target.checked;
              props.onToggleEnabled(checked);
            }}
            aria-label={`Адаптивность включена для темы ${topic.topicName}`}
            data-testid={`adaptive-topic-enabled-${topic.topicId}`}
          />
        </label>
      </div>
      {open && (
        <div className="ou-acc__body" data-testid={`adaptive-topic-body-${topic.topicId}`}>
          <div className="ou-formfield">
            <label
              className="ou-formfield__lbl"
              htmlFor={`adaptive-topic-failure-${topic.topicId}`}
            >
              Обратная связь при не пройденном уровне
            </label>
            <div className="ou-textarea ou-textarea--s">
              <div className="ou-textarea__box">
                <textarea
                  id={`adaptive-topic-failure-${topic.topicId}`}
                  className="ou-textarea__input"
                  rows={2}
                  value={topic.failureFeedback ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    props.onFailureFeedbackChange(value);
                  }}
                  data-testid={`adaptive-topic-failure-${topic.topicId}`}
                />
              </div>
            </div>
          </div>

          <div className="tb-adaptive-section">
            <div className="tb-adaptive-section__head">
              <h4 className="tb-adaptive-section__title">Уровни сложности</h4>
              <div className="tb-adaptive-section__actions">
                <button
                  type="button"
                  className="ou-btn ou-btn--secondary ou-btn--s"
                  onClick={props.onAddLevel}
                  data-testid={`adaptive-add-level-${topic.topicId}`}
                >
                  + Добавить уровень
                </button>
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
  const testIdBase = `adaptive-level-${props.topicId}-${level.levelIndex}`;

  return (
    <section
      className="ou-card ou-card--outlined ou-card--sm tb-level-card"
      data-testid={testIdBase}
    >
      <header className="ou-card__header tb-level-card__head">
        <div className="ou-card__heading tb-level-card__heading">
          <h5 className="ou-card__title tb-level-card__title">{level.levelName}</h5>
          <p className="ou-card__subtitle tb-level-card__summary">
            {level.minDifficulty}–{level.maxDifficulty} · {level.questionsCount} вопросов · {level.passThreshold}
            {level.passThresholdType === "percent" ? " %" : " б."}
          </p>
        </div>
        <div className="ou-card__trail tb-level-card__trail">
          <button
            type="button"
            className="ou-btn ou-btn--ghost ou-btn--s tb-level-card__del"
            onClick={props.onRemove}
            aria-label={`Удалить уровень ${level.levelName}`}
            data-testid={`${testIdBase}-remove`}
          >
            ×
          </button>
        </div>
      </header>
      <div className="ou-card__body tb-level-card__body">
        <div className="tb-level-grid">
          <div className="ou-formfield">
            <label className="ou-formfield__lbl" htmlFor={`${testIdBase}-name`}>
              Название
            </label>
            <div className="ou-field ou-field--s ou-field--full">
              <div className="ou-field__box">
                <input
                  id={`${testIdBase}-name`}
                  className="ou-field__input"
                  type="text"
                  value={level.levelName}
                  onChange={(e) => {
                    const value = e.target.value;
                    props.onChange({ levelName: value });
                  }}
                  data-testid={`${testIdBase}-name`}
                />
              </div>
            </div>
          </div>
          <div className="ou-formfield">
            <label className="ou-formfield__lbl" htmlFor={`${testIdBase}-min`}>
              Сложность от
            </label>
            <div className="ou-field ou-field--s">
              <div className="ou-field__box">
                <input
                  id={`${testIdBase}-min`}
                  className="ou-field__input"
                  type="number"
                  min={0}
                  max={100}
                  value={level.minDifficulty}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const value = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
                    props.onChange({ minDifficulty: value });
                  }}
                  data-testid={`${testIdBase}-min`}
                />
              </div>
            </div>
          </div>
          <div className="ou-formfield">
            <label className="ou-formfield__lbl" htmlFor={`${testIdBase}-max`}>
              до
            </label>
            <div className="ou-field ou-field--s">
              <div className="ou-field__box">
                <input
                  id={`${testIdBase}-max`}
                  className="ou-field__input"
                  type="number"
                  min={0}
                  max={100}
                  value={level.maxDifficulty}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const value = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
                    props.onChange({ maxDifficulty: value });
                  }}
                  data-testid={`${testIdBase}-max`}
                />
              </div>
            </div>
          </div>
          <div className="ou-formfield">
            <label className="ou-formfield__lbl" htmlFor={`${testIdBase}-questions`}>
              Вопросов
            </label>
            <div className="ou-field ou-field--s">
              <div className="ou-field__box">
                <input
                  id={`${testIdBase}-questions`}
                  className="ou-field__input"
                  type="number"
                  min={1}
                  value={level.questionsCount}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const value = Number.isFinite(raw) ? Math.max(1, raw) : 1;
                    props.onChange({ questionsCount: value });
                  }}
                  data-testid={`${testIdBase}-questions`}
                />
              </div>
            </div>
          </div>
          <div className="ou-formfield">
            <label
              className="ou-formfield__lbl"
              htmlFor={`${testIdBase}-threshold-type`}
            >
              Тип порога
            </label>
            <select
              id={`${testIdBase}-threshold-type`}
              className="ou-field__input"
              value={level.passThresholdType}
              onChange={(e) => {
                const value = e.target.value as "percent" | "absolute";
                props.onChange({ passThresholdType: value });
              }}
              data-testid={`${testIdBase}-threshold-type`}
            >
              <option value="percent">Процент</option>
              <option value="absolute">Сумма баллов</option>
            </select>
          </div>
          <div className="ou-formfield">
            <label className="ou-formfield__lbl" htmlFor={`${testIdBase}-threshold`}>
              Порог
            </label>
            <div className="ou-field ou-field--s">
              <div className="ou-field__box">
                <input
                  id={`${testIdBase}-threshold`}
                  className="ou-field__input"
                  type="number"
                  min={0}
                  max={level.passThresholdType === "percent" ? 100 : level.questionsCount}
                  value={level.passThreshold}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;
                    props.onChange({ passThreshold: value });
                  }}
                  data-testid={`${testIdBase}-threshold`}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="ou-formfield">
          <label className="ou-formfield__lbl" htmlFor={`${testIdBase}-feedback`}>
            Обратная связь для уровня
          </label>
          <div className="ou-textarea ou-textarea--s">
            <div className="ou-textarea__box">
              <textarea
                id={`${testIdBase}-feedback`}
                className="ou-textarea__input"
                rows={2}
                value={level.feedback ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  props.onChange({ feedback: value === "" ? null : value });
                }}
                data-testid={`${testIdBase}-feedback`}
              />
            </div>
          </div>
        </div>
        <AdaptiveLevelLinks
          testIdBase={testIdBase}
          links={level.links}
          onChange={(links) => props.onChange({ links })}
        />
      </div>
    </section>
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
