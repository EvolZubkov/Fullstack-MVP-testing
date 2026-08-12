/**
 * @module features/home/sections/summary-strip
 * @description PRD-25 FR-12: four numbers for the last 30 days and a link into
 * «Аналитика». No charts, no sparklines, no deltas — trends belong to the
 * analytics screen, and duplicating them here was rejected explicitly (spec risk
 * R-1). Adding a chart to this section is a defect, not an improvement.
 */
import { useLocation } from "wouter";
import { BarChart3 } from "lucide-react";
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
 * The «Сводка» section.
 *
 * @param props.data - the four 30-day aggregates resolved in the user's scope.
 * @returns the section card.
 */
export function SummaryStrip({
  data,
}: {
  data: { attempts30d: number; passRate: number; avgPercent: number; activeUsers: number };
}) {
  const [, navigate] = useLocation();

  return (
    <Card variant="outlined" data-testid="home-summary">
      <CardHeader title="Сводка" subtitle="За 30 дней" />
      <CardBody>
        <Grid cols={2} gap={3}>
          <CardKpi label="Попытки" value={data.attempts30d} data-testid="home-summary-attempts" />
          <CardKpi label="Доля сдачи" value={`${data.passRate}%`} data-testid="home-summary-pass-rate" />
          <CardKpi label="Средний процент" value={`${data.avgPercent}%`} data-testid="home-summary-avg" />
          <CardKpi label="Активные пользователи" value={data.activeUsers} data-testid="home-summary-users" />
        </Grid>
      </CardBody>
      <CardFooter>
        <Text variant="body-s" tone="muted">Графиков нет — они в «Аналитике»</Text>
        <Cluster gap={2}>
          <Button
            variant="secondary"
            size="s"
            leadingIcon={<BarChart3 size={14} />}
            onClick={() => navigate("/author/analytics")}
            data-testid="home-summary-analytics"
          >
            Аналитика
          </Button>
        </Cluster>
      </CardFooter>
    </Card>
  );
}
