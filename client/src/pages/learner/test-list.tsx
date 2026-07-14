import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ClipboardList, Clock, BookOpen, ArrowRight, AlertCircle } from "lucide-react";
import {
  Box,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Cluster,
  EmptyState,
  Grid,
  Stack,
  Tag,
  Text,
} from "@universityrt/ui-kit";
import { PageHeader } from "@/components/page-header";
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
    <Box maxW="4xl" padX={6} padY={8}>
      <PageHeader
        title={t.learnerTests.title}
        description={t.learnerTests.description}
      />

      {!tests || tests.length === 0 ? (
        <EmptyState
          art={<ClipboardList size={48} color="var(--ou-fg-muted)" />}
          title={t.learnerTests.noTests}
          description={t.learnerTests.noTests}
        />
      ) : (
        <Grid minItem="lg" gap={1}>
          {tests.map((test) => {
            const isAdaptive = test.mode === "adaptive";
            const totalQuestions = test.sections.reduce((sum, s) => sum + s.drawCount, 0);
            const estimatedMinutes = Math.ceil(totalQuestions * 1.5);

            const maxAttempts = test.maxAttempts || null;
            const completedAttempts = test.completedAttempts || 0;
            const attemptsExhausted = maxAttempts !== null && completedAttempts >= maxAttempts;
            const hasInProgress = test.inProgressAttemptId !== null;

            return (
              <Card key={test.id} data-testid={`card-learner-test-${test.id}`}>
                <CardHeader title={test.title} subtitle={test.description || undefined} />
                <CardBody>
                  <Stack gap={4}>
                    {!isAdaptive && (
                      <Cluster gap={3}>
                        <Cluster gap={1}>
                          <BookOpen size={16} color="var(--ou-fg-muted)" />
                          <Text variant="body-s" tone="muted">{formatQuestions(totalQuestions)}</Text>
                        </Cluster>
                        <Cluster gap={1}>
                          <Clock size={16} color="var(--ou-fg-muted)" />
                          <Text variant="body-s" tone="muted">~{estimatedMinutes} мин</Text>
                        </Cluster>
                      </Cluster>
                    )}

                    {maxAttempts !== null && (
                      <Text variant="body-s" tone={attemptsExhausted ? "error" : "muted"}>
                        Попыток: {completedAttempts} / {maxAttempts}
                        {attemptsExhausted && " — Попытки закончились"}
                      </Text>
                    )}

                    <Stack gap={2}>
                      <Text variant="body-xs" tone="muted" weight="medium">Темы</Text>
                      <Cluster gap={2}>
                        {test.sections.map((section) => (
                          <Tag key={section.id}>{section.topicName}</Tag>
                        ))}
                      </Cluster>
                    </Stack>
                  </Stack>
                </CardBody>
                <CardFooter>
                  {attemptsExhausted ? (
                    <Button fullWidth variant="secondary" disabled leadingIcon={<AlertCircle size={16} />}>
                      Попытки закончились
                    </Button>
                  ) : hasInProgress ? (
                    <Button
                      fullWidth
                      trailingIcon={<ArrowRight size={16} />}
                      onClick={() => navigate(`/learner/test/${test.id}`)}
                      data-testid={`button-continue-test-${test.id}`}
                    >
                      Продолжить тест
                    </Button>
                  ) : (
                    <Button
                      fullWidth
                      trailingIcon={<ArrowRight size={16} />}
                      onClick={() => navigate(`/learner/test/${test.id}`)}
                      data-testid={`button-start-test-${test.id}`}
                    >
                      {t.learnerTests.startTest}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </Grid>
      )}
    </Box>
  );
}
