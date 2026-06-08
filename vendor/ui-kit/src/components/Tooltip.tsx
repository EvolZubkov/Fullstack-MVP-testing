import React, { forwardRef } from 'react';
import { cn } from '../utils';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';
export type TooltipTone = 'default' | 'accent' | 'success' | 'warning' | 'error' | 'light';

export interface TooltipProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'content' | 'title'> {
  /** Содержимое подсказки. */
  content: React.ReactNode;
  /** Заголовок (выделенная строка над content). */
  title?: React.ReactNode;
  /** Размещение относительно триггера. */
  placement?: TooltipPlacement;
  /** Тон. */
  tone?: TooltipTone;
  /** Многострочный bubble (wrap). */
  wrap?: boolean;
  /**
   * Keyboard shortcut shown after content.
   * Pass a string[] for multi-segment shortcuts: `['Cmd', 'S']` renders
   * Cmd as `<span class="ou-mac-only">⌘</span><span class="ou-pc-only">Ctrl</span>`
   * and each additional key as a separate `<span class="ou-tip__kbd">`.
   */
  shortcut?: React.ReactNode | string[];
  /** Триггер (любой ReactNode). */
  children: React.ReactNode;
  /** Принудительно показать (для showcase). */
  open?: boolean;
}

/**
 * UniversityRT · Tooltip.
 *
 * Pure CSS hover/focus поведение — bubble показывается при hover на родительском
 * `.ou-tip` (или классе `is-open`). Для управляемого режима используйте `open`.
 */
/** Renders `['Cmd', 'S']` as platform-aware kbd spans matching the reference markup. */
function renderShortcut(shortcut: React.ReactNode | string[]): React.ReactNode {
  if (!Array.isArray(shortcut)) {
    return shortcut ? <span className="ou-tip__kbd">{shortcut}</span> : null;
  }
  return shortcut.map((key, i) => {
    if (key === 'Cmd' || key === 'Ctrl') {
      return (
        <span key={i} className="ou-tip__kbd">
          <span className="ou-mac-only">⌘</span>
          <span className="ou-pc-only">Ctrl</span>
        </span>
      );
    }
    return <span key={i} className="ou-tip__kbd">{key}</span>;
  });
}

export const Tooltip = forwardRef<HTMLSpanElement, TooltipProps>(
  ({
    content, title, placement = 'top', tone, wrap, shortcut,
    children, open, className, ...rest
  }, ref) => (
    <span
      ref={ref}
      className={cn(
        'ou-tip',
        tone && tone !== 'default' && `ou-tip--${tone}`,
        open && 'is-open',
        className,
      )}
      data-placement={placement}
      {...rest}
    >
      {children}
      <span
        className={cn('ou-tip__bubble', wrap && 'ou-tip__bubble--wrap')}
        role="tooltip"
      >
        {title && <span className="ou-tip__title">{title}</span>}
        {content}
        {shortcut != null && renderShortcut(shortcut)}
      </span>
    </span>
  ),
);
Tooltip.displayName = 'Tooltip';
