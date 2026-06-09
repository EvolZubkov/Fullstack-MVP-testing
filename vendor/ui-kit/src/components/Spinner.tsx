import React, { forwardRef } from 'react';
import { cn } from '../utils';

export type SpinnerSize = 'xs' | 's' | 'm' | 'l';
export type SpinnerTone = 'accent' | 'neutral' | 'on-accent' | 'on-dark';

export interface SpinnerProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  /** Дополнительный текст рядом со спиннером. */
  label?: React.ReactNode;
  /** Текст для screen reader (если нет visible label). */
  ariaLabel?: string;
  /** Рендерить как inline (без gap-обёртки). */
  inline?: boolean;
}

export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(
  ({
    size = 'm', tone = 'accent', label, ariaLabel = 'Загрузка',
    inline, className, ...rest
  }, ref) => {
    const spinnerSvg = (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="ou-spinner__track" cx="12" cy="12" r="10" />
        <circle className="ou-spinner__head" cx="12" cy="12" r="10" />
      </svg>
    );
    if (!label) {
      return (
        <span
          ref={ref}
          className={cn('ou-spinner', `ou-spinner--${size}`, `ou-spinner--${tone}`, className)}
          role="status"
          aria-label={ariaLabel}
          {...rest}
        >{spinnerSvg}</span>
      );
    }
    return (
      <span
        ref={ref}
        className={cn('ou-spinner-wrap', inline && 'is-inline', className)}
        role="status"
        aria-label={typeof label === 'string' ? label : ariaLabel}
        {...rest}
      >
        <span className={cn('ou-spinner', `ou-spinner--${size}`, `ou-spinner--${tone}`)}>
          {spinnerSvg}
        </span>
        <span className="ou-spinner__label">{label}</span>
      </span>
    );
  },
);
Spinner.displayName = 'Spinner';

// ─────────────────────────────────────────────────────────────────────────
// SpinnerDots — три точки
// ─────────────────────────────────────────────────────────────────────────

export interface SpinnerDotsProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  size?: 's' | 'm';
  tone?: SpinnerTone;
  ariaLabel?: string;
}
export const SpinnerDots = forwardRef<HTMLSpanElement, SpinnerDotsProps>(
  ({ size = 'm', tone = 'accent', ariaLabel = 'Загрузка', className, ...rest }, ref) => (
    <span
      ref={ref}
      className={cn(
        'ou-spinner-dots',
        `ou-spinner-dots--${size}`,
        `ou-spinner-dots--${tone}`,
        className,
      )}
      role="status"
      aria-label={ariaLabel}
      {...rest}
    >
      <span /><span /><span />
    </span>
  ),
);
SpinnerDots.displayName = 'SpinnerDots';

// ─────────────────────────────────────────────────────────────────────────
// SpinnerOverlay — поверх контента
// ─────────────────────────────────────────────────────────────────────────

export interface SpinnerOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  label?: React.ReactNode;
}
export const SpinnerOverlay = forwardRef<HTMLDivElement, SpinnerOverlayProps>(
  ({ size = 'l', tone = 'accent', label, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('ou-spinner-overlay', className)}
      {...rest}
    >
      <Spinner size={size} tone={tone} label={label} />
    </div>
  ),
);
SpinnerOverlay.displayName = 'SpinnerOverlay';
