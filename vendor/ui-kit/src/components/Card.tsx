import React, { forwardRef } from 'react';
import { cn } from '../utils';

export type CardSize = 'sm' | 'md' | 'lg';
export type CardVariant = 'default' | 'outlined' | 'filled' | 'ghost' | 'accent';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: CardSize;
  variant?: CardVariant;
  /** Кликабельная (как кнопка) карточка. */
  interactive?: boolean;
  /** Выбрана. */
  selected?: boolean;
  /** Отключена. */
  disabled?: boolean;
  /** Плоский футер (без border-top). */
  flatFooter?: boolean;
  /** Убирает padding у дочерних слотов. */
  flush?: boolean;
}

export const Card = forwardRef<HTMLElement, CardProps>(
  ({
    size = 'md', variant = 'default', interactive, selected, disabled, flatFooter, flush,
    className, children, role, tabIndex, ...rest
  }, ref) => {
    const cls = cn(
      'ou-card',
      size !== 'md' && `ou-card--${size}`,
      variant !== 'default' && `ou-card--${variant}`,
      interactive && 'ou-card--interactive',
      flatFooter && 'ou-card--flat-footer',
      flush && 'ou-card--flush',
      selected && 'is-selected',
      disabled && 'is-disabled',
      className,
    );
    if (interactive && !role) {
      const stateProps = {
        ...(disabled && { 'aria-disabled': true as const }),
        ...(selected && { 'aria-pressed': true as const }),
      };
      return (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          className={cls}
          tabIndex={tabIndex ?? (disabled ? undefined : 0)}
          {...stateProps}
          {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >{children}</button>
      );
    }
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        className={cls}
        {...(role ? { role } : {})}
        {...(tabIndex !== undefined ? { tabIndex } : {})}
        {...rest}
      >{children}</div>
    );
  },
);
Card.displayName = 'Card';

// ── Slots ────────────────────────────────────────────────────────────────

export interface CardMediaProps extends React.HTMLAttributes<HTMLDivElement> {
  flat?: boolean;
}
export const CardMedia = forwardRef<HTMLDivElement, CardMediaProps>(
  ({ flat, className, ...rest }, ref) => (
    <div ref={ref}
      className={cn('ou-card__media', flat && 'ou-card__media--flat', className)} {...rest} />
  ),
);
CardMedia.displayName = 'CardMedia';

export interface CardHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Левая часть (иконка, аватар, индикатор). */
  lead?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Правая часть (меню, экшены). */
  trail?: React.ReactNode;
}
export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ lead, title, subtitle, trail, className, children, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-card__header', className)} {...rest}>
      {lead && <div className="ou-card__lead">{lead}</div>}
      {(title || subtitle || children) && (
        <div className="ou-card__heading">
          {title && <h3 className="ou-card__title">{title}</h3>}
          {subtitle && <p className="ou-card__subtitle">{subtitle}</p>}
          {children}
        </div>
      )}
      {trail && <div className="ou-card__trail">{trail}</div>}
    </div>
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardBody = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-card__body', className)} {...rest} />
  ),
);
CardBody.displayName = 'CardBody';

export const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-card__footer', className)} {...rest} />
  ),
);
CardFooter.displayName = 'CardFooter';

export const CardDivider: React.FC<React.HTMLAttributes<HTMLDivElement>> =
  ({ className, ...rest }) => (
    <div className={cn('ou-card__divider', className)} role="separator" {...rest} />
  );
CardDivider.displayName = 'CardDivider';

// ── KPI preset ───────────────────────────────────────────────────────────

export interface CardKpiProps extends Omit<CardProps, 'variant'> {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaTrend?: 'up' | 'down' | 'flat';
}

export const CardKpi = forwardRef<HTMLDivElement, CardKpiProps>(
  ({ label, value, delta, deltaTrend = 'flat', size = 'md', className, ...rest }, ref) => (
    <Card
      ref={ref}
      size={size}
      className={cn('ou-card--kpi', className)}
      {...rest}
    >
      <CardBody>
        <span className="ou-card__kpi-label">{label}</span>
        <span className="ou-card__kpi-value">{value}</span>
        {delta !== undefined && (
          <span className={cn('ou-card__kpi-delta', `is-${deltaTrend}`)}>{delta}</span>
        )}
      </CardBody>
    </Card>
  ),
);
CardKpi.displayName = 'CardKpi';
