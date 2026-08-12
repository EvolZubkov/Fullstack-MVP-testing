import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { ChevronLeft, RotateCcw } from "lucide-react";
import { Box, Button, Card, CardBody, CardHeader, Center, Cluster, ModalDialog, Stack, Text } from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { LoadingState } from "@/components/loading-state";
import { TemplateScreen } from "@/components/template-screen";
import { TemplateQuestionScreen } from "./template-question-screen";
import { fmtIsoDateHuman, fmtIsoInstantHuman } from "./cooldown-format";
import { downloadAttemptReport } from "@/features/learner/attempt-report";
import { deliversShuffledOrder, hasAnswer, rankingDeliveryOrder } from "./answer-gate";
import { isSingleIndexChoice, isMeasurementOnly } from "@shared/questions/question-type";
// PRD-10 (FR-12): мгновенный вердикт по ответу считает тот же движок, что и итоги
// попытки и рантайм SCORM-пакета — второй копии правил оценивания на вебе нет.
import {
  scoreAnswer,
  type CorrectData,
  type QuestionType as ScoredQuestionType,
} from "@shared/scoring/engine";
import { applyDeliveryOrder } from "@shared/draw/assemble-delivery";
import { buildStartState } from "@shared/template/start-state";
import { feedbackBanner, feedbackDesc, feedbackTextFor } from "@shared/template/feedback-banner";
import { buildQuestionProgress } from "@shared/template/question-progress-context";
import { buildReviewContext } from "@shared/template/review-context";
import { QUESTION_NAV_ACTIONS, type QuestionNavState } from "@shared/template/question-nav";
import { buildSectionResultContext, buildSectionIntroContext } from "@shared/template/result-context";
import { buildTransitionContext } from "@shared/template/transition-context";
import {
  buildProtectionSpec,
  type ProtectionSettings,
} from "@shared/template/protection/spec";
// PRD-12 FR-6: content pages render on the web from the SAME structure rules and
// the SAME assembler as the SCORM package — no web-only copy of either.
import { TemplateContentScreen, type ContentScreenTemplate } from "./template-content-screen";
import { buildPageSequence, contentPagesFor, type FlowContentPage } from "@shared/flow/page-sequence";
import { shouldShowReview } from "@shared/flow/review-gate";
import {
  buildRouterHubHtml,
  isRouterReadyToFinish,
  type RouterTopicStatus,
} from "@shared/flow/router-hub";
import type { RenderableContentPage } from "@shared/template/content-page";
import {
  useSectionTimer,
  useAdaptiveSectionTimer,
  prevAccessibleIndex,
  nextAccessibleIndex,
  forceAdvanceTarget,
} from "./use-section-timer";
import { t } from "@/lib/i18n";
import { reportClientError } from "@/lib/report-error";
import { useAuth } from "@/lib/auth";
import type { Question, QuestionScoring, Attempt, Test } from "@shared/schema";

/**
 * Вопрос попытки: строка банка плюс ЭФФЕКТИВНАЯ цена ответа этого теста
 * (PRD-10 FR-12, PRD-15 блок D). `scoring` присылает сервер вместе с ключом
 * ответа — то же поле и то же умолчание, что печёт SCORM-пакет: отсутствие =
 * системное «точное совпадение», 0/1 без частичного балла.
 */
type GradedQuestion = Question & { scoring?: QuestionScoring | null };

interface AttemptWithQuestions extends Attempt {
  questions: GradedQuestion[];
  testTitle: string;
}

/**
 * PRD-12 FR-6: the author content pages that fall between two questions of the
 * run — or, with `null` bounds, before the first question / after the last one.
 *
 * Derived from the SHARED sequence (`shared/flow/page-sequence`), the same one the
 * SCORM runtime walks, so «Структура» and the web run cannot disagree about which
 * pages exist or where they sit.
 *
 * The router hub is skipped here: it is a navigation screen, not a content page,
 * and the web host does not implement the hub yet — see the FR-6 note in the
 * PRD-12 track. Skipping it keeps the linear zones correct instead of rendering
 * the hub as a dead «Далее» page.
 */
/**
 * Splits the zone between two questions at the SECTION BOUNDARY.
 *
 * The boundary screens (обзор раздела / итоги раздела) sit *inside* the gap
 * between two questions of different sections, so the gap cannot be played as one
 * block: the pages of the section being LEFT («после темы», and the test-scope
 * «После теста» at the end of the run) belong before those screens, and the pages
 * of the section being ENTERED («перед темой») belong after them. Playing the gap
 * whole put the next section's «Введение раздела» ahead of the previous section's
 * «Итоги раздела» — verified in the browser.
 */
export function splitZoneAtBoundary(
  sequence: ReturnType<typeof buildPageSequence>["sequence"],
  fromQuestionIndex: number | null,
  toQuestionIndex: number | null,
  topicOf: (questionIndex: number) => string | null,
): { departure: RenderableContentPage[]; arrival: RenderableContentPage[] } {
  const pages = contentPagesBetween(sequence, fromQuestionIndex, toQuestionIndex);
  const fromTopic = fromQuestionIndex === null ? null : topicOf(fromQuestionIndex);
  const toTopic = toQuestionIndex === null ? null : topicOf(toQuestionIndex);
  // Same section (or no crossing at all): nothing is gated by a boundary.
  if (fromTopic === toTopic) return { departure: pages, arrival: [] };
  // Heading to the END of the run: there is no arrival to wait for, so everything
  // left in the gap must play now. Holding pages back here silently dropped the
  // zones of a section that drew NO questions and sat last — the learner never saw
  // «перед темой»/«после темы» for it, which is the very case the section-driven
  // sequence exists to preserve.
  if (toQuestionIndex === null) return { departure: pages, arrival: [] };
  return {
    // Test-scope pages (topicId null) ride with the departure: they are the
    // «После теста» zone, which precedes the results screen.
    departure: pages.filter((p) => {
      const t = (p as { topicId?: string | null }).topicId ?? null;
      return t === fromTopic || t === null;
    }),
    arrival: pages.filter((p) => {
      const t = (p as { topicId?: string | null }).topicId ?? null;
      return t !== fromTopic && t !== null;
    }),
  };
}

export function contentPagesBetween(
  sequence: ReturnType<typeof buildPageSequence>["sequence"],
  fromQuestionIndex: number | null,
  toQuestionIndex: number | null,
): RenderableContentPage[] {
  const positionOf = (qi: number) =>
    sequence.findIndex((item) => item.kind === "question" && item.questionIndex === qi);
  const rawStart = fromQuestionIndex === null ? -1 : positionOf(fromQuestionIndex);
  const rawEnd = toQuestionIndex === null ? sequence.length : positionOf(toQuestionIndex);
  const start = rawStart < 0 ? -1 : rawStart;
  const end = rawEnd < 0 ? sequence.length : rawEnd;
  const pages: RenderableContentPage[] = [];
  for (let i = start + 1; i < end; i += 1) {
    const item = sequence[i];
    if (item.kind === "content" && !item.isRouter) pages.push(item.page as RenderableContentPage);
  }
  return pages;
}

interface FlatQuestion {
  question: GradedQuestion;
  topicName: string;
  /** Owning topic id — drives the per-topic section timer (PRD-4 v1.1 §3.2). */
  topicId: string;
  /** Per-topic time budget in minutes, or null when the topic has no limit. */
  sectionTimeLimitMinutes: number | null;
  index: number;
}

/**
 * PRD-30 FR-19: put the built list into the attempt's delivery stream. The
 * variant stores composition per topic and the stream separately, because under
 * the test-wide «полное перемешивание» the questions of different topics travel
 * interleaved and no concatenation of the sections can express that. Absent
 * stream = section order, which is every other test. `index` is renumbered
 * because navigation keys off it.
 */
function orderedForDelivery(questions: FlatQuestion[], deliveryOrder?: string[] | null): FlatQuestion[] {
  return applyDeliveryOrder(questions, deliveryOrder, (fq) => fq.question.id).map((fq, i) => ({
    ...fq,
    index: i,
  }));
}

interface AdaptiveState {
  attemptId: string;
  testTitle: string;
  showDifficultyLevel: boolean;
  showCorrectAnswers: boolean;
  currentQuestion: {
    id: string;
    question: Question;
    topicName: string;
    /** Owning topic id + budget — drive the adaptive topic timer (PRD-4 v1.1 §3.2). */
    topicId?: string;
    sectionTimeLimitMinutes?: number | null;
    levelName: string;
    questionNumber: number;
    totalInLevel: number;
  } | null;
  totalTopics: number;
  currentTopicIndex: number;
  answer: any;
  lastResult: {
    isCorrect: boolean;
    correctAnswer?: any;
    feedback?: string;
    levelTransition?: {
      type: "up" | "down" | "complete";
      fromLevel: string;
      toLevel: string | null;
      message: string;
    };
    topicTransition?: {
      fromTopic: string;
      toTopic: string;
    };
  } | null;
  isFinished: boolean;
  result: any;
  questionsAnswered: number;
}

/**
 * PRD-19 Block E (FR-07/FR-13): the answers that COUNT for grading. In flexible
 * mode (allowReturnToUnanswered) a question counts only if it was explicitly
 * submitted ('answered'); a surviving draft (selected but never submitted, kept
 * for resume per FR-03b), a skipped or an unanswered question is dropped so it
 * scores 0 (incorrect). Strict mode grades the full answer map as-is (no navigable
 * drafts). Parity with the SCORM runtime's `gradedAnswerFor`. Drafts still persist
 * via save-progress (resume) — only the grading payload is filtered.
 */
function pickGradedAnswers(
  answers: Record<string, any>,
  questionStatus: Record<string, "unanswered" | "answered" | "skipped">,
  flexible: boolean,
): Record<string, any> {
  if (!flexible) return answers;
  const out: Record<string, any> = {};
  for (const k of Object.keys(answers)) {
    if (questionStatus[k] === "answered") out[k] = answers[k];
  }
  return out;
}

/** Escape text for safe injection into a template slot. */
function escSlot(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * After-answer feedback HTML for the question-feedback slot: status + (single/
 * multiple) correct-answer text + the question's feedback. Serves BOTH delivery
 * modes, so the verdict chrome cannot drift between them.
 *
 * PRD-10 (FR-12): the verdict is three-position whenever the caller supplies a
 * `scoreRatio` — right / PARTLY right / wrong, the same tones and the same wording
 * the SCORM package emits from the same ratio (`app/feedback/feedback.js`). The
 * adaptive path deliberately supplies none: its per-answer verdict is binary
 * because a level advance is a yes/no decision, and its server route returns
 * `isCorrect` only.
 */
function adaptiveFeedbackHtml(question: any, result: any): string {
  const ok = !!result.isCorrect;
  const partial = !ok && typeof result.scoreRatio === "number" && result.scoreRatio > 0;
  // Revision «Стандартный»: the verdict is the shared DS `.ou-banner` — the SAME
  // component and semantic success/warning/error tokens the SCORM block emits,
  // so the web and package answer-check feedback cannot drift.
  let body = "";
  const opts = (question.dataJson as any)?.options as unknown[] | undefined;
  if (!ok && result.correctAnswer && opts) {
    if (isSingleIndexChoice(question.type) && typeof result.correctAnswer.correctIndex === "number") {
      body += `<div class="ou-banner__desc"><b>Правильный ответ:</b> ${escSlot(opts[result.correctAnswer.correctIndex])}</div>`;
    } else if (question.type === "multiple" && Array.isArray(result.correctAnswer.correctIndices)) {
      const txt = result.correctAnswer.correctIndices.map((i: number) => opts[i]).join(", ");
      body += `<div class="ou-banner__desc"><b>Правильный ответ:</b> ${escSlot(txt)}</div>`;
    }
  }
  if (result.feedback) body += feedbackDesc(result.feedback);
  return feedbackBanner(
    ok ? "success" : partial ? "warning" : "error",
    ok ? "Правильно!" : partial ? "Частично правильно" : "Неверно",
    body,
  );
}

/**
 * Access-barrier facts as the server delivers them (start-screen block or the 403
 * body). PRD-31: `blockedBy` names the barrier in force — the calendar cooldown
 * between assignments (a DATE) or the hour interval inside one (an INSTANT).
 */
type RetakeCooldownFacts = {
  blockedBy?: "cooldown" | "attemptInterval" | null;
  cooldownPeriodDays?: number;
  intervalHours?: number;
  availableDate?: string | null;
  availableAt?: string | null;
  daysUntil?: number | null;
};
/** Normalized barrier facts held in component state. */
type RetakeGateState = {
  blockedBy: "cooldown" | "attemptInterval" | null;
  cooldownPeriodDays: number | null;
  intervalHours: number | null;
  availableDate: string | null;
  availableAt: string | null;
  daysUntil: number | null;
};

/** Start-screen facts derived from one `/api/learner/tests` entry (component state shape). */
type TestMetadata = {
  totalQuestions: number;
  completedAttempts: number;
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  startPageContent: string | null;
  passPercent: number | null;
  /** Whether the test grades anything (false ⇒ measurement method, no pass threshold). */
  hasGradedContent: boolean;
  hasInProgress: boolean;
  resumeIndex: number | null;
  resumeTotal: number | null;
  lastCompletedAttemptId: string | null;
  // PRD-19 Block F (FR-19/20): retake cooldown facts resolved server-side, so the
  // start screen renders the cooldown state (date + disabled button + prior
  // summary) on the SAME page — no separate block-wall. Null = eligible.
  retakeGate: RetakeGateState | null;
  // PRD-19 Block F (FR-19/20): prior-attempt summary («повтор: можно» + cooldown).
  priorResult: { percent: number; passed: boolean | null; attemptNumber: number | null; maxAttempts: number | null } | null;
};

/**
 * Maps one raw `/api/learner/tests` list entry into the `testMetadata` shape.
 * Used both by the initial load and by the `ATTEMPTS_EXHAUSTED` refresh (a race
 * where the up-front load was stale), so the two paths can never drift on how a
 * learner-test payload becomes start-screen facts.
 */
function buildTestMetadataFromListEntry(test: any): TestMetadata {
  const totalQuestions = test.sections?.reduce((sum: number, s: any) => sum + s.drawCount, 0) || 0;
  let passPercent: number | null = null;
  if (test.overallPassRuleJson) {
    const passRule = test.overallPassRuleJson as any;
    if (passRule.type === "percent") passPercent = passRule.value;
  }
  const hasInProgress = test.inProgressAttemptId !== null;
  return {
    totalQuestions,
    completedAttempts: test.completedAttempts || 0,
    maxAttempts: test.maxAttempts || null,
    timeLimitMinutes: test.timeLimitMinutes || null,
    startPageContent: test.startPageContent || null,
    passPercent,
    // Absent on a payload from a server that predates the flag ⇒ treat as grading,
    // i.e. exactly the behaviour this screen had before.
    hasGradedContent: test.hasGradedContent !== false,
    hasInProgress,
    resumeIndex: test.resumeIndex ?? null,
    resumeTotal: test.resumeTotal ?? null,
    lastCompletedAttemptId: test.lastCompletedAttemptId ?? null,
    retakeGate: test.retakeGate
      ? {
          blockedBy: test.retakeGate.blockedBy ?? null,
          cooldownPeriodDays: test.retakeGate.cooldownPeriodDays ?? null,
          intervalHours: test.retakeGate.intervalHours ?? null,
          availableDate: test.retakeGate.availableDate ?? null,
          availableAt: test.retakeGate.availableAt ?? null,
          daysUntil: test.retakeGate.daysUntil ?? null,
        }
      : null,
    priorResult: test.priorResult ?? null,
  };
}

/**
 * The single screen a learner sees when the run cannot be rendered.
 *
 * The cause is deliberately NOT spelled out: a learner can act on none of them,
 * and a technical wording («оформление недоступно») only produces a support
 * ticket that says nothing useful. The diagnosis goes where it can be acted on —
 * the browser console and the server log — via {@link reportClientError}, exactly
 * once per mount, so a screen like this can never again be invisible to the
 * people running the service.
 */
function ServiceErrorScreen({ diagnosis }: { diagnosis: string }) {
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    reportClientError("take-test", diagnosis);
  }, [diagnosis]);
  return (
    <Center minH="screen" pad={6}>
      <Box full maxW="md">
        <Card>
          <CardHeader title="Ошибка сервиса" />
          <CardBody>
            <Stack gap={4}>
              <Text variant="body-s" tone="muted">Обратитесь к администратору.</Text>
              <Button fullWidth onClick={() => window.location.reload()}>Обновить</Button>
            </Stack>
          </CardBody>
        </Card>
      </Box>
    </Center>
  );
}

/**
 * «Подготовка теста...» that cannot last forever.
 *
 * Reaching the render fallthrough means no branch matched the current state —
 * a defect, not a slow network: every request of the init has resolved by then.
 * The spinner is still shown briefly, because a legitimate one-frame gap does
 * exist (the content queue drains a frame before the effect moves the phase on),
 * and flashing an error there would be worse than a blink of a spinner. After
 * that the screen turns into the neutral service error and reports the state it
 * was stuck in.
 */
function StuckPreparingScreen({ diagnosis, timeoutMs = 10_000 }: { diagnosis: string; timeoutMs?: number }) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setStuck(true), timeoutMs);
    return () => clearTimeout(id);
  }, [timeoutMs]);
  return stuck ? <ServiceErrorScreen diagnosis={diagnosis} /> : <LoadingState message={t.common.preparingTest} />;
}

export default function TakeTestPage() {
  const { testId } = useParams<{ testId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  // A magic-link session (assignment invitation) has no test list to return to —
  // the guard in ProtectedRoute would just bounce a "/learner" navigation back to
  // /login. Every "back to the list" control in this page is scoped by this flag.
  const magicScoped = !!user?.magicScope;
  // Rasterizing the report takes a few seconds; a second click must not start a
  // second export (same guard as the results screen).
  const reportBusy = useRef(false);

  // Common state
  const [isStarting, setIsStarting] = useState(true);
  const [testMode, setTestMode] = useState<"standard" | "adaptive" | null>(null);
  const [testInfo, setTestInfo] = useState<Test | null>(null);
  const [phase, setPhase] = useState<"loading" | "start" | "question" | "content" | "finished" | "blocked">("loading");
  // PRD-12 FR-6: the author's structure, delivered with the attempt. `pageQueue`
  // holds the content pages due BEFORE the next question (or before the results);
  // it is walked one page at a time in the "content" phase. Empty structure ⇒ the
  // queue is never filled and the run behaves exactly as before.
  const [flowStructure, setFlowStructure] = useState<{
    flowMode: string;
    contentPages: FlowContentPage[];
  }>({ flowMode: "linear_flat", contentPages: [] });
  const [contentTpl, setContentTpl] = useState<ContentScreenTemplate | null>(null);
  const [pageQueue, setPageQueue] = useState<RenderableContentPage[]>([]);
  /** Section order from the variant — the anchor for the per-topic zones. */
  const [sections, setSections] = useState<{ topicId: string }[]>([]);
  /**
   * The question advance deferred while a content zone plays. Applied verbatim
   * once the queue drains, so the boundary logic (section обзор / итоги раздела)
   * still runs — and runs AFTER the «после темы» pages, as it does in SCORM.
   */
  const [pendingAdvance, setPendingAdvance] = useState<{
    nextIdx: number | null;
    answers: Record<string, any>;
    status: Record<string, "unanswered" | "answered" | "skipped">;
  } | null>(null);
  /**
   * The «После теста» pre-results zone plays exactly once. It is reachable from two
   * paths — walking off the last question, and «Завершить тест» in the обзор — and
   * showing it twice would make the learner dismiss the same screens again.
   */
  const [afterZonePlayed, setAfterZonePlayed] = useState(false);
  /** Submit deferred while that zone plays; fired when the queue drains. */
  const [pendingSubmit, setPendingSubmit] = useState(false);
  /**
   * Pages owed to the learner on ARRIVAL at a question — the entered section's
   * «перед темой» zone. Held until `currentIndex` actually reaches that question,
   * so the boundary screens of the section just left come first.
   */
  const [arrivalZone, setArrivalZone] = useState<{
    forIndex: number;
    pages: RenderableContentPage[];
  } | null>(null);

  // ─── router_by_topics hub ──────────────────────────────────────────────────
  // The hub is a navigation screen: the learner picks a section, runs it, and is
  // returned here. Section state and the open/finish rules come from the SHARED
  // `shared/flow/router-hub`, so a card that is open in the LMS is open here.
  const [routerTopicStates, setRouterTopicStates] = useState<
    Record<string, RouterTopicStatus | undefined>
  >({});
  // Frozen per-section pass/fail, so the hub card can show its outcome (green/red)
  // when the test reveals section results — parity with the SCORM `state.sectionResults`.
  const [routerSectionResults, setRouterSectionResults] = useState<
    Record<string, { passed?: boolean | null }>
  >({});
  const [currentRouterTopic, setCurrentRouterTopic] = useState<string | null>(null);
  /**
   * Where the learner stopped inside each section (flat question index). Re-entering
   * a section — from the hub or after «Продолжить с места остановки» — resumes at
   * that question instead of restarting the section from its first one. Persisted
   * with the progress, so it survives a reload.
   */
  const [sectionPositions, setSectionPositions] = useState<Record<string, number>>({});
  const [showHub, setShowHub] = useState(false);
  /** Set while a section's «после темы» zone plays on the way back to the hub. */
  const [pendingHubReturn, setPendingHubReturn] = useState<string | null>(null);

  // Defensive: never strand the learner on a content phase with nothing to render
  // (the template fetch failed, or the queue drained through another path). Falling
  // through to the questions is always safe — a missing page costs a screen, a
  // blank screen costs the attempt.
  useEffect(() => {
    // `pendingSubmit` is excluded: the queue is empty on purpose while the attempt
    // is being sent, and bouncing to the question phase would flash that screen
    // between the last content page and the results.
    if (phase === "content" && !pendingSubmit && (!contentTpl || pageQueue.length === 0)) {
      setPhase("question");
    }
  }, [phase, contentTpl, pageQueue.length, pendingSubmit]);
  const [testMetadata, setTestMetadata] = useState<TestMetadata | null>(null);
  // PRD-12 web-host: start screen template assets (null -> legacy React markup).
  const [startTpl, setStartTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
    /** PRD-23: per-theme colour overrides, printed as CSS. */
    themeCss?: string;
    /** PRD-23: palette pinned by the author; absent means «Авто». */
    dataTheme?: "light" | "dark";
    /** PRD-23: template declares a choice of palettes (see resolveSceneTheme). */
    themed?: boolean;
    design?: { logoUrl?: string };
  } | null>(null);
  // PRD-12 / PRD-6: retake block-wall template + cooldown data (set on 403).
  const [blockedTpl, setBlockedTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
    /** PRD-23: per-theme colour overrides, printed as CSS. */
    themeCss?: string;
    /** PRD-23: palette pinned by the author; absent means «Авто». */
    dataTheme?: "light" | "dark";
    /** PRD-23: template declares a choice of palettes (see resolveSceneTheme). */
    themed?: boolean;
    design?: { logoUrl?: string };
  } | null>(null);
  const [blockData, setBlockData] = useState<{ cooldownPeriodDays?: number; availableDate?: string | null } | null>(null);
  // PRD-12 #3: question screen template assets (null -> legacy React markup).
  const [questionTpl, setQuestionTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
    /** PRD-23: per-theme colour overrides, printed as CSS. */
    themeCss?: string;
    /** PRD-23: palette pinned by the author; absent means «Авто». */
    dataTheme?: "light" | "dark";
    /** PRD-23: template declares a choice of palettes (see resolveSceneTheme). */
    themed?: boolean;
    design?: { logoUrl?: string };
  } | null>(null);
  // PRD-19 Block D: обзор (review) screen template + visibility flag.
  const [reviewTpl, setReviewTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
    /** PRD-23: per-theme colour overrides, printed as CSS. */
    themeCss?: string;
    /** PRD-23: palette pinned by the author; absent means «Авто». */
    dataTheme?: "light" | "dark";
    /** PRD-23: template declares a choice of palettes (see resolveSceneTheme). */
    themed?: boolean;
    design?: { logoUrl?: string };
  } | null>(null);
  const [showReview, setShowReview] = useState(false);
  // PRD-19: the обзор was opened via «Вернуться»/«К обзору» MID-flow (not reached at
  // the section/test end). Then it offers an accented «Назад» to the origin question
  // and demotes «Завершить …», and highlights the current question in the map.
  const [reviewFromButton, setReviewFromButton] = useState(false);
  // PRD-19 Block D (FR-09): finish-confirm modal payload (null = hidden).
  // `onConfirm` runs the staged action (section finish or whole-test submit).
  const [finishConfirm, setFinishConfirm] = useState<{ count: number; label: string; onConfirm: () => void } | null>(null);
  // PRD-19 D5 (FR-05a): section-results (итоги раздела) screen layout + payload.
  const [sectionResultsTpl, setSectionResultsTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
    /** PRD-23: per-theme colour overrides, printed as CSS. */
    themeCss?: string;
    /** PRD-23: palette pinned by the author; absent means «Авто». */
    dataTheme?: "light" | "dark";
    /** PRD-23: template declares a choice of palettes (see resolveSceneTheme). */
    themed?: boolean;
    design?: { logoUrl?: string };
  } | null>(null);
  // PRD-4 §4.7: adaptive level-change interstitial (`system.transition`) layout.
  const [transitionTpl, setTransitionTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
    /** PRD-23: per-theme colour overrides, printed as CSS. */
    themeCss?: string;
    /** PRD-23: palette pinned by the author; absent means «Авто». */
    dataTheme?: "light" | "dark";
    /** PRD-23: template declares a choice of palettes (see resolveSceneTheme). */
    themed?: boolean;
    design?: { logoUrl?: string };
  } | null>(null);
  // PRD-19 D5: per-section freeze map (web analogue of SCORM state.sectionCommitted).
  const [sectionCommitted, setSectionCommitted] = useState<Record<string, boolean>>({});
  // PRD-19 D5: the computed section-results screen payload (null = not shown). Built
  // from the server /section-result grade (parity with SCORM computeSectionResult).
  const [sectionResultView, setSectionResultView] = useState<
    { topicId: string; topicName: string; correct: number; total: number; percent: number; passed: boolean | null; isLast: boolean } | null
  >(null);

  // Standard mode state
  // Standard mode state
  const [attempt, setAttempt] = useState<AttemptWithQuestions | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(false);
  const [standardFeedbackShown, setStandardFeedbackShown] = useState(false);
  const [standardAnswerResult, setStandardAnswerResult] = useState<{
    isCorrect: boolean;
    /**
     * PRD-10 (FR-12): доля от максимума за этот ответ. Есть только у стандартного
     * режима — по ней вердикт становится трёхпозиционным (частичный балл).
     */
    scoreRatio?: number;
    correctAnswer?: any;
    feedback?: string;
  } | null>(null);
  // Timer state
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [flatQuestions, setFlatQuestions] = useState<FlatQuestion[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // PRD-15 FR-14: set when a submit/answer hits 404 because the attempt was
  // annulled by an emergency re-publish — the learner is told to start over.
  const [attemptGone, setAttemptGone] = useState(false);
  const [shuffleMappings, setShuffleMappings] = useState<Record<string, any>>({});

  // PRD-19 (Block B): runtime navigation settings + per-question status, the web
  // analogue of TEST_DATA + suspend_data.currentSession.questionStatuses in the
  // SCORM host. Read from the attempt start / resume responses; status persisted
  // through save-progress. Defaults keep legacy (strict-linear) behaviour until
  // the response populates them.
  const [navSettings, setNavSettings] = useState<{
    allowReturnToUnanswered: boolean;
    allowAnswerChange: boolean;
    // PRD-43: independent of allowReturnToUnanswered.
    quickAdvance: boolean;
    showSectionResults: boolean;
    /** Авторское «когда отвечено всё, обзор не нужен» — правило в `review-gate`. */
    skipReviewWhenComplete: boolean;
    answerCommitScope: "test" | "section";
  }>({
    allowReturnToUnanswered: false,
    allowAnswerChange: false,
    quickAdvance: true,
    showSectionResults: true,
    skipReviewWhenComplete: false,
    answerCommitScope: "test",
  });
  // PRD-34 (FR-01): настройки защиты текста задания. Как и navSettings, приходят с
  // ответом старта/возобновления попытки — это веб-аналог TEST_DATA пакета. Умолчания
  // повторяют умолчания колонок: отсутствие поля читается как «защита включена» (FR-05).
  const [protectionSettings, setProtectionSettings] = useState<ProtectionSettings>({
    copyProtection: true,
    watermark: false,
    hideOnBlur: false,
  });
  const [questionStatus, setQuestionStatus] = useState<
    Record<string, "unanswered" | "answered" | "skipped">
  >({});

  // PRD-4 v1.1 §3.2 — per-topic (section) timer for the standard flow. The
  // expiry handler is invoked via a ref so it can read the freshest state
  // (lockedTopics / answers / currentIndex) without re-subscribing the hook.
  const sectionExpireRef = useRef<(topicId: string) => void>(() => {});
  const { sectionRemainingSeconds, lockedTopics } = useSectionTimer({
    attemptId: attempt?.id ?? null,
    questions: flatQuestions,
    currentIndex,
    enabled: testMode === "standard" && phase === "question" && flatQuestions.length > 0,
    onExpire: (topicId) => sectionExpireRef.current(topicId),
  });

  // Tracks mount so the adaptive expiry retry loop stops after navigation away.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Adaptive mode state
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveState | null>(null);

  // PRD-34 (FR-30): решение о защите принимает ОДИН общий построитель — тот же, что и в
  // пакете, поэтому веб и SCORM не могут разойтись. Отметка знака обезличена (FR-17):
  // идентификатор попытки, укороченный до шести знаков, чтобы читался на снимке.
  const attemptId = attempt?.id ?? adaptiveState?.attemptId ?? null;
  const protectionStamp = useMemo(
    () => (attemptId ? { id: attemptId.slice(0, 6), at: new Date() } : null),
    [attemptId],
  );
  const questionProtection = useMemo(
    () =>
      buildProtectionSpec({
        screen: "question",
        settings: protectionSettings,
        stamp: protectionStamp,
      }),
    [protectionSettings, protectionStamp],
  );
  const reviewProtection = useMemo(
    () =>
      buildProtectionSpec({
        screen: "review",
        settings: protectionSettings,
        stamp: protectionStamp,
      }),
    [protectionSettings, protectionStamp],
  );
  const [isAnswering, setIsAnswering] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [feedbackShown, setFeedbackShown] = useState(false);

  // PRD-4 v1.1 §3.2 — adaptive topic timer (forward-only; expiry asks the
  // server to advance, with retry, so transient network loss can't strand it).
  const adaptiveExpireRef = useRef<(topicId: string) => void>(() => {});
  const { sectionRemainingSeconds: adaptiveSectionRemaining } = useAdaptiveSectionTimer({
    attemptId: adaptiveState?.attemptId ?? null,
    topicId: adaptiveState?.currentQuestion?.topicId ?? null,
    limitMinutes: adaptiveState?.currentQuestion?.sectionTimeLimitMinutes ?? null,
    enabled: testMode === "adaptive" && phase === "question" && !!adaptiveState && !adaptiveState.isFinished,
    onExpire: (topicId) => adaptiveExpireRef.current(topicId),
  });
  const [lastAnswerResult, setLastAnswerResult] = useState<{
    isCorrect: boolean;
    correctAnswer?: any;
    feedback?: string;
  } | null>(null);

  const shuffleArray = (arr: any[]) => {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const createShuffleMapping = (length: number): number[] => {
    const indices = Array.from({ length }, (_, i) => i);
    return shuffleArray(indices);
  };

  // hasAnswer + rankingDeliveryOrder + deliversShuffledOrder live in ./answer-gate
  // (pure + unit-tested).

  const createAdaptiveShuffleMapping = (question: any): any => {
    if (!deliversShuffledOrder(question)) return null;
    const type = question.type;
    const data = question.dataJson as any;
    if (type === "single" || type === "multiple") {
      return createShuffleMapping(data.options.length);
    }
    if (type === "matching") {
      return {
        left: createShuffleMapping(data.left.length),
        right: createShuffleMapping(data.right.length),
      };
    }
    if (type === "ranking") {
      return rankingDeliveryOrder(data.items.length, (question.correctJson as any)?.correctOrder);
    }
    return null;
  };

  // Timer effect
  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds <= 0) return;

    timerRef.current = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev === null || prev <= 1) {
          // Время истекло
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [remainingSeconds !== null]);

  // Auto-submit when time expires
  useEffect(() => {
    if (remainingSeconds === 0) {
      toast({
        variant: "destructive",
        title: "Время истекло",
        description: "Тест будет автоматически завершён",
      });

      // Автоматически завершаем тест
      if (testMode === "standard" && attempt) {
        // Принудительное завершение без проверки ответов
        const forceSubmit = async () => {
          setIsSubmitting(true);
          try {
            const res = await fetch(`/api/attempts/${attempt.id}/finish`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              // PRD-19 Block E (FR-15): timeout auto-finish — drafts don't count in flexible.
              body: JSON.stringify({ answers: pickGradedAnswers(answers, questionStatus, navSettings.allowReturnToUnanswered), timeExpired: true }),
            });

            if (!res.ok) throw new Error("Failed to submit");
            navigate(`/learner/result/${attempt.id}`);
          } catch (err) {
            toast({
              variant: "destructive",
              title: "Ошибка отправки",
              description: "Не удалось отправить ответы",
            });
          } finally {
            setIsSubmitting(false);
          }
        };
        forceSubmit();
      } else if (testMode === "adaptive" && adaptiveState && !adaptiveState.isFinished) {
        // Для адаптивного теста - принудительно завершаем
        setAdaptiveState(prev => prev ? {
          ...prev,
          isFinished: true,
          result: { topicResults: [], timeExpired: true },
          currentQuestion: null,
        } : null);
      }
    }
  }, [remainingSeconds]);

  // Fetch test info and show start page
  useEffect(() => {
    const initTest = async () => {
      setIsStarting(true);
      setPhase("loading");
      try {
        // Получаем информацию о тесте из learner API (включает попытки)
        const testRes = await fetch(`/api/learner/tests`, { credentials: "include" });
        if (!testRes.ok) throw new Error("Failed to fetch tests");
        const tests = await testRes.json();
        const test = tests.find((t: any) => t.id === testId);

        if (!test) {
          throw new Error("Test not found");
        }

        setTestInfo(test);
        setTestMode(test.mode || "standard");
        setTestMetadata(buildTestMetadataFromListEntry(test));

        // PRD-12 web-host: fetch the screen templates. Best-effort per screen —
        // `review`/`section-results`/`content` have their own fallbacks — but a
        // failure is never swallowed silently: `start` and `question` are the two
        // screens the run CANNOT proceed without, and a swallowed 404 on either is
        // what turned a broken template into an endless «Подготовка теста...».
        try {
          const tplRes = await fetch(`/api/tests/${testId}/screen-template/start`, { credentials: "include" });
          if (tplRes.ok) setStartTpl(await tplRes.json());
          else reportClientError("take-test", `screen-template/start failed: HTTP ${tplRes.status} (test ${testId})`);
          const qRes = await fetch(`/api/tests/${testId}/screen-template/question`, { credentials: "include" });
          if (qRes.ok) setQuestionTpl(await qRes.json());
          else reportClientError("take-test", `screen-template/question failed: HTTP ${qRes.status} (test ${testId})`);
          // PRD-19 Block D: обзор (review) screen layout.
          const rvRes = await fetch(`/api/tests/${testId}/screen-template/review`, { credentials: "include" });
          if (rvRes.ok) setReviewTpl(await rvRes.json());
          // PRD-19 D5: section-results (итоги раздела) screen layout.
          const srRes = await fetch(`/api/tests/${testId}/screen-template/section-results`, { credentials: "include" });
          if (srRes.ok) setSectionResultsTpl(await srRes.json());
          // PRD-4 §4.7: the adaptive level-change interstitial, from the SAME
          // `system.transition` layout the package renders (no web-only React card).
          if ((test.mode || "standard") === "adaptive") {
            const trRes = await fetch(`/api/tests/${testId}/screen-template/transition`, { credentials: "include" });
            if (trRes.ok) setTransitionTpl(await trRes.json());
            else reportClientError("take-test", `screen-template/transition failed: HTTP ${trRes.status} (test ${testId})`);
          }
          // PRD-12 FR-6: author content-page wrapper + the manifest's placeholder
          // declarations, so content pages render from the template rather than
          // being skipped.
          const cRes = await fetch(`/api/tests/${testId}/screen-template/content`, { credentials: "include" });
          if (cRes.ok) {
            const contentPayload = await cRes.json();
            // «Введение раздела» owns a dedicated layout; without it the intro page
            // renders through the generic wrapper as a blank screen with «Далее».
            const siRes = await fetch(`/api/tests/${testId}/screen-template/section-intro`, { credentials: "include" });
            const sectionIntro = siRes.ok ? await siRes.json() : null;
            // The server ships every variant's own layout (keyed by `layoutFile`);
            // «Введение раздела» is resolved by a fixed layouts[] key instead, so it
            // is merged in separately.
            setContentTpl({
              ...contentPayload,
              variantLayouts: {
                ...(contentPayload.variantLayouts ?? {}),
                ...(sectionIntro ? { "layouts/section-intro.html": sectionIntro.layout } : {}),
              },
            });
          }
        } catch (tplErr) {
          // A template request that could not complete at all (network/parse).
          // The screens below decide what to render; what must not happen is that
          // nobody ever learns this occurred.
          reportClientError("take-test", `screen-template fetch failed: ${(tplErr as Error)?.message} (test ${testId})`);
        }

        // Показываем стартовую страницу
        setPhase("start");
      } catch (err) {
        console.error("Init test error:", err);
        toast({
          variant: "destructive",
          title: t.common.error,
          description: t.common.failedToStartTest,
        });
        navigate("/learner");
      } finally {
        setIsStarting(false);
      }
    };

    initTest();
  }, [testId]);

  // Функция начала теста
  const handleStartTest = async () => {
    if (!testInfo) return;

    setIsStarting(true);
    try {
      if (testMode === "adaptive") {
        await startAdaptiveAttempt();
        setPhase("question");
      } else {
        // PRD-12 FR-6: enter the «До теста» content zone when the author placed
        // pages there. With no pages, a router test opens on its hub and a linear
        // one goes straight into the questions, as before.
        const started = await startStandardAttempt();
        const lead = started?.leadPages ?? [];
        if (lead.length) setPhase("content");
        else if (started?.flowMode === "router_by_topics") setShowHub(true);
        else setPhase("question");
      }
    } catch (err) {
      if ((err as Error)?.message === "ATTEMPTS_EXHAUSTED") {
        // The attempts ran out between loading the start screen and this click
        // (a race — e.g. another tab). Re-read the server's own facts rather than
        // guessing them: the exhausted start screen offers «Мой результат», and
        // that needs a real attempt id, not a hand-faked counter. Server invariant
        // (server/routes/attempts.ts): ATTEMPTS_EXHAUSTED is only returned when a
        // completed attempt already exists, so the local fallback below is
        // defensive (a failed refresh), not a real branch of this race.
        try {
          const res = await fetch("/api/learner/tests", { credentials: "include" });
          if (res.ok) {
            const list = (await res.json()) as Array<Record<string, unknown>>;
            const fresh = list.find((it) => it.id === testId);
            if (fresh) {
              setTestMetadata(buildTestMetadataFromListEntry(fresh));
              setPhase("start");
              return;
            }
          }
        } catch {
          // Offline or a failed refresh: fall through to the local fallback below.
        }
        // Refresh unavailable: at least stop offering a start, even though we
        // cannot know the real attempt id for «Мой результат» yet.
        setTestMetadata((m) =>
          m
            ? { ...m, completedAttempts: m.maxAttempts ?? m.completedAttempts, hasInProgress: false }
            : m,
        );
        setPhase("start");
        return;
      }
      const retake = (err as { retake?: RetakeCooldownFacts }).retake;
      // PRD-31: both barriers land here. `ATTEMPT_INTERVAL` is the hour interval
      // inside the assignment, `RETAKE_COOLDOWN` the calendar cooldown between
      // assignments; they render the same way, only the moment differs.
      const barrierCode = (err as Error)?.message;
      if (barrierCode === "RETAKE_COOLDOWN" || barrierCode === "ATTEMPT_INTERVAL") {
        // PRD-19 Block F (FR-20): a cooldown that the up-front gate missed (a race —
        // e.g. another tab consumed the last eligible window). Render the cooldown
        // state ON the start page (parity with the resolved-at-load path), not a
        // separate wall: fold the 403 facts into testMetadata.retakeGate and stay on
        // start. Falls back to the legacy block-wall only when the start template is
        // unavailable (no `startTpl`), so the learner never sees a blank screen.
        if (startTpl) {
          setTestMetadata((m) =>
            m
              ? {
                  ...m,
                  retakeGate: {
                    blockedBy:
                      retake?.blockedBy ??
                      (barrierCode === "ATTEMPT_INTERVAL" ? "attemptInterval" : "cooldown"),
                    cooldownPeriodDays: retake?.cooldownPeriodDays ?? null,
                    intervalHours: retake?.intervalHours ?? null,
                    availableDate: retake?.availableDate ?? null,
                    availableAt: retake?.availableAt ?? null,
                    daysUntil: retake?.daysUntil ?? null,
                  },
                }
              : m,
          );
          setPhase("start");
          return;
        }
        try {
          const r = await fetch(`/api/tests/${testId}/screen-template/blocked`, { credentials: "include" });
          if (r.ok) setBlockedTpl(await r.json());
        } catch {
          /* render falls back to a minimal block message below */
        }
        setBlockData(retake ?? {});
        setPhase("blocked");
        return;
      }
      console.error("Start test error:", err);
      toast({
        variant: "destructive",
        title: t.common.error,
        description: t.common.failedToStartTest,
      });
    } finally {
      setIsStarting(false);
    }
  };

  // Функция продолжения незавершённого теста
  const handleResumeTest = async () => {
    if (!testInfo) return;

    setIsStarting(true);
    try {
      const res = await fetch(`/api/tests/${testId}/resume`, {
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to resume");

      const data = await res.json();

      if (!data.hasInProgress) {
        // Нет незавершённой попытки — начинаем новую
        await handleStartTest();
        return;
      }

      if (testMode === "adaptive") {
        // TODO: Реализовать восстановление адаптивного теста
        toast({
          variant: "info",
          title: "Информация",
          description: "Восстановление адаптивного теста пока не поддерживается. Начинаем заново.",
        });
        await handleStartTest();
        return;
      }

      // Восстанавливаем стандартный тест
      setAttempt(data.attempt);
      setShowCorrectAnswers(data.attempt.showCorrectAnswers || false);
      setAnswers(data.savedAnswers || {});
      setCurrentIndex(data.currentIndex || 0);
      // PRD-19 (Block B): restore runtime settings + per-question statuses.
      setNavSettings({
        allowReturnToUnanswered: data.attempt.allowReturnToUnanswered ?? false,
        allowAnswerChange: data.attempt.allowAnswerChange ?? false,
        // PRD-43: same fallback rule as the DB backfill migration — derive from
        // allowReturnToUnanswered when the server response omits the field.
        quickAdvance:
          typeof data.attempt.quickAdvance === "boolean"
            ? data.attempt.quickAdvance
            : !(data.attempt.allowReturnToUnanswered ?? false),
        showSectionResults: data.attempt.showSectionResults ?? true,
        skipReviewWhenComplete: data.attempt.skipReviewWhenComplete ?? false,
        answerCommitScope: data.attempt.answerCommitScope ?? "test",
      });
      setProtectionSettings({
        copyProtection: data.attempt.copyProtection ?? true,
        watermark: data.attempt.protectionWatermark ?? false,
        hideOnBlur: data.attempt.protectionHideOnBlur ?? false,
      });
      setQuestionStatus(data.questionStatus || {});
      // Where the learner stopped inside each section — a re-entry from the hub
      // continues from that question instead of restarting the section.
      setSectionPositions(data.sectionPositions || {});

      // Инициализация таймера (с учётом прошедшего времени)
      if (data.attempt.timeLimitMinutes && data.attempt.timeLimitMinutes > 0) {
        const startedAt = new Date(data.attempt.startedAt).getTime();
        const now = Date.now();
        const elapsedSeconds = Math.floor((now - startedAt) / 1000);
        const totalSeconds = data.attempt.timeLimitMinutes * 60;
        const remaining = Math.max(0, totalSeconds - elapsedSeconds);

        setTimeLimitMinutes(data.attempt.timeLimitMinutes);
        setRemainingSeconds(remaining);

        if (remaining <= 0) {
          toast({
            variant: "destructive",
            title: "Время истекло",
            description: "Время на тест истекло пока вы отсутствовали",
          });
          navigate("/learner");
          return;
        }
      }

      // Восстанавливаем вопросы
      const variant = data.attempt.variantJson as any;
      // PRD-30 FR-19: обычно поток — это разделы подряд; при «полном
      // перемешивании» вариант несёт собственный порядок выдачи.
      const questions: FlatQuestion[] = [];
      const mappings: Record<string, any> = {};
      let idx = 0;

      for (const section of variant.sections) {
        for (const qId of section.questionIds) {
          const question = data.attempt.questions.find((q: Question) => q.id === qId);
          if (question) {
            questions.push({
              question,
              topicName: section.topicName,
              topicId: section.topicId,
              sectionTimeLimitMinutes: section.timeLimitMinutes ?? null,
              index: idx++,
            });

            // Восстанавливаем shuffle mapping из варианта если есть
            if (variant.shuffleMappings && variant.shuffleMappings[question.id]) {
              mappings[question.id] = variant.shuffleMappings[question.id];
            } else if (deliversShuffledOrder(question)) {
              // Генерируем новый если нет сохранённого
              const qData = question.dataJson as any;
              if (question.type === "single" || question.type === "multiple") {
                const optCount = qData.options?.length || 0;
                if (optCount > 0) {
                  mappings[question.id] = createShuffleMapping(optCount);
                }
              } else if (question.type === "matching") {
                const leftCount = qData.left?.length || 0;
                const rightCount = qData.right?.length || 0;
                if (leftCount > 0 && rightCount > 0) {
                  mappings[question.id] = {
                    left: createShuffleMapping(leftCount),
                    right: createShuffleMapping(rightCount),
                  };
                }
              } else if (question.type === "ranking") {
                const itemCount = qData.items?.length || 0;
                if (itemCount > 0) {
                  mappings[question.id] = rankingDeliveryOrder(itemCount, (question.correctJson as any)?.correctOrder);
                }
              }
            }
          }
        }
      }

      // PRD-30 FR-19: тот же поток, что на старте попытки, восстанавливается из
      // сохранённого варианта — иначе возобновление переставило бы вопросы.
      setFlatQuestions(orderedForDelivery(questions, variant.deliveryOrder));
      setShuffleMappings(mappings);

      // PRD-12 FR-6: restore the STRUCTURE on resume too. Without it the resumed
      // run carried no content pages at all, so every zone still ahead of the
      // learner — «перед темой», «после темы», «После теста» — silently vanished
      // for the rest of the attempt, not just the ones already passed.
      //
      // The pages BEFORE the resume point are deliberately not replayed: the
      // learner has already walked them, and the attempt persists a question
      // index, not a page position, so re-showing them would add screens the
      // learner already dismissed.
      setFlowStructure({
        flowMode: (data.attempt.flowMode as string) ?? "linear_flat",
        contentPages: (data.attempt.contentPages as FlowContentPage[]) ?? [],
      });
      setSections((variant.sections || []).map((s: any) => ({ topicId: s.topicId })));
      setPhase("question");

      toast({
        title: "Тест восстановлен",
        description: `Продолжаем с вопроса ${data.currentIndex + 1}`,
      });
    } catch (err) {
      console.error("Resume test error:", err);
      toast({
        variant: "destructive",
        title: t.common.error,
        description: "Не удалось восстановить тест",
      });
    } finally {
      setIsStarting(false);
    }
  };

  /**
   * PRD-19 FR-20: «Скачать отчёт» по ПРОШЛОЙ попытке прямо со стартового экрана —
   * тот же документ и тот же конвейер, что на экране итогов, и то же действие, что
   * в пакете (`startPage.js` отдаёт `canDownloadReport` по лучшей сохранённой
   * попытке). Данные отчёта тянутся по клику, а не на каждую загрузку старта:
   * собирать их заранее — это лишний рендер макета отчёта на каждый вход в тест.
   */
  const handleStartReport = async () => {
    const attemptId = testMetadata?.lastCompletedAttemptId;
    if (!attemptId || reportBusy.current) return;
    reportBusy.current = true;
    toast({ variant: "info", title: "Готовим отчёт", description: "Файл скачается автоматически." });
    try {
      const res = await fetch(`/api/attempts/${attemptId}/result`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.report || !data.reportRender) {
        throw new Error(
          data.report ? "Шаблон не предоставил макет отчёта." : "Нет данных для отчёта по этой попытке.",
        );
      }
      await downloadAttemptReport(data.report, data.reportRender, data.measures ?? undefined);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Не удалось сформировать отчёт",
        description: (e as Error).message,
      });
    } finally {
      reportBusy.current = false;
    }
  };

  // Standard attempt start
  const startStandardAttempt = async () => {
    const res = await fetch(`/api/tests/${testId}/attempts/start`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const error = await res.json();
      if (error.code === "ATTEMPTS_EXHAUSTED") {
        // Race: the attempts ran out between loading the start screen and this
        // click (another tab). Rethrow so the shared catch can fold the fact into
        // the start screen — a magic-link session has no test list to fall back to.
        throw new Error("ATTEMPTS_EXHAUSTED");
      }
      if (error.code === "RETAKE_COOLDOWN") {
        const e = new Error("RETAKE_COOLDOWN") as Error & {
          retake?: RetakeCooldownFacts;
        };
        e.retake = {
          cooldownPeriodDays: error.cooldownPeriodDays,
          availableDate: error.availableDate,
          daysUntil: error.daysUntil,
        };
        throw e;
      }
      throw new Error("Failed to start attempt");
    }
    const data = await res.json();
    setAttempt(data);
    setShowCorrectAnswers(data.showCorrectAnswers || false);
    // PRD-19 (Block B): runtime navigation settings from the start response.
    setNavSettings({
      allowReturnToUnanswered: data.allowReturnToUnanswered ?? false,
      allowAnswerChange: data.allowAnswerChange ?? false,
      // PRD-43: same fallback rule as the DB backfill migration — derive from
      // allowReturnToUnanswered when the server response omits the field.
      quickAdvance:
        typeof data.quickAdvance === "boolean"
          ? data.quickAdvance
          : !(data.allowReturnToUnanswered ?? false),
      showSectionResults: data.showSectionResults ?? true,
      skipReviewWhenComplete: data.skipReviewWhenComplete ?? false,
      answerCommitScope: data.answerCommitScope ?? "test",
    });
    setProtectionSettings({
      copyProtection: data.copyProtection ?? true,
      watermark: data.protectionWatermark ?? false,
      hideOnBlur: data.protectionHideOnBlur ?? false,
    });
    setQuestionStatus({});

    // Инициализация таймера
    if (data.timeLimitMinutes && data.timeLimitMinutes > 0) {
      setTimeLimitMinutes(data.timeLimitMinutes);
      setRemainingSeconds(data.timeLimitMinutes * 60);
    }
    const variant = data.variantJson as any;
    const questions: FlatQuestion[] = [];
    const mappings: Record<string, any> = {};
    let idx = 0;

    for (const section of variant.sections) {
      for (const qId of section.questionIds) {
        const question = data.questions.find((q: Question) => q.id === qId);
        if (question) {
          questions.push({
            question,
            topicName: section.topicName,
            topicId: section.topicId,
            sectionTimeLimitMinutes: section.timeLimitMinutes ?? null,
            index: idx++,
          });

          // Generate shuffle mappings
          if (deliversShuffledOrder(question)) {
            const qData = question.dataJson as any;

            if (question.type === "single" || question.type === "multiple") {
              const optCount = qData.options?.length || 0;
              if (optCount > 0) {
                mappings[question.id] = createShuffleMapping(optCount);
              }
            } else if (question.type === "matching") {
              const leftCount = qData.left?.length || 0;
              const rightCount = qData.right?.length || 0;
              if (leftCount > 0 && rightCount > 0) {
                mappings[question.id] = {
                  left: createShuffleMapping(leftCount),
                  right: createShuffleMapping(rightCount),
                };
              }
            } else if (question.type === "ranking") {
              const itemCount = qData.items?.length || 0;
              if (itemCount > 0) {
                mappings[question.id] = rankingDeliveryOrder(itemCount, (question.correctJson as any)?.correctOrder);
              }
            }
          }
        }
      }
    }

    // PRD-30 FR-19: the sections carry the composition, the variant carries the
    // stream. They differ only under the test-wide «полное перемешивание»; for
    // every other test (and every pre-PRD-30 attempt) this is the section order.
    const delivered = orderedForDelivery(questions, variant.deliveryOrder);
    setFlatQuestions(delivered);
    setShuffleMappings(mappings);

    // PRD-12 FR-6: the author's structure arrives with the attempt. Build the run
    // through the SHARED sequence builder and queue whatever content pages precede
    // the first question — the «До теста» zone. Returned to the caller so it can
    // enter the content phase instead of jumping straight into the questions.
    const structure = {
      flowMode: (data.flowMode as string) ?? "linear_flat",
      contentPages: (data.contentPages as FlowContentPage[]) ?? [],
    };
    setFlowStructure(structure);
    const variantSections = (variant.sections || []).map((s: any) => ({ topicId: s.topicId }));
    setSections(variantSections);
    const built = buildPageSequence({
      flowMode: structure.flowMode,
      testMode: "standard",
      sections: variantSections,
      contentPages: structure.contentPages,
      flatQuestions: delivered,
    });
    const leadPages = contentPagesBetween(built.sequence, null, delivered.length ? 0 : null);
    setPageQueue(leadPages);

    // Сохраняем shuffle mappings в варианте для восстановления
    fetch(`/api/attempts/${data.id}/save-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        answers: {},
        currentIndex: 0,
        shuffleMappings: mappings,
      }),
    }).catch(err => console.error("Save mappings error:", err));

    return { leadPages: leadPages, flowMode: structure.flowMode };
  };

  // Adaptive attempt start
  const startAdaptiveAttempt = async () => {
    const res = await fetch(`/api/tests/${testId}/attempts/start-adaptive`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const error = await res.json();
      if (error.code === "ATTEMPTS_EXHAUSTED") {
        // Race: the attempts ran out between loading the start screen and this
        // click (another tab). Rethrow so the shared catch can fold the fact into
        // the start screen — a magic-link session has no test list to fall back to.
        throw new Error("ATTEMPTS_EXHAUSTED");
      }
      throw new Error("Failed to start adaptive attempt");
    }
    const data = await res.json();

    if (data.currentQuestion) {
      setShuffleMappings(prev => ({
        ...prev,
        [data.currentQuestion.question.id]: createAdaptiveShuffleMapping(data.currentQuestion.question),
      }));
    }

    setAdaptiveState({
      attemptId: data.attemptId,
      testTitle: data.testTitle,
      showDifficultyLevel: data.showDifficultyLevel,
      showCorrectAnswers: data.showCorrectAnswers || false,
      currentQuestion: data.currentQuestion,
      totalTopics: data.totalTopics,
      currentTopicIndex: data.currentTopicIndex,
      answer: null,
      lastResult: null,
      isFinished: false,
      result: null,
      questionsAnswered: 0,
    });

    // Инициализация таймера
    if (data.timeLimitMinutes && data.timeLimitMinutes > 0) {
      setTimeLimitMinutes(data.timeLimitMinutes);
      setRemainingSeconds(data.timeLimitMinutes * 60);
    }
  };

  // PRD-19 (Block B): persist progress including per-question status (web
  // analogue of saveCurrentSession in the SCORM host). Pass the NEXT values
  // explicitly to avoid React state staleness.
  const saveProgress = (
    nextAnswers: Record<string, any>,
    nextIndex: number,
    nextStatus: Record<string, "unanswered" | "answered" | "skipped">,
  ) => {
    if (!attempt) return;
    // Remember the position inside the section being left/advanced, so a return
    // lands on that question rather than at the section's start.
    const topicId = flatQuestions[nextIndex]?.topicId;
    const positions = topicId ? { ...sectionPositions, [topicId]: nextIndex } : sectionPositions;
    if (topicId && positions !== sectionPositions) setSectionPositions(positions);
    fetch(`/api/attempts/${attempt.id}/save-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        answers: nextAnswers,
        currentIndex: nextIndex,
        questionStatus: nextStatus,
        sectionPositions: positions,
      }),
    }).catch((err) => console.error("Auto-save error:", err));
  };

  // PRD-19 (Block B): is the question locked against edits? A committed
  // ('answered') question is read-only unless allowAnswerChange — mirrors
  // isAnswerLocked in the SCORM runtime. Cross-section freeze (answerCommitScope
  // 'section') is enforced by bounding «Назад» to the current section (below),
  // so a frozen section is never reachable for editing.
  const isQuestionLocked = (fq: FlatQuestion): boolean => {
    return questionStatus[fq.question.id] === "answered" && !navSettings.allowAnswerChange;
  };

  // Standard mode handlers
  const handleAnswer = (questionId: string, answer: any) => {
    const fq = flatQuestions[currentIndex];
    if (fq && isQuestionLocked(fq)) return; // committed + no allowAnswerChange → read-only

    // Pure update + side effects as plain statements (no side effects inside the
    // setAnswers updater). newAnswers is built from the current render's `answers`.
    const newAnswers = { ...answers, [questionId]: answer };
    setAnswers(newAnswers);

    // PRD-19 (Block B): re-editing a committed answer (allowAnswerChange on)
    // re-opens it — drop the 'answered' fixation until the learner re-commits.
    let nextStatus = questionStatus;
    if (questionStatus[questionId] === "answered") {
      nextStatus = { ...questionStatus, [questionId]: "unanswered" };
      setQuestionStatus(nextStatus);
    }

    // Автосохранение прогресса
    saveProgress(newAnswers, currentIndex, nextStatus);
  };

  /**
   * Вердикт по одному ответу для мгновенного фидбека стандартного теста —
   * доля от максимума (`s / sMax`), 1 = полностью верно, 0 < r < 1 = частично.
   *
   * PRD-10 (FR-12): считает ОБЩИЙ движок оценивания по эффективному конфигу теста
   * (`question.scoring`, то же поле, что печёт SCORM-пакет), а не собственная
   * логика точного совпадения. До этого веб-хост в стандартном режиме не мог
   * показать частичный балл: ступенчатая/весовая цена ответа доходила до итогов
   * (`shared/scoring/aggregate`), но не до баннера сразу после ответа.
   * Отсутствие конфига = `exact` = прежние 0/1.
   *
   * Ключ ответа приходит только у теста с «показывать правильность ответа» —
   * без него `correctJson` вырезан на сервере и оценивать нечего.
   */
  const scoreAnswerLocally = (question: GradedQuestion, answer: any): number => {
    const correct = question.correctJson as CorrectData | null;
    if (!correct) return 0;
    return scoreAnswer({
      type: question.type as ScoredQuestionType,
      correct,
      answer,
      scoring: question.scoring ?? null,
    }).ratio;
  };

  // Подтвердить ответ (показать фидбек) для стандартного теста
  const handleStandardConfirm = () => {
    const currentQ = flatQuestions[currentIndex];
    const currentAnswer = answers[currentQ.question.id];

    if (currentAnswer === undefined || currentAnswer === null) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, ответьте на вопрос",
      });
      return;
    }

    if (currentQ.question.type === "multiple" && Array.isArray(currentAnswer) && currentAnswer.length === 0) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, выберите хотя бы один вариант ответа",
      });
      return;
    }

    const scoreRatio = scoreAnswerLocally(currentQ.question, currentAnswer);
    const correctAnswer = currentQ.question.correctJson;
    // issue #34: текст пояснения выбирает ОБЩЕЕ правило по режиму вопроса, то же,
    // что и рантайм пакета. Читать один `feedback` было нельзя: у вопроса с условной
    // обратной связью редактор обнуляет это поле, и баннер выходил без пояснения.
    const feedback = feedbackTextFor(currentQ.question, scoreRatio === 1);

    setStandardAnswerResult({
      isCorrect: scoreRatio === 1,
      scoreRatio,
      correctAnswer,
      feedback: feedback || undefined,
    });
    setStandardFeedbackShown(true);

    // PRD-19 (Block B): «Принять» is the explicit fixation point in
    // showCorrectAnswers mode — mark the question 'answered' and persist.
    const nextStatus = { ...questionStatus, [currentQ.question.id]: "answered" as const };
    setQuestionStatus(nextStatus);
    saveProgress(answers, currentIndex, nextStatus);
  };

  // Перейти к следующему вопросу после просмотра фидбека
  const handleStandardContinue = () => {
    setStandardFeedbackShown(false);
    setStandardAnswerResult(null);

    // Skip past any topic whose section timer has already expired.
    const nextIdx = nextAccessibleIndex(flatQuestions, currentIndex + 1, lockedTopics);
    // PRD-19 D5: a section boundary (or test end) is intercepted by the staged
    // finish обзор instead of crossing straight into the next section.
    advanceOrStageFinish(nextIdx, answers, questionStatus);
  };

  const handleNext = () => {
    const currentQ = flatQuestions[currentIndex];
    const currentAnswer = answers[currentQ.question.id];

    if (currentAnswer === undefined || currentAnswer === null) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, ответьте на вопрос перед продолжением",
      });
      return;
    }

    if (currentQ.question.type === "multiple" && Array.isArray(currentAnswer) && currentAnswer.length === 0) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, выберите хотя бы один вариант ответа",
      });
      return;
    }

    if (currentQ.question.type === "matching") {
      const data = currentQ.question.dataJson as any;
      const leftItems = data.left || [];
      const pairs = currentAnswer || {};

      for (let i = 0; i < leftItems.length; i++) {
        if (pairs[i] === undefined || pairs[i] === null) {
          toast({
            variant: "destructive",
            title: "Требуется ответ",
            description: "Пожалуйста, сопоставьте все элементы",
          });
          return;
        }
      }
    }

    // PRD-19 (Block B): «Далее» commits the current answer — mark 'answered'.
    const nextStatus = { ...questionStatus, [currentQ.question.id]: "answered" as const };
    setQuestionStatus(nextStatus);

    // Skip past any topic whose section timer has already expired.
    const nextIdx = nextAccessibleIndex(flatQuestions, currentIndex + 1, lockedTopics);
    // PRD-19 D5: intercept a section boundary / test end with the staged обзор.
    advanceOrStageFinish(nextIdx, answers, nextStatus);
  };

  // PRD-19 (Block B): «Пропустить» — flexible mode only. Marks the current
  // question 'skipped' WITHOUT requiring an answer, clears any uncommitted draft
  // (so a final 'skipped' scores as incorrect, FR-07 — the server grades answers,
  // not status), then advances. Mirrors skipQuestion in the SCORM runtime.
  const handleSkip = () => {
    if (!navSettings.allowReturnToUnanswered) return;
    const currentQ = flatQuestions[currentIndex];
    if (!currentQ) return;
    setStandardFeedbackShown(false);
    setStandardAnswerResult(null);
    const nextStatus = { ...questionStatus, [currentQ.question.id]: "skipped" as const };
    setQuestionStatus(nextStatus);
    // PRD-19 (Block B): clear the uncommitted draft so a skipped question scores as
    // incorrect (FR-07) — the server grades answers, not status. Mirrors SCORM skipQuestion.
    const nextAnswers = { ...answers };
    delete nextAnswers[currentQ.question.id];
    setAnswers(nextAnswers);
    const nextIdx = nextAccessibleIndex(flatQuestions, currentIndex + 1, lockedTopics);
    // PRD-19 D5: intercept a section boundary / test end with the staged обзор.
    advanceOrStageFinish(nextIdx, nextAnswers, nextStatus);
  };

  // ─── PRD-19 D5: staged completion (section-finish → section-results → next) ────

  /** Sectional flows commit answers per section; flat commits the whole test. */
  const sectionScope = navSettings.answerCommitScope === "section";

  /** True when `topicId` is the LAST section in delivery order (no later topic). */
  const isLastSectionWeb = (topicId: string): boolean => {
    const last = flatQuestions[flatQuestions.length - 1];
    return !last || last.topicId === topicId;
  };

  /** First accessible question index AFTER the contiguous block of `topicId`. */
  const firstIndexAfterSection = (topicId: string): number | null => {
    let i = 0;
    while (i < flatQuestions.length && flatQuestions[i].topicId !== topicId) i++;
    while (i < flatQuestions.length && flatQuestions[i].topicId === topicId) i++;
    if (i >= flatQuestions.length) return null;
    return nextAccessibleIndex(flatQuestions, i, lockedTopics);
  };

  /**
   * The run as «Структура» declares it, from the SHARED builder — the same
   * sequence the SCORM package walks. Used to find which author pages fall
   * between two questions.
   */
  const pageSequence = useMemo(
    () =>
      buildPageSequence({
        flowMode: flowStructure.flowMode,
        testMode: "standard",
        sections,
        contentPages: flowStructure.contentPages,
        flatQuestions,
      }).sequence,
    [flowStructure, sections, flatQuestions],
  );

  // Deliver the entered section's «перед темой» zone once the learner has actually
  // arrived at its first question — i.e. after the previous section's обзор /
  // итоги раздела, whichever path led here.
  useEffect(() => {
    if (phase !== "question" || !contentTpl || showReview || sectionResultView) return;
    if (!arrivalZone || arrivalZone.forIndex !== currentIndex) return;
    setPageQueue(arrivalZone.pages);
    setArrivalZone(null);
    setPhase("content");
  }, [phase, contentTpl, arrivalZone, currentIndex, showReview, sectionResultView]);

  const isRouterMode = flowStructure.flowMode === "router_by_topics";
  /** The hub page itself (the `router` content page the author placed). */
  const hubPage = useMemo(
    () => flowStructure.contentPages.find((p) => p.kind === "router") as RenderableContentPage | undefined,
    [flowStructure.contentPages],
  );

  /** Section list for the hub, enriched from the drawn variant. */
  const hubSections = useMemo(
    () =>
      sections.map((s) => {
        const q = flatQuestions.find((fq) => fq.topicId === s.topicId);
        return {
          topicId: s.topicId,
          topicName: q?.topicName || s.topicId,
          drawCount: flatQuestions.filter((fq) => fq.topicId === s.topicId).length,
          timeLimitMinutes: q?.sectionTimeLimitMinutes ?? null,
        };
      }),
    [sections, flatQuestions],
  );

  /** Enters a section from the hub: its «перед темой» zone, then its questions. */
  const selectRouterTopic = (topicId: string) => {
    const firstOfTopic = flatQuestions.findIndex((q) => q.topicId === topicId);
    // Re-entering a started section resumes at the question the learner stopped on
    // (the saved position), not at its beginning — «продолжить», not «начать заново».
    const saved = sectionPositions[topicId];
    const first =
      typeof saved === "number" && flatQuestions[saved]?.topicId === topicId ? saved : firstOfTopic;
    setRouterTopicStates((prev) => ({ ...prev, [topicId]: "inProgress" }));
    setCurrentRouterTopic(topicId);
    setShowHub(false);
    const pre = contentPagesFor(flowStructure.contentPages, topicId, "before_topic") as RenderableContentPage[];
    if (pre.length > 0 && contentTpl) {
      setPageQueue(pre);
      setPendingAdvance({ nextIdx: first < 0 ? null : first, answers, status: questionStatus });
      setPhase("content");
      return;
    }
    if (first >= 0) setCurrentIndex(first);
    setPhase("question");
  };

  /** Marks a section completed, freezes it, and re-enters the hub. */
  const returnToHub = (topicId: string) => {
    setRouterTopicStates((prev) => ({ ...prev, [topicId]: "completed" }));
    // PRD-19 (FR-06): a finished section is frozen — its answers stop being
    // editable, the same as the SCORM runtime does in returnFromTopic.
    setSectionCommitted((prev) => ({ ...prev, [topicId]: true }));
    setCurrentRouterTopic(null);
    setPendingHubReturn(null);
    // Clear any staged in-section screens so the hub is what actually renders.
    setShowReview(false);
    setSectionResultView(null);
    setShowHub(true);
  };

  /** «Завершить» on the hub: the «После теста» zone, then submit. */
  const finishFromHub = () => {
    setShowHub(false);
    const after = contentTpl && !afterZonePlayed
      ? (contentPagesFor(flowStructure.contentPages, null, "after") as RenderableContentPage[])
          .filter((p) => (p as { type?: string }).type !== "summary")
      : [];
    if (after.length > 0) {
      setAfterZonePlayed(true);
      setPageQueue(after);
      setPendingSubmit(true);
      setPhase("content");
      return;
    }
    void submitAttempt();
  };

  /**
   * PRD-12 FR-6: play the author's content zone before crossing to `nextIdx`.
   *
   * The advance itself is DEFERRED (not dropped) — {@link applyAdvance} runs once
   * the queue drains, so the PRD-19 boundary logic still fires, and fires after the
   * «после темы» pages exactly as in the SCORM runtime (where those pages belong to
   * the section chunk and the boundary is detected past them).
   */
  const advanceOrStageFinish = (
    nextIdx: number | null,
    nextAnswers: Record<string, any>,
    nextStatus: Record<string, "unanswered" | "answered" | "skipped">,
  ) => {
    // Router mode: finishing a section returns to the hub instead of crossing into
    // whatever question happens to be next — the hub, not the question order, is
    // what decides where the learner goes.
    const curTopicId = flatQuestions[currentIndex]?.topicId ?? null;
    if (isRouterMode && currentRouterTopic && curTopicId === currentRouterTopic) {
      const leavingSection = nextIdx === null || flatQuestions[nextIdx]?.topicId !== currentRouterTopic;
      if (leavingSection) {
        // Persist directly, NOT through applyAdvance: its boundary logic also
        // handles the linear «next section» crossing, which the hub owns here.
        saveProgress(nextAnswers, currentIndex, nextStatus);
        // PRD-19 §4: `router_by_topics` is a SECTIONAL flow, so the section ends
        // on its обзор (when there is anything to act on there) and then on its
        // results — never straight back to the hub, which closed the section as
        // passed with questions the learner had deliberately skipped.
        if (!sectionCommitted[currentRouterTopic]) {
          if (
            shouldShowReview({
              allowReturnToUnanswered: navSettings.allowReturnToUnanswered,
              allowAnswerChange: navSettings.allowAnswerChange,
              hasUnanswered: hasUnansweredIn(nextStatus, currentRouterTopic),
              skipReviewWhenComplete: navSettings.skipReviewWhenComplete,
            })
          ) {
            setReviewFromButton(false);
            setShowReview(true);
            return;
          }
          // Nothing to act on: commit the section and go to its results (FR-05a),
          // which continue to the hub.
          void finishSectionWeb(currentRouterTopic, false);
          return;
        }
        const post = contentTpl
          ? (contentPagesFor(flowStructure.contentPages, currentRouterTopic, "after_topic") as RenderableContentPage[])
          : [];
        if (post.length > 0) {
          setPendingHubReturn(currentRouterTopic);
          setPageQueue(post);
          setPhase("content");
          return;
        }
        returnToHub(currentRouterTopic);
        return;
      }
    }

    const split = contentTpl
      ? splitZoneAtBoundary(
          pageSequence,
          currentIndex,
          nextIdx,
          (i) => flatQuestions[i]?.topicId ?? null,
        )
      : { departure: [], arrival: [] };

    // Pages of the section being ENTERED wait for the learner to actually get
    // there — after any boundary screens (обзор / итоги раздела), and regardless
    // of which path delivered them.
    setArrivalZone(
      nextIdx !== null && split.arrival.length > 0
        ? { forIndex: nextIdx, pages: split.arrival }
        : null,
    );

    if (split.departure.length > 0) {
      // Walking off the last question plays the «После теста» zone here; mark it so
      // «Завершить тест» in the обзор does not replay it.
      if (nextIdx === null) setAfterZonePlayed(true);
      setPageQueue(split.departure);
      setPendingAdvance({ nextIdx, answers: nextAnswers, status: nextStatus });
      setPhase("content");
      return;
    }
    applyAdvance(nextIdx, nextAnswers, nextStatus);
  };

  /**
   * Whether the scope still holds a question without a committed answer — the
   * input the shared обзор gate needs. `topicId === null` = the whole test (flat).
   */
  const hasUnansweredIn = (
    status: Record<string, "unanswered" | "answered" | "skipped">,
    topicId: string | null,
  ): boolean =>
    flatQuestions.some(
      (fq) => (topicId === null || fq.topicId === topicId) && status[fq.question.id] !== "answered",
    );

  /**
   * PRD-19 D5 (FR-05): advance after a commit/skip, but intercept a section
   * boundary (flexible sectional) or the test end (flexible flat) with the staged
   * обзор instead of crossing straight on. `nextIdx === null` = no further question
   * (test end). Strict mode keeps the plain advance (no обзор, FR-02/FR-08a).
   */
  const applyAdvance = (
    nextIdx: number | null,
    nextAnswers: Record<string, any>,
    nextStatus: Record<string, "unanswered" | "answered" | "skipped">,
  ) => {
    const curTopic = flatQuestions[currentIndex]?.topicId;
    if (sectionScope) {
      const crossing = !!curTopic && (nextIdx === null || flatQuestions[nextIdx].topicId !== curTopic);
      if (crossing && !sectionCommitted[curTopic!]) {
        if (
          shouldShowReview({
            allowReturnToUnanswered: navSettings.allowReturnToUnanswered,
            allowAnswerChange: navSettings.allowAnswerChange,
            hasUnanswered: hasUnansweredIn(nextStatus, curTopic!),
            skipReviewWhenComplete: navSettings.skipReviewWhenComplete,
          })
        ) {
          setReviewFromButton(false);
          setShowReview(true); // section обзор («Завершить раздел»)
          return;
        }
        // Nothing left to act on: straight to the computed section-results
        // (FR-05a) — no обзор/modal; the last section flows to the test results.
        if (navSettings.showSectionResults && !isLastSectionWeb(curTopic!)) {
          void finishSectionWeb(curTopic!, false);
          return;
        }
      }
    } else if (
      nextIdx === null &&
      shouldShowReview({
        allowReturnToUnanswered: navSettings.allowReturnToUnanswered,
        allowAnswerChange: navSettings.allowAnswerChange,
        hasUnanswered: hasUnansweredIn(nextStatus, null),
        skipReviewWhenComplete: navSettings.skipReviewWhenComplete,
      })
    ) {
      setReviewFromButton(false);
      setShowReview(true); // flat → single end-of-test обзор
      return;
    }
    if (nextIdx !== null) {
      setCurrentIndex(nextIdx);
      saveProgress(nextAnswers, nextIdx, nextStatus);
    } else {
      // Strict end (no обзор): submit is triggered by the «Завершить тест» button.
      saveProgress(nextAnswers, currentIndex, nextStatus);
    }
  };

  /**
   * PRD-19 D5 (FR-05/06): commit a section (freeze it) from its обзор, then show
   * the computed section-results (FR-05a, when `showSectionResults`) fetched via
   * the shared server grader (parity with SCORM), or advance to the next section.
   */
  const finishSectionWeb = async (topicId: string, isLast: boolean) => {
    setSectionCommitted((prev) => ({ ...prev, [topicId]: true })); // FR-06 freeze
    setShowReview(false);
    if (navSettings.showSectionResults && attempt && sectionResultsTpl) {
      try {
        const res = await fetch(`/api/attempts/${attempt.id}/section-result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          // PRD-19 Block E: drafts/skipped don't count toward the section score in flexible.
          body: JSON.stringify({ topicId, answers: pickGradedAnswers(answers, questionStatus, navSettings.allowReturnToUnanswered) }),
        });
        if (res.ok) {
          const d = await res.json();
          setSectionResultView({
            topicId,
            topicName: d.topicName,
            correct: d.correct,
            total: d.total,
            percent: d.percent,
            passed: d.passed,
            isLast,
          });
          // Freeze the outcome so the router hub card reflects it (parity with SCORM).
          setRouterSectionResults((prev) => ({ ...prev, [topicId]: { passed: d.passed } }));
          return;
        }
      } catch {
        /* fall through to advancing without the (optional) section-results screen */
      }
    }
    continueAfterSection(topicId, isLast);
  };

  /** «Продолжить»/«Завершить тест» after a section: next section, or finish the test. */
  const continueAfterSection = (topicId: string, isLast: boolean) => {
    setSectionResultView(null);
    setShowReview(false);
    // Router mode: a finished section hands control back to the hub — never to
    // whatever question comes next, and never straight to submit (the hub's own
    // «Завершить» does that). The «После раздела» zone plays on the way, exactly
    // as it does when the section ends without an обзор.
    if (isRouterMode) {
      const post = contentTpl
        ? (contentPagesFor(flowStructure.contentPages, topicId, "after_topic") as RenderableContentPage[])
        : [];
      if (post.length > 0) {
        setPendingHubReturn(topicId);
        setPageQueue(post);
        setPhase("content");
        return;
      }
      returnToHub(topicId);
      return;
    }
    if (isLast) {
      handleSubmit();
      return;
    }
    const nextIdx = firstIndexAfterSection(topicId);
    if (nextIdx === null) {
      handleSubmit();
      return;
    }
    setStandardFeedbackShown(false);
    setStandardAnswerResult(null);
    setCurrentIndex(nextIdx);
    saveProgress(answers, nextIdx, questionStatus);
  };

  const handleSubmit = async () => {
    if (!attempt) return;

    const unansweredQuestions = flatQuestions.filter(
      (fq) => answers[fq.question.id] === undefined || answers[fq.question.id] === null
    );

    // PRD-19 (Block B): strict-linear tests (allowReturnToUnanswered=false) still
    // require every question answered — you cannot skip, so any gap is a mistake.
    // Flexible tests MAY finish with skipped/unanswered questions: they score as
    // incorrect (FR-07). The обзор / finish-confirm warning is added in Block D.
    if (unansweredQuestions.length > 0 && !navSettings.allowReturnToUnanswered) {
      toast({
        variant: "destructive",
        title: "Не все вопросы отвечены",
        description: `Осталось ${unansweredQuestions.length} вопросов без ответа.`,
      });
      return;
    }

    // PRD-12 FR-6: the «После теста» pages that precede the results screen play
    // before the attempt is sent, mirroring the SCORM runtime (where they sit at
    // the tail of the sequence, ahead of the built-in results screen).
    if (!afterZonePlayed && contentTpl && flatQuestions.length > 0) {
      const zone = contentPagesBetween(pageSequence, flatQuestions.length - 1, null);
      if (zone.length > 0) {
        setAfterZonePlayed(true);
        setPageQueue(zone);
        setPendingSubmit(true);
        setPhase("content");
        return;
      }
    }

    await submitAttempt();
  };

  /** Sends the attempt and moves to the results page. */
  const submitAttempt = async () => {
    if (!attempt) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/attempts/${attempt.id}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ answers: pickGradedAnswers(answers, questionStatus, navSettings.allowReturnToUnanswered) }),
      });

      if (res.status === 404) { setAttemptGone(true); return; }
      if (!res.ok) throw new Error("Failed to submit");
      navigate(`/learner/result/${attempt.id}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Ошибка отправки",
        description: "Не удалось отправить ответы",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Finish the standard attempt with whatever answers exist (no unanswered
  // guard) — used when the LAST topic's section timer expires and there is no
  // further topic to advance into.
  const forceFinishStandard = async () => {
    if (!attempt) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/attempts/${attempt.id}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ answers: pickGradedAnswers(answers, questionStatus, navSettings.allowReturnToUnanswered) }),
      });
      if (res.status === 404) { setAttemptGone(true); return; }
      if (!res.ok) throw new Error("Failed to submit");
      navigate(`/learner/result/${attempt.id}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Ошибка отправки",
        description: "Не удалось отправить ответы",
      });
      setIsSubmitting(false);
    }
  };

  // Section-timer expiry (PRD-4 v1.1 §3.2): the viewed topic ran out of time.
  // Force-advance past it to the next non-locked topic (or finish the test).
  // `lockedTopics` lags the just-expired topic by a tick, so union it in.
  const handleSectionExpire = (expiredTopicId: string) => {
    const locked = new Set(lockedTopics);
    locked.add(expiredTopicId);
    const target = forceAdvanceTarget(flatQuestions, expiredTopicId, currentIndex, locked);
    setStandardFeedbackShown(false);
    setStandardAnswerResult(null);
    toast({
      variant: "destructive",
      title: "Время темы истекло",
      description: target === null ? "Завершаем тест" : "Переходим к следующей теме",
    });
    if (target === null) {
      void forceFinishStandard();
    } else {
      setCurrentIndex(target);
    }
  };
  // Keep the hook's expiry callback pointed at the latest closure each render.
  sectionExpireRef.current = handleSectionExpire;

  // Adaptive mode handlers

  // Apply an expire-topic-adaptive response: jump straight to the next topic's
  // first question (the learner didn't act — we auto-advance), or finish.
  const applyAdaptiveExpireResult = (data: any) => {
    if (data.isFinished) {
      setAdaptiveState((prev) =>
        prev ? { ...prev, isFinished: true, result: data.result, currentQuestion: null } : null,
      );
      return;
    }
    if (data.nextQuestion) {
      setShuffleMappings((prev) => ({
        ...prev,
        [data.nextQuestion.question.id]: createAdaptiveShuffleMapping(data.nextQuestion.question),
      }));
      setFeedbackShown(false);
      setShowTransition(false);
      setAdaptiveState((prev) =>
        prev
          ? {
              ...prev,
              currentQuestion: data.nextQuestion,
              currentTopicIndex: data.topicTransition
                ? prev.currentTopicIndex + 1
                : prev.currentTopicIndex,
              answer: null,
              lastResult: null,
            }
          : null,
      );
    }
  };

  // Ask the server to force the topic transition, retrying with backoff while
  // the network is down (per the resilience requirement). Idempotent server-side,
  // so a lost response that already advanced just re-syncs the current question.
  const postExpireTopicWithRetry = async (attemptId: string, topicId: string): Promise<any | null> => {
    let delay = 1000;
    while (mountedRef.current) {
      try {
        const res = await fetch(`/api/attempts/${attemptId}/expire-topic-adaptive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ topicId }),
        });
        if (res.ok) return await res.json();
        if (res.status >= 400 && res.status < 500) return null; // unrecoverable
      } catch {
        // Network error — keep retrying after backoff until reconnect.
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15_000);
    }
    return null;
  };

  // Adaptive topic timer expired: freeze input, advance via the server (retrying
  // through network loss), then render the next topic / finished state.
  const handleAdaptiveTopicExpire = async (topicId: string) => {
    const attemptId = adaptiveState?.attemptId;
    if (!attemptId) return;
    toast({
      variant: "destructive",
      title: "Время темы истекло",
      description: "Переходим к следующей теме",
    });
    setIsAnswering(true); // freeze the current question while we transition
    const data = await postExpireTopicWithRetry(attemptId, topicId);
    setIsAnswering(false);
    if (data) applyAdaptiveExpireResult(data);
  };
  // Keep the hook's expiry callback pointed at the latest closure each render.
  adaptiveExpireRef.current = handleAdaptiveTopicExpire;

  const handleAdaptiveAnswer = (answer: any) => {
    if (!adaptiveState) return;
    setAdaptiveState({ ...adaptiveState, answer });
  };

  // Подтвердить ответ (показать фидбек) - для режима showCorrectAnswers
  const handleAdaptiveConfirm = async () => {
    if (!adaptiveState || !adaptiveState.currentQuestion || adaptiveState.answer === null) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, ответьте на вопрос",
      });
      return;
    }

    setIsAnswering(true);
    try {
      const res = await fetch(`/api/attempts/${adaptiveState.attemptId}/answer-adaptive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          questionId: adaptiveState.currentQuestion.id,
          answer: adaptiveState.answer,
        }),
      });

      if (res.status === 404) { setAttemptGone(true); return; }
      if (!res.ok) throw new Error("Failed to submit answer");
      const data = await res.json();

      // Сохраняем результат для показа и данные для перехода
      setLastAnswerResult({
        isCorrect: data.isCorrect,
        correctAnswer: data.correctAnswer,
        feedback: data.feedback,
      });
      setFeedbackShown(true);

      // Сохраняем данные для перехода к следующему вопросу
      setAdaptiveState({
        ...adaptiveState,
        lastResult: {
          isCorrect: data.isCorrect,
          correctAnswer: data.correctAnswer,
          feedback: data.feedback,
          levelTransition: data.levelTransition,
          topicTransition: data.topicTransition,
        },
        questionsAnswered: adaptiveState.questionsAnswered + 1,
      });
      (window as any).__adaptiveNextData = data;

    } catch (err) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Не удалось отправить ответ",
      });
    } finally {
      setIsAnswering(false);
    }
  };

  // Перейти к следующему вопросу (после просмотра фидбека)
  const handleAdaptiveContinue = () => {
    const data = (window as any).__adaptiveNextData;
    if (!data || !adaptiveState) return;

    setFeedbackShown(false);
    setLastAnswerResult(null);

    // Показываем переход если включено
    if (data.nextQuestion) {
      setShuffleMappings(prev => ({
        ...prev,
        [data.nextQuestion.question.id]: createAdaptiveShuffleMapping(data.nextQuestion.question),
      }));
    }
    if (adaptiveState.showDifficultyLevel && (data.levelTransition || data.topicTransition)) {
      setShowTransition(true);

      setTimeout(() => {
        setShowTransition(false);
        if (data.isFinished) {
          setAdaptiveState(prev => prev ? {
            ...prev,
            isFinished: true,
            result: data.result,
            currentQuestion: null,
            lastResult: null,
          } : null);
        } else {
          setAdaptiveState(prev => prev ? {
            ...prev,
            currentQuestion: data.nextQuestion,
            currentTopicIndex: data.topicTransition
              ? prev.currentTopicIndex + 1
              : prev.currentTopicIndex,
            answer: null,
            lastResult: null,
          } : null);
        }
      }, 2500);
    } else if (data.isFinished) {
      setAdaptiveState(prev => prev ? {
        ...prev,
        isFinished: true,
        result: data.result,
        currentQuestion: null,
        lastResult: null,
      } : null);
    } else {
      setAdaptiveState(prev => prev ? {
        ...prev,
        currentQuestion: data.nextQuestion,
        currentTopicIndex: data.topicTransition
          ? prev.currentTopicIndex + 1
          : prev.currentTopicIndex,
        answer: null,
        lastResult: null,
      } : null);
    }

    (window as any).__adaptiveNextData = null;
  };

  // Отправить ответ без показа фидбека (когда showCorrectAnswers выключен)
  const handleAdaptiveSubmit = async () => {
    if (!adaptiveState || !adaptiveState.currentQuestion || adaptiveState.answer === null) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, ответьте на вопрос",
      });
      return;
    }

    setIsAnswering(true);
    try {
      const res = await fetch(`/api/attempts/${adaptiveState.attemptId}/answer-adaptive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          questionId: adaptiveState.currentQuestion.id,
          answer: adaptiveState.answer,
        }),
      });

      if (res.status === 404) { setAttemptGone(true); return; }
      if (!res.ok) throw new Error("Failed to submit answer");
      const data = await res.json();

      // Show transition if level changed AND showDifficultyLevel is enabled
      if (data.nextQuestion) {
        setShuffleMappings(prev => ({
          ...prev,
          [data.nextQuestion.question.id]: createAdaptiveShuffleMapping(data.nextQuestion.question),
        }));
      }
      if (adaptiveState.showDifficultyLevel && (data.levelTransition || data.topicTransition)) {
        setShowTransition(true);
        setAdaptiveState({
          ...adaptiveState,
          lastResult: {
            isCorrect: data.isCorrect,
            correctAnswer: data.correctAnswer,
            feedback: data.feedback,
            levelTransition: data.levelTransition,
            topicTransition: data.topicTransition,
          },
          questionsAnswered: adaptiveState.questionsAnswered + 1,
        });

        // Auto-continue after delay
        setTimeout(() => {
          setShowTransition(false);
          if (data.isFinished) {
            setAdaptiveState(prev => prev ? {
              ...prev,
              isFinished: true,
              result: data.result,
              currentQuestion: null,
            } : null);
          } else {
            setAdaptiveState(prev => prev ? {
              ...prev,
              currentQuestion: data.nextQuestion,
              currentTopicIndex: data.topicTransition
                ? prev.currentTopicIndex + 1
                : prev.currentTopicIndex,
              answer: null,
              lastResult: null,
            } : null);
          }
        }, 2500);
      } else {
        // No transition, just move to next question
        if (data.isFinished) {
          setAdaptiveState({
            ...adaptiveState,
            isFinished: true,
            result: data.result,
            currentQuestion: null,
            questionsAnswered: adaptiveState.questionsAnswered + 1,
          });
        } else {
          setAdaptiveState({
            ...adaptiveState,
            currentQuestion: data.nextQuestion,
            answer: null,
            lastResult: null,
            questionsAnswered: adaptiveState.questionsAnswered + 1,
          });
        }
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Не удалось отправить ответ",
      });
    } finally {
      setIsAnswering(false);
    }
  };

  // PRD-12 parity: an adaptive session ends where a standard one does — on the
  // result page, which renders the итоги from the shared `results.adaptive` layout.
  // The run used to end on a React card of its own instead, so the same attempt
  // looked one way right after finishing and another way from «История».
  useEffect(() => {
    if (testMode !== "adaptive") return;
    if (!adaptiveState?.isFinished || !adaptiveState.attemptId) return;
    navigate(`/learner/result/${adaptiveState.attemptId}`);
  }, [testMode, adaptiveState?.isFinished, adaptiveState?.attemptId]);

  // Loading state
  // PRD-15 FR-14: the attempt was annulled by an emergency re-publish (404 on
  // submit/answer). Tell the learner the attempt is not counted and let them
  // restart — reloading re-enters the start flow with a fresh attempt.
  if (attemptGone) {
    return (
      <Center minH="screen" pad={6}>
        <Box full maxW="md">
          <Card>
            <CardHeader title={<Cluster gap={2}><RotateCcw size={20} color="var(--ou-accent-default)" />Тест обновлён</Cluster>} />
            <CardBody>
              <Stack gap={4}>
                <Text variant="body-s" tone="muted">
                  Эта попытка прервана: тест переопубликован. Попытка не засчитана — начните прохождение заново.
                </Text>
                <Button fullWidth onClick={() => window.location.reload()}>Начать заново</Button>
              </Stack>
            </CardBody>
          </Card>
        </Box>
      </Center>
    );
  }

  if (phase === "loading" || (isStarting && phase !== "start")) {
    return <LoadingState message={t.common.preparingTest} />;
  }

  // Retake block-wall (PRD-6 / PRD-12) — rendered from system.blocked.html. The
  // cooldown branch is revealed via injected CSS (the layout uses data-retake-branch
  // toggling, which the SCORM gate.js drives with its own JS — we keep it intact).
  if (phase === "blocked" && blockedTpl && blockData) {
    const availableDateHuman = blockData.availableDate
      ? new Date(blockData.availableDate + "T00:00:00")
          .toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
          .replace(/\s*г\.?$/, "") // layout already adds the trailing period
      : "—";
    const blockCss =
      blockedTpl.css +
      '\n[data-retake-branch="default"],[data-retake-branch="error"]{display:none}[data-retake-branch="cooldown"]{display:block}';
    return (
      <div className="tbh-screen tbh-col" style={{ background: blockedTpl.theme?.background }}>
        <TemplateScreen
          className="tbh-fill"
          layout={blockedTpl.layout}
          css={blockCss}
          cssVars={blockedTpl.cssVars}
          themeCss={blockedTpl.themeCss}
          dataTheme={blockedTpl.dataTheme}
          themed={blockedTpl.themed}
          context={{ retake: { cooldownPeriodDays: blockData.cooldownPeriodDays, availableDateHuman }, ...(blockedTpl.design ? { design: blockedTpl.design } : {}) }}
        />
        {
          // In a restricted session there is no test list to offer, and this
          // blocked screen already IS the learner's own test — a "back to my
          // test" button here would just point at the screen already showing,
          // reading as a dead click rather than useful navigation. Omit it.
          !magicScoped && (
            <div className="tbh-center-foot">
              <Button variant="secondary" leadingIcon={<ChevronLeft size={16} />} onClick={() => navigate("/learner")}>
                К списку тестов
              </Button>
            </div>
          )
        }
      </div>
    );
  }

  // Start page — render via the design template (standard mode) when available.
  // Context comes from the SHARED start-state builder (PRD-12 §10) — the same model
  // the SCORM host produces: resume-with-position, "Начать заново" and "Мой результат"
  // now appear on the web start too (parity), gated by the same flags.
  // PRD-12 FR-6: an author content page — rendered from the design template's own
  // content layout through the shared assembler, so the web shows exactly what the
  // SCORM package shows. Walked one page at a time; when the queue drains, the run
  // continues into the questions.
  // PRD-12 FR-6: the router hub. Rendered through the design template's content
  // wrapper with the SHARED hub markup in its page-content slot — the same cards,
  // classes and open/locked rules the SCORM package renders.
  if (showHub && contentTpl && hubPage) {
    const hubHubState = {
      topicStates: routerTopicStates,
      sectionResults: routerSectionResults,
      unlockRules: {},
      completionPolicy: null,
      // Same gate as SCORM: only reveal a section's pass/fail on the card when the
      // test shows section results; otherwise the card stays a neutral «Завершена».
      showSectionResults: navSettings.showSectionResults,
    };
    const hubReady = isRouterReadyToFinish(hubSections, hubHubState);
    return (
      <TemplateContentScreen
        page={hubPage}
        template={contentTpl}
        courseTitle={testInfo?.title || attempt?.testTitle || ""}
        // The hub is the section menu, not an in-attempt screen — no «Попытка N».
        bodyHtml={buildRouterHubHtml(hubSections, hubHubState)}
        onBodyAction={(action) => {
          if (action.startsWith("router-select:")) {
            selectRouterTopic(action.slice("router-select:".length));
          }
        }}
        // «Завершить» is the standard footer nav button, inert until every required
        // section is done; the click routes to finishFromHub via onNext.
        nextLabel="Завершить"
        nextDisabled={!hubReady}
        // The hub is OUTSIDE any section, so only the test countdown belongs here.
        // The section timer keeps running in state (its deadline is absolute), but
        // showing it on the menu reads as «время раздела идёт», which it is not for
        // the learner standing here.
        timers={{ testSeconds: remainingSeconds, sectionSeconds: null }}
        onNext={finishFromHub}
      />
    );
  }

  if (phase === "content" && contentTpl && pageQueue.length > 0) {
    const page = pageQueue[0];
    // «Введение раздела» binds `sectionIntro.*`, built by the SHARED builder from
    // the section it introduces — the same context the SCORM runtime feeds it.
    const introTopicId = (page as { topicId?: string | null }).topicId ?? null;
    const introContext =
      page.kind === "intro" && introTopicId
        ? buildSectionIntroContext({
            topicName: flatQuestions.find((q) => q.topicId === introTopicId)?.topicName || "",
            description: "",
            questionCount: flatQuestions.filter((q) => q.topicId === introTopicId).length,
            timeLimitMinutes:
              flatQuestions.find((q) => q.topicId === introTopicId)?.sectionTimeLimitMinutes ?? null,
            sectionNumber: Math.max(1, sections.findIndex((s) => s.topicId === introTopicId) + 1),
            sectionsTotal: sections.length,
            courseTitle: testInfo?.title || attempt?.testTitle || "",
            instruction: String((page.valuesJson?.values as any)?.instruction ?? ""),
          })
        : undefined;
    return (
      <TemplateContentScreen
        page={page}
        template={contentTpl}
        extraContext={introContext}
        courseTitle={testInfo?.title || attempt?.testTitle || ""}
        timers={{ testSeconds: remainingSeconds, sectionSeconds: sectionRemainingSeconds }}
        // PRD-22: the whole structure, so the navigation dots of a sequence are
        // computed by the shared core exactly as the SCORM runtime computes them.
        allPages={flowStructure.contentPages}
        onBack={
          // «Назад» from a section's intro returns to the hub WITHOUT completing
          // the section — it reverts to «Не начата», mirroring the SCORM runtime.
          isRouterMode && currentRouterTopic
            ? () => {
                const topicId = currentRouterTopic;
                setRouterTopicStates((prev) => {
                  const next = { ...prev };
                  if (next[topicId] === "inProgress") delete next[topicId];
                  return next;
                });
                setCurrentRouterTopic(null);
                setPageQueue([]);
                setPendingAdvance(null);
                setShowHub(true);
              }
            : undefined
        }
        onNext={() => {
          const rest = pageQueue.slice(1);
          setPageQueue(rest);
          if (rest.length > 0) return;
          // The zone played before submitting — finish now, without flashing the
          // question screen on the way out.
          if (pendingSubmit) {
            setPendingSubmit(false);
            void submitAttempt();
            return;
          }
          // The section's «после темы» zone played on the way back to the hub.
          if (pendingHubReturn) {
            returnToHub(pendingHubReturn);
            return;
          }
          // «До теста» finished in a router test: the hub is what comes next, not
          // the first question — the learner chooses the section.
          if (isRouterMode && !currentRouterTopic && !pendingAdvance) {
            setShowHub(true);
            return;
          }
          setPhase("question");
          // Apply the advance this zone interrupted, so the section boundary
          // (обзор / итоги раздела) is evaluated now, after the zone — not skipped.
          const pending = pendingAdvance;
          if (pending) {
            setPendingAdvance(null);
            applyAdvance(pending.nextIdx, pending.answers, pending.status);
          }
        }}
      />
    );
  }
  // Start screen — BOTH modes. It was gated on `testMode === "standard"` while the
  // legacy React start screen still covered adaptive; that screen was then removed
  // («ученические экраны только из шаблонов»), which left adaptive tests matching no
  // branch at all — an endless «Подготовка теста...». The layout itself is
  // mode-agnostic: it renders the facts it is given.
  if (phase === "start" && testInfo && testMetadata && startTpl) {
    const exhausted =
      testMetadata.maxAttempts !== null && testMetadata.completedAttempts >= testMetadata.maxAttempts;
    // PRD-19 Block F (FR-19/20): cooldown facts render the cooldown card + disabled
    // start button ON this start page (no separate block-wall). Prior summary shows
    // for both eligible «повтор: можно» and cooldown.
    const gate = testMetadata.retakeGate;
    const startContext = buildStartState({
      info: {
        title: testInfo.title,
        description: testInfo.description || "",
        // Adaptive draws from its levels, not from the section quotas, so the
        // count is unknown up front: omit the fact instead of promising «0
        // вопросов» (the layout hides a fact it is not given).
        questionCount: testMode === "adaptive" ? undefined : testMetadata.totalQuestions,
        passPercent: testMetadata.passPercent,
        hasGradedContent: testMetadata.hasGradedContent,
        timeLimitMinutes: testMetadata.timeLimitMinutes,
        maxAttempts: testMetadata.maxAttempts,
        startPageContent: testMetadata.startPageContent || "",
      },
      maxAttempts: testMetadata.maxAttempts,
      completedAttempts: testMetadata.completedAttempts,
      // Adaptive has no resume: `handleResumeTest` cannot restore an adaptive
      // attempt and always starts a new one, and the variant carries no drawn
      // question list, so the offer would read «вопрос 1 из 0» and then not do
      // what it says. Offer a start instead.
      resume:
        testMetadata.hasInProgress && !exhausted && testMode !== "adaptive"
          ? { index: testMetadata.resumeIndex ?? 0, total: testMetadata.resumeTotal ?? 0 }
          : null,
      // «Мой результат» must only appear when there is an attempt to open — a
      // completed-attempt count with no id would render a dead button.
      hasCompletedResults: testMetadata.lastCompletedAttemptId !== null,
      canStartNew: !exhausted,
      // PRD-31: the same card carries both barriers. Barrier B opens at an instant,
      // so it shows a date WITH a time; barrier A keeps the plain calendar date and
      // its «через N дн.» countdown, which an hour interval has no use for.
      cooldown: gate
        ? {
            availableDateHuman:
              gate.blockedBy === "attemptInterval"
                ? fmtIsoInstantHuman(gate.availableAt)
                : fmtIsoDateHuman(gate.availableDate),
            daysUntil: gate.daysUntil,
          }
        : null,
      priorResult: testMetadata.priorResult,
      // PRD-19 FR-20: «Скачать отчёт» по прошлой попытке — тот же документ, что на
      // экране итогов. Признак тот же, что у пакета: отчёт предлагается там, где есть
      // сохранённый результат прошлой попытки (`priorResult` строится ровно из него).
      canDownloadReport: !!testMetadata.priorResult,
      // A magic-link session has no test list to fall back to (it would just
      // bounce to /login), so the ghost «К списку тестов» button is not offered
      // at all in that case.
      showBack: !magicScoped,
    });
    return (
      <div
        // PRD-34 (FR-09): стартовый экран ВНЕ периметра защиты. Безусловный запрет
        // выделения и копирования снят: он стоял только на веб-хосте, настройкой не
        // управлялся и расходился с пакетом, где его нет.
        className="tbh-screen tbh-col"
        style={{ background: startTpl.theme?.background }}
      >
        <TemplateScreen
          className="tbh-fill"
          layout={startTpl.layout}
          css={startTpl.css}
          cssVars={startTpl.cssVars}
          themeCss={startTpl.themeCss}
          dataTheme={startTpl.dataTheme}
          themed={startTpl.themed}
          context={{ ...startContext, ...(startTpl.design ? { design: startTpl.design } : {}) }}
          onAction={(action) => {
            if (action === "start-test" || action === "restart") handleStartTest();
            else if (action === "resume") handleResumeTest();
            else if (action === "view-results" && testMetadata.lastCompletedAttemptId)
              navigate(`/learner/result/${testMetadata.lastCompletedAttemptId}`);
            else if (action === "download-report") void handleStartReport();
            else if (action === "back") {
              // The button is hidden via `showBack` above in a restricted session,
              // but stay robust regardless of how the action was reached: a
              // magic-link session must never be sent to the (out-of-scope) test
              // list, which would just bounce it to /login.
              navigate(magicScoped ? `/learner/test/${testId}` : "/learner");
            }
          }}
        />
      </div>
    );
  }

  // Still on the start phase, but the branch above could not render it: the start
  // template did not load. `testInfo`/`testMetadata` are always set before the phase
  // becomes "start", so this is unambiguous — report it and say so at once instead of
  // leaving the learner on a spinner that will never resolve.
  if (phase === "start") {
    return <ServiceErrorScreen diagnosis={`start screen unavailable: no start template (test ${testId})`} />;
  }

  // Adaptive mode — finished. The итоги render from the SHARED `results.adaptive`
  // layout, and that screen is the result page — the same one the standard flow
  // navigates to on submit (and the same one «История» opens). The redirect runs in
  // the effect above; this is the one frame before it lands.
  if (testMode === "adaptive" && adaptiveState?.isFinished) {
    return <LoadingState message={t.result.loading} />;
  }

  // Adaptive mode — level-change interstitial, from the SHARED `system.transition`
  // layout (the same screen the package renders via buildTransitionContext). Auto-
  // advances on the timer set by the answer handlers, so the layout's «Продолжить»
  // is not requested (showContinue: false).
  if (testMode === "adaptive" && showTransition && adaptiveState?.lastResult && transitionTpl) {
    const { levelTransition } = adaptiveState.lastResult;
    const ctx = buildTransitionContext({
      topicName: adaptiveState.currentQuestion?.topicName || "",
      levelTransition: levelTransition || null,
      showContinue: false,
    });
    return (
      <div className="tbh-screen tbh-col">
        <TemplateScreen
          className="tbh-fill"
          layout={transitionTpl.layout}
          css={transitionTpl.css}
          cssVars={transitionTpl.cssVars}
          themeCss={transitionTpl.themeCss}
          dataTheme={transitionTpl.dataTheme}
          themed={transitionTpl.themed}
          context={{ ...ctx, course: { title: adaptiveState.testTitle }, design: transitionTpl.design }}
        />
      </div>
    );
  }

  // Adaptive mode - question
  if (testMode === "adaptive" && adaptiveState?.currentQuestion) {
    const { currentQuestion, showDifficultyLevel, testTitle } = adaptiveState;
    const currentQ = currentQuestion.question;

    // Templated path (PRD-12): the adaptive question renders via the shared
    // question.html — same engine/layout as standard — with adaptive nav and the
    // after-answer feedback in the question-feedback slot. Falls back to the React
    // markup below when the template is unavailable.
    if (questionTpl) {
      const counter =
        `Тема: ${currentQuestion.topicName} · Вопрос ${currentQuestion.questionNumber} из ${currentQuestion.totalInLevel}` +
        (showDifficultyLevel && currentQuestion.levelName ? ` · ${currentQuestion.levelName}` : "") +
        (adaptiveSectionRemaining !== null
          ? ` · Время темы ${Math.floor(adaptiveSectionRemaining / 60)}:${String(adaptiveSectionRemaining % 60).padStart(2, "0")}`
          : "");
      const fbHtml = feedbackShown && lastAnswerResult ? adaptiveFeedbackHtml(currentQ, lastAnswerResult) : "";
      // The nav row is the TEMPLATE's scene footer, exactly as in the standard flow
      // (and as in the package, buildAdaptiveNavState) — the host builds no footer of
      // its own. Adaptive is strictly sequential, so this is the strict-linear row:
      // no «Назад»/«Пропустить»/«К обзору», and `hasNext` is always true — only the
      // server knows when the session ends, so the row never says «Завершить тест».
      const adaptiveNav: QuestionNavState = {
        flexible: false,
        // PRD-43: adaptive isn't author-configurable here — `onAdaptiveNavAction`
        // already fixes-and-advances in one click whenever no feedback is shown,
        // so `true` just makes that existing behaviour explicit on the type.
        quickAdvance: true,
        committed: feedbackShown,
        canPrev: false,
        // Once the feedback is on screen the answer is fixed — «Далее» always works.
        answerReady: feedbackShown || (!isAnswering && adaptiveState.answer !== null),
        hasNext: true,
        showAccept: adaptiveState.showCorrectAnswers && !feedbackShown,
        showReview: false,
      };
      /** Wires the shared row's actions to the adaptive handlers. */
      const onAdaptiveNavAction = (action: string) => {
        // «Принять» — fix the answer and show the feedback (showCorrectAnswers only).
        if (action === QUESTION_NAV_ACTIONS.submit) return void handleAdaptiveConfirm();
        // «Далее» — continue past the shown feedback, or submit and advance.
        if (action === QUESTION_NAV_ACTIONS.next) {
          if (adaptiveState.showCorrectAnswers && feedbackShown) return handleAdaptiveContinue();
          return void handleAdaptiveSubmit();
        }
      };
      return (
        <TemplateQuestionScreen
          tpl={questionTpl}
          protection={questionProtection}
          testTitle={testTitle}
          counterLabel={counter}
          progressPercent={(currentQuestion.questionNumber / currentQuestion.totalInLevel) * 100}
          question={currentQ}
          answer={adaptiveState.answer}
          shuffleMapping={shuffleMappings[currentQ.id]}
          onAnswer={feedbackShown ? () => {} : handleAdaptiveAnswer}
          locked={feedbackShown}
          reviewMode={feedbackShown && adaptiveState.showCorrectAnswers}
          correctAnswer={lastAnswerResult?.correctAnswer}
          feedbackHtml={fbHtml}
          nav={adaptiveNav}
          onNavAction={onAdaptiveNavAction}
        />
      );
    }

  }

  // Standard mode — question screen via the design template (PRD-12 #3): all question
  // types (single/multiple/ranking/matching). The per-question feedback mode
  // (showCorrectAnswers) still uses the React markup below.
  // PRD-19 Block D: обзор (review) screen — rendered from the SHARED `review`
  // template layout (pills + unanswered list + «Завершить»), reached via «Вернуться».
  // Оформление — через шаблон (parity with SCORM); finish здесь = завершить тест.
  if (testMode === "standard" && attempt && flatQuestions.length > 0 && showReview && reviewTpl) {
    const curQ = flatQuestions[currentIndex];
    const curTopic = curQ.topicId;
    // PRD-19 D5: the last section without a section-results screen merges into the
    // «Завершить тест» step (no extra locked-review screen); otherwise «Завершить раздел».
    const isLast = isLastSectionWeb(curTopic);
    const finishLabel =
      !sectionScope || (isLast && !navSettings.showSectionResults) ? "Завершить тест" : "Завершить раздел";
    // Only questions the learner has actually reached (flat index <= the current
    // position) or committed are «delivered» — the обзор must not reveal not-yet-issued
    // questions. Mid-flow entry («Вернуться») additionally offers «Назад» + highlights
    // the current question.
    const built = buildReviewContext({
      questions: flatQuestions.map((fq, i) => {
        const st = questionStatus[fq.question.id];
        return {
          id: fq.question.id,
          topicId: fq.topicId,
          prompt: fq.question.prompt,
          delivered: i <= currentIndex || st === "answered" || st === "skipped",
        };
      }),
      statuses: questionStatus,
      commitScope: navSettings.answerCommitScope,
      scopeTopicId: sectionScope ? curTopic : null,
      isTest: !sectionScope,
      scopeLabel: sectionScope ? `Раздел «${curQ.topicName}» · обзор` : "Обзор теста",
      finishLabel,
      currentIndex: reviewFromButton ? currentIndex : -1,
      canReturn: reviewFromButton,
      backLabel: "Назад",
    });
    // Sectional → finish the current section (freeze → section-results → next);
    // flat → finish the whole test.
    const doFinish = () => {
      if (sectionScope) void finishSectionWeb(curTopic, isLast);
      else {
        setShowReview(false);
        void handleSubmit();
      }
    };
    return (
      <div className="tbh-screen tbh-col" style={{ background: reviewTpl.theme?.background }}>
        <TemplateScreen
          className="tbh-fill"
          protection={reviewProtection}
          layout={reviewTpl.layout}
          css={reviewTpl.css}
          cssVars={reviewTpl.cssVars}
          themeCss={reviewTpl.themeCss}
          dataTheme={reviewTpl.dataTheme}
          timers={{ testSeconds: remainingSeconds, sectionSeconds: sectionRemainingSeconds }}
          themed={reviewTpl.themed}
          context={{
            course: { title: attempt.testTitle },
            design: reviewTpl.design,
            state: { questionsProgress: built.questionsProgress },
            review: built.review,
          }}
          onAction={(action) => {
            if (action.startsWith("goto:")) {
              const i = Number(action.slice("goto:".length));
              // Frontier (FR-11): no jump into a timer-expired or frozen (committed) section.
              if (
                !Number.isNaN(i) &&
                i >= 0 &&
                i < flatQuestions.length &&
                !lockedTopics.has(flatQuestions[i].topicId) &&
                !sectionCommitted[flatQuestions[i].topicId]
              ) {
                setStandardFeedbackShown(false);
                setStandardAnswerResult(null);
                setCurrentIndex(i);
                saveProgress(answers, i, questionStatus);
              }
              setReviewFromButton(false);
              setShowReview(false);
            } else if (action === "review-back") {
              // «Назад» (mid-flow обзор): return to the origin question (currentIndex
              // is unchanged, so just close the обзор).
              setReviewFromButton(false);
              setShowReview(false);
            } else if (action === "finish-review") {
              // FR-09: confirm when finishing with unanswered questions.
              if (built.review.unansweredCount > 0) {
                setFinishConfirm({ count: built.review.unansweredCount, label: built.review.finishLabel, onConfirm: doFinish });
              } else {
                setReviewFromButton(false);
                doFinish();
              }
            }
          }}
        />
        {finishConfirm && (
          <ModalDialog
            open
            size="s"
            onClose={() => setFinishConfirm(null)}
            title={`${finishConfirm.label}?`}
            description={`Вопросов без ответа: ${finishConfirm.count}. Они будут засчитаны как неверные. После завершения вернуться к ним нельзя.`}
            footer={
              <>
                <Button variant="ghost" size="m" onClick={() => setFinishConfirm(null)}>
                  Отмена
                </Button>
                <Button
                  variant="primary"
                  size="m"
                  onClick={() => {
                    const run = finishConfirm.onConfirm;
                    setFinishConfirm(null);
                    run();
                  }}
                >
                  {finishConfirm.label}
                </Button>
              </>
            }
          />
        )}
      </div>
    );
  }

  // PRD-19 D5 (FR-05a): computed section-results (итоги раздела) — score ring +
  // summary + verdict + «Продолжить»/«Завершить тест». Built from the shared
  // section grader (parity with the SCORM-baked computeSectionResult) + the shared
  // buildSectionResultContext, rendered from the same section-results layout.
  if (testMode === "standard" && attempt && sectionResultView && sectionResultsTpl) {
    const srTopic = sectionResultView.topicId;
    // Section position among the delivered sections (unique topic order) — header
    // «Раздел N из M» tag + progress, parity with the SCORM runtime.
    const orderedTopics = Array.from(new Set(flatQuestions.map((q) => q.topicId)));
    const srPos = orderedTopics.indexOf(srTopic) + 1;
    const built = buildSectionResultContext({
      topicName: sectionResultView.topicName,
      correct: sectionResultView.correct,
      total: sectionResultView.total,
      percent: sectionResultView.percent,
      passed: sectionResultView.passed,
      courseTitle: testInfo?.title || attempt?.testTitle || "",
      sectionIndex: srPos || undefined,
      sectionsTotal: orderedTopics.length,
      continueLabel: sectionResultView.isLast ? "Завершить тест" : "Продолжить",
    });
    const srIsLast = sectionResultView.isLast;
    return (
      <div className="tbh-screen tbh-col" style={{ background: sectionResultsTpl.theme?.background }}>
        <TemplateScreen
          className="tbh-fill"
          // PRD-34 (FR-16): итоги раздела знак несут, от копирования не защищаются.
          protection={buildProtectionSpec({
            screen: "section-results",
            settings: { ...protectionSettings, copyProtection: false },
            stamp: protectionStamp,
          })}
          layout={sectionResultsTpl.layout}
          css={sectionResultsTpl.css}
          cssVars={sectionResultsTpl.cssVars}
          themeCss={sectionResultsTpl.themeCss}
          dataTheme={sectionResultsTpl.dataTheme}
          timers={{ testSeconds: remainingSeconds, sectionSeconds: sectionRemainingSeconds }}
          themed={sectionResultsTpl.themed}
          context={{
            course: built.course,
            design: sectionResultsTpl.design,
            sectionResult: built.sectionResult,
          }}
          onAction={(action) => {
            if (action === "section-continue") continueAfterSection(srTopic, srIsLast);
          }}
        />
      </div>
    );
  }

  if (
    testMode === "standard" &&
    attempt &&
    flatQuestions.length > 0 &&
    questionTpl
  ) {
    const currentQ = flatQuestions[currentIndex];
    // PRD-4 v1.1 §3.2 — section-timer state for the templated standard screen.
    const currentTopicLocked = lockedTopics.has(currentQ.topicId);
    const rawPrevIdx = prevAccessibleIndex(flatQuestions, currentIndex - 1, lockedTopics);
    // PRD-19 (Block B): bound «Назад». Strict mode (allowReturnToUnanswered=false)
    // forbids return entirely; sectional scope keeps return inside the current
    // section (earlier sections are frozen on exit). Flat flexible = free back-nav.
    let prevIdx = rawPrevIdx;
    if (!navSettings.allowReturnToUnanswered) {
      prevIdx = null;
    } else if (
      navSettings.answerCommitScope === "section" &&
      rawPrevIdx !== null &&
      flatQuestions[rawPrevIdx].topicId !== currentQ.topicId
    ) {
      prevIdx = null;
    }
    const isLastQuestion = currentIndex === flatQuestions.length - 1;
    // PRD-19 (Block B): «Пропустить» — flexible mode, before the current question
    // is committed and not during showCorrectAnswers feedback review.
    const committedCurrent = questionStatus[currentQ.question.id] === "answered";
    const canSkip = navSettings.allowReturnToUnanswered && !committedCurrent && !standardFeedbackShown;
    // PRD-19 (Block D / FR-04c): «Вернуться» → обзор, shown when skipped questions
    // exist in scope (section in sectional flows, whole test in flat).
    const hasSkipped =
      navSettings.allowReturnToUnanswered &&
      flatQuestions.some((fq) => {
        if (navSettings.answerCommitScope === "section" && fq.topicId !== currentQ.topicId) return false;
        return questionStatus[fq.question.id] === "skipped";
      });
    // PRD-19 (Block B): a committed answer is read-only unless allowAnswerChange.
    const prd19Locked = isQuestionLocked(currentQ);
    const goBack = () => {
      setStandardFeedbackShown(false);
      setStandardAnswerResult(null);
      // Skip back over any topic whose section timer already expired.
      if (prevIdx !== null) {
        setCurrentIndex(prevIdx);
        // PRD-19 (Block B): persist the back position like every forward move.
        saveProgress(answers, prevIdx, questionStatus);
      }
    };
    // PRD-19 (Block C): clickable progress-pills map (replaces the linear bar). The
    // builder gates `clickable` (frontier + strict mode); the jump mirrors goBack.
    const questionsProgress =
      buildQuestionProgress({
        questions: flatQuestions.map((fq) => ({ id: fq.question.id, topicId: fq.topicId })),
        statuses: questionStatus,
        currentIndex,
        commitScope: navSettings.answerCommitScope,
        // PRD-19 D5: a committed (finished) section's pills are locked (FR-06/FR-11).
        sectionCommitted,
        allowReturn: navSettings.allowReturnToUnanswered,
        scopeLabel:
          navSettings.answerCommitScope === "section"
            ? `Вопросы раздела «${currentQ.topicName}»`
            : "Вопросы теста",
      }) ?? undefined;
    const navigateToQuestion = (idx: number) => {
      if (idx < 0 || idx >= flatQuestions.length) return;
      if (lockedTopics.has(flatQuestions[idx].topicId)) return; // expired section
      if (sectionCommitted[flatQuestions[idx].topicId]) return; // frozen section (FR-06)
      setStandardFeedbackShown(false);
      setStandardAnswerResult(null);
      setCurrentIndex(idx);
      saveProgress(answers, idx, questionStatus);
    };
    // «Отправить ответ»/«Принять»/«Далее» is gated on a usable answer for every
    // question type (parity with the SCORM runtime). `submitModeCurrent` is true
    // while the button still fixes the answer (not yet committed / no feedback).
    const submitModeCurrent = !(standardFeedbackShown || committedCurrent);
    const answerReady = hasAnswer(currentQ.question, answers[currentQ.question.id]);
    // PRD-19 (Block B): the two-step footer (explicit «Отправить ответ»/«Принять»
    // fixation → «Далее»/«Завершить») is used for BOTH showCorrectAnswers AND any
    // flexible test (allowReturnToUnanswered), mirroring the SCORM «Отправить
    // ответ»+«Пропуск» nav. Strict non-feedback tests keep the default footer.
    // The row itself comes from the SHARED emitter (`renderQuestionNav`) and is
    // printed INSIDE the scene, the same markup in the same place as the package's.
    // This only resolves the run state it is built from.
    const questionNav: QuestionNavState = {
      flexible: navSettings.allowReturnToUnanswered,
      // PRD-43: independent of `flexible`.
      quickAdvance: navSettings.quickAdvance,
      committed: standardFeedbackShown || committedCurrent,
      canPrev: prevIdx !== null,
      answerReady: !isSubmitting && (!submitModeCurrent || answerReady),
      hasNext: !isLastQuestion,
      showAccept: showCorrectAnswers && submitModeCurrent,
      showReview: hasSkipped,
    };
    /** Wires the shared row's actions to this screen's handlers. */
    const onNavAction = (action: string) => {
      if (action === QUESTION_NAV_ACTIONS.back) return goBack();
      if (action === QUESTION_NAV_ACTIONS.skip) return handleSkip();
      if (action === QUESTION_NAV_ACTIONS.review) {
        setReviewFromButton(true);
        setShowReview(true);
        return;
      }
      if (action === QUESTION_NAV_ACTIONS.submit) return handleStandardConfirm();
      if (action === QUESTION_NAV_ACTIONS.finish) return void handleSubmit();
      // «Далее»: already committed (fixed earlier, or the learner navigated back to
      // an answered question) → just walk on (handleStandardContinue). Not yet
      // committed (PRD-43 quickAdvance) → fix AND walk on in the same click
      // (handleNext) — mirrors the SCORM runtime's next(), which does both
      // unconditionally every time.
      //
      // These two are NOT interchangeable: handleNext does not reset
      // standardFeedbackShown/standardAnswerResult (it never runs while feedback
      // is showing, since committedCurrent is guaranteed true whenever feedback is
      // on screen). Routing an already-committed/feedback-shown question through
      // handleNext instead of handleStandardContinue would leak the previous
      // question's feedback banner onto the next question.
      if (action === QUESTION_NAV_ACTIONS.next) {
        return committedCurrent ? handleStandardContinue() : handleNext();
      }
    };
    return (
      <TemplateQuestionScreen
        tpl={questionTpl}
        protection={questionProtection}
        testTitle={attempt.testTitle}
        // Bare counter + the section as its own context field: the layout prints the
        // section as a tag, exactly as it does in the package (PRD-12 parity). The
        // section clock stays appended here until the header timers are wired on the
        // web host — the package shows it in an `ou-timer` instead.
        counterLabel={`Вопрос ${currentIndex + 1} из ${flatQuestions.length}`}
        // Countdowns render as the header's DS timers (shared painter), the same
        // place and markup the package uses — not as text glued to the counter.
        timers={{ testSeconds: remainingSeconds, sectionSeconds: sectionRemainingSeconds }}
        sectionName={currentQ.topicName}
        progressPercent={((currentIndex + 1) / flatQuestions.length) * 100}
        question={currentQ.question}
        answer={answers[currentQ.question.id]}
        shuffleMapping={shuffleMappings[currentQ.question.id]}
        onAnswer={(a) => handleAnswer(currentQ.question.id, a)}
        locked={(showCorrectAnswers && standardFeedbackShown) || currentTopicLocked || prd19Locked}
        // PRD-26 FR-34: a measurement-only scale has no right answer, so it shows
        // neither the highlight nor the verdict banner even when the test is set to
        // «показывать правильность ответа». The answer still commits and locks.
        reviewMode={showCorrectAnswers && standardFeedbackShown && !isMeasurementOnly(currentQ.question)}
        correctAnswer={standardAnswerResult?.correctAnswer}
        feedbackHtml={
          showCorrectAnswers && standardFeedbackShown && standardAnswerResult && !isMeasurementOnly(currentQ.question)
            ? adaptiveFeedbackHtml(currentQ.question, standardAnswerResult)
            : undefined
        }
        nav={questionNav}
        onNavAction={onNavAction}
        questionsProgress={questionsProgress}
        onNavigateToQuestion={navigateToQuestion}
      />
    );
  }

  // No design template available (rare: the screen-template fetch failed). Per the
  // parity principle (PRD-12) BOTH hosts render learner screens from the shared
  // template, so we do not ship a second React question renderer — surface a reload
  // instead of a divergent in-app UI. The normal + review render is the templated
  // branch above (questionTpl present), matching the SCORM runtime.
  if (testMode === "standard" && attempt && flatQuestions.length > 0 && !questionTpl) {
    return <ServiceErrorScreen diagnosis={`question screen unavailable: no question template (test ${testId})`} />;
  }

  // Nothing above matched. Not a loading state (that is the branch at the top of the
  // render): the init has finished, so this is an unforeseen combination of phase and
  // data. Show the spinner briefly for the one-frame gaps that legitimately land
  // here, then surface the service error and report which state it was.
  return (
    <StuckPreparingScreen
      diagnosis={
        `render fell through: phase=${phase} mode=${testMode} attempt=${!!attempt} ` +
        `questions=${flatQuestions.length} startTpl=${!!startTpl} questionTpl=${!!questionTpl} (test ${testId})`
      }
    />
  );
}