/**
 * @module features/tests/editor/questions/test-questions-section
 * @description «Вопросы теста»: вопросы одной темы теста со сводкой их свойств В ЭТОМ
 * ТЕСТЕ (эскиз `docs/wireframes/editor-settings-target.html`, состояние
 * `s-composition-questions`).
 *
 * Раньше, чтобы понять, из чего собран тест, автор выходил из ящика в «Темы и вопросы»:
 * «Состав» показывал по теме только числа. Здесь видно каждое задание и то, что тест с
 * ним делает.
 *
 * Панель только читает. Балл, цену ответа, вклады, варианты и квоты правят их вкладки
 * ящика, и второй способ править то же самое развёл бы их. Содержание вопроса правится в
 * ящике вопроса, который монтирует хозяин вкладки (`onOpenQuestion` / `onCreateQuestion`).
 */
import { useMemo, useState } from "react";
import type * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDot, Eye, Pencil, Plus, Search } from "lucide-react";
import { Button, EmptyState, FormSection, IconButton, Input, Tag } from "@skillum/ui-kit";
import type { Question } from "@shared/schema";
import type { QuestionType } from "@shared/questions/question-type";
import { QuestionPreviewModal } from "@/features/questions/question-preview-modal";
import { useReviewComments } from "../../review/use-review-comments";
import type { TestEditorModel } from "../test-editor.types";
import { QUESTION_TYPE_ICON, QUESTION_TYPE_LABEL } from "../sections/question-type-icon";
import { buildQuestionSummary } from "./question-summary";

type QuestionRow = Question & { topicName?: string };

export type TestQuestionsSectionProps = {
  model: TestEditorModel;
  /** Тема, вопросы которой показываются. */
  topicId: string;
  /** Тест, если он уже сохранён: комментарии рецензирования есть только у него. */
  testId?: string;
  /** Открыть вопрос в ящике вопроса. */
  onOpenQuestion?: (questionId: string) => void;
  /** Открыть ящик нового вопроса с этой темой. */
  onCreateQuestion?: (topicId: string) => void;
};

/**
 * Текст для поиска: без разметки, в нижнем регистре, «ё» как «е». Задание может быть
 * записано разметкой, а автор ищет по тому, что видит.
 */
export function searchableText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** Список вопросов темы со сводкой и поиском по фрагменту текста. */
export function TestQuestionsSection({
  model,
  topicId,
  testId,
  onOpenQuestion,
  onCreateQuestion,
}: TestQuestionsSectionProps): React.JSX.Element | null {
  const { data: allQuestions = [], isLoading } = useQuery<QuestionRow[]>({
    queryKey: ["/api/questions"],
  });
  const { threads } = useReviewComments(testId ?? "", { enabled: Boolean(testId) });
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<QuestionRow | null>(null);

  const index = model.sections.findIndex((s) => s.topicId === topicId);
  const section = index >= 0 ? model.sections[index] : undefined;

  const questions = useMemo(
    () =>
      allQuestions
        .filter((q) => q.topicId === topicId)
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
    [allQuestions, topicId],
  );
  const needle = searchableText(query);
  const shown = needle
    ? questions.filter((q) => searchableText(q.prompt ?? "").includes(needle))
    : questions;

  const overrideByQuestion = useMemo(
    () => new Map(model.scoring.questionOverrides.map((o) => [o.questionId, o])),
    [model.scoring.questionOverrides],
  );
  const excluded = useMemo(
    () => new Set(model.deliveryExcludedQuestionIds ?? []),
    [model.deliveryExcludedQuestionIds],
  );
  const openComments = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of threads) {
      if (t.status !== "open" || !t.questionId) continue;
      map.set(t.questionId, (map.get(t.questionId) ?? 0) + 1);
    }
    return map;
  }, [threads]);

  if (!section) return null;

  const poolSize = section.maxQuestions || questions.length;
  const drawLabel = section.formSet
    ? `вариантов ${section.formSet.forms.length}`
    : section.drawAll || model.mode === "adaptive"
      ? `вся тема (${poolSize})`
      : `выдача ${section.drawCount} из ${poolSize}`;

  return (
    <FormSection
      stacked
      className="tb-qlist"
      title={
        <span className="tb-qlist__title">
          <span>{`${index + 1}. ${section.topicName}`}</span>
          <Tag tone="neutral" variant="outline">{drawLabel}</Tag>
        </span>
      }
      headClassName="tb-section-head"
      meta={
        onCreateQuestion ? (
          <Button
            variant="secondary"
            size="s"
            leadingIcon={<Plus size={16} aria-hidden="true" />}
            onClick={() => onCreateQuestion(topicId)}
            data-testid="test-questions-add"
          >
            Добавить вопрос
          </Button>
        ) : undefined
      }
      data-testid={`test-questions-${topicId}`}
    >
      <Input
        size="m"
        label="Поиск по тексту вопроса"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        iconRight={<Search width={16} height={16} aria-hidden="true" />}
        data-testid="test-questions-search"
      />

      {isLoading ? null : questions.length === 0 ? (
        <EmptyState
          title="В теме пока нет вопросов"
          description="Добавьте первый вопрос — он сразу появится в этом тесте."
          data-testid="test-questions-empty"
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          description="Ни в одном вопросе темы нет такого фрагмента текста."
          data-testid="test-questions-no-match"
        />
      ) : (
        <table className="tb-table" aria-label={`Вопросы темы «${section.topicName}»`}>
          <thead>
            <tr>
              <th>Вопрос и его настройки в тесте</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {shown.map((q) => {
              const summary = buildQuestionSummary({
                question: q,
                section,
                mode: model.mode,
                testDefaultPoints: model.scoring.defaultQuestionPoints,
                override: overrideByQuestion.get(q.id),
                measurements: model.measurements,
                scales: model.scales,
                excluded: excluded.has(q.id),
                openComments: openComments.get(q.id) ?? 0,
              });
              const qType = q.type as QuestionType;
              const TypeIcon = QUESTION_TYPE_ICON[qType] ?? CircleDot;
              return (
                <tr
                  key={q.id}
                  className={onOpenQuestion ? "tb-qlist__row" : undefined}
                  onClick={onOpenQuestion ? () => onOpenQuestion(q.id) : undefined}
                  data-testid={`test-questions-row-${q.id}`}
                >
                  <td>
                    <div className="tb-qlist__cell">
                      <span className="tb-qlist__text">
                        <span className="tb-qscoring__qtype" title={QUESTION_TYPE_LABEL[qType] ?? qType}>
                          <TypeIcon width={16} height={16} aria-hidden="true" />
                        </span>
                        {q.prompt}
                      </span>
                      <span className="tb-qlist__meta">{summary.meta.join(" · ")}</span>
                      {summary.flags.length > 0 && (
                        <span className="tb-qlist__flags">
                          {summary.flags.map((f) => (
                            <Tag
                              key={f.key}
                              tone={f.tone}
                              size="s"
                              data-testid={`test-questions-flag-${f.key}-${q.id}`}
                            >
                              {f.label}
                            </Tag>
                          ))}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    {/* Кнопки не должны открывать строку второй раз: щелчок по ним
                        гасится, иначе «глаз» открывал бы ещё и ящик вопроса. */}
                    <div className="tb-qlist__actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        icon={<Eye width={14} height={14} aria-hidden="true" />}
                        variant="ghost"
                        size="s"
                        aria-label="Посмотреть глазами участника"
                        onClick={() => setPreview(q)}
                        data-testid={`test-questions-preview-${q.id}`}
                      />
                      {onOpenQuestion && (
                        <IconButton
                          icon={<Pencil width={14} height={14} aria-hidden="true" />}
                          variant="ghost"
                          size="s"
                          aria-label="Открыть вопрос"
                          onClick={() => onOpenQuestion(q.id)}
                          data-testid={`test-questions-open-${q.id}`}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {preview && (
        <QuestionPreviewModal
          open
          question={preview}
          topicName={section.topicName}
          onClose={() => setPreview(null)}
        />
      )}
    </FormSection>
  );
}
