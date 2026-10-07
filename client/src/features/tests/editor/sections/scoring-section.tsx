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
 * Сохранённого теста вкладка НЕ требует: вопросы приходят из банка, а обе части
 * состояния — умолчания и переопределения — живут в модели. У нового теста они
 * дописываются сразу после INSERT тем же `saveQuestionOverrides`.
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
import { ChevronDown, ChevronRight, CircleDot, MonitorPlay, Pencil, RotateCcw } from "lucide-react";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger, IconButton, Input, Tag,
} from "@skillum/ui-kit";

import { resolveEffectiveScoring } from "@shared/scoring/effective-scoring";
import { isSimulation } from "@shared/questions/question-type";
import { questionLabel } from "@shared/questions/question-label";
import { resolveSimScoring } from "@shared/sim/scoring";
import type { Question, SimScoringSettings } from "@shared/schema";
import type { ScenarioItemDraft, TestEditorModel } from "../test-editor.types";
import { compositionEntries } from "./composition-items";
import { SimPartialSwitch, SimPenaltiesTable } from "./sim-penalties";
import {
  makeQuestionOverride,
  overridesScoring,
  type QuestionScoringOverride,
  type QuestionScoringPatch,
} from "../scoring-api";
import { FoldAllButtons, useSectionFold } from "./section-fold";
import { QuestionScoringModal } from "./question-scoring-modal";
import { QUESTION_TYPE_ICON, QUESTION_TYPE_LABEL } from "./question-type-icon";

export type ScoringSectionProps = {
  model: TestEditorModel;
  /**
   * Тест, если он уже существует; `undefined` в режиме создания. Вкладка от него не
   * зависит: вопросы приходят из банка, а переопределения лежат в черновике модели и
   * дописываются сразу после создания теста (см. `useTestEditor`). Идентификатор
   * нужен только строке переопределения — и только чтобы она не мешала сравнению
   * черновика со снимком.
   */
  testId?: string;
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  readOnly?: boolean;
};

type QuestionRow = Question & { topicName?: string };

import type { QuestionType } from "@shared/questions/question-type";

// Pictogram and label of a question type — shared with «Вклады вопросов».
const TYPE_ICON = QUESTION_TYPE_ICON;
const TYPE_LABEL = QUESTION_TYPE_LABEL;

/** Human label of a graded-config kind (PRD-10). */
const KIND_LABEL: Record<string, string> = {
  exact: "Точное",
  weighted: "Веса",
  tiered: "Ступени",
  // «Сценарий в ИС» (Э5а): сценарий оценивается штрафами прогона.
  simulation: "Штрафы",
};

/**
 * Одна карточка списка «Оценки ответа» — раздел темы или пункт-сценарий (Э5а). Устроены одинаково:
 * шапка с выдачей и баллом по умолчанию, ниже таблица вопросов.
 */
type ScoringCard = {
  key: string;
  name: string;
  kind: "topic" | "scenario";
  drawLabel: string;
  defaultPoints: number | null;
  setDefault: (raw: string) => void;
  questions: QuestionRow[];
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
    sectionKind: "topic" | "scenario";
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

  /**
   * «Сценарий в ИС» (Э5а): пункты-сценарии, которые тест сейчас выдаёт, — у теста «Сценарий» его
   * единственный пункт, у роутера все. От них зависят и карточки пунктов, и блок штрафов.
   */
  const activeItems = useMemo<ScenarioItemDraft[]>(() => {
    if (model.mode === "scenario") return (model.scenarioItems ?? []).slice(0, 1);
    return compositionEntries(model).flatMap((e) => (e.kind === "scenario" ? [e.item] : []));
  }, [model]);

  const setItemDefault = (itemId: string | undefined, raw: string) => {
    const parsed = parseDefaultPoints(raw);
    if (parsed === undefined) return;
    updateModel((m) => ({
      ...m,
      scenarioItems: (m.scenarioItems ?? []).map((item) => (item.id === itemId ? { ...item, defaultPoints: parsed } : item)),
    }));
  };

  /** Карточки в порядке состава: темы и пункты-сценарии; у теста «Сценарий» — только пункт. */
  const cards: ScoringCard[] = (() => {
    const topicCard = (topicId: string): ScoringCard | null => {
      const section = model.sections.find((s) => s.topicId === topicId);
      if (!section) return null;
      // Обычный раздел сценариев пока не выдаёт (техдолг трека, п. 5) — и в оценке их нет.
      const questions = (questionsByTopic.get(section.topicId) ?? []).filter((q) => !isSimulation(q.type));
      const poolSize = section.maxQuestions || questions.length;
      return {
        key: section.topicId,
        name: section.topicName,
        kind: "topic",
        drawLabel: section.drawAll ? `вся тема (${poolSize})` : `выдача ${section.drawCount} из ${poolSize}`,
        defaultPoints: section.defaultPoints,
        setDefault: (raw) => setSectionDefault(section.topicId, raw),
        questions,
      };
    };
    const itemCard = (item: ScenarioItemDraft, index: number): ScoringCard => {
      const bank = (questionsByTopic.get(item.topicId) ?? []).filter((q) => isSimulation(q.type));
      const questions = item.questionId ? bank.filter((q) => q.id === item.questionId) : bank;
      return {
        key: `scenario:${item.id ?? index}`,
        name: item.title?.trim() || item.topicName,
        kind: "scenario",
        drawLabel: item.questionId ? "фиксированный" : `выдаётся 1 из ${bank.length}`,
        defaultPoints: item.defaultPoints ?? null,
        setDefault: (raw) => setItemDefault(item.id, raw),
        questions,
      };
    };
    if (model.mode === "scenario") return activeItems.map(itemCard);
    return compositionEntries(model).flatMap((entry, n) => {
      if (entry.kind === "scenario") return [itemCard(entry.item, n)];
      const card = topicCard(entry.section.topicId);
      return card ? [card] : [];
    });
  })();

  // ── Per-section folding (ephemeral view state, all expanded on open) ──────────
  const fold = useSectionFold(cards.map((c) => c.key));

  /** Штрафы уровнем выше для окна вопроса-сценария: тест, а где он молчит — система. */
  const simTestLevel = resolveSimScoring(model.scoring.simDefaults ?? null, null);
  const setSimDefaults = (patch: SimScoringSettings) =>
    updateModel((m) => ({
      ...m,
      scoring: { ...m.scoring, simDefaults: { ...(m.scoring.simDefaults ?? {}), ...patch } },
    }));

  return (
    <div className="tb-qscoring" data-testid="scoring-section">
      <div className="tb-qscoring__default-row">
        <span className="tb-qscoring__default-lbl">Балл за вопрос по умолчанию</span>
        <Input
          size="m"
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
        {/* С блоком штрафов кнопки свёртки уходят под него, к карточкам, которые сворачивают
            (эскиз sim-e5-answer); без него стоят здесь, как прежде. */}
        {cards.length > 0 && activeItems.length === 0 && (
          <FoldAllButtons fold={fold} testIdPrefix="scoring" />
        )}
      </div>

      {/* «Сценарий в ИС» (Э5а, эскиз sim-e5-answer): штрафы сценариев теста по умолчанию — только
          когда в тесте есть сценарий. Пустое поле — системное умолчание, оно в подсказке. */}
      {activeItems.length > 0 && (
        <>
          <div className="tb-qscoring__price">
            <span className="tb-qscoring__price-lbl">Штрафы сценариев по умолчанию</span>
            <Tag tone="neutral" variant="outline">% цены вопроса за каждый случай</Tag>
          </div>
          <SimPenaltiesTable
            value={model.scoring.simDefaults?.penalties}
            inherited={resolveSimScoring(null, null).penalties}
            onChange={(penalties) => setSimDefaults({ penalties })}
            disabled={readOnly}
            label="Штрафы сценариев по умолчанию"
            testIdPrefix="scoring-sim"
          />
          <SimPartialSwitch
            checked={simTestLevel.countPartial}
            onChange={(countPartial) => setSimDefaults({ countPartial })}
            disabled={readOnly}
          />
          <div className="tb-fold-toolbar">
            <FoldAllButtons fold={fold} testIdPrefix="scoring" />
          </div>
        </>
      )}

      {cards.map((card) => {
        const open = fold.isOpen(card.key);
        return (
          <div className="tb-fold-sec" key={card.key} data-testid={`scoring-sec-${card.key}`}>
            <Collapsible open={open} onOpenChange={() => fold.toggle(card.key)}>
              <div className="tb-fold-sec-head">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="tb-fold-trigger"
                    aria-label={open ? `Свернуть секцию ${card.name}` : `Развернуть секцию ${card.name}`}
                    data-testid={`scoring-sec-toggle-${card.key}`}
                  >
                    {open
                      ? <ChevronDown className="tb-fold-chev" width={16} height={16} aria-hidden="true" />
                      : <ChevronRight className="tb-fold-chev" width={16} height={16} aria-hidden="true" />}
                    <span className="tb-fold-sec-name">
                      {card.kind === "scenario" && (
                        <MonitorPlay className="tb-acc-title-ico" width={16} height={16} aria-label="Сценарий" />
                      )}
                      {card.name}
                    </span>
                  </button>
                </CollapsibleTrigger>
                <Tag tone="neutral" variant="outline">{card.drawLabel}</Tag>
                <span className="tb-qscoring__sec-default">
                  <span className="tb-qscoring__sec-default-lbl">Балл по умолчанию в секции</span>
                  <Input
                    size="s"
                    className="tb-qscoring__num"
                    inputMode="numeric"
                    value={card.defaultPoints?.toString() ?? ""}
                    placeholder={(model.scoring.defaultQuestionPoints ?? 1).toString()}
                    disabled={readOnly}
                    aria-label={`Балл по умолчанию секции «${card.name}»`}
                    onChange={(e) => card.setDefault(e.target.value)}
                    data-testid={`scoring-sec-default-${card.key}`}
                  />
                </span>
              </div>

              <CollapsibleContent>
                <div className="tb-fold-sec__body">
            {card.questions.length > 0 && (
              <table className="tb-table" aria-label={card.kind === "scenario" ? `Оценка сценариев пункта «${card.name}»` : `Оценка вопросов темы «${card.name}»`}>
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
                  {card.questions.map((q) => {
                    const override: QuestionScoringOverride | undefined = overrideByQuestion.get(q.id);
                    // Строка, заведённая аналитикой ради «исключён из выдачи», в оценке ничего
                    // не задаёт: ни отметки, ни «Сбросить» у неё быть не должно.
                    const configured = overridesScoring(override);
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
                        sectionDefaultPoints: card.defaultPoints,
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
                        sectionName: card.name,
                        sectionKind: card.kind,
                        sectionDefaultPoints: card.defaultPoints,
                      });

                    return (
                      <tr
                        key={q.id}
                        className={configured ? "tb-qscoring__row--override" : undefined}
                        data-testid={`scoring-row-${q.id}`}
                      >
                        <td>
                          <span className="tb-qscoring__qtype" title={TYPE_LABEL[qType] ?? qType}>
                            <TypeIcon width={16} height={16} aria-hidden="true" />
                          </span>
                          {questionLabel(q)}
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
                            {isSimulation(q.type) ? KIND_LABEL.simulation : (KIND_LABEL[effective.scoring.kind] ?? effective.scoring.kind)}
                          </Tag>
                        </td>
                        <td
                          className={override?.difficulty != null ? "tb-qscoring__cell--override" : undefined}
                          title={override?.difficulty != null ? cellTitle : undefined}
                        >
                          {difficulty}
                        </td>
                        <td>
                          {/* Колонка «Состояние» говорит о ПЕРЕОПРЕДЕЛЕНИИ, а не только о
                              его порче: подсветка ячеек показывает, ЧТО задано, а тег —
                              что строка вообще настроена в тесте. Устаревание — частный
                              случай, и тогда тег говорит о нём. */}
                          {effective.stale ? (
                            <Tag
                              tone="warning"
                              title="Состав вариантов вопроса изменился после настройки оценки"
                              data-testid={`scoring-stale-${q.id}`}
                            >
                              Настройка устарела
                            </Tag>
                          ) : configured ? (
                            <Tag tone="warning" data-testid={`scoring-override-${q.id}`}>
                              задано в тесте
                            </Tag>
                          ) : null}
                        </td>
                        <td>
                          <div className="tb-qscoring__actions">
                            <IconButton
                              icon={<Pencil width={14} height={14} aria-hidden="true" />}
                              variant="ghost"
                              size="s"
                              aria-label={configured ? "Изменить оценку вопроса" : "Настроить оценку вопроса"}
                              disabled={readOnly}
                              onClick={openModal}
                              data-testid={`scoring-edit-${q.id}`}
                            />
                            {configured && (
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
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}

      {modalState && (
        <QuestionScoringModal
          question={modalState.question}
          sectionName={modalState.sectionName}
          sectionKind={modalState.sectionKind}
          simInherited={simTestLevel}
          override={(() => {
            const o = overrideByQuestion.get(modalState.question.id);
            return overridesScoring(o) ? o! : null;
          })()}
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
