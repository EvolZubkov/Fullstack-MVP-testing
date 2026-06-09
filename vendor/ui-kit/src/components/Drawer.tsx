import React, { forwardRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../utils';

export type DrawerSide = 'left' | 'right';
export type DrawerSize = 'narrow' | 'wide' | 'xl' | 'full';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: DrawerSide;
  size?: DrawerSize;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  hideCloseButton?: boolean;
  usePortal?: boolean;
  className?: string;
  ariaLabel?: string;
}

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

export const Drawer = forwardRef<HTMLDivElement, DrawerProps>(
  ({
    open, onClose, side = 'right', size = 'narrow',
    title, description, footer, children,
    closeOnBackdrop = true, closeOnEsc = true, hideCloseButton, usePortal = true,
    className, ariaLabel,
  }, ref) => {
    const titleId = useId();
    const descId = useId();

    useEffect(() => {
      if (!open) return;
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }, [open]);

    useEffect(() => {
      if (!open || !closeOnEsc) return;
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [open, closeOnEsc, onClose]);

    if (!open) return null;

    const node = (
      <div
        ref={ref}
        className={cn('ou-drawer-root', `ou-drawer-root--${side}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        aria-label={!title && ariaLabel ? ariaLabel : undefined}
      >
        <div
          className="ou-drawer__backdrop"
          onClick={closeOnBackdrop ? onClose : undefined}
        />
        <aside className={cn('ou-drawer', `ou-drawer--${size}`, `ou-drawer--${side}`)}>
          {(title || description || !hideCloseButton) && (
            <header className="ou-drawer__head">
              <div className="ou-drawer__head-text">
                {title && <h2 id={titleId} className="ou-drawer__title">{title}</h2>}
                {description && <p id={descId} className="ou-drawer__desc">{description}</p>}
              </div>
              {!hideCloseButton && (
                <button
                  type="button" className="ou-drawer__close"
                  aria-label="Закрыть"
                  onClick={onClose}
                ><CloseIcon /></button>
              )}
            </header>
          )}
          <div className="ou-drawer__body">{children}</div>
          {footer && <footer className="ou-drawer__foot">{footer}</footer>}
        </aside>
      </div>
    );

    if (!usePortal || typeof document === 'undefined') return node;
    return createPortal(node, document.body);
  },
);
Drawer.displayName = 'Drawer';
