import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Cluster,
  EmptyState,
  Stack,
  Tag,
  Text,
} from "@universityrt/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { CheckCircle, XCircle, AlertTriangle, Eye, History, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { t, formatAttempts } from "@/lib/i18n";

interface AttemptData {
  id: string;
  testVersion: number;
  finishedAt: string;
  overallPercent: number;
  overallPassed: boolean;
  totalEarnedPoints: number;
  totalPossiblePoints: number;
  delta: number | null;
  isOutdated: boolean;
  isAdaptive?: boolean;
  achievedCount?: number | null;
  totalTopics?: number | null;
}

interface TestGroup {
  testId: string;
  testTitle: string;
  currentVersion: number;
  attemptCount: number;
  overallImprovement: number | null;
  attempts: AttemptData[];
}

export default function HistoryPage() {
  const { data: testGroups, isLoading } = useQuery<TestGroup[]>({
    queryKey: ["/api/learner/attempts"],
  });

  if (isLoading) {
    return <LoadingState message={t.history.loading} />;
  }

  return (
    <Box pad={6}>
      <Stack gap={6}>
        <Stack gap={1}>
          <Text as="h1" variant="display-s" weight="semibold" data-testid="text-history-title">{t.history.title}</Text>
          <Text tone="muted">{t.history.description}</Text>
        </Stack>

        {!testGroups || testGroups.length === 0 ? (
          <EmptyState
            art={<History size={48} color="var(--ou-fg-muted)" />}
            title={t.history.noHistory}
            actions={
              <Link href="/learner">
                <Button data-testid="button-browse-tests">{t.history.browseTests}</Button>
              </Link>
            }
          />
        ) : (
          testGroups.map((group) => (
            <Card key={group.testId} data-testid={`card-test-history-${group.testId}`}>
              <CardHeader
                title={group.testTitle}
                subtitle={`${formatAttempts(group.attemptCount)} | ${t.history.currentVersion} v${group.currentVersion}`}
                trail={
                  group.overallImprovement !== null && group.overallImprovement > 0 ? (
                    <Tag tone="success" data-testid={`badge-improvement-${group.testId}`}>
                      <TrendingUp />+{group.overallImprovement.toFixed(1)}%
                    </Tag>
                  ) : undefined
                }
              />
              <CardBody>
                <Stack gap={3}>
                  {group.attempts.map((attempt) => (
                    <Box key={attempt.id} border radius="m" pad={3} data-testid={`row-attempt-${attempt.id}`}>
                      <Cluster justify="between" gap={4}>
                        <Cluster gap={3} grow wrap={false}>
                          {attempt.isAdaptive ? (
                            <CheckCircle size={20} color="var(--ou-info-600)" />
                          ) : attempt.overallPassed ? (
                            <CheckCircle size={20} color="var(--ou-success-600)" />
                          ) : (
                            <XCircle size={20} color="var(--ou-error-600)" />
                          )}
                          <Stack gap={1} grow>
                            <Cluster gap={2}>
                              {attempt.isAdaptive ? (
                                <Text weight="medium">{attempt.achievedCount ?? 0}/{attempt.totalTopics ?? 0} тем</Text>
                              ) : (
                                <>
                                  <Text weight="medium">{attempt.overallPercent.toFixed(1)}%</Text>
                                  <Text variant="body-s" tone="muted">
                                    ({attempt.totalEarnedPoints}/{attempt.totalPossiblePoints} {t.common.points})
                                  </Text>
                                </>
                              )}
                              {!attempt.isAdaptive && attempt.delta !== null && (
                                <Tag
                                  tone={attempt.delta > 0 ? "success" : attempt.delta < 0 ? "error" : "neutral"}
                                  variant={attempt.delta === 0 ? "outline" : "soft"}
                                  size="s"
                                  data-testid={`badge-delta-${attempt.id}`}
                                >
                                  {attempt.delta >= 0 ? "+" : ""}{attempt.delta.toFixed(1)}%
                                </Tag>
                              )}
                            </Cluster>
                            <Cluster gap={2}>
                              <Text variant="body-xs" tone="muted">
                                {format(new Date(attempt.finishedAt), "d MMM yyyy 'в' HH:mm", { locale: ru })}
                              </Text>
                              <Tag variant="outline" size="s">v{attempt.testVersion}</Tag>
                              {attempt.isOutdated && (
                                <Tag variant="outline" tone="warning" size="s" data-testid={`badge-outdated-${attempt.id}`}>
                                  <AlertTriangle />{t.history.outdated}
                                </Tag>
                              )}
                            </Cluster>
                          </Stack>
                        </Cluster>
                        <Link href={`/learner/result/${attempt.id}`}>
                          <Button variant="ghost" size="s" leadingIcon={<Eye size={16} />} data-testid={`button-view-result-${attempt.id}`}>
                            {t.history.viewResult}
                          </Button>
                        </Link>
                      </Cluster>
                    </Box>
                  ))}
                </Stack>
              </CardBody>
            </Card>
          ))
        )}
      </Stack>
    </Box>
  );
}
