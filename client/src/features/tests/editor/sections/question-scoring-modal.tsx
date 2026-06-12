/**
 * @module features/tests/editor/sections/question-scoring-modal
 * @description «Оценка вопроса в тесте» (PRD-15 block D, FR-30/FR-34/FR-35):
 * the per-(test, question) override modal. Edits the three independent links
 * of the effective chain — балл, цена ответа (the relocated PRD-10 constructor)
 * and сложность — for THIS test only; the question's content stays in the bank.
 *
 * Semantics: an empty «Балл»/«Сложность» field inherits (placeholder shows the
 * inherited value); the constructor initialises from the override config or,
 * transitionally, the question's own `scoringJson`. «Применить» upserts the
 * override (the server pins the question's current contentHash — also the
 * «Подтвердить актуальность» action for a stale override); «Сбросить
 * настройку» deletes it. An all-empty apply equals a reset (the server clears
 * the row).
 *
 * Source of truth for the layout:
 * docs/wireframes/approved/prd15-test-scoring.html (s-override / s-stale).
 */

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Banner, Button, Input, ModalDialog } from "@universityrt/ui-kit";

import type { Question, QuestionScoring } from "@shared/schema";
import {
  useResetQuestionScoring,
  useSaveQuestionScoring,
  type QuestionScoringOverride,
} from "../scoring-api";
import {
  ScoringBuilder,
  buildScoringJson,
  parseScoringJson,
  type ScoringMode,
  type TierDraft,
} from "./scoring-builder";

export type QuestionScoringModalProps = {
  testId: string;
  question: Question;
  /** Topic name shown in the modal subtitle. */
  sectionName: string;
  override: QuestionScoringOverride | null;
  sectionDefaultPoints: number | null;
  testDefaultPoints: number | null;
  readOnly?: boolean;
  onClose: () => void;
};

type BuilderQuestionType = "single" | "multiple" | "matching" | "ranking";

/** Answer options of the question (weight labels for the constructor). */
function questionOptions(question: Question): string[] {
  const data = question.dataJson as { options?: string[] } | null;
  return Array.isArray(data?.options) ? data.options : [];
}

/** Parse an override numeric field: "" = inherit (null); invalid = undefined. */
function parseOverrideNumber(raw: string, max?: number): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || (max !== undefined && n > max)) return undefined;
  return n;
}

export function QuestionScoringModal(props: QuestionScoringModalProps) {
  const {
    testId, question, sectionName, override,
    sectionDefaultPoints, testDefaultPoints, readOnly, onClose,
  } = props;

  const save = useSaveQuestionScoring(testId);
  const reset = useResetQuestionScoring(testId);

  const type = question.type as BuilderQuestionType;
  const options = questionOptions(question);

  // The constructor initialises from the override config or, transitionally,
  // the question's own scoringJson (the value that currently applies).
  const initial = parseScoringJson(override?.scoringJson ?? question.scoringJson ?? null);
  const [points, setPoints] = useState(override?.points?.toString() ?? "");
  const [difficulty, setDifficulty] = useState(override?.difficulty?.toString() ?? "");
  const [mode, setMode] = useState<ScoringMode>(initial.mode);
  const [weights, setWeights] = useState<string[]>(initial.weights);
  const [tiers, setTiers] = useState<TierDraft[]>(initial.tiers);
  const [error, setError] = useState<string | null>(null);

  const stale =
    !!override?.pinnedContentHash &&
    !!question.contentHash &&
    override.pinnedContentHash !== question.contentHash;

  const inheritedPoints = sectionDefaultPoints ?? testDefaultPoints ?? (question.points || 1);

  const apply = async () => {
    const parsedPoints = parseOverrideNumber(points);
    const parsedDifficulty = parseOverrideNumber(difficulty, 100);
    if (parsedPoints === undefined) {
      setError("Балл должен быть целым числом не меньше 0.");
      return;
    }
    if (parsedDifficulty === undefined) {
      setError("Сложность должна быть целым числом от 0 до 100.");
      return;
    }
    // The constructor result is the override config. Exact is an EXPLICIT
    // override only when it shadows the question's own graded config;
    // otherwise null = no scoring override (the chain falls through).
    const built = buildScoringJson(type, options, mode, weights, tiers) as QuestionScoring | null;
    const scoringJson: QuestionScoring | null =
      built ?? (mode === "exact" && question.scoringJson ? { kind: "exact" } : null);
    try {
      await save.mutateAsync({
        questionId: question.id,
        patch: { points: parsedPoints, scoringJson, difficulty: parsedDifficulty },
      });
      onClose();
    } catch (e) {
      setError((e as Error).message || "Не удалось сохранить оценку вопроса.");
    }
  };

  const resetToDefaults = async () => {
    try {
      if (override) await reset.mutateAsync({ questionId: question.id });
      onClose();
    } catch (e) {
      setError((e as Error).message || "Не удалось сбросить настройку.");
    }
  };

  const busy = save.isPending || reset.isPending;

  return (
    <ModalDialog
      open
      onClose={onClose}
      size="l"
      title="Оценка вопроса в тесте"
      description={`Секция «${sectionName}»`}
      footer={
        <>
          {/* Левая зона футера (эскиз: ou-modal__foot--between). */}
          <Button
            className="tb-qscoring__foot-left"
            variant="ghost"
            leadingIcon={<RotateCcw size={14} aria-hidden="true" />}
            onClick={resetToDefaults}
            disabled={readOnly || busy || !override}
            data-testid="qscoring-reset"
          >
            Сбросить настройку
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy} data-testid="qscoring-cancel">
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={apply}
            disabled={readOnly || busy}
            loading={save.isPending}
            data-testid="qscoring-apply"
          >
            Применить
          </Button>
        </>
      }
      data-testid="qscoring-modal"
    >
      {stale && (
        <Banner
          tone="warning"
          size="sm"
          title="Настройка устарела"
          description="Состав вариантов вопроса изменился после настройки оценки. Проверьте конфигурацию и примените — настройка перепривяжется к текущей версии вопроса."
          data-testid="qscoring-stale-banner"
        />
      )}

      {error && <Banner tone="error" size="sm" description={error} />}

      <div className="tb-qscoring__recap">
        <b>{question.prompt}</b>
        <br />
        Базовая сложность вопроса: {question.difficulty}. Текст и варианты правятся в банке
        вопросов; здесь — только оценка для этого теста.
      </div>

      <div className="tb-qscoring__modal-grid">
        <Input
          size="m"
          fullWidth
          label="Балл за вопрос в этом тесте"
          inputMode="numeric"
          value={points}
          placeholder={inheritedPoints.toString()}
          disabled={readOnly}
          hint="Пусто — балл по цепочке умолчаний. 0 — вопрос без баллов в этом тесте."
          onChange={(e) => setPoints(e.target.value)}
          data-testid="qscoring-points"
        />
        <Input
          size="m"
          fullWidth
          label="Сложность в этом тесте"
          inputMode="numeric"
          value={difficulty}
          placeholder={question.difficulty.toString()}
          disabled={readOnly}
          hint="Используется адаптивной выдачей. Пусто — базовая сложность вопроса."
          onChange={(e) => setDifficulty(e.target.value)}
          data-testid="qscoring-difficulty"
        />
      </div>

      <ScoringBuilder
        type={type}
        options={options}
        mode={mode}
        setMode={setMode}
        weights={weights}
        setWeights={setWeights}
        tiers={tiers}
        setTiers={setTiers}
      />
    </ModalDialog>
  );
}
