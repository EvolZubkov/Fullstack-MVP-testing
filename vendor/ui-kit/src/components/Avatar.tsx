import React, { forwardRef } from 'react';
import { cn, type Size } from '../utils';

export type AvatarColor = 'purple' | 'blue' | 'green' | 'amber' | 'pink' | 'teal' | 'slate';
export type AvatarShape = 'circle' | 'square' | 'squircle' | 'rt';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: 'xs' | Size | 'xl' | '2xl';
  src?: string;
  alt?: string;
  initials?: string;
  color?: AvatarColor;
  solid?: boolean;
  bordered?: boolean;
  shape?: AvatarShape;
  status?: 'online' | 'offline' | 'busy' | 'away';
}

const COLOR_HASH = ['purple', 'blue', 'green', 'amber', 'pink', 'teal'] as const;

const MASKED_SHAPES = new Set<AvatarShape>(['squircle', 'rt']);

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ size = 'm', src, alt, initials, color, solid, bordered, shape, status, className, children, ...rest }, ref) => {
    const inferredColor: AvatarColor = color || (initials
      ? COLOR_HASH[initials.charCodeAt(0) % COLOR_HASH.length]
      : 'slate');
    const content = src
      ? <img src={src} alt={alt || ''} />
      : (children ?? <span className="ou-avatar__initials">{initials}</span>);

    const hasMask = shape != null && MASKED_SHAPES.has(shape);
    // Wrapper needed when masked: to keep status pip and bordered ring outside the mask clip
    const needsWrapper = hasMask && (bordered || !!status);

    const pip = status ? (
      <span
        className={`ou-avatar__status is-${status}`}
        role="img"
        aria-label={`${status} status`}
      />
    ) : null;

    const avatarEl = (
      <span ref={!needsWrapper ? ref : undefined} className={cn(
        'ou-avatar',
        `ou-avatar--${size}`,
        `ou-avatar--c-${inferredColor}`,
        solid && 'ou-avatar--solid',
        shape === 'square' && 'ou-avatar--square',
        bordered && !hasMask && 'ou-avatar--bordered',
        hasMask && `ou-avatar--mask-${shape}`,
        className,
      )} {...rest}>
        <span className="ou-avatar__visual">{content}</span>
        {!hasMask && pip}
      </span>
    );

    if (needsWrapper) {
      return (
        <span ref={ref} className={cn(
          'ou-avatar__ring',
          `ou-avatar__ring--${shape}`,
          bordered && 'ou-avatar__ring--bordered',
          `ou-avatar--${size}`,
        )}>
          {avatarEl}
          {pip}
        </span>
      );
    }

    return avatarEl;
  },
);
Avatar.displayName = 'Avatar';
