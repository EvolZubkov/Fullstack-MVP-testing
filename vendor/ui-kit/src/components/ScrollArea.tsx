import React, { forwardRef } from 'react';
import { cn } from '../utils';

export type ScrollAreaOrientation = 'vertical' | 'horizontal' | 'both';
/** Bounded viewport height preset (token-scaled, no arbitrary values). */
export type ScrollAreaMaxH = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Scroll axis (default vertical). */
  orientation?: ScrollAreaOrientation;
  /** Cap the viewport height to a named preset (xs…xl) instead of a raw value. */
  maxH?: ScrollAreaMaxH;
}

/**
 * UniversityRT · ScrollArea — an overflow container with a thin DS-styled
 * scrollbar (CSS-only: `scrollbar-width`/`scrollbar-color` + `::-webkit-scrollbar`).
 * Bound the viewport with the `maxH` preset; otherwise it fills its parent.
 */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ orientation = 'vertical', maxH, className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('ou-scroll', `ou-scroll--${orientation}`, maxH && `ou-scroll--mh-${maxH}`, className)}
      {...rest}
    >
      {children}
    </div>
  ),
);
ScrollArea.displayName = 'ScrollArea';
