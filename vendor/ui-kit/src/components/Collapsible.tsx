import React, {
  createContext, forwardRef, useCallback, useContext, useId, useState,
} from 'react';
import { cn } from '../utils';

interface CollapsibleCtx {
  open: boolean;
  toggle: () => void;
  contentId: string;
  disabled?: boolean;
}
const Ctx = createContext<CollapsibleCtx | null>(null);

export interface CollapsibleProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Controlled open state. Omit for an uncontrolled component. */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called with the next open state when the trigger is activated. */
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}

/**
 * Behavioural disclosure primitive: a `CollapsibleTrigger` toggles the
 * visibility of a `CollapsibleContent`. Works controlled (`open`/`onOpenChange`)
 * or uncontrolled (`defaultOpen`). It carries no visual chrome of its own — the
 * trigger and content are styled by the caller. For an opinionated, self-styled
 * multi-section list use `Accordion` instead.
 */
export const Collapsible = forwardRef<HTMLDivElement, CollapsibleProps>(
  ({ open: openProp, defaultOpen, onOpenChange, disabled, className, children, ...rest }, ref) => {
    const controlled = openProp !== undefined;
    const [internal, setInternal] = useState(defaultOpen ?? false);
    const open = controlled ? (openProp as boolean) : internal;
    const contentId = useId();

    const toggle = useCallback(() => {
      if (disabled) return;
      const next = !open;
      if (!controlled) setInternal(next);
      onOpenChange?.(next);
    }, [disabled, open, controlled, onOpenChange]);

    return (
      <Ctx.Provider value={{ open, toggle, contentId, disabled }}>
        <div
          ref={ref}
          className={cn('ou-collapsible', className)}
          data-state={open ? 'open' : 'closed'}
          {...rest}
        >
          {children}
        </div>
      </Ctx.Provider>
    );
  },
);
Collapsible.displayName = 'Collapsible';

export interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Merge trigger behaviour onto the single child element instead of a <button>. */
  asChild?: boolean;
}

/**
 * Toggles the parent `Collapsible`. With `asChild`, clones the single child and
 * injects the toggle handler plus `aria-expanded`/`aria-controls`; otherwise it
 * renders its own <button>.
 */
export const CollapsibleTrigger = forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(
  ({ asChild, onClick, children, ...rest }, ref) => {
    const ctx = useContext(Ctx);
    const aria = {
      'aria-expanded': ctx?.open ?? false,
      'aria-controls': ctx?.contentId,
      'data-state': ctx?.open ? 'open' : 'closed',
    } as const;

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<React.HTMLAttributes<HTMLElement>>;
      return React.cloneElement(child, {
        ...aria,
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          child.props.onClick?.(e);
          ctx?.toggle();
        },
      });
    }

    return (
      <button
        ref={ref}
        type="button"
        className="ou-collapsible__trigger"
        disabled={ctx?.disabled}
        onClick={(e) => { onClick?.(e); ctx?.toggle(); }}
        {...aria}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
CollapsibleTrigger.displayName = 'CollapsibleTrigger';

export interface CollapsibleContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Keep the content mounted (hidden) when closed instead of unmounting it. */
  forceMount?: boolean;
}

/** Content region shown while the parent `Collapsible` is open. */
export const CollapsibleContent = forwardRef<HTMLDivElement, CollapsibleContentProps>(
  ({ forceMount, hidden, children, ...rest }, ref) => {
    const ctx = useContext(Ctx);
    const open = ctx?.open ?? false;
    if (!open && !forceMount) return null;
    return (
      <div
        ref={ref}
        id={ctx?.contentId}
        hidden={open ? hidden : true}
        data-state={open ? 'open' : 'closed'}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
CollapsibleContent.displayName = 'CollapsibleContent';
