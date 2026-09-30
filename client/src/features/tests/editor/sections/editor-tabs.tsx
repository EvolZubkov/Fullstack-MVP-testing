/**
 * @module features/tests/editor/sections/editor-tabs
 * @description Вкладки редактора теста после перестройки ящика (план
 * «перестройка настроек редактора теста», Э3.2-Э3.6).
 *
 * До перестройки ящик резал настройки по происхождению («Настройки», «Оформление»,
 * «Структура», «Шкалы», «Показатели»), и один вопрос автора расходился по трём местам.
 * Теперь вкладка отвечает на ОДИН вопрос — что это за тест, из чего он собран, по каким
 * правилам идёт, как оценивается, что видит участник, как это выглядит, — а рейл внутри
 * вкладки делит этот вопрос на подтемы.
 *
 * Каждая вкладка здесь — тонкая: она объявляет пункты рейла, считает точки состояния и
 * зовёт уже существующие панели. Сами панели живут там, где жили: логика не переезжала,
 * переехали только адреса.
 */
import type * as React from "react";
import { Banner, FormSection } from "@skillum/ui-kit";
import type { FieldErrorIndex } from "../field-errors";
import type { TestEditorModel } from "../test-editor.types";
import type { UseDesignSettingsResult } from "../use-design-settings";
import type { UseContentPagesResult } from "../use-content-pages";
import {
  TabRail, useRailState, type RailDot, type RailEntry, type RailItem,
} from "./tab-rail";
import {
  AdaptivePane,
  BreakdownDisplayPane,
  DuringRunPane,
  DuringTestPane,
  FeedbackTextsPane,
  IntegrationPane,
  LimitsPane,
  MainPane,
  NavigationPane,
  ProtectionPane,
  ReportContentPane,
  ScenarioSettingsPane,
  VerdictPane,
} from "./basic-settings-section";
import { CompositionSection } from "./topics-structure-section";
import { StructureSection } from "./start-pages-section";
import { ScoringSection } from "./scoring-section";
import { ScalesSection } from "./scales-section";
import { ResultVariablesSection } from "./result-variables-section";
import { ResultsBlockOrderPane, ResultsLabelsPane } from "./results-labels-pane";
import { SectionPane } from "./design-section";
import { BreakdownFeedbackCard } from "./breakdown-feedback-card";
import { ProfileFeedbackCard, profileVariables } from "./profile-feedback-card";
import { TopicFeedbackCard } from "./topic-feedback-card";
import { LevelFeedbackCard } from "./level-feedback-card";
import { BandFeedbackSection, hasAnyBands } from "./band-feedback-section";
import { QuestionFeedbackRegistry } from "./question-feedback-registry";
import { TestQuestionsSection } from "../questions/test-questions-section";
import { templateBlockOrder } from "@shared/template/results-order";

/** Общий набор props вкладки: черновик, мутатор и ошибки полей. */
export type EditorTabProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
  fieldErrors?: FieldErrorIndex;
  /**
   * Худший уровень проблемы по адресу поля — для точки на пункте рейла. Точка
   * показывает ХУДШИЙ уровень внутри подраздела, а `fieldErrors` знает только ошибки:
   * предупреждения в него не кладутся, чтобы не красить поле красным из-за замечания.
   */
  issueLevel?: (field: string) => "error" | "warning" | undefined;
};

/** Точка пункта рейла по адресу его содержимого. */
function railDot(
  issueLevel: EditorTabProps["issueLevel"],
  ...fields: string[]
): RailDot | undefined {
  if (!issueLevel) return undefined;
  let worst: RailDot | undefined;
  for (const field of fields) {
    const level = issueLevel(field);
    if (level === "error") return "error";
    if (level === "warning") worst = "warning";
  }
  return worst;
}

// ─── «Основное» ───────────────────────────────────────────────────────────────

/**
 * Что это за тест: название, описание, режим и интеграция. Рейла нет — полей мало, и
 * лишний столбец только отодвигал бы их от края (эскиз `wf-basic`).
 */
export function MainTab({ model, updateModel, fieldErrors, issueLevel }: EditorTabProps): React.JSX.Element {
  return (
    <div className="tb-settings-content" data-testid="settings-pane-main">
      <MainPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
      <IntegrationPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
    </div>
  );
}

// ─── «Состав и сценарий» ──────────────────────────────────────────────────────

/** Пункт темы в группе «Вопросы теста»: ключ несёт идентификатор темы. */
type QuestionsRail = `questions:${string}`;

type CompositionRail = "composition" | "adaptive" | "scenario" | QuestionsRail;

const QUESTIONS_PREFIX = "questions:";

/**
 * Из чего собран тест и как он идёт: темы с выборкой и вариантами, вопросы каждой темы,
 * лестница уровней адаптивного теста и полотно сценария. «Адаптивные уровни» показываются
 * только адаптивному тесту — у стандартного лестницы нет.
 */
export function CompositionTab({
  model,
  updateModel,
  fieldErrors,
  issueLevel,
  testId,
  content,
  savedFlowMode,
  designDraft,
  onOpenQuestion,
  onCreateQuestion,
}: EditorTabProps & {
  testId?: string;
  content?: UseContentPagesResult;
  savedFlowMode: string | null;
  designDraft?: UseDesignSettingsResult["draft"];
  /** Открыть вопрос в ящике вопроса. Ящик монтирует хозяин вкладки. */
  onOpenQuestion?: (questionId: string) => void;
  /** Открыть ящик нового вопроса с заданной темой. */
  onCreateQuestion?: (topicId: string) => void;
}): React.JSX.Element {
  const isAdaptive = model.mode === "adaptive";
  // Стоп-фактор адаптивного теста: ни одна тема не включена (лестницы нет вообще).
  const adaptiveError =
    isAdaptive && model.sections.length > 0 && !model.adaptive.topics.some((t) => t.enabled);
  // Замечание: у включённой темы меньше двух уровней — адаптироваться не между чем.
  const adaptiveWarning =
    isAdaptive &&
    !adaptiveError &&
    model.sections.some((section) => {
      const topic = model.adaptive.topics.find((t) => t.topicId === section.topicId);
      return topic?.enabled && topic.levels.length < 2;
    });
  const items: RailEntry<CompositionRail>[] = [
    {
      key: "composition",
      label: "Состав",
      dot: railDot(issueLevel, "sections"),
    },
    // Решение владельца 2026-10-01: вопросы — отдельная группа рейла, темы — её пункты.
    // Группа прячется, пока тем нет: перечислять нечего, а темы добавляются в «Составе».
    ...(model.sections.length > 0
      ? [
          {
            label: "Вопросы теста",
            items: model.sections.map((section, i) => ({
              key: `${QUESTIONS_PREFIX}${section.topicId}` as QuestionsRail,
              label: `${i + 1}. ${section.topicName}`,
            })),
          },
        ]
      : []),
    ...(isAdaptive
      ? [
          {
            key: "adaptive" as const,
            label: "Адаптивные уровни",
            // Ошибка лестницы известна вкладке напрямую (её нет в модели), поэтому
            // она складывается с общим уровнем, а не подменяет его.
            dot: (adaptiveError
              ? "error"
              : railDot(issueLevel, "adaptive") ?? (adaptiveWarning ? "warning" : undefined)
            ) as RailItem<CompositionRail>["dot"],
          } as RailItem<CompositionRail>,
        ]
      : []),
    {
      key: "scenario",
      label: "Сценарий",
      dot: railDot(issueLevel, "flowMode"),
    },
  ];
  const [active, setActive] = useRailState<CompositionRail>(items, "composition");
  return (
    <TabRail
      items={items}
      active={active}
      onChange={setActive}
      ariaLabel="Подразделы состава и сценария"
      testIdPrefix="composition"
    >
      {active === "composition" && (
        <CompositionSection model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
      )}
      {active.startsWith(QUESTIONS_PREFIX) && (
        <TestQuestionsSection
          // Своя панель на тему: поиск одной темы не переносится в другую.
          key={active}
          model={model}
          topicId={active.slice(QUESTIONS_PREFIX.length)}
          testId={testId}
          onOpenQuestion={onOpenQuestion}
          onCreateQuestion={onCreateQuestion}
        />
      )}
      {active === "adaptive" && (
        <AdaptivePane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
      )}
      {active === "scenario" && (
        <>
          <ScenarioSettingsPane
            model={model}
            updateModel={updateModel}
            fieldErrors={fieldErrors}
          />
          <StructureSection
            model={model}
            testId={testId}
            content={content}
            savedFlowMode={savedFlowMode as never}
            updateModel={updateModel}
            designDraft={designDraft}
          />
        </>
      )}
    </TabRail>
  );
}

// ─── «Правила прохождения» ────────────────────────────────────────────────────

type RulesRail = "navigation" | "during" | "limits" | "protection";

const RULES_ITEMS: { key: RulesRail; label: string }[] = [
  { key: "navigation", label: "Навигация" },
  { key: "during", label: "Во время прохождения" },
  { key: "limits", label: "Ограничения" },
  { key: "protection", label: "Защита контента" },
];

/**
 * По каким правилам участник проходит тест: как ходит, что видит на экране вопроса,
 * чем ограничен и как защищено задание.
 */
export function RulesTab({
  model,
  updateModel,
  fieldErrors,
  issueLevel,
  design,
}: EditorTabProps & { design?: UseDesignSettingsResult }): React.JSX.Element {
  const [active, setActive] = useRailState<RulesRail>(RULES_ITEMS, "navigation");
  return (
    <TabRail
      items={RULES_ITEMS}
      active={active}
      onChange={setActive}
      ariaLabel="Подразделы правил прохождения"
      testIdPrefix="rules"
    >
      {active === "navigation" && <NavigationPane model={model} updateModel={updateModel} />}
      {active === "during" && (
        // Э5.7: заголовок группы называет не момент («по ходу»), а предмет — что именно
        // участник видит на экране вопроса, пока идёт тест.
        <FormSection title="Что видит ученик во время прохождения теста" stacked>
          {/* Прогресс и шапка объявлены МАНИФЕСТОМ шаблона, поэтому рисует их тот же
              механизм, что и в «Оформлении»; сюда параметры переехали адресом, а не
              переписыванием (решение 18). */}
          {design && !design.templateMissing && (
            <SectionPane
              design={design}
              section="progress"
              emptyTitle="В шаблоне нет настроек прогресса"
              emptyDesc={`У выбранного шаблона «${design.template?.manifest.name ?? ""}» не объявлено ни одного параметра прогресса.`}
              testId="rules-progress-pane"
            />
          )}
          <DuringRunPane model={model} updateModel={updateModel} />
        </FormSection>
      )}
      {active === "limits" && (
        <LimitsPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
      )}
      {active === "protection" && <ProtectionPane model={model} updateModel={updateModel} />}
    </TabRail>
  );
}

// ─── «Оценка результата» ──────────────────────────────────────────────────────

type ScoringRail = "answer" | "verdict" | "scales-list" | "scales-contrib" | "metrics";

/**
 * Как считается результат: цена ответа, вердикт теста и тем, шкалы и показатели. Четыре
 * разговора об одном — сколько получилось и что это значит, — прежде разнесённые по трём
 * вкладкам и хвосту «Правил прохождения».
 */
export function ScoringTab({
  model,
  updateModel,
  fieldErrors,
  issueLevel,
  testId,
}: EditorTabProps & { testId?: string }): React.JSX.Element {
  // «Шкалы» — не один экран, а два: сами шкалы и матрица вкладов. Прежде они шли
  // одной колонкой друг под другом, и матрица — самое широкое место ящика, её ширина
  // растёт с каждой шкалой — делила панель с карточками шкал (эскиз ds-rail-nested).
  const hasScales = model.scales.length > 0;
  const scalesDot = railDot(issueLevel, "scales");
  const items: RailEntry<ScoringRail>[] = [
    {
      key: "answer",
      label: "Оценка ответа",
      dot: railDot(issueLevel, "scoring"),
    },
    {
      key: "verdict",
      label: "Вердикт",
      dot: railDot(issueLevel, "passRules"),
    },
    {
      label: "Шкалы",
      items: [
        { key: "scales-list", label: "Список шкал", dot: scalesDot },
        {
          key: "scales-contrib",
          label: "Вклады вопросов",
          // Вносить вклад не во что, пока нет ни одной шкалы. Пункт остаётся
          // видимым: исчезнувший читался бы как «такой настройки нет».
          disabled: !hasScales,
          disabledHint: hasScales ? undefined : "Появятся, когда будет хотя бы одна шкала.",
        },
      ],
    },
    {
      key: "metrics",
      label: "Показатели",
      dot: railDot(issueLevel, "resultVariables"),
    },
  ];
  const [active, setActive] = useRailState<ScoringRail>(items, "answer");
  return (
    <TabRail
      items={items}
      active={active}
      onChange={setActive}
      ariaLabel="Подразделы оценки результата"
      testIdPrefix="scoring"
    >
      {active === "answer" && (
        <ScoringSection model={model} testId={testId} updateModel={updateModel} />
      )}
      {active === "verdict" && (
        <VerdictPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
      )}
      {(active === "scales-list" || active === "scales-contrib") && (
        <ScalesSection
          pane={active === "scales-contrib" ? "contributions" : "list"}
          model={model}
          testId={testId}
          updateModel={updateModel}
          fieldErrors={fieldErrors}
        />
      )}
      {active === "metrics" && (
        <ResultVariablesSection
          model={model}
          testId={testId}
          updateModel={updateModel}
          fieldErrors={fieldErrors}
        />
      )}
    </TabRail>
  );
}

// ─── «Обратная связь и итоги» ─────────────────────────────────────────────────

type FeedbackRail =
  | "during"
  | "results"
  | "texts"
  | "topics"
  | "profiles"
  | "scale-levels"
  | "difficulty-levels"
  | "metric-levels"
  | "report";

/**
 * Что участник узнаёт о своём результате: по ходу теста, на экране итогов, в текстах
 * обратной связи и в документе отчёта. Состав и слова живут здесь, облик — в «Оформлении»
 * (решение 18).
 */
export function FeedbackTab({
  model,
  updateModel,
  fieldErrors,
  issueLevel,
  design,
  onOpenQuestion,
}: EditorTabProps & {
  design?: UseDesignSettingsResult;
  /** Э2.4: открыть редактор вопроса из реестра. Ящик вопроса монтирует хозяин вкладки. */
  onOpenQuestion?: (questionId: string) => void;
}): React.JSX.Element {
  // Решение владельца 2026-09-07: «Обратная связь» — не один экран, а группа. Тексты
  // уровней перечисляются отдельно от текстов теста и тем, как в эскизе (`s-texts`).
  //
  // Дочерний пункт ПРЯЧЕТСЯ, когда перечислять нечего: раздел из одних тегов «уровни не
  // заданы» сообщал бы о настройке, которой автор ещё не делал, а у стандартного теста
  // лестницы сложности нет вовсе. Это единственное место рейла с таким правилом: у
  // «Вкладов вопросов» пункт остаётся видимым и погашенным, потому что там настройка
  // ЕСТЬ и лишь ждёт первой шкалы.
  const items: RailEntry<FeedbackRail>[] = [
    { key: "during", label: "Во время теста" },
    { key: "results", label: "Состав итогов" },
    {
      label: "Обратная связь",
      items: [
        { key: "texts", label: "Общее" },
        ...(model.sections.length > 0
          ? [{ key: "topics" as const, label: "По темам" }]
          : []),
        // PRD-53 §5.4: рекомендации профилей. Пункт прячется по тому же правилу, что и
        // соседи: без показателя-профиля перечислять нечего.
        ...(profileVariables(model).length > 0
          ? [{ key: "profiles" as const, label: "По профилям" }]
          : []),
        ...(hasAnyBands(model, "scales")
          ? [{ key: "scale-levels" as const, label: "По уровням шкал" }]
          : []),
        ...(model.mode === "adaptive"
          ? [{ key: "difficulty-levels" as const, label: "По уровням сложности" }]
          : []),
        ...(hasAnyBands(model, "metrics")
          ? [{ key: "metric-levels" as const, label: "По уровням показателей" }]
          : []),
      ],
    },
    { key: "report", label: "Отчёт" },
  ];
  const [active, setActive] = useRailState<FeedbackRail>(items, "during");
  return (
    <TabRail
      items={items}
      active={active}
      onChange={setActive}
      ariaLabel="Подразделы обратной связи и итогов"
      testIdPrefix="feedback"
    >
      {active === "during" && (
        <>
          <DuringTestPane model={model} updateModel={updateModel} />
          {/* Э2.4: что уже написано у вопросов этого теста. Только чтение: обратная связь
              принадлежит ВОПРОСУ, тот же вопрос стоит и в других тестах. */}
          <QuestionFeedbackRegistry model={model} onOpenQuestion={onOpenQuestion} />
        </>
      )}
      {/* Порядок разделов — как в эскизе: сначала ЧТО и в каком порядке печатается,
          затем подытоги, и только потом формулировки надписей. */}
      {active === "results" && (
        <>
          {design && !design.templateMissing && (
            <ResultsBlockOrderPane
              order={design.draft.resultsBlockOrder}
              // Состав и порядок объявляет ШАБЛОН, и берётся объявление ЭКРАНА ИТОГОВ:
              // настройка одна на все экраны, а адаптивные итоги, например, сводки
              // баллов не печатают вовсе.
              templateOrder={templateBlockOrder(
                design.template?.manifest.resultsBlockOrder,
                "results",
              )}
              labels={design.draft.labels ?? {}}
              declarations={design.template?.manifest.labels ?? []}
              readOnly={false}
              onChange={design.setResultsBlockOrder}
            />
          )}
          <BreakdownDisplayPane model={model} updateModel={updateModel} />
          {design && !design.templateMissing && (
            <ResultsLabelsPane
              declarations={design.template?.manifest.labels ?? []}
              labels={design.draft.labels ?? {}}
              onChange={design.setLabels}
            />
          )}
          {design?.templateMissing && (
            <Banner
              tone="warning"
              title="Шаблон недоступен"
              description="Надписи и порядок подблоков объявляет шаблон. Выберите шаблон во вкладке «Оформление» — после этого здесь появятся его надписи."
              data-testid="feedback-labels-no-template"
            />
          )}
        </>
      )}
      {/* «Общее» — только тексты теста целиком: вводный и общий. Разборы по темам и по
          уровням стоят своими пунктами: их пишут не в один присест с общим текстом. */}
      {active === "texts" && (
        <FeedbackTextsPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
      )}
      {/* PRD-29 §7.1a: тексты тем — РАЗРЕШЁННЫЕ, по одному на тему. Правились они в
          «Составе», среди выборки и квот, где автор искал их последними.
          PRD-50 FR-50: тексты подтем идут следом, а не отдельным пунктом: подтема —
          разрез ТЕМЫ, и её текст автор пишет, дописав текст самой темы. */}
      {active === "topics" && (
        <>
          <TopicFeedbackCard model={model} updateModel={updateModel} />
          <BreakdownFeedbackCard model={model} updateModel={updateModel} />
        </>
      )}
      {/* PRD-53 §5.4: рекомендации исходов профиля. Толкование остаётся в самом
          показателе — это часть определения исхода; сюда вынесено то, что участнику
          с профилем делать, и лежит оно рядом с остальной обратной связью теста. */}
      {active === "profiles" && <ProfileFeedbackCard model={model} updateModel={updateModel} />}
      {/* Тексты уровней — те же поля, что правит конструктор уровней в «Оценке
          результата»; здесь они собраны в колонку, чтобы писать их подряд. */}
      {active === "scale-levels" && (
        <BandFeedbackSection kind="scales" model={model} updateModel={updateModel} />
      )}
      {/* Э2.5: тексты адаптивных уровней. Пункт есть только у адаптивного теста —
          у стандартного лестницы сложности нет, и раздел о ней врал бы. */}
      {active === "difficulty-levels" && (
        <LevelFeedbackCard model={model} updateModel={updateModel} />
      )}
      {active === "metric-levels" && (
        <BandFeedbackSection kind="metrics" model={model} updateModel={updateModel} />
      )}
      {/* Подраздел кончается предпросмотром: здесь задают, ЧТО показывать в отчёте.
          Формулировки заголовков документа — это КАК он выглядит, и слой их
          переопределений живёт в «Оформлении → Облик отчёта» (PRD-49 §7). */}
      {active === "report" && (
        <ReportContentPane model={model} updateModel={updateModel} design={design} />
      )}
    </TabRail>
  );
}
