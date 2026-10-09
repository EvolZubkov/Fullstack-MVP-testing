import React, { forwardRef, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn, cssStyleClass } from '../utils';

/**
 * Tracks the rendered width of a chart wrapper so its viewBox can be in pixels.
 *
 * Charts draw into a viewBox and let CSS stretch the SVG to the container
 * width. With a fixed viewBox width that makes the rendered height a proportion
 * of the width: `height` set an aspect ratio rather than a height, and a chart
 * asked for 240 drew 436 in a 1090px column and 780 in a full-width panel.
 *
 * Measuring the container and using that as the viewBox width makes one viewBox
 * unit one pixel, so `height` is a height and the full width is still used.
 * Measuring in a layout effect keeps the fallback ratio from reaching paint.
 *
 * @param fallback - viewBox width used until the first measurement lands
 * @param forwardedRef - ref the component was asked to forward to the wrapper
 * @returns The measured width and the ref to put on the wrapper
 */
function useMeasuredWidth(
  fallback: number,
  forwardedRef: React.ForwardedRef<HTMLDivElement>,
): readonly [number, (node: HTMLDivElement | null) => void] {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  const attach = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return undefined;

    // A detached or display:none wrapper measures 0. Keeping the fallback is
    // better than dividing the geometry by zero.
    const measure = () => {
      const next = node.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [width, attach] as const;
}

// ─────────────────────────────────────────────────────────────────────────
// Container (head + legend + body)
// ─────────────────────────────────────────────────────────────────────────

export type ChartSwatchTone = 'purple' | 'blue' | 'green' | 'orange';

export interface ChartLegendItem {
  label: React.ReactNode;
  /** Цвет swatch (или одна из предустановленных тонов). */
  color?: string;
  tone?: ChartSwatchTone;
}

export interface ChartProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  legend?: ChartLegendItem[];
  /** Доп. контент справа в шапке. */
  headerExtra?: React.ReactNode;
}

export const Chart = forwardRef<HTMLDivElement, ChartProps>(
  ({ title, subtitle, legend, headerExtra, className, children, style, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-chart', className, cssStyleClass(style, 'ou-chart-sx'))} {...rest}>
      {(title || subtitle || legend || headerExtra) && (
        <div className="ou-chart__head">
          {title && <h3 className="ou-chart__head-title">{title}</h3>}
          {subtitle && <span className="ou-chart__head-sub">{subtitle}</span>}
          <span className="ou-chart__head-spacer" />
          {legend && legend.length > 0 && (
            <div className="ou-chart__legend">
              {legend.map((l, i) => (
                <span key={i} className="ou-chart__legend-item">
                  <span
                    className={cn(
                      'ou-chart__legend-swatch',
                      l.tone && `--${l.tone}`,
                      cssStyleClass(!l.tone && l.color ? { background: l.color } : undefined, 'ou-chart-swatch'),
                    )}
                  />
                  {l.label}
                </span>
              ))}
            </div>
          )}
          {headerExtra}
        </div>
      )}
      {children}
    </div>
  ),
);
Chart.displayName = 'Chart';

// ─────────────────────────────────────────────────────────────────────────
// Shared axis / grid configuration (LineChart + BarChart)
// ─────────────────────────────────────────────────────────────────────────

/** Common axis and grid visibility props shared by LineChart and BarChart. */
export interface ChartAxisProps {
  /** Hide all horizontal grid lines (including the X-axis baseline). */
  hideGrid?: boolean;
  /** Show vertical grid lines at each X-category position. Default false. */
  showGridX?: boolean;
  /** Hide the X-axis baseline line and category labels together. */
  hideXAxis?: boolean;
  /** Hide only X-axis category labels (baseline line is kept). */
  hideXLabels?: boolean;
  /** Hide the Y-axis line and tick value labels together. */
  hideYAxis?: boolean;
  /** Hide only Y-axis tick value labels (axis line is kept). */
  hideYLabels?: boolean;
  /** Custom Y-axis tick positions. When provided, overrides yTicks count. */
  yTickValues?: number[];
  /** Custom Y-axis tick label formatter. Overrides default number formatting. */
  yTickFormat?: (value: number) => string;
}

// ─────────────────────────────────────────────────────────────────────────
// LineChart (multi-series, optional area fill, optional dots)
// ─────────────────────────────────────────────────────────────────────────

export interface LineSeries {
  id: string;
  label?: React.ReactNode;
  /** Массив значений y по индексу X-категории. */
  data: number[];
  /** Цвет линии. */
  color?: string;
  /** Залить область под линией. */
  area?: boolean;
  /** Показывать точки. */
  dots?: boolean;
  /**
   * Show value labels next to markers.
   * - `true` — all points
   * - `number[]` — only the listed point indices
   */
  labels?: boolean | number[];
  /** Format label text for this series. Overrides chart-level labelFormat. */
  labelFormat?: (value: number) => string;
}

export interface LineChartProps extends React.HTMLAttributes<HTMLDivElement>, ChartAxisProps {
  /** Подписи оси X. */
  categories: string[];
  series: LineSeries[];
  /** Минимальное и максимальное значения Y. По умолчанию — авто. */
  yMin?: number;
  yMax?: number;
  /** Кол-во ярлыков на оси Y (плюс верхний/нижний). Игнорируется при yTickValues. */
  yTicks?: number;
  /** Высота SVG в пикселях. По умолчанию 240. Не зависит от ширины окна. */
  height?: number;
  /**
   * Запасная ширина viewbox — на время до первого замера контейнера.
   * По умолчанию 600. Ширину график берёт из контейнера, а не отсюда.
   */
  width?: number;
  /**
   * Chart-level label format. Used when a series doesn't define its own labelFormat.
   * @param value  - data value at the point
   * @param seriesId - id of the series
   */
  labelFormat?: (value: number, seriesId: string) => string;
}

const DEFAULT_PALETTE = [
  'var(--ou-accent-default)',
  'oklch(0.62 0.18 240)',
  'oklch(0.62 0.15 150)',
  'oklch(0.7 0.16 60)',
];

/**
 * Offset from dot center to the nearest edge of the label text (SVG viewBox units).
 * Dot visual radius = 4 + stroke-half 1 = 5; add 4px gap → 9, round to 10.
 */
const LABEL_OFFSET = 10;
/** Approximate label text height in SVG viewBox units (11px font + leading). */
const LABEL_H = 13;
/** Approximate half-width per character at 11 px font (SVG viewBox units). */
const CHAR_HALF_W = 3.5;

/**
 * Picks the side ('above' | 'below') for a value label so it avoids:
 * 1. The current series' own line (local shape preference).
 * 2. Dots and labels of other series at the same x-index.
 *
 * When a neighbour series also shows a label at this point, doubled clearance is used
 * because both facing labels occupy opposite sides of the gap between the two lines.
 *
 * Falls back to the natural side when both sides are blocked.
 */
function chooseLabelSide(
  allSeries: LineSeries[],
  seriesIdx: number,
  pointIdx: number,
  yAt: (v: number) => number,
  topBound: number,
  bottomBound: number,
): 'above' | 'below' {
  const data = allSeries[seriesIdx].data;
  const v = data[pointIdx];
  const cy = yAt(v);

  const prev = pointIdx > 0 ? data[pointIdx - 1] : v;
  const next = pointIdx < data.length - 1 ? data[pointIdx + 1] : v;
  const natural: 'above' | 'below' = v < (prev + next) / 2 ? 'below' : 'above';

  // Block a side when the label would overflow the plot area.
  let aboveBlocked = cy - LABEL_OFFSET - LABEL_H < topBound;
  let belowBlocked = cy + LABEL_OFFSET + LABEL_H > bottomBound;

  // Cross-series blocking.
  for (let i = 0; i < allSeries.length; i++) {
    if (i === seriesIdx) continue;
    const s2 = allSeries[i];
    const v2 = s2.data[pointIdx];
    if (v2 === undefined) continue;
    const cy2 = yAt(v2);
    const s2HasLabel =
      s2.labels === true ||
      (Array.isArray(s2.labels) && (s2.labels as number[]).includes(pointIdx));

    // When s2 also carries a label at this point, both facing labels consume space on
    // opposite sides of the gap → need 2× clearance to prevent them meeting in the middle.
    const clearance = s2HasLabel
      ? 2 * (LABEL_OFFSET + LABEL_H)
      : LABEL_OFFSET + LABEL_H;

    if (cy2 < cy && cy - cy2 < clearance) aboveBlocked = true;
    if (cy2 > cy && cy2 - cy < clearance) belowBlocked = true;
  }

  if (!aboveBlocked && !belowBlocked) return natural;
  if (aboveBlocked && !belowBlocked) return 'below';
  if (!aboveBlocked && belowBlocked) return 'above';
  return natural;
}

export const LineChart = forwardRef<HTMLDivElement, LineChartProps>(
  ({
    categories, series, yMin, yMax, yTicks = 4,
    height = 240, width: widthFallback = 600,
    hideGrid, showGridX,
    hideXAxis, hideXLabels, hideYAxis, hideYLabels,
    yTickValues, yTickFormat,
    labelFormat: chartLabelFormat,
    className, ...rest
  }, ref) => {
    const [width, attachWrap] = useMeasuredWidth(widthFallback, ref);
    const hasAnyLabels = useMemo(() => series.some(s => !!s.labels), [series]);
    const padding = {
      top:    hasAnyLabels ? 28 : 16,
      right:  24,
      bottom: hasAnyLabels ? 40 : 28,
      left:   36,
    };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const allVals = useMemo(() => series.flatMap(s => s.data), [series]);
    const min = yMin ?? Math.min(0, ...allVals);
    const max = yMax ?? Math.max(...allVals, 1);

    const xStep = innerW / Math.max(1, categories.length - 1);
    const xAt = (i: number) => padding.left + i * xStep;
    const yAt = (v: number) => padding.top + innerH - ((v - min) / (max - min)) * innerH;

    const tickStep = (max - min) / yTicks;
    const ticks = useMemo(
      () => yTickValues ?? Array.from({ length: yTicks + 1 }, (_, i) => min + tickStep * i),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [yTickValues, yTicks, min, max],
    );
    const fmtTick = yTickFormat ?? ((v: number) => String(Math.round(v * 10) / 10));

    const pl = padding.left;
    const pr = width - padding.right;
    const pt = padding.top;
    const pb = pt + innerH;

    return (
      <div ref={attachWrap} className={className} {...rest}>
        <svg className="ou-chart__svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          {/* Horizontal grid lines */}
          {!hideGrid && ticks.map((t, i) => {
            const isBaseline = i === 0;
            if (isBaseline && hideXAxis) return null;
            const isEdge = i === 0 || i === ticks.length - 1;
            return (
              <line key={i}
                className={cn(isEdge ? 'ou-chart__grid-strong' : 'ou-chart__grid')}
                x1={pl} x2={pr} y1={yAt(t)} y2={yAt(t)}
              />
            );
          })}
          {/* Vertical grid lines */}
          {showGridX && categories.map((_, i) => (
            <line key={i} className="ou-chart__grid-x"
              x1={xAt(i)} x2={xAt(i)} y1={pt} y2={pb}
            />
          ))}
          {/* Y-axis line */}
          {!hideYAxis && (
            <line className="ou-chart__axis-line" x1={pl} x2={pl} y1={pt} y2={pb} />
          )}
          {/* Y tick labels */}
          {!hideYAxis && !hideYLabels && (
            <g className="ou-chart__axis-y">
              {ticks.map((t, i) => (
                <text key={i} x={pl - 6} y={yAt(t)} textAnchor="end" dominantBaseline="middle">
                  {fmtTick(t)}
                </text>
              ))}
            </g>
          )}
          {/* X category labels */}
          {!hideXAxis && !hideXLabels && (
            <g className="ou-chart__axis-x">
              {categories.map((c, i) => (
                <text key={i} x={xAt(i)} y={height - padding.bottom + 14} textAnchor="middle">{c}</text>
              ))}
            </g>
          )}
          {/* Series */}
          {series.map((s, si) => {
            const color = s.color ?? DEFAULT_PALETTE[si % DEFAULT_PALETTE.length];
            const path = s.data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(v)}`).join(' ');
            const areaPath = s.area
              ? `${path} L ${xAt(s.data.length - 1)} ${yAt(min)} L ${xAt(0)} ${yAt(min)} Z`
              : null;

            const fmt: ((v: number) => string) | null =
              s.labelFormat
                ? s.labelFormat
                : chartLabelFormat
                  ? (v: number) => chartLabelFormat(v, s.id)
                  : null;

            return (
              <g key={s.id}>
                {areaPath && (
                  <path className="ou-chart__area" d={areaPath} fill={color} />
                )}
                <path className="ou-chart__line" d={path} stroke={color} />
                {s.dots !== false && s.data.map((v, i) => (
                  <circle
                    key={i}
                    className="ou-chart__dot"
                    cx={xAt(i)} cy={yAt(v)} r={4}
                    fill={color}
                  />
                ))}
                {/* Value labels */}
                {s.labels && s.data.map((v, i) => {
                  const show = s.labels === true || (Array.isArray(s.labels) && s.labels.includes(i));
                  if (!show) return null;
                  const text = fmt ? fmt(v) : String(Math.round(v * 10) / 10);

                  let side = chooseLabelSide(
                    series, si, i, yAt, padding.top, padding.top + innerH,
                  );

                  // Approximate half-width of the rendered text.
                  const halfW = text.length * CHAR_HALF_W;

                  // Y-axis tick labels end (textAnchor "end") at x = padding.left - 6.
                  // Use a 2px safety gap so data labels don't touch them horizontally.
                  const yAxisRight = padding.left - 4;
                  const plotRight = width - padding.right;

                  let anchor: 'middle' | 'start' | 'end' = 'middle';
                  let lx = xAt(i);

                  if (lx - halfW < yAxisRight) {
                    // Near the left axis: additionally check if the label would land on the
                    // same y as a tick — if so, try flipping to the other side first.
                    const labelCy = side === 'above'
                      ? yAt(v) - LABEL_OFFSET - LABEL_H / 2
                      : yAt(v) + LABEL_OFFSET + LABEL_H / 2;
                    const collidesWithTick = ticks.some(
                      t => Math.abs(yAt(t) - labelCy) < LABEL_H,
                    );
                    if (collidesWithTick) {
                      const flipped: 'above' | 'below' = side === 'above' ? 'below' : 'above';
                      const flippedFits = flipped === 'above'
                        ? yAt(v) - LABEL_OFFSET - LABEL_H >= padding.top
                        : yAt(v) + LABEL_OFFSET + LABEL_H <= padding.top + innerH;
                      if (flippedFits) side = flipped;
                    }
                    anchor = 'start';
                    lx = yAxisRight + 2;
                  } else if (lx + halfW > plotRight) {
                    anchor = 'end';
                    lx = plotRight - 2;
                  }

                  const ly = side === 'above' ? yAt(v) - LABEL_OFFSET : yAt(v) + LABEL_OFFSET;

                  return (
                    <text
                      key={i}
                      className="ou-chart__label"
                      x={lx}
                      y={ly}
                      textAnchor={anchor}
                      dominantBaseline={side === 'above' ? 'auto' : 'hanging'}
                      fill={color}
                    >
                      {text}
                    </text>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    );
  },
);
LineChart.displayName = 'LineChart';

// ─────────────────────────────────────────────────────────────────────────
// BarChart (single or grouped, vertical)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns 'dark' when background is light enough to require dark text,
 * 'light' (white text) otherwise. Handles `oklch(L C H)` directly; falls
 * back to 'light' for CSS variables and other unparseable formats.
 */
function contrastTone(bgColor: string): 'light' | 'dark' {
  const m = bgColor.match(/oklch\(\s*([\d.]+)/);
  if (m) return parseFloat(m[1]) > 0.6 ? 'dark' : 'light';
  return 'light';
}

export interface BarSeries {
  id: string;
  label?: React.ReactNode;
  data: number[];
  color?: string;
  /**
   * Цвет ОТДЕЛЬНОГО столбика по индексу категории — там, где цвет говорит о самой категории,
   * а не о серии (распределение результатов: ниже порога / у порога / выше). Перекрывает
   * `color`; где элемента нет, столбик остаётся цветом серии.
   */
  colors?: Array<string | undefined>;
  /**
   * Show value labels on bars.
   * - `true` / `'outside'` — above the bar top (or above the segment top for stacked)
   * - `'inside'`           — centered inside the bar segment; falls back to outside when bar is too short
   */
  labels?: boolean | 'outside' | 'inside';
  /** Format function for bar value labels. Overrides chart-level labelFormat. */
  labelFormat?: (value: number) => string;
}

export interface BarChartProps extends React.HTMLAttributes<HTMLDivElement>, ChartAxisProps {
  categories: string[];
  series: BarSeries[];
  yMin?: number;
  yMax?: number;
  /** Кол-во ярлыков на оси Y (плюс верхний/нижний). Игнорируется при yTickValues. */
  yTicks?: number;
  /** Высота SVG в пикселях. По умолчанию 240. Не зависит от ширины окна. */
  height?: number;
  /**
   * Запасная ширина viewbox — на время до первого замера контейнера.
   * По умолчанию 600. Ширину график берёт из контейнера, а не отсюда.
   */
  width?: number;
  /** Стек (вертикальный) или сгруппированные. */
  stacked?: boolean;
  /**
   * Chart-level bar label format. Used when a series doesn't define its own labelFormat.
   * @param value    - data value
   * @param seriesId - id of the series
   */
  labelFormat?: (value: number, seriesId: string) => string;
  /**
   * Вертикальная линия-маркер поперёк области графика: порог, норматив, целевое значение.
   * `position` — доля ширины области построения [0, 1]; линия может стоять ВНУТРИ столбика,
   * а не только на границе между категориями.
   */
  xMarker?: { position: number; label?: React.ReactNode };
}

/** Minimum bar height (px in viewBox) for 'inside' labels to fit. */
const BAR_LABEL_MIN_H = 14;

export const BarChart = forwardRef<HTMLDivElement, BarChartProps>(
  ({
    categories, series, yMin, yMax, yTicks = 4,
    height = 240, width: widthFallback = 600, stacked,
    hideGrid, showGridX,
    hideXAxis, hideXLabels, hideYAxis, hideYLabels,
    yTickValues, yTickFormat,
    labelFormat: chartLabelFormat,
    xMarker,
    className, ...rest
  }, ref) => {
    const [width, attachWrap] = useMeasuredWidth(widthFallback, ref);
    const hasOutsideLabels = series.some(
      s => s.labels === true || s.labels === 'outside',
    );
    const padding = {
      top:    hasOutsideLabels ? 28 : 16,
      right:  24,
      bottom: 28,
      left:   36,
    };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const max = yMax ?? Math.max(
      stacked
        ? Math.max(...categories.map((_, i) => series.reduce((s, ss) => s + (ss.data[i] ?? 0), 0)))
        : Math.max(...series.flatMap(s => s.data)),
      1,
    );
    const min = yMin ?? 0;

    const yAt = (v: number) => padding.top + innerH - ((v - min) / (max - min)) * innerH;
    const groupW = innerW / categories.length;
    const barW = stacked ? groupW * 0.6 : (groupW * 0.7) / series.length;

    const tickStep = (max - min) / yTicks;
    const ticks = useMemo(
      () => yTickValues ?? Array.from({ length: yTicks + 1 }, (_, i) => min + tickStep * i),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [yTickValues, yTicks, min, max],
    );
    const fmtTick = yTickFormat ?? ((v: number) => String(Math.round(v * 10) / 10));

    const pl = padding.left;
    const pr = width - padding.right;
    const pt = padding.top;
    const pb = pt + innerH;

    return (
      <div ref={attachWrap} className={className} {...rest}>
        <svg className="ou-chart__svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          {/* Horizontal grid lines */}
          {!hideGrid && ticks.map((t, i) => {
            const isBaseline = i === 0;
            if (isBaseline && hideXAxis) return null;
            const isEdge = i === 0 || i === ticks.length - 1;
            return (
              <line key={i}
                className={cn(isEdge ? 'ou-chart__grid-strong' : 'ou-chart__grid')}
                x1={pl} x2={pr} y1={yAt(t)} y2={yAt(t)}
              />
            );
          })}
          {/* Vertical grid lines */}
          {showGridX && categories.map((_, i) => (
            <line key={i} className="ou-chart__grid-x"
              x1={pl + groupW * (i + 0.5)} x2={pl + groupW * (i + 0.5)}
              y1={pt} y2={pb}
            />
          ))}
          {/* Marker line (threshold, target) */}
          {xMarker && (() => {
            const x = pl + innerW * Math.min(Math.max(xMarker.position, 0), 1);
            return (
              <g>
                <line className="ou-chart__marker" x1={x} x2={x} y1={pt} y2={pb} />
                {xMarker.label != null && (
                  <text className="ou-chart__marker-label" x={x} y={pt - 4} textAnchor="middle">
                    {xMarker.label}
                  </text>
                )}
              </g>
            );
          })()}
          {/* Marker line (threshold, target) */}
          {xMarker && (() => {
            const x = pl + innerW * Math.min(Math.max(xMarker.position, 0), 1);
            return (
              <g>
                <line className="ou-chart__marker" x1={x} x2={x} y1={pt} y2={pb} />
                {xMarker.label != null && (
                  <text className="ou-chart__marker-label" x={x} y={pt - 4} textAnchor="middle">
                    {xMarker.label}
                  </text>
                )}
              </g>
            );
          })()}
          {/* Y-axis line */}
          {!hideYAxis && (
            <line className="ou-chart__axis-line" x1={pl} x2={pl} y1={pt} y2={pb} />
          )}
          {/* Y tick labels */}
          {!hideYAxis && !hideYLabels && (
            <g className="ou-chart__axis-y">
              {ticks.map((t, i) => (
                <text key={i} x={pl - 6} y={yAt(t)} textAnchor="end" dominantBaseline="middle">
                  {fmtTick(t)}
                </text>
              ))}
            </g>
          )}
          {/* X category labels */}
          {!hideXAxis && !hideXLabels && (
            <g className="ou-chart__axis-x">
              {categories.map((c, i) => (
                <text key={i}
                  x={pl + groupW * (i + 0.5)}
                  y={height - padding.bottom + 14}
                  textAnchor="middle"
                >{c}</text>
              ))}
            </g>
          )}
          {/* Bars — geometry pre-computed so all rects render before all labels,
               preventing upper-segment rects from clipping lower-segment labels. */}
          {(() => {
            type BarItem = {
              key: string;
              rectX: number; rectY: number; rectH: number;
              color: string;
              showLabel: boolean; useInside: boolean;
              labelText: string; labelX: number; labelY: number;
              clampedOut: boolean;
            };
            const items: BarItem[] = [];

            categories.forEach((_, ci) => {
              let stackY = yAt(min);
              series.forEach((s, si) => {
                const color = s.colors?.[ci]
                  ?? s.color
                  ?? DEFAULT_PALETTE[si % DEFAULT_PALETTE.length];
                const v = s.data[ci] ?? 0;
                const fmt = s.labelFormat
                  ? s.labelFormat
                  : chartLabelFormat
                    ? (val: number) => chartLabelFormat(val, s.id)
                    : null;
                const labelText = fmt ? fmt(v) : String(Math.round(v * 10) / 10);
                const showLabel = !!s.labels && v > min;
                const labelMode: 'inside' | 'outside' = s.labels === 'inside' ? 'inside' : 'outside';

                if (stacked) {
                  const prevStackY = stackY;
                  const top = yAt(min + (max - min) * ((stackY - yAt(min)) / -innerH) + v);
                  const x = pl + groupW * ci + (groupW - barW) / 2;
                  const h = prevStackY - top;
                  stackY = top;

                  // In stacked mode labels always live inside their own segment
                  // (outside placement would land inside the adjacent segment — unreadable).
                  // Hide when segment is too short to fit a label.
                  items.push({
                    key: `${si}-${ci}`,
                    rectX: x, rectY: top, rectH: h,
                    color, showLabel: showLabel && h >= BAR_LABEL_MIN_H,
                    useInside: true,
                    labelText,
                    labelX: x + barW / 2,
                    labelY: (top + prevStackY) / 2,
                    clampedOut: false,
                  });
                } else {
                  const xCenter = pl + groupW * (ci + 0.5);
                  const totalWidth = barW * series.length + (series.length - 1) * 4;
                  const x = xCenter - totalWidth / 2 + si * (barW + 4);
                  const y = yAt(v);
                  const h = yAt(min) - y;

                  const useInside = labelMode === 'inside' && h >= BAR_LABEL_MIN_H;
                  const rawOutY = y - 4;
                  const clampedOut = rawOutY < pt + 12;
                  const outY = clampedOut ? pt + 2 : rawOutY;

                  items.push({
                    key: `${si}-${ci}`,
                    rectX: x, rectY: y, rectH: h,
                    color, showLabel, useInside, labelText,
                    labelX: x + barW / 2,
                    labelY: useInside ? (y + yAt(min)) / 2 : outY,
                    clampedOut,
                  });
                }
              });
            });

            return (
              <>
                {items.map(b => (
                  <rect key={`r-${b.key}`} className="ou-chart__bar"
                    x={b.rectX} y={b.rectY} width={barW} height={b.rectH} fill={b.color} />
                ))}
                {items.map(b => {
                  if (!b.showLabel) return null;
                  return b.useInside ? (
                    <text key={`l-${b.key}`}
                      className="ou-chart__bar-label ou-chart__bar-label--inside"
                      x={b.labelX} y={b.labelY}
                      textAnchor="middle" dominantBaseline="middle"
                      fill={b.color} data-tone={contrastTone(b.color)}
                    >{b.labelText}</text>
                  ) : (
                    <text key={`l-${b.key}`}
                      className="ou-chart__bar-label"
                      x={b.labelX} y={b.labelY}
                      textAnchor="middle"
                      dominantBaseline={b.clampedOut ? 'hanging' : 'auto'}
                      fill={b.color} data-tone={b.clampedOut ? contrastTone(b.color) : undefined}
                    >{b.labelText}</text>
                  );
                })}
              </>
            );
          })()}
        </svg>
      </div>
    );
  },
);
BarChart.displayName = 'BarChart';

// ─────────────────────────────────────────────────────────────────────────
// DonutChart — одно целое, разрезанное на доли (живёт под `Charts` темой)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Steps of the accent, handed out by place in the list.
 *
 * A donut shows one whole cut up, and its parts are read in order of size, so
 * a ramp running dark to light runs monotonically around the ring and the
 * picture can be read before the legend is. What each step actually is belongs
 * to the theme: the light end of the light theme's ramp is the dark theme's
 * background.
 *
 * More parts than steps wrap round. Eight parts is already past what a reader
 * holds at once, and the legend carries the names either way.
 */
const RAMP = [
  'var(--ou-ramp-1)',
  'var(--ou-ramp-2)',
  'var(--ou-ramp-3)',
  'var(--ou-ramp-4)',
  'var(--ou-ramp-5)',
  'var(--ou-ramp-6)',
  'var(--ou-ramp-7)',
];

/** Строка легенды: цвет, подпись и значение справа. */
export interface ChartLegendListItem {
  /** Ключ строки. По умолчанию — индекс. */
  id?: string;
  /** Произвольный CSS-цвет метки (или CSS-переменная). */
  color: string;
  label: React.ReactNode;
  /** Текст справа — обычно доля в процентах. */
  value?: React.ReactNode;
}

export interface ChartLegendListProps extends React.HTMLAttributes<HTMLUListElement> {
  items: ChartLegendListItem[];
}

/**
 * Легенда списком: цветная метка, подпись, значение справа.
 *
 * Та же разметка, что у легенды `DonutChart` (`ou-donut__legend`), вынесенная отдельно:
 * легенду без кольца рисуют и рядом с полосой долей, и во всплывающей подсказке.
 */
export const ChartLegendList = forwardRef<HTMLUListElement, ChartLegendListProps>(
  ({ items, className, ...rest }, ref) => (
    <ul ref={ref} className={cn('ou-donut__legend', className)} {...rest}>
      {items.map((item, index) => (
        <li className="ou-donut__legend-item" key={item.id ?? index}>
          <span className={cn('ou-donut__dot', cssStyleClass({ background: item.color }, 'ou-donut-dot'))} />
          <span className="ou-donut__legend-name">{item.label}</span>
          {item.value !== undefined && <span className="ou-donut__legend-value">{item.value}</span>}
        </li>
      ))}
    </ul>
  ),
);
ChartLegendList.displayName = 'ChartLegendList';

export interface DonutSegment {
  /** Ключ строки. По умолчанию — индекс. */
  id?: string;
  value: number;
  label?: React.ReactNode;
  /** Текст справа в строке легенды. По умолчанию — доля в процентах. */
  valueLabel?: React.ReactNode;
  /** Произвольный CSS-цвет. По умолчанию — ступень акцента по месту в списке. */
  color?: string;
}

export interface DonutChartProps extends React.HTMLAttributes<HTMLDivElement> {
  segments: DonutSegment[];
  /** Целое, которому равен полный круг. По умолчанию — сумма долей. */
  total?: number;
  /** Диаметр в пикселях. Высота кольца не зависит от ширины контейнера. */
  size?: number;
  /** Толщина кольца в пикселях. */
  thickness?: number;
  /** Содержимое в центре кольца — обычно `.ou-donut__value` и `.ou-donut__label`. */
  label?: React.ReactNode;
  /** Легенда рядом с кольцом. Без неё кольцу нужен свой `aria-label`. */
  showLegend?: boolean;
}

export const DonutChart = forwardRef<HTMLDivElement, DonutChartProps>(
  ({
    segments, total, size = 180, thickness = 22,
    label, showLegend = true, className, ...rest
  }, ref) => {
    const values = segments.map(s => (Number.isFinite(s.value) ? Math.max(0, s.value) : 0));
    const whole = total ?? values.reduce((sum, value) => sum + value, 0);

    const radius = (size - thickness) / 2;
    const circumference = 2 * Math.PI * radius;

    // Arcs are laid end to end around the ring: each one is a dash of its own
    // length in a gap the size of the whole circle, pushed to where the
    // previous one stopped. Empty parts are dropped rather than drawn - they
    // still belong in the legend, but a zero-length arc on the ring is at best
    // nothing and at worst a dot.
    let travelled = 0;
    const arcs = values.map((value, index) => {
      const length = whole > 0 ? (value / whole) * circumference : 0;
      const arc = { index, length, offset: -travelled };
      travelled += length;
      return arc;
    }).filter(arc => arc.length > 0);

    const colorOf = (index: number) => segments[index].color ?? RAMP[index % RAMP.length];
    const shareOf = (index: number) => (whole > 0 ? values[index] / whole : 0);

    return (
      <div ref={ref} className={cn('ou-donut', className)} {...rest}>
        <div
          className={cn('ou-donut__figure', cssStyleClass({ width: size, height: size }, 'ou-donut-fig'))}
        >
          <svg
            className="ou-donut__svg"
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role={showLegend ? undefined : 'img'}
            aria-hidden={showLegend || undefined}
          >
            <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
              <circle
                className="ou-donut__track"
                cx={size / 2} cy={size / 2} r={radius}
                strokeWidth={thickness}
              />
              {arcs.map(arc => (
                <circle
                  key={segments[arc.index].id ?? arc.index}
                  className="ou-donut__seg"
                  cx={size / 2} cy={size / 2} r={radius}
                  strokeWidth={thickness}
                  stroke={colorOf(arc.index)}
                  strokeDasharray={`${arc.length} ${circumference}`}
                  strokeDashoffset={arc.offset}
                />
              ))}
            </g>
          </svg>
          {label && <div className="ou-donut__center">{label}</div>}
        </div>

        {showLegend && (
          <ChartLegendList
            items={segments.map((segment, index) => ({
              id: segment.id,
              color: colorOf(index),
              label: segment.label,
              value: segment.valueLabel ?? `${Math.round(shareOf(index) * 100)}%`,
            }))}
          />
        )}
      </div>
    );
  },
);
DonutChart.displayName = 'DonutChart';

// ─────────────────────────────────────────────────────────────────────────
// ProgressRing — простой кольцевой индикатор (живёт под `Charts` темой)
// ─────────────────────────────────────────────────────────────────────────

export interface ProgressRingProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0–100
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  /** Текст в центре. */
  label?: React.ReactNode;
}

export const ProgressRing = forwardRef<HTMLDivElement, ProgressRingProps>(
  ({
    value, size = 96, strokeWidth = 8,
    color = 'var(--ou-accent-default)',
    trackColor = 'var(--ou-bg-hover)',
    label, className, style, ...rest
  }, ref) => {
    const r = (size - strokeWidth) / 2;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - Math.max(0, Math.min(100, value)) / 100);
    return (
      <div
        ref={ref}
        className={cn('ou-ring', className, cssStyleClass({
          position: 'relative',
          width: size, height: size,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          ...style,
        }, 'ou-ring-sx'))}
        {...rest}
      >
        <svg className="ou-ring__svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={offset}
            className="ou-ring__fill"
          />
        </svg>
        {label && (
          <div className="ou-ring__center">{label}</div>
        )}
      </div>
    );
  },
);
ProgressRing.displayName = 'ProgressRing';
