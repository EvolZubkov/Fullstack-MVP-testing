import React, { forwardRef, useState } from 'react';
import { cn, cssStyleClass } from '../utils';

export type ChipSize = 'xs' | 's' | 'm' | 'l';

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  size?: ChipSize;
  /** Visually selected (filter pressed). */
  selected?: boolean;
  solid?: boolean;
  /** Coloured dot before text. */
  dot?: string;
  icon?: React.ReactNode;
  avatar?: React.ReactNode;
  count?: React.ReactNode;
  /** Renders × close button. */
  onRemove?: () => void;
  onChange?: (selected: boolean) => void;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(
  ({
    size = 'm',
    selected: controlledSelected,
    solid,
    dot,
    icon,
    avatar,
    count,
    onRemove,
    onChange,
    className,
    children,
    disabled,
    onClick,
    ...rest
  }, ref) => {
    const isControlled = controlledSelected !== undefined;
    const [uncontrolled, setUncontrolled] = useState(false);
    const selected = isControlled ? controlledSelected : uncontrolled;

    return (
      <span
        className={cn(
          'ou-chip',
          size !== 'm' && `ou-chip--${size}`,
          onRemove && 'ou-chip--removable',
          solid && 'ou-chip--solid',
          selected && 'is-selected',
          disabled && 'is-disabled',
          className,
        )}
      >
        <button
          ref={ref}
          type="button"
          className="ou-chip__action"
          {...(selected ? { 'aria-pressed': 'true' as const } : { 'aria-pressed': 'false' as const })}
          disabled={disabled}
          onClick={(e) => {
            if (!isControlled) setUncontrolled((v) => !v);
            onChange?.(!selected);
            onClick?.(e);
          }}
          {...rest}
        >
          {dot && <span className={cn('ou-chip__dot', cssStyleClass({ background: dot }, 'ou-chip-dot'))} />}
          {icon && <span className="ou-chip__icon">{icon}</span>}
          {avatar && <span className="ou-chip__avatar">{avatar}</span>}
          {children}
          {count != null && <span className="ou-chip__count">{count}</span>}
        </button>
        {onRemove && (
          <button
            type="button"
            className="ou-chip__close"
            aria-label="Удалить"
            disabled={disabled}
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </span>
    );
  },
);
Chip.displayName = 'Chip';
