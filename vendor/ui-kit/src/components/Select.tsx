import React, { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { cn, type Size } from '../utils';

type Tone = 'default' | 'error';

export interface SelectOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  size?: Size;
  tone?: Tone;
  options: SelectOption<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  id?: string;
  name?: string;
}

const ChevronIcon = () => (
  <svg className="ou-select__chev" viewBox="0 0 24 24" width="18" height="18" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function SelectInner<T extends string = string>(
  {
    label, hint, error, size = 'm', tone, options, value, defaultValue, onChange,
    placeholder = 'Выберите…', disabled, fullWidth, id, name, className, ...rest
  }: SelectProps<T>,
  ref: React.Ref<HTMLButtonElement>,
) {
  const autoId = useId();
  const fieldId = id || `ou-select-${autoId}`;
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState<T | undefined>(defaultValue);
  const current = value !== undefined ? value : internal;

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);

  const t: Tone = error ? 'error' : (tone ?? 'default');
  const selected = options.find(o => o.value === current);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSelect = (opt: SelectOption<T>) => {
    if (opt.disabled) return;
    if (value === undefined) setInternal(opt.value);
    onChange?.(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      ref={wrapRef}
      className={cn(
        'ou-select',
        `ou-field--${size}`,
        `ou-field--${t}`,
        fullWidth && 'ou-field--full',
        disabled && 'is-disabled',
        open && 'is-open',
        className,
      )}
      {...rest}
    >
      {label && <label htmlFor={fieldId} className="ou-field__lbl">{label}</label>}
      <button
        ref={triggerRef}
        id={fieldId}
        type="button"
        className="ou-field__box ou-select__trigger"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-invalid={t === 'error' || undefined}
      >
        <span className={cn('ou-select__value', !selected && 'is-placeholder')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronIcon />
      </button>
      {name !== undefined && (
        <input type="hidden" name={name} value={current ?? ''} />
      )}
      {open && !disabled && (
        <ul className="ou-select__menu" role="listbox" aria-labelledby={fieldId}>
          {options.map(o => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === current ? 'true' : 'false'}
              aria-disabled={o.disabled || undefined}
              className={cn(
                'ou-select__opt',
                o.value === current && 'is-selected',
                o.disabled && 'is-disabled',
              )}
              onClick={() => handleSelect(o)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
      {(error || hint) && (
        <div className={`ou-field__msg ou-field__msg--${t}`}>{error || hint}</div>
      )}
    </div>
  );
}

/** UniversityRT · Select (single value). */
export const Select = forwardRef(SelectInner) as <T extends string = string>(
  p: SelectProps<T> & { ref?: React.Ref<HTMLButtonElement> },
) => React.ReactElement;
(Select as unknown as { displayName: string }).displayName = 'Select';
