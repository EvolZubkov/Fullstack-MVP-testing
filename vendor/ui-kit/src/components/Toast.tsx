import React, {
  createContext, forwardRef, useCallback, useContext,
  useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../utils';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: React.ReactNode;
  onClick?: () => void;
}

export interface ToastProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: ToastTone;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: ToastAction;
  /** Колбэк по крестику. */
  onClose?: () => void;
  closeLabel?: string;
}

const Icons: Record<ToastTone, React.ReactNode> = {
  success: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
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
};

export const Toast = forwardRef<HTMLDivElement, ToastProps>(
  ({
    tone = 'info', title, description, icon, action, onClose, closeLabel = 'Закрыть',
    className, ...rest
  }, ref) => {
    const cls = cn('ou-toast', `ou-toast--${tone}`, className);
    const body = (
      <>
        <span className="ou-toast__ico">{icon ?? Icons[tone]}</span>
        <div className="ou-toast__body">
          {title && <div className="ou-toast__title">{title}</div>}
          {description && <div className="ou-toast__desc">{description}</div>}
        </div>
        {action && (
          <button type="button" className="ou-toast__action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
        {onClose && (
          <button type="button" className="ou-toast__close" aria-label={closeLabel} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </>
    );
    if (tone === 'error' || tone === 'warning') {
      return <div ref={ref} role="alert" className={cls} {...rest}>{body}</div>;
    }
    return <div ref={ref} role="status" className={cls} {...rest}>{body}</div>;
  },
);
Toast.displayName = 'Toast';

// ─────────────────────────────────────────────────────────────────────────
// ToastProvider + useToast — stack manager
// ─────────────────────────────────────────────────────────────────────────

interface ToastQueueItem extends Omit<ToastProps, 'onClose'> {
  id: string;
  /** Авто-закрытие через N мс. 0 — никогда. */
  duration?: number;
}

interface ToastContextValue {
  push: (toast: Omit<ToastQueueItem, 'id'>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export interface ToastProviderProps {
  /** Дефолтная длительность (ms). */
  defaultDuration?: number;
  /** Лимит одновременно показываемых. */
  limit?: number;
  /** Через что портить. Default: document.body. */
  container?: HTMLElement;
  children?: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({
  defaultDuration = 5000, limit = 5, container, children,
}) => {
  const [items, setItems] = useState<ToastQueueItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    const t = timers.current.get(id);
    if (t) { window.clearTimeout(t); timers.current.delete(id); }
  }, []);

  const push = useCallback((t: Omit<ToastQueueItem, 'id'>): string => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setItems(prev => {
      const next = [...prev, { ...t, id }];
      return next.length > limit ? next.slice(next.length - limit) : next;
    });
    const dur = t.duration ?? defaultDuration;
    if (dur > 0) {
      const timer = window.setTimeout(() => dismiss(id), dur);
      timers.current.set(id, timer);
    }
    return id;
  }, [defaultDuration, limit, dismiss]);

  const clear = useCallback(() => {
    timers.current.forEach(t => window.clearTimeout(t));
    timers.current.clear();
    setItems([]);
  }, []);

  useEffect(() => () => { timers.current.forEach(t => window.clearTimeout(t)); }, []);

  const value = useMemo(() => ({ push, dismiss, clear }), [push, dismiss, clear]);

  const stack = (
    <div className="ou-toast-stack">
      {items.map(({ id, duration, ...t }) => (
        <Toast key={id} {...t} onClose={() => dismiss(id)} />
      ))}
    </div>
  );

  const portalNode = typeof document !== 'undefined'
    ? createPortal(stack, container ?? document.body)
    : null;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {portalNode}
    </ToastContext.Provider>
  );
};
ToastProvider.displayName = 'ToastProvider';

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}
