import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CheckCircle, GripVertical, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { LoadingState, LoadingSpinner } from "@/components/loading-state";
import { t } from "@/lib/i18n";
import type { Question, Attempt } from "@shared/schema";

interface AttemptWithQuestions extends Attempt {
  questions: Question[];
  testTitle: string;
}

interface FlatQuestion {
  question: Question;
  topicName: string;
  index: number;
}

export default function TakeTestPage() {
  const { testId } = useParams<{ testId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [attempt, setAttempt] = useState<AttemptWithQuestions | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [flatQuestions, setFlatQuestions] = useState<FlatQuestion[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shuffleMappings, setShuffleMappings] = useState<Record<string, any>>({});

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

  useEffect(() => {
    const startAttempt = async () => {
      setIsStarting(true);
      try {
        const res = await fetch(`/api/tests/${testId}/attempts/start`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to start attempt");
        const data = await res.json();
        setAttempt(data);

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

              // Generate shuffle mappings for each question type
              if (question.shuffleAnswers !== false) {
                const qData = question.dataJson as any;
                
                if (question.type === "single" || question.type === "multiple") {
                  // Shuffle options for single/multiple choice
                  const optCount = qData.options?.length || 0;
                  if (optCount > 0) {
                    mappings[question.id] = createShuffleMapping(optCount);
                  }
                } else if (question.type === "matching") {
                  // Shuffle both left and right columns for matching
                  const leftCount = qData.left?.length || 0;
                  const rightCount = qData.right?.length || 0;
                  if (leftCount > 0 && rightCount > 0) {
                    mappings[question.id] = {
                      left: createShuffleMapping(leftCount),
                      right: createShuffleMapping(rightCount),
                    };
                  }
                } else if (question.type === "ranking") {
                  // Shuffle initial order for ranking
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
      } catch (err) {
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

    startAttempt();
  }, [testId, navigate, toast]);

  const handleAnswer = (questionId: string, answer: any) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
  };

  const handleNext = () => {
    const currentQ = flatQuestions[currentIndex];
    const currentAnswer = answers[currentQ.question.id];

    // Validate that question is answered before moving to next
    if (currentAnswer === undefined || currentAnswer === null) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, ответьте на вопрос перед продолжением",
      });
      return;
    }

    // For multiple choice, check if at least one option is selected
    if (currentQ.question.type === "multiple" && Array.isArray(currentAnswer) && currentAnswer.length === 0) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, выберите хотя бы один вариант ответа",
      });
      return;
    }

    // For matching, check if all pairs are matched
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

    // Move to next question
    setCurrentIndex((i) => Math.min(flatQuestions.length - 1, i + 1));
  };

  const handleSubmit = async () => {
    if (!attempt) return;

    // Validate all questions are answered before submission
    const unansweredQuestions = flatQuestions.filter(
      (fq) => answers[fq.question.id] === undefined || answers[fq.question.id] === null
    );

    if (unansweredQuestions.length > 0) {
      toast({
        variant: "destructive",
        title: "Не все вопросы отвечены",
        description: `Осталось ${unansweredQuestions.length} вопросов без ответа. Пожалуйста, ответьте на все вопросы перед отправкой.`,
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
        title: t.takeTest.submissionFailed,
        description: t.takeTest.couldNotSubmit,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isStarting || !attempt || flatQuestions.length === 0) {
    return <LoadingState message={t.common.preparingTest} />;
  }

  const currentQ = flatQuestions[currentIndex];
  const progress = ((currentIndex + 1) / flatQuestions.length) * 100;
  const answeredCount = Object.keys(answers).length;

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
              {t.takeTest.question} {currentIndex + 1} {t.takeTest.of} {flatQuestions.length}
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            {t.common.topic}: <span className="font-medium text-foreground">{currentQ.topicName}</span>
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
                    alt={t.common.imageAttached}
                    className="max-h-64 object-contain mx-auto rounded-md"
                    data-testid="question-media-image"
                  />
                )}
                {currentQ.question.mediaType === "audio" && (
                  <audio controls className="w-full" data-testid="question-media-audio">
                    <source src={currentQ.question.mediaUrl} />
                    {t.questions.browserNotSupported}
                  </audio>
                )}
                {currentQ.question.mediaType === "video" && (
                  <video controls className="max-h-64 w-full rounded-md" data-testid="question-media-video">
                    <source src={currentQ.question.mediaUrl} />
                    {t.questions.browserNotSupported}
                  </video>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <QuestionInput
              question={currentQ.question}
              answer={answers[currentQ.question.id]}
              onAnswer={(answer) => handleAnswer(currentQ.question.id, answer)}
              shuffleMapping={shuffleMappings[currentQ.question.id]}
            />
          </CardContent>
        </Card>

        <div className="flex items-center justify-between mt-8">
          <Button
            variant="outline"
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
            data-testid="button-prev-question"
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            {t.takeTest.previous}
          </Button>

          <div className="flex items-center gap-2">
            {flatQuestions.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                className={`w-8 h-8 rounded-full text-xs font-medium transition-colors ${
                  i === currentIndex
                    ? "bg-primary text-primary-foreground"
                    : answers[flatQuestions[i].question.id] !== undefined
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                    : "bg-muted text-muted-foreground"
                }`}
                data-testid={`button-question-nav-${i}`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          {currentIndex < flatQuestions.length - 1 ? (
            <Button
              onClick={handleNext}
              data-testid="button-next-question"
            >
              {t.takeTest.next}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              data-testid="button-submit-test"
            >
              {isSubmitting ? (
                <>
                  <LoadingSpinner className="mr-2" />
                  {t.common.submitting}
                </>
              ) : (
                <>
                  {t.takeTest.submitTest}
                  <CheckCircle className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          )}
        </div>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          {t.common.answeredOf} {answeredCount} {t.takeTest.of} {flatQuestions.length} {t.common.questionsWord}
        </div>
      </div>
    </div>
  );
}

function QuestionInput({
  question,
  answer,
  onAnswer,
  shuffleMapping,
}: {
  question: Question;
  answer: any;
  onAnswer: (answer: any) => void;
  shuffleMapping?: any;
}) {
  const data = question.dataJson as any;

  if (question.type === "single") {
    const options = data.options || [];
    const displayOrder = shuffleMapping || options.map((_: any, i: number) => i);

    return (
      <RadioGroup
        value={answer !== undefined ? String(answer) : ""}
        onValueChange={(val) => onAnswer(Number(val))}
        className="space-y-3"
      >
        {displayOrder.map((originalIndex: number, displayIndex: number) => (
          <div
            key={displayIndex}
            className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors cursor-pointer ${
              answer === originalIndex ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
            onClick={() => onAnswer(originalIndex)}
          >
            <RadioGroupItem value={String(originalIndex)} id={`opt-${displayIndex}`} />
            <Label htmlFor={`opt-${displayIndex}`} className="flex-1 cursor-pointer">
              {options[originalIndex]}
            </Label>
          </div>
        ))}
      </RadioGroup>
    );
  }

  if (question.type === "multiple") {
    const options = data.options || [];
    const displayOrder = shuffleMapping || options.map((_: any, i: number) => i);
    const selected: number[] = answer || [];

    const toggle = (originalIdx: number) => {
      if (selected.includes(originalIdx)) {
        onAnswer(selected.filter((i) => i !== originalIdx));
      } else {
        onAnswer([...selected, originalIdx]);
      }
    };

    return (
      <div className="space-y-3">
        {displayOrder.map((originalIndex: number, displayIndex: number) => (
          <div
            key={displayIndex}
            className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors cursor-pointer ${
              selected.includes(originalIndex)
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
            onClick={() => toggle(originalIndex)}
          >
            <Checkbox checked={selected.includes(originalIndex)} onCheckedChange={() => toggle(originalIndex)} />
            <Label className="flex-1 cursor-pointer">{options[originalIndex]}</Label>
          </div>
        ))}
      </div>
    );
  }

  if (question.type === "matching") {
    const pairs: Record<number, number> = answer || {};
    const leftItems = data.left || [];
    const rightItems = data.right || [];
    
    // Apply shuffle mappings if they exist
    const leftMapping = shuffleMapping?.left || leftItems.map((_: any, i: number) => i);
    const rightMapping = shuffleMapping?.right || rightItems.map((_: any, i: number) => i);

    const updatePair = (displayLeftIdx: number, displayRightIdx: number) => {
      // Convert display indices back to original indices
      const originalLeftIdx = leftMapping[displayLeftIdx];
      const originalRightIdx = rightMapping[displayRightIdx];
      onAnswer({ ...pairs, [originalLeftIdx]: originalRightIdx });
    };

    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t.common.matchInstruction}</p>
        {leftMapping.map((originalLeftIdx: number, displayLeftIdx: number) => {
          // Find which original right index is selected for this original left index
          const selectedOriginalRightIdx = pairs[originalLeftIdx];
          // Convert to display index
          const selectedDisplayRightIdx = selectedOriginalRightIdx !== undefined 
            ? rightMapping.indexOf(selectedOriginalRightIdx)
            : undefined;

          return (
            <div key={displayLeftIdx} className="flex items-center gap-4">
              <div className="flex-1 p-3 rounded-lg bg-muted font-medium">
                {displayLeftIdx + 1}. {leftItems[originalLeftIdx]}
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select
                value={selectedDisplayRightIdx !== undefined ? String(selectedDisplayRightIdx) : ""}
                onValueChange={(val) => updatePair(displayLeftIdx, Number(val))}
              >
                <SelectTrigger className="w-40" data-testid={`select-match-${displayLeftIdx}`}>
                  <SelectValue placeholder={t.common.select} />
                </SelectTrigger>
                <SelectContent>
                  {rightMapping.map((originalRightIdx: number, displayRightIdx: number) => (
                    <SelectItem key={displayRightIdx} value={String(displayRightIdx)}>
                      {String.fromCharCode(65 + displayRightIdx)}. {rightItems[originalRightIdx]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    );
  }

  if (question.type === "ranking") {
    const items = data.items || [];
    // Initialize with shuffled order if mapping exists, otherwise use original order
    const initialOrder = shuffleMapping || items.map((_: any, i: number) => i);
    const order: number[] = answer !== undefined ? answer : initialOrder;

    // On first render, set the shuffled initial order as the answer
    if (answer === undefined && shuffleMapping) {
      setTimeout(() => onAnswer(initialOrder), 0);
    }

    const moveItem = (fromIdx: number, toIdx: number) => {
      const newOrder = [...order];
      const [item] = newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, item);
      onAnswer(newOrder);
    };

    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t.common.rankInstruction}</p>
        {order.map((itemIdx, i) => (
          <div
            key={itemIdx}
            className="flex items-center gap-3 p-4 rounded-lg border bg-card"
          >
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => i > 0 && moveItem(i, i - 1)}
                disabled={i === 0}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => i < order.length - 1 && moveItem(i, i + 1)}
                disabled={i === order.length - 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                ▼
              </button>
            </div>
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium w-6">{i + 1}.</span>
            <span className="flex-1">{items[itemIdx]}</span>
          </div>
        ))}
      </div>
    );
  }

  return <div>{t.common.unknownQuestionType}</div>;
}