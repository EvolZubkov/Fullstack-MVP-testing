import React, { forwardRef } from 'react';
import { cn } from '../utils';

// ─────────────────────────────────────────────────────────────────────────
// Sidebar — vertical nav for AppShell side area
// ─────────────────────────────────────────────────────────────────────────

export interface SidebarItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  href?: string;
  disabled?: boolean;
}

export interface SidebarGroup {
  title?: React.ReactNode;
  items: SidebarItem[];
}

export interface SidebarProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onSelect'> {
  groups: SidebarGroup[];
  /** Активный id. */
  activeId?: string;
  onSelect?: (id: string, item: SidebarItem) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Брендинг сверху (логотип + текст). */
  brand?: React.ReactNode;
  /** Контент в подвале (пользователь, версия и т.п.). */
  footer?: React.ReactNode;
  /** Подпись для кнопки коллапса (a11y). */
  collapseLabel?: { collapse?: string; expand?: string };
}

const CollapseIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(
  ({
    groups, activeId, onSelect,
    collapsed, onToggleCollapse,
    brand, footer,
    collapseLabel = { collapse: 'Свернуть', expand: 'Развернуть' },
    className, ...rest
  }, ref) => (
    <aside
      ref={ref}
      className={cn('ou-side', collapsed && 'is-collapsed', className)}
      {...rest}
    >
      {brand && (
        <div className="ou-side__brand">{brand}</div>
      )}
      <nav className="ou-side__nav">
        {groups.map((g, gi) => (
          <div key={gi} className="ou-side__group">
            {g.title && !collapsed && (
              <div className="ou-side__group-title">{g.title}</div>
            )}
            {g.items.map(item => {
              const isActive = item.id === activeId;
              const Tag = (item.href ? 'a' : 'button') as 'a' | 'button';
              return (
                <Tag
                  key={item.id}
                  className={cn(
                    'ou-side__item',
                    isActive && 'is-active',
                  )}
                  aria-current={isActive ? 'page' : undefined}
                  aria-disabled={item.disabled || undefined}
                  href={item.href}
                  type={!item.href ? 'button' : undefined}
                  onClick={(e: React.MouseEvent) => {
                    if (item.disabled) { e.preventDefault(); return; }
                    onSelect?.(item.id, item);
                  }}
                  title={collapsed && typeof item.label === 'string' ? item.label : undefined}
                >
                  {item.icon && <span className="ou-side__ico">{item.icon}</span>}
                  <span className="ou-side__lbl">{item.label}</span>
                  {item.badge != null && <span className="ou-side__badge">{item.badge}</span>}
                </Tag>
              );
            })}
          </div>
        ))}
      </nav>
      {footer && <div className="ou-side__foot">{footer}</div>}
      {onToggleCollapse && (
        <button
          type="button" className="ou-side__collapse"
          aria-label={collapsed ? collapseLabel.expand : collapseLabel.collapse}
          aria-expanded={!collapsed ? 'true' : 'false'}
          onClick={onToggleCollapse}
        ><CollapseIcon /></button>
      )}
    </aside>
  ),
);
Sidebar.displayName = 'Sidebar';
