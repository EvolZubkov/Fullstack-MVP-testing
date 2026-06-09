import React, { forwardRef } from 'react';
import { cn } from '../utils';

export type PageNavVariant = 'default' | 'pills' | 'underline' | 'rail';
export type PageNavOrientation = 'horizontal' | 'vertical';

export interface PageNavItem {
  id: string;
  label: React.ReactNode;
  /** Иконка слева. */
  icon?: React.ReactNode;
  /** Бейдж/число справа. */
  count?: React.ReactNode;
  /** Произвольный trail-контент. */
  trailing?: React.ReactNode;
  /** Группа (выводит uppercase-заголовок над пунктом, только vertical). */
  group?: React.ReactNode;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
}

export interface PageNavProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  items: PageNavItem[];
  /** Активный id. */
  value?: string;
  /** Колбэк при клике на пункт. */
  onChange?: (id: string, item: PageNavItem) => void;
  variant?: PageNavVariant;
  orientation?: PageNavOrientation;
  /** Compact-падинги. */
  compact?: boolean;
}

export const PageNav = forwardRef<HTMLElement, PageNavProps>(
  ({
    items, value, onChange,
    variant = 'default', orientation = 'horizontal', compact,
    className, ...rest
  }, ref) => {
    // Group items by `group` (preserve order, group=undefined keeps no header).
    const groups: { label?: React.ReactNode; items: PageNavItem[] }[] = [];
    items.forEach(it => {
      const last = groups[groups.length - 1];
      if (!last || last.label !== it.group) {
        groups.push({ label: it.group, items: [it] });
      } else {
        last.items.push(it);
      }
    });

    return (
      <nav
        ref={ref}
        className={cn(
          'ou-pagenav',
          `ou-pagenav--${orientation}`,
          variant !== 'default' && `ou-pagenav--${variant}`,
          compact && 'ou-pagenav--compact',
          className,
        )}
        {...rest}
      >
        {groups.map((g, gi) => (
          <React.Fragment key={gi}>
            {g.label && orientation === 'vertical' && (
              <div className="ou-pagenav__group-title">{g.label}</div>
            )}
            {g.items.map(it => {
              const isActive = it.id === value;
              const Tag = (it.href && !it.onClick ? 'a' : 'button') as 'a' | 'button';
              const tagProps: Record<string, unknown> = Tag === 'a'
                ? { href: it.href }
                : { type: 'button' };
              return (
                <Tag
                  key={it.id}
                  className={cn(
                    'ou-pagenav__item',
                    isActive && 'is-active',
                    it.disabled && 'is-disabled',
                  )}
                  aria-current={isActive ? 'page' : undefined}
                  aria-disabled={it.disabled || undefined}
                  onClick={(e: React.MouseEvent) => {
                    if (it.disabled) { e.preventDefault(); return; }
                    it.onClick?.(e);
                    onChange?.(it.id, it);
                  }}
                  {...tagProps as React.HTMLAttributes<HTMLElement>}
                >
                  {it.icon && <span className="ou-pagenav__item-ico">{it.icon}</span>}
                  <span>{it.label}</span>
                  {(it.count != null || it.trailing) && (
                    <span className="ou-pagenav__item-trail">
                      {it.trailing}
                      {it.count != null && <span className="ou-pagenav__item-count">{it.count}</span>}
                    </span>
                  )}
                </Tag>
              );
            })}
          </React.Fragment>
        ))}
      </nav>
    );
  },
);
PageNav.displayName = 'PageNav';
