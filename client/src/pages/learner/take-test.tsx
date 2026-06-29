import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { ChevronLeft, CheckCircle, XCircle, Trophy, RotateCcw } from "lucide-react";
import { Banner, Box, Button, Card, CardBody, CardHeader, Center, Cluster, ModalDialog, Stack, Tag, Text } from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { LoadingState } from "@/components/loading-state";
import { TemplateScreen } from "@/components/template-screen";
import { TemplateQuestionScreen } from "./template-question-screen";
import { buildStartState } from "@shared/template/start-state";
import { buildQuestionProgress } from "@shared/template/question-progress-context";
import { buildReviewContext } from "@shared/template/review-context";
import { buildSectionResultContext } from "@shared/template/result-context";
import {
  useSectionTimer,
  useAdaptiveSectionTimer,
  prevAccessibleIndex,
  nextAccessibleIndex,
  forceAdvanceTarget,
} from "./use-section-timer";
import { t } from "@/lib/i18n";
import type { Question, Attempt, Test } from "@shared/schema";

interface AttemptWithQuestions extends Attempt {
  questions: Question[];
  testTitle: string;
}

interface FlatQuestion {
  question: Question;
  topicName: string;
  /** Owning topic id — drives the per-topic section timer (PRD-4 v1.1 §3.2). */
  topicId: string;
  /** Per-topic time budget in minutes, or null when the topic has no limit. */
  sectionTimeLimitMinutes: number | null;
  index: number;
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
 * After-answer feedback HTML for the adaptive question's question-feedback slot:
 * status + (single/multiple) correct-answer text + the question's feedback.
 * Mirrors the SCORM adaptive feedback block (binary correctness, no partial).
 */
function adaptiveFeedbackHtml(question: any, result: any): string {
  const ok = !!result.isCorrect;
  const color = ok ? "#16a34a" : "#dc2626";
  const bg = ok ? "#dcfce7" : "#fee2e2";
  let html = `<div class="feedback-block" style="margin-top:16px;padding:12px;border-radius:8px;background:${bg};border:1px solid ${color};">`;
  html += `<div style="font-weight:600;color:${color};margin-bottom:4px;">${ok ? "Правильно!" : "Неправильно"}</div>`;
  const opts = (question.dataJson as any)?.options as unknown[] | undefined;
  if (!ok && result.correctAnswer && opts) {
    if (question.type === "single" && typeof result.correctAnswer.correctIndex === "number") {
      html += `<div style="font-size:14px;margin-bottom:2px;"><b>Правильный ответ:</b> ${escSlot(opts[result.correctAnswer.correctIndex])}</div>`;
    } else if (question.type === "multiple" && Array.isArray(result.correctAnswer.correctIndices)) {
      const txt = result.correctAnswer.correctIndices.map((i: number) => opts[i]).join(", ");
      html += `<div style="font-size:14px;margin-bottom:2px;"><b>Правильный ответ:</b> ${escSlot(txt)}</div>`;
    }
  }
  if (result.feedback) html += `<div style="color:#333;font-size:14px;">${escSlot(result.feedback)}</div>`;
  html += "</div>";
  return html;
}

export default function TakeTestPage() {
  const { testId } = useParams<{ testId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Common state
  const [isStarting, setIsStarting] = useState(true);
  const [testMode, setTestMode] = useState<"standard" | "adaptive" | null>(null);
  const [testInfo, setTestInfo] = useState<Test | null>(null);
  const [phase, setPhase] = useState<"loading" | "start" | "question" | "finished" | "blocked">("loading");
  const [testMetadata, setTestMetadata] = useState<{
    totalQuestions: number;
    completedAttempts: number;
    maxAttempts: number | null;
    timeLimitMinutes: number | null;
    startPageContent: string | null;
    passPercent: number | null;
    hasInProgress: boolean;
    resumeIndex: number | null;
    resumeTotal: number | null;
    lastCompletedAttemptId: string | null;
  } | null>(null);
  // PRD-12 web-host: start screen template assets (null -> legacy React markup).
  const [startTpl, setStartTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
    design?: { logoUrl?: string };
  } | null>(null);
  // PRD-12 / PRD-6: retake block-wall template + cooldown data (set on 403).
  const [blockedTpl, setBlockedTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
    design?: { logoUrl?: string };
  } | null>(null);
  const [blockData, setBlockData] = useState<{ cooldownPeriodDays?: number; availableDate?: string | null } | null>(null);
  // PRD-12 #3: question screen template assets (null -> legacy React markup).
  const [questionTpl, setQuestionTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
    design?: { logoUrl?: string };
  } | null>(null);
  // PRD-19 Block D: обзор (review) screen template + visibility flag.
  const [reviewTpl, setReviewTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
    design?: { logoUrl?: string };
  } | null>(null);
  const [showReview, setShowReview] = useState(false);
  // PRD-19 Block D (FR-09): finish-confirm modal payload (null = hidden).
  // `onConfirm` runs the staged action (section finish or whole-test submit).
  const [finishConfirm, setFinishConfirm] = useState<{ count: number; label: string; onConfirm: () => void } | null>(null);
  // PRD-19 D5 (FR-05a): section-results (итоги раздела) screen layout + payload.
  const [sectionResultsTpl, setSectionResultsTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    cssVars?: Record<string, string>;
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
    showSectionResults: boolean;
    answerCommitScope: "test" | "section";
  }>({
    allowReturnToUnanswered: false,
    allowAnswerChange: false,
    showSectionResults: true,
    answerCommitScope: "test",
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

  const createAdaptiveShuffleMapping = (question: any): any => {
    if (!question || question.shuffleAnswers === false) return null;
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
      return createShuffleMapping(data.items.length);
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

        // Считаем общее количество вопросов
        const totalQuestions = test.sections?.reduce((sum: number, s: any) => sum + s.drawCount, 0) || 0;

        // Получаем проходной балл из overallPassRule
        let passPercent: number | null = null;
        if (test.overallPassRuleJson) {
          const passRule = test.overallPassRuleJson as any;
          if (passRule.type === "percent") {
            passPercent = passRule.value;
          }
        }

        // Проверяем есть ли незавершённая попытка
        const hasInProgress = test.inProgressAttemptId !== null;

        setTestMetadata({
          totalQuestions,
          completedAttempts: test.completedAttempts || 0,
          maxAttempts: test.maxAttempts || null,
          timeLimitMinutes: test.timeLimitMinutes || null,
          startPageContent: test.startPageContent || null,
          passPercent,
          hasInProgress,
          resumeIndex: test.resumeIndex ?? null,
          resumeTotal: test.resumeTotal ?? null,
          lastCompletedAttemptId: test.lastCompletedAttemptId ?? null,
        });

        // PRD-12 web-host: fetch the start screen template (best-effort; null ->
        // legacy React markup).
        try {
          const tplRes = await fetch(`/api/tests/${testId}/screen-template/start`, { credentials: "include" });
          if (tplRes.ok) setStartTpl(await tplRes.json());
          const qRes = await fetch(`/api/tests/${testId}/screen-template/question`, { credentials: "include" });
          if (qRes.ok) setQuestionTpl(await qRes.json());
          // PRD-19 Block D: обзор (review) screen layout.
          const rvRes = await fetch(`/api/tests/${testId}/screen-template/review`, { credentials: "include" });
          if (rvRes.ok) setReviewTpl(await rvRes.json());
          // PRD-19 D5: section-results (итоги раздела) screen layout.
          const srRes = await fetch(`/api/tests/${testId}/screen-template/section-results`, { credentials: "include" });
          if (srRes.ok) setSectionResultsTpl(await srRes.json());
        } catch {
          /* fall back to React markup */
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
      } else {
        await startStandardAttempt();
      }
      setPhase("question");
    } catch (err) {
      const retake = (err as { retake?: { cooldownPeriodDays?: number; availableDate?: string | null } }).retake;
      if ((err as Error)?.message === "RETAKE_COOLDOWN") {
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
        showSectionResults: data.attempt.showSectionResults ?? true,
        answerCommitScope: data.attempt.answerCommitScope ?? "test",
      });
      setQuestionStatus(data.questionStatus || {});

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
            } else if (question.shuffleAnswers !== false) {
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
                  mappings[question.id] = createShuffleMapping(itemCount);
                }
              }
            }
          }
        }
      }

      setFlatQuestions(questions);
      setShuffleMappings(mappings);
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

  // Standard attempt start
  const startStandardAttempt = async () => {
    const res = await fetch(`/api/tests/${testId}/attempts/start`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const error = await res.json();
      if (error.code === "ATTEMPTS_EXHAUSTED") {
        toast({
          variant: "destructive",
          title: "Попытки закончились",
          description: "Вы исчерпали все попытки для этого теста",
        });
        navigate("/learner");
        return;
      }
      if (error.code === "RETAKE_COOLDOWN") {
        const e = new Error("RETAKE_COOLDOWN") as Error & {
          retake?: { cooldownPeriodDays?: number; availableDate?: string | null };
        };
        e.retake = { cooldownPeriodDays: error.cooldownPeriodDays, availableDate: error.availableDate };
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
      showSectionResults: data.showSectionResults ?? true,
      answerCommitScope: data.answerCommitScope ?? "test",
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
          if (question.shuffleAnswers !== false) {
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
                mappings[question.id] = createShuffleMapping(itemCount);
              }
            }
          }
        }
      }
    }

    setFlatQuestions(questions);
    setShuffleMappings(mappings);

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
        toast({
          variant: "destructive",
          title: "Попытки закончились",
          description: "Вы исчерпали все попытки для этого теста",
        });
        navigate("/learner");
        return;
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
    fetch(`/api/attempts/${attempt.id}/save-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ answers: nextAnswers, currentIndex: nextIndex, questionStatus: nextStatus }),
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

  // Локальная проверка ответа для стандартного теста
  const checkAnswerLocally = (question: Question, answer: any): boolean => {
    const correct = question.correctJson as any;
    if (!correct) return false;

    if (question.type === "single") {
      return answer === correct.correctIndex;
    }

    if (question.type === "multiple") {
      const correctSet = new Set(correct.correctIndices || []);
      const answerSet = new Set(answer || []);
      if (correctSet.size !== answerSet.size) return false;
      for (const idx of correctSet) {
        if (!answerSet.has(idx)) return false;
      }
      return true;
    }

    if (question.type === "matching") {
      const pairs = correct.pairs || [];
      const userPairs = answer || {};
      for (const p of pairs) {
        if (userPairs[p.left] !== p.right) return false;
      }
      return true;
    }

    if (question.type === "ranking") {
      const correctOrder = correct.correctOrder || [];
      const userOrder = answer || [];
      if (correctOrder.length !== userOrder.length) return false;
      for (let i = 0; i < correctOrder.length; i++) {
        if (correctOrder[i] !== userOrder[i]) return false;
      }
      return true;
    }

    return false;
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

    const isCorrect = checkAnswerLocally(currentQ.question, currentAnswer);
    const correctAnswer = currentQ.question.correctJson;
    const feedback = currentQ.question.feedback;

    setStandardAnswerResult({
      isCorrect,
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
   * PRD-19 D5 (FR-05): advance after a commit/skip, but intercept a section
   * boundary (flexible sectional) or the test end (flexible flat) with the staged
   * обзор instead of crossing straight on. `nextIdx === null` = no further question
   * (test end). Strict mode keeps the plain advance (no обзор, FR-02/FR-08a).
   */
  const advanceOrStageFinish = (
    nextIdx: number | null,
    nextAnswers: Record<string, any>,
    nextStatus: Record<string, "unanswered" | "answered" | "skipped">,
  ) => {
    const curTopic = flatQuestions[currentIndex]?.topicId;
    if (sectionScope) {
      const crossing = !!curTopic && (nextIdx === null || flatQuestions[nextIdx].topicId !== curTopic);
      if (crossing && !sectionCommitted[curTopic!]) {
        if (navSettings.allowReturnToUnanswered) {
          setShowReview(true); // flexible → section обзор («Завершить раздел»)
          return;
        }
        // Strict (no return): show the computed section-results between sections
        // (FR-05a) — no обзор/modal; the last section flows to the test results.
        if (navSettings.showSectionResults && !isLastSectionWeb(curTopic!)) {
          void finishSectionWeb(curTopic!, false);
          return;
        }
      }
    } else if (navSettings.allowReturnToUnanswered && nextIdx === null) {
      setShowReview(true); // flat flexible → single end-of-test обзор
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
      <div className="tbh-minh-screen tbh-col" style={{ background: blockedTpl.theme?.background }}>
        <TemplateScreen
          className="tbh-fill"
          layout={blockedTpl.layout}
          css={blockCss}
          cssVars={blockedTpl.cssVars}
          context={{ retake: { cooldownPeriodDays: blockData.cooldownPeriodDays, availableDateHuman }, ...(blockedTpl.design ? { design: blockedTpl.design } : {}) }}
        />
        <div className="tbh-center-foot">
          <Button variant="secondary" leadingIcon={<ChevronLeft size={16} />} onClick={() => navigate("/learner")}>
            К списку тестов
          </Button>
        </div>
      </div>
    );
  }

  // Start page — render via the design template (standard mode) when available.
  // Context comes from the SHARED start-state builder (PRD-12 §10) — the same model
  // the SCORM host produces: resume-with-position, "Начать заново" and "Мой результат"
  // now appear on the web start too (parity), gated by the same flags.
  if (phase === "start" && testInfo && testMetadata && testMode === "standard" && startTpl) {
    const exhausted =
      testMetadata.maxAttempts !== null && testMetadata.completedAttempts >= testMetadata.maxAttempts;
    const startContext = buildStartState({
      info: {
        title: testInfo.title,
        description: testInfo.description || "",
        questionCount: testMetadata.totalQuestions,
        passPercent: testMetadata.passPercent,
        timeLimitMinutes: testMetadata.timeLimitMinutes,
        maxAttempts: testMetadata.maxAttempts,
        startPageContent: testMetadata.startPageContent || "",
      },
      maxAttempts: testMetadata.maxAttempts,
      completedAttempts: testMetadata.completedAttempts,
      resume:
        testMetadata.hasInProgress && !exhausted
          ? { index: testMetadata.resumeIndex ?? 0, total: testMetadata.resumeTotal ?? 0 }
          : null,
      hasCompletedResults: testMetadata.completedAttempts > 0,
      canStartNew: !exhausted,
      showBack: true,
    });
    return (
      <div
        className="tbh-minh-screen tbh-noselect"
        style={{ background: startTpl.theme?.background }}
        onCopy={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <TemplateScreen
          className="tbh-wfull"
          layout={startTpl.layout}
          css={startTpl.css}
          cssVars={startTpl.cssVars}
          context={{ ...startContext, ...(startTpl.design ? { design: startTpl.design } : {}) }}
          onAction={(action) => {
            if (action === "start-test" || action === "restart") handleStartTest();
            else if (action === "resume") handleResumeTest();
            else if (action === "view-results" && testMetadata.lastCompletedAttemptId)
              navigate(`/learner/result/${testMetadata.lastCompletedAttemptId}`);
            else if (action === "back") navigate("/learner");
          }}
        />
      </div>
    );
  }

  // Adaptive mode - finished
  if (testMode === "adaptive" && adaptiveState?.isFinished) {
    return (
      <Box maxW="3xl" padX={6} padY={8}>
        <Card>
          <CardBody>
            <Stack gap={6}>
              <Stack gap={2} align="center">
                <Trophy size={48} color="var(--ou-accent-default)" />
                <Text variant="display-s" weight="bold">Тест завершён!</Text>
                <Text tone="muted">{adaptiveState.testTitle}</Text>
              </Stack>

              {adaptiveState.result?.topicResults?.map((tr: any, idx: number) => (
                <Box key={idx} border radius="l" pad={4}>
                  <Stack gap={3}>
                    <Text variant="heading-s" weight="semibold">{tr.topicName}</Text>
                    <Cluster>
                      {tr.achievedLevelName ? (
                        <Tag tone="success" variant="solid">{tr.achievedLevelName}</Tag>
                      ) : (
                        <Tag tone="error" variant="solid">{tr.feedback || "Уровень не достигнут"}</Tag>
                      )}
                    </Cluster>
                    {tr.achievedLevelName && tr.feedback && (
                      <Text variant="body-s" tone="muted">{tr.feedback}</Text>
                    )}
                    {tr.recommendedLinks?.length > 0 && (
                      <Stack gap={1}>
                        <Text variant="body-s" weight="medium">Рекомендуемые материалы:</Text>
                        <Stack as="ul" gap={1}>
                          {tr.recommendedLinks.map((link: any, i: number) => (
                            <li key={i}>
                              <a href={link.url} target="_blank" rel="noopener noreferrer">
                                <Text variant="body-s" tone="accent">{link.title}</Text>
                              </a>
                            </li>
                          ))}
                        </Stack>
                      </Stack>
                    )}
                  </Stack>
                </Box>
              ))}

              <Button fullWidth onClick={() => navigate("/learner")}>
                Вернуться к списку тестов
              </Button>
            </Stack>
          </CardBody>
        </Card>
      </Box>
    );
  }

  // Adaptive mode - transition screen
  if (testMode === "adaptive" && showTransition && adaptiveState?.lastResult) {
    const { levelTransition, topicTransition, isCorrect } = adaptiveState.lastResult;

    return (
      <Center minH="screen" pad={4}>
        <Box full maxW="md">
          <Card>
            <CardBody>
              <Stack gap={4} align="center">
                {isCorrect ? (
                  <CheckCircle size={48} color="var(--ou-success-600)" />
                ) : (
                  <XCircle size={48} color="var(--ou-error-600)" />
                )}

                <Text variant="heading-s" weight="medium">
                  {isCorrect ? "Правильно!" : "Неправильно"}
                </Text>

                {levelTransition && (
                  <Banner
                    fullWidth
                    tone={levelTransition.type === "up" ? "success" : levelTransition.type === "down" ? "error" : "info"}
                  >
                    {levelTransition.message}
                  </Banner>
                )}

                {topicTransition && (
                  <Text variant="body-s" tone="muted">
                    Переход к теме: <Text as="span" variant="body-s" weight="medium">{topicTransition.toTopic}</Text>
                  </Text>
                )}
              </Stack>
            </CardBody>
          </Card>
        </Box>
      </Center>
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
      const btnCls =
        "ml-auto inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
      const footer = adaptiveState.showCorrectAnswers ? (
        feedbackShown ? (
          <button type="button" className={btnCls} style={{ background: "#2563eb" }} onClick={handleAdaptiveContinue}>
            Далее →
          </button>
        ) : (
          <button
            type="button"
            className={btnCls}
            style={{ background: "#2563eb" }}
            onClick={handleAdaptiveConfirm}
            disabled={isAnswering || adaptiveState.answer === null}
          >
            {isAnswering ? "Отправка..." : "Принять"}
          </button>
        )
      ) : (
        <button
          type="button"
          className={btnCls}
          style={{ background: "#2563eb" }}
          onClick={handleAdaptiveSubmit}
          disabled={isAnswering || adaptiveState.answer === null}
        >
          {isAnswering ? "Отправка..." : "Далее →"}
        </button>
      );
      return (
        <TemplateQuestionScreen
          tpl={questionTpl}
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
          footer={footer}
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
    const built = buildReviewContext({
      questions: flatQuestions.map((fq) => ({ id: fq.question.id, topicId: fq.topicId, prompt: fq.question.prompt })),
      statuses: questionStatus,
      commitScope: navSettings.answerCommitScope,
      scopeTopicId: sectionScope ? curTopic : null,
      isTest: !sectionScope,
      scopeLabel: sectionScope ? `Раздел «${curQ.topicName}» · обзор` : "Обзор теста",
      finishLabel,
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
      <div className="tbh-minh-screen tbh-col" style={{ background: reviewTpl.theme?.background }}>
        <TemplateScreen
          className="tbh-fill"
          layout={reviewTpl.layout}
          css={reviewTpl.css}
          cssVars={reviewTpl.cssVars}
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
              setShowReview(false);
            } else if (action === "finish-review") {
              // FR-09: confirm when finishing with unanswered questions.
              if (built.review.unansweredCount > 0) {
                setFinishConfirm({ count: built.review.unansweredCount, label: built.review.finishLabel, onConfirm: doFinish });
              } else {
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
    const built = buildSectionResultContext({
      topicName: sectionResultView.topicName,
      correct: sectionResultView.correct,
      total: sectionResultView.total,
      percent: sectionResultView.percent,
      passed: sectionResultView.passed,
      continueLabel: sectionResultView.isLast ? "Завершить тест" : "Продолжить",
    });
    const srTopic = sectionResultView.topicId;
    const srIsLast = sectionResultView.isLast;
    return (
      <div className="tbh-minh-screen tbh-col" style={{ background: sectionResultsTpl.theme?.background }}>
        <TemplateScreen
          className="tbh-fill"
          layout={sectionResultsTpl.layout}
          css={sectionResultsTpl.css}
          cssVars={sectionResultsTpl.cssVars}
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
    const sectionClock =
      sectionRemainingSeconds !== null
        ? ` · Время темы ${Math.floor(sectionRemainingSeconds / 60)}:${String(sectionRemainingSeconds % 60).padStart(2, "0")}`
        : "";
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
    // PRD-19 (Block B): the two-step footer (explicit «Отправить ответ»/«Принять»
    // fixation → «Далее»/«Завершить») is used for BOTH showCorrectAnswers AND any
    // flexible test (allowReturnToUnanswered), mirroring the SCORM «Отправить
    // ответ»+«Пропустить» nav. Strict non-feedback tests keep the default footer.
    const reviewFooter = (showCorrectAnswers || navSettings.allowReturnToUnanswered) ? (
      <>
        <button
          type="button"
          onClick={goBack}
          disabled={prevIdx === null}
          className="tbh-navbtn"
        >
          ← Назад
        </button>
        {canSkip && (
          <button type="button" onClick={handleSkip} className="tbh-navbtn">
            Пропустить
          </button>
        )}
        {hasSkipped && (
          <button type="button" onClick={() => setShowReview(true)} className="tbh-navbtn">
            Вернуться
          </button>
        )}
        <button
          type="button"
          onClick={
            !(standardFeedbackShown || committedCurrent)
              ? handleStandardConfirm
              : // PRD-19 D5 (FR-16): the question page has NO finish button in flexible
                // mode — «Далее» on the last question reaches the обзор (section/test
                // finish). Strict-feedback (showCorrectAnswers, no return) keeps the
                // direct «Завершить тест» submit.
                isLastQuestion && !navSettings.allowReturnToUnanswered
                ? handleSubmit
                : handleStandardContinue
          }
          disabled={isSubmitting}
          className="tbh-primarybtn"
          style={{ background: "#2563eb" }}
        >
          {!(standardFeedbackShown || committedCurrent)
            ? navSettings.allowReturnToUnanswered
              ? "Отправить ответ"
              : "Принять"
            : isLastQuestion && !navSettings.allowReturnToUnanswered
              ? isSubmitting
                ? "Отправка..."
                : "Завершить тест"
              : "Далее →"}
        </button>
      </>
    ) : undefined;
    return (
      <TemplateQuestionScreen
        tpl={questionTpl}
        testTitle={attempt.testTitle}
        counterLabel={`Вопрос ${currentIndex + 1} из ${flatQuestions.length} · Тема: ${currentQ.topicName}${sectionClock}`}
        progressPercent={((currentIndex + 1) / flatQuestions.length) * 100}
        question={currentQ.question}
        answer={answers[currentQ.question.id]}
        shuffleMapping={shuffleMappings[currentQ.question.id]}
        onAnswer={(a) => handleAnswer(currentQ.question.id, a)}
        locked={(showCorrectAnswers && standardFeedbackShown) || currentTopicLocked || prd19Locked}
        reviewMode={showCorrectAnswers && standardFeedbackShown}
        correctAnswer={standardAnswerResult?.correctAnswer}
        feedbackHtml={
          showCorrectAnswers && standardFeedbackShown && standardAnswerResult
            ? adaptiveFeedbackHtml(currentQ.question, standardAnswerResult)
            : undefined
        }
        footer={reviewFooter}
        questionsProgress={questionsProgress}
        onNavigateToQuestion={navigateToQuestion}
        canPrev={prevIdx !== null}
        onPrev={goBack}
        canSkip={canSkip}
        onSkip={handleSkip}
        isLast={isLastQuestion}
        isSubmitting={isSubmitting}
        onNext={handleNext}
        onSubmit={handleSubmit}
      />
    );
  }

  // No design template available (rare: the screen-template fetch failed). Per the
  // parity principle (PRD-12) BOTH hosts render learner screens from the shared
  // template, so we do not ship a second React question renderer — surface a reload
  // instead of a divergent in-app UI. The normal + review render is the templated
  // branch above (questionTpl present), matching the SCORM runtime.
  if (testMode === "standard" && attempt && flatQuestions.length > 0 && !questionTpl) {
    return (
      <Center minH="screen" pad={6}>
        <Box full maxW="md">
          <Card>
            <CardHeader title="Оформление недоступно" />
            <CardBody>
              <Stack gap={4}>
                <Text variant="body-s" tone="muted">
                  Не удалось загрузить оформление теста. Обновите страницу, чтобы продолжить прохождение.
                </Text>
                <Button fullWidth onClick={() => window.location.reload()}>Обновить</Button>
              </Stack>
            </CardBody>
          </Card>
        </Box>
      </Center>
    );
  }

  return <LoadingState message={t.common.preparingTest} />;
}