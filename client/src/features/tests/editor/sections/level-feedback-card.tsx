/**
 * @module features/tests/editor/sections/level-feedback-card
 * @description «По уровням сложности» — подраздел вкладки «Обратная связь и итоги»: тексты
 * адаптивных уровней и текст темы, у которой не подтверждён ни один уровень.
 *
 * Раньше они правились ВНУТРИ лестницы уровней, между порогом и числом вопросов: автор,
 * искавший «где написать, что сказать слушателю», находил их последними, а сама лестница
 * из структуры превращалась в смесь структуры с содержанием. Теперь лестница отвечает
 * только за структуру, а тексты живут там же, где все прочие тексты теста.
 *
 * Раскладка — та же, что у «По уровням шкал» и «По уровням показателей» (свёртка на объект,
 * внутри строка на уровень): три соседних подраздела, отличающиеся только тем, ЧЕМ уровень
 * задан, не должны выглядеть тремя разными механизмами.
 *
 * Список строится ПО СТРУКТУРЕ лестницы: тема -> её уровни в порядке возрастания. Своего
 * хранения у раздела нет — он правит те же поля (`adaptive.topics[].failureFeedback`,
 * `levels[].feedback`, `levels[].links`), что правила лестница.
 */
import type * as React from "react";
import { Banner, Collapsible, CollapsibleContent, CollapsibleTrigger, FormSection, Tag } from "@skillum/ui-kit";
import { ChevronDown, ChevronRight } from "lucide-react";

import { pluralize } from "@/lib/i18n";

import type {
  AdaptiveLevelConfig,
  AdaptiveLinkConfig,
  TestEditorModel,
} from "../test-editor.types";
import { FeedbackEditTrigger } from "./basic-settings-section";
import { FoldAllButtons, useSectionFold } from "./section-fold";

export type LevelFeedbackCardProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
};

/**
 * «По уровням сложности»: показывается только адаптивному тесту — у стандартного лестницы
 * нет, и пустой раздел сообщал бы о настройке, которой у него не бывает (решение владельца
 * 2026-09-07). Пункт рейла при этом не рисуется вовсе, так что сюда попасть неоткуда.
 */
export function LevelFeedbackCard({
  model,
  updateModel,
}: LevelFeedbackCardProps): React.JSX.Element | null {
  const enabled = model.sections
    .map((section) => model.adaptive.topics.find((t) => t.topicId === section.topicId))
    .filter((topic): topic is NonNullable<typeof topic> => Boolean(topic?.enabled));
  const fold = useSectionFold(enabled.map((t) => t.topicId));

  if (model.mode !== "adaptive") return null;

  const patchTopic = (
    topicId: string,
    patch: (topic: (typeof enabled)[number]) => (typeof enabled)[number],
  ) =>
    updateModel((m) => ({
      ...m,
      adaptive: {
        ...m.adaptive,
        topics: m.adaptive.topics.map((t) => (t.topicId === topicId ? patch(t) : t)),
      },
    }));

  const patchLevel = (topicId: string, levelIndex: number, patch: Partial<AdaptiveLevelConfig>) =>
    patchTopic(topicId, (topic) => ({
      ...topic,
      levels: topic.levels.map((l) => (l.levelIndex === levelIndex ? { ...l, ...patch } : l)),
    }));

  return (
    <FormSection
      stacked
      title="По уровням сложности"
      // Действия списка — в строке заголовка, справа: один приём во всех разделах ящика.
      headClassName="tb-section-head"
      meta={
        enabled.length > 0 ? <FoldAllButtons fold={fold} testIdPrefix="difficulty-levels" /> : undefined
      }
      data-testid="level-feedback-card"
    >
      {enabled.length === 0 ? (
        <Banner
          tone="info"
          title="Ни одна тема не включена в адаптивный режим"
          description="Включите темы и задайте им уровни во вкладке «Состав и сценарий», подраздел «Адаптивные уровни» — после этого здесь появятся их тексты."
          data-testid="level-feedback-no-topics"
        />
      ) : (
        <>
          {enabled.map((topic) => {
            const open = fold.isOpen(topic.topicId);
            return (
              <div className="tb-fold-sec" key={topic.topicId}>
                <Collapsible open={open} onOpenChange={() => fold.toggle(topic.topicId)}>
                  <div className="tb-fold-sec-head">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="tb-fold-trigger"
                        aria-label={open ? `Свернуть ${topic.topicName}` : `Развернуть ${topic.topicName}`}
                        data-testid={`difficulty-levels-toggle-${topic.topicId}`}
                      >
                        {open
                          ? <ChevronDown className="tb-fold-chev" width={16} height={16} aria-hidden="true" />
                          : <ChevronRight className="tb-fold-chev" width={16} height={16} aria-hidden="true" />}
                        <span className="tb-fold-sec-name">{topic.topicName}</span>
                      </button>
                    </CollapsibleTrigger>
                    <Tag tone="neutral" variant="outline">
                      {`${topic.levels.length} ${pluralize(topic.levels.length, "уровень", "уровня", "уровней")}`}
                    </Tag>
                  </div>
                  <CollapsibleContent>
                    <div className="tb-fold-sec__body">
                      <div className="ou-formfield">
                        <FeedbackEditTrigger
                          label="При непройденном уровне"
                          buttonAriaLabel={`Редактировать обратную связь темы ${topic.topicName}`}
                          modalTitle={`Обратная связь по теме «${topic.topicName}»`}
                          modalDescription="Показывается обучающемуся, если он не прошёл ни один уровень темы."
                          text={topic.failureFeedback ?? ""}
                          links={[]}
                          hideAssets
                          onSave={({ text }) =>
                            patchTopic(topic.topicId, (t) => ({
                              ...t,
                              failureFeedback: text === "" ? null : text,
                            }))
                          }
                          testId={`adaptive-topic-failure-${topic.topicId}`}
                        />
                      </div>
                      {topic.levels.map((level) => (
                        <div className="ou-formfield" key={level.levelIndex}>
                          <FeedbackEditTrigger
                            label={`Уровень «${level.levelName}»`}
                            buttonAriaLabel={`Редактировать обратную связь уровня ${level.levelName}`}
                            modalTitle={`Обратная связь уровня «${level.levelName}»`}
                            modalDescription="Показывается обучающемуся при достижении этого уровня сложности."
                            text={level.feedback ?? ""}
                            links={level.links}
                            hideAssets
                            onSave={({ text, links }: { text: string; links: AdaptiveLinkConfig[] }) =>
                              patchLevel(topic.topicId, level.levelIndex, {
                                feedback: text === "" ? null : text,
                                links,
                              })
                            }
                            testId={`adaptive-level-${topic.topicId}-${level.levelIndex}-feedback`}
                          />
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          })}
        </>
      )}
    </FormSection>
  );
}
