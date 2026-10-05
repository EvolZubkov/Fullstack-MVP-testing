/**
 * @module ui-kit/components/FilterPanel
 * @description The one form of filter conditions: a panel that opens right under the «Фильтр»
 * button of a `FilterBar`, holds groups of fields and applies them only on «Применить».
 *
 * Closing the panel — a click outside, `Esc` or the button again — IS the cancel: the draft is
 * dropped, so there is no «Отмена». «Сбросить» clears the draft, not what is applied.
 */
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../utils';
import { Button } from './Button';
import { Popover } from './Popover';
import { Text } from './Typography';

export interface FilterPanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onReset'> {
  open: boolean;
  /** Closes without applying: the draft is the caller's to drop. */
  onClose: () => void;
  /** The «Фильтр» button of the bar (`FilterBar.filterButtonRef`). */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Applies the draft; the caller closes the panel. */
  onApply: () => void;
  /** Clears the conditions of the draft. */
  onReset: () => void;
  applyLabel?: string;
  resetLabel?: string;
  /** Accessible name of the panel. */
  label?: string;
}

/** Gap between the button and the panel, px. */
const OFFSET = 4;
/** Room kept free under the panel, px. */
const MARGIN = 8;
/** Below this the panel would be a slit; with less room it flips above the button. */
const MIN_HEIGHT = 240;

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Filter panel over `Popover`: 480 px, no arrow, flush with the left edge of the button.
 * The body scrolls, the footer stays visible.
 */
export function FilterPanel({
  open,
  onClose,
  anchorRef,
  onApply,
  onReset,
  applyLabel = 'Применить',
  resetLabel = 'Сбросить',
  label = 'Фильтр',
  className,
  style,
  children,
  ...rest
}: FilterPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(open);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  // The panel never runs past the bottom of the window: under a button low on the page its
  // footer — the only way to apply — would be out of sight. The body scrolls instead.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const fit = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewH = document.documentElement.clientHeight || window.innerHeight;
      setMaxHeight(Math.max(MIN_HEIGHT, Math.floor(viewH - anchor.bottom - OFFSET - MARGIN)));
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit, true);
    };
  }, [open, anchorRef]);

  // Focus goes to the first field on open and back to the button on close: a keyboard user
  // must not be left on a panel that is gone.
  useEffect(() => {
    if (open && !wasOpen.current) {
      panelRef.current?.querySelector<HTMLElement>(`.ou-popover__body ${FOCUSABLE}`)?.focus();
    }
    if (!open && wasOpen.current) anchorRef.current?.focus();
    wasOpen.current = open;
  }, [open, anchorRef]);

  return (
    <Popover
      ref={panelRef}
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      placement="bottom"
      align="start"
      size="xl"
      arrow={false}
      offset={OFFSET}
      style={maxHeight === undefined ? style : { ...style, maxHeight }}
      aria-label={label}
      className={cn('ou-filterpanel', className)}
      footerAlign="between"
      footer={(
        <>
          <Button variant="ghost" size="s" onClick={onReset}>{resetLabel}</Button>
          <Button variant="primary" size="s" onClick={onApply}>{applyLabel}</Button>
        </>
      )}
      {...rest}
    >
      {children}
    </Popover>
  );
}

export interface FilterPanelGroupProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Heading of the group, in sentence case. */
  title: React.ReactNode;
  /** Lay the content out in a wrapping row — for checkboxes and switches. */
  inline?: boolean;
}

/** One group of the panel: a heading and its fields. */
export function FilterPanelGroup({ title, inline = false, className, children, ...rest }: FilterPanelGroupProps) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className={cn('ou-filterpanel__group', className)} {...rest}>
      <Text id={titleId} variant="body-s" weight="medium">{title}</Text>
      {inline ? <div className="ou-filterpanel__row">{children}</div> : children}
    </div>
  );
}

FilterPanel.Group = FilterPanelGroup;
