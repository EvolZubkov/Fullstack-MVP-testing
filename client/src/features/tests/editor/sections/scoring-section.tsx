/**
 * @module features/tests/editor/sections/scoring-section
 * @description «Оценка» editor tab (PRD-15 block D, FR-30/FR-31/FR-34/FR-35):
 * the test-side scoring. All state here is part of the editor DRAFT and persists
 * with the single drawer «Сохранить» (FR-31); «Закрыть» discards:
 *
 *   - DEFAULTS (test-wide and per-section price) live in `model.scoring`/section.
 *   - PER-QUESTION OVERRIDES live in `model.scoring.questionOverrides`. The modal
 *     «Применить» upserts a row (pinning the question's current contentHash) and
 *     the row «Сбросить» drops it — both mutate the draft via `updateModel`,
 *     nothing hits the server until save. On save the editor reconciles them
 *     against the snapshot (scoring-api `saveQuestionOverrides`); each persisted
 *     PUT/DELETE bumps the test version (FR-12).
 *
 * The questions table shows the EFFECTIVE values (shared resolver). The
 * «настроено в тесте» mark — an accent bar on the row + a soft accent fill on
 * each overridden cell (tooltip «Настроено в тесте») — flags a configured
 * override; while unsaved it also contributes to the tab's unsaved-changes dot.
 * A stale override (the question's variants changed after it was authored, FR-30)
 * carries the «Настройка устарела» tag.
 *
 * Source of truth for the layout:
 * docs/wireframes/approved/prd15-test-scoring.html (s-tab).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckSquare, ChevronDown, ChevronRight, CircleDot, ListOrdered, Pencil, RotateCcw, SlidersHorizontal, ThermometerSun, Unplug,
  type LucideIcon,
} from "lucide-react";
import {
  Banner, Collapsible, CollapsibleContent, CollapsibleTrigger, IconButton, Input, Tag,
} from "@universityrt/ui-kit";

import { resolveEffectiveScoring } from "@shared/scoring/effective-scoring";
import { t } from "@/lib/i18n";
import type { Question } from "@shared/schema";
import type { TestEditorModel } from "../test-editor.types";
import {
  makeQuestionOverride,
  type QuestionScoringOverride,
  type QuestionScoringPatch,
} from "../scoring-api";
import { FoldAllButtons, useSectionFold } from "./section-fold";
import { QuestionScoringModal } from "./question-scoring-modal";

export type ScoringSectionProps = {
  model: TestEditorModel;
  /** Test id; `undefined` in create mode — per-question overrides need a saved test. */
  testId?: string;
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  readOnly?: boolean;
};

type QuestionRow = Question & { topicName?: string };

import type { QuestionType } from "@shared/questions/question-type";

/** Question-type pictograms — same convention as the content tree (content-tree.tsx). */
const TYPE_ICON: Record<QuestionType, LucideIcon> = {
  single: CircleDot,
  multiple: CheckSquare,
  matching: Unplug,
  ranking: ListOrdered,
  scale: ThermometerSun,
  allocation: SlidersHorizontal,
};
const TYPE_LABEL: Record<QuestionType, string> = {
  single: t.questions.singleChoice,
  multiple: t.questions.multipleChoice,
  matching: t.questions.matching,
  ranking: t.questions.ranking,
  scale: t.questions.scaleChoice,
  allocation: t.questions.allocation,
};

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
  // PRD-15 block D: overrides are draft-managed — read from the model, mutate via
  // updateModel; nothing is persisted until the drawer «Сохранить».
  const overrides = model.scoring.questionOverrides;

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

  /**
   * Apply «Применить» to the draft. An all-inherit patch (no points, no graded
   * config, no difficulty) drops the override entirely — parity with the server's
   * clear path and with «Сбросить». Otherwise the row is upserted with the
   * question's CURRENT contentHash pinned (FR-30), which also clears a stale tag.
   */
  const upsertOverride = (question: QuestionRow, patch: QuestionScoringPatch) => {
    updateModel((m) => {
      const others = m.scoring.questionOverrides.filter((o) => o.questionId !== question.id);
      if (patch.points == null && patch.scoringJson == null && patch.difficulty == null) {
        return { ...m, scoring: { ...m.scoring, questionOverrides: others } };
      }
      const prior = m.scoring.questionOverrides.find((o) => o.questionId === question.id);
      const next = makeQuestionOverride({
        id: prior?.id ?? "",
        testId: testId ?? "",
        questionId: question.id,
        points: patch.points,
        scoringJson: patch.scoringJson,
        difficulty: patch.difficulty,
        pinnedContentHash: question.contentHash ?? null,
      });
      return { ...m, scoring: { ...m.scoring, questionOverrides: [...others, next] } };
    });
  };

  /** «Сбросить» — drop the override from the draft (no network until «Сохранить»). */
  const removeOverride = (questionId: string) => {
    updateModel((m) => ({
      ...m,
      scoring: {
        ...m.scoring,
        questionOverrides: m.scoring.questionOverrides.filter((o) => o.questionId !== questionId),
      },
    }));
  };

  // ── Per-section folding (ephemeral view state, all expanded on open) ──────────
  const sectionIds = useMemo(() => model.sections.map((s) => s.topicId), [model.sections]);
  const fold = useSectionFold(sectionIds);

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
        {testId && model.sections.length > 0 && (
          <FoldAllButtons fold={fold} testIdPrefix="scoring" />
        )}
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

        const open = fold.isOpen(section.topicId);

        return (
          <div className="tb-qscoring__sec" key={section.topicId} data-testid={`scoring-sec-${section.topicId}`}>
            <Collapsible open={open} onOpenChange={() => fold.toggle(section.topicId)}>
              <div className="tb-qscoring__sec-head">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="tb-fold-trigger"
                    aria-label={open ? `Свернуть секцию ${section.topicName}` : `Развернуть секцию ${section.topicName}`}
                    data-testid={`scoring-sec-toggle-${section.topicId}`}
                  >
                    {open
                      ? <ChevronDown className="tb-fold-chev" width={16} height={16} aria-hidden="true" />
                      : <ChevronRight className="tb-fold-chev" width={16} height={16} aria-hidden="true" />}
                    <span className="tb-qscoring__sec-name">{section.topicName}</span>
                  </button>
                </CollapsibleTrigger>
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

              <CollapsibleContent>
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
                    const qType = q.type as QuestionType;
                    const TypeIcon = TYPE_ICON[qType] ?? CircleDot;
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
                        <td>
                          <span className="tb-qscoring__qtype" title={TYPE_LABEL[qType] ?? qType}>
                            <TypeIcon width={16} height={16} aria-hidden="true" />
                          </span>
                          {q.prompt}
                        </td>
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
                                disabled={readOnly}
                                onClick={() => removeOverride(q.id)}
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
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}

      {modalState && testId && (
        <QuestionScoringModal
          question={modalState.question}
          sectionName={modalState.sectionName}
          override={overrideByQuestion.get(modalState.question.id) ?? null}
          sectionDefaultPoints={modalState.sectionDefaultPoints}
          testDefaultPoints={model.scoring.defaultQuestionPoints}
          readOnly={readOnly}
          onApply={(patch) => {
            upsertOverride(modalState.question, patch);
            setModalState(null);
          }}
          onReset={() => {
            removeOverride(modalState.question.id);
            setModalState(null);
          }}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}
