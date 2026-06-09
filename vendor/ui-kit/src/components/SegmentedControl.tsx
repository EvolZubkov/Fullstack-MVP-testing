import React, { useCallback, useState } from 'react';
import { cn, type Size } from '../utils';

export type SegmentedControlSize = Size;
export type SegmentedControlVariant = 'default' | 'accent';

export interface SegmentedControlItem<T extends string = string> {
  value: T;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  items: SegmentedControlItem<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  size?: SegmentedControlSize;
  variant?: SegmentedControlVariant;
  /** Растягивается на ширину родителя. */
  stretch?: boolean;
  /** Только иконки (компактная высота/паддинг). */
  iconOnly?: boolean;
  name?: string;
}

export function SegmentedControl<T extends string = string>({
  items, value, defaultValue, onChange,
  size = 'm', variant = 'default',
  stretch, iconOnly, name,
  className, ...rest
}: SegmentedControlProps<T>) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState<T | undefined>(
    defaultValue ?? items.find(i => !i.disabled)?.value,
  );
  const active = controlled ? value : internal;

  const set = useCallback((v: T) => {
    if (!controlled) setInternal(v);
    onChange?.(v);
  }, [controlled, onChange]);

  return (
    <div
      className={cn(
        'ou-seg',
        size !== 'm' && `ou-seg--${size}`,
        variant === 'accent' && 'ou-seg--accent',
        stretch && 'ou-seg--stretch',
        iconOnly && 'ou-seg--icon',
        className,
      )}
      role="group"
      {...rest}
    >
      {items.map(it => {
        const isActive = it.value === active;
        return (
          <button
            key={it.value} type="button"
            className={cn('ou-seg__item', isActive && 'is-active')}
            disabled={it.disabled}
            aria-pressed={isActive ? 'true' : 'false'}
            aria-label={it.ariaLabel || (iconOnly && typeof it.label === 'string' ? it.label : undefined)}
            onClick={() => !it.disabled && set(it.value)}
          >
            {it.icon}
            {!iconOnly && it.label != null && <span>{it.label}</span>}
            {it.badge != null && <span className="ou-seg__badge">{it.badge}</span>}
            {name && isActive && <input type="hidden" name={name} value={it.value} />}
          </button>
        );
      })}
    </div>
  );
}
SegmentedControl.displayName = 'SegmentedControl';
