/**
 * @module features/analytics/test/indicator-profile
 * @description PRD-56 FR-21c - FR-21e: the «Показатели» card of the «Шкалы и показатели» tab.
 *
 * One block per indicator, and the block follows the indicator's type, as the server summarised
 * it (`server/services/analytics/indicator-profile`), approved/analytics-indicators.html:
 *
 *  - `bands` and `outcomes` — a row per level or outcome, laid out like «Профиль по шкалам»: each
 *    share has its own bar, so shares compare by length (owner 2026-10-08: a stacked bar could not
 *    be compared);
 *  - `average` — a compact histogram over ten intervals of the domain, half the card wide, in the
 *    ACCENT colour: without bands the value carries no «good» or «bad» (FR-21b), and an average
 *    alone says nothing about the group.
 *
 * Values are the STORED ones (FR-21e): a run that holds no value is counted as «не передано»,
 * never as zero.
 */
import { BarChart, Card, CardBody, CardHeader, ProgressBar, Stack, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

import { percent } from "../format";
import { shareAxis } from "./score-distribution";

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
  /** Ten intervals of the domain — only for `kind: "average"`. */
  histogram: IndicatorHistogramBin[];
}

export interface IndicatorHistogramBin {
  label: string;
  from: number;
  to: number;
  count: number;
  share: number;
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

/** Compact histogram of a numeric indicator without bands. */
function IndicatorHistogram({ bins }: { bins: IndicatorHistogramBin[] }) {
  const top = Math.max(0, ...bins.map(bin => Math.round(bin.share)));
  // A 120 px chart has little room above the tallest bar: without extra headroom its «67 %» is
  // pushed inside the bar and lost (live ЧИЛ data). A fifth more of the axis keeps it above.
  const axis = shareAxis(Math.min(100, Math.ceil(top * 1.2)));
  return (
    <div className="tb-indicator-hist">
      <BarChart
        height={120}
        yMax={axis.max}
        yTickValues={[0, axis.max / 2, axis.max]}
        categories={bins.map(bin => bin.label)}
        series={[{
          id: "share",
          label: "Доля прохождений",
          data: bins.map(bin => Math.round(bin.share)),
          color: "var(--ou-accent-default)",
          labels: "outside",
          // An empty interval needs no «0 %» over a missing bar.
          labelFormat: value => (value > 0 ? percent(value) : ""),
        }]}
        yTickFormat={value => percent(value)}
      />
    </div>
  );
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
    <Stack gap={2}>
      <Stack direction="row" gap={4} justify="between" align="baseline">
        <Text variant="body-s" weight="medium">{indicator.label}</Text>
        <Text variant="body-xs" tone="muted">{metaText(indicator)}</Text>
      </Stack>
      {indicator.kind === "average" ? (
        // `?? []`: an answer of a server older than the histogram carries none.
        <IndicatorHistogram bins={indicator.histogram ?? []} />
      ) : (
        <Stack gap={2}>
          {indicator.shares.map(share => (
            <ProgressBar
              key={share.key}
              size="s"
              label={share.label}
              value={share.share}
              valueLabel={percent(share.share)}
            />
          ))}
        </Stack>
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
