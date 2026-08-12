import React, { forwardRef } from 'react';
import { cn } from '../utils';

export type BannerVariant = 'subtle' | 'outline' | 'bar' | 'solid';
export type BannerTone = 'success' | 'error' | 'warning' | 'info' | 'neutral';
export type BannerSize = 'sm' | 'md' | 'lg';

export interface BannerAction {
  label: React.ReactNode;
  onClick?: () => void;
  /** Primary CTA style. */
  primary?: boolean;
  /** Additional class on the button. */
  className?: string;
}

export interface BannerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: BannerVariant;
  tone?: BannerTone;
  size?: BannerSize;
  /** Stacked layout: icon+body+close inside ou-banner__head, actions below. */
  stacked?: boolean;
  /** Full-width (system-wide banner). */
  fullWidth?: boolean;
  /** Icon on the left. */
  icon?: React.ReactNode;
  /** Title. */
  title?: React.ReactNode;
  /** Body description. */
  description?: React.ReactNode;
  /** Action buttons. */
  actions?: BannerAction[];
  /** Close callback. If absent — no close button. */
  onClose?: () => void;
  /** Aria-label for the close button. */
  closeLabel?: string;
  children?: React.ReactNode;
}

const DefaultIcons: Record<BannerTone, React.ReactNode> = {
  success: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><polyline points="9 12 11 14 15 9" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  neutral: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

const CloseButton: React.FC<{ label: string; onClick?: () => void }> = ({ label, onClick }) => (
  <button type="button" className="ou-banner__close" aria-label={label} onClick={onClick}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  </button>
);

export const Banner = forwardRef<HTMLDivElement, BannerProps>(
  ({
    variant = 'subtle', tone = 'info', size,
    stacked, fullWidth,
    icon, title, description, actions, onClose, closeLabel = 'Закрыть',
    children, className, ...rest
  }, ref) => {
    const cls = cn(
      'ou-banner',
      `ou-banner--${variant}`,
      `ou-banner--${tone}`,
      size === 'sm' && 'ou-banner--sm',
      size === 'lg' && 'ou-banner--lg',
      stacked && 'ou-banner--stacked',
      fullWidth && 'ou-banner--full',
      className,
    );

    const iconEl = <span className="ou-banner__ico">{icon ?? DefaultIcons[tone]}</span>;
    const bodyEl = (
      <div className="ou-banner__body">
        {title && <div className="ou-banner__title">{title}</div>}
        {description && <div className="ou-banner__desc">{description}</div>}
        {children}
      </div>
    );
    const actionsEl = actions && actions.length > 0 && (
      <div className="ou-banner__actions">
        {actions.map((a, i) => (
          <button
            key={i} type="button"
            className={cn('ou-banner__cta', a.primary && 'ou-banner__cta--primary', a.className)}
            onClick={a.onClick}
          >{a.label}</button>
        ))}
      </div>
    );
    const content = stacked ? (
      <>
        <div className="ou-banner__head">
          {iconEl}
          {bodyEl}
          {onClose && <CloseButton label={closeLabel} onClick={onClose} />}
        </div>
        {actionsEl}
      </>
    ) : (
      <>
        {iconEl}
        {bodyEl}
        {actionsEl}
        {onClose && <CloseButton label={closeLabel} onClick={onClose} />}
      </>
    );

    if (tone === 'error' || tone === 'warning') {
      return <div ref={ref} role="alert" className={cls} {...rest}>{content}</div>;
    }
    return <div ref={ref} role="status" className={cls} {...rest}>{content}</div>;
  },
);
Banner.displayName = 'Banner';
