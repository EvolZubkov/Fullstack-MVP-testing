import React, { forwardRef } from 'react';
import { cn } from '../utils';

// ─────────────────────────────────────────────────────────────────────────
// AppShell — root grid layout (header + side + main)
// ─────────────────────────────────────────────────────────────────────────

export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Контент сайдбара (обычно — `<Sidebar>`). */
  side?: React.ReactNode;
  /** Контент шапки. */
  header?: React.ReactNode;
  /** Свёрнутый сайдбар (64px). */
  collapsed?: boolean;
}

export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(
  ({ side, header, collapsed, className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('ou-shell', collapsed && 'is-collapsed', className)}
      {...rest}
    >
      {side && <div className="ou-shell__side">{side}</div>}
      {header && <header className="ou-shell__header">{header}</header>}
      <main className="ou-shell__main">{children}</main>
    </div>
  ),
);
AppShell.displayName = 'AppShell';

// ─────────────────────────────────────────────────────────────────────────
// Header slots
// ─────────────────────────────────────────────────────────────────────────

export interface AppShellBrandProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Иконка/инициалы. */
  mark?: React.ReactNode;
}
export const AppShellBrand = forwardRef<HTMLDivElement, AppShellBrandProps>(
  ({ mark, className, children, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-shell__brand', className)} {...rest}>
      {mark && <span className="ou-shell__brand-mark">{mark}</span>}
      {children}
    </div>
  ),
);
AppShellBrand.displayName = 'AppShellBrand';

export const AppShellSearch = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-shell__search', className)} {...rest} />
  ),
);
AppShellSearch.displayName = 'AppShellSearch';

export const AppShellActions = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-shell__actions', className)} {...rest} />
  ),
);
AppShellActions.displayName = 'AppShellActions';

// ─────────────────────────────────────────────────────────────────────────
// User entry — avatar + name + role
// ─────────────────────────────────────────────────────────────────────────

export interface AppShellUserProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> {
  avatar?: React.ReactNode;
  name?: React.ReactNode;
  role?: React.ReactNode;
  interactive?: boolean;
}
export const AppShellUser = forwardRef<HTMLElement, AppShellUserProps>(
  ({ avatar, name, role, interactive = true, className, ...rest }, ref) => {
    const content = (
      <>
        {avatar && <span className="ou-shell__avatar">{avatar}</span>}
        {(name || role) && (
          <span className="ou-shell__user-meta">
            {name && <span className="ou-shell__user-name">{name}</span>}
            {role && <span className="ou-shell__user-role">{role}</span>}
          </span>
        )}
      </>
    );
    if (interactive) {
      return (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          className={cn('ou-shell__user', className)}
          {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >{content}</button>
      );
    }
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        className={cn('ou-shell__user', className)}
        {...rest}
      >{content}</div>
    );
  },
);
AppShellUser.displayName = 'AppShellUser';

// ─────────────────────────────────────────────────────────────────────────
// Page head slot
// ─────────────────────────────────────────────────────────────────────────

export interface AppShellPageHeadProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}
export const AppShellPageHead = forwardRef<HTMLDivElement, AppShellPageHeadProps>(
  ({ title, subtitle, actions, className, children, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-shell__page-head', className)} {...rest}>
      <div>
        {title && <h1>{title}</h1>}
        {subtitle && <p className="ou-shell__page-sub">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="ou-shell__page-actions">{actions}</div>}
    </div>
  ),
);
AppShellPageHead.displayName = 'AppShellPageHead';
