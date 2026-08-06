/**
 * @module features/home/sections/people-section
 * @description PRD-25 FR-11: three counters for the manager — how much is
 * assigned, how much has not been touched at all, and how many people arrived
 * this week. Counters only: the scope behind them is the existing one (FR-16),
 * and the section owns no filtering of its own.
 */
import { useLocation } from "wouter";
import { ClipboardList, Clock, UserPlus } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardKpi,
  Cluster,
  Grid,
  Text,
} from "@universityrt/ui-kit";

/**
 * The «Люди и назначения» section.
 *
 * @param props.data - the three counters resolved inside the user's scope.
 * @returns the section card.
 */
export function PeopleSection({
  data,
}: {
  data: { activeAssignments: number; notStarted: number; newUsers7d: number };
}) {
  const [, navigate] = useLocation();

  return (
    <Card variant="outlined" data-testid="home-people">
      <CardHeader title="Люди и назначения" />
      <CardBody>
        <Grid cols={3} gap={3}>
          <CardKpi
            label={
              <Cluster as="span" gap={1}>
                <ClipboardList size={14} aria-hidden="true" />
                Активные назначения
              </Cluster>
            }
            value={data.activeAssignments}
            data-testid="home-people-active"
          />
          <CardKpi
            label={
              <Cluster as="span" gap={1}>
                <Clock size={14} aria-hidden="true" />
                Ни одной попытки
              </Cluster>
            }
            value={data.notStarted}
            data-testid="home-people-not-started"
          />
          <CardKpi
            label={
              <Cluster as="span" gap={1}>
                <UserPlus size={14} aria-hidden="true" />
                Новых за 7 дней
              </Cluster>
            }
            value={data.newUsers7d}
            data-testid="home-people-new-users"
          />
        </Grid>
      </CardBody>
      <CardFooter>
        <Text variant="body-s" tone="muted">Данные по вашей области видимости</Text>
        <Cluster gap={2}>
          <Button
            variant="secondary"
            size="s"
            onClick={() => navigate("/author/users")}
            data-testid="home-people-users"
          >
            Пользователи
          </Button>
        </Cluster>
      </CardFooter>
    </Card>
  );
}
