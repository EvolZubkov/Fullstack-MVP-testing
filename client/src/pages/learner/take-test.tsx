import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, ArrowUp, ArrowDown, Trophy, Target, GripVertical, Clock, BookOpen, RotateCcw, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { LoadingState } from "@/components/loading-state";
import { t } from "@/lib/i18n";
import type { Question, Attempt, Test } from "@shared/schema";

interface AttemptWithQuestions extends Attempt {
  questions: Question[];
  testTitle: string;
}

interface FlatQuestion {
  question: Question;
  topicName: string;
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

export default function TakeTestPage() {
  const { testId } = useParams<{ testId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Common state
  const [isStarting, setIsStarting] = useState(true);
  const [testMode, setTestMode] = useState<"standard" | "adaptive" | null>(null);
  const [testInfo, setTestInfo] = useState<Test | null>(null);
  const [phase, setPhase] = useState<"loading" | "start" | "question" | "finished">("loading");
  const [testMetadata, setTestMetadata] = useState<{
    totalQuestions: number;
    completedAttempts: number;
    maxAttempts: number | null;
    timeLimitMinutes: number | null;
    startPageContent: string | null;
    passPercent: number | null;
    hasInProgress: boolean;
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
  const [shuffleMappings, setShuffleMappings] = useState<Record<string, any>>({});

  // Adaptive mode state
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveState | null>(null);
  const [isAnswering, setIsAnswering] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [feedbackShown, setFeedbackShown] = useState(false);
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
        });

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
    
    if (currentIndex < flatQuestions.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
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

    setCurrentIndex((i) => Math.min(flatQuestions.length - 1, i + 1));
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

  // Adaptive mode handlers
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

      if (!res.ok) throw new Error("Failed to submit answer");
      const data = await res.json();

      // Show transition if level changed AND showDifficultyLevel is enabled
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
  if (phase === "loading" || (isStarting && phase !== "start")) {
    return <LoadingState message={t.common.preparingTest} />;
  }

  // Start page
  if (phase === "start" && testInfo && testMetadata) {
    const attemptsExhausted = testMetadata.maxAttempts !== null && 
      testMetadata.completedAttempts >= testMetadata.maxAttempts;
    const attemptsLeft = testMetadata.maxAttempts !== null 
      ? testMetadata.maxAttempts - testMetadata.completedAttempts 
      : null;

    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-6 py-12">
          {/* Header Card */}
          <Card className="text-center mb-6">
            <CardHeader>
              <CardTitle className="text-2xl">{testInfo.title}</CardTitle>
              {testInfo.description && (
                <p className="text-muted-foreground mt-2">{testInfo.description}</p>
              )}
            </CardHeader>
          </Card>

          {/* Info Card */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Информация о тесте</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Количество вопросов / тем */}
              <div className="flex items-center gap-3 p-4 rounded-lg bg-muted">
                <BookOpen className="h-6 w-6 text-indigo-500 shrink-0" />
                <div>
                  {testMode === "adaptive" ? (
                    <>
                      <div className="font-semibold">Количество тем</div>
                      <div className="text-sm text-muted-foreground">{(testInfo as any).sections?.length || 0}</div>
                    </>
                  ) : (
                    <>
                      <div className="font-semibold">Количество вопросов</div>
                      <div className="text-sm text-muted-foreground">{testMetadata.totalQuestions}</div>
                    </>
                  )}
                </div>
              </div>

              {/* Проходной балл */}
              {testMetadata.passPercent !== null && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted">
                  <Target className="h-6 w-6 text-green-500 shrink-0" />
                  <div>
                    <div className="font-semibold">Проходной балл</div>
                    <div className="text-sm text-muted-foreground">{testMetadata.passPercent}%</div>
                  </div>
                </div>
              )}

              {/* Ограничение времени */}
              {testMetadata.timeLimitMinutes && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted">
                  <Clock className="h-6 w-6 text-amber-500 shrink-0" />
                  <div>
                    <div className="font-semibold">Ограничение времени</div>
                    <div className="text-sm text-muted-foreground">{testMetadata.timeLimitMinutes} минут</div>
                  </div>
                </div>
              )}

              {/* Попытки */}
              {testMetadata.maxAttempts !== null && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted">
                  <RotateCcw className="h-6 w-6 text-violet-500 shrink-0" />
                  <div>
                    <div className="font-semibold">Попытки</div>
                    <div className={`text-sm ${attemptsExhausted ? "text-red-500" : "text-muted-foreground"}`}>
                      {attemptsExhausted 
                        ? "Попытки закончились" 
                        : `осталось ${attemptsLeft} из ${testMetadata.maxAttempts}`
                      }
                    </div>
                  </div>
                </div>
              )}

              {/* Custom content */}
              {testMetadata.startPageContent && (
                <div className="p-4 rounded-lg bg-muted border-l-4 border-primary">
                  <div className="text-sm whitespace-pre-wrap">{testMetadata.startPageContent}</div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Buttons */}
          <div className="flex flex-col items-center gap-3">
            {attemptsExhausted ? (
              <>
                <Button disabled className="w-full max-w-xs">
                  Попытки закончились
                </Button>
                <Button variant="outline" onClick={() => navigate("/learner")} className="w-full max-w-xs">
                  К списку тестов
                </Button>
              </>
            ) : testMetadata.hasInProgress ? (
              <>
                <Button 
                  onClick={handleResumeTest} 
                  disabled={isStarting}
                  className="w-full max-w-xs"
                  size="lg"
                >
                  {isStarting ? "Загрузка..." : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Продолжить тест
                    </>
                  )}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleStartTest} 
                  disabled={isStarting}
                  className="w-full max-w-xs"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Начать заново
                </Button>
                <Button variant="ghost" onClick={() => navigate("/learner")} className="w-full max-w-xs">
                  Назад
                </Button>
              </>
            ) : (
              <>
                <Button 
                  onClick={handleStartTest} 
                  disabled={isStarting}
                  className="w-full max-w-xs"
                  size="lg"
                >
                  {isStarting ? (
                    "Загрузка..."
                  ) : testMetadata.completedAttempts > 0 ? (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Начать заново
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Начать тестирование
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => navigate("/learner")} className="w-full max-w-xs">
                  Назад
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Adaptive mode - finished
  if (testMode === "adaptive" && adaptiveState?.isFinished) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <Card>
            <CardHeader className="text-center">
              <Trophy className="h-16 w-16 mx-auto text-primary mb-4" />
              <CardTitle className="text-2xl">Тест завершён!</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {adaptiveState.result?.topicResults?.map((tr: any, idx: number) => (
                <div key={idx} className="p-4 rounded-lg border">
                  <h3 className="font-semibold text-lg">{tr.topicName}</h3>
                  <div className="mt-2 space-y-2">
                    {tr.achievedLevelName ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="default" className="bg-green-600">
                          {tr.achievedLevelName}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          ({Math.round(tr.levelPercent)}% правильных)
                        </span>
                      </div>
                    ) : (
                      <Badge variant="destructive">Уровень не достигнут</Badge>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Вопросов: {tr.totalQuestionsAnswered}, правильных: {tr.totalCorrect}
                    </p>
                    {tr.feedback && (
                      <p className="text-sm mt-2 p-2 bg-muted rounded">{tr.feedback}</p>
                    )}
                    {tr.recommendedLinks?.length > 0 && (
                      <div className="mt-2">
                        <p className="text-sm font-medium">Рекомендуемые материалы:</p>
                        <ul className="list-disc list-inside text-sm">
                          {tr.recommendedLinks.map((link: any, i: number) => (
                            <li key={i}>
                              <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                {link.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <Button className="w-full" onClick={() => navigate("/learner")}>
                Вернуться к списку тестов
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Adaptive mode - transition screen
  if (testMode === "adaptive" && showTransition && adaptiveState?.lastResult) {
    const { levelTransition, topicTransition, isCorrect } = adaptiveState.lastResult;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-6 text-center space-y-4">
            {isCorrect ? (
              <CheckCircle className="h-16 w-16 mx-auto text-green-500" />
            ) : (
              <XCircle className="h-16 w-16 mx-auto text-red-500" />
            )}

            <p className="text-lg font-medium">
              {isCorrect ? "Правильно!" : "Неправильно"}
            </p>

            {levelTransition && (
              <Alert className={levelTransition.type === "up" ? "border-green-500" : levelTransition.type === "down" ? "border-red-500" : "border-primary"}>
                <div className="flex items-center gap-2">
                  {levelTransition.type === "up" && <ArrowUp className="h-5 w-5 text-green-500" />}
                  {levelTransition.type === "down" && <ArrowDown className="h-5 w-5 text-red-500" />}
                  {levelTransition.type === "complete" && <Target className="h-5 w-5 text-primary" />}
                  <AlertDescription>{levelTransition.message}</AlertDescription>
                </div>
              </Alert>
            )}

            {topicTransition && (
              <p className="text-sm text-muted-foreground">
                Переход к теме: <span className="font-medium">{topicTransition.toTopic}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Adaptive mode - question
  if (testMode === "adaptive" && adaptiveState?.currentQuestion) {
    const { currentQuestion, showDifficultyLevel, testTitle, questionsAnswered } = adaptiveState;
    const currentQ = currentQuestion.question;

    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-12">
         <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-semibold">{testTitle}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Вопрос {currentQuestion.questionNumber} из {currentQuestion.totalInLevel}
                {showDifficultyLevel && (
                  <span className="ml-2">• Уровень: <Badge variant="outline">{currentQuestion.levelName}</Badge></span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-4">
              {remainingSeconds !== null && (
                <TimerDisplay remainingSeconds={remainingSeconds} />
              )}
              <div className="text-sm text-muted-foreground">
                Тема: <span className="font-medium text-foreground">{currentQuestion.topicName}</span>
              </div>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium">
                {currentQ.prompt}
              </CardTitle>
              {currentQ.mediaUrl && currentQ.mediaType && (
                <div className="mt-4">
                  {currentQ.mediaType === "image" && (
                    <img
                      src={currentQ.mediaUrl}
                      alt="Изображение к вопросу"
                      className="max-h-64 object-contain mx-auto rounded-md"
                    />
                  )}
                  {currentQ.mediaType === "audio" && (
                    <audio controls className="w-full">
                      <source src={currentQ.mediaUrl} />
                    </audio>
                  )}
                  {currentQ.mediaType === "video" && (
                    <video controls className="max-h-64 w-full rounded-md">
                      <source src={currentQ.mediaUrl} />
                    </video>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <QuestionInput
                question={currentQ}
                answer={adaptiveState.answer}
                onAnswer={feedbackShown ? () => { } : handleAdaptiveAnswer}
                shuffleMapping={null}
                disabled={feedbackShown}
                showCorrectAnswer={feedbackShown}
                correctAnswer={lastAnswerResult?.correctAnswer}
              />

              {/* Фидбек после ответа */}
              {feedbackShown && lastAnswerResult && (
                <div className={`p-4 rounded-lg border ${lastAnswerResult.isCorrect
                    ? "bg-green-50 dark:bg-green-900/20 border-green-500"
                    : "bg-red-50 dark:bg-red-900/20 border-red-500"
                  }`}>
                  <div className={`font-semibold mb-2 ${lastAnswerResult.isCorrect ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                    }`}>
                    {lastAnswerResult.isCorrect ? "Правильно!" : "Неправильно"}
                  </div>

                  {/* Показываем правильный ответ для single/multiple */}
                  {!lastAnswerResult.isCorrect && lastAnswerResult.correctAnswer !== undefined && (
                    <div className="text-sm mb-2">
                      <span className="font-medium">Правильный ответ: </span>
                      {currentQ.type === "single" && (currentQ.dataJson as any)?.options && (
                        <span>{(currentQ.dataJson as any).options[lastAnswerResult.correctAnswer.correctIndex]}</span>
                      )}
                      {currentQ.type === "multiple" && (currentQ.dataJson as any)?.options && Array.isArray(lastAnswerResult.correctAnswer.correctIndices) && (
                        <span>{lastAnswerResult.correctAnswer.correctIndices.map((idx: number) => (currentQ.dataJson as any)?.options?.[idx]).join(", ")}</span>
                      )}
                    </div>
                  )}

                  {/* Фидбек к вопросу */}
                  {lastAnswerResult.feedback && (
                    <div className="text-sm text-muted-foreground">
                      {lastAnswerResult.feedback}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end mt-8">
            {adaptiveState.showCorrectAnswers ? (
              feedbackShown ? (
                <Button onClick={handleAdaptiveContinue}>
                  Далее
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button
                  onClick={handleAdaptiveConfirm}
                  disabled={isAnswering || adaptiveState.answer === null}
                >
                  {isAnswering ? "Отправка..." : "Принять"}
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              )
            ) : (
              <Button
                onClick={handleAdaptiveSubmit}
                disabled={isAnswering || adaptiveState.answer === null}
              >
                {isAnswering ? "Отправка..." : "Далее"}
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Standard mode
  if (testMode === "standard" && attempt && flatQuestions.length > 0) {
    const currentQ = flatQuestions[currentIndex];
    const progress = ((currentIndex + 1) / flatQuestions.length) * 100;
    const isLastQuestion = currentIndex === flatQuestions.length - 1;

    return (
      <div className="min-h-screen bg-background">
        <div className="fixed top-0 left-0 right-0 h-2 bg-muted z-50">
          <Progress value={progress} className="h-2" />
        </div>

        <div className="max-w-3xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-semibold">{attempt.testTitle}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Вопрос {currentIndex + 1} из {flatQuestions.length}
              </p>
            </div>
            <div className="flex items-center gap-4">
              {remainingSeconds !== null && (
                <TimerDisplay remainingSeconds={remainingSeconds} />
              )}
              <div className="text-sm text-muted-foreground">
                Тема: <span className="font-medium text-foreground">{currentQ.topicName}</span>
              </div>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium">{currentQ.question.prompt}</CardTitle>
              {currentQ.question.mediaUrl && currentQ.question.mediaType && (
                <div className="mt-4">
                  {currentQ.question.mediaType === "image" && (
                    <img
                      src={currentQ.question.mediaUrl}
                      alt="Изображение"
                      className="max-h-64 object-contain mx-auto rounded-md"
                    />
                  )}
                  {currentQ.question.mediaType === "audio" && (
                    <audio controls className="w-full">
                      <source src={currentQ.question.mediaUrl} />
                    </audio>
                  )}
                  {currentQ.question.mediaType === "video" && (
                    <video controls className="max-h-64 w-full rounded-md">
                      <source src={currentQ.question.mediaUrl} />
                    </video>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <QuestionInput
                question={currentQ.question}
                answer={answers[currentQ.question.id]}
                onAnswer={standardFeedbackShown ? () => {} : (answer) => handleAnswer(currentQ.question.id, answer)}
                shuffleMapping={shuffleMappings[currentQ.question.id]}
                disabled={standardFeedbackShown}
                showCorrectAnswer={standardFeedbackShown}
                correctAnswer={standardAnswerResult?.correctAnswer}
              />

              {/* Фидбек после ответа */}
              {standardFeedbackShown && standardAnswerResult && (
                <div className={`p-4 rounded-lg border ${
                  standardAnswerResult.isCorrect
                    ? "bg-green-50 dark:bg-green-900/20 border-green-500"
                    : "bg-red-50 dark:bg-red-900/20 border-red-500"
                }`}>
                  <div className={`font-semibold mb-2 ${
                    standardAnswerResult.isCorrect 
                      ? "text-green-600 dark:text-green-400" 
                      : "text-red-600 dark:text-red-400"
                  }`}>
                    {standardAnswerResult.isCorrect ? "Правильно!" : "Неправильно"}
                  </div>

                  {/* Фидбек к вопросу */}
                  {standardAnswerResult.feedback && (
                    <div className="text-sm text-muted-foreground">
                      {standardAnswerResult.feedback}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between mt-8">
            <Button
              variant="outline"
              onClick={() => {
                setStandardFeedbackShown(false);
                setStandardAnswerResult(null);
                setCurrentIndex((i) => Math.max(0, i - 1));
              }}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Назад
            </Button>

            {showCorrectAnswers ? (
              standardFeedbackShown ? (
                isLastQuestion ? (
                  <Button onClick={handleSubmit} disabled={isSubmitting}>
                    {isSubmitting ? "Отправка..." : "Завершить тест"}
                    <CheckCircle className="h-4 w-4 ml-2" />
                  </Button>
                ) : (
                  <Button onClick={handleStandardContinue}>
                    Далее
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                )
              ) : (
                <Button onClick={handleStandardConfirm}>
                  Принять
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              )
            ) : (
              isLastQuestion ? (
                <Button onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? "Отправка..." : "Завершить тест"}
                  <CheckCircle className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button onClick={handleNext}>
                  Далее
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              )
            )}
          </div>
        </div>
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

function QuestionInput({ question, answer, onAnswer, shuffleMapping, disabled = false, showCorrectAnswer = false, correctAnswer }: QuestionInputProps) {
  const data = question.dataJson as any;

  // Single choice
  if (question.type === "single") {
    const options = data.options || [];
    const displayOrder = shuffleMapping || options.map((_: any, i: number) => i);
    const correctIndex = correctAnswer?.correctIndex;

    return (
      <RadioGroup
        value={answer !== undefined && answer !== null ? String(answer) : ""}
        onValueChange={(val) => !disabled && onAnswer(Number(val))}
        className="space-y-3"
        disabled={disabled}
      >
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
              className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors ${
                disabled ? "cursor-default" : "cursor-pointer"
              } ${borderClass} ${bgClass}`}
              onClick={() => !disabled && onAnswer(originalIndex)}
            >
              <RadioGroupItem value={String(originalIndex)} id={`opt-${question.id}-${displayIndex}`} disabled={disabled} />
              <Label htmlFor={`opt-${question.id}-${displayIndex}`} className={`flex-1 ${disabled ? "cursor-default" : "cursor-pointer"}`}>
                {options[originalIndex]}
              </Label>
              {showCorrectAnswer && isCorrect && (
                <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
              )}
              {showCorrectAnswer && isWrong && (
                <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              )}
            </div>
          );
        })}
      </RadioGroup>
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
      <div className="space-y-3">
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
              className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors select-none ${
                disabled ? "cursor-default" : "cursor-pointer"
              } ${borderClass} ${bgClass}`}
              onClick={() => toggle(originalIndex)}
            >
              <Checkbox
                checked={isSelected}
                className="pointer-events-none"
                disabled={disabled}
              />
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
      </div>
    );
  }

  // Matching with DnD
  if (question.type === "matching") {
    return (
      <MatchingQuestion
        question={question}
        answer={answer}
        onAnswer={disabled ? () => { } : onAnswer}
        shuffleMapping={shuffleMapping}
        disabled={disabled}
        showCorrectAnswer={showCorrectAnswer}
        correctAnswer={correctAnswer}
      />
    );
  }

  // Ranking with DnD
  if (question.type === "ranking") {
    return (
      <RankingQuestion
        question={question}
        answer={answer}
        onAnswer={disabled ? () => { } : onAnswer}
        shuffleMapping={shuffleMapping}
        disabled={disabled}
        showCorrectAnswer={showCorrectAnswer}
        correctAnswer={correctAnswer}
      />
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
  const correctPairs: Array<{left: number, right: number}> = correctAnswer?.pairs || [];
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
            className={`flex items-center gap-3 p-4 rounded-lg border transition-all ${
              disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
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