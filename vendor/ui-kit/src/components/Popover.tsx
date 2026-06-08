import React, {
  forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn, cssStyleClass } from '../utils';

export type PopoverPlacement = 'top' | 'bottom' | 'left' | 'right';
export type PopoverSize = 'sm' | 'md' | 'lg';

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose?: () => void;
  /** Ссылка на anchor-элемент для позиционирования. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** Сторона относительно anchor. */
  placement?: PopoverPlacement;
  /** Размер. По умолчанию `md`. */
  size?: PopoverSize;
  /** Показывать стрелку, направленную к anchor. */
  arrow?: boolean;
  /** Смещение от anchor (px). */
  offset?: number;
  /** Render в document.body. */
  usePortal?: boolean;
  /** Шапка. */
  header?: React.ReactNode;
  /** Подвал. */
  footer?: React.ReactNode;
  /** Закрытие по клику вне (по умолчанию true). */
  closeOnOutside?: boolean;
  /** Закрытие по Esc (по умолчанию true). */
  closeOnEsc?: boolean;
}

const ArrowSvgH = () => (
  <svg viewBox="0 0 14 7" fill="currentColor" aria-hidden="true">
    <path d="M0 0h14L7 7z" />
  </svg>
);
const ArrowSvgV = ({ flip }: { flip?: boolean }) => (
  <svg viewBox="0 0 7 14" fill="currentColor" aria-hidden="true">
    <path d="M0 0v14l7-7z" transform={flip ? 'rotate(180 3.5 7)' : undefined} />
  </svg>
);

export const Popover = forwardRef<HTMLDivElement, PopoverProps>(
  ({
    open, onClose, anchorRef, placement = 'bottom', size = 'md',
    arrow = true, offset = 6, usePortal = true,
    header, footer, children,
    closeOnOutside = true, closeOnEsc = true,
    className, style, ...rest
  }, ref) => {
    const popRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ top: number; left: number; arrowX?: number; arrowY?: number }>({
      top: 0, left: 0,
    });

    const compute = useCallback(() => {
      const anchor = anchorRef?.current;
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const a = anchor.getBoundingClientRect();
      const p = pop.getBoundingClientRect();
      let top = 0, left = 0;
      let arrowX: number | undefined, arrowY: number | undefined;

      switch (placement) {
        case 'top':
          top = a.top + window.scrollY - p.height - offset;
          left = a.left + window.scrollX + a.width / 2 - p.width / 2;
          break;
        case 'bottom':
          top = a.bottom + window.scrollY + offset;
          left = a.left + window.scrollX + a.width / 2 - p.width / 2;
          break;
        case 'left':
          left = a.left + window.scrollX - p.width - offset;
          top = a.top + window.scrollY + a.height / 2 - p.height / 2;
          break;
        case 'right':
          left = a.right + window.scrollX + offset;
          top = a.top + window.scrollY + a.height / 2 - p.height / 2;
          break;
      }

      // Keep popover inside the viewport horizontally for top/bottom,
      // vertically for left/right.
      const margin = 8;
      if (placement === 'top' || placement === 'bottom') {
        const minLeft = window.scrollX + margin;
        const maxLeft = window.scrollX + window.innerWidth - p.width - margin;
        const constrained = Math.min(Math.max(left, minLeft), maxLeft);
        if (constrained !== left) {
          // arrow stays pointing at the anchor center
          arrowX = (a.left + window.scrollX + a.width / 2) - constrained;
        }
        left = constrained;
      } else {
        const minTop = window.scrollY + margin;
        const maxTop = window.scrollY + window.innerHeight - p.height - margin;
        const constrained = Math.min(Math.max(top, minTop), maxTop);
        if (constrained !== top) {
          arrowY = (a.top + window.scrollY + a.height / 2) - constrained;
        }
        top = constrained;
      }

      setPos({ top, left, arrowX, arrowY });
    }, [anchorRef, placement, offset]);

    useLayoutEffect(() => {
      if (!open) return;
      compute();
    }, [open, compute, children]);

    useEffect(() => {
      if (!open) return;
      const handler = () => compute();
      window.addEventListener('scroll', handler, true);
      window.addEventListener('resize', handler);
      return () => {
        window.removeEventListener('scroll', handler, true);
        window.removeEventListener('resize', handler);
      };
    }, [open, compute]);

    useEffect(() => {
      if (!open || !closeOnOutside) return;
      const onDown = (e: MouseEvent) => {
        if (popRef.current?.contains(e.target as Node)) return;
        if (anchorRef?.current?.contains(e.target as Node)) return;
        onClose?.();
      };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [open, closeOnOutside, onClose, anchorRef]);

    useEffect(() => {
      if (!open || !closeOnEsc) return;
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [open, closeOnEsc, onClose]);

    if (!open) return null;

    const anchored = !!anchorRef;
    const arrowSide = ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[placement];

    const arrowStyle: React.CSSProperties = {};
    if (pos.arrowX != null) (arrowStyle as Record<string, string>).left = `${pos.arrowX}px`;
    if (pos.arrowY != null) (arrowStyle as Record<string, string>).top = `${pos.arrowY}px`;

    const popStyle: React.CSSProperties = {
      ...style,
      ...(anchored ? { position: 'absolute', top: pos.top, left: pos.left, zIndex: 1000 } : {}),
    };
    if (pos.arrowX != null) {
      (popStyle as Record<string, string>)['--arrow-x' as string] = `${pos.arrowX}px`;
    }

    const node = (
      <div
        ref={(el) => {
          popRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) (ref as { current: HTMLDivElement | null }).current = el;
        }}
        className={cn(
          'ou-popover',
          size !== 'md' && `ou-popover--${size}`,
          !arrow && 'ou-popover--no-arrow',
          className,
          cssStyleClass(popStyle, 'ou-popover-pos'),
        )}
        role="dialog"
        {...rest}
      >
        {arrow && (
          <span
            className={cn(
              'ou-popover__arrow',
              `ou-popover__arrow--${arrowSide}`,
              cssStyleClass(arrowStyle, 'ou-popover-arrow'),
            )}
          >
            {arrowSide === 'top' || arrowSide === 'bottom' ? <ArrowSvgH /> : <ArrowSvgV flip={arrowSide === 'right'} />}
          </span>
        )}
        {header && <div className="ou-popover__header">{header}</div>}
        <div className="ou-popover__body">{children}</div>
        {footer && <div className="ou-popover__footer">{footer}</div>}
      </div>
    );

    if (!usePortal || !anchored || typeof document === 'undefined') return node;
    return createPortal(node, document.body);
  },
);
Popover.displayName = 'Popover';

// ─────────────────────────────────────────────────────────────────────────
// Header subcomponents (optional helpers)
// ─────────────────────────────────────────────────────────────────────────

export const PopoverHeader: React.FC<{
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose?: () => void;
  leading?: React.ReactNode;
}> = ({ title, subtitle, onClose, leading }) => (
  <>
    {leading}
    <div className="ou-popover__header-text">
      {title && <h3 className="ou-popover__title">{title}</h3>}
      {subtitle && <p className="ou-popover__subtitle">{subtitle}</p>}
    </div>
    {onClose && (
      <button type="button" className="ou-popover__close" aria-label="Закрыть" onClick={onClose}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    )}
  </>
);
PopoverHeader.displayName = 'PopoverHeader';

export const PopoverRow: React.FC<{
  label: React.ReactNode; value: React.ReactNode;
}> = ({ label, value }) => (
  <div className="ou-popover__row">
    <span className="ou-popover__row-label">{label}</span>
    <span className="ou-popover__row-value">{value}</span>
  </div>
);
PopoverRow.displayName = 'PopoverRow';
