import React, { forwardRef, useId, useState } from 'react';
import { cn, type Size } from '../utils';

type Tone = 'default' | 'error' | 'success';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
  label?: string;
  /** Renders the red required marker «*» next to the label (DS convention). */
  required?: boolean;
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
  /** Password field with a built-in show/hide eye toggle (replaces a bespoke
   *  PasswordInput). Forces `type` between `password`/`text`. */
  revealToggle?: boolean;
}

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </svg>
);

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({
    label, required, hint, error, size = 'm', tone, iconLeft, iconRight, prefix, suffix,
    clearable, onClear, fullWidth, id, className, disabled, readOnly, value, revealToggle, type, ...rest
  }, ref) => {
    const autoId = useId();
    const fieldId = id || `ou-input-${autoId}`;
    const resolvedTone = error ? 'error' : (tone ?? 'default');
    const hasValue = value !== undefined && value !== '';
    const [revealed, setRevealed] = useState(false);
    const resolvedType = revealToggle ? (revealed ? 'text' : 'password') : type;

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
        {label && (
          <label htmlFor={fieldId} className="ou-field__lbl">
            {label}
            {required && <span className="ou-field__lbl-req"> *</span>}
          </label>
        )}
        <div className="ou-field__box">
          {iconLeft && <span className="ou-field__ico">{iconLeft}</span>}
          {prefix && <span className="ou-field__affix">{prefix}</span>}
          <input
            ref={ref}
            id={fieldId}
            className="ou-field__input"
            type={resolvedType}
            disabled={disabled}
            readOnly={readOnly}
            value={value}
            aria-invalid={resolvedTone === 'error' || undefined}
            aria-describedby={(error || hint) ? `${fieldId}-msg` : undefined}
            {...rest}
          />
          {revealToggle && !disabled && (
            <button
              type="button"
              className="ou-field__reveal"
              aria-label={revealed ? 'Скрыть пароль' : 'Показать пароль'}
              tabIndex={-1}
              onClick={() => setRevealed(v => !v)}
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
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
