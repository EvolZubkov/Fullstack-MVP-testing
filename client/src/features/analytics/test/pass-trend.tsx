/**
 * @module features/analytics/test/pass-trend
 * @description PRD-56 FR-13: динамика сдаваемости теста по месяцам.
 *
 * Подпись месяца несёт его объём («сентябрь · 46»): доля сдавших по пяти прохождениям и по
 * четырёмстам — разные по надёжности точки, и на линии они выглядят одинаково.
 *
 * Там, где вердиктов не выносили, линии нет вовсе: «ноль процентов сдали» — это утверждение о
 * провале, а не об опроснике, который ничего не оценивает.
 */
import { Card, CardBody, CardHeader, LineChart, Text } from "@skillum/ui-kit";

import { percent } from "../format";

/** Точка линии — то, что отдаёт `GET /api/analytics/tests/:testId`. */
export interface PassTrendPointView {
  key: string;
  label: string;
  attempts: number;
  judged: number;
  passRate: number | null;
}

export interface PassTrendProps {
  points: PassTrendPointView[];
}

/** Короткая подпись оси: месяц без года и объём точки. */
function axisLabel(point: PassTrendPointView): string {
  return `${point.label.split(" ")[0]} · ${point.attempts}`;
}

export function PassTrend({ points }: PassTrendProps) {
  const judged = points.filter(point => point.passRate !== null);

  return (
    <Card>
      <CardHeader title="Динамика сдаваемости" subtitle="Доля сдавших по месяцам" />
      <CardBody>
        {points.length === 0 ? (
          <Text tone="muted">Прохождений пока нет — динамику строить не из чего.</Text>
        ) : judged.length === 0 ? (
          <Text tone="muted">
            В этом тесте вердиктов не выносили: доли сдавших у него нет, а ноль означал бы провал,
            которого не было.
          </Text>
        ) : (
          <LineChart
            height={260}
            categories={judged.map(axisLabel)}
            series={[{
              id: "passRate",
              label: "Сдали",
              data: judged.map(point => Math.round(point.passRate ?? 0)),
              color: "var(--ou-accent-default)",
              dots: true,
            }]}
            yMin={0}
            yMax={100}
            yTickFormat={value => percent(value)}
          />
        )}
      </CardBody>
    </Card>
  );
}
