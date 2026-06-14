import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, ArrowUp, ArrowDown, Trophy, Target, GripVertical, Clock, BookOpen, RotateCcw, Play } from "lucide-react";
import { Banner, Box, Button, Card, CardBody, CardHeader, Center, Checkbox, Cluster, ProgressBar, Radio, Stack, Tag, Text } from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { LoadingState } from "@/components/loading-state";
import { TemplateScreen } from "@/components/template-screen";
import { TemplateQuestionScreen } from "./template-question-screen";
import { buildStartState } from "@shared/template/start-state";
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
  } | null>(null);
  // PRD-12 / PRD-6: retake block-wall template + cooldown data (set on 403).
  const [blockedTpl, setBlockedTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
  } | null>(null);
  const [blockData, setBlockData] = useState<{ cooldownPeriodDays?: number; availableDate?: string | null } | null>(null);
  // PRD-12 #3: question screen template assets (null -> legacy React markup).
  const [questionTpl, setQuestionTpl] = useState<{
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
  } | null>(null);

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
              body: JSON.stringify({ answers, timeExpired: true }),
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

  // Standard mode handlers
  const handleAnswer = (questionId: string, answer: any) => {
    setAnswers((prev) => {
      const newAnswers = { ...prev, [questionId]: answer };

      // Автосохранение прогресса
      if (attempt) {
        fetch(`/api/attempts/${attempt.id}/save-progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ answers: newAnswers, currentIndex }),
        }).catch(err => console.error("Auto-save error:", err));
      }

      return newAnswers;
    });
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
  };

  // Перейти к следующему вопросу после просмотра фидбека
  const handleStandardContinue = () => {
    setStandardFeedbackShown(false);
    setStandardAnswerResult(null);

    // Skip past any topic whose section timer has already expired.
    const nextIdx = nextAccessibleIndex(flatQuestions, currentIndex + 1, lockedTopics);
    if (nextIdx !== null) setCurrentIndex(nextIdx);
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

    // Skip past any topic whose section timer has already expired.
    const nextIdx = nextAccessibleIndex(flatQuestions, currentIndex + 1, lockedTopics);
    if (nextIdx !== null) setCurrentIndex(nextIdx);
  };

  const handleSubmit = async () => {
    if (!attempt) return;

    const unansweredQuestions = flatQuestions.filter(
      (fq) => answers[fq.question.id] === undefined || answers[fq.question.id] === null
    );

    if (unansweredQuestions.length > 0) {
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
        body: JSON.stringify({ answers }),
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
        body: JSON.stringify({ answers }),
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
      <div className="min-h-screen flex flex-col" style={{ background: blockedTpl.theme?.background }}>
        <TemplateScreen
          className="flex-1 w-full"
          layout={blockedTpl.layout}
          css={blockCss}
          context={{ retake: { cooldownPeriodDays: blockData.cooldownPeriodDays, availableDateHuman } }}
        />
        <div className="flex items-center justify-center pb-10">
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
        className="min-h-screen select-none"
        style={{ background: startTpl.theme?.background }}
        onCopy={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <TemplateScreen
          className="w-full"
          layout={startTpl.layout}
          css={startTpl.css}
          context={startContext}
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
          feedbackHtml={fbHtml}
          footer={footer}
        />
      );
    }

  }

  // Standard mode — question screen via the design template (PRD-12 #3): all question
  // types (single/multiple/ranking/matching). The per-question feedback mode
  // (showCorrectAnswers) still uses the React markup below.
  if (
    testMode === "standard" &&
    attempt &&
    flatQuestions.length > 0 &&
    questionTpl &&
    !showCorrectAnswers
  ) {
    const currentQ = flatQuestions[currentIndex];
    // PRD-4 v1.1 §3.2 — section-timer state for the templated standard screen.
    const currentTopicLocked = lockedTopics.has(currentQ.topicId);
    const prevIdx = prevAccessibleIndex(flatQuestions, currentIndex - 1, lockedTopics);
    const sectionClock =
      sectionRemainingSeconds !== null
        ? ` · Время темы ${Math.floor(sectionRemainingSeconds / 60)}:${String(sectionRemainingSeconds % 60).padStart(2, "0")}`
        : "";
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
        locked={currentTopicLocked}
        canPrev={prevIdx !== null}
        onPrev={() => {
          setStandardFeedbackShown(false);
          setStandardAnswerResult(null);
          // Skip back over any topic whose section timer already expired.
          if (prevIdx !== null) setCurrentIndex(prevIdx);
        }}
        isLast={currentIndex === flatQuestions.length - 1}
        isSubmitting={isSubmitting}
        onNext={handleNext}
        onSubmit={handleSubmit}
      />
    );
  }

  // Standard mode — per-question feedback (showCorrectAnswers) / no-template fallback.
  if (testMode === "standard" && attempt && flatQuestions.length > 0) {
    const currentQ = flatQuestions[currentIndex];
    const progress = ((currentIndex + 1) / flatQuestions.length) * 100;
    const isLastQuestion = currentIndex === flatQuestions.length - 1;
    // Section-timer state for this view (PRD-4 v1.1 §3.2).
    const currentTopicLocked = lockedTopics.has(currentQ.topicId);
    const prevIdx = prevAccessibleIndex(flatQuestions, currentIndex - 1, lockedTopics);

    return (
      <div className="min-h-screen select-none" onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}>
        <div className="fixed top-0 left-0 right-0 z-50">
          <ProgressBar value={progress} size="xs" hideHeader />
        </div>

        <Box maxW="3xl" padX={6} padY={8}>
          <Stack gap={8}>
            <Cluster justify="between" gap={4}>
              <Stack gap={1}>
                <Text variant="heading-s" weight="semibold">{attempt.testTitle}</Text>
                <Text variant="body-s" tone="muted">Вопрос {currentIndex + 1} из {flatQuestions.length}</Text>
              </Stack>
              <Cluster gap={4}>
                {remainingSeconds !== null && <TimerDisplay remainingSeconds={remainingSeconds} />}
                {sectionRemainingSeconds !== null && <SectionTimerDisplay remainingSeconds={sectionRemainingSeconds} />}
                <Text variant="body-s" tone="muted">
                  Тема: <Text as="span" variant="body-s" weight="medium">{currentQ.topicName}</Text>
                </Text>
              </Cluster>
            </Cluster>

            <Card>
              <CardBody>
                <Stack gap={4}>
                  <Text variant="heading-s" weight="medium">{currentQ.question.prompt}</Text>
                  {currentQ.question.mediaUrl && currentQ.question.mediaType && (
                    <div>
                      {currentQ.question.mediaType === "image" && (
                        <img src={currentQ.question.mediaUrl} alt="Изображение" className="max-h-64 object-contain mx-auto rounded-md" />
                      )}
                      {currentQ.question.mediaType === "audio" && (
                        <audio controls className="w-full"><source src={currentQ.question.mediaUrl} /></audio>
                      )}
                      {currentQ.question.mediaType === "video" && (
                        <video controls className="max-h-64 w-full rounded-md"><source src={currentQ.question.mediaUrl} /></video>
                      )}
                    </div>
                  )}

                  <QuestionInput
                    question={currentQ.question}
                    answer={answers[currentQ.question.id]}
                    onAnswer={standardFeedbackShown || currentTopicLocked ? () => { } : (answer) => handleAnswer(currentQ.question.id, answer)}
                    shuffleMapping={shuffleMappings[currentQ.question.id]}
                    disabled={standardFeedbackShown || currentTopicLocked}
                    showCorrectAnswer={standardFeedbackShown}
                    correctAnswer={standardAnswerResult?.correctAnswer}
                  />

                  {standardFeedbackShown && standardAnswerResult && (
                    <Banner
                      fullWidth
                      tone={standardAnswerResult.isCorrect ? "success" : "error"}
                      title={standardAnswerResult.isCorrect ? "Правильно!" : "Неправильно"}
                    >
                      {standardAnswerResult.feedback}
                    </Banner>
                  )}
                </Stack>
              </CardBody>
            </Card>

            <Cluster justify="between" gap={4}>
              <Button
                variant="secondary"
                leadingIcon={<ChevronLeft size={16} />}
                onClick={() => {
                  setStandardFeedbackShown(false);
                  setStandardAnswerResult(null);
                  if (prevIdx !== null) setCurrentIndex(prevIdx);
                }}
                disabled={prevIdx === null}
              >
                Назад
              </Button>

              {showCorrectAnswers ? (
                standardFeedbackShown ? (
                  isLastQuestion ? (
                    <Button onClick={handleSubmit} loading={isSubmitting} trailingIcon={<CheckCircle size={16} />}>
                      Завершить тест
                    </Button>
                  ) : (
                    <Button onClick={handleStandardContinue} trailingIcon={<ChevronRight size={16} />}>Далее</Button>
                  )
                ) : (
                  <Button onClick={handleStandardConfirm} trailingIcon={<ChevronRight size={16} />}>Принять</Button>
                )
              ) : (
                isLastQuestion ? (
                  <Button onClick={handleSubmit} loading={isSubmitting} trailingIcon={<CheckCircle size={16} />}>
                    Завершить тест
                  </Button>
                ) : (
                  <Button onClick={handleNext} trailingIcon={<ChevronRight size={16} />}>Далее</Button>
                )
              )}
            </Cluster>
          </Stack>
        </Box>
      </div>
    );
  }

  return <LoadingState message={t.common.preparingTest} />;
}

// ==================== Question Input Component ====================

interface QuestionInputProps {
  question: Question;
  answer: any;
  onAnswer: (answer: any) => void;
  shuffleMapping?: any;
  disabled?: boolean;
  showCorrectAnswer?: boolean;
  correctAnswer?: any;
}

const QUESTION_HINTS: Record<string, string> = {
  single: "Выберите только один правильный ответ.",
  multiple: "Выберите один или несколько правильных ответов.",
  ranking: "Расставьте элементы в правильной последовательности. Для этого зажмите нужный элемент и передвиньте.",
  matching: "Расставьте элементы в правильной последовательности. Для этого зажмите нужный элемент и передвиньте.",
};

function QuestionInput({ question, answer, onAnswer, shuffleMapping, disabled = false, showCorrectAnswer = false, correctAnswer }: QuestionInputProps) {
  const data = question.dataJson as any;
  const hint = QUESTION_HINTS[question.type];

  // Single choice
  if (question.type === "single") {
    const options = data.options || [];
    const displayOrder = shuffleMapping || options.map((_: any, i: number) => i);
    const correctIndex = correctAnswer?.correctIndex;

    return (
      <Stack gap={3}>
        {hint && <Text variant="body-s" tone="muted">{hint}</Text>}
        {displayOrder.map((originalIndex: number, displayIndex: number) => {
          const isSelected = answer === originalIndex;
          const isCorrect = showCorrectAnswer && correctIndex === originalIndex;
          const isWrong = showCorrectAnswer && isSelected && correctIndex !== originalIndex;

          let borderClass = "border-border hover:border-primary/50";
          let bgClass = "";

          if (showCorrectAnswer) {
            if (isCorrect) {
              borderClass = "border-green-500";
              bgClass = "bg-green-50 dark:bg-green-900/20";
            } else if (isWrong) {
              borderClass = "border-red-500";
              bgClass = "bg-red-50 dark:bg-red-900/20";
            }
          } else if (isSelected) {
            borderClass = "border-primary";
            bgClass = "bg-primary/5";
          }

          return (
            <div
              key={displayIndex}
              className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors ${disabled ? "cursor-default" : "cursor-pointer"
                } ${borderClass} ${bgClass}`}
              onClick={() => !disabled && onAnswer(originalIndex)}
            >
              <Radio checked={isSelected} disabled={disabled} readOnly tabIndex={-1} className="pointer-events-none" />
              <span className="flex-1">{options[originalIndex]}</span>
              {showCorrectAnswer && isCorrect && (
                <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
              )}
              {showCorrectAnswer && isWrong && (
                <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              )}
            </div>
          );
        })}
      </Stack>
    );
  }

  // Multiple choice
  if (question.type === "multiple") {
    const options = data.options || [];
    const displayOrder = shuffleMapping || options.map((_: any, i: number) => i);
    const selected: number[] = answer || [];
    const correctIndices: number[] = correctAnswer?.correctIndices || [];

    const toggle = (originalIdx: number) => {
      if (disabled) return;
      if (selected.includes(originalIdx)) {
        onAnswer(selected.filter((i) => i !== originalIdx));
      } else {
        onAnswer([...selected, originalIdx]);
      }
    };

    return (
      <Stack gap={3}>
        {hint && <Text variant="body-s" tone="muted">{hint}</Text>}
        {displayOrder.map((originalIndex: number, displayIndex: number) => {
          const isSelected = selected.includes(originalIndex);
          const isCorrect = showCorrectAnswer && correctIndices.includes(originalIndex);
          const isWrong = showCorrectAnswer && isSelected && !correctIndices.includes(originalIndex);
          const isMissed = showCorrectAnswer && !isSelected && correctIndices.includes(originalIndex);

          let borderClass = "border-border hover:border-primary/50";
          let bgClass = "";

          if (showCorrectAnswer) {
            if (isCorrect) {
              borderClass = "border-green-500";
              bgClass = "bg-green-50 dark:bg-green-900/20";
            } else if (isWrong) {
              borderClass = "border-red-500";
              bgClass = "bg-red-50 dark:bg-red-900/20";
            }
          } else if (isSelected) {
            borderClass = "border-primary";
            bgClass = "bg-primary/5";
          }

          return (
            <div
              key={displayIndex}
              className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors select-none ${disabled ? "cursor-default" : "cursor-pointer"
                } ${borderClass} ${bgClass}`}
              onClick={() => toggle(originalIndex)}
            >
              <Checkbox checked={isSelected} disabled={disabled} readOnly tabIndex={-1} className="pointer-events-none" />
              <span className="flex-1">
                {options[originalIndex]}
              </span>
              {showCorrectAnswer && isCorrect && isSelected && (
                <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
              )}
              {showCorrectAnswer && isMissed && (
                <CheckCircle className="h-5 w-5 text-green-500 shrink-0 opacity-50" />
              )}
              {showCorrectAnswer && isWrong && (
                <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              )}
            </div>
          );
        })}
      </Stack>
    );
  }

  // Matching with DnD
  if (question.type === "matching") {
    return (
      <>
        {hint && <p className="text-sm text-muted-foreground -mt-1 mb-1">{hint}</p>}
        <MatchingQuestion
          question={question}
          answer={answer}
          onAnswer={disabled ? () => { } : onAnswer}
          shuffleMapping={shuffleMapping}
          disabled={disabled}
          showCorrectAnswer={showCorrectAnswer}
          correctAnswer={correctAnswer}
        />
      </>
    );
  }

  // Ranking with DnD
  if (question.type === "ranking") {
    return (
      <>
        {hint && <p className="text-sm text-muted-foreground -mt-1 mb-1">{hint}</p>}
        <RankingQuestion
          question={question}
          answer={answer}
          onAnswer={disabled ? () => { } : onAnswer}
          shuffleMapping={shuffleMapping}
          disabled={disabled}
          showCorrectAnswer={showCorrectAnswer}
          correctAnswer={correctAnswer}
        />
      </>
    );
  }

  return <div>Неизвестный тип вопроса</div>;
}

// ==================== Matching Question with DnD (SCORM style) ====================

interface MatchingQuestionProps {
  question: Question;
  answer: any;
  onAnswer: (answer: any) => void;
  shuffleMapping?: any;
  disabled?: boolean;
  showCorrectAnswer?: boolean;
  correctAnswer?: any;
}

function MatchingQuestion({ question, answer, onAnswer, shuffleMapping, disabled = false, showCorrectAnswer = false, correctAnswer }: MatchingQuestionProps) {
  const data = question.dataJson as any;
  const leftItems = data.left || [];
  const rightItems = data.right || [];

  const leftMapping = shuffleMapping?.left || leftItems.map((_: any, i: number) => i);
  const rightMapping = shuffleMapping?.right || rightItems.map((_: any, i: number) => i);

  const pairs: Record<number, number> = answer || {};

  // Build correct pairs mapping for highlighting
  const correctPairs: Array<{ left: number, right: number }> = correctAnswer?.pairs || [];
  const correctLeftToRight: Record<number, number> = {};
  correctPairs.forEach(p => {
    correctLeftToRight[p.left] = p.right;
  });

  // Build rightToLeft mapping
  const rightToLeft: Record<number, number> = {};
  Object.keys(pairs).forEach(k => {
    const leftIdx = parseInt(k);
    const rightIdx = pairs[leftIdx];
    if (typeof rightIdx === 'number') {
      rightToLeft[rightIdx] = leftIdx;
    }
  });

  // Build pool - left items not yet matched, in leftMapping order
  const usedLeft = new Set(Object.keys(pairs).map(k => parseInt(k)));
  const pool = leftMapping.filter((idx: number) => !usedLeft.has(idx));

  const [draggedItem, setDraggedItem] = useState<{
    leftIdx: number;
    from: 'pool' | 'matched';
    fromRightIdx?: number;
    poolIndex?: number;
  } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const handleDragStart = (
    e: React.DragEvent,
    leftIdx: number,
    from: 'pool' | 'matched',
    fromRightIdx?: number,
    poolIndex?: number
  ) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    setDraggedItem({ leftIdx, from, fromRightIdx, poolIndex });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverTarget(null);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(targetId);
  };

  const handleDragLeave = () => {
    setDragOverTarget(null);
  };

  const handleDropOnRight = (e: React.DragEvent, targetRightIdx: number) => {
    e.preventDefault();
    if (!draggedItem) return;

    const newPairs = { ...pairs };

    // If target already has a match, it will be displaced
    const existingLeftIdx = rightToLeft[targetRightIdx];

    // Remove dragged item from its previous position
    if (draggedItem.from === 'matched' && draggedItem.fromRightIdx !== undefined) {
      delete newPairs[draggedItem.leftIdx];
    }

    // If there was something in target slot, remove it (it goes back to pool)
    if (existingLeftIdx !== undefined && existingLeftIdx !== draggedItem.leftIdx) {
      delete newPairs[existingLeftIdx];
    }

    // Add new match
    newPairs[draggedItem.leftIdx] = targetRightIdx;

    onAnswer(newPairs);
    setDraggedItem(null);
    setDragOverTarget(null);
  };

  const handleDropOnPool = (e: React.DragEvent, targetPoolSlot: number) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.from !== 'matched') return;

    // Remove from matched pairs - it will appear in pool automatically
    const newPairs = { ...pairs };
    delete newPairs[draggedItem.leftIdx];
    onAnswer(newPairs);

    setDraggedItem(null);
    setDragOverTarget(null);
  };

  const handleDoubleClick = (leftIdx: number) => {
    if (disabled) return;
    // Return to pool on double click
    const newPairs = { ...pairs };
    delete newPairs[leftIdx];
    onAnswer(newPairs);
  };

  // Track pool slot index
  let poolSlot = 0;

  return (
    <div className="space-y-3">
      {rightMapping.map((rightIdx: number, displayIdx: number) => {
        const matchedLeftIdx = rightToLeft[rightIdx];
        const isJoined = matchedLeftIdx !== undefined;
        const currentPoolSlot = poolSlot;
        const poolLeftIdx = !isJoined && poolSlot < pool.length ? pool[poolSlot] : null;

        if (!isJoined) {
          poolSlot++;
        }

        const leftTargetId = `left-${rightIdx}`;
        const rightTargetId = `right-${rightIdx}`;

        // When joined - render as single merged block
        if (isJoined) {
          // Check if this match is correct
          const isCorrectMatch = showCorrectAnswer && correctLeftToRight[matchedLeftIdx] === rightIdx;
          const isWrongMatch = showCorrectAnswer && correctLeftToRight[matchedLeftIdx] !== rightIdx;

          let borderClass = "border-border";
          let chipBgClass = "bg-primary text-primary-foreground";

          if (showCorrectAnswer) {
            if (isCorrectMatch) {
              borderClass = "border-green-500";
              chipBgClass = "bg-green-500 text-white";
            } else if (isWrongMatch) {
              borderClass = "border-red-500";
              chipBgClass = "bg-red-500 text-white";
            }
          }

          return (
            <div
              key={displayIdx}
              className="flex items-stretch"
            >
              {/* MERGED BLOCK - Left chip + Right text */}
              <div
                className={`flex-1 min-h-[56px] rounded-lg border ${borderClass} bg-card flex items-stretch overflow-hidden`}
                onDragOver={(e) => handleDragOver(e, rightTargetId)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDropOnRight(e, rightIdx)}
              >
                {/* Left part - draggable chip */}
                <div
                  draggable={!disabled}
                  onDragStart={(e) => handleDragStart(e, matchedLeftIdx, 'matched', rightIdx)}
                  onDragEnd={handleDragEnd}
                  onDoubleClick={() => handleDoubleClick(matchedLeftIdx)}
                  className={`min-w-[120px] px-4 py-3 ${chipBgClass} flex items-center justify-center gap-2 cursor-grab active:cursor-grabbing select-none font-medium`}
                  title="Дважды щёлкните, чтобы вернуть"
                >
                  {leftItems[matchedLeftIdx]}
                  {showCorrectAnswer && isCorrectMatch && <CheckCircle className="h-4 w-4" />}
                  {showCorrectAnswer && isWrongMatch && <XCircle className="h-4 w-4" />}
                </div>
                {/* Right part - text */}
                <div className="flex-1 px-4 py-3 flex items-center">
                  <span className="text-sm">
                    {rightItems[rightIdx]}
                  </span>
                </div>
              </div>
            </div>
          );
        }

        // Not joined - separate blocks
        return (
          <div
            key={displayIdx}
            className="flex items-stretch gap-3"
          >
            {/* LEFT SIDE - Slot with draggable chip */}
            <div
              className={`flex-1 min-h-[56px] rounded-lg border transition-all flex items-center px-3 ${dragOverTarget === leftTargetId
                ? 'border-primary border-2 bg-primary/5'
                : 'border-border bg-card'
                }`}
              onDragOver={(e) => handleDragOver(e, leftTargetId)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDropOnPool(e, currentPoolSlot)}
            >
              {poolLeftIdx !== null ? (
                // Pool item - chip style
                <div
                  draggable={!disabled}
                  onDragStart={(e) => handleDragStart(e, poolLeftIdx, 'pool', undefined, currentPoolSlot)}
                  onDragEnd={handleDragEnd}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md cursor-grab active:cursor-grabbing select-none font-medium hover:bg-primary/90 transition-colors"
                >
                  {leftItems[poolLeftIdx]}
                </div>
              ) : (
                // Empty slot placeholder
                <span className="text-muted-foreground text-sm">Перетащите вариант</span>
              )}
            </div>

            {/* ARROW */}
            <div className="w-8 flex items-center justify-center text-muted-foreground">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </div>

            {/* RIGHT SIDE - Drop target with text */}
            <div
              className={`flex-1 min-h-[56px] rounded-lg border transition-all flex items-center px-4 ${dragOverTarget === rightTargetId
                ? 'border-primary border-2 bg-primary/5'
                : 'border-border bg-muted/30'
                }`}
              onDragOver={(e) => handleDragOver(e, rightTargetId)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDropOnRight(e, rightIdx)}
            >
              <span className="text-sm">
                {rightItems[rightIdx]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==================== Ranking Question with DnD ====================

interface RankingQuestionProps {
  question: Question;
  answer: any;
  onAnswer: (answer: any) => void;
  shuffleMapping?: any;
  disabled?: boolean;
  showCorrectAnswer?: boolean;
  correctAnswer?: any;
}

function RankingQuestion({ question, answer, onAnswer, shuffleMapping, disabled = false, showCorrectAnswer = false, correctAnswer }: RankingQuestionProps) {
  const data = question.dataJson as any;
  const items = data.items || [];

  // Initialize order from answer or shuffle mapping
  const initialOrder = shuffleMapping || items.map((_: any, i: number) => i);
  const order: number[] = answer || initialOrder;

  // Correct order for highlighting
  const correctOrder: number[] = correctAnswer?.correctOrder || [];

  // Set initial answer if not set
  useEffect(() => {
    if (answer === undefined || answer === null) {
      onAnswer(initialOrder);
    }
  }, []);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const newOrder = [...order];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedItem);

    onAnswer(newOrder);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (disabled) return;
    if (toIndex < 0 || toIndex >= order.length) return;

    const newOrder = [...order];
    const [item] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, item);
    onAnswer(newOrder);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Расположите элементы в правильном порядке (перетаскивайте или используйте стрелки)
      </p>

      {order.map((itemIdx, position) => {
        // Check if item is in correct position
        const isCorrectPosition = showCorrectAnswer && correctOrder[position] === itemIdx;
        const isWrongPosition = showCorrectAnswer && correctOrder.length > 0 && correctOrder[position] !== itemIdx;

        let borderClass = "border-border hover:border-primary/50";
        let bgClass = "bg-card";

        if (showCorrectAnswer) {
          if (isCorrectPosition) {
            borderClass = "border-green-500";
            bgClass = "bg-green-50 dark:bg-green-900/20";
          } else if (isWrongPosition) {
            borderClass = "border-red-500";
            bgClass = "bg-red-50 dark:bg-red-900/20";
          }
        } else if (draggedIndex === position) {
          borderClass = "opacity-50 border-primary";
        } else if (dragOverIndex === position) {
          borderClass = "border-primary";
          bgClass = "bg-primary/5";
        }

        return (
          <div
            key={`${itemIdx}-${position}`}
            draggable={!disabled}
            onDragStart={(e) => handleDragStart(e, position)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, position)}
            onDrop={(e) => handleDrop(e, position)}
            className={`flex items-center gap-3 p-4 rounded-lg border transition-all ${disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
              } ${borderClass} ${bgClass}`}
          >
            {/* Drag handle */}
            <GripVertical className="h-5 w-5 text-muted-foreground shrink-0" />

            {/* Position number */}
            <span className="text-sm font-bold w-6 text-muted-foreground">{position + 1}.</span>

            {/* Item text */}
            <span className="flex-1">{items[itemIdx]}</span>

            {/* Correct/Wrong indicator */}
            {showCorrectAnswer && isCorrectPosition && (
              <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
            )}
            {showCorrectAnswer && isWrongPosition && (
              <XCircle className="h-5 w-5 text-red-500 shrink-0" />
            )}

            {/* Arrow buttons */}
            {!showCorrectAnswer && (
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => moveItem(position, position - 1)}
                  disabled={disabled || position === 0}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move up"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(position, position + 1)}
                  disabled={disabled || position === order.length - 1}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ==================== Timer Display Component ====================

function TimerDisplay({ remainingSeconds }: { remainingSeconds: number }) {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const isLowTime = remainingSeconds <= 60;

  return (
    <div className={`font-mono text-lg ${isLowTime ? "text-red-500 font-bold animate-pulse" : "text-muted-foreground"}`}>
      {minutes}:{seconds < 10 ? "0" : ""}{seconds}
    </div>
  );
}

/**
 * Per-topic (section) countdown shown next to the test-wide timer (PRD-4 v1.1
 * §3.2). Mirrors {@link TimerDisplay} with a «Тема» label so the learner can
 * tell the two budgets apart.
 */
function SectionTimerDisplay({ remainingSeconds }: { remainingSeconds: number }) {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const isLowTime = remainingSeconds <= 60;

  return (
    <div
      className={`flex items-center gap-1 font-mono text-lg ${isLowTime ? "text-red-500 font-bold animate-pulse" : "text-muted-foreground"}`}
      title="Время на текущую тему"
      data-testid="section-timer-display"
    >
      <BookOpen className="h-4 w-4" aria-hidden="true" />
      {minutes}:{seconds < 10 ? "0" : ""}{seconds}
    </div>
  );
}