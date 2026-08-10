/**
 * @module client/pages/learner/template-question-screen
 *
 * Renders the test-taking question screen from the design template (PRD-12 #3):
 * single, multiple, ranking and matching. The shadow-isolated template provides the
 * chrome (header / progress / question card); the interaction HTML is filled into the
 * `question-interaction` slot from the SHARED emission
 * ({@link module:shared/template/question-interaction}) — the DS `.ou-*` markup the
 * SCORM package renders too — and wired back to React via `data-action`/`data-drag`
 * delegation. React keeps the answer state; the navigation row is part of the
 * template's scene (`.tb-scene__foot`, built from `state.nav`) for BOTH flows, so the
 * host renders no chrome of its own. Matching drags answer chips onto prompt rows using the SHARED pointer
 * engine and the SHARED rich pool model ({@link module:shared/template/dnd/matching-model}),
 * the same engine the SCORM host runs — so both hosts compute drops identically.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { TemplateScreen } from "@/components/template-screen";
import type { Question } from "@shared/schema";
import type { CtxQuestionsProgress } from "@shared/template/context";
import {
  normalizePool,
  dropOnRight,
  dropOnPoolSlot,
  returnToPool,
  type MatchingState,
} from "@shared/template/dnd/matching-model";
import {
  renderSingleChoice,
  renderMultiple,
  renderRanking,
  renderMatching,
  renderScale,
  renderAllocation,
  questionHint,
  answerTexts,
  type ReviewCorrect,
} from "@shared/template/question-interaction";
import { attachAllocation } from "@shared/template/allocation-dom";
import { allocationSpec, seedAllocation } from "@shared/questions/allocation";
import { distributesBudget } from "@shared/questions/question-type";
import { questionFont, optionFont } from "@shared/template/fit-font";
import { buildQuestionNav, QUESTION_NAV_ACTIONS, type QuestionNavState } from "@shared/template/question-nav";
import type { SceneTimersState } from "@shared/template/scene-timers";
import type { ProtectionSpec } from "@shared/template/protection/spec";
import { renderInlineMarkdown } from "@shared/text";
import { renderQuestionMedia } from "@shared/template/question-media";

/** Action names the shared nav row emits (plus the layout's own `nav:next`). */
const NAV_ACTIONS: readonly string[] = Object.values(QUESTION_NAV_ACTIONS);

/** Compute the next answer when option `oi` is toggled, by question type. */
function nextAnswer(question: Question, answer: unknown, oi: number): unknown {
  if (question.type === "multiple") {
    const arr = Array.isArray(answer) ? (answer as number[]) : [];
    return arr.includes(oi) ? arr.filter((x) => x !== oi) : [...arr, oi];
  }
  return oi;
}

/** Current ranking order: the answer if set, else identity/shuffle. */
function rankingOrder(question: Question, answer: unknown, shuffleMapping?: number[]): number[] {
  const items = (question.dataJson as { items?: unknown[] })?.items || [];
  if (Array.isArray(answer) && answer.length === items.length) return answer as number[];
  return shuffleMapping && shuffleMapping.length === items.length ? shuffleMapping : items.map((_, i) => i);
}

/** Reorder ranking by moving the item from `fromPos` to `toPos` (drop). */
function reorderRanking(
  question: Question,
  answer: unknown,
  shuffleMapping: number[] | undefined,
  fromPos: number,
  toPos: number,
): number[] {
  const order = [...rankingOrder(question, answer, shuffleMapping)];
  if (fromPos === toPos || fromPos < 0 || toPos < 0 || fromPos >= order.length || toPos >= order.length) {
    return order;
  }
  const [moved] = order.splice(fromPos, 1);
  order.splice(toPos, 0, moved);
  return order;
}

/** Per-type shuffle mapping: array for choice/ranking, {left,right} for matching. */
type ShuffleMapping = number[] | { left: number[]; right: number[] };

/** The left item indices in display order (shuffle mapping when present, else identity). */
function matchingLeftMapping(question: Question, shuffleMapping?: { left: number[]; right: number[] }): number[] {
  const left = (question.dataJson as { left?: unknown[] })?.left || [];
  return shuffleMapping?.left?.length === left.length ? shuffleMapping.left : left.map((_, i) => i);
}

/**
 * Interaction HTML for the `question-interaction` slot, by question type. Emits the
 * SHARED `.ou-*` markup ({@link module:shared/template/question-interaction}) so the web
 * host and the SCORM package render byte-identical options; the local state helpers
 * ({@link nextAnswer}, {@link reorderRanking}, {@link applyMatchingDrop}) wire the
 * delegated actions back to React.
 */
function interactionHtml(
  question: Question,
  answer: unknown,
  shuffleMapping: ShuffleMapping | undefined,
  poolOrder: number[],
  review?: ReviewCorrect,
): string {
  const arr = Array.isArray(shuffleMapping) ? shuffleMapping : undefined;
  if (question.type === "ranking") return renderRanking(question, answer, arr, review);
  if (question.type === "matching") {
    return renderMatching(question, answer, !Array.isArray(shuffleMapping) ? shuffleMapping : undefined, poolOrder, review);
  }
  if (question.type === "multiple") return renderMultiple(question, answer, arr, review);
  // The scale takes no shuffle mapping: the order of graduations is content, not
  // presentation (see `hasFixedOptionOrder` in shared/questions/question-type).
  if (question.type === "scale") return renderScale(question, answer, review);
  // PRD-44: у распределения нет разметки верности — `review` здесь означает «только
  // чтение», а не «показать правильный ответ», которого у типа не существует.
  if (distributesBudget(question.type)) return renderAllocation(question, answer, review !== undefined, arr);
  return renderSingleChoice(question, answer, arr, review);
}

export interface TemplateQuestionScreenProps {
  tpl: {
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    /** Per-test design-param CSS-var overrides (PRD-7 branding); applied on the shadow host. */
    cssVars?: Record<string, string>;
    /** PRD-23: per-theme colour overrides, printed as CSS. */
    themeCss?: string;
    /** PRD-23: palette pinned by the author; absent means «Авто». */
    dataTheme?: "light" | "dark";
    /** PRD-23: template declares a choice of palettes (see resolveSceneTheme). */
    themed?: boolean;
    /** Per-test branding for the render context (logo). */
    design?: { logoUrl?: string };
  };
  testTitle: string;
  /** Header subtitle under the title ("Попытка N из M"); empty -> title-only header. */
  subtitle?: string;
  /** Bare «Вопрос N из M» — the section goes in {@link sectionName}, not in here. */
  counterLabel: string;
  /**
   * Section (topic) of the current question. Passed to the template as
   * `state.sectionName`, which the layout prints as a tag beside the counter — the
   * SAME context field the SCORM runtime fills, so both hosts render one meta row.
   */
  sectionName?: string;
  progressPercent: number;
  question: Question;
  answer: unknown;
  shuffleMapping?: ShuffleMapping;
  onAnswer: (answer: unknown) => void;
  /** Controlled HTML for the `question-feedback` slot (e.g. after-answer feedback). */
  feedbackHtml?: string;
  /** When true, the interaction is read-only (clicks/drags don't change the answer). */
  locked?: boolean;
  /** When true, render answer-review highlighting (correct/wrong) from `correctAnswer`. */
  reviewMode?: boolean;
  /** Correct-answer key (correctIndex/correctIndices/pairs/correctOrder) for review. */
  correctAnswer?: ReviewCorrect;
  /**
   * Navigation state of the row — REQUIRED, for the standard and the adaptive flow
   * alike. The row is printed from the SHARED emitter INSIDE the scene
   * (`.tb-scene__foot`), exactly as the SCORM runtime prints it: the host builds no
   * footer of its own, since chrome next to the shadow root gets neither the
   * template's scene surface nor the DS palette. Its buttons report back through
   * {@link onNavAction} with the emitter's action names.
   */
  nav: QuestionNavState;
  /** Countdown state for the header timers (shared painter, parity with the package). */
  timers?: SceneTimersState;
  /** Action from the shared nav row (`answer-back`/`answer-skip`/… or `nav:next`). */
  onNavAction?: (action: string) => void;
  /** PRD-19 Block C: progress-pills map (Core-prepared); renders the pill row. */
  questionsProgress?: CtxQuestionsProgress;
  /** PRD-19 Block C: jump to an absolute question index from a pill click. */
  onNavigateToQuestion?: (index: number) => void;
  /** PRD-34 (FR-30): protection decision for the question screen, from the shared builder. */
  protection?: ProtectionSpec;
}

export function TemplateQuestionScreen(props: TemplateQuestionScreenProps) {
  const { tpl, testTitle, counterLabel, progressPercent, question, answer, shuffleMapping } = props;
  const onAnswer = props.onAnswer;

  // Matching keeps the ordered pool as UI state (separate from the graded answer,
  // mirroring the SCORM runtime's `state.matchingPools`), keyed by question id.
  const [poolByQ, setPoolByQ] = useState<Record<string, number[]>>({});
  const poolOrder = poolByQ[question.id] || [];

  // Ranking is NOT auto-seeded as an answer: the delivered order is guaranteed
  // non-correct (createRankingMapping), so an untouched arrangement must not count
  // and «Отправить ответ» stays disabled until the learner actually reorders (the
  // answer is `undefined` until the first drag). The board still displays the
  // shuffled order via rankingOrder's fallback to shuffleMapping.

  // PRD-44: жест ползунка живёт вне React — обработчик читает вопрос и ответ через
  // ссылки, чтобы не пересоздаваться на каждый рендер и не терять привязку.
  const questionRef = useRef(question);
  questionRef.current = question;
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const lockedRef = useRef(props.locked);
  lockedRef.current = props.locked;
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;

  const attachHostInputs = useCallback(
    (shadow: ShadowRoot) =>
      attachAllocation(shadow as never, {
        getSpec: () =>
          distributesBudget(questionRef.current.type)
            ? allocationSpec(questionRef.current.dataJson)
            : null,
        getAnswer: () => answerRef.current,
        onCommit: (next) => onAnswerRef.current(next),
        isLocked: () => lockedRef.current === true,
      }),
    [],
  );

  // Предзаполнение минимумом (FR-30): вопрос с ненулевым минимумом стартует со
  // значениями, а не с нулями, иначе учащийся распределит весь бюджет и застрянет с
  // утверждением, которое уже нечем поднять. Ставится ОДИН раз на нетронутый вопрос.
  useEffect(() => {
    if (!distributesBudget(question.type)) return;
    if (answer !== undefined && answer !== null) return;
    const seed = seedAllocation(allocationSpec(question.dataJson));
    if (Object.keys(seed).length > 0) onAnswer(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const css = `${tpl.css}\n#q-progress-fill{width:${Math.round(progressPercent)}%}`;
  const slots = {
    // Inline, not block: the prompt renders into the scene's `<h2>` heading, and a
    // paragraph inside it would be invalid. The SCORM twin fills the same slot
    // through the same renderer, so the two hosts show identical markup.
    "question-text": renderInlineMarkdown(question.prompt),
    "question-media": renderQuestionMedia(question),
    "question-interaction": interactionHtml(
      question,
      answer,
      shuffleMapping,
      poolOrder,
      props.reviewMode ? props.correctAnswer : undefined,
    ),
    "question-feedback": props.feedbackHtml ?? "",
  };

  /** Apply a matching drop through the shared rich model, persisting pool + answer. */
  const applyMatchingDrop = (dropId: string, dragId: string) => {
    const leftIdx = Number(dragId);
    if (Number.isNaN(leftIdx)) return;
    const sm = !Array.isArray(shuffleMapping) ? shuffleMapping : undefined;
    const leftMapping = matchingLeftMapping(question, sm);
    const pairs = (answer && typeof answer === "object" ? (answer as Record<number, number>) : {});
    const pool = normalizePool(poolOrder, pairs, leftMapping);
    const state: MatchingState = { pairs, pool };
    const from: "pool" | "match" = leftIdx in pairs ? "match" : "pool";
    const payload = { leftIdx, from, poolIndex: from === "pool" ? pool.indexOf(leftIdx) : undefined };

    let next: MatchingState;
    if (dropId === "") {
      // Released away from every zone: a matched chip detaches; a pooled chip stays put.
      if (from !== "match") return;
      next = returnToPool(state, leftIdx);
    } else if (dropId.startsWith("r")) {
      const rightIdx = Number(dropId.slice(1));
      if (Number.isNaN(rightIdx)) return;
      next = dropOnRight(state, payload, rightIdx);
    } else if (dropId.startsWith("pool")) {
      const slot = dropId.indexOf(":") >= 0 ? Number(dropId.slice(dropId.indexOf(":") + 1)) : pool.length;
      next = dropOnPoolSlot(state, payload, Number.isNaN(slot) ? pool.length : slot);
    } else {
      return;
    }

    setPoolByQ((p) => ({ ...p, [question.id]: next.pool }));
    onAnswer(next.pairs);
  };

  return (
    <div
      // No palette on the wrapper: the scene (`.tbh-fill`) covers it entirely and
      // paints its own surface. Painting the host with `tpl.theme` used to show a
      // LIGHT band under a dark scene — the value is read as the first
      // `--background` in theme.css, i.e. always the base (light) palette.
      // PRD-34: запрет выделения и перехват копирования СНЯТЫ с этой обёртки. Раньше они
      // стояли безусловно и только на веб-хосте: настройка теста их не выключала, автор
      // не мог скопировать текст в отладочном прогоне, а пакет вёл себя иначе. Теперь
      // мерой управляет общий механизм (`protection`), одинаковый на обоих хостах.
      className="tbh-screen tbh-col"
    >
      <TemplateScreen
        className="tbh-fill"
        protection={props.protection}
        layout={tpl.layout}
        css={css}
        cssVars={tpl.cssVars}
        themeCss={tpl.themeCss}
        dataTheme={tpl.dataTheme}
        themed={tpl.themed}
        context={{ course: { title: testTitle, subtitle: props.subtitle }, state: { questionCounterLabel: counterLabel, sectionName: props.sectionName, questionHint: questionHint(question.type, question), questionFont: questionFont(question.prompt), optionFont: optionFont(answerTexts(question)), questionsProgress: props.questionsProgress, nav: buildQuestionNav(props.nav) }, design: tpl.design }}
        slots={slots}
        timers={props.timers}
        onShadowReady={attachHostInputs}
        onAction={(action) => {
          // Nav row: reported verbatim, so the caller reads the emitter's own action
          // names. Not gated by `locked` — navigating away is always allowed.
          if (NAV_ACTIONS.includes(action)) {
            props.onNavAction?.(action);
            return;
          }
          // PRD-19 Block C: pill navigation works even when the question is locked
          // (the lock guards answer editing, not navigating away).
          if (action.startsWith("goto:")) {
            const i = Number(action.slice("goto:".length));
            if (!Number.isNaN(i)) props.onNavigateToQuestion?.(i);
            return;
          }
          if (props.locked) return; // read-only while feedback is shown
          if (action.startsWith("select:")) {
            const i = Number(action.slice("select:".length));
            if (!Number.isNaN(i)) onAnswer(nextAnswer(question, answer, i));
            return;
          }
          // Keyboard ranking reorder (ou-rank controls): move a row up/down one slot.
          if (action.startsWith("rank-up:") || action.startsWith("rank-down:")) {
            const up = action.startsWith("rank-up:");
            const pos = Number(action.slice(action.indexOf(":") + 1));
            const map = Array.isArray(shuffleMapping) ? shuffleMapping : undefined;
            if (!Number.isNaN(pos)) onAnswer(reorderRanking(question, answer, map, pos, up ? pos - 1 : pos + 1));
            return;
          }
          if (action.startsWith("drop:")) {
            const sep = action.indexOf(":", 5);
            const dropId = action.slice(5, sep);
            const dragId = action.slice(sep + 1);
            if (question.type === "ranking") {
              const from = Number(dragId);
              const to = Number(dropId);
              const map = Array.isArray(shuffleMapping) ? shuffleMapping : undefined;
              if (!Number.isNaN(from) && !Number.isNaN(to)) {
                onAnswer(reorderRanking(question, answer, map, from, to));
              }
            } else if (question.type === "matching") {
              applyMatchingDrop(dropId, dragId);
            }
          }
        }}
      />
    </div>
  );
}
