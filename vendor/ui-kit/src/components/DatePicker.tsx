import React, {
  forwardRef, useEffect, useId, useImperativeHandle, useRef, useState,
} from 'react';
import { cn } from '../utils';
import { Calendar, type CalendarDate, type CalendarMode, calFormatLong } from './Calendar';

export type DatePickerValue =
  | CalendarDate
  | null
  | [CalendarDate, CalendarDate]
  | [CalendarDate]
  | [];

export interface DatePickerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  mode?: CalendarMode;
  value?: DatePickerValue;
  defaultValue?: DatePickerValue;
  onChange?: (value: DatePickerValue) => void;
  label?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  /** Кастомный форматтер значения. */
  formatValue?: (v: DatePickerValue) => string;
  id?: string;
  name?: string;
}

const MONTHS_SHORT_LC = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

function defaultFormat(v: DatePickerValue): string {
  if (!v || (Array.isArray(v) && v.length === 0)) return '';
  if (Array.isArray(v)) {
    if (v.length === 1) return calFormatLong(v[0]);
    const [a, b] = v;
    return `${a.d} ${MONTHS_SHORT_LC[a.m]} → ${b.d} ${MONTHS_SHORT_LC[b.m]} ${b.y}`;
  }
  return calFormatLong(v);
}

export const DatePicker = forwardRef<HTMLDivElement, DatePickerProps>(
  ({
    mode = 'single', value, defaultValue, onChange,
    label, placeholder = 'Выберите дату', disabled,
    formatValue, id, name, className, ...rest
  }, ref) => {
    const autoId = useId();
    const fieldId = id || `ou-dp-${autoId}`;
    const wrapRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => wrapRef.current as HTMLDivElement);

    const controlled = value !== undefined;
    const [internal, setInternal] = useState<DatePickerValue>(defaultValue ?? (mode === 'range' ? [] : null));
    const current = controlled ? value : internal;
    const [open, setOpen] = useState(false);

    const setValue = (next: DatePickerValue) => {
      if (!controlled) setInternal(next);
      onChange?.(next);
    };

    useEffect(() => {
      if (!open) return;
      const onDown = (e: MouseEvent) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [open]);

    const fmt = formatValue || defaultFormat;
    const text = fmt(current);
    const empty = !text;

    const hiddenValue = (() => {
      if (!current || (Array.isArray(current) && current.length === 0)) return '';
      if (Array.isArray(current)) {
        const a = current[0];
        const b = (current as CalendarDate[])[1];
        const s = (p: CalendarDate) => `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
        return b ? `${s(a)}..${s(b)}` : s(a);
      }
      return `${current.y}-${String(current.m + 1).padStart(2, '0')}-${String(current.d).padStart(2, '0')}`;
    })();

    return (
      <div
        ref={wrapRef}
        className={cn('ou-datepicker', className)}
        {...rest}
      >
        {label && <label htmlFor={fieldId} className="ou-datepicker__lbl">{label}</label>}
        <button
          id={fieldId}
          type="button"
          className={cn('ou-datepicker__trigger', disabled && 'is-disabled')}
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          {...(open ? { 'aria-expanded': 'true' as const } : { 'aria-expanded': 'false' as const })}
          aria-haspopup="dialog"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          <span className={cn('ou-datepicker__value', empty && 'is-empty')}>
            {empty ? placeholder : text}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
          </svg>
        </button>
        {name !== undefined && <input type="hidden" name={name} value={hiddenValue} />}
        {open && !disabled && (
          <Calendar
            mode={mode}
            value={current}
            onChange={(v) => {
              setValue(v);
              // Auto-close on single, or on completed range pair.
              if (mode === 'single' && v) setOpen(false);
              if (mode === 'range' && Array.isArray(v) && v.length === 2) setOpen(false);
            }}
            onApply={() => setOpen(false)}
            onReset={() => setValue(mode === 'range' ? [] : null)}
          />
        )}
      </div>
    );
  },
);
DatePicker.displayName = 'DatePicker';
