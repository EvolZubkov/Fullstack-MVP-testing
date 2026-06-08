import React from 'react';
import { cn, cssStyleClass } from '../utils';

export type TableChipTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/** Status badge for use inside Table cells. Renders `<span class="ou-tbl__chip ou-tbl__chip--{tone}">`. */
export const TableChip: React.FC<{
  tone?: TableChipTone;
  children: React.ReactNode;
}> = ({ tone = 'neutral', children }) => (
  <span className={cn('ou-tbl__chip', `ou-tbl__chip--${tone}`)}>{children}</span>
);
TableChip.displayName = 'TableChip';

export type TableDensity = 'compact' | 'normal' | 'spacious';
export type SortDir = 'asc' | 'desc';
export type TableAlign = 'left' | 'right' | 'center';

export interface TableColumn<T> {
  key: string;
  header: React.ReactNode;
  /** Кастомный рендер ячейки. По умолчанию — `row[key]`. */
  render?: (row: T, index: number) => React.ReactNode;
  /** Ширина (CSS). */
  width?: string | number;
  align?: TableAlign;
  sortable?: boolean;
  /** Делает столбец «numeric» (моноширинные цифры). */
  numeric?: boolean;
}

export interface TableProps<T> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  density?: TableDensity;
  /** Multi-select со столбцом чек-боксов слева. */
  selectable?: boolean;
  selected?: string[];
  onSelectChange?: (ids: string[]) => void;
  /** Сортировка (controlled). */
  sortKey?: string;
  sortDir?: SortDir;
  onSort?: (key: string, dir: SortDir) => void;
  /** Колбэк по клику в строку. */
  onRowClick?: (row: T, index: number) => void;
  /** Сообщение пустого состояния. */
  emptyMessage?: React.ReactNode;
  /** Подсветить строку по rowKey. */
  highlightedKey?: string;
}

const SortIcon: React.FC<{ dir?: SortDir; active?: boolean }> = ({ dir, active }) => (
  <svg
    viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={cn('ou-tbl__sort', active && dir && `is-${dir}`)}
    aria-hidden="true"
  >
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </svg>
);

export function Table<T>({
  columns, rows, rowKey,
  density = 'normal',
  selectable, selected = [], onSelectChange,
  sortKey, sortDir, onSort,
  onRowClick, emptyMessage, highlightedKey,
  className, style, ...rest
}: TableProps<T>) {
  const toggleAll = () => {
    if (!onSelectChange) return;
    if (selected.length === rows.length) onSelectChange([]);
    else onSelectChange(rows.map(rowKey));
  };
  const toggle = (id: string) => {
    if (!onSelectChange) return;
    onSelectChange(selected.includes(id)
      ? selected.filter(x => x !== id)
      : [...selected, id]);
  };

  const handleSort = (c: TableColumn<T>) => {
    if (!c.sortable || !onSort) return;
    const next: SortDir = sortKey === c.key && sortDir === 'asc' ? 'desc' : 'asc';
    onSort(c.key, next);
  };

  return (
    <div className={cn('ou-tbl', `ou-tbl--${density}`, className, cssStyleClass(style, 'ou-tbl-sx'))} {...rest}>
      <table>
        <thead>
          <tr>
            {selectable && (
              <th className="ou-tbl__sel">
                <input
                  type="checkbox"
                  aria-label="Выбрать все"
                  checked={selected.length === rows.length && rows.length > 0}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.length > 0 && selected.length < rows.length;
                  }}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map(c => (
              <th
                key={c.key}
                className={cn(
                  c.sortable && 'is-sortable',
                  cssStyleClass({ width: c.width, textAlign: c.align ?? 'left' }, 'ou-tbl-cell'),
                )}
                onClick={c.sortable ? () => handleSort(c) : undefined}
                aria-sort={sortKey === c.key
                  ? (sortDir === 'asc' ? 'ascending' : 'descending')
                  : (c.sortable ? 'none' : undefined)}
              >
                <span className="ou-tbl__th-inner">
                  {c.header}
                  {c.sortable && (
                    <SortIcon dir={sortDir} active={sortKey === c.key} />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                className="ou-tbl__empty"
                colSpan={columns.length + (selectable ? 1 : 0)}
              >
                {emptyMessage ?? 'Нет данных'}
              </td>
            </tr>
          ) : rows.map((row, idx) => {
            const id = rowKey(row);
            const isSel = selected.includes(id);
            const isHi = highlightedKey === id;
            return (
              <tr
                key={id}
                className={cn(isSel && 'is-selected', isHi && 'is-highlighted', onRowClick && 'is-clickable')}
                onClick={onRowClick ? () => onRowClick(row, idx) : undefined}
              >
                {selectable && (
                  <td className="ou-tbl__sel" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Выбрать строку ${idx + 1}`}
                      checked={isSel}
                      onChange={() => toggle(id)}
                    />
                  </td>
                )}
                {columns.map(c => (
                  <td
                    key={c.key}
                    className={cn(
                      c.numeric && 'is-numeric',
                      cssStyleClass({ textAlign: c.align ?? 'left' }, 'ou-tbl-cell'),
                    )}
                  >
                    {c.render
                      ? c.render(row, idx)
                      : ((row as unknown as Record<string, React.ReactNode>)[c.key] ?? null)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
Table.displayName = 'Table';
