import React, { forwardRef, useCallback, useState } from 'react';
import { cn } from '../utils';

export type TabsVariant = 'underline' | 'pill' | 'segment';
export type TabsSize = 's' | 'm';
export type TabsAlign = 'start' | 'center' | 'stretch';

export interface TabItem<T extends string = string> {
  id: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
  content?: React.ReactNode;
}

export interface TabsProps<T extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  items: TabItem<T>[];
  /** Контролируемый active id. */
  value?: T;
  defaultValue?: T;
  onChange?: (id: T) => void;
  variant?: TabsVariant;
  size?: TabsSize;
  align?: TabsAlign;
  /** Скрыть автоматический рендер `content`-панели (только TabList). */
  hidePanel?: boolean;
}

export function Tabs<T extends string = string>({
  items, value, defaultValue, onChange,
  variant = 'underline', size = 'm', align = 'start',
  hidePanel, className, ...rest
}: TabsProps<T>) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState<T | undefined>(
    defaultValue ?? items.find(i => !i.disabled)?.id,
  );
  const active = controlled ? value : internal;

  const set = useCallback((id: T) => {
    if (!controlled) setInternal(id);
    onChange?.(id);
  }, [controlled, onChange]);

  const onKeyDown: React.KeyboardEventHandler = (e) => {
    if (!active) return;
    const idx = items.findIndex(i => i.id === active);
    if (idx < 0) return;
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    while (items[next].disabled) {
      next = e.key === 'ArrowLeft' || e.key === 'End'
        ? (next - 1 + items.length) % items.length
        : (next + 1) % items.length;
      if (next === idx) return;
    }
    e.preventDefault();
    set(items[next].id);
  };

  const activeItem = items.find(i => i.id === active);

  return (
    <div
      className={cn(
        'ou-tabs',
        `ou-tabs--${variant}`,
        `ou-tabs--${size}`,
        align !== 'start' && `ou-tabs--${align}`,
        className,
      )}
      {...rest}
    >
      <div className="ou-tabs__list" role="tablist" onKeyDown={onKeyDown}>
        {items.map(it => {
          const isActive = it.id === active;
          return (
            <button
              key={it.id} type="button"
              role="tab"
              id={`tab-${it.id}`}
              aria-controls={`panel-${it.id}`}
              aria-selected={isActive ? 'true' : 'false'}
              tabIndex={isActive ? 0 : -1}
              disabled={it.disabled}
              className={cn('ou-tabs__tab', isActive && 'is-active')}
              onClick={() => !it.disabled && set(it.id)}
            >
              {it.icon && <span className="ou-tabs__icon">{it.icon}</span>}
              <span className="ou-tabs__label">{it.label}</span>
              {it.badge != null && <span className="ou-tabs__badge">{it.badge}</span>}
            </button>
          );
        })}
      </div>
      {!hidePanel && activeItem?.content !== undefined && (
        <div
          id={`panel-${activeItem.id}`}
          className="ou-tabs__panel"
          role="tabpanel"
          aria-labelledby={`tab-${activeItem.id}`}
        >{activeItem.content}</div>
      )}
    </div>
  );
}
Tabs.displayName = 'Tabs';

// ─────────────────────────────────────────────────────────────────────────
// Composable form (TabList + TabPanel) — when you want to render content
// outside of the items array.
// ─────────────────────────────────────────────────────────────────────────

export const TabList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-tabs__list', className)} role="tablist" {...rest} />
  ),
);
TabList.displayName = 'TabList';

export interface TabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  isActive?: boolean;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}
export const Tab = forwardRef<HTMLButtonElement, TabProps>(
  ({ isActive, icon, badge, className, children, ...rest }, ref) => (
    <button
      ref={ref} type="button" role="tab"
      aria-selected={isActive ? 'true' : 'false'}
      tabIndex={isActive ? 0 : -1}
      className={cn('ou-tabs__tab', isActive && 'is-active', className)}
      {...rest}
    >
      {icon && <span className="ou-tabs__icon">{icon}</span>}
      <span className="ou-tabs__label">{children}</span>
      {badge != null && <span className="ou-tabs__badge">{badge}</span>}
    </button>
  ),
);
Tab.displayName = 'Tab';

export const TabPanel = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref} role="tabpanel"
      className={cn('ou-tabs__panel', className)}
      {...rest}
    />
  ),
);
TabPanel.displayName = 'TabPanel';
