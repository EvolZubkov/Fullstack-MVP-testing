import React, {
  forwardRef, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { cn } from '../utils';

/* UniversityRT · Matching — touch-to-connect pair matching.
 *
 * Two equal columns. One side is draggable (configurable). Pairing
 * happens by *physically touching* the draggable card to its target —
 * not by dropping into a labelled slot. Disconnect by pulling ≥ 4px
 * away in any direction.
 *
 * Two visual modes for the column gap:
 *  • `wide`   — dashed arrow connector; goes solid + accent on connect.
 *  • `narrow` — 8px gap, no arrow; on connect the two cards + the gap
 *    fuse into a single panel with a wavy seam marking the join.
 */

export interface MatchingItem {
  id: string;
  text: React.ReactNode;
  secondary?: React.ReactNode;
}

export type MatchingSide = 'l' | 'r';
export type MatchingGap  = 'wide' | 'narrow';
export type MatchingIcon = 'burger' | 'dots' | 'arrows' | 'palm';

export interface MatchingProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  left: MatchingItem[];
  right: MatchingItem[];
  /**
   * Pre-seeded / controlled answer: { draggableId → fixedId }.
   * Keys are the ids from the draggable column (`left` if `side==='l'`).
   * Use the corresponding setter via `onChange`.
   */
  value?: Record<string, string>;
  defaultValue?: Record<string, string>;
  onChange?: (next: Record<string, string>) => void;
  /** Which side is draggable. Default: 'l'. */
  side?: MatchingSide;
  /** Gap visual. Default: 'wide'. */
  gap?: MatchingGap;
  /** Drag-affordance glyph on the draggable card. */
  icon?: MatchingIcon;
  /** Read-only review mode — no drag, semantic row tinting. */
  locked?: boolean;
  /**
   * Correct pairing { draggableId → fixedId }, used together with
   * `locked` to tint each row green/red.
   */
  correct?: Record<string, string>;
}

const TOUCH_EPS_PX = 0;   // gap between bboxes considered "touching"
const DISCONNECT_PX = 4;  // pull distance that breaks an existing pair
const VERT_SNAP_RATIO = 0.6;

/* ── helpers ───────────────────────────────────────────────────── */
function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i === j) return arr;
  const copy = arr.slice();
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

function seedPairs(
  draggable: MatchingItem[],
  fixed: MatchingItem[],
  answer: Record<string, string>,
): { pairs: string[]; connected: boolean[] } {
  const pairs = draggable.map((d) => d.id);
  const connected = fixed.map(() => false);
  Object.entries(answer).forEach(([dragId, fixedId]) => {
    const rowIdx = fixed.findIndex((f) => f.id === fixedId);
    const curPos = pairs.indexOf(dragId);
    if (rowIdx === -1 || curPos === -1) return;
    if (curPos !== rowIdx) {
      [pairs[rowIdx], pairs[curPos]] = [pairs[curPos], pairs[rowIdx]];
    }
    connected[rowIdx] = true;
  });
  return { pairs, connected };
}

function pairsToAnswer(
  pairs: string[],
  connected: boolean[],
  fixed: MatchingItem[],
): Record<string, string> {
  const out: Record<string, string> = {};
  pairs.forEach((dragId, rowIdx) => {
    if (connected[rowIdx]) out[dragId] = fixed[rowIdx].id;
  });
  return out;
}

/* ── component ─────────────────────────────────────────────────── */
export const Matching = forwardRef<HTMLDivElement, MatchingProps>(
  ({
    left, right,
    value, defaultValue, onChange,
    side = 'l', gap = 'wide', icon = 'burger',
    locked = false, correct,
    className, ...rest
  }, ref) => {
    // Draggable side and fixed side, by configuration.
    const drag  = side === 'l' ? left  : right;
    const fixed = side === 'l' ? right : left;

    const isControlled = value !== undefined;
    const seed = useMemo(
      () => seedPairs(drag, fixed, value ?? defaultValue ?? {}),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [drag, fixed],
    );
    const [pairs, setPairs] = useState<string[]>(seed.pairs);
    const [connected, setConnected] = useState<boolean[]>(seed.connected);

    // Re-seed when controlled answer changes externally.
    useEffect(() => {
      if (isControlled) {
        const { pairs: p, connected: c } = seedPairs(drag, fixed, value!);
        setPairs(p);
        setConnected(c);
      }
    }, [isControlled, value, drag, fixed]);

    const commit = useCallback((nextPairs: string[], nextConnected: boolean[]) => {
      setPairs(nextPairs);
      setConnected(nextConnected);
      onChange?.(pairsToAnswer(nextPairs, nextConnected, fixed));
    }, [fixed, onChange]);

    /* ── drag (pointer events) ── */
    const hostRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<{
      rowIdx: number;
      startX: number; startY: number;
      tx: number; ty: number;
      wasConnected: boolean;
      targetRow: number | null;
      cardEl: HTMLElement;
    } | null>(null);
    const [tickTarget, setTickTarget] = useState<number | null>(null);

    const onPointerDown = (e: React.PointerEvent, rowIdx: number) => {
      if (locked) return;
      const card = e.currentTarget as HTMLElement;
      e.preventDefault();
      dragRef.current = {
        rowIdx,
        startX: e.clientX, startY: e.clientY,
        tx: 0, ty: 0,
        wasConnected: connected[rowIdx],
        targetRow: null,
        cardEl: card,
      };
      card.setPointerCapture(e.pointerId);
      card.classList.add('is-dragging');
    };

    const onPointerMove = (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.tx = e.clientX - d.startX;
      d.ty = e.clientY - d.startY;
      d.cardEl.style.transform = `translate(${d.tx}px, ${d.ty}px)`;

      const cur = d.cardEl.getBoundingClientRect();
      const midY = cur.top + cur.height / 2;
      let target: number | null = null;

      const host = hostRef.current;
      if (host) {
        host.querySelectorAll<HTMLElement>('.ou-match__row').forEach((rowEl) => {
          const fixedEl = rowEl.querySelector<HTMLElement>('.ou-match__card--fixed');
          if (!fixedEl) return;
          const fr = fixedEl.getBoundingClientRect();
          if (midY < fr.top || midY > fr.bottom) return;
          const overlapY = Math.min(cur.bottom, fr.bottom) - Math.max(cur.top, fr.top);
          if (overlapY / Math.min(cur.height, fr.height) < VERT_SNAP_RATIO) return;
          const hgap = side === 'l' ? fr.left - cur.right : cur.left - fr.right;
          if (hgap <= TOUCH_EPS_PX) target = Number(rowEl.dataset.row);
        });
      }
      d.targetRow = target;
      setTickTarget(target);
    };

    const onPointerUp = () => {
      const d = dragRef.current;
      if (!d) return;
      const card = d.cardEl;
      card.classList.remove('is-dragging');
      card.style.transform = '';

      const fromRow = d.rowIdx;
      const target = d.targetRow;
      const distFromHome = Math.hypot(d.tx, d.ty);

      let nextPairs = pairs;
      let nextConnected = connected;
      if (target !== null) {
        if (target !== fromRow) {
          nextPairs = swap(pairs, fromRow, target);
          // Swapped-out row's connection is disturbed.
          nextConnected = connected.slice();
          nextConnected[fromRow] = false;
          nextConnected[target] = true;
        } else {
          nextConnected = connected.slice();
          nextConnected[target] = true;
        }
      } else if (d.wasConnected && distFromHome >= DISCONNECT_PX) {
        nextConnected = connected.slice();
        nextConnected[fromRow] = false;
      }

      dragRef.current = null;
      setTickTarget(null);
      if (nextPairs !== pairs || nextConnected !== connected) {
        commit(nextPairs, nextConnected);
      }
    };

    /* ── render ── */
    const fixedById  = useMemo(() => new Map(fixed.map((f) => [f.id, f])), [fixed]);
    const dragById   = useMemo(() => new Map(drag.map((d) => [d.id, d])), [drag]);

    const rowMod = (rowIdx: number, dragId: string): string => {
      if (locked && correct) {
        const expected = correct[dragId];
        if (expected !== undefined) {
          return expected === fixed[rowIdx].id ? 'ou-match__row--correct' : 'ou-match__row--incorrect';
        }
      }
      return '';
    };

    const dragCardFor = (rowIdx: number, dragId: string) => {
      const it = dragById.get(dragId);
      if (!it) return null;
      return (
        <div
          key={`d-${dragId}`}
          className={cn('ou-match__card', 'ou-match__card--drag')}
          data-row={rowIdx}
          data-drag-id={dragId}
          onPointerDown={(e) => onPointerDown(e, rowIdx)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="ou-match__icon" aria-hidden="true" />
          <span className="ou-match__card-text">
            <span className="ou-match__card-title">{it.text}</span>
            {it.secondary && <span className="ou-match__card-secondary">{it.secondary}</span>}
          </span>
        </div>
      );
    };

    const fixedCardFor = (rowIdx: number) => {
      const it = fixed[rowIdx];
      const f = fixedById.get(it.id)!;
      return (
        <div
          key={`f-${it.id}`}
          className={cn('ou-match__card', 'ou-match__card--fixed')}
          data-row={rowIdx}
        >
          <span className="ou-match__card-text">
            <span className="ou-match__card-title">{f.text}</span>
            {f.secondary && <span className="ou-match__card-secondary">{f.secondary}</span>}
          </span>
        </div>
      );
    };

    const gapCellFor = (rowIdx: number) => (
      <div key={`g-${rowIdx}`} className="ou-match__gap" data-row={rowIdx} aria-hidden="true">
        <svg className="ou-match__gap-arrow" viewBox="0 0 28 12">
          <path d="M2 6 L24 6" />
          <path d="M18 1 L26 6 L18 11" />
        </svg>
        <svg className="ou-match__seam" viewBox="0 0 6 48" preserveAspectRatio="none">
          <path d="M3 0 Q0 4 3 8 Q6 12 3 16 Q0 20 3 24 Q6 28 3 32 Q0 36 3 40 Q6 44 3 48" />
        </svg>
      </div>
    );

    return (
      <div
        ref={(node) => {
          hostRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) (ref as { current: HTMLDivElement | null }).current = node;
        }}
        className={cn(
          'ou-match',
          `ou-match--side-${side}`,
          `ou-match--gap-${gap}`,
          `ou-match--icon-${icon}`,
          locked && 'ou-match--locked',
          className,
        )}
        {...rest}
      >
        {pairs.map((dragId, rowIdx) => {
          const cells = side === 'l'
            ? [dragCardFor(rowIdx, dragId), gapCellFor(rowIdx), fixedCardFor(rowIdx)]
            : [fixedCardFor(rowIdx), gapCellFor(rowIdx), dragCardFor(rowIdx, dragId)];
          return (
            <div
              key={rowIdx}
              className={cn(
                'ou-match__row',
                connected[rowIdx] && 'is-connected',
                tickTarget === rowIdx && 'is-target',
                rowMod(rowIdx, dragId),
              )}
              data-row={rowIdx}
            >
              {cells}
            </div>
          );
        })}
      </div>
    );
  },
);
Matching.displayName = 'Matching';
