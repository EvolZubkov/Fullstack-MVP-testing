import React, { forwardRef, useMemo, useState } from 'react';
import { cn, cssStyleClass } from '../utils';

export type CalendarMode = 'single' | 'range';
export type CalendarView = 'days' | 'months' | 'years';

export interface CalendarDate {
  y: number;
  m: number; // 0-indexed
  d: number;
}

export type CalendarValue<M extends CalendarMode = 'single'> =
  M extends 'range' ? [CalendarDate, CalendarDate] | [CalendarDate] | [] : CalendarDate | null;

export interface CalendarProps {
  mode?: CalendarMode;
  /** Контролируемое значение. */
  value?: CalendarDate | null | [CalendarDate, CalendarDate] | [CalendarDate] | [];
  defaultValue?: CalendarDate | null | [CalendarDate, CalendarDate] | [CalendarDate] | [];
  /** Колбэк выбора. Для range — массив длины 0/1/2. */
  onChange?: (
    value: CalendarDate | null | [CalendarDate, CalendarDate] | [CalendarDate] | [],
  ) => void;
  /** Начальный режим отображения. */
  view?: CalendarView;
  /** «Сегодня» — для подсветки. */
  today?: CalendarDate;
  /** Показывать ли быстрые пресеты внизу. */
  presets?: boolean;
  /** Кастомные пресеты. */
  customPresets?: CalendarPreset[];
  /** Заголовок «Применить». */
  applyLabel?: string;
  /** Заголовок «Сбросить». */
  resetLabel?: string;
  /** Колбэк по нажатию «Применить». */
  onApply?: () => void;
  /** Колбэк по нажатию «Сбросить». */
  onReset?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export interface CalendarPreset {
  label: string;
  /** Возвращает дату (single) или диапазон [start,end] (range). */
  resolve: (today: CalendarDate) => CalendarDate | [CalendarDate, CalendarDate];
}

const MONTHS_LONG = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const MONTHS_FULL = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DOW = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

const pad = (n: number) => String(n).padStart(2, '0');
export function calToString(p: CalendarDate): string { return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`; }
export function calParse(s: string): CalendarDate | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
export function calFormatLong(p: CalendarDate): string { return `${p.d} ${MONTHS_LONG[p.m]} ${p.y}`; }
function cmp(a: CalendarDate, b: CalendarDate): number {
  return (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
}
function isSame(a?: CalendarDate | null, b?: CalendarDate | null): boolean {
  return !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
}
function monStart(y: number, m: number): number {
  const wd = new Date(y, m, 1).getDay();
  return (wd + 6) % 7;
}
function daysIn(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}
function dateToCal(d: Date): CalendarDate {
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
}

function defaultPresetsSingle(today: CalendarDate): CalendarPreset[] {
  return [
    { label: 'Сегодня', resolve: t => t },
    { label: 'Завтра',  resolve: t => dateToCal(new Date(t.y, t.m, t.d + 1)) },
    { label: '+1 нед.', resolve: t => dateToCal(new Date(t.y, t.m, t.d + 7)) },
    { label: '+1 мес.', resolve: t => dateToCal(new Date(t.y, t.m + 1, t.d)) },
  ];
}
function defaultPresetsRange(today: CalendarDate): CalendarPreset[] {
  return [
    { label: 'Эта неделя', resolve: t => {
      const end = new Date(t.y, t.m, t.d);
      const start = new Date(end); start.setDate(end.getDate() - 6);
      return [dateToCal(start), dateToCal(end)];
    } },
    { label: 'Этот месяц', resolve: t => [
      { y: t.y, m: t.m, d: 1 },
      { y: t.y, m: t.m, d: daysIn(t.y, t.m) },
    ] },
    { label: 'Квартал', resolve: t => [
      { y: t.y, m: Math.max(0, t.m - 2), d: 1 },
      t,
    ] },
    { label: '90 дней', resolve: t => {
      const end = new Date(t.y, t.m, t.d);
      const start = new Date(end); start.setDate(end.getDate() - 89);
      return [dateToCal(start), dateToCal(end)];
    } },
  ];
}

function normalizeSelected(
  v: CalendarProps['value'], mode: CalendarMode,
): CalendarDate[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v as CalendarDate[];
  return mode === 'single' ? [v] : [];
}

export const Calendar = forwardRef<HTMLDivElement, CalendarProps>(
  ({
    mode = 'single', value, defaultValue, onChange,
    view: viewProp = 'days',
    today: todayProp,
    presets,
    customPresets,
    applyLabel = 'Применить',
    resetLabel = 'Сбросить',
    onApply, onReset,
    className, style,
  }, ref) => {
    const controlled = value !== undefined;
    const [internal, setInternal] = useState<CalendarDate[]>(() =>
      normalizeSelected(defaultValue ?? null, mode),
    );
    const selected = controlled ? normalizeSelected(value, mode) : internal;

    const defaultToday = useMemo(() => dateToCal(new Date()), []);
    const today = todayProp ?? defaultToday;
    const [cursor, setCursor] = useState<{ y: number; m: number }>(() => {
      const s0 = selected[0];
      return s0 ? { y: s0.y, m: s0.m } : { y: today.y, m: today.m };
    });
    const [view, setView] = useState<CalendarView>(viewProp);

    const emit = (next: CalendarDate[]) => {
      if (!controlled) setInternal(next);
      if (mode === 'single') {
        onChange?.(next[0] ?? null);
      } else {
        onChange?.(next as [CalendarDate] | [CalendarDate, CalendarDate] | []);
      }
    };

    const handlePrev = () => {
      if (view === 'days') {
        setCursor(c => {
          const m = c.m - 1;
          return m < 0 ? { y: c.y - 1, m: 11 } : { ...c, m };
        });
      } else if (view === 'months') setCursor(c => ({ ...c, y: c.y - 1 }));
      else setCursor(c => ({ ...c, y: c.y - 12 }));
    };
    const handleNext = () => {
      if (view === 'days') {
        setCursor(c => {
          const m = c.m + 1;
          return m > 11 ? { y: c.y + 1, m: 0 } : { ...c, m };
        });
      } else if (view === 'months') setCursor(c => ({ ...c, y: c.y + 1 }));
      else setCursor(c => ({ ...c, y: c.y + 12 }));
    };

    const selectDay = (p: CalendarDate, isOther: boolean) => {
      if (isOther) setCursor({ y: p.y, m: p.m });
      if (mode === 'single') emit([p]);
      else {
        if (selected.length !== 1) emit([p]);
        else {
          const a = selected[0];
          emit(cmp(p, a) >= 0 ? [a, p] : [p, a]);
        }
      }
    };

    // Build day grid
    const cells: { p: CalendarDate; isOther: boolean }[] = useMemo(() => {
      const result: { p: CalendarDate; isOther: boolean }[] = [];
      const start = monStart(cursor.y, cursor.m);
      const dim = daysIn(cursor.y, cursor.m);
      const pm = cursor.m === 0 ? 11 : cursor.m - 1;
      const py = cursor.m === 0 ? cursor.y - 1 : cursor.y;
      const pdim = daysIn(py, pm);
      for (let i = start; i > 0; i--) result.push({ p: { y: py, m: pm, d: pdim - i + 1 }, isOther: true });
      for (let d = 1; d <= dim; d++) result.push({ p: { y: cursor.y, m: cursor.m, d }, isOther: false });
      const remainder = (7 - (result.length % 7)) % 7;
      const nm = cursor.m === 11 ? 0 : cursor.m + 1;
      const ny = cursor.m === 11 ? cursor.y + 1 : cursor.y;
      for (let d = 1; d <= remainder; d++) result.push({ p: { y: ny, m: nm, d }, isOther: true });
      return result;
    }, [cursor]);

    const showPresets = presets ?? true;
    const presetList = customPresets
      ?? (mode === 'single' ? defaultPresetsSingle(today) : defaultPresetsRange(today));

    const [a, b] = selected;

    return (
      <div ref={ref} className={cn('ou-cal', 'ou-cal--picker', className, cssStyleClass(style, 'ou-cal-sx'))}>
        {/* Header */}
        <div className="ou-cal__head">
          <button
            type="button" className="ou-cal__nav" aria-label="Назад"
            onClick={handlePrev}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="ou-cal__jumps">
            <button
              type="button"
              className={cn('ou-cal__jump', view === 'months' && 'is-active')}
              onClick={() => setView(v => v === 'months' ? 'days' : 'months')}
            >
              {MONTHS_FULL[cursor.m]}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points={view === 'months' ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
              </svg>
            </button>
            <button
              type="button"
              className={cn('ou-cal__jump', view === 'years' && 'is-active')}
              onClick={() => setView(v => v === 'years' ? 'days' : 'years')}
            >
              {cursor.y}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points={view === 'years' ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
              </svg>
            </button>
          </div>
          <button
            type="button" className="ou-cal__nav" aria-label="Вперёд"
            onClick={handleNext}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Days view */}
        {view === 'days' && (
          <>
            {showPresets && (
              <div className="ou-cal__presets">
                {presetList.map(p => (
                  <button
                    key={p.label} type="button" className="ou-cal__preset"
                    onClick={() => {
                      const res = p.resolve(today);
                      const arr = Array.isArray(res) ? res : [res];
                      emit(arr as CalendarDate[]);
                      const focus = (arr[arr.length - 1] as CalendarDate);
                      setCursor({ y: focus.y, m: focus.m });
                    }}
                  >{p.label}</button>
                ))}
              </div>
            )}
            <div className="ou-cal__grid">
              {DOW.map(d => <span key={d} className="ou-cal__dow">{d}</span>)}
              {cells.map(({ p, isOther }, i) => {
                const isToday = isSame(p, today);
                let cls = 'ou-cal__day';
                if (isOther) cls += ' is-other';
                if (isToday) cls += ' is-today';
                if (mode === 'single' && isSame(a, p)) cls += ' is-selected';
                if (mode === 'range') {
                  if (a && b) {
                    if (cmp(p, a) >= 0 && cmp(p, b) <= 0) cls += ' is-in-range';
                    if (isSame(a, p)) cls += ' is-range-start';
                    if (isSame(b, p)) cls += ' is-range-end';
                  } else if (a && isSame(a, p)) {
                    cls += ' is-selected';
                  }
                }
                return (
                  <button
                    key={i} type="button" className={cls}
                    onClick={() => selectDay(p, isOther)}
                  >{p.d}</button>
                );
              })}
            </div>
            <div className="ou-cal__foot">
              <span className="ou-cal__foot-meta">
                {mode === 'range' && a && b ? (
                  <>
                    {a.d} {MONTHS_SHORT[a.m].toLowerCase()} → {b.d} {MONTHS_SHORT[b.m].toLowerCase()}
                    {' '}· <strong className="ou-cal__strong">
                      {Math.round((+new Date(b.y, b.m, b.d) - +new Date(a.y, a.m, a.d)) / 86400000) + 1} дн.
                    </strong>
                  </>
                ) : mode !== 'range' && a ? (
                  <>Выбрано: <strong className="ou-cal__strong">{calFormatLong(a)}</strong></>
                ) : (
                  mode === 'range' ? 'Выберите начало и конец' : 'Ничего не выбрано'
                )}
              </span>
              <span className="ou-cal__actions">
                <button
                  type="button" className="ou-cal__action ou-cal__action--ghost"
                  onClick={() => { emit([]); onReset?.(); }}
                >{resetLabel}</button>
                <button
                  type="button" className="ou-cal__action"
                  onClick={() => onApply?.()}
                >{applyLabel}</button>
              </span>
            </div>
          </>
        )}

        {/* Months view */}
        {view === 'months' && (
          <>
            <div className="ou-cal__pane-label">
              {cursor.y}
            </div>
            <div className="ou-cal__pane">
              {MONTHS_SHORT.map((name, i) => {
                const sel = a && a.y === cursor.y && a.m === i;
                const cur = today.y === cursor.y && today.m === i;
                return (
                  <button
                    key={name} type="button"
                    className={cn('ou-cal__pane-btn', sel && 'is-selected', cur && 'is-current')}
                    onClick={() => { setCursor(c => ({ ...c, m: i })); setView('days'); }}
                  >{name}</button>
                );
              })}
            </div>
          </>
        )}

        {/* Years view */}
        {view === 'years' && (() => {
          const base = Math.floor(cursor.y / 12) * 12;
          return (
            <>
              <div className="ou-cal__pane-label">
                {base} – {base + 11}
              </div>
              <div className="ou-cal__pane">
                {Array.from({ length: 12 }, (_, i) => base + i).map(y => {
                  const sel = a && a.y === y;
                  const cur = today.y === y;
                  return (
                    <button
                      key={y} type="button"
                      className={cn('ou-cal__pane-btn', sel && 'is-selected', cur && 'is-current')}
                      onClick={() => { setCursor(c => ({ ...c, y })); setView('months'); }}
                    >{y}</button>
                  );
                })}
              </div>
            </>
          );
        })()}
      </div>
    );
  },
);
Calendar.displayName = 'Calendar';
