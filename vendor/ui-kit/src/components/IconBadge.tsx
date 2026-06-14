import React, { forwardRef } from 'react';
import { cn } from '../utils';

/**
 * @module components/IconBadge
 * @description A circular, tinted container for a single icon — used in card/
 * dialog/empty-state headers (e.g. the eye-catching icon above an auth form).
 * Tones map to the design-system soft-container tokens (same palette as Tag).
 */

export type IconBadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info';
export type IconBadgeSize = 's' | 'm' | 'l';

export interface IconBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  icon: React.ReactNode;
  tone?: IconBadgeTone;
  size?: IconBadgeSize;
}

export const IconBadge = forwardRef<HTMLSpanElement, IconBadgeProps>(
  ({ icon, tone = 'neutral', size = 'm', className, ...rest }, ref) => (
    <span
      ref={ref}
      className={cn('ou-iconbadge', `ou-iconbadge--${tone}`, size !== 'm' && `ou-iconbadge--${size}`, className)}
      {...rest}
    >
      {icon}
    </span>
  ),
);
IconBadge.displayName = 'IconBadge';
