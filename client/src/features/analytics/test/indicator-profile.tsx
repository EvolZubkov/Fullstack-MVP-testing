/**
 * @module features/analytics/test/indicator-profile
 * @description PRD-56 FR-21c - FR-21e: the «Показатели» card of the «Шкалы и показатели» tab.
 *
 * One row per indicator, and the row follows the indicator's type, as the server summarised it
 * (`server/services/analytics/indicator-profile`):
 *
 *  - `bands` — the average with its domain and the shares of the interpretation bands;
 *  - `average` — the average alone, drawn in the ACCENT colour: without bands the value carries
 *    no «good» or «bad» (FR-21b);
 *  - `outcomes` — the shares of the outcomes of a string or boolean indicator.
 *
 * Values are the STORED ones (FR-21e): a run that holds no value is counted as «не передано»,
 * never as zero. Colours come ready from the server; the screen chooses none, or the same level
 * would be painted one way in the learner's results and another way here.
 */
import { Card, CardBody, CardHeader, ProgressBar, ProgressStacked, Stack, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

import { percent } from "../format";

export interface IndicatorShareView {
  key: string;
  label: string;
  count: number;
  share: number;
  /** READY CSS colour, decided by the server (FR-21a). */
  color: string;
  tone: string | null;
  rest?: boolean;
}

export interface IndicatorProfileView {
  name: string;
  label: string;
  type: "number" | "string" | "boolean";
  kind: "bands" | "average" | "outcomes";
  sampleSize: number;
  missing: number;
  average: number | null;
  domainMin: number | null;
  domainMax: number | null;
  shares: IndicatorShareView[];
}

export interface IndicatorProfilePanelProps {
  indicators: IndicatorProfileView[];
  /** Runs of the selection that produced any scale or indicator value. */
  observations: number;
}

/** A number with one decimal, Russian decimal mark: «64,2». */
export function decimalText(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return String(rounded).replace(".", ",");
}

/** «среднее 64,2 из 100», or «среднее 6,8» without a domain. */
export function indicatorAverageText(indicator: Pick<IndicatorProfileView, "average" | "domainMax">): string {
  if (indicator.average === null) return "";
  const value = decimalText(indicator.average);
  return indicator.domainMax === null ? `среднее ${value}` : `среднее ${value} из ${indicator.domainMax}`;
}

/** Fill of the average bar: the share of the average in the domain. */
function fill(indicator: IndicatorProfileView): number {
  if (indicator.average === null) return 0;
  const min = indicator.domainMin ?? 0;
  const max = indicator.domainMax ?? 0;
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((indicator.average - min) / (max - min)) * 100));
}

/** The caption on the right of the indicator's name. */
function metaText(indicator: IndicatorProfileView): string {
  const parts: string[] = [];
  if (indicator.kind !== "outcomes") parts.push(indicatorAverageText(indicator));
  parts.push(`${indicator.sampleSize} прохождений`);
  if (indicator.kind === "outcomes") {
    const outcomes = indicator.shares.filter(share => !share.rest).length;
    parts.push(`${outcomes} ${pluralize(outcomes, "исход", "исхода", "исходов")}`);
  }
  // Runs without a value are named, never folded into a zero (FR-27).
  if (indicator.missing > 0) parts.push(`у ${indicator.missing} не передано`);
  return parts.join(" · ");
}

function IndicatorRow({ indicator }: { indicator: IndicatorProfileView }) {
  // No run holds a value: a muted line instead of an empty bar, which would read as «nobody got
  // anywhere» when there is simply nothing to draw.
  if (indicator.sampleSize === 0) {
    return (
      <Stack gap={1}>
        <Text variant="body-s" weight="medium" tone="muted">{indicator.label}</Text>
        <Text variant="body-xs" tone="muted">
          {/* Two different silences: the runs are there but hold no value, or the filter left
              no runs at all. «не передано ни в одном из 0» would be nonsense. */}
          {indicator.missing > 0
            ? `не передано ни в одном из ${indicator.missing} прохождений`
            : "в выборке нет прохождений"}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap={1}>
      <Stack direction="row" gap={4} justify="between" align="baseline">
        <Text variant="body-s" weight="medium">{indicator.label}</Text>
        <Text variant="body-xs" tone="muted">{metaText(indicator)}</Text>
      </Stack>
      {indicator.kind === "average" ? (
        <>
          {/* Accent, not a tone: without bands the value is not judged. Without a domain there
              is nothing to fill the bar against — the number alone says it. */}
          {indicator.domainMax !== null && <ProgressBar value={fill(indicator)} size="s" hideHeader />}
          <Text variant="body-xs" tone="muted">уровни толкования не заданы</Text>
        </>
      ) : (
        <ProgressStacked
          showLegend
          segments={indicator.shares.map(share => ({
            value: Math.round(share.share),
            color: share.color,
            label: `${share.label} — ${percent(share.share)}`,
          }))}
        />
      )}
    </Stack>
  );
}

export function IndicatorProfilePanel({ indicators, observations }: IndicatorProfilePanelProps) {
  return (
    <Card>
      <CardHeader
        title="Показатели"
        subtitle={`${observations} прохождений · сохранённые значения показателей, без пересчёта по ответам`}
      />
      <CardBody>
        <Stack gap={5}>
          {indicators.map(indicator => <IndicatorRow key={indicator.name} indicator={indicator} />)}
        </Stack>
      </CardBody>
    </Card>
  );
}
