import React, { forwardRef, useMemo } from 'react';
import { cn } from '../utils';

export type PaginationSize = 's' | 'm' | 'l';
export type PaginationVariant = 'default' | 'outline' | 'soft';

export interface PaginationProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  page: number;
  totalPages: number;
  onChange?: (page: number) => void;
  size?: PaginationSize;
  variant?: PaginationVariant;
  /** Кол-во соседей по краям диапазона. */
  siblingCount?: number;
  /** Показывать кнопки prev/next. */
  showPrevNext?: boolean;
  /** Подпись «1 из 10» вместо нумерации. */
  compact?: boolean;
  /** Подписи для prev/next/first/last. */
  labels?: {
    prev?: React.ReactNode; next?: React.ReactNode;
  };
}

function buildRange(page: number, total: number, siblings: number): (number | '…')[] {
  const totalNumbers = siblings * 2 + 5; // first, last, current, dots*2
  if (total <= totalNumbers) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const left = Math.max(2, page - siblings);
  const right = Math.min(total - 1, page + siblings);
  const showLeftDots = left > 2;
  const showRightDots = right < total - 1;
  const range: (number | '…')[] = [1];
  if (showLeftDots) range.push('…');
  for (let i = left; i <= right; i++) range.push(i);
  if (showRightDots) range.push('…');
  range.push(total);
  return range;
}

export const Pagination = forwardRef<HTMLElement, PaginationProps>(
  ({
    page, totalPages, onChange,
    size = 'm', variant = 'default',
    siblingCount = 1, showPrevNext = true, compact,
    labels, className, ...rest
  }, ref) => {
    const items = useMemo(
      () => buildRange(page, totalPages, siblingCount),
      [page, totalPages, siblingCount],
    );

    const goto = (p: number) => {
      const next = Math.max(1, Math.min(totalPages, p));
      if (next !== page) onChange?.(next);
    };

    const prevDisabled = page <= 1;
    const nextDisabled = page >= totalPages;

    return (
      <nav
        ref={ref}
        className={cn(
          'ou-pg',
          size !== 'm' && `ou-pg--${size}`,
          variant !== 'default' && `ou-pg--${variant}`,
          compact && 'ou-pg--compact',
          className,
        )}
        aria-label="Пагинация"
        {...rest}
      >
        {showPrevNext && (
          <button
            type="button" className="ou-pg__item"
            disabled={prevDisabled}
            aria-label="Предыдущая страница"
            onClick={() => goto(page - 1)}
          >
            {labels?.prev ?? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            )}
          </button>
        )}

        {compact ? (
          <span className="ou-pg__caption">
            <strong>{page}</strong> из <strong>{totalPages}</strong>
          </span>
        ) : items.map((it, i) => {
          if (it === '…') {
            return (
              <span key={`d-${i}`} className="ou-pg__item is-ellipsis" aria-hidden="true">…</span>
            );
          }
          const isCurrent = it === page;
          return (
            <button
              key={it} type="button"
              className={cn('ou-pg__item', isCurrent && 'is-current')}
              aria-current={isCurrent ? 'page' : undefined}
              aria-label={`Страница ${it}`}
              disabled={isCurrent}
              onClick={() => goto(it)}
            >{it}</button>
          );
        })}

        {showPrevNext && (
          <button
            type="button" className="ou-pg__item"
            disabled={nextDisabled}
            aria-label="Следующая страница"
            onClick={() => goto(page + 1)}
          >
            {labels?.next ?? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
          </button>
        )}
      </nav>
    );
  },
);
Pagination.displayName = 'Pagination';

// ─────────────────────────────────────────────────────────────────────────
// PaginationBar — page-size + summary + nav в одной строке
// ─────────────────────────────────────────────────────────────────────────

export interface PaginationBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Текущая страница (1-индексная). */
  page: number;
  pageSize: number;
  /** Всего записей. */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** Варианты размера страницы. */
  pageSizeOptions?: number[];
  /** Возможность перейти к конкретной странице. */
  jumpTo?: boolean;
}

export const PaginationBar = forwardRef<HTMLDivElement, PaginationBarProps>(
  ({
    page, pageSize, total,
    onPageChange, onPageSizeChange,
    pageSizeOptions = [10, 25, 50, 100],
    jumpTo, className, ...rest
  }, ref) => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    return (
      <div ref={ref} className={cn('ou-pg-bar', className)} {...rest}>
        <div className="ou-pg-bar__group">
          {onPageSizeChange && (
            <div className="ou-pg-bar__select">
              <span>Показывать по</span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                aria-label="Размер страницы"
                className="ou-pg-bar__picker-trigger"
              >
                {pageSizeOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <span className="ou-pg-bar__summary">
            <strong>{start}–{end}</strong> из <strong>{total}</strong>
          </span>
        </div>
        <div className="ou-pg-bar__group">
          {jumpTo && (
            <label className="ou-pg__jump">
              Перейти к
              <input
                type="number" min={1} max={totalPages}
                value={page}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 1 && n <= totalPages) onPageChange(n);
                }}
              />
            </label>
          )}
          <Pagination
            page={page} totalPages={totalPages}
            onChange={onPageChange}
            siblingCount={1}
          />
        </div>
      </div>
    );
  },
);
PaginationBar.displayName = 'PaginationBar';
