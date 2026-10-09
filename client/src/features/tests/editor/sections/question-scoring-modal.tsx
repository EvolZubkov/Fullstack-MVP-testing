/**
 * @module features/tests/editor/sections/question-scoring-modal
 * @description «Оценка вопроса в тесте» (PRD-15 block D, FR-30/FR-34/FR-35):
 * the per-(test, question) override modal. Edits the three independent links
 * of the effective chain — балл, цена ответа (the relocated PRD-10 constructor)
 * and сложность — for THIS test only; the question's content stays in the bank.
 *
 * Semantics: an empty «Балл»/«Сложность» field inherits (placeholder shows the
 * inherited value); the constructor initialises from the override config.
 * «Применить» writes the override into the editor DRAFT (`onApply`); «Сбросить
 * настройку» drops it (`onReset`). An all-empty apply equals a reset. Nothing
 * touches the server here — the editor persists the draft on the single
 * «Сохранить», where the question's current contentHash is pinned (also the
 * «Подтвердить актуальность» action for a stale override).
 *
 * Source of truth for the layout:
 * docs/wireframes/approved/prd15-test-scoring.html (s-override / s-stale).
 */

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Banner, Box, Button, Input, ModalDialog, Tag } from "@skillum/ui-kit";

import { distributesBudget, isSimulation } from "@shared/questions/question-type";
import { questionLabel } from "@shared/questions/question-label";
import { resolveSimScoring, type ResolvedSimScoring } from "@shared/sim/scoring";
import { summarizeScenario } from "@shared/sim/validate";
import type { Scenario } from "@shared/sim/contract";
import type { SimScoringSettings } from "@shared/schema";
import { plural } from "@/features/questions/scenario/scenario-summary";
import { SimPartialChoice, SimPenaltiesTable } from "./sim-penalties";
import type { CorrectData } from "@shared/scoring/engine";
import type { Question, QuestionScoring } from "@shared/schema";
import type { QuestionScoringOverride, QuestionScoringPatch } from "../scoring-api";
import { ScorePreviewModal } from "./score-preview-modal";
import {
  ScoringBuilder,
  buildScoringJson,
  parseScoringJson,
  type ScoringMode,
  type TierDraft,
} from "./scoring-builder";

export type QuestionScoringModalProps = {
  question: Question;
  /** Topic name shown in the modal subtitle. */
  sectionName: string;
  /**
   * «Сценарий в ИС»: вопрос открыт из карточки пункта-сценария — подзаголовок называет пункт, а не
   * тему. Нет — тема.
   */
  sectionKind?: "topic" | "scenario";
  /**
   * «Сценарий в ИС» (Э5а): штрафы и частичное выполнение уровнем выше (тест → система) — подсказки
   * пустых полей окна сценария.
   */
  simInherited?: ResolvedSimScoring;
  override: QuestionScoringOverride | null;
  sectionDefaultPoints: number | null;
  testDefaultPoints: number | null;
  readOnly?: boolean;
  /** «Применить»: write the override into the draft (persisted on «Сохранить»). */
  onApply: (patch: QuestionScoringPatch) => void;
  /** «Сбросить настройку»: drop the override from the draft. */
  onReset: () => void;
  onClose: () => void;
};

import type { QuestionType as BuilderQuestionType } from "@shared/questions/question-type";

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

/** Без цепочки уровнем выше окно сценария подсказывает системные умолчания. */
const FALLBACK_SIM: ResolvedSimScoring = resolveSimScoring(null, null);

/** Штрафы вопроса для сохранения: ничего не задано — переопределения нет. */
function simulationScoring(
  penalties: NonNullable<SimScoringSettings["penalties"]>,
  countPartial: boolean | null,
): QuestionScoring | null {
  const hasPenalties = Object.keys(penalties).length > 0;
  if (!hasPenalties && countPartial === null) return null;
  return {
    kind: "simulation",
    ...(hasPenalties ? { penalties } : {}),
    ...(countPartial !== null ? { countPartial } : {}),
  };
}

/** «Сценарий: 11 сцен, 1 ловушка, 4 проверки цели. » — из сводки хранимого сценария. */
function scenarioFacts(question: Question): string {
  const scenario = (question.dataJson as { scenario?: Scenario } | null)?.scenario;
  if (!scenario?.scenes) return "";
  try {
    const s = summarizeScenario(scenario);
    return `Сценарий: ${plural(s.scenes, ["сцена", "сцены", "сцен"])}, ${plural(s.traps, ["ловушка", "ловушки", "ловушек"])}, ${plural(s.checks, ["проверка", "проверки", "проверок"])} цели. `;
  } catch {
    return "";
  }
}

export function QuestionScoringModal(props: QuestionScoringModalProps) {
  const {
    question, sectionName, sectionKind = "topic", simInherited, override,
    sectionDefaultPoints, testDefaultPoints, readOnly, onApply, onReset, onClose,
  } = props;

  // «Сценарий в ИС» (Э5а): у сценария вместо способа оценки — штрафы прогона по цепочке.
  const simulation = isSimulation(question.type);
  const ownSim = override?.scoringJson?.kind === "simulation" ? override.scoringJson : null;
  const [simPenalties, setSimPenalties] = useState<NonNullable<SimScoringSettings["penalties"]>>(ownSim?.penalties ?? {});
  const [simPartial, setSimPartial] = useState<boolean | null>(
    typeof ownSim?.countPartial === "boolean" ? ownSim.countPartial : null,
  );

  const type = question.type as BuilderQuestionType;
  const options = questionOptions(question);

  // The constructor initialises from the per-test override config (T-40: the
  // question no longer carries its own scoring — the chain starts at the override).
  const initial = parseScoringJson(override?.scoringJson ?? null);
  const [points, setPoints] = useState(override?.points?.toString() ?? "");
  const [difficulty, setDifficulty] = useState(override?.difficulty?.toString() ?? "");
  const [mode, setMode] = useState<ScoringMode>(initial.mode);
  const [weights, setWeights] = useState<string[]>(initial.weights);
  const [tiers, setTiers] = useState<TierDraft[]>(initial.tiers);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // The preview scores the config as it stands in the constructor, not the saved
  // one — the point is to see what an edit does BEFORE «Применить» (PRD-10 §7).
  const draftScoring = buildScoringJson(type, options, mode, weights, tiers) as QuestionScoring | null;
  const gradable = !distributesBudget(type);

  const stale =
    !!override?.pinnedContentHash &&
    !!question.contentHash &&
    override.pinnedContentHash !== question.contentHash;

  const inheritedPoints = sectionDefaultPoints ?? testDefaultPoints ?? 1;

  const apply = () => {
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
    // The constructor result is the override config. T-40: the question has no
    // own graded config to shadow, so exact mode with no built config = null
    // (no scoring override; the chain falls through to the system exact default).
    const built = simulation
      ? simulationScoring(simPenalties, simPartial)
      : (buildScoringJson(type, options, mode, weights, tiers) as QuestionScoring | null);
    // Deferred: hand the patch to the editor draft. The section pins the
    // question's current contentHash and persists on «Сохранить».
    onApply({ points: parsedPoints, scoringJson: built ?? null, difficulty: parsedDifficulty });
  };

  return (
    <ModalDialog
      open
      onClose={onClose}
      size="l"
      title="Оценка вопроса в тесте"
      // Тема, а не «секция»: так этот же объект назван в «Составе» и в «Оценке ответа», а
      // два имени у одного места заставляют автора гадать, одно ли это.
      description={sectionKind === "scenario" ? `Пункт «${sectionName}»` : `Тема «${sectionName}»`}
      footer={
        <>
          {/* Левая зона футера (эскиз: ou-modal__foot--between). */}
          <Button
            className="tb-qscoring__foot-left"
            variant="ghost"
            leadingIcon={<RotateCcw size={14} aria-hidden="true" />}
            onClick={onReset}
            disabled={readOnly || !override}
            data-testid="qscoring-reset"
          >
            Сбросить настройку
          </Button>
          <Button variant="ghost" onClick={onClose} data-testid="qscoring-cancel">
            Отмена
          </Button>
          {gradable && !simulation && (
            <Button
              variant="secondary"
              onClick={() => setPreviewOpen(true)}
              data-testid="qscoring-preview"
            >
              Предпросмотр балла
            </Button>
          )}
          <Button
            variant="primary"
            onClick={apply}
            disabled={readOnly}
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

      {simulation ? (
        <div className="tb-qscoring__recap" data-testid="qscoring-sim-recap">
          <b>{questionLabel(question)}</b>
          <br />
          {scenarioFacts(question)}Базовая сложность вопроса: {question.difficulty ?? "не задана"}. Сцены,
          действия и проверки правятся в архиве сценария; здесь — только оценка для этого теста.
        </div>
      ) : (
      <div className="tb-qscoring__recap">
        <b>{question.prompt}</b>
        <br />
        Базовая сложность вопроса: {question.difficulty}. Текст и варианты правятся в банке
        вопросов; здесь — только оценка для этого теста.
      </div>
      )}

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
          placeholder={question.difficulty != null ? question.difficulty.toString() : "не задано"}
          disabled={readOnly}
          hint="Используется адаптивной выдачей. Пусто — базовая сложность вопроса."
          onChange={(e) => setDifficulty(e.target.value)}
          data-testid="qscoring-difficulty"
        />
      </div>

      {/* PRD-44 FR-10: распределение баллов не проверяется вовсе, поэтому
          градуированной цены у него нет — конструктор заменяется объяснением.
          Показать его отключённым значило бы намекнуть, что настройка существует,
          но чем-то заблокирована. */}
      {previewOpen && (
        <ScorePreviewModal
          type={type}
          options={options}
          correct={(question.correctJson ?? {}) as CorrectData}
          scoring={draftScoring}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {simulation ? (
        <>
          <div className="tb-qscoring__price">
            <span className="tb-qscoring__price-lbl">Цена ответа · штрафы</span>
            <Tag tone="neutral" variant="outline">% цены вопроса за каждый случай</Tag>
          </div>
          <SimPenaltiesTable
            value={simPenalties}
            inherited={(simInherited ?? FALLBACK_SIM).penalties}
            onChange={setSimPenalties}
            disabled={readOnly}
            label="Штрафы сценария в этом тесте"
            testIdPrefix="qscoring-sim"
          />
          <SimPartialChoice
            value={simPartial}
            inherited={(simInherited ?? FALLBACK_SIM).countPartial}
            onChange={setSimPartial}
            disabled={readOnly}
          />
        </>
      ) : distributesBudget(type) ? (
        <Box border="dashed" radius="m" pad={4} style={{ color: "var(--ou-fg-muted)" }} data-testid="qscoring-allocation-note">
          Распределение баллов не проверяется и баллов не приносит: его результат — вклад в шкалы,
          который задаётся на вкладке «Вклады вопросов». Цена ответа к типу неприменима.
        </Box>
      ) : (
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
      )}
    </ModalDialog>
  );
}
