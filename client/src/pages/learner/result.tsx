import { useParams, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, ExternalLink, ArrowLeft, RotateCcw, Trophy, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { LoadingState } from "@/components/loading-state";
import { TemplateScreen } from "@/components/template-screen";
import { t } from "@/lib/i18n";
import type { Attempt, AttemptResult, TopicResult } from "@shared/schema";

interface AttemptWithResult extends Attempt {
  testTitle: string;
  result: AttemptResult;
  canRetake: boolean;
  attemptsInfo: {
    completed: number;
    max: number | null;
  } | null;
  /** PRD-12 web-host: template render payload for the results screen (standard mode). */
  render?: {
    layout: string;
    css: string;
    context: unknown;
    theme?: { background: string; foreground: string };
  } | null;
}

export default function ResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const [, navigate] = useLocation();

  const { data: attempt, isLoading, error } = useQuery<AttemptWithResult>({
    queryKey: ["/api/attempts", attemptId, "result"],
  });

  if (isLoading) {
    return <LoadingState message={t.result.loading} />;
  }

  if (error || !attempt) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12 text-center">
        <h1 className="text-2xl font-semibold mb-4">{t.common.resultsNotFound}</h1>
        <p className="text-muted-foreground mb-6">
          {t.common.couldNotFindResults}
        </p>
        <Button onClick={() => navigate("/learner")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t.result.backToTests}
        </Button>
      </div>
    );
  }

  const result = attempt.result;

  if (!result) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12 text-center">
        <h1 className="text-2xl font-semibold mb-4">{t.common.resultsNotFound}</h1>
        <p className="text-muted-foreground mb-6">
          Результаты этой попытки ещё не сформированы или были потеряны.
        </p>
        <Button onClick={() => navigate("/learner")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t.result.backToTests}
        </Button>
      </div>
    );
  }

  // Адаптивный тест — через шаблон (если сервер дал render), иначе legacy-вёрстка.
  if ((result as any).mode === "adaptive") {
    if (attempt.render) {
      return <TemplateResultPage attempt={attempt} />;
    }
    return <AdaptiveResultPage attempt={attempt} result={result as any} />;
  }

  // PRD-12 web-host: render the results screen via the design template when the
  // server supplied a render payload (standard mode); else the React markup below.
  if (attempt.render) {
    return <TemplateResultPage attempt={attempt} />;
  }

  const passed = result.overallPassed;
  const failedTopics = result.topicResults?.filter((topic) => topic.passed === false) ?? [];

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="text-center mb-8">
        <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 ${passed ? "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300" : "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300"}`}>
          {passed ? <Trophy className="h-10 w-10" /> : <Target className="h-10 w-10" />}
        </div>
        <h1 className="text-3xl font-bold mb-2">{passed ? t.common.congratulations : t.common.keepLearning}</h1>
        <p className="text-lg text-muted-foreground">{passed ? t.common.passedMessage : t.common.failedMessage}</p>
      </div>

      <Card className="mb-8">
        <CardHeader className="text-center">
          <CardTitle className="text-lg">{attempt.testTitle}</CardTitle>
          <CardDescription>{t.result.title}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center">
            <div className="relative w-40 h-40 mb-4">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="80"
                  cy="80"
                  r="70"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="12"
                  className="text-muted"
                />
                <circle
                  cx="80"
                  cy="80"
                  r="70"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 70}
                  strokeDashoffset={2 * Math.PI * 70 * (1 - (result.overallPercent ?? 0) / 100)}
                  className={passed ? "text-green-500" : "text-red-500"}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-bold">{Math.round(result.overallPercent ?? 0)}%</span>
                <span className="text-sm text-muted-foreground">{t.result.score}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 text-center">
              <div>
                <p className="text-2xl font-semibold">{result.totalCorrect}/{result.totalQuestions}</p>
                <p className="text-sm text-muted-foreground">{t.common.questionsLabel}</p>
              </div>
              <Separator orientation="vertical" className="h-10" />
              <div>
                <p className="text-2xl font-semibold">{result.totalEarnedPoints}/{result.totalPossiblePoints}</p>
                <p className="text-sm text-muted-foreground">{t.common.pointsLabel}</p>
              </div>
              <Separator orientation="vertical" className="h-10" />
              <div>
                <Badge
                  className={
                    passed
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                  }
                >
                  {passed ? t.result.passed : t.result.failed}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <h2 className="text-xl font-semibold mb-4">{t.result.topicBreakdown}</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {result.topicResults.map((topic) => (
          <TopicResultCard key={topic.topicId} topic={topic} />
        ))}
      </div>

      {failedTopics.length > 0 && (
        <>
          <h2 className="text-xl font-semibold mb-4">{t.result.recommendedCourses}</h2>
          <p className="text-muted-foreground mb-4">
            {t.result.coursesDescription}
          </p>

          <div className="space-y-4 mb-8">
            {failedTopics.map((topic) => {
              if (!topic.recommendedCourses || topic.recommendedCourses.length === 0) {
                return null;
              }

              return (
                <Card key={topic.topicId}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-red-500" />
                      {topic.topicName}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {topic.recommendedCourses.map((course, i) => (
                        <a
                          key={i}
                          href={course.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                          data-testid={`link-course-${topic.topicId}-${i}`}
                        >
                          <ExternalLink className="h-4 w-4 text-primary shrink-0" />
                          <span className="font-medium">{course.title}</span>
                        </a>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <Button variant="outline" asChild>
          <Link href="/learner">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t.result.backToTests}
          </Link>
        </Button>
        {attempt.canRetake && (
          <Button asChild>
            <Link href={`/learner/test/${attempt.testId}`}>
              <RotateCcw className="h-4 w-4 mr-2" />
              {t.common.retakeTest}
            </Link>
          </Button>
        )}
      </div>

      {attempt.attemptsInfo && (
        <div className="text-center mt-4 text-sm text-muted-foreground">
          Использовано попыток: {attempt.attemptsInfo.completed} / {attempt.attemptsInfo.max}
          {!attempt.canRetake && attempt.attemptsInfo.max !== null && (
            <span className="block text-red-500 mt-1">Попытки закончились</span>
          )}
        </div>
      )}
    </div>
  );
}

function TopicResultCard({ topic }: { topic: TopicResult }) {
  const passed = topic.passed;
  const hasPassRule = topic.passRule !== null;

  return (
    <Card data-testid={`card-topic-result-${topic.topicId}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            {passed === true && <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />}
            {passed === false && <XCircle className="h-5 w-5 text-red-500 shrink-0" />}
            {passed === null && <div className="h-5 w-5 rounded-full bg-muted shrink-0" />}
            <h3 className="font-semibold">{topic.topicName}</h3>
          </div>
          {hasPassRule && (
            <Badge
              className={
                passed
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
              }
            >
              {passed ? t.result.passed : t.result.failed}
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t.common.questionsLabel}</span>
            <span className="font-medium">
              {topic.correct} / {topic.total} ({Math.round(topic.percent)}%)
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t.common.pointsLabel}</span>
            <span className="font-medium">
              {topic.earnedPoints} / {topic.possiblePoints}
            </span>
          </div>
          <Progress
            value={topic.percent}
            className={`h-2 ${passed === false
              ? "[&>div]:bg-red-500"
              : passed === true
                ? "[&>div]:bg-green-500"
                : ""
              }`}
          />
          {hasPassRule && topic.passRule && (
            <p className="text-xs text-muted-foreground">
              {t.common.required}{" "}
              {topic.passRule.type === "percent"
                ? `${topic.passRule.value}%`
                : `${topic.passRule.value} ${t.common.correct}`}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Read a CSS custom property (e.g. `--background`) from a stylesheet string. */
function cssVar(css: string, name: string): string | undefined {
  const m = new RegExp(`--${name}:\\s*([^;}]+)`).exec(css);
  return m ? m[1].trim() : undefined;
}

function TemplateResultPage({ attempt }: { attempt: AttemptWithResult }) {
  const [, navigate] = useLocation();
  const render = attempt.render!;
  // Full-bleed surface in the template's own colors, so there is no seam between
  // the (dark) template and the surrounding app shell. The back-nav lives inside
  // the surface, on the same background. Colors come from the template CSS itself
  // (server `theme` if present, else parsed from the bundled stylesheet).
  const surface = render.theme?.background || cssVar(render.css, "background");
  const onSurface = render.theme?.foreground || cssVar(render.css, "foreground");

  return (
    <div className="min-h-full flex flex-col" style={{ background: surface }}>
      <TemplateScreen
        className="flex-1 w-full"
        layout={render.layout}
        css={render.css}
        context={render.context}
        onAction={(action) => {
          if (action === "restart" && attempt.canRetake) {
            navigate(`/learner/test/${attempt.testId}`);
          }
        }}
      />

      <div
        className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 pb-10 text-sm"
        style={{ color: onSurface }}
      >
        <Link href="/learner" className="inline-flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity">
          <ArrowLeft className="h-4 w-4" />
          {t.result.backToTests}
        </Link>
        {attempt.attemptsInfo && (
          <span className="opacity-70">
            Использовано попыток: {attempt.attemptsInfo.completed} / {attempt.attemptsInfo.max}
            {!attempt.canRetake && attempt.attemptsInfo.max !== null && " — попытки закончились"}
          </span>
        )}
      </div>
    </div>
  );
}

function AdaptiveResultPage({ attempt, result }: { attempt: AttemptWithResult; result: any }) {
  const [, navigate] = useLocation();
  const passed = result.overallPassed;

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
          <Trophy className="h-10 w-10" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Тест завершён!</h1>
        <p className="text-lg text-muted-foreground">{attempt.testTitle}</p>
      </div>

      <h2 className="text-xl font-semibold mb-4">Результаты по темам</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {result.topicResults.map((tr: any) => (
          <Card key={tr.topicId}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                  {tr.achievedLevelIndex !== null
                    ? <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                    : <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                  }
                  <h3 className="font-semibold">{tr.topicName}</h3>
                </div>
                <Badge className={tr.achievedLevelIndex !== null
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                  : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                }>
                  {tr.achievedLevelName ?? "Не достигнут"}
                </Badge>
              </div>

              {tr.feedback && (
                <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3 mb-3">
                  {tr.feedback}
                </p>
              )}

              {tr.recommendedLinks && tr.recommendedLinks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Рекомендуемые материалы:</p>
                  {tr.recommendedLinks.map((link: any, i: number) => ( <a
                    
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                    >
                      <ExternalLink className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-sm font-medium">{link.title}</span>
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <Button variant="outline" asChild>
          <Link href="/learner">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t.result.backToTests}
          </Link>
        </Button>
        {attempt.canRetake && (
          <Button asChild>
            <Link href={`/learner/test/${attempt.testId}`}>
              <RotateCcw className="h-4 w-4 mr-2" />
              {t.common.retakeTest}
            </Link>
          </Button>
        )}
      </div>
    </div >
  );
}