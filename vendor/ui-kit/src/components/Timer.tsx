import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { cn, cssStyleClass } from '../utils';

export type TimerVariant = 'digital' | 'bar' | 'ring' | 'pill' | 'header';
export type TimerSize = 's' | 'm' | 'l' | 'xl';
export type TimerStatus = 'running' | 'warning' | 'critical' | 'paused' | 'finished';

export interface TimerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Текущее значение в секундах. */
  seconds: number;
  /** Общее значение (для прогресса). Если не задано — берётся `Math.max(seconds, 1)`. */
  totalSeconds?: number;
  variant?: TimerVariant;
  size?: TimerSize;
  /** Принудительный статус (иначе вычисляется из процента остатка). */
  status?: TimerStatus;
  /** Подпись над/рядом. */
  label?: React.ReactNode;
  /** Доп. описание (под цифрами). */
  meta?: React.ReactNode;
  /** Кастомный формат значения. По умолчанию — MM:SS (или HH:MM:SS если total >= 3600). */
  formatValue?: (sec: number) => string;
  /** Иконка для pill/header вариантов. */
  icon?: React.ReactNode;
  /** Порог warning (% оставшегося). По умолчанию 30%. */
  warningThreshold?: number;
  /** Порог critical (% оставшегося). По умолчанию 10%. */
  criticalThreshold?: number;
  /** aria-live politeness for screen-reader announcements. Default: 'off'. */
  ariaLive?: 'off' | 'polite' | 'assertive';
}

export function formatHMS(sec: number, withHours?: boolean): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (withHours || h > 0) return `${pad(h)}:${pad(m)}:${pad(ss)}`;
  return `${pad(m)}:${pad(ss)}`;
}

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const Timer = forwardRef<HTMLDivElement, TimerProps>(
  ({
    seconds, totalSeconds, variant = 'digital', size = 'm',
    status, label, meta, formatValue, icon, className,
    warningThreshold = 30, criticalThreshold = 10,
    ariaLive = 'off',
    ...rest
  }, ref) => {
    const total = totalSeconds ?? Math.max(seconds, 1);
    const pctLeft = (Math.max(0, seconds) / total) * 100;
    const computedStatus: TimerStatus =
      status
      ?? (seconds <= 0 ? 'finished'
        : pctLeft <= criticalThreshold ? 'critical'
        : pctLeft <= warningThreshold ? 'warning'
        : 'running');

    const fmt = formatValue ?? ((s: number) => formatHMS(s, total >= 3600));
    const valueStr = fmt(Math.max(0, seconds));

    const statusClass =
      computedStatus === 'warning' ? 'is-warning'
      : computedStatus === 'critical' ? 'is-critical'
      : computedStatus === 'paused' ? 'is-paused'
      : computedStatus === 'finished' ? 'is-finished'
      : '';

    const baseClass = cn(
      'ou-timer',
      `ou-timer--${variant}`,
      `ou-timer--${size}`,
      statusClass,
      className,
    );

    // Ring variant — compute SVG geometry.
    if (variant === 'ring') {
      // The CSS sets --ring-size; we mirror the sizes here for SVG geometry.
      const sizePx = size === 's' ? 64 : size === 'l' ? 144 : size === 'xl' ? 200 : 96;
      const stroke = size === 's' ? 6 : size === 'l' ? 10 : size === 'xl' ? 14 : 8;
      const r = (sizePx - stroke) / 2;
      const c = 2 * Math.PI * r;
      const offset = c * (1 - pctLeft / 100);
      return (
        <div ref={ref} className={baseClass} role="timer" aria-label={typeof label === 'string' ? label : undefined} {...{ 'aria-live': ariaLive }} {...rest}>
          <svg viewBox={`0 0 ${sizePx} ${sizePx}`}>
            <circle className="ou-timer__ring-track" cx={sizePx / 2} cy={sizePx / 2} r={r} />
            <circle
              className="ou-timer__ring-fill"
              cx={sizePx / 2} cy={sizePx / 2} r={r}
              strokeDasharray={c}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="ou-timer__center">
            <span className="ou-timer__num">{valueStr}</span>
            {label && <span className="ou-timer__lbl">{label}</span>}
          </div>
        </div>
      );
    }

    if (variant === 'bar') {
      return (
        <div ref={ref} className={baseClass} role="timer" {...{ 'aria-live': ariaLive }} {...rest}>
          {(label || true) && (
            <div className="ou-timer__head">
              {label && <span className="ou-timer__lbl">{label}</span>}
              <span className="ou-timer__num">{valueStr}</span>
            </div>
          )}
          <div className="ou-timer__track">
            <div className={cn('ou-timer__fill', cssStyleClass({ width: `${pctLeft}%` }, 'ou-timer-fill'))} />
          </div>
          {meta && <span className="ou-timer__meta">{meta}</span>}
        </div>
      );
    }

    if (variant === 'pill') {
      return (
        <span ref={ref as unknown as React.Ref<HTMLSpanElement>} className={baseClass} role="timer" {...{ 'aria-live': ariaLive }} {...rest as unknown as React.HTMLAttributes<HTMLSpanElement>}>
          {icon ?? <ClockIcon />}
          <span className="ou-timer__num">{valueStr}</span>
          {label && <span className="ou-timer__lbl">{label}</span>}
        </span>
      );
    }

    if (variant === 'header') {
      return (
        <div ref={ref} className={baseClass} role="timer" {...{ 'aria-live': ariaLive }} {...rest}>
          <span className="ou-timer__head-ico">{icon ?? <ClockIcon />}</span>
          <div className="ou-timer__head-text">
            {label && <span className="ou-timer__lbl">{label}</span>}
            <span className="ou-timer__num">{valueStr}</span>
            {meta && <span className="ou-timer__meta">{meta}</span>}
          </div>
        </div>
      );
    }

    // digital
    return (
      <div ref={ref} className={baseClass} role="timer" {...{ 'aria-live': ariaLive }} {...rest}>
        {label && <span className="ou-timer__lbl">{label}</span>}
        <span className="ou-timer__num">{valueStr}</span>
        {meta && <span className="ou-timer__meta">{meta}</span>}
      </div>
    );
  },
);
Timer.displayName = 'Timer';

// ─────────────────────────────────────────────────────────────────────────
// useCountdown — helper hook for running countdown timers
// ─────────────────────────────────────────────────────────────────────────

export interface UseCountdownOptions {
  totalSeconds: number;
  /** Стартовать сразу. По умолчанию true. */
  autostart?: boolean;
  /** Колбэк когда добегает до 0. */
  onFinish?: () => void;
  /** Интервал тика, ms. По умолчанию 1000. */
  intervalMs?: number;
}

export interface UseCountdownResult {
  seconds: number;
  isRunning: boolean;
  start: () => void;
  pause: () => void;
  reset: (toSeconds?: number) => void;
}

export function useCountdown({
  totalSeconds, autostart = true, onFinish, intervalMs = 1000,
}: UseCountdownOptions): UseCountdownResult {
  const [seconds, setSeconds] = useState<number>(totalSeconds);
  const [running, setRunning] = useState<boolean>(autostart);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!running) return;
    finishedRef.current = false;
    const id = window.setInterval(() => {
      setSeconds(s => {
        if (s <= 1) {
          setRunning(false);
          if (!finishedRef.current) {
            finishedRef.current = true;
            onFinish?.();
          }
          return 0;
        }
        return s - 1;
      });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [running, intervalMs, onFinish]);

  return {
    seconds,
    isRunning: running,
    start: () => { if (seconds > 0) setRunning(true); },
    pause: () => setRunning(false),
    reset: (to?: number) => { setSeconds(to ?? totalSeconds); setRunning(autostart); finishedRef.current = false; },
  };
}
