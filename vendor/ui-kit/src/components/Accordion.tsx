import React, {
  createContext, forwardRef, useCallback, useContext, useId, useState,
} from 'react';
import { cn } from '../utils';

export type AccordionVariant = 'plain' | 'bordered' | 'separated';
export type AccordionType = 'single' | 'multiple';

// ─────────────────────────────────────────────────────────────────────────
// Context (для AccordionItem)
// ─────────────────────────────────────────────────────────────────────────

interface AccordionCtx {
  value: string[];
  setValue: (next: string[]) => void;
  type: AccordionType;
  collapsible: boolean;
}
const Context = createContext<AccordionCtx | null>(null);

// ─────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────

export interface AccordionProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  variant?: AccordionVariant;
  type?: AccordionType;
  /** Можно ли закрыть единственный открытый (для type=single). */
  collapsible?: boolean;
  /** Контролируемое значение. */
  value?: string | string[];
  defaultValue?: string | string[];
  onChange?: (value: string | string[]) => void;
}

function asArray(v?: string | string[]): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export const Accordion = forwardRef<HTMLDivElement, AccordionProps>(
  ({
    variant = 'plain', type = 'single', collapsible = true,
    value, defaultValue, onChange,
    className, children, ...rest
  }, ref) => {
    const controlled = value !== undefined;
    const [internal, setInternal] = useState<string[]>(asArray(defaultValue));
    const current = controlled ? asArray(value) : internal;

    const setValue = useCallback((next: string[]) => {
      if (!controlled) setInternal(next);
      onChange?.(type === 'single' ? (next[0] ?? '') : next);
    }, [controlled, onChange, type]);

    return (
      <Context.Provider value={{ value: current, setValue, type, collapsible }}>
        <div
          ref={ref}
          className={cn('ou-acc', `ou-acc--${variant}`, className)}
          {...rest}
        >{children}</div>
      </Context.Provider>
    );
  },
);
Accordion.displayName = 'Accordion';

// ─────────────────────────────────────────────────────────────────────────
// Item
// ─────────────────────────────────────────────────────────────────────────

export interface AccordionItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Уникальный id для controlled state. */
  value: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Лидирующая иконка. */
  icon?: React.ReactNode;
  /** Trail-контент (бейдж и т.п.). */
  trailing?: React.ReactNode;
  disabled?: boolean;
}

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const AccordionItem = forwardRef<HTMLDivElement, AccordionItemProps>(
  ({
    value, title, subtitle, icon, trailing, disabled,
    className, children, ...rest
  }, ref) => {
    const ctx = useContext(Context);
    if (!ctx) throw new Error('AccordionItem must be used inside <Accordion>');
    const headerId = useId();
    const bodyId = useId();
    const isOpen = ctx.value.includes(value);

    const toggle = () => {
      if (disabled) return;
      if (ctx.type === 'single') {
        if (isOpen) {
          if (ctx.collapsible) ctx.setValue([]);
        } else {
          ctx.setValue([value]);
        }
      } else {
        ctx.setValue(isOpen ? ctx.value.filter(v => v !== value) : [...ctx.value, value]);
      }
    };

    const triggerProps = {
      type: 'button' as const,
      id: headerId,
      className: 'ou-acc__trigger',
      'aria-controls': bodyId,
      disabled,
      onClick: toggle,
    };
    const triggerContent = (
      <>
        {icon && <span className="ou-acc__trigger-ico">{icon}</span>}
        <span className="ou-acc__trigger-text">
          <span className="ou-acc__title">{title}</span>
          {subtitle && <span className="ou-acc__subtitle">{subtitle}</span>}
        </span>
        {trailing}
        <span className="ou-acc__chev"><ChevronIcon /></span>
      </>
    );

    return (
      <div
        ref={ref}
        className={cn('ou-acc__item', isOpen && 'is-open', disabled && 'is-disabled', className)}
        {...rest}
      >
        {isOpen
          ? <button {...triggerProps} aria-expanded="true">{triggerContent}</button>
          : <button {...triggerProps} aria-expanded="false">{triggerContent}</button>
        }
        <div
          id={bodyId}
          role="region"
          aria-labelledby={headerId}
          className="ou-acc__body"
        >{children}</div>
      </div>
    );
  },
);
AccordionItem.displayName = 'AccordionItem';
