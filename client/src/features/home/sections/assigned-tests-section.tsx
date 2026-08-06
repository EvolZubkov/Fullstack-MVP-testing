/**
 * @module features/home/sections/assigned-tests-section
 * @description PRD-25 FR-07: the tests assigned to the current user, the ones
 * with an unfinished attempt first. A test whose retake cooldown is still closed
 * shows the date it opens instead of an enabled button — the same state the start
 * screen renders, so the two never contradict each other. The empty state carries
 * NO action (FR-17): an assignment is created by somebody else, and a button here
 * would lead into a dead end.
 */
import { Fragment } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Inbox } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardDivider,
  CardFooter,
  CardHeader,
  Cluster,
  EmptyState,
  Grid,
  Stack,
  Text,
} from "@universityrt/ui-kit";
import type { AssignedTestItem } from "@shared/home/contract";

/** Render a calendar date (`YYYY-MM-DD`, PRD-6 cooldown) as `DD.MM.YYYY`. */
function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return day && month && year ? `${day}.${month}.${year}` : isoDate;
}

/** Attempts line under the title: the used-of-available counters (FR-07). */
function attemptsLine(item: AssignedTestItem): string {
  if (item.inProgressAttemptId) {
    const current = item.completedAttempts + 1;
    return item.maxAttempts === null
      ? `Попытка ${current} · не завершена`
      : `Попытка ${current} из ${item.maxAttempts} · не завершена`;
  }
  return item.maxAttempts === null
    ? `Попыток использовано ${item.completedAttempts}`
    : `Попыток использовано ${item.completedAttempts} из ${item.maxAttempts}`;
}

/**
 * The «Мне назначено» section.
 *
 * @param props.items - up to four assigned tests, in-progress ones first.
 * @param props.total - how many assignments the user has in all; the footer link
 *   appears only when it exceeds the number shown.
 * @returns the section card.
 */
export function AssignedTestsSection({
  items,
  total,
}: {
  items: AssignedTestItem[];
  total: number;
}) {
  const [, navigate] = useLocation();
  const hasMore = total > items.length;

  return (
    <Card variant="outlined" data-testid="home-assigned">
      <CardHeader title="Мне назначено" />
      <CardBody>
        {/* One grid for the whole list, not a stack of independent rows: the
            action column is shared, so «Начать» and «Продолжить» come out the
            same width instead of a ragged edge. */}
        {items.length === 0 ? (
          <EmptyState
            layout="inline"
            art={<Inbox size={24} aria-hidden="true" />}
            title="Тестов пока не назначено"
            description="Назначенные вам тесты появятся здесь."
          />
        ) : (
          <Grid template="list-action" gap={3}>
            {items.map((item, index) => (
              <Fragment key={item.testId}>
                {index > 0 && <CardDivider />}
                <Stack gap={1} data-testid={`home-assigned-${item.testId}`}>
                  <Text variant="body-m" weight="medium">{item.title}</Text>
                  <Text variant="body-xs" tone="muted">{attemptsLine(item)}</Text>
                </Stack>
                {item.blockedUntil ? (
                  <Text variant="body-xs" tone="muted" data-testid={`home-assigned-blocked-${item.testId}`}>
                    {`Новая попытка будет доступна ${formatCalendarDate(item.blockedUntil)}`}
                  </Text>
                ) : (
                  <Button
                    size="s"
                    fullWidth
                    trailingIcon={<ArrowRight size={14} />}
                    onClick={() => navigate(`/learner/test/${item.testId}`)}
                    data-testid={`home-assigned-start-${item.testId}`}
                  >
                    {item.inProgressAttemptId ? "Продолжить" : "Начать"}
                  </Button>
                )}
              </Fragment>
            ))}
          </Grid>
        )}
      </CardBody>
      {hasMore && (
        <CardFooter>
          <Text variant="body-s" tone="muted">{`Показаны ${items.length} из ${total}`}</Text>
          <Cluster gap={2}>
            <Button
              variant="secondary"
              size="s"
              onClick={() => navigate("/learner")}
              data-testid="home-assigned-all"
            >
              Все назначенные тесты
            </Button>
          </Cluster>
        </CardFooter>
      )}
    </Card>
  );
}
