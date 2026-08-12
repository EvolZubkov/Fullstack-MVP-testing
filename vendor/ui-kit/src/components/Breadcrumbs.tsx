import React, { forwardRef, useMemo } from 'react';
import { cn } from '../utils';

export interface BreadcrumbItem {
  label: React.ReactNode;
  href?: string;
  icon?: React.ReactNode;
  /** Текст для aria-label (если label не строковый). */
  ariaLabel?: string;
  /** Колбэк по клику (для SPA-роутеров). Если задан — отменяет navigate. */
  onClick?: (e: React.MouseEvent) => void;
}

export type BreadcrumbsSeparator = 'chevron' | 'slash' | 'dot' | React.ReactNode;

export interface BreadcrumbsProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onClick'> {
  items: BreadcrumbItem[];
  separator?: BreadcrumbsSeparator;
  /** Сворачивать в «…» если элементов больше maxItems. */
  maxItems?: number;
  /** Колбэк по клику «…». */
  onExpand?: () => void;
}

const ChevronSep = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

function renderSep(sep: BreadcrumbsSeparator): React.ReactNode {
  if (sep === 'chevron' || sep === undefined) return <ChevronSep />;
  if (sep === 'slash') return '/';
  if (sep === 'dot') return '·';
  return sep;
}

export const Breadcrumbs = forwardRef<HTMLElement, BreadcrumbsProps>(
  ({
    items, separator = 'chevron', maxItems, onExpand,
    className, ...rest
  }, ref) => {
    const list = useMemo<(BreadcrumbItem | '…')[]>(() => {
      if (!maxItems || items.length <= maxItems) return items;
      // Keep first + last (maxItems-2) items, with '…' in slot 1.
      const tailCount = Math.max(1, maxItems - 2);
      return [items[0], '…', ...items.slice(items.length - tailCount)];
    }, [items, maxItems]);

    return (
      <nav
        ref={ref}
        className={cn('ou-crumbs', className)}
        aria-label="Хлебные крошки"
        {...rest}
      >
        <ol className="ou-crumbs__list">
          {list.flatMap((it, i) => {
            const isLast = i === list.length - 1;

            const item = it === '…' ? (
              <li key={`more-${i}`} className="ou-crumbs__item">
                <button
                  type="button" className="ou-crumbs__more"
                  aria-label="Показать промежуточные пути"
                  onClick={onExpand}
                >…</button>
              </li>
            ) : (
              <li key={i} className={cn('ou-crumbs__item', isLast && 'is-current')}>
                {isLast || (!it.href && !it.onClick) ? (
                  <span
                    className="ou-crumbs__crumb"
                    aria-current={isLast ? 'page' : undefined}
                    aria-label={it.ariaLabel}
                  >
                    {it.icon && <span className="ou-crumbs__ico">{it.icon}</span>}
                    {it.label}
                  </span>
                ) : (
                  <a
                    className="ou-crumbs__crumb"
                    href={it.href || '#'}
                    aria-label={it.ariaLabel}
                    onClick={it.onClick}
                  >
                    {it.icon && <span className="ou-crumbs__ico">{it.icon}</span>}
                    {it.label}
                  </a>
                )}
              </li>
            );

            if (isLast) return [item];
            return [
              item,
              <li key={`sep-${i}`} aria-hidden="true" className="ou-crumbs__sep">
                {renderSep(separator)}
              </li>,
            ];
          })}
        </ol>
      </nav>
    );
  },
);
Breadcrumbs.displayName = 'Breadcrumbs';
