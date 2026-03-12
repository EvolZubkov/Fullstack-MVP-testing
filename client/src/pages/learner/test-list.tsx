import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ClipboardList, Clock, BookOpen, ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { t, formatQuestions } from "@/lib/i18n";
import type { Test, TestSection } from "@shared/schema";

interface TestWithSections extends Test {
  sections: (TestSection & { topicName: string })[];
  completedAttempts: number;
  inProgressAttemptId: string | null;
}

export default function LearnerTestListPage() {
  const [, navigate] = useLocation();

  const { data: tests, isLoading } = useQuery<TestWithSections[]>({
    queryKey: ["/api/learner/tests"],
    refetchInterval: 30000, // Обновлять каждые 30 секунд
    refetchOnWindowFocus: true, // Обновлять при возврате на вкладку
  });

  if (isLoading) {
    return <LoadingState message={t.learnerTests.loading} />;
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <PageHeader
        title={t.learnerTests.title}
        description={t.learnerTests.description}
      />

      {!tests || tests.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t.learnerTests.noTests}
          description={t.learnerTests.noTests}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {tests.map((test) => {
            const isAdaptive = test.mode === "adaptive";
            const totalQuestions = test.sections.reduce((sum, s) => sum + s.drawCount, 0);
            const estimatedMinutes = Math.ceil(totalQuestions * 1.5);

            // Проверяем ограничение попыток
            const maxAttempts = test.maxAttempts || null;
            const completedAttempts = test.completedAttempts || 0;
            const attemptsExhausted = maxAttempts !== null && completedAttempts >= maxAttempts;
            const hasInProgress = test.inProgressAttemptId !== null;

            return (
              <Card key={test.id} data-testid={`card-learner-test-${test.id}`}>
                <CardHeader>
                  <CardTitle className="text-lg">{test.title}</CardTitle>
                  {test.description && (
                    <CardDescription className="line-clamp-2">
                      {test.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  {!isAdaptive && (
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <BookOpen className="h-4 w-4" />
                        <span>{formatQuestions(totalQuestions)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>~{estimatedMinutes} мин</span>
                      </div>
                    </div>
                  )}

                  {/* Информация о попытках */}
                  {maxAttempts !== null && (
                    <div className="mt-3">
                      <div className={`text-sm ${attemptsExhausted ? "text-red-500" : "text-muted-foreground"}`}>
                        Попыток: {completedAttempts} / {maxAttempts}
                        {attemptsExhausted && (
                          <span className="ml-2 font-medium">— Попытки закончились</span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      Темы
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {test.sections.map((section) => (
                        <Badge key={section.id} variant="secondary">
                          {section.topicName}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  {attemptsExhausted ? (
                    <Button
                      className="w-full"
                      variant="secondary"
                      disabled
                    >
                      <AlertCircle className="h-4 w-4 mr-2" />
                      Попытки закончились
                    </Button>
                  ) : hasInProgress ? (
                    <Button
                      className="w-full"
                      onClick={() => navigate(`/learner/test/${test.id}`)}
                      data-testid={`button-continue-test-${test.id}`}
                    >
                      Продолжить тест
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={() => navigate(`/learner/test/${test.id}`)}
                      data-testid={`button-start-test-${test.id}`}
                    >
                      {t.learnerTests.startTest}
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}