/**
 * @module GradientPicker
 * @description Draft-based linear gradient editor panel.
 * Accumulates changes internally and emits the final state only on «Apply».
 * Supports interactive preview handles for repositioning the gradient axis.
 */
import React, {
  forwardRef, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { cn, cssStyleClass } from '../utils';
import { ColorPicker } from './ColorPicker';

export interface GradientStop {
  id: string | number;
  color: string;
  /** 0–100 */
  opacity: number;
  /** 0–100 — position along the gradient axis. */
  position: number;
}

export interface GradientState {
  enabled?: boolean;
  /** Angle in degrees (linear-gradient). */
  angle: number;
  /** Center point 0–100 for free axis positioning. */
  centerX?: number;
  centerY?: number;
  /** Gradient axis length as % of diagonal (10–200). */
  balance?: number;
  stops: GradientStop[];
}

export interface GradientPickerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'title'> {
  /** Currently applied state. */
  value: GradientState;
  /** Popup title. */
  title?: React.ReactNode;
  /** Label next to the title. */
  label?: React.ReactNode;
  /** Confirm changes. */
  onApply?: (state: GradientState) => void;
  /** Cancel / close. */
  onCancel?: () => void;
  /** Live draft notification (optional). */
  onChange?: (state: GradientState) => void;
  /** Hide the footer buttons (control externally). */
  hideFooter?: boolean;
  /** Minimum number of stops (default 2). */
  minStops?: number;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function ensureHex(v: string): string {
  let h = String(v || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#FFFFFF';
  return '#' + h.toUpperCase();
}

function hexToRgba(hex: string, opacityPct: number): string {
  const a = clamp(opacityPct ?? 100, 0, 100) / 100;
  const h = ensureHex(hex).slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function interpolateHex(a: string, b: string, t: number): string {
  const pa = ensureHex(a).slice(1), pb = ensureHex(b).slice(1);
  const mix = (i: number) => {
    const av = parseInt(pa.slice(i, i + 2), 16);
    const bv = parseInt(pb.slice(i, i + 2), 16);
    return Math.round(av + (bv - av) * t);
  };
  const r = mix(0), g = mix(2), bl = mix(4);
  return '#' + [r, g, bl].map(x => x.toString(16).padStart(2, '0').toUpperCase()).join('');
}

export function normalizeStops(stops: GradientStop[]): GradientStop[] {
  return [...(stops || [])]
    .map(s => ({ ...s, position: clamp(Number(s.position) || 0, 0, 100) }))
    .sort((a, b) => a.position - b.position);
}

export function buildGradientCss(state: GradientState | null | undefined): string {
  if (!state || state.enabled === false) return 'transparent';
  const stops = normalizeStops(state.stops)
    .map(s => `${hexToRgba(s.color, s.opacity)} ${s.position}%`).join(', ');
  return `linear-gradient(${state.angle ?? 0}deg, ${stops})`;
}

let _autoId = 0;
const nextId = () => `gp-${++_autoId}-${Date.now()}`;

// ─── Preview with interactive axis handles ────────────────────────────────────

interface HandlePositions { sx: number; sy: number; ex: number; ey: number; }

function computeHandles(w: number, h: number, state: GradientState): HandlePositions {
  const inset = 12;
  const rad = ((state.angle ?? 0) * Math.PI) / 180;
  const base = Math.sqrt(w * w + h * h);
  const half = (base * (state.balance ?? 100)) / 100 / 2;
  const cx = ((state.centerX ?? 50) / 100) * w;
  const cy = ((state.centerY ?? 50) / 100) * h;
  const cl = (v: number, max: number) => clamp(v, inset, max - inset);
  return {
    sx: cl(cx - Math.cos(rad) * half, w),
    sy: cl(cy - Math.sin(rad) * half, h),
    ex: cl(cx + Math.cos(rad) * half, w),
    ey: cl(cy + Math.sin(rad) * half, h),
  };
}

interface GradientPreviewProps {
  draft: GradientState;
  /** Ref kept in sync with draft for non-stale event handler reads. */
  draftRef: React.RefObject<GradientState>;
  css: string;
  onUpdate: (patch: Partial<GradientState>) => void;
}

const GradientPreview: React.FC<GradientPreviewProps> = ({ draft, draftRef, css, onUpdate }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<HandlePositions>({ sx: 0, sy: 0, ex: 0, ey: 0 });

  const refresh = useCallback(() => {
    const w = wrapRef.current?.clientWidth ?? 0;
    const h = wrapRef.current?.clientHeight ?? 0;
    if (w && h) setPos(computeHandles(w, h, draft));
  }, [draft]);

  useEffect(() => { refresh(); }, [refresh]);

  const sorted = normalizeStops(draft.stops);
  const startColor = sorted[0]?.color ?? '#FFFFFF';
  const endColor   = sorted[sorted.length - 1]?.color ?? '#FFFFFF';

  const startDragHandle = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    const base = Math.sqrt(W * W + H * H);

    const onMove = (ev: PointerEvent) => {
      const d = draftRef.current!;
      const mx = clamp(ev.clientX - rect.left, 0, W);
      const my = clamp(ev.clientY - rect.top, 0, H);
      const rad = ((d.angle ?? 0) * Math.PI) / 180;
      const half = (base * (d.balance ?? 100)) / 100 / 2;
      const cx = ((d.centerX ?? 50) / 100) * W;
      const cy = ((d.centerY ?? 50) / 100) * H;
      let sx = cx - Math.cos(rad) * half;
      let sy = cy - Math.sin(rad) * half;
      let ex = cx + Math.cos(rad) * half;
      let ey = cy + Math.sin(rad) * half;
      if (which === 'start') { sx = mx; sy = my; } else { ex = mx; ey = my; }
      const ncx = (sx + ex) / 2, ncy = (sy + ey) / 2;
      const vx = ex - sx, vy = ey - sy;
      const dist = Math.sqrt(vx * vx + vy * vy);
      onUpdate({
        angle:   Math.round(Math.atan2(vy, vx) * 180 / Math.PI),
        balance: Math.round(clamp((dist / base) * 100, 10, 200)),
        centerX: Math.round(clamp((ncx / W) * 100, 0, 100)),
        centerY: Math.round(clamp((ncy / H) * 100, 0, 100)),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startDragCenter = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      onUpdate({
        centerX: Math.round(clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100)),
        centerY: Math.round(clamp(((ev.clientY - rect.top) / rect.height) * 100, 0, 100)),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={wrapRef}
      className="ou-grad__preview"
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest('.ou-grad__handle')) startDragCenter(e);
      }}
    >
      <div className={cn('ou-grad__preview-fill', cssStyleClass({ background: css }, 'ou-grad-bg'))} />
      <svg className="ou-grad__preview-svg" width="100%" height="100%" aria-hidden="true">
        <line
          className="ou-grad__line"
          x1={pos.sx} y1={pos.sy}
          x2={pos.ex} y2={pos.ey}
        />
      </svg>
      <div
        className={cn(
          'ou-grad__handle ou-grad__handle--start',
          cssStyleClass({ left: pos.sx, top: pos.sy, background: startColor }, 'ou-grad-hs'),
        )}
        onPointerDown={startDragHandle('start')}
        aria-hidden="true"
      />
      <div
        className={cn(
          'ou-grad__handle ou-grad__handle--end',
          cssStyleClass({ left: pos.ex, top: pos.ey, background: endColor, borderColor: endColor }, 'ou-grad-he'),
        )}
        onPointerDown={startDragHandle('end')}
        aria-hidden="true"
      />
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const GradientPicker = forwardRef<HTMLDivElement, GradientPickerProps>(
  ({
    value, title = 'Область', label = 'Подложка',
    onApply, onCancel, onChange,
    hideFooter, minStops = 2,
    className, ...rest
  }, ref) => {
    const [draft, setDraft] = useState<GradientState>(() => JSON.parse(JSON.stringify(value)));

    useEffect(() => { setDraft(JSON.parse(JSON.stringify(value))); }, [value]);

    // Always-current ref for drag handlers — no stale closure.
    const draftRef = useRef<GradientState>(draft);
    draftRef.current = draft;

    const update = useCallback((next: Partial<GradientState> | ((d: GradientState) => GradientState)) => {
      setDraft(prev => {
        const updated = typeof next === 'function' ? next(prev) : { ...prev, ...next };
        onChange?.(updated);
        return updated;
      });
    }, [onChange]);

    const setStop = (id: GradientStop['id'], patch: Partial<GradientStop>) => {
      update(d => ({ ...d, stops: d.stops.map(s => s.id === id ? { ...s, ...patch } : s) }));
    };
    const removeStop = (id: GradientStop['id']) => {
      update(d => d.stops.length <= minStops ? d : { ...d, stops: d.stops.filter(s => s.id !== id) });
    };
    const addStop = (position = 50, color = '#FFFFFF') => {
      update(d => ({
        ...d,
        stops: normalizeStops([...d.stops, { id: nextId(), color, opacity: 100, position }]),
      }));
    };

    const barRef = useRef<HTMLDivElement>(null);
    const css = useMemo(() => buildGradientCss(draft), [draft]);

    const onBarDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = Math.round(clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100));
      const sorted = normalizeStops(draft.stops);
      let color = '#FFFFFF';
      for (let i = 0; i < sorted.length - 1; i++) {
        if (pct >= sorted[i].position && pct <= sorted[i + 1].position) {
          const span = sorted[i + 1].position - sorted[i].position;
          const t = span > 0 ? (pct - sorted[i].position) / span : 0;
          color = interpolateHex(sorted[i].color, sorted[i + 1].color, t);
          break;
        }
      }
      addStop(pct, color);
    };

    const startDragPin = (id: GradientStop['id']) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      const onMove = (ev: PointerEvent) => {
        const pct = Math.round(clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100));
        setStop(id, { position: pct });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

    const sortedStops = normalizeStops(draft.stops);

    return (
      <div
        ref={ref}
        className={cn('ou-grad', className)}
        role="dialog"
        aria-label="Редактор градиента"
        {...rest}
      >
        <div className="ou-grad__header">
          <span className="ou-grad__mode">
            <span className="ou-grad__mode-label">{title}:</span> {label}
          </span>
          <button
            type="button" className="ou-grad__close"
            aria-label="Закрыть"
            onClick={() => onCancel?.()}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="ou-grad__body">
          <GradientPreview
            draft={draft}
            draftRef={draftRef}
            css={css}
            onUpdate={(patch) => update(patch)}
          />

          <div className="ou-grad__bar-wrap">
            <div
              ref={barRef}
              className={cn('ou-grad__bar', cssStyleClass({ background: css }, 'ou-grad-bg'))}
              onDoubleClick={onBarDoubleClick}
            >
              {sortedStops.map(stop => (
                <div
                  key={stop.id}
                  className={cn(
                    'ou-grad__pin',
                    cssStyleClass(
                      { left: `calc(${stop.position}% - 8px)`, background: stop.color },
                      'ou-grad-pin',
                    ),
                  )}
                  title={`${stop.color} · ${stop.position}%`}
                  onPointerDown={startDragPin(stop.id)}
                />
              ))}
            </div>
          </div>

          {/* Stops */}
          <div className="ou-grad__section">
            <div className="ou-grad__section-head">
              <span className="ou-grad__section-title">Точки</span>
              <button
                type="button" className="ou-grad__icon-btn"
                aria-label="Добавить точку"
                onClick={() => addStop(50)}
              >+</button>
            </div>
            <div className="ou-grad__stop-label-row">
              <span className="ou-grad__stop-col-label">Позиция</span>
              <span className="ou-grad__stop-col-label">Цвет</span>
              <span className="ou-grad__stop-col-label">Непрозрач.</span>
              <span />
            </div>
            <div className="ou-grad__stop-list">
              {sortedStops.map(stop => (
                <div className="ou-grad__stop-row" key={stop.id}>
                  <SliderCell
                    min={0} max={100} value={stop.position}
                    readout={v => `${v}%`}
                    onInput={v => setStop(stop.id, { position: v })}
                    ariaLabel="Позиция точки"
                  />
                  <StopColorField
                    color={stop.color}
                    onChange={c => setStop(stop.id, { color: c })}
                  />
                  <SliderCell
                    min={0} max={100} value={stop.opacity ?? 100}
                    readout={v => `${v}%`}
                    onInput={v => setStop(stop.id, { opacity: v })}
                    ariaLabel="Непрозрачность точки"
                  />
                  <button
                    type="button"
                    className="ou-grad__icon-btn ou-grad__icon-btn--danger"
                    aria-label="Удалить точку"
                    disabled={draft.stops.length <= minStops}
                    title={draft.stops.length <= minStops ? `Минимум ${minStops} точки` : 'Удалить точку'}
                    onClick={() => removeStop(stop.id)}
                  >−</button>
                </div>
              ))}
            </div>
          </div>

          {/* Geometry */}
          <div className="ou-grad__section">
            <div className="ou-grad__section-head">
              <span className="ou-grad__section-title">Геометрия</span>
            </div>
            <div className="ou-grad__geo-grid">
              <GeoCell
                label="Позиция X" min={0} max={100} unit=""
                value={draft.centerX ?? 50}
                onChange={v => update({ centerX: v })}
              />
              <GeoCell
                label="Позиция Y" min={0} max={100} unit=""
                value={draft.centerY ?? 50}
                onChange={v => update({ centerY: v })}
              />
              <GeoCell
                label="Баланс" min={10} max={200} unit="%"
                slider
                value={draft.balance ?? 100}
                onChange={v => update({ balance: v })}
              />
              <GeoCell
                label="Угол" min={-360} max={360} unit="°"
                value={draft.angle ?? 0}
                onChange={v => update({ angle: v })}
              />
            </div>
          </div>
        </div>

        {!hideFooter && (
          <div className="ou-grad__footer">
            <button
              type="button" className="ou-grad__action"
              onClick={() => onCancel?.()}
            >Отменить</button>
            <button
              type="button" className="ou-grad__action ou-grad__action--primary"
              onClick={() => onApply?.(JSON.parse(JSON.stringify(draft)))}
            >Применить</button>
          </div>
        )}
      </div>
    );
  },
);
GradientPicker.displayName = 'GradientPicker';

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Color cell for a stop row: ColorPicker trigger styled as swatch + hex chip. */
interface StopColorFieldProps {
  color: string;
  onChange: (color: string) => void;
}
const StopColorField: React.FC<StopColorFieldProps> = ({ color, onChange }) => (
  <ColorPicker
    value={color}
    onChange={onChange}
    aria-label="Цвет точки"
    className="ou-grad__stop-color-btn"
    valueLabel={color.replace('#', '').toUpperCase()}
  />
);

interface SliderCellProps {
  min: number; max: number; value: number;
  readout: (v: number) => string;
  onInput: (v: number) => void;
  ariaLabel?: string;
}
const SliderCell: React.FC<SliderCellProps> = ({ min, max, value, readout, onInput, ariaLabel }) => (
  <div className="ou-grad__slider-row">
    <input
      type="range" min={min} max={max} step={1}
      value={value}
      className="ou-grad__slider"
      aria-label={ariaLabel}
      onChange={(e) => onInput(Number(e.target.value))}
    />
    <span className="ou-grad__slider-readout">{readout(Number(value))}</span>
  </div>
);

interface GeoCellProps {
  label: string;
  min: number; max: number; unit: string;
  value: number;
  slider?: boolean;
  onChange: (v: number) => void;
}
const GeoCell: React.FC<GeoCellProps> = ({ label, min, max, unit, value, slider, onChange }) => {
  if (slider) {
    return (
      <div className="ou-grad__geo-cell">
        <label className="ou-grad__geo-label">{label}</label>
        <SliderCell
          min={min} max={max} value={value}
          readout={v => `${v}${unit}`}
          onInput={onChange}
          ariaLabel={label}
        />
      </div>
    );
  }
  return (
    <div className="ou-grad__geo-cell">
      <label className="ou-grad__geo-label">{label}</label>
      <div className="ou-number ou-number--s ou-number--split">
        <div className="ou-number__box ou-number__box--full">
          <button
            type="button" className="ou-number__btn" aria-label={`Уменьшить: ${label}`}
            onClick={() => onChange(clamp(value - 1, min, max))}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M5 12h14" />
            </svg>
          </button>
          <input
            type="number" min={min} max={max} step={1}
            value={value}
            className="ou-number__input ou-number__input--center"
            aria-label={label}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) onChange(clamp(n, min, max));
            }}
          />
          {unit && <span className="ou-number__suffix">{unit}</span>}
          <button
            type="button" className="ou-number__btn" aria-label="Увеличить"
            onClick={() => onChange(clamp(value + 1, min, max))}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

/** Default state for a new gradient. */
export function makeDefaultGradientState(): GradientState {
  return {
    enabled: true,
    angle: 90,
    centerX: 50, centerY: 50, balance: 100,
    stops: [
      { id: nextId(), color: '#9466FF', opacity: 100, position: 0 },
      { id: nextId(), color: '#FF7DCD', opacity: 100, position: 100 },
    ],
  };
}
