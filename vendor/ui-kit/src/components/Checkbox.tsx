import React, { forwardRef, useId } from 'react';
import { cn, type Size } from '../utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  descriptionVariant?: 'error';
  size?: Size;
  indeterminate?: boolean;
  invalid?: boolean;
  card?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, descriptionVariant, size = 'm', indeterminate, invalid, card, className, id, disabled, ...rest }, ref) => {
    const autoId = useId();
    const inputId = id || `ou-check-${autoId}`;
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    React.useImperativeHandle(ref, () => inputRef.current!);
    React.useEffect(() => {
      if (inputRef.current) inputRef.current.indeterminate = !!indeterminate;
    }, [indeterminate]);

    return (
      <label htmlFor={inputId} className={cn(
        'ou-check',
        size !== 'm' && `ou-check--${size}`,
        invalid && 'is-invalid',
        disabled && 'is-disabled',
        card && 'ou-check--card',
        className,
      )}>
        <input
          ref={inputRef}
          id={inputId}
          type="checkbox"
          className="ou-check__input"
          disabled={disabled}
          {...rest}
        />
        <span className="ou-check__box">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6.2l2 2 4-5" />
          </svg>
        </span>
        {(label || description) && (
          <span className="ou-check__text">
            {label && <span className="ou-check__lbl">{label}</span>}
            {description && <span className={cn('ou-check__desc', descriptionVariant === 'error' && 'ou-check__desc--error')}>{description}</span>}
          </span>
        )}
      </label>
    );
  },
);
Checkbox.displayName = 'Checkbox';
