import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import { cn, cssStyleClass } from '../utils';

type SliderTone = 'accent' | 'success' | 'warning' | 'error';
export type SliderOrientation = 'horizontal' | 'vertical';

export interface SliderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  min?: number;
  max?: number;
  step?: number;
  /** Контролируемое значение. number — одиночное, [a,b] — диапазон. */
  value?: number | [number, number];
  defaultValue?: number | [number, number];
  onChange?: (v: number | [number, number]) => void;
  /** Диапазонный режим. */
  range?: boolean;
  orientation?: SliderOrientation;
  tone?: SliderTone;
  disabled?: boolean;
  /** Метки на шкале. */
  marks?: number[];
  /** Заголовок над треком. */
  label?: React.ReactNode;
  /** Подпись справа от заголовка (по умолчанию — значение). */
  valueLabel?: React.ReactNode;
  /** Кастомное форматирование значения для лейбла и tooltip. */
  formatValue?: (v: number) => string;
  /** ARIA подпись (если нет label). */
  ariaLabel?: string;
}

export const Slider = forwardRef<HTMLDivElement, SliderProps>(
  ({
    min = 0, max = 100, step = 1,
    value, defaultValue, onChange,
    range, orientation = 'horizontal', tone = 'accent',
    disabled, marks, label, valueLabel, formatValue,
    ariaLabel, className, style, ...rest
  }, ref) => {
    const isRange = !!range;
    const initial = useMemo<[number, number]>(() => {
      const src = value ?? defaultValue ?? (isRange ? [min, max] : min);
      if (Array.isArray(src)) return [src[0], src[1]];
      return [min, src];
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const [internal, setInternal] = useState<[number, number]>(initial);
    const controlled = value !== undefined;
    const current: [number, number] = controlled
      ? (Array.isArray(value) ? value : [min, value as number])
      : internal;

    const railRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => rootRef.current as HTMLDivElement);

    const isH = orientation === 'horizontal';

    const clamp = (v: number) => Math.min(max, Math.max(min, v));
    const snap = (v: number) => clamp(Math.round((v - min) / step) * step + min);
    const pctOf = (v: number) => ((v - min) / (max - min)) * 100;

    const emit = useCallback((next: [number, number]) => {
      if (!controlled) setInternal(next);
      onChange?.(isRange ? next : next[1]);
    }, [controlled, isRange, onChange]);

    const valueFromPointer = (clientX: number, clientY: number) => {
      const rail = railRef.current;
      if (!rail) return 0;
      const r = rail.getBoundingClientRect();
      let raw: number;
      if (isH) raw = (clientX - r.left) / r.width;
      else raw = 1 - (clientY - r.top) / r.height;
      raw = Math.max(0, Math.min(1, raw));
      return snap(min + raw * (max - min));
    };

    const startDrag = (thumbIdx: 0 | 1) => (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);

      const move = (ev: PointerEvent) => {
        const v = valueFromPointer(ev.clientX, ev.clientY);
        if (!isRange) emit([min, v]);
        else {
          const next: [number, number] = [...current] as [number, number];
          next[thumbIdx] = v;
          if (next[0] > next[1]) next.reverse();
          emit([next[0], next[1]]);
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

    const onRailDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
      if (disabled) return;
      if ((e.target as HTMLElement).classList.contains('ou-slider__thumb')) return;
      const v = valueFromPointer(e.clientX, e.clientY);
      if (!isRange) emit([min, v]);
      else {
        const d0 = Math.abs(v - current[0]);
        const d1 = Math.abs(v - current[1]);
        const idx: 0 | 1 = d0 <= d1 ? 0 : 1;
        const next: [number, number] = [...current] as [number, number];
        next[idx] = v;
        if (next[0] > next[1]) next.reverse();
        emit([next[0], next[1]]);
      }
    };

    const onThumbKey = (thumbIdx: 0 | 1): React.KeyboardEventHandler<HTMLDivElement> => (e) => {
      if (disabled) return;
      const deltaKey: Record<string, number> = {
        ArrowRight: +step, ArrowUp: +step, ArrowLeft: -step, ArrowDown: -step,
        Home: -Infinity, End: +Infinity, PageUp: +step * 10, PageDown: -step * 10,
      };
      if (!(e.key in deltaKey)) return;
      e.preventDefault();
      const d = deltaKey[e.key];
      const next: [number, number] = [...current] as [number, number];
      if (d === -Infinity) next[thumbIdx] = min;
      else if (d === +Infinity) next[thumbIdx] = max;
      else next[thumbIdx] = clamp(next[thumbIdx] + d);
      if (isRange && next[0] > next[1]) next.reverse();
      if (!isRange) emit([min, next[1]]);
      else emit([next[0], next[1]]);
    };

    const [a, b] = isRange ? current : [min, current[1]];
    const pa = pctOf(a);
    const pb = pctOf(b);

    const fmt = (v: number) => (formatValue ? formatValue(v) : String(v));
    const sliderName =
      ariaLabel?.trim() ||
      (typeof label === 'string' && label.trim() ? label : 'Значение');

    const fillStyle: React.CSSProperties = isH
      ? { left: `${isRange ? pa : 0}%`, right: `${100 - pb}%` }
      : { top: `${100 - pb}%`, bottom: `${isRange ? pa : 0}%` };

    return (
      <div
        ref={rootRef}
        className={cn(
          'ou-slider',
          isH ? 'ou-slider--h' : 'ou-slider--v',
          tone !== 'accent' && `ou-slider--${tone}`,
          disabled && 'is-disabled',
          className,
          cssStyleClass(style, 'ou-slider-sx'),
        )}
        {...rest}
      >
        {(label || valueLabel !== undefined) && isH && (
          <div className="ou-slider__header">
            {label && <span className="ou-slider__lbl">{label}</span>}
            {valueLabel !== undefined ? (
              <span className="ou-slider__val">{valueLabel}</span>
            ) : (
              <span className="ou-slider__val">
                <strong>
                  {isRange ? `${fmt(a)} — ${fmt(b)}` : fmt(b)}
                </strong>
              </span>
            )}
          </div>
        )}
        <div
          ref={railRef}
          className="ou-slider__rail"
          onPointerDown={onRailDown}
        >
          <div className={cn('ou-slider__fill', cssStyleClass(fillStyle, 'ou-slider-fill'))} />
          {marks && marks.length > 0 && (
            <div className="ou-slider__marks">
              {marks.map(m => {
                const p = pctOf(m);
                const posMark: React.CSSProperties = isH
                  ? { left: `${p}%` } : { top: `${100 - p}%` };
                const posLbl: React.CSSProperties = isH
                  ? { left: `${p}%` } : { top: `${100 - p}%` };
                return (
                  <React.Fragment key={m}>
                    <span className={cn('ou-slider__mark', cssStyleClass(posMark, 'ou-slider-mark'))} />
                    <span className={cn('ou-slider__mark-lbl', cssStyleClass(posLbl, 'ou-slider-mark-label'))}>{m}</span>
                  </React.Fragment>
                );
              })}
            </div>
          )}
          {isRange ? (
            <>
              <div
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-valuemin={min} aria-valuemax={b} aria-valuenow={a}
                aria-orientation={orientation}
                aria-label={`${sliderName} — нижняя граница`}
                className={cn('ou-slider__thumb', cssStyleClass(isH ? { left: `${pa}%` } : { top: `${100 - pa}%` }, 'ou-slider-thumb'))}
                onPointerDown={startDrag(0)}
                onKeyDown={onThumbKey(0)}
              />
              <div
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-valuemin={a} aria-valuemax={max} aria-valuenow={b}
                aria-orientation={orientation}
                aria-label={`${sliderName} — верхняя граница`}
                className={cn('ou-slider__thumb', cssStyleClass(isH ? { left: `${pb}%` } : { top: `${100 - pb}%` }, 'ou-slider-thumb'))}
                onPointerDown={startDrag(1)}
                onKeyDown={onThumbKey(1)}
              />
            </>
          ) : (
            <div
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-valuemin={min} aria-valuemax={max} aria-valuenow={b}
              aria-orientation={orientation}
              aria-label={sliderName}
              className={cn('ou-slider__thumb', cssStyleClass(isH ? { left: `${pb}%` } : { top: `${100 - pb}%` }, 'ou-slider-thumb'))}
              onPointerDown={startDrag(1)}
              onKeyDown={onThumbKey(1)}
            />
          )}
        </div>
      </div>
    );
  },
);
Slider.displayName = 'Slider';
