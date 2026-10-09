/**
 * @module features/tests/editor/sections/topic-feedback-card
 * @description PRD-29 §7.1a: карточка «По темам» вкладки «Обратная связь и итоги».
 *
 * Обратная связь темы в тесте РАЗРЕШАЕТСЯ одним значением: задан текст раздела — печатается
 * он, не задан — печатается текст самой темы. Сложение двух текстов признано дефектом
 * (ученик получал склейку, которую автор нигде не видел), поэтому карточка показывает
 * именно РАЗРЕШЁННЫЙ текст — ровно то, что получит участник, — и называет его источник.
 *
 * Правка всегда пишется на уровне ТЕСТА (`test_sections.feedback_json`): тема общая для
 * многих тестов, и менять её отсюда значило бы править чужие тесты. «Сбросить до установок
 * темы» снимает эту правку, и текст снова приходит из темы.
 */
import { useState } from "react";
import type * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, FormSection } from "@skillum/ui-kit";
import { resolveTopicInterpretation } from "@shared/interpretation/resolve";
import { FeedbackEditorModal, type FeedbackEditorValue } from "./feedback-editor-modal";
import { FeedbackField, FeedbackPreview } from "./feedback-preview";
import type {
  EditorSection,
  FeedbackAsset,
  FeedbackContent,
  FeedbackEvent,
  FeedbackLink,
  InterpretationEntry,
  TestEditorModel,
} from "../test-editor.types";

/** Строка темы в том виде, в каком её отдаёт `/api/topics`. */
type TopicRow = {
  id: string;
  name?: string;
  /** Нынешний источник текста темы. */
  feedbackJson?: {
    format?: FeedbackContent["format"];
    text?: string;
    links?: FeedbackLink[];
    assets?: FeedbackAsset[];
    events?: FeedbackEvent[];
  } | null;
  /** Легаси-колонка: у темы, которой редактор тем не касался, весь текст лежит здесь. */
  feedback?: string | null;
  /** Толкование самой темы (`topics.interpretation_json`). */
  interpretationJson?: InterpretationEntry | null;
};

export type TopicFeedbackCardProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
};

/** Своя правка раздела: хоть что-то из текста и материалов. */
function hasOwnFeedback(section: EditorSection): boolean {
  return (
    section.feedback.text.trim() !== "" ||
    section.feedbackLinks.length > 0 ||
    section.feedbackAssets.length > 0 ||
    section.feedbackEvents.length > 0
  );
}

/**
 * Карточка «По темам»: на каждую тему теста — разрешённый текст, его источник и правка.
 */
export function TopicFeedbackCard({
  model,
  updateModel,
}: TopicFeedbackCardProps): React.JSX.Element {
  const { data: topics = [] } = useQuery<TopicRow[]>({ queryKey: ["/api/topics"] });
  const byId = new Map(topics.map((t) => [t.id, t]));

  if (model.sections.length === 0) {
    // Пустое состояние живёт ВНУТРИ своей секции, а не вместо неё. Голый баннер попадал
    // прямым потомком панели настроек, а там действует правило «баннер уровня страницы
    // липнет к верху» (`.tb-settings-content > .ou-banner`): пустое состояние делалось
    // липким, выезжало за отступы панели и наползало на соседнюю карточку. Заодно
    // заголовок говорит, КАКАЯ карточка пуста, — у голого баннера этого не было.
    return (
      <FormSection
        stacked
        title="По темам"
        subtitle="Участник получает ОДИН текст на тему: заданный в этом тесте, а если он не задан — текст самой темы."
        data-testid="topic-feedback-card"
      >
        <Banner
          tone="info"
          title="Сначала добавьте темы"
          description="Обратная связь пишется на темы теста. Добавьте их во вкладке «Состав и сценарий», и они появятся здесь."
          data-testid="topic-feedback-no-topics"
        />
      </FormSection>
    );
  }

  const setSection = (topicId: string, patch: Partial<EditorSection>) =>
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((s) => (s.topicId === topicId ? { ...s, ...patch } : s)),
    }));

  return (
    <FormSection
      stacked
      title="По темам"
      subtitle="Участник получает ОДИН текст на тему: заданный в этом тесте, а если он не задан — текст самой темы."
      data-testid="topic-feedback-card"
    >
      {model.sections.map((section, index) => (
        <TopicFeedbackRow
          key={section.topicId}
          index={index}
          section={section}
          topic={byId.get(section.topicId)}
          onSave={(patch) => setSection(section.topicId, patch)}
        />
      ))}
    </FormSection>
  );
}

/** Одна тема: разрешённый текст, подпись источника, правка и сброс. */
function TopicFeedbackRow(props: {
  /** Место темы в выдаче: эскиз подписывает темы «1. О компании». */
  index: number;
  section: EditorSection;
  topic?: TopicRow;
  onSave: (patch: Partial<EditorSection>) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [interpretationOpen, setInterpretationOpen] = useState(false);
  const { section, topic } = props;
  const own = hasOwnFeedback(section);
  // Разрешение — то же правило, что печатает выдача (`topicFeedbackTexts`): своя правка
  // теста ЗАМЕНЯЕТ текст темы целиком, а не дополняет его.
  const topicBlock = topic?.feedbackJson ?? null;
  const topicLegacy = typeof topic?.feedback === "string" ? topic.feedback : "";
  const resolved = own
    ? {
        format: section.feedback.format,
        text: section.feedback.text,
        links: section.feedbackLinks,
        assets: section.feedbackAssets,
        events: section.feedbackEvents,
      }
    : {
        format: topicBlock?.format ?? "plain",
        text: (topicBlock?.text ?? "").trim() || topicLegacy,
        links: topicBlock?.links ?? [],
        assets: topicBlock?.assets ?? [],
        events: topicBlock?.events ?? [],
      };
  const testId = `topic-feedback-${section.topicId}`;
  // Толкование разрешается тем же правилом и тем же кодом, что и в выдаче: текст теста
  // заменяет текст темы целиком. Автор видит в карточке ровно то, что получит участник.
  const interpretation = resolveTopicInterpretation(
    topic?.interpretationJson ?? null,
    section.interpretation ?? null,
  );
  const ownInterpretation = interpretation?.source === "test";
  const interpretationTestId = `topic-interpretation-${section.topicId}`;
  return (
    <>
      <div className="tb-textgroup">
        {/* Название темы — подзаголовок группы полей, а не метка поля: полей под ним теперь
            два, и у каждого своя метка. */}
        <div className="tb-section-label">{`${props.index + 1}. ${section.topicName}`}</div>

        <FeedbackField
          label="Толкование"
          tag={{ text: ownInterpretation ? "этот тест" : "из темы", tone: ownInterpretation ? "warning" : "neutral" }}
          onReset={ownInterpretation ? () => props.onSave({ interpretation: null }) : undefined}
          resetLabel="Сбросить толкование до установок темы"
          resetTestId={`${interpretationTestId}-reset`}
        >
          <FeedbackPreview
            format={interpretation?.format ?? "plain"}
            text={interpretation?.text ?? ""}
            links={[]}
            assets={[]}
            events={[]}
            onEdit={() => setInterpretationOpen(true)}
            editAriaLabel={`Редактировать толкование темы «${section.topicName}»`}
            overridden={ownInterpretation}
            testId={interpretationTestId}
          />
        </FeedbackField>

        <FeedbackField
          label="Обратная связь"
          tag={{ text: own ? "этот тест" : "из темы", tone: own ? "warning" : "neutral" }}
          onReset={
            own
              ? () =>
                  props.onSave({
                    feedback: { format: "plain", text: "" },
                    feedbackLinks: [],
                    feedbackAssets: [],
                    feedbackEvents: [],
                  })
              : undefined
          }
          resetLabel="Сбросить обратную связь до установок темы"
          resetTestId={`${testId}-reset`}
        >
          <FeedbackPreview
            format={resolved.format}
            text={resolved.text}
            links={resolved.links}
            assets={resolved.assets}
            events={resolved.events}
            onEdit={() => setOpen(true)}
            editAriaLabel={`Редактировать обратную связь темы «${section.topicName}»`}
            overridden={own}
            testId={testId}
          />
        </FeedbackField>
      </div>
      <FeedbackEditorModal
        open={open}
        title={`Обратная связь темы «${section.topicName}»`}
        description="Текст сохраняется в ЭТОМ тесте и заменяет собой текст темы. Сама тема не меняется — её текст останется у других тестов."
        value={resolved}
        onCancel={() => setOpen(false)}
        onSave={(v: FeedbackEditorValue) => {
          props.onSave({
            feedback: { format: v.format, text: v.text },
            feedbackLinks: v.links,
            feedbackAssets: v.assets,
            feedbackEvents: v.events ?? [],
          });
          setOpen(false);
        }}
        testId={`${testId}-modal`}
      />
      {/* Та же модалка, но БЕЗ курсов, материалов и мероприятий: толкование ничего не
          советует, и место для ссылки, которую некуда сохранить, было бы обещанием. */}
      <FeedbackEditorModal
        open={interpretationOpen}
        title={`Толкование темы «${section.topicName}»`}
        description="Текст объясняет результат по этой теме и печатается при любом вердикте. Сохраняется в ЭТОМ тесте и заменяет собой толкование темы — сама тема не меняется."
        value={{ format: interpretation?.format ?? "plain", text: interpretation?.text ?? "", links: [], assets: [] }}
        hideLinks
        hideAssets
        hideEvents
        textLabel="Текст толкования"
        onCancel={() => setInterpretationOpen(false)}
        onSave={(v: FeedbackEditorValue) => {
          props.onSave({
            interpretation: v.text.trim() === "" ? null : { format: v.format, text: v.text },
          });
          setInterpretationOpen(false);
        }}
        testId={`${interpretationTestId}-modal`}
      />
    </>
  );
}
