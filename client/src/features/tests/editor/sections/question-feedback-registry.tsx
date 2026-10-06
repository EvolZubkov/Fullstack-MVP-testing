/**
 * @module features/tests/editor/sections/question-feedback-registry
 * @description Э2.4: реестр «По вопросам» подраздела «Во время теста».
 *
 * Обратная связь ВОПРОСА принадлежит вопросу, а не тесту: её правит редактор вопроса, и
 * один и тот же вопрос стоит в нескольких тестах. Поэтому реестр — ТОЛЬКО ЧТЕНИЕ: он
 * отвечает на вопрос «что уже написано у вопросов этого теста» и уводит правку туда, где
 * она хранится. Без него автор не мог узнать этого нигде: приходилось открывать вопросы по
 * одному в другом разделе продукта.
 *
 * Дерево свёрнуто до тем: у теста бывает десяток тем по десятку вопросов, и раскрытый
 * список сразу — это простыня, в которой ничего не найти.
 *
 * Текст варианта ответа, переопределяющий обратную связь вопроса (одиночный выбор), идёт
 * ОТДЕЛЬНОЙ ПОДСТРОКОЙ под своим вопросом: в колонке «Вопрос» — текст варианта, в «Режиме» —
 * «Вариант». Сплошной текст в одной ячейке не читался: тексты вопроса и вариантов сливались.
 * Эскиз: docs/wireframes/approved/option-feedback.html.
 */
import { Fragment, useMemo } from "react";
import type * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Accordion, AccordionItem, Banner, Button, FormSection } from "@skillum/ui-kit";
import { ArrowRight, CornerDownRight } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Question } from "@shared/schema";
import { optionFeedbackAt } from "@shared/questions/option-feedback";
import type { TestEditorModel } from "../test-editor.types";
import { FoldAllButtons, useSectionFold } from "./section-fold";

/**
 * Строка вопроса в том виде, в каком её отдаёт `/api/questions`.
 *
 * Поля ВЫБИРАЮТСЯ из схемы, а не переписываются здесь руками: собственный список имён
 * однажды уже разошёлся с маршрутом — реестр читал `text`, которого в ответе нет, и каждая
 * строка печатала «Без формулировки». Компилятор промолчал (поле было необязательным), и
 * компонентный тест тоже: у него была своя фикстура, названная так же неверно. `Pick`
 * ставит расхождение на учёт компилятора.
 */
type QuestionRow = Pick<
  Question,
  | "id"
  | "topicId"
  | "prompt"
  | "dataJson"
  | "feedbackMode"
  | "feedback"
  | "feedbackCorrect"
  | "feedbackIncorrect"
  | "optionFeedbackJson"
>;

export type QuestionFeedbackRegistryProps = {
  model: TestEditorModel;
  /**
   * Открыть редактор вопроса. Необязателен: реестр собирают и там, где ящика вопроса нет
   * (компонентные тесты), — тогда строка просто не предлагает перехода.
   */
  onOpenQuestion?: (questionId: string) => void;
};

/** Вариант ответа со своим текстом обратной связи: подпись варианта и сам текст. */
type OptionOverride = { index: number; option: string; text: string };

/** Варианты вопроса, у которых задан свой текст, — в порядке вариантов. */
function optionOverrides(q: QuestionRow): OptionOverride[] {
  const options = (q.dataJson as { options?: unknown } | null)?.options;
  if (!Array.isArray(options)) return [];
  const result: OptionOverride[] = [];
  options.forEach((option, index) => {
    const text = optionFeedbackAt(q.optionFeedbackJson, index);
    if (text) result.push({ index, option: String(option), text });
  });
  return result;
}

/**
 * Есть ли у вопроса написанная обратная связь — в том режиме, который у него выбран, или
 * у отдельного варианта: такой вопрос ученику тоже что-то скажет.
 */
function hasFeedback(q: QuestionRow): boolean {
  if (optionOverrides(q).length > 0) return true;
  if (q.feedbackMode === "conditional") {
    return Boolean((q.feedbackCorrect ?? "").trim() || (q.feedbackIncorrect ?? "").trim());
  }
  return Boolean((q.feedback ?? "").trim());
}

/**
 * Реестр обратной связи вопросов теста: тема -> её вопросы -> что у них написано.
 */
export function QuestionFeedbackRegistry({
  model,
  onOpenQuestion,
}: QuestionFeedbackRegistryProps): React.JSX.Element {
  const { data: questions = [] } = useQuery<QuestionRow[]>({ queryKey: ["/api/questions"] });
  const byTopic = useMemo(() => {
    const map = new Map<string, QuestionRow[]>();
    for (const q of questions) {
      if (!q || typeof q.topicId !== "string") continue;
      const list = map.get(q.topicId);
      if (list) list.push(q);
      else map.set(q.topicId, [q]);
    }
    return map;
  }, [questions]);
  const sectionIds = useMemo(() => model.sections.map((s) => s.topicId), [model.sections]);
  // Свёртка — общая с остальными реестрами редактора: один хук, одна пара кнопок, одна
  // разметка `tb-fold-actions`. Своя копия здесь однажды уже разошлась с эскизом по иконкам.
  const fold = useSectionFold(sectionIds, true);
  const openIds = sectionIds.filter((id) => fold.isOpen(id));

  if (model.sections.length === 0) {
    return (
      <Banner
        tone="info"
        title="Сначала добавьте темы"
        description="Реестр показывает вопросы тем этого теста. Добавьте темы во вкладке «Состав и сценарий»."
        data-testid="question-feedback-no-topics"
      />
    );
  }

  return (
    <FormSection
      stacked
      title="Обратная связь вопросов"
      // Действия списка стоят в строке заголовка, справа, — как рисует эскиз. Без
      // `tb-section-head` слот `meta` рисует их пилюлей-меткой под заголовком.
      headClassName="tb-section-head"
      meta={<FoldAllButtons fold={fold} testIdPrefix="question-feedback" />}
      data-testid="question-feedback-registry"
    >
      <Accordion
        variant="separated"
        type="multiple"
        value={openIds}
        onChange={(next) => {
          // Аккордеон отдаёт НОВЫЙ список раскрытых, а свёртка хранит свёрнутые: сводим их
          // через `toggle` по расхождению, чтобы у состояния остался один владелец — хук.
          const opened = new Set(Array.isArray(next) ? next : [next]);
          for (const id of sectionIds) {
            if (opened.has(id) !== fold.isOpen(id)) fold.toggle(id);
          }
        }}
      >
        {model.sections.map((section, index) => {
          const list = byTopic.get(section.topicId) ?? [];
          const withText = list.filter(hasFeedback).length;
          return (
            <AccordionItem
              key={section.topicId}
              value={section.topicId}
              // Номер темы — её место в выдаче: эскиз подписывает темы «1. О компании».
              title={`${index + 1}. ${section.topicName}`}
              subtitle={`${list.length} вопросов · у ${withText} задана обратная связь`}
              data-testid={`question-feedback-topic-${section.topicId}`}
            >
              {list.length === 0 ? (
                <div className="tb-card-desc">В теме нет вопросов.</div>
              ) : (
                <table
                  className="tb-table tb-table--mb tb-qfeedback-table"
                  aria-label={`Обратная связь вопросов темы «${section.topicName}»`}
                >
                  <thead>
                    <tr>
                      <th className="tb-qfeedback-table__q">Вопрос</th>
                      <th className="tb-qfeedback-table__mode">Режим</th>
                      <th>Текст</th>
                      <th className="tb-qfeedback-table__act" aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((q) => {
                      const overrides = optionOverrides(q);
                      return (
                        <Fragment key={q.id}>
                          <tr className={overrides.length > 0 ? "tb-qfeedback-row--has-sub" : undefined}>
                            <td>{q.prompt || "Без формулировки"}</td>
                            {/* Э5.8: режим называется ровно так же, как в карточке вопроса —
                                из одного словаря, чтобы реестр не завёл своих синонимов. */}
                            <td>
                              {q.feedbackMode === "conditional"
                                ? t.questions.feedbackModeConditional
                                : t.questions.feedbackModeGeneral}
                            </td>
                            <td>
                              {q.feedbackMode === "conditional" ? (
                                <>
                                  <FeedbackLine label="Верно" text={q.feedbackCorrect} />
                                  <FeedbackLine label="Неверно" text={q.feedbackIncorrect} />
                                </>
                              ) : (
                                // Подпись у общего текста не нужна: столбец уже называется
                                // «Текст», и строка «Текст не задано» повторяла заголовок.
                                // Подписи остаются только там, где различают ДВА текста, —
                                // у условной обратной связи.
                                <FeedbackLine text={q.feedback} />
                              )}
                            </td>
                            <td>
                              {onOpenQuestion && (
                                <Button
                                  variant="ghost"
                                  size="s"
                                  trailingIcon={<ArrowRight width={14} height={14} aria-hidden="true" />}
                                  onClick={() => onOpenQuestion(q.id)}
                                  data-testid={`question-feedback-open-${q.id}`}
                                >
                                  К вопросу
                                </Button>
                              )}
                            </td>
                          </tr>
                          {overrides.map((o, n) => (
                            <tr
                              key={`${q.id}:${o.index}`}
                              className={
                                n === overrides.length - 1
                                  ? "tb-qfeedback-row--sub is-last"
                                  : "tb-qfeedback-row--sub"
                              }
                              data-testid={`question-feedback-option-${q.id}-${o.index}`}
                            >
                              <td>
                                <span className="tb-qfeedback-sub">
                                  <CornerDownRight width={14} height={14} aria-hidden="true" />
                                  <span>{o.option}</span>
                                </span>
                              </td>
                              <td>Вариант</td>
                              <td>
                                <FeedbackLine text={o.text} />
                              </td>
                              <td />
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </AccordionItem>
          );
        })}
      </Accordion>
    </FormSection>
  );
}

/**
 * Одна строка текста: написанное, либо честное «не задано». Подпись необязательна и
 * нужна там, где в одной ячейке стоят ДВА текста (условная обратная связь): у общего
 * текста её роль уже играет заголовок столбца.
 */
function FeedbackLine(props: { label?: string; text?: string | null }): React.JSX.Element {
  const text = (props.text ?? "").trim();
  return (
    <div className="tb-qfeedback__line">
      {props.label && <span className="tb-qfeedback__line-lbl">{props.label}</span>}
      <span className={text ? "tb-qfeedback__line-text" : "tb-qfeedback__line-text is-empty"}>
        {text || "не задано"}
      </span>
    </div>
  );
}
