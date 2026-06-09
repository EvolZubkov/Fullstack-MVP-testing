import React, { forwardRef, useId } from 'react';
import { cn, type Size } from '../utils';

type Tone = 'default' | 'error' | 'success';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: Size;
  tone?: Tone;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  clearable?: boolean;
  onClear?: () => void;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({
    label, hint, error, size = 'm', tone, iconLeft, iconRight, prefix, suffix,
    clearable, onClear, fullWidth, id, className, disabled, readOnly, value, ...rest
  }, ref) => {
    const autoId = useId();
    const fieldId = id || `ou-input-${autoId}`;
    const resolvedTone = error ? 'error' : (tone ?? 'default');
    const hasValue = value !== undefined && value !== '';

    return (
      <div className={cn(
        'ou-field',
        `ou-field--${size}`,
        `ou-field--${resolvedTone}`,
        fullWidth && 'ou-field--full',
        disabled && 'is-disabled',
        readOnly && 'is-readonly',
        className,
      )}>
        {label && <label htmlFor={fieldId} className="ou-field__lbl">{label}</label>}
        <div className="ou-field__box">
          {iconLeft && <span className="ou-field__ico">{iconLeft}</span>}
          {prefix && <span className="ou-field__affix">{prefix}</span>}
          <input
            ref={ref}
            id={fieldId}
            className="ou-field__input"
            disabled={disabled}
            readOnly={readOnly}
            value={value}
            aria-invalid={resolvedTone === 'error' || undefined}
            aria-describedby={(error || hint) ? `${fieldId}-msg` : undefined}
            {...rest}
          />
          {clearable && hasValue && !disabled && !readOnly && (
            <button type="button" className="ou-field__clear" aria-label="Очистить" onClick={onClear}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          )}
          {suffix && <span className="ou-field__affix">{suffix}</span>}
          {iconRight && <span className="ou-field__ico">{iconRight}</span>}
        </div>
        {(error || hint) && (
          <div id={`${fieldId}-msg`} className={`ou-field__msg ou-field__msg--${resolvedTone}`}>
            {error || hint}
          </div>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
