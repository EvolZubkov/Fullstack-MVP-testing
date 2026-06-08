import React, { forwardRef } from 'react';
import { cn, type Tone } from '../utils';

export type TagVariant = 'soft' | 'outline' | 'solid';
export type TagSize = 's' | 'm' | 'l';

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  variant?: TagVariant;
  size?: TagSize;
  /** Coloured dot before text. */
  dot?: boolean;
  /** Inline icon before text. */
  icon?: React.ReactNode;
  /** When set, shows × button that calls this. */
  onRemove?: () => void;
}

export const Tag = forwardRef<HTMLSpanElement, TagProps>(
  ({ tone = 'neutral', variant = 'soft', size = 'm', dot, icon, onRemove, className, children, ...rest }, ref) => (
    <span
      ref={ref}
      className={cn(
        'ou-tag',
        `ou-tag--${tone}`,
        variant !== 'soft' && `ou-tag--${variant}`,
        size !== 'm' && `ou-tag--${size}`,
        className,
      )}
      {...rest}
    >
      {dot && <span className="ou-tag__dot" />}
      {icon}
      {children}
      {onRemove && (
        <button type="button" className="ou-tag__close" aria-label="Удалить" onClick={onRemove}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  ),
);
Tag.displayName = 'Tag';
