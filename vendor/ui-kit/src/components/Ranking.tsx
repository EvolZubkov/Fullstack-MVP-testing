import React, {
  forwardRef, useCallback, useMemo, useRef, useState,
} from 'react';
import { cn, cssStyleClass } from '../utils';

/* UniversityRT · Ranking — drag-to-reorder list for test questions.
 *
 * Two answer affordances are always present (drag + ↑/↓ buttons), but
 * the buttons can be hidden via `showControls={false}` if the surrounding
 * UX provides another keyboard path. Numbering, chip shape/color and
 * the optional drag icon are all configurable.
 */

export interface RankingItem {
  /** Stable identity — used as React key and as the value in `value`/`onChange`. */
  id: string;
  /** Primary label. */
  text: React.ReactNode;
  /** Optional secondary line under the title, rendered smaller and muted. */
  secondary?: React.ReactNode;
}

export type RankingChipShape   = 'round' | 'square' | 'pill' | 'plain';
export type RankingChipPalette = 'neutral' | 'accent' | 'accent-solid' | 'custom';
export type RankingIcon        = 'grip' | 'dots' | 'hand' | 'arrows' | 'none';
export type RankingIconSide    = 'left' | 'right';

export interface RankingProps
  extends Omit<React.HTMLAttributes<HTMLOListElement>, 'onChange'> {
  items: RankingItem[];
  /** Controlled order of item ids. Falls back to `items`' natural order. */
  value?: string[];
  /** Initial order for uncontrolled use. Defaults to natural order. */
  defaultValue?: string[];
  onChange?: (nextOrder: string[]) => void;
  /** Show the position chip on each row. Default: true. */
  showNumbers?: boolean;
  /** Show ↑/↓ buttons. Default: true. */
  showControls?: boolean;
  /** Chip silhouette. */
  chipShape?: RankingChipShape;
  /** Chip palette. Pass `'custom'` + `chipColor` for an arbitrary hex. */
  chipPalette?: RankingChipPalette;
  /** Custom chip background; used when `chipPalette === 'custom'`. */
  chipColor?: string;
  /** Optional draggable-affordance icon next to the row text. */
  icon?: RankingIcon;
  /** Side the icon sits on. Default: left. */
  iconSide?: RankingIconSide;
  /** Disable drag + buttons; switches to review styling. */
  locked?: boolean;
  /**
   * Correct order of item ids (only meaningful when `locked`). When
   * provided, each row is tinted as `correct` or `incorrect` and the
   * chip number shows the item's *correct* position rather than its
   * current one — so the sequence of chip numbers itself reveals the
   * pattern of errors (e.g. 1, 2, 4, 3, 5).
   */
  correct?: string[];
}

/* ── icons ─────────────────────────────────────────────────────── */
const Icons: Record<Exclude<RankingIcon, 'none'>, React.ReactNode> = {
  grip: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2.5 5h15"     stroke="currentColor" strokeLinecap="round" />
      <path d="M14.2 10H2.5"  stroke="currentColor" strokeLinecap="round" />
      <path d="M2.5 15h8.3"   stroke="currentColor" strokeLinecap="round" />
    </svg>
  ),
  dots: (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <circle cx="7"  cy="5"  r="1.4" /><circle cx="13" cy="5"  r="1.4" />
      <circle cx="7"  cy="10" r="1.4" /><circle cx="13" cy="10" r="1.4" />
      <circle cx="7"  cy="15" r="1.4" /><circle cx="13" cy="15" r="1.4" />
    </svg>
  ),
  hand: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-1.5-5.5-3L3 14a2 2 0 1 1 3-2l1.5 2" />
    </svg>
  ),
  arrows: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 7l5-4 5 4" /><path d="M12 3v18" /><path d="M7 17l5 4 5-4" />
    </svg>
  ),
};

const CaretUp = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m18 15-6-6-6 6" />
  </svg>
);
const CaretDown = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/* ── helpers ───────────────────────────────────────────────────── */
function moveInArray<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return arr;
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** WCAG luminance — pick black or white as foreground for an arbitrary hex. */
function readableFg(hex: string): string {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const [r, g, b] = v.map((n) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.5 ? '#111111' : '#ffffff';
}

/* ── component ─────────────────────────────────────────────────── */
export const Ranking = forwardRef<HTMLOListElement, RankingProps>(
  ({
    items,
    value, defaultValue, onChange,
    showNumbers = true, showControls = true,
    chipShape = 'square', chipPalette = 'neutral', chipColor,
    icon = 'grip', iconSide = 'left',
    locked = false, correct,
    className, ...rest
  }, ref) => {
    const naturalOrder = useMemo(() => items.map((i) => i.id), [items]);
    const [internal, setInternal] = useState<string[]>(defaultValue ?? naturalOrder);
    const order = value ?? internal;
    const isControlled = value !== undefined;

    const itemMap = useMemo(() => {
      const m = new Map<string, RankingItem>();
      items.forEach((it) => m.set(it.id, it));
      return m;
    }, [items]);

    const commit = useCallback((next: string[]) => {
      if (!isControlled) setInternal(next);
      onChange?.(next);
    }, [isControlled, onChange]);

    const move = useCallback((pos: number, dir: -1 | 1) => {
      const next = pos + dir;
      if (next < 0 || next >= order.length) return;
      commit(moveInArray(order, pos, next));
    }, [order, commit]);

    /* ── drag-and-drop (HTML5 DnD; pointer events would be overkill here) ── */
    const dragFromRef = useRef<number | null>(null);
    const [overPos, setOverPos] = useState<number | null>(null);

    const onDragStart = (e: React.DragEvent<HTMLLIElement>, pos: number) => {
      if (locked) { e.preventDefault(); return; }
      dragFromRef.current = pos;
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(pos));
      } catch { /* Safari */ }
    };
    const onDragOver = (e: React.DragEvent<HTMLLIElement>, pos: number) => {
      if (locked) return;
      e.preventDefault();
      setOverPos(pos);
      try { e.dataTransfer.dropEffect = 'move'; } catch { /* noop */ }
    };
    const onDrop = (e: React.DragEvent<HTMLLIElement>, pos: number) => {
      if (locked) return;
      e.preventDefault();
      const from = dragFromRef.current;
      dragFromRef.current = null;
      setOverPos(null);
      if (from === null || from === pos) return;
      commit(moveInArray(order, from, pos));
    };
    const onDragEnd = () => { dragFromRef.current = null; setOverPos(null); };

    const onKeyDown = (e: React.KeyboardEvent<HTMLLIElement>, pos: number) => {
      if (locked) return;
      if (e.key === 'ArrowUp')   { e.preventDefault(); move(pos, -1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); move(pos, 1); }
    };

    const iconNode = icon !== 'none' ? Icons[icon] : null;
    const correctIndex = (id: string) => correct?.indexOf(id) ?? -1;

    const cols: string[] = [];
    if (showNumbers) cols.push('auto');
    if (iconNode && iconSide === 'left') cols.push('auto');
    cols.push('1fr');
    if (iconNode && iconSide === 'right') cols.push('auto');
    if (showControls && !locked) cols.push('auto');
    const gridStyle: React.CSSProperties = { gridTemplateColumns: cols.join(' ') };

    return (
      <ol
        ref={ref}
        className={cn(
          'ou-rank',
          locked && 'ou-rank--locked',
          !showNumbers && 'ou-rank--no-numbers',
          !showControls && 'ou-rank--no-controls',
          !iconNode && 'ou-rank--no-grip',
          className,
        )}
        aria-label="Ranking"
        {...rest}
      >
        {order.map((id, pos) => {
          const it = itemMap.get(id);
          if (!it) return null;

          // In locked review the chip shows the item's *correct* position.
          const correctPos = correctIndex(id);
          let mod = '';
          let chipLabel = String(pos + 1);
          if (locked && correct) {
            chipLabel = String(correctPos + 1);
            mod = correctPos === pos ? 'ou-rank__item--correct' : 'ou-rank__item--incorrect';
          }

          const chipCls = cn(
            'ou-rank__index',
            `ou-rank__index--${chipShape}`,
            chipPalette !== 'neutral' && chipPalette !== 'custom' && `ou-rank__index--${chipPalette}`,
          );
          const chipStyle: React.CSSProperties | undefined =
            chipPalette === 'custom' && chipColor
              ? ({
                  '--ou-rank-index-bg':     chipColor,
                  '--ou-rank-index-border': chipColor,
                  '--ou-rank-index-fg':     readableFg(chipColor),
                } as React.CSSProperties)
              : undefined;

          return (
            <li
              key={id}
              className={cn('ou-rank__item', mod, overPos === pos && 'is-over', cssStyleClass(gridStyle, 'ou-rank-grid'))}
              data-pos={pos}
              draggable={!locked}
              tabIndex={0}
              onDragStart={(e) => onDragStart(e, pos)}
              onDragOver={(e) => onDragOver(e, pos)}
              onDrop={(e) => onDrop(e, pos)}
              onDragEnd={onDragEnd}
              onKeyDown={(e) => onKeyDown(e, pos)}
            >
              {showNumbers && (
                <span className={cn(chipCls, cssStyleClass(chipStyle, 'ou-rank-chip'))} aria-label={`Позиция ${pos + 1}`}>
                  {chipLabel}
                </span>
              )}
              {iconNode && iconSide === 'left' && (
                <span className="ou-rank__grip" aria-hidden="true">{iconNode}</span>
              )}
              <span className="ou-rank__text">
                <span className="ou-rank__title">{it.text}</span>
                {it.secondary && <span className="ou-rank__secondary">{it.secondary}</span>}
              </span>
              {iconNode && iconSide === 'right' && (
                <span className="ou-rank__grip" aria-hidden="true">{iconNode}</span>
              )}
              {showControls && !locked && (
                <span className="ou-rank__controls">
                  <button
                    type="button"
                    className="ou-rank__btn"
                    aria-label="Переместить вверх"
                    disabled={pos === 0}
                    onClick={() => move(pos, -1)}
                  >{CaretUp}</button>
                  <button
                    type="button"
                    className="ou-rank__btn"
                    aria-label="Переместить вниз"
                    disabled={pos === order.length - 1}
                    onClick={() => move(pos, 1)}
                  >{CaretDown}</button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    );
  },
);
Ranking.displayName = 'Ranking';
