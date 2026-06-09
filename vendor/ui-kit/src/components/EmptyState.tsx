import React, { forwardRef } from 'react';
import { cn } from '../utils';

export type EmptyStateLayout = 'default' | 'horizontal' | 'inline' | 'page';
export type EmptyStateTone = 'neutral' | 'info' | 'success' | 'warn' | 'error';

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Иллюстрация (svg/illustration). */
  art?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Подсказка-каптион под description (kbd, etc.). */
  hint?: React.ReactNode;
  /** Контейнер для кнопок-действий. */
  actions?: React.ReactNode;
  layout?: EmptyStateLayout;
  tone?: EmptyStateTone;
  /** Surrounding well (bg-surface-2 + rounded). */
  well?: boolean;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({
    art, title, description, hint, actions,
    layout = 'default', tone = 'neutral', well,
    className, children, ...rest
  }, ref) => (
    <div
      ref={ref}
      className={cn(
        'ou-empty',
        layout !== 'default' && `ou-empty--${layout}`,
        tone !== 'neutral' && `ou-empty--tone-${tone}`,
        well && 'ou-empty--well',
        className,
      )}
      role="status"
      {...rest}
    >
      {art && <div className="ou-empty__art">{art}</div>}
      <div className="ou-empty__content">
        <h2 className="ou-empty__title">{title}</h2>
        {description && <p className="ou-empty__desc">{description}</p>}
        {hint && <div className="ou-empty__hint">{hint}</div>}
        {children}
        {actions && <div className="ou-empty__actions">{actions}</div>}
      </div>
    </div>
  ),
);
EmptyState.displayName = 'EmptyState';
