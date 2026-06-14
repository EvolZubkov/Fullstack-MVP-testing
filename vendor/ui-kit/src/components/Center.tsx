import React, { forwardRef } from 'react';
import { cn } from '../utils';
import type { Space } from './Layout';

/**
 * @module components/Center
 * @description Centers its single child both axes within a min-height region —
 * the framing primitive for full-viewport screens (auth, 404, no-access, loading).
 * `minH="screen"` fills the viewport (`100dvh`); `pad` (token) keeps the child off
 * the edges on small screens.
 */

export type CenterMinH = 'screen' | 'full';

export interface CenterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Minimum height of the centering region. Default `screen` (100dvh). */
  minH?: CenterMinH;
  /** Padding around the centered content (`--ou-space-{pad}`). */
  pad?: Space;
  /** Grow to fill remaining space inside a flex column (`flex: 1`). */
  grow?: boolean;
}

export const Center = forwardRef<HTMLDivElement, CenterProps>(
  ({ minH = 'screen', pad, grow, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('ou-center', `ou-center--${minH}`, pad != null && `ou-box--pad-${pad}`, grow && 'ou-grow', className)}
      {...rest}
    />
  ),
);
Center.displayName = 'Center';
