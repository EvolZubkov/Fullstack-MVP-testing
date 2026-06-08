import React, {
  Children, cloneElement, forwardRef, isValidElement,
  useEffect, useLayoutEffect, useRef, useState, useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { cn, cssStyleClass } from '../utils';

export type MenuSize = 'sm' | 'md' | 'lg';
export type MenuPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

// ─────────────────────────────────────────────────────────────────────────
// Menu container
// ─────────────────────────────────────────────────────────────────────────

export interface MenuProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: MenuSize;
}

export const Menu = forwardRef<HTMLDivElement, MenuProps>(
  ({ size = 'md', className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('ou-menu', size !== 'md' && `ou-menu--${size}`, className)}
      role="menu"
      {...rest}
    >{children}</div>
  ),
);
Menu.displayName = 'Menu';

// ─────────────────────────────────────────────────────────────────────────
// MenuItem (variant: default / danger / selectable)
// ─────────────────────────────────────────────────────────────────────────

export interface MenuItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** Иконка слева. */
  icon?: React.ReactNode;
  /** Заголовок. */
  title?: React.ReactNode;
  /** Мелкий мета-текст под title. */
  meta?: React.ReactNode;
  /** Содержимое справа (шорткат, бейдж, etc.). */
  trailing?: React.ReactNode;
  /** Шорткат-подсказка (рендерится в trail). */
  shortcut?: React.ReactNode;
  /** Опасное действие (красный). */
  danger?: boolean;
  /** Выбранный пункт (с галкой). */
  selected?: boolean;
  /** Показывать слот для check (для выровненных групп selectable). */
  checkSlot?: boolean;
  /** Маркер «есть подменю» (шеврон). */
  hasSubmenu?: boolean;
  /** Disabled. */
  disabled?: boolean;
}

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  ({
    icon, title, meta, trailing, shortcut, danger, selected, checkSlot, hasSubmenu, disabled,
    className, children, ...rest
  }, ref) => (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      aria-disabled={disabled || undefined}
      className={cn(
        'ou-menu__item',
        danger && 'ou-menu__item--danger',
        selected && 'is-selected',
        disabled && 'is-disabled',
        className,
      )}
      disabled={disabled}
      {...rest}
    >
      {checkSlot && (
        <span className="ou-menu__check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      )}
      {icon && <span className="ou-menu__item-ico">{icon}</span>}
      {(title || meta || children) && (
        <span className="ou-menu__item-text">
          <span className="ou-menu__item-title">{title ?? children}</span>
          {meta && <span className="ou-menu__item-meta">{meta}</span>}
        </span>
      )}
      {(trailing || shortcut) && (
        <span className="ou-menu__item-trail">
          {trailing}
          {shortcut}
        </span>
      )}
      {hasSubmenu && (
        <span className="ou-menu__chevron">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      )}
    </button>
  ),
);
MenuItem.displayName = 'MenuItem';

// ─────────────────────────────────────────────────────────────────────────
// MenuDivider, MenuLabel, MenuGroup, MenuHeader
// ─────────────────────────────────────────────────────────────────────────

export const MenuDivider: React.FC<React.HTMLAttributes<HTMLDivElement>> =
  ({ className, ...rest }) => (
    <div className={cn('ou-menu__divider', className)} role="separator" {...rest} />
  );
MenuDivider.displayName = 'MenuDivider';

export const MenuLabel: React.FC<React.HTMLAttributes<HTMLDivElement>> =
  ({ className, children, ...rest }) => (
    <div className={cn('ou-menu__label', className)} {...rest}>{children}</div>
  );
MenuLabel.displayName = 'MenuLabel';

export interface MenuGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
}
export const MenuGroup: React.FC<MenuGroupProps> = ({ label, className, children, ...rest }) => (
  <div className={cn('ou-menu__group', className)} role="group" {...rest}>
    {label && <div className="ou-menu__label">{label}</div>}
    {children}
  </div>
);
MenuGroup.displayName = 'MenuGroup';

export interface MenuHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  avatar?: React.ReactNode;
}
export const MenuHeader: React.FC<MenuHeaderProps> = ({ title, meta, avatar, className, ...rest }) => (
  <div className={cn('ou-menu__head', className)} {...rest}>
    {avatar}
    <div className="ou-menu__head-text">
      {title && <span className="ou-menu__head-title">{title}</span>}
      {meta && <span className="ou-menu__head-meta">{meta}</span>}
    </div>
  </div>
);
MenuHeader.displayName = 'MenuHeader';

// ─────────────────────────────────────────────────────────────────────────
// MenuTrigger — wires up anchor + portal-positioned menu
// ─────────────────────────────────────────────────────────────────────────

export interface MenuTriggerProps {
  /** Триггер (одиночный React-элемент). Будет clone'ан с onClick/aria. */
  trigger: React.ReactElement;
  /** Содержимое меню — обычно `<MenuItem>` и хелперы. */
  children: React.ReactNode;
  /** Размер панели. */
  size?: MenuSize;
  /** Позиционирование. */
  placement?: MenuPlacement;
  /** Контролируемое состояние. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render в портале. По умолчанию true. */
  usePortal?: boolean;
  /** Отступ от триггера. */
  offset?: number;
  /** Закрытие по клику внутри меню. */
  closeOnSelect?: boolean;
}

export const MenuTrigger: React.FC<MenuTriggerProps> = ({
  trigger, children, size = 'md',
  placement = 'bottom-start',
  open: openProp, defaultOpen, onOpenChange,
  usePortal = true, offset = 4, closeOnSelect = true,
}) => {
  const controlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(!!defaultOpen);
  const open = controlled ? !!openProp : uncontrolledOpen;
  const setOpen = useCallback((next: boolean) => {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [controlled, onOpenChange]);

  const anchorRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const recompute = useCallback(() => {
    const a = anchorRef.current; const m = menuRef.current;
    if (!a || !m) return;
    const r = a.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    const [v, h] = placement.split('-') as ['top' | 'bottom', 'start' | 'end'];
    let top = v === 'top'
      ? r.top + window.scrollY - mr.height - offset
      : r.bottom + window.scrollY + offset;
    let left = h === 'end'
      ? r.right + window.scrollX - mr.width
      : r.left + window.scrollX;
    // viewport clamp
    const margin = 8;
    left = Math.max(window.scrollX + margin,
      Math.min(left, window.scrollX + window.innerWidth - mr.width - margin));
    top = Math.max(window.scrollY + margin,
      Math.min(top, window.scrollY + window.innerHeight - mr.height - margin));
    setPos({ top, left });
  }, [placement, offset]);

  useLayoutEffect(() => { if (open) recompute(); }, [open, recompute]);
  useEffect(() => {
    if (!open) return;
    const h = () => recompute();
    window.addEventListener('scroll', h, true);
    window.addEventListener('resize', h);
    return () => {
      window.removeEventListener('scroll', h, true);
      window.removeEventListener('resize', h);
    };
  }, [open, recompute]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const triggerElement = trigger as React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  const cloned = isValidElement(trigger)
    ? cloneElement(triggerElement, {
      ref: anchorRef as unknown as React.Ref<HTMLElement>,
      onClick: (e: React.MouseEvent) => {
        triggerElement.props.onClick?.(e as React.MouseEvent<HTMLElement>);
        setOpen(!open);
      },
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
    } as React.HTMLAttributes<HTMLElement>)
    : trigger;

  const menu = open ? (
    <div
      ref={menuRef}
      className={cn(
        'ou-menu',
        size !== 'md' && `ou-menu--${size}`,
        cssStyleClass({ position: 'absolute', top: pos.top, left: pos.left, zIndex: 1000 }, 'ou-menu-pos'),
      )}
      role="menu"
      onClick={(e) => {
        if (closeOnSelect && (e.target as HTMLElement).closest('.ou-menu__item')) setOpen(false);
      }}
    >{children}</div>
  ) : null;

  return (
    <>
      {cloned}
      {menu && (usePortal && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu)}
    </>
  );
};
MenuTrigger.displayName = 'MenuTrigger';
