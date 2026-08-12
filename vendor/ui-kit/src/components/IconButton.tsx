import React, { forwardRef } from 'react';
import { cn, type Size, type ButtonVariant } from '../utils';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant | 'outline';
  size?: Size;
  /** Visible icon (Lucide / inline SVG). Required. */
  icon: React.ReactNode;
  /** Accessible name. Required for icon-only buttons. */
  'aria-label': string;
  active?: boolean;
  /** Pill/round shape. */
  round?: boolean;
  badge?: React.ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', size = 'm', icon, active, round, badge, className, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(
        'ou-iconbtn',
        `ou-iconbtn--${variant}`,
        `ou-iconbtn--${size}`,
        active && 'is-active',
        round && 'ou-iconbtn--round',
        className,
      )}
      aria-pressed={active ? 'true' : 'false'}
      {...rest}
    >
      <span className="ou-iconbtn__ico">{icon}</span>
      {badge != null && <span className="ou-iconbtn__badge">{badge}</span>}
    </button>
  ),
);
IconButton.displayName = 'IconButton';
