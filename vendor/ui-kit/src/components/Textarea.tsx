import React, { forwardRef, useEffect, useId, useImperativeHandle, useRef } from 'react';
import { cn, type Size } from '../utils';

type Tone = 'default' | 'error' | 'warn';

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** Текст ошибки. Если задан — компонент становится в состоянии error. */
  error?: React.ReactNode;
  /** Маркер обязательности «*». */
  required?: boolean;
  /** Маркер «опционально». */
  optional?: boolean;
  size?: Size;
  tone?: Tone;
  /** Лимит для счётчика символов. */
  maxLength?: number;
  /** Показать счётчик: 'footer' — внутри бокса, 'outside' — под боксом, false — нет. */
  showCount?: boolean | 'footer' | 'outside';
  /** Растягиваться по ширине родителя. */
  fullWidth?: boolean;
  /** Авто-рост по содержимому. */
  autosize?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({
    label, hint, error, required, optional, size = 'm', tone,
    maxLength, showCount = false, fullWidth, autosize,
    id, className, value, defaultValue, disabled, readOnly, rows = 3,
    onChange, ...rest
  }, ref) => {
    const autoId = useId();
    const fieldId = id || `ou-textarea-${autoId}`;
    const innerRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

    const t: Tone = error ? 'error' : (tone ?? 'default');
    const [len, setLen] = React.useState<number>(() => {
      const v = value ?? defaultValue ?? '';
      return String(v).length;
    });

    const hasLimit = typeof maxLength === 'number';
    const nearLimit = hasLimit && len >= (maxLength as number) - 10;

    // Autosize
    useEffect(() => {
      if (!autosize) return;
      const el = innerRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }, [autosize, value]);

    const handleChange: React.ChangeEventHandler<HTMLTextAreaElement> = (e) => {
      setLen(e.target.value.length);
      onChange?.(e);
    };

    const counterFooter = showCount === 'footer' || showCount === true;
    const counterOutside = showCount === 'outside';

    return (
      <label
        htmlFor={fieldId}
        className={cn(
          'ou-textarea',
          `ou-textarea--${size}`,
          fullWidth && 'ou-textarea--full',
          t === 'error' && 'ou-textarea--error',
          t === 'warn' && 'ou-textarea--warn',
          nearLimit && 'ou-textarea--limit',
          autosize && 'ou-textarea--autosize',
          disabled && 'is-disabled',
          readOnly && 'is-readonly',
          className,
        )}
      >
        {label && (
          <span className="ou-textarea__lbl">
            {label}
            {required && <span className="ou-textarea__lbl-req"> *</span>}
            {optional && <span className="ou-textarea__lbl-opt"> опционально</span>}
          </span>
        )}
        <div className="ou-textarea__box">
          <textarea
            ref={innerRef}
            id={fieldId}
            className="ou-textarea__input"
            rows={rows}
            maxLength={maxLength}
            value={value}
            defaultValue={defaultValue}
            disabled={disabled}
            readOnly={readOnly}
            aria-invalid={t === 'error' || undefined}
            onChange={handleChange}
            {...rest}
          />
          {counterFooter && (
            <div className="ou-textarea__footer">
              <span />
              <span className="ou-textarea__count">
                <strong>{len}</strong>{hasLimit ? ` / ${maxLength}` : ''}
              </span>
            </div>
          )}
        </div>
        {counterOutside && (
          <span className="ou-textarea__counter">
            <strong>{len}</strong>{hasLimit ? ` / ${maxLength}` : ''}
          </span>
        )}
        {(error || hint) && (
          <span className={cn(
            'ou-textarea__msg',
            t === 'error' && 'ou-textarea__msg--error',
          )}>{error || hint}</span>
        )}
      </label>
    );
  },
);
Textarea.displayName = 'Textarea';
