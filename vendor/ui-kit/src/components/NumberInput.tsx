import React, { forwardRef, useId } from 'react';
import { cn, cssStyleClass, type Size } from '../utils';

export type StepperLayout = 'split' | 'right' | 'inline';

export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange' | 'value' | 'prefix'> {
  /** Текущее значение. Контролируемое поле. */
  value: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: Size;
  layout?: StepperLayout;
  /** Признак pill-варианта (компактные скруглённые края). */
  pill?: boolean;
  label?: React.ReactNode;
  /** Нейтральная подсказка под полем. */
  hint?: React.ReactNode;
  /** Текст ошибки — автоматически переводит поле в состояние ошибки. */
  error?: React.ReactNode;
  /** Единица измерения, например «ч», «%», «дн.». */
  suffix?: React.ReactNode;
  /** Явный флаг ошибки без текста (только рамка). Не нужен, если передан error. */
  invalid?: boolean;
  fullWidth?: boolean;
  /** Ширина внутреннего бокса в px. */
  boxWidth?: number | string;
  /** Подписи для кнопок (a11y). */
  decLabel?: string;
  incLabel?: string;
}

const IconMinus = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M5 12h14" />
  </svg>
);
const IconPlus = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconChevUp = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <polyline points="6 15 12 9 18 15" />
  </svg>
);
const IconChevDown = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({
    value, onChange, min = -Infinity, max = Infinity, step = 1,
    size = 'm', layout = 'split', pill, label, hint, error, suffix,
    disabled, invalid, fullWidth, boxWidth, className, id,
    decLabel = 'Уменьшить', incLabel = 'Увеличить',
    'aria-label': ariaLabel, onBlur, ...rest
  }, ref) => {
    const autoId = useId();
    const fieldId = id || `ou-number-${autoId}`;
    const resolvedInvalid = invalid || !!error;
    const clamp = (v: number) => Math.min(max, Math.max(min, v));
    const set = (v: number) => {
      if (Number.isNaN(v)) return;
      onChange?.(clamp(v));
    };
    const atMin = value <= min;
    const atMax = value >= max;

    return (
      <div className={cn(
        'ou-number',
        `ou-number--${size}`,
        `ou-number--${layout}`,
        pill && 'ou-number--pill',
        fullWidth && 'ou-number--full',
        disabled && 'is-disabled',
        resolvedInvalid && 'is-invalid',
        className,
      )}>
        {label && <label htmlFor={fieldId} className="ou-number__lbl">{label}</label>}
        <div className={cn('ou-number__box', cssStyleClass(boxWidth ? { width: boxWidth } : undefined, 'ou-number-box'))}>
          {layout === 'split' && (
            <button
              type="button" className="ou-number__btn"
              aria-label={decLabel}
              disabled={disabled || atMin}
              onClick={() => set(value - step)}
            ><IconMinus /></button>
          )}
          <input
            ref={ref}
            id={fieldId}
            className="ou-number__input"
            type="text"
            inputMode="numeric"
            value={value}
            aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
            aria-invalid={resolvedInvalid || undefined}
            aria-describedby={(error || hint) ? `${fieldId}-msg` : undefined}
            disabled={disabled}
            onChange={(e) => {
              const n = Number(e.target.value.replace(',', '.'));
              if (!Number.isNaN(n)) set(n);
            }}
            onBlur={(e) => {
              // Re-clamp on blur to ensure value is within bounds.
              const n = Number(e.target.value.replace(',', '.'));
              if (!Number.isNaN(n)) {
                const c = clamp(n);
                if (c !== value) onChange?.(c);
              }
              onBlur?.(e);
            }}
            {...rest}
          />
          {suffix && <span className="ou-number__suffix">{suffix}</span>}
          {layout === 'split' && (
            <button
              type="button" className="ou-number__btn"
              aria-label={incLabel}
              disabled={disabled || atMax}
              onClick={() => set(value + step)}
            ><IconPlus /></button>
          )}
          {layout === 'right' && (
            <span className="ou-number__stack">
              <button
                type="button" className="ou-number__btn ou-number__btn--stack"
                aria-label={incLabel}
                disabled={disabled || atMax}
                onClick={() => set(value + step)}
              ><IconChevUp /></button>
              <button
                type="button" className="ou-number__btn ou-number__btn--stack"
                aria-label={decLabel}
                disabled={disabled || atMin}
                onClick={() => set(value - step)}
              ><IconChevDown /></button>
            </span>
          )}
          {layout === 'inline' && (
            <>
              <button
                type="button" className="ou-number__btn ou-number__btn--ghost"
                aria-label={decLabel}
                disabled={disabled || atMin}
                onClick={() => set(value - step)}
              ><IconMinus /></button>
              <button
                type="button" className="ou-number__btn ou-number__btn--ghost"
                aria-label={incLabel}
                disabled={disabled || atMax}
                onClick={() => set(value + step)}
              ><IconPlus /></button>
            </>
          )}
        </div>
        {(error || hint) && (
          <div id={`${fieldId}-msg`} className={cn('ou-number__hint', !!error && 'ou-number__hint--error')}>
            {error || hint}
          </div>
        )}
      </div>
    );
  },
);
NumberInput.displayName = 'NumberInput';
