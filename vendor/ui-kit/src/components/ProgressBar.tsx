import React, { forwardRef } from 'react';
import { cn, cssStyleClass } from '../utils';

export type ProgressSize = 'xs' | 's' | 'm' | 'l';
export type ProgressTone = 'accent' | 'success' | 'warning' | 'error' | 'neutral';
export type ProgressVariant = 'linear' | 'segmented' | 'stacked' | 'indeterminate';

// ─────────────────────────────────────────────────────────────────────────
// ProgressBar (linear + indeterminate + striped)
// ─────────────────────────────────────────────────────────────────────────

export interface ProgressBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 0–100. Игнорируется для `indeterminate`. */
  value?: number;
  max?: number;
  size?: ProgressSize;
  tone?: ProgressTone;
  /** Поверх заливки — диагональные полосы. */
  striped?: boolean;
  indeterminate?: boolean;
  label?: React.ReactNode;
  /** Текст значения справа в шапке. По умолчанию — `${value}%`. */
  valueLabel?: React.ReactNode;
  /** Скрыть заголовок (только полоска). */
  hideHeader?: boolean;
}

export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  ({
    value = 0, max = 100, size = 'm', tone = 'accent',
    striped, indeterminate, label, valueLabel, hideHeader,
    className, ...rest
  }, ref) => {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    return (
      <div
        ref={ref}
        className={cn(
          'ou-progress',
          `ou-progress--${size}`,
          tone !== 'accent' && `ou-progress--${tone}`,
          striped && 'ou-progress--striped',
          indeterminate && 'ou-progress--indeterminate',
          className,
        )}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={typeof label === 'string' ? label : undefined}
        {...rest}
      >
        {!hideHeader && (label || valueLabel !== undefined || (!indeterminate && value !== undefined)) && (
          <div className="ou-progress__head">
            {label && <span className="ou-progress__lbl">{label}</span>}
            {!indeterminate && (
              <span className="ou-progress__val">
                {valueLabel ?? <><strong>{Math.round(pct)}</strong>%</>}
              </span>
            )}
          </div>
        )}
        <div className="ou-progress__track">
          <div
            className={cn(
              'ou-progress__fill',
              cssStyleClass(indeterminate ? undefined : { width: `${pct}%` }, 'ou-progress-fill'),
            )}
          />
        </div>
      </div>
    );
  },
);
ProgressBar.displayName = 'ProgressBar';

// ─────────────────────────────────────────────────────────────────────────
// ProgressSegmented — Wizard / step-progress
// ─────────────────────────────────────────────────────────────────────────

export interface ProgressSegmentedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Сколько шагов. */
  steps: number;
  /** Активный шаг (1-индексный). */
  current: number;
  /** Дробное заполнение текущего шага (0–1). */
  currentPartial?: number;
  size?: ProgressSize;
  tone?: ProgressTone;
  /** Подписи шагов. */
  labels?: React.ReactNode[];
  /** Заголовок над шкалой. */
  label?: React.ReactNode;
}

export const ProgressSegmented = forwardRef<HTMLDivElement, ProgressSegmentedProps>(
  ({
    steps, current, currentPartial, size = 'm', tone = 'accent',
    labels, label, className, ...rest
  }, ref) => (
    <div
      ref={ref}
      className={cn(
        'ou-progress',
        `ou-progress--${size}`,
        tone !== 'accent' && `ou-progress--${tone}`,
        className,
      )}
      {...rest}
    >
      {label && (
        <div className="ou-progress__head">
          <span className="ou-progress__lbl">{label}</span>
          <span className="ou-progress__val">
            <strong>{Math.min(current, steps)}</strong> / {steps}
          </span>
        </div>
      )}
      <div className="ou-progress__segments">
        {Array.from({ length: steps }, (_, i) => {
          const idx = i + 1;
          let cls = 'ou-progress__seg';
          if (idx < current) cls += ' is-filled';
          else if (idx === current && currentPartial !== undefined) cls += ' is-partial';
          else if (idx === current) cls += ' is-filled';
          const partialClass = idx === current && currentPartial !== undefined
            ? cssStyleClass(
              { ['--rem' as string]: `${100 - Math.max(0, Math.min(1, currentPartial)) * 100}%` },
              'ou-progress-partial',
            )
            : undefined;
          return <span key={idx} className={cn(cls, partialClass)} />;
        })}
      </div>
      {labels && (
        <div className="ou-progress__steps">
          {labels.slice(0, steps).map((l, i) => {
            const idx = i + 1;
            const stepCls = idx < current ? 'is-done' : idx === current ? 'is-current' : '';
            return <span key={i} className={cn('ou-progress__step-lbl', stepCls)}>{l}</span>;
          })}
        </div>
      )}
    </div>
  ),
);
ProgressSegmented.displayName = 'ProgressSegmented';

// ─────────────────────────────────────────────────────────────────────────
// ProgressStacked — multi-tone single bar
// ─────────────────────────────────────────────────────────────────────────

export interface ProgressStackedSegment {
  value: number;
  /** Произвольный CSS-цвет (или CSS-переменная). По умолчанию accent. */
  color?: string;
  label?: React.ReactNode;
}

export interface ProgressStackedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  segments: ProgressStackedSegment[];
  max?: number;
  size?: ProgressSize;
  /** Показать легенду под полосой. */
  showLegend?: boolean;
  label?: React.ReactNode;
}

export const ProgressStacked = forwardRef<HTMLDivElement, ProgressStackedProps>(
  ({ segments, max = 100, size = 'm', showLegend, label, className, ...rest }, ref) => {
    const total = segments.reduce((s, c) => s + c.value, 0);
    return (
      <div
        ref={ref}
        className={cn('ou-progress', `ou-progress--${size}`, className)}
        {...rest}
      >
        {label && (
          <div className="ou-progress__head">
            <span className="ou-progress__lbl">{label}</span>
            <span className="ou-progress__val">
              <strong>{total}</strong> / {max}
            </span>
          </div>
        )}
        <div className="ou-progress__stack">
          {segments.map((s, i) => (
            <span
              key={i}
              className={cn('ou-progress__stack-seg', cssStyleClass({
                width: `${(s.value / max) * 100}%`,
                background: s.color ?? 'var(--ou-accent-default)',
              }, 'ou-progress-stack'))}
            />
          ))}
        </div>
        {showLegend && (
          <div className="ou-progress__legend">
            {segments.map((s, i) => (
              <span key={i} className="ou-progress__legend-item">
                <span
                  className={cn(
                    'ou-progress__dot',
                    cssStyleClass({ background: s.color ?? 'var(--ou-accent-default)' }, 'ou-progress-dot'),
                  )}
                />
                {s.label ?? `${s.value}`}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  },
);
ProgressStacked.displayName = 'ProgressStacked';
