/**
 * @module features/tests/editor/sections/scoring-section
 * @description «Оценка» editor tab (PRD-15 block D, FR-30/FR-31/FR-34/FR-35):
 * the test-side scoring. Two kinds of state live here:
 *
 *   - DEFAULTS (test-wide and per-section price) are part of the editor draft
 *     and persist with the single drawer «Сохранить» (FR-31). Transitional
 *     note: until T-40 drops `questions.points`, a question's own value takes
 *     precedence in the effective chain, so the defaults apply to questions
 *     whose price equals the system default.
 *   - PER-QUESTION OVERRIDES persist immediately through the dedicated
 *     endpoints (scoring-api): applying the modal writes the row, the reset
 *     icon deletes it. Every write bumps the test version (FR-12).
 *
 * The questions table shows the EFFECTIVE values (shared resolver). The
 * «настроено в тесте» mark is permanent and distinct from the unsaved-changes
 * dot: an accent bar on the row + a soft accent fill on each overridden cell
 * (tooltip «Настроено в тесте»). A stale override (the question's variants
 * changed after it was authored, FR-30) carries the «Настройка устарела» tag.
 *
 * Source of truth for the layout:
 * docs/wireframes/approved/prd15-test-scoring.html (s-tab).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, RotateCcw } from "lucide-react";
import { Banner, IconButton, Input, Tag } from "@universityrt/ui-kit";

import { resolveEffectiveScoring } from "@shared/scoring/effective-scoring";
import type { Question } from "@shared/schema";
import type { TestEditorModel } from "../test-editor.types";
import {
  useQuestionScoring,
  useResetQuestionScoring,
  type QuestionScoringOverride,
} from "../scoring-api";
import { QuestionScoringModal } from "./question-scoring-modal";

export type ScoringSectionProps = {
  model: TestEditorModel;
  /** Test id; `undefined` in create mode — per-question overrides need a saved test. */
  testId?: string;
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  readOnly?: boolean;
};

type QuestionRow = Question & { topicName?: string };

/** Human label of a graded-config kind (PRD-10). */
const KIND_LABEL: Record<string, string> = {
  exact: "Точное",
  weighted: "Веса",
  tiered: "Ступени",
};

/** Parse a default-price text field: "" = inherit (null), else a whole >= 0. */
function parseDefaultPoints(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) return undefined; // ignore invalid keystroke
  return n;
}

export function ScoringSection({ model, testId, updateModel, readOnly }: ScoringSectionProps) {
  const { data: allQuestions = [] } = useQuery<QuestionRow[]>({ queryKey: ["/api/questions"] });
  const overridesQuery = useQuestionScoring(testId);
  const overrides = overridesQuery.data ?? [];
  const resetOverride = useResetQuestionScoring(testId);

  const [modalState, setModalState] = useState<{
    question: QuestionRow;
    sectionName: string;
    sectionDefaultPoints: number | null;
  } | null>(null);

  const overrideByQuestion = useMemo(
    () => new Map(overrides.map((row) => [row.questionId, row])),
    [overrides],
  );

  const questionsByTopic = useMemo(() => {
    const map = new Map<string, QuestionRow[]>();
    for (const q of allQuestions) {
      const list = map.get(q.topicId);
      if (list) list.push(q);
      else map.set(q.topicId, [q]);
    }
    return map;
  }, [allQuestions]);

  const setTestDefault = (raw: string) => {
    const parsed = parseDefaultPoints(raw);
    if (parsed === undefined) return;
    updateModel((m) => ({ ...m, scoring: { ...m.scoring, defaultQuestionPoints: parsed } }));
  };

  const setSectionDefault = (topicId: string, raw: string) => {
    const parsed = parseDefaultPoints(raw);
    if (parsed === undefined) return;
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((s) =>
        s.topicId === topicId ? { ...s, defaultPoints: parsed } : s,
      ),
    }));
  };

  return (
    <div className="tb-qscoring" data-testid="scoring-section">
      <div className="tb-qscoring__default-row">
        <span className="tb-qscoring__default-lbl">Балл за вопрос по умолчанию</span>
        <Input
          size="s"
          className="tb-qscoring__num"
          inputMode="numeric"
          value={model.scoring.defaultQuestionPoints?.toString() ?? ""}
          placeholder="1"
          disabled={readOnly}
          aria-label="Балл за вопрос по умолчанию для теста"
          onChange={(e) => setTestDefault(e.target.value)}
          data-testid="scoring-test-default"
        />
        <span className="tb-qscoring__default-hint">
          Пусто — системное умолчание: 1 балл за полностью верный ответ.
        </span>
      </div>

      {!testId && (
        <Banner
          tone="info"
          size="sm"
          description="Сохраните тест, чтобы настраивать балл, цену ответа и сложность отдельных вопросов."
          data-testid="scoring-create-hint"
        />
      )}

      {model.sections.map((section) => {
        const questions = questionsByTopic.get(section.topicId) ?? [];
        const poolSize = section.maxQuestions || questions.length;
        const drawLabel = section.drawAll
          ? `вся тема (${poolSize})`
          : `выдача ${section.drawCount} из ${poolSize}`;

        return (
          <div className="tb-qscoring__sec" key={section.topicId} data-testid={`scoring-sec-${section.topicId}`}>
            <div className="tb-qscoring__sec-head">
              <span className="tb-qscoring__sec-name">{section.topicName}</span>
              <Tag tone="neutral" variant="outline">{drawLabel}</Tag>
              <span className="tb-qscoring__sec-default">
                <span className="tb-qscoring__sec-default-lbl">Балл по умолчанию в секции</span>
                <Input
                  size="s"
                  className="tb-qscoring__num"
                  inputMode="numeric"
                  value={section.defaultPoints?.toString() ?? ""}
                  placeholder={(model.scoring.defaultQuestionPoints ?? 1).toString()}
                  disabled={readOnly}
                  aria-label={`Балл по умолчанию секции ${section.topicName}`}
                  onChange={(e) => setSectionDefault(section.topicId, e.target.value)}
                  data-testid={`scoring-sec-default-${section.topicId}`}
                />
              </span>
            </div>

            {testId && questions.length > 0 && (
              <table className="tb-table">
                <thead>
                  <tr>
                    <th>Вопрос</th>
                    <th>Балл</th>
                    <th>Цена ответа</th>
                    <th>Сложность</th>
                    <th aria-label="Состояние" />
                    <th aria-label="Действия" />
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => {
                    const override: QuestionScoringOverride | undefined = overrideByQuestion.get(q.id);
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
                      // T-40: the question no longer carries points/scoringJson;
                      // the chain resolves from the override and the defaults.
                      questionContentHash: q.contentHash ?? null,
                    });
                    const difficulty = override?.difficulty ?? q.difficulty;
                    const cellTitle = "Настроено в тесте";
                    const openModal = () =>
                      setModalState({
                        question: q,
                        sectionName: section.topicName,
                        sectionDefaultPoints: section.defaultPoints,
                      });

                    return (
                      <tr
                        key={q.id}
                        className={override ? "tb-qscoring__row--override" : undefined}
                        data-testid={`scoring-row-${q.id}`}
                      >
                        <td>{q.prompt}</td>
                        <td
                          className={override?.points != null ? "tb-qscoring__cell--override" : undefined}
                          title={override?.points != null ? cellTitle : undefined}
                        >
                          {effective.points}
                        </td>
                        <td
                          className={override?.scoringJson != null ? "tb-qscoring__cell--override" : undefined}
                          title={override?.scoringJson != null ? cellTitle : undefined}
                        >
                          <Tag tone="neutral" variant="outline">
                            {KIND_LABEL[effective.scoring.kind] ?? effective.scoring.kind}
                          </Tag>
                        </td>
                        <td
                          className={override?.difficulty != null ? "tb-qscoring__cell--override" : undefined}
                          title={override?.difficulty != null ? cellTitle : undefined}
                        >
                          {difficulty}
                        </td>
                        <td>
                          {effective.stale && (
                            <Tag
                              tone="warning"
                              title="Состав вариантов вопроса изменился после настройки оценки"
                              data-testid={`scoring-stale-${q.id}`}
                            >
                              Настройка устарела
                            </Tag>
                          )}
                        </td>
                        <td>
                          <div className="tb-qscoring__actions">
                            <IconButton
                              icon={<Pencil width={14} height={14} aria-hidden="true" />}
                              variant="ghost"
                              size="s"
                              aria-label={override ? "Изменить оценку вопроса" : "Настроить оценку вопроса"}
                              disabled={readOnly}
                              onClick={openModal}
                              data-testid={`scoring-edit-${q.id}`}
                            />
                            {override && (
                              <IconButton
                                icon={<RotateCcw width={14} height={14} aria-hidden="true" />}
                                variant="ghost"
                                size="s"
                                aria-label="Сбросить настройку оценки"
                                disabled={readOnly || resetOverride.isPending}
                                onClick={() => resetOverride.mutate({ questionId: q.id })}
                                data-testid={`scoring-reset-${q.id}`}
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
          </div>
        );
      })}

      {modalState && testId && (
        <QuestionScoringModal
          testId={testId}
          question={modalState.question}
          sectionName={modalState.sectionName}
          override={overrideByQuestion.get(modalState.question.id) ?? null}
          sectionDefaultPoints={modalState.sectionDefaultPoints}
          testDefaultPoints={model.scoring.defaultQuestionPoints}
          readOnly={readOnly}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}
