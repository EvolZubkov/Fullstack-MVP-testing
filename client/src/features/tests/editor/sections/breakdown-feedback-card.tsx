/**
 * @module features/tests/editor/sections/breakdown-feedback-card
 * @description PRD-50 FR-50: карточка «По подтемам (тегам)» вкладки «Обратная связь и
 * итоги» — текст и рекомендации на каждую подтему теста.
 *
 * До этой правки текст мог висеть только на теме, и компетенции приходилось заводить
 * темами. Теперь подтема — тег вопросов внутри темы — получает свой текст в том же
 * формате, что и тема, и он хранится своей колонкой раздела
 * (`test_sections.breakdown_feedback_json`).
 *
 * Кого из написанного прочитает участник, решает НЕ эта карточка: правило владельца
 * (2026-09-03) — текст выдаётся, когда результат по подтеме ниже общего проходного порога
 * теста, при любом вердикте, — живёт в `shared/breakdown/feedback` и работает одинаково на
 * экране итогов, в отчёте и в SCORM-пакете. Здесь только авторская правка.
 */
import { useMemo, useState } from "react";
import type * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, FormSection } from "@skillum/ui-kit";
import { FeedbackEditorModal, type FeedbackEditorValue } from "./feedback-editor-modal";
import { FeedbackField, FeedbackPreview } from "./feedback-preview";
import { FoldAllButtons, FoldSection, useSectionFold } from "./section-fold";
import { buildTagsByTopic, type QuestionTagRow } from "./topics-structure-section";
import type {
  BreakdownFeedbackEntry,
  InterpretationEntry,
  TestEditorModel,
} from "../test-editor.types";

export type BreakdownFeedbackCardProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
};

/** Пустое содержимое подтемы: так выглядит подтема, о которой автор ещё не писал. */
const EMPTY: BreakdownFeedbackEntry = { format: "plain", text: "", links: [], assets: [], events: [] };

/** Заголовок карточки — один и тот же и когда подтемы есть, и когда их нет. */
const CARD_TITLE = "По подтемам (тегам)";
const CARD_SUBTITLE =
  "Толкование печатается под полосой подтемы, когда включён его показ. Обратная связь выдаётся, когда результат по подтеме ниже общего проходного порога теста.";

/**
 * Пустое состояние карточки. Баннер стоит ВНУТРИ секции, а не вместо неё: голым он
 * оказывался прямым потомком панели настроек, где действует правило «баннер уровня
 * страницы липнет к верху» (`.tb-settings-content > .ou-banner`), — пустое состояние
 * делалось липким, вылезало за отступы панели и наползало на карточку «По темам»,
 * стоящую выше. Секция вокруг возвращает баннер в поток и заодно называет карточку,
 * о которой речь.
 */
function EmptyCard(props: {
  title: string;
  testId: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <FormSection stacked title={CARD_TITLE} subtitle={CARD_SUBTITLE} data-testid="breakdown-feedback-card">
      <Banner tone="info" title={props.title} description={props.children} data-testid={props.testId} />
    </FormSection>
  );
}

/**
 * Карточка правки текстов подтем: раздел -> его подтемы -> предпросмотр с карандашом.
 *
 * Перечень подтем берётся из ВОПРОСОВ темы, а не из порогов: подтема существует ровно
 * потому, что ею размечены вопросы, и список порогов (легаси с Э1) сказал бы о ней не то.
 */
export function BreakdownFeedbackCard({
  model,
  updateModel,
}: BreakdownFeedbackCardProps): React.JSX.Element {
  const { data: allQuestions = [] } = useQuery<QuestionTagRow[]>({
    queryKey: ["/api/questions"],
  });
  const tagsByTopic = useMemo(() => buildTagsByTopic(allQuestions), [allQuestions]);
  const sections = model.sections.filter(
    (section) => (tagsByTopic.get(section.topicId)?.tags.length ?? 0) > 0,
  );

  if (model.sections.length === 0) {
    return (
      <EmptyCard testId="breakdown-feedback-no-topics" title="Сначала добавьте темы">
        Подтемы — это теги вопросов внутри темы. Добавьте темы во вкладке «Состав и
        сценарий», и их подтемы появятся здесь.
      </EmptyCard>
    );
  }

  const fold = useSectionFold(sections.map((s) => s.topicId));

  if (sections.length === 0) {
    return (
      <EmptyCard testId="breakdown-feedback-no-tags" title="У вопросов нет подтем">
        Подтема — это тег вопроса. Разметьте вопросы тегами в редакторе вопросов, и здесь
        появится текст на каждую подтему.
      </EmptyCard>
    );
  }

  const setKey = (topicId: string, key: string, next: BreakdownFeedbackEntry | null) =>
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((section) => {
        if (section.topicId !== topicId) return section;
        const keys: Record<string, BreakdownFeedbackEntry> = { ...(section.breakdownFeedback ?? {}) };
        // Пустой текст без вложений — это «автор передумал»: ключ снимается, а не остаётся
        // пустой записью. Иначе тест возил бы в базе пустышки, а карточка показывала бы
        // разницу между «не писал» и «стёр», которой нет.
        if (next === null) delete keys[key];
        else keys[key] = next;
        return {
          ...section,
          breakdownFeedback: Object.keys(keys).length > 0 ? keys : null,
        };
      }),
    }));

  const setInterpretationKey = (topicId: string, key: string, next: InterpretationEntry | null) =>
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((section) => {
        if (section.topicId !== topicId) return section;
        const keys: Record<string, InterpretationEntry> = { ...(section.breakdownInterpretation ?? {}) };
        // То же правило, что у текстов выше: стёртый текст снимает ключ, а не остаётся
        // пустой записью.
        if (next === null) delete keys[key];
        else keys[key] = next;
        return {
          ...section,
          breakdownInterpretation: Object.keys(keys).length > 0 ? keys : null,
        };
      }),
    }));

  // Показ толкований подтем — настройка ТЕСТА («Состав итогов»). Карточка её не меняет, а
  // только называет: иначе автор пишет текст и не понимает, почему участник его не видит.
  const interpretationShown = model.runtime.breakdownDisplay?.showInterpretation === true;

  return (
    <FormSection
      stacked
      title={CARD_TITLE}
      subtitle={CARD_SUBTITLE}
      headClassName="tb-section-head"
      meta={<FoldAllButtons fold={fold} testIdPrefix="breakdown-feedback" />}
      data-testid="breakdown-feedback-card"
    >
      {sections.map((section, index) => {
        const tags = tagsByTopic.get(section.topicId)?.tags ?? [];
        return (
          <FoldSection
            key={section.topicId}
            open={fold.isOpen(section.topicId)}
            onToggle={() => fold.toggle(section.topicId)}
            name={`${index + 1}. ${section.topicName}`}
            tag={pluralTags(tags.length)}
            testId={`breakdown-feedback-sec-${section.topicId}`}
          >
            {tags.map((tag) => {
              const value = section.breakdownFeedback?.[tag] ?? EMPTY;
              return (
                <TagFeedbackRow
                  key={tag}
                  topicId={section.topicId}
                  tag={tag}
                  value={value}
                  interpretation={section.breakdownInterpretation?.[tag] ?? null}
                  interpretationShown={interpretationShown}
                  onSave={(next) => setKey(section.topicId, tag, next)}
                  onSaveInterpretation={(next) => setInterpretationKey(section.topicId, tag, next)}
                />
              );
            })}
          </FoldSection>
        );
      })}
    </FormSection>
  );
}

/** Одна подтема: толкование и обратная связь — два текста с разными правилами выдачи. */
function TagFeedbackRow(props: {
  topicId: string;
  tag: string;
  value: BreakdownFeedbackEntry;
  /** Толкование этой подтемы; `null` = автор его не писал. */
  interpretation: InterpretationEntry | null;
  /** Включён ли показ толкований подтем в настройках теста. */
  interpretationShown: boolean;
  onSave: (next: BreakdownFeedbackEntry | null) => void;
  onSaveInterpretation: (next: InterpretationEntry | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [interpretationOpen, setInterpretationOpen] = useState(false);
  const { value, tag, interpretation } = props;
  const testId = `breakdown-feedback-${props.topicId}-${tag}`;
  const interpretationTestId = `breakdown-interpretation-${props.topicId}-${tag}`;
  return (
    <div className="tb-textgroup">
      {/* Название подтемы — подзаголовок группы, как и название темы выше: полей под ним
          два, и метка у каждого своя. */}
      <div className="tb-section-label">{tag}</div>

      <FeedbackField
        label="Толкование"
        // Тег молчит, когда показ включён: подписывать «показывается» нечего — это норма.
        // Он говорит ровно тогда, когда написанное участнику не попадёт.
        tag={props.interpretationShown ? undefined : { text: "скрыто от участника" }}
      >
        <FeedbackPreview
          format={interpretation?.format ?? "plain"}
          text={interpretation?.text ?? ""}
          links={[]}
          assets={[]}
          events={[]}
          onEdit={() => setInterpretationOpen(true)}
          editAriaLabel={`Редактировать толкование подтемы «${tag}»`}
          testId={interpretationTestId}
        />
      </FeedbackField>

      <FeedbackField label="Обратная связь">
        <FeedbackPreview
          format={value.format}
          text={value.text}
          links={value.links ?? []}
          assets={value.assets ?? []}
          events={value.events ?? []}
          onEdit={() => setOpen(true)}
          editAriaLabel={`Редактировать обратную связь подтемы «${tag}»`}
          testId={testId}
        />
      </FeedbackField>

      {/* Без курсов, материалов и мероприятий — по той же причине, что и у темы. */}
      <FeedbackEditorModal
        open={interpretationOpen}
        title={`Толкование подтемы «${tag}»`}
        description="Текст объясняет результат по этой подтеме и печатается под её полосой, когда включён показ толкований подтем."
        value={{ format: interpretation?.format ?? "plain", text: interpretation?.text ?? "", links: [], assets: [] }}
        hideLinks
        hideAssets
        hideEvents
        textLabel="Текст толкования"
        onCancel={() => setInterpretationOpen(false)}
        onSave={(v: FeedbackEditorValue) => {
          props.onSaveInterpretation(
            v.text.trim() === "" ? null : { format: v.format, text: v.text },
          );
          setInterpretationOpen(false);
        }}
        testId={`${interpretationTestId}-modal`}
      />
      <FeedbackEditorModal
        open={open}
        title={`Обратная связь подтемы «${tag}»`}
        description="Текст и материалы, которые получит участник, если результат по этой подтеме ниже общего проходного порога теста."
        value={{
          format: value.format,
          text: value.text,
          links: value.links ?? [],
          assets: value.assets ?? [],
          events: value.events ?? [],
        }}
        onCancel={() => setOpen(false)}
        onSave={(v: FeedbackEditorValue) => {
          const empty =
            v.text.trim() === "" &&
            v.links.length === 0 &&
            v.assets.length === 0 &&
            (v.events ?? []).length === 0;
          props.onSave(
            empty
              ? null
              : {
                  format: v.format,
                  text: v.text,
                  links: v.links,
                  assets: v.assets,
                  events: v.events ?? [],
                },
          );
          setOpen(false);
        }}
        testId={`${testId}-modal`}
      />
    </div>
  );
}

/** «1 подтема» / «3 подтемы» / «5 подтем» — счётчик в теге шапки свёртки. */
function pluralTags(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail >= 11 && tail <= 14) return `${count} подтем`;
  if (last === 1) return `${count} подтема`;
  if (last >= 2 && last <= 4) return `${count} подтемы`;
  return `${count} подтем`;
}
