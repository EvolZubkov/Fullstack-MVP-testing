import React, {
  forwardRef, useCallback, useEffect, useRef, useState,
} from 'react';
import { cn } from '../utils';

export type FabSize = 's' | 'm' | 'l';
export type FabVariant = 'primary' | 'neutral' | 'surface' | 'success';
export type FabShape = 'round' | 'square';

// ─────────────────────────────────────────────────────────────────────────
// FAB — основной floating action button
// ─────────────────────────────────────────────────────────────────────────

export interface FabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  size?: FabSize;
  variant?: FabVariant;
  shape?: FabShape;
  /** Иконка (для primary FAB без лейбла — основное содержимое). */
  icon?: React.ReactNode;
  /** Текст лейбла (делает кнопку extended). */
  label?: React.ReactNode;
  /** Бейдж в углу. */
  badge?: React.ReactNode;
  /** Делает позиционирование `absolute` относительно ближайшего ancestor. */
  anchor?: boolean;
  /** Mini-режим (44px) — для speed-dial action. */
  mini?: boolean;
  children?: React.ReactNode;
}

export const Fab = forwardRef<HTMLButtonElement, FabProps>(
  ({
    size = 'm', variant = 'primary', shape = 'round',
    icon, label, badge, anchor, mini,
    className, children, ...rest
  }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        'ou-fab',
        `ou-fab--${size}`,
        variant !== 'primary' && `ou-fab--${variant}`,
        shape === 'square' && 'ou-fab--square',
        label ? 'ou-fab--extended' : undefined,
        anchor && 'ou-fab--anchor',
        mini && 'ou-fab--mini',
        className,
      )}
      {...rest}
    >
      {icon}
      {label && <span>{label}</span>}
      {children}
      {badge != null && <span className="ou-fab__badge">{badge}</span>}
    </button>
  ),
);
Fab.displayName = 'Fab';

// ─────────────────────────────────────────────────────────────────────────
// FabGroup — speed-dial (trigger + список действий)
// ─────────────────────────────────────────────────────────────────────────

export interface FabGroupAction {
  id: string;
  icon: React.ReactNode;
  label?: React.ReactNode;
  onClick?: () => void;
  variant?: FabVariant;
  disabled?: boolean;
}

export interface FabGroupProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  trigger: React.ReactNode;
  actions: FabGroupAction[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const FabGroup = forwardRef<HTMLDivElement, FabGroupProps>(
  ({
    trigger, actions,
    open: openProp, defaultOpen, onOpenChange,
    className, ...rest
  }, ref) => {
    const controlled = openProp !== undefined;
    const [internal, setInternal] = useState(!!defaultOpen);
    const open = controlled ? !!openProp : internal;
    const setOpen = useCallback((next: boolean) => {
      if (!controlled) setInternal(next);
      onOpenChange?.(next);
    }, [controlled, onOpenChange]);

    const rootRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      if (!open) return;
      const onDown = (e: MouseEvent) => {
        if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [open, setOpen]);

    return (
      <div
        ref={(el) => {
          rootRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) (ref as { current: HTMLDivElement | null }).current = el;
        }}
        className={cn('ou-fab-group', open && 'is-open', className)}
        {...rest}
      >
        <div
          className="ou-fab-group__actions"
          {...(!open ? { 'aria-hidden': 'true' as const } : {})}
        >
          {actions.map(a => (
            <div key={a.id} className="ou-fab-group__action">
              {a.label && <span className="ou-fab-group__label">{a.label}</span>}
              <Fab
                size="s" mini
                variant={a.variant ?? 'neutral'}
                disabled={a.disabled}
                aria-label={typeof a.label === 'string' ? a.label : a.id}
                onClick={() => { a.onClick?.(); setOpen(false); }}
                icon={a.icon}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          className="ou-fab-group__trigger"
          onClick={() => setOpen(!open)}
          {...(open ? { 'aria-expanded': 'true' as const } : { 'aria-expanded': 'false' as const })}
        >{trigger}</button>
      </div>
    );
  },
);
FabGroup.displayName = 'FabGroup';

// ─────────────────────────────────────────────────────────────────────────
// FabMenu — popover-menu, выпадающий из triggering FAB
// ─────────────────────────────────────────────────────────────────────────

export interface FabMenuItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  iconTone?: 'accent' | 'success' | 'warning' | 'neutral';
  shortcut?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

export interface FabMenuGroup {
  label?: React.ReactNode;
  items: FabMenuItem[];
}

export interface FabMenuProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  trigger: React.ReactNode;
  /** Группированные пункты. */
  groups: FabMenuGroup[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const FabMenu = forwardRef<HTMLDivElement, FabMenuProps>(
  ({
    trigger, groups,
    open: openProp, defaultOpen, onOpenChange,
    className, ...rest
  }, ref) => {
    const controlled = openProp !== undefined;
    const [internal, setInternal] = useState(!!defaultOpen);
    const open = controlled ? !!openProp : internal;
    const setOpen = useCallback((next: boolean) => {
      if (!controlled) setInternal(next);
      onOpenChange?.(next);
    }, [controlled, onOpenChange]);

    const rootRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      if (!open) return;
      const onDown = (e: MouseEvent) => {
        if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [open, setOpen]);

    return (
      <div
        ref={(el) => {
          rootRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) (ref as { current: HTMLDivElement | null }).current = el;
        }}
        className={cn('ou-fab-host', open && 'is-open', className)}
        {...rest}
      >
        <div
          className="ou-fab-menu"
          role="menu"
          {...(!open ? { 'aria-hidden': 'true' as const } : {})}
        >
          {groups.map((g, gi) => (
            <div key={gi} className="ou-fab-menu__group">
              {g.label && <span className="ou-fab-menu__label">{g.label}</span>}
              {g.items.map(item => (
                <button
                  key={item.id} type="button"
                  role="menuitem"
                  className="ou-fab-menu__item"
                  disabled={item.disabled}
                  onClick={() => { item.onClick?.(); setOpen(false); }}
                >
                  {item.icon && (
                    <span className={cn(
                      'ou-fab-menu__icon',
                      item.iconTone && `ou-fab-menu__icon--${item.iconTone}`,
                    )}>{item.icon}</span>
                  )}
                  <span className="ou-fab-menu__text">
                    <span className="ou-fab-menu__title">{item.title}</span>
                    {item.description && (
                      <span className="ou-fab-menu__desc">{item.description}</span>
                    )}
                  </span>
                  {item.shortcut && <span className="ou-fab-menu__kbd">{item.shortcut}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="ou-fab-menu__trigger"
          onClick={() => setOpen(!open)}
          aria-haspopup="menu"
          {...(open ? { 'aria-expanded': 'true' as const } : { 'aria-expanded': 'false' as const })}
        >{trigger}</button>
      </div>
    );
  },
);
FabMenu.displayName = 'FabMenu';
