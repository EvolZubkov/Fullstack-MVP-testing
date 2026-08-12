import React, { forwardRef, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../utils';

export type ModalSize = 's' | 'm' | 'l' | 'xl';
export type ModalIconTone = 'danger' | 'warning' | 'success' | 'info' | 'neutral';

export interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  size?: ModalSize;
  footer?: React.ReactNode;
  /** Icon element in the header (with tone). */
  icon?: React.ReactNode;
  iconTone?: ModalIconTone;
  children?: React.ReactNode;
  /** Close on backdrop click. */
  closeOnBackdrop?: boolean;
  /** Close on Esc key. */
  closeOnEsc?: boolean;
  /** Hide the close button. */
  hideCloseButton?: boolean;
  /** Render into document.body via Portal. Default: true. */
  usePortal?: boolean;
  /** Extra class on the root element. */
  className?: string;
  /** aria-label when no title is provided. */
  ariaLabel?: string;
}

/** @deprecated Use ModalDialogProps */
export type ModalProps = ModalDialogProps;

export interface DialogHeaderProps {
  /** Dialog title. */
  title?: React.ReactNode;
  /** Dialog description / subtitle. */
  description?: React.ReactNode;
  /** Icon element — paired with iconTone for colored background. */
  icon?: React.ReactNode;
  iconTone?: ModalIconTone;
  className?: string;
}

/** Header section for composing inside ModalDialog. Renders title, description and optional icon. */
export const DialogHeader: React.FC<DialogHeaderProps> = ({
  title, description, icon, iconTone, className,
}) => (
  <header className={cn('ou-modal__head', icon ? 'ou-modal__head--icon' : undefined, className)}>
    {icon && (
      <div className={cn('ou-modal__icon', iconTone && `ou-modal__icon--${iconTone}`)}>
        {icon}
      </div>
    )}
    <div className="ou-modal__head-text">
      {title && <h2 className="ou-modal__title">{title}</h2>}
      {description && <p className="ou-modal__desc">{description}</p>}
    </div>
  </header>
);
DialogHeader.displayName = 'DialogHeader';

export interface DialogContentProps {
  children?: React.ReactNode;
  className?: string;
}

/** Scrollable body wrapper for composing inside ModalDialog. */
export const DialogContent: React.FC<DialogContentProps> = ({ children, className }) => (
  <div className={cn('ou-modal__body', className)}>{children}</div>
);
DialogContent.displayName = 'DialogContent';

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

export const ModalDialog = forwardRef<HTMLDivElement, ModalDialogProps>(
  ({
    open, onClose, title, description, size = 'm', footer,
    icon, iconTone, children,
    closeOnBackdrop = true, closeOnEsc = true, hideCloseButton, usePortal = true,
    className, ariaLabel,
  }, ref) => {
    const titleId = useId();
    const descId = useId();
    const rootRef = useRef<HTMLDivElement | null>(null);

    // Lock body scroll while open.
    useEffect(() => {
      if (!open) return;
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }, [open]);

    // Esc handler.
    useEffect(() => {
      if (!open || !closeOnEsc) return;
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [open, closeOnEsc, onClose]);

    if (!open) return null;

    const node = (
      <div
        ref={(el) => {
          rootRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) (ref as { current: HTMLDivElement | null }).current = el;
        }}
        className={cn('ou-modal-root', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        aria-label={!title && ariaLabel ? ariaLabel : undefined}
      >
        <div
          className="ou-modal__backdrop"
          onClick={closeOnBackdrop ? onClose : undefined}
        />
        <div className={cn('ou-modal', `ou-modal--${size}`)}>
          {(title || icon || description || !hideCloseButton) && (
            <header className={cn('ou-modal__head', icon ? 'ou-modal__head--icon' : undefined)}>
              {icon && (
                <div className={cn('ou-modal__icon', iconTone && `ou-modal__icon--${iconTone}`)}>
                  {icon}
                </div>
              )}
              <div className="ou-modal__head-text">
                {title && <h2 id={titleId} className="ou-modal__title">{title}</h2>}
                {description && <p id={descId} className="ou-modal__desc">{description}</p>}
              </div>
              {!hideCloseButton && (
                <button
                  type="button" className="ou-modal__close"
                  aria-label="Закрыть"
                  onClick={onClose}
                ><CloseIcon /></button>
              )}
            </header>
          )}
          <div className="ou-modal__body">{children}</div>
          {footer && <footer className="ou-modal__foot">{footer}</footer>}
        </div>
      </div>
    );

    if (!usePortal || typeof document === 'undefined') return node;
    return createPortal(node, document.body);
  },
);
ModalDialog.displayName = 'ModalDialog';

/** @deprecated Use ModalDialog */
export const Modal = ModalDialog;
