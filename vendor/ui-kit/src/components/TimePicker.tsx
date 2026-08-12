import React, {
  forwardRef, useEffect, useId, useImperativeHandle, useRef, useState,
} from 'react';
import { cn } from '../utils';

export interface TimePickerValue {
  hours: number;   // 0-23
  minutes: number; // 0-59
}

export interface TimePickerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  /** Контролируемое значение. */
  value?: TimePickerValue | null;
  defaultValue?: TimePickerValue | null;
  onChange?: (v: TimePickerValue) => void;
  /** Шаг минут (1, 5, 10, 15, 30). */
  step?: number;
  label?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  /** 24-часовой или 12-часовой формат. По умолчанию 24-часовой. */
  hour12?: boolean;
  /** Чипы-пресеты (HH:MM). */
  presets?: string[];
  id?: string;
  name?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (v: TimePickerValue) => `${pad(v.hours)}:${pad(v.minutes)}`;
function fmt12(v: TimePickerValue): string {
  const ampm = v.hours < 12 ? 'AM' : 'PM';
  const h = v.hours === 0 ? 12 : v.hours > 12 ? v.hours - 12 : v.hours;
  return `${h}:${pad(v.minutes)} ${ampm}`;
}
function to24(h12: number, ampm: 'AM' | 'PM'): number {
  if (ampm === 'AM') return h12 === 12 ? 0 : h12;
  return h12 === 12 ? 12 : h12 + 12;
}
function parseTime(s: string): TimePickerValue | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { hours: h, minutes: mi };
}

export const TimePicker = forwardRef<HTMLDivElement, TimePickerProps>(
  ({
    value, defaultValue, onChange,
    step = 15, label, placeholder = '--:--', disabled,
    hour12, presets, id, name, className, ...rest
  }, ref) => {
    const autoId = useId();
    const fieldId = id || `ou-tp-${autoId}`;
    const wrapRef = useRef<HTMLDivElement>(null);
    const hColRef = useRef<HTMLUListElement>(null);
    const mColRef = useRef<HTMLUListElement>(null);
    useImperativeHandle(ref, () => wrapRef.current as HTMLDivElement);

    const controlled = value !== undefined;
    const [internal, setInternal] = useState<TimePickerValue | null>(defaultValue ?? null);
    const current = controlled ? value : internal;

    const [open, setOpen] = useState(false);
    const [focus, setFocus] = useState<'h' | 'm'>('h');
    const currentHours = current?.hours;
    const currentMinutes = current?.minutes;
    const [hh, setHH] = useState<number>(currentHours ?? 9);
    const [mm, setMM] = useState<number>(currentMinutes ?? 0);

    useEffect(() => {
      if (currentHours !== undefined && currentMinutes !== undefined) {
        setHH(currentHours);
        setMM(currentMinutes);
      }
    }, [currentHours, currentMinutes]);

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

    // Scroll active item into view whenever the popup opens or selected value changes.
    useEffect(() => {
      if (!open) return;
      const scrollToActive = (col: HTMLUListElement | null, index: number, cellHeight = 32) => {
        if (!col) return;
        col.scrollTop = index * cellHeight - (col.clientHeight / 2 - cellHeight / 2);
      };
      const hScrollIndex = hour12 ? (hh === 0 ? 11 : hh > 12 ? hh - 13 : hh - 1) : hh;
      scrollToActive(hColRef.current, hScrollIndex);
      const minuteList = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
      scrollToActive(mColRef.current, minuteList.indexOf(mm));
    }, [open, hh, mm, step]);

    const commit = (h: number, m: number) => {
      const next = { hours: h, minutes: m };
      if (!controlled) setInternal(next);
      onChange?.(next);
    };

    const snapMin = (m: number) => step > 1 ? (Math.round(m / step) * step) % 60 : m;

    const bumpSeg = (seg: 'h' | 'm', delta: number) => {
      setFocus(seg);
      if (seg === 'h') {
        const next = (hh + delta + 24) % 24;
        setHH(next); commit(next, mm);
      } else {
        const next = (mm + delta * step + 60) % 60;
        setMM(next); commit(hh, next);
      }
    };

    const bump = (delta: number) => bumpSeg(focus, delta);

    const onKeyDown: React.KeyboardEventHandler = (e) => {
      if (e.key >= '0' && e.key <= '9') {
        const d = Number(e.key);
        if (focus === 'h') {
          const next = ((hh % 10) * 10 + d);
          const v = next <= 23 ? next : d;
          setHH(v); commit(v, mm);
        } else {
          const next = ((mm % 10) * 10 + d);
          const v = next <= 59 ? next : d;
          setMM(v); commit(hh, v);
        }
        e.preventDefault();
      } else if (e.key === 'ArrowUp') { bump(+1); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { bump(-1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { setFocus('h'); e.preventDefault(); }
      else if (e.key === 'ArrowRight' || e.key === ':') { setFocus('m'); e.preventDefault(); }
      else if (e.key === 'Enter') {
        const ms = snapMin(mm); setMM(ms); commit(hh, ms); setOpen(false);
      }
    };

    const isAM = hh < 12;
    const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    const valStr = current ? (hour12 ? fmt12(current) : fmt(current)) : '';

    const hourList = hour12
      ? Array.from({ length: 12 }, (_, i) => i + 1)
      : Array.from({ length: 24 }, (_, i) => i);
    const minuteList = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);

    const triggerSpread = open
      ? { 'aria-expanded': 'true' as const }
      : { 'aria-expanded': 'false' as const };

    const hSegSpread = {
      'aria-valuenow': hh,
      'aria-valuemin': 0,
      'aria-valuemax': 23,
    };

    const mSegSpread = {
      'aria-valuenow': mm,
      'aria-valuemin': 0,
      'aria-valuemax': 59,
    };

    return (
      <div
        ref={wrapRef}
        className={cn('ou-timepicker', className)}
        {...rest}
      >
        {label && <label htmlFor={fieldId} className="ou-timepicker__lbl">{label}</label>}
        <button
          id={fieldId}
          type="button"
          className={cn('ou-timepicker__trigger', disabled && 'is-disabled', open && 'is-open')}
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          aria-haspopup="dialog"
          {...triggerSpread}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className={cn('ou-timepicker__value', !valStr && 'is-empty')}>
            {valStr || placeholder}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
          </svg>
        </button>
        {name !== undefined && <input type="hidden" name={name} value={valStr} />}

        {open && !disabled && (
          <div className="ou-tp" role="dialog" aria-label="Выбор времени">
            <div className="ou-tp__display">
              <div className="ou-tp__seg-wrap">
                <button type="button" className="ou-tp__bump-btn" onClick={() => bumpSeg('h', +1)} aria-label="Увеличить часы">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 15 12 9 18 15" />
                  </svg>
                </button>
                <div
                  className={cn('ou-tp__seg', focus === 'h' && 'is-active')}
                  tabIndex={0} role="spinbutton"
                  aria-label="Часы"
                  onClick={() => setFocus('h')}
                  onFocus={() => setFocus('h')}
                  onKeyDown={onKeyDown}
                  {...hSegSpread}
                >{hour12 ? h12 : pad(hh)}</div>
                <button type="button" className="ou-tp__bump-btn" onClick={() => bumpSeg('h', -1)} aria-label="Уменьшить часы">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <ul ref={hColRef} className="ou-tp__col" role="listbox" aria-label="Часы">
                  {hourList.map(h => {
                    const selected = hour12 ? h === h12 : h === hh;
                    return (
                      <li key={h}
                          role="option"
                          className={cn('ou-tp__cell', selected && 'is-selected')}
                          onClick={() => {
                            const next = hour12 ? to24(h, isAM ? 'AM' : 'PM') : h;
                            setHH(next); commit(next, mm);
                          }}
                          {...(selected ? { 'aria-selected': 'true' as const } : { 'aria-selected': 'false' as const })}
                      >{pad(h)}</li>
                    );
                  })}
                </ul>
              </div>
              <span className="ou-tp__colon" aria-hidden="true">:</span>
              <div className="ou-tp__seg-wrap">
                <button type="button" className="ou-tp__bump-btn" onClick={() => bumpSeg('m', +1)} aria-label="Увеличить минуты">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 15 12 9 18 15" />
                  </svg>
                </button>
                <div
                  className={cn('ou-tp__seg', focus === 'm' && 'is-active')}
                  tabIndex={0} role="spinbutton"
                  aria-label="Минуты"
                  onClick={() => setFocus('m')}
                  onFocus={() => setFocus('m')}
                  onKeyDown={onKeyDown}
                  {...mSegSpread}
                >{pad(mm)}</div>
                <button type="button" className="ou-tp__bump-btn" onClick={() => bumpSeg('m', -1)} aria-label="Уменьшить минуты">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <ul ref={mColRef} className="ou-tp__col" role="listbox" aria-label="Минуты">
                  {minuteList.map(m => (
                    <li key={m}
                        role="option"
                        className={cn('ou-tp__cell', m === mm && 'is-selected')}
                        onClick={() => { setMM(m); commit(hh, m); }}
                        {...(m === mm ? { 'aria-selected': 'true' as const } : { 'aria-selected': 'false' as const })}
                    >{pad(m)}</li>
                  ))}
                </ul>
              </div>
              {hour12 && (
                <div className="ou-tp__ampm">
                  <button
                    type="button"
                    className={cn(isAM && 'is-active')}
                    onClick={() => { const next = to24(h12, 'AM'); setHH(next); commit(next, mm); }}
                  >AM</button>
                  <button
                    type="button"
                    className={cn(!isAM && 'is-active')}
                    onClick={() => { const next = to24(h12, 'PM'); setHH(next); commit(next, mm); }}
                  >PM</button>
                </div>
              )}
            </div>

            {presets && presets.length > 0 && (
              <div className={cn('ou-tp__presets', hour12 ? 'ou-tp__presets--3col' : 'ou-tp__presets--4col')}>
                {presets.map(p => {
                  const pv = parseTime(p);
                  const label = hour12 && pv ? fmt12(pv) : p;
                  return (
                    <button
                      key={p} type="button"
                      className={cn('ou-tp__preset', current && fmt(current) === p && 'is-selected')}
                      onClick={() => {
                        if (pv) { setHH(pv.hours); setMM(pv.minutes); commit(pv.hours, pv.minutes); setOpen(false); }
                      }}
                    >{label}</button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);
TimePicker.displayName = 'TimePicker';
