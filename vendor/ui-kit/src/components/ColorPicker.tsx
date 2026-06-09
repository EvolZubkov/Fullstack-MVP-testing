import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import { cn, cssStyleClass } from '../utils';

export type ColorPickerColor = string; // '#RRGGBB' or 'transparent'

const DEFAULT_BASE: string[] = [
  '#7700FF','#A078FF','#5887FF','#29CCA3','#0ACB5B','#FFB608',
  '#FE842D','#FF5E2E','#FF2626','#5F657B','#1D2533','#FFFFFF',
];
const TRANSPARENT = 'transparent';
const STORAGE_KEY = 'ou_custom_colors_v1';

export interface ColorPickerProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  /** Текущий цвет (controlled). */
  value: ColorPickerColor;
  onChange?: (color: ColorPickerColor) => void;
  /** Подпись внутри триггера (по умолчанию HEX). */
  valueLabel?: React.ReactNode;
  /** Триггер без текстового значения, только swatch. */
  iconOnly?: boolean;
  /** Поддержка «Без цвета» (transparent) в палитре. */
  allowTransparent?: boolean;
  /** Базовая палитра (по умолчанию — brand). */
  baseColors?: string[];
  /** Ключ localStorage для своих цветов (false — не хранить). */
  customStorageKey?: string | false;
}

function isTransparent(c?: string) {
  return !c || String(c).toLowerCase() === TRANSPARENT;
}
function normalizeHex(input?: string): string | null {
  if (input == null) return null;
  if (isTransparent(input)) return TRANSPARENT;
  let s = String(input).trim();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s.slice(1).split('').map(ch => ch + ch).join('');
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
  return s.toUpperCase();
}
function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readCustom(key: string | false): string[] {
  if (!key || typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw.filter(Boolean).slice(0, 16) : [];
  } catch { return []; }
}
function writeCustom(key: string | false, arr: string[]) {
  if (!key || typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(arr.slice(0, 16))); } catch { /* noop */ }
}

export const ColorPicker = forwardRef<HTMLButtonElement, ColorPickerProps>(
  ({
    value, onChange, valueLabel, iconOnly, allowTransparent,
    baseColors = DEFAULT_BASE, customStorageKey = STORAGE_KEY,
    className, disabled, 'aria-label': ariaLabel, ...rest
  }, ref) => {
    const triggerRef = useRef<HTMLButtonElement>(null);
    useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);

    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<string>(value);
    const [custom, setCustom] = useState<string[]>(() => readCustom(customStorageKey));
    const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    // Reset draft when opening, position popover.
    useEffect(() => {
      if (!open) return;
      setDraft(value);
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + window.scrollY + 6, left: r.left + window.scrollX });

      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [open, value]);

    // Outside click.
    const popoverRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (!open) return;
      const onDown = (e: MouseEvent) => {
        if (popoverRef.current?.contains(e.target as Node)) return;
        if (triggerRef.current?.contains(e.target as Node)) return;
        setOpen(false);
      };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const triggerIsTransparent = isTransparent(value);
    const draftIsTransparent = isTransparent(draft);
    const [r, g, b] = !draftIsTransparent ? hexToRgb(draft) : [255, 255, 255];

    const apply = () => { onChange?.(draft); setOpen(false); };
    const cancel = () => setOpen(false);
    const addCustom = () => {
      if (isTransparent(draft)) return;
      const next = [draft, ...custom.filter(c => c !== draft)].slice(0, 16);
      setCustom(next);
      writeCustom(customStorageKey, next);
    };

    const Swatch = ({ c }: { c: string }) => {
      const transparent = isTransparent(c);
      const active = (transparent && draftIsTransparent) || c === draft;
      return (
        <button
          type="button"
          className={cn(
            'ou-color-swatch',
            transparent && 'ou-color-swatch--none',
            active && 'is-active',
            cssStyleClass(!transparent ? ({ ['--swatch' as string]: c } as React.CSSProperties) : undefined, 'ou-color-swatch-sx'),
          )}
          title={transparent ? 'Без цвета' : c}
          onClick={() => setDraft(c)}
        />
      );
    };

    const popover = open && !disabled ? (
      <div
        ref={popoverRef}
        className={cn(
          'ou-color-pop',
          cssStyleClass({ position: 'absolute', top: pos.top, left: pos.left, zIndex: 1000 }, 'ou-color-pop-pos'),
        )}
        role="dialog"
        aria-label="Выбор цвета"
      >
        <div className="ou-color-pop__section">
          <div className="ou-color-pop__label">Базовые</div>
          <div className="ou-color-pop__grid">
            {allowTransparent && <Swatch c={TRANSPARENT} />}
            {baseColors.map(c => <Swatch key={c} c={c} />)}
          </div>
        </div>
        <div className="ou-color-pop__section">
          <div className="ou-color-pop__label">Свои цвета</div>
          <div className="ou-color-pop__grid">
            {custom.map(c => <Swatch key={c} c={c} />)}
            {Array.from({ length: Math.max(0, 16 - custom.length) }).map((_, i) => (
              <span key={`e${i}`} className="ou-color-swatch ou-color-swatch--empty" aria-hidden="true" />
            ))}
          </div>
        </div>

        <div className="ou-color-pop__divider" />

        <div className="ou-color-pop__row">
          <label className="ou-color-pop__native" title="Системная палитра" aria-label="Системная палитра">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
              <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
              <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
              <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
            </svg>
            <input
              type="color"
              value={draftIsTransparent ? '#ffffff' : draft}
              onChange={(e) => {
                const n = normalizeHex(e.target.value);
                if (n) setDraft(n);
              }}
            />
          </label>
          <input
            type="text"
            className="ou-color-pop__hex"
            maxLength={9}
            placeholder="#FFFFFF"
            value={draftIsTransparent ? '' : draft}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') return;
              const n = normalizeHex(v);
              if (n) setDraft(n);
            }}
          />
          <button
            type="button" className="ou-color-pop__add"
            aria-label="Добавить в свои цвета"
            title="Добавить в свои цвета"
            onClick={addCustom}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        <div className="ou-color-pop__preview">
          <div
            data-transparent={draftIsTransparent || undefined}
            className={cn(
              'ou-color-pop__preview-swatch',
              cssStyleClass(!draftIsTransparent ? { background: draft } : undefined, 'ou-color-preview'),
            )}
          />
          <div className="ou-color-pop__preview-meta">
            <span className="ou-color-pop__preview-hex">
              {draftIsTransparent ? 'Без цвета' : draft}
            </span>
            <span className="ou-color-pop__preview-rgb">
              {!draftIsTransparent ? `RGB ${r} · ${g} · ${b}` : ''}
            </span>
          </div>
        </div>

        <div className="ou-color-pop__footer">
          <button type="button" className="ou-btn ou-btn--ghost ou-btn--s" onClick={cancel}>Отмена</button>
          <button type="button" className="ou-btn ou-btn--primary ou-btn--s" onClick={apply}>Применить</button>
        </div>
      </div>
    ) : null;

    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            'ou-color-trigger',
            iconOnly && 'ou-color-trigger--icon',
            className,
          )}
          aria-haspopup="dialog"
          {...(open ? { 'aria-expanded': 'true' as const } : { 'aria-expanded': 'false' as const })}
          aria-label={ariaLabel || (iconOnly ? 'Выбрать цвет' : undefined)}
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          {...rest}
        >
          <span
            className={cn(
              'ou-color-trigger__swatch',
              cssStyleClass(
                !triggerIsTransparent ? ({ ['--swatch' as string]: value } as React.CSSProperties) : undefined,
                'ou-color-trigger-sx',
              ),
            )}
            data-transparent={triggerIsTransparent || undefined}
          />
          {!iconOnly && (
            <span className="ou-color-trigger__value">
              {valueLabel ?? (triggerIsTransparent ? 'Без цвета' : value)}
            </span>
          )}
        </button>
        {popover}
      </>
    );
  },
);
ColorPicker.displayName = 'ColorPicker';

// Re-export internals for sharing with GradientPicker.
export const _colorPickerInternals = {
  normalizeHex,
  isTransparent,
  hexToRgb,
  DEFAULT_BASE,
  STORAGE_KEY,
};
