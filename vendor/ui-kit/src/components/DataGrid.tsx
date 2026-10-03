import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn, cssStyleClass } from '../utils';
import type { SortDir, TableAlign } from './Table';

export interface DataGridColumn<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T, index: number) => React.ReactNode;
  width?: string | number;
  align?: TableAlign;
  sortable?: boolean;
  /**
   * Сделать столбец числовым (моно-цифры; без `align` — правое выравнивание).
   * Явный `align` важнее: числовой столбец по центру — `numeric` + `align: 'center'`.
   */
  numeric?: boolean;
  /** Зафиксировать столбец слева (sticky). */
  frozen?: boolean;
  /** Кастомный экстрактор значения для сортировки/поиска. */
  accessor?: (row: T) => string | number | undefined;
}

/**
 * Выравнивание столбца: явное `align`, иначе числа — вправо, остальное — влево.
 * Заголовок и значения столбца выравниваются ОДИНАКОВО: заголовок, оторванный от своих чисел
 * на ширину колонки, читается как подпись соседнего столбца.
 */
function columnAlign<T>(c: DataGridColumn<T>): TableAlign {
  return c.align ?? (c.numeric ? 'right' : 'left');
}

export interface DataGridProps<T> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect' | 'title'> {
  columns: DataGridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;

  /** Заголовок тулбара. */
  title?: React.ReactNode;
  /** Доп. контролы в тулбаре справа. */
  toolbarExtra?: React.ReactNode;

  /** Поиск (контролируемый). */
  query?: string;
  onQueryChange?: (q: string) => void;
  searchPlaceholder?: string;

  /** Сортировка. */
  sortKey?: string;
  sortDir?: SortDir;
  onSort?: (key: string, dir: SortDir) => void;

  /** Выбор строк. */
  selectable?: boolean;
  selected?: string[];
  onSelectChange?: (ids: string[]) => void;
  /** Действия над выделением (показываются в bulkbar). */
  bulkActions?: React.ReactNode;

  /** Раскрытие строки. */
  expandable?: boolean;
  /** Render содержимого раскрытой строки. */
  renderExpanded?: (row: T, index: number) => React.ReactNode;
  /**
   * Какие строки раскрываются. Без предиката раскрываются все.
   *
   * Строка, на которой предикат ложен, не получает шеврона вовсе — ячейка
   * остаётся пустой, чтобы колонки соседних строк не разъезжались. Это про
   * строки, под которыми нечего показать: раскрытие в пустоту читается как
   * обещание, которого стол не держит.
   */
  canExpand?: (row: T, index: number) => boolean;

  /**
   * Строку РАЗВЕРНУЛИ. Вызывается только на открытии, не на закрытии.
   *
   * Нужен содержимому, которое грузится по требованию: состояние раскрытия держит сам стол,
   * и без этого события у вызывающего нет места, где начать загрузку. В `renderExpanded`
   * этого делать нельзя — он вызывается на каждой перерисовке.
   */
  onRowExpand?: (row: T, index: number) => void;

  /**
   * Ленивая подгрузка вместо страниц: есть ли ещё строки за последней показанной.
   *
   * Пока он задан, постраничность не рисуется — два способа двигаться по одному списку
   * противоречат друг другу, и подвал должен говорить что-то одно.
   */
  hasMore?: boolean;
  /** Сколько строк подходит под условия всего — знаменатель «показано N из M». */
  total?: number;
  /** Идёт загрузка следующей порции: повторный запрос не отправляется. */
  loadingMore?: boolean;
  /** Запросить следующую порцию — зовётся, когда хвост списка показался на экране. */
  onLoadMore?: () => void;

  /** Пагинация. */
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;

  /** Сообщение пустого состояния. */
  emptyMessage?: React.ReactNode;

  /**
   * Стол занимает экран: потолок прокрутки считается от вьюпорта, а не от умолчания в 540px.
   *
   * Для стола, который и есть содержимое страницы (реестр, журнал): иначе строки листаются в
   * окошке, под которым остаётся пустой экран. Столу ВНУТРИ страницы, рядом с другими
   * блоками, этот режим не нужен — там окошко и есть верное поведение.
   */
  fill?: boolean;

  /**
   * Open the row itself. The row gets `is-clickable` (pointer cursor), the way
   * `Table` already does it, so a grid whose rows lead somewhere does not have to
   * spend a column on a link.
   *
   * Clicks coming from the control cells (expand chevron, selection checkbox) and
   * from anything interactive inside a cell — a button, a link, an input — are the
   * cell's own and never reach here: opening the row out from under a button the
   * user actually pressed is the bug this guard exists for.
   */
  onRowClick?: (row: T, index: number) => void;
}

/** Whether the click landed on something that handles it itself. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return !!el?.closest('button, a, input, select, textarea, label, [role="button"], .ou-grid__control-cell');
}

const SortIcon: React.FC<{ dir?: SortDir; active?: boolean }> = ({ dir, active }) => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {active && dir === 'asc' ? <path d="m7 9 5-5 5 5" />
      : active && dir === 'desc' ? <path d="m7 15 5 5 5-5" />
        : (<><path d="m7 9 5-5 5 5" /><path d="m7 15 5 5 5-5" /></>)}
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const ExpandChev = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export function DataGrid<T>({
  columns, rows, rowKey,
  title, toolbarExtra,
  query, onQueryChange, searchPlaceholder = 'Поиск',
  sortKey, sortDir, onSort,
  selectable, selected = [], onSelectChange, bulkActions,
  expandable, renderExpanded, canExpand, onRowExpand,
  page, pageSize, total, onPageChange, pageSizeOptions, onPageSizeChange,
  hasMore, loadingMore, onLoadMore,
  emptyMessage = 'Нет данных',
  fill,
  onRowClick,
  className, style, ...rest
}: DataGridProps<T>) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const scrollArea = useRef<HTMLDivElement | null>(null);

  /**
   * Точный потолок стола в режиме `fill`: от его фактического верха до низа окна.
   *
   * CSS один этого не умеет. Вычесть из высоты окна фиксированную величину — значит угадать
   * высоту всего, что стоит выше: шапки, вкладок, заголовка карточки, панели фильтра с чипами,
   * которых бывает одна строка, а бывает три. Промах в любую сторону виден сразу: стол либо
   * не достаёт до низа экрана, либо вылезает за него и страница получает ВТОРУЮ прокрутку —
   * ту самую, из-за которой закреплённая шапка перестаёт держаться.
   *
   * Замер повторяется при изменении размера окна и при перекладке страницы. CSS-правило
   * `.ou-grid--fill` остаётся запасным: оно работает там, где скрипта нет вовсе (эскизы).
   */
  useEffect(() => {
    const area = scrollArea.current;
    if (!fill || !area || typeof window === 'undefined') return;

    /** Запас снизу: нижнее поле карточки и воздух страницы под ней. */
    const GAP = 48;

    const apply = () => {
      const top = area.getBoundingClientRect().top + window.scrollY;
      const footer = area.nextElementSibling as HTMLElement | null;
      const below = footer ? footer.getBoundingClientRect().height : 0;
      const room = window.innerHeight - top - below - GAP;
      area.style.maxHeight = `${Math.max(room, 240)}px`;
    };

    apply();
    window.addEventListener('resize', apply);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(apply);
    if (observer && area.parentElement) observer.observe(area.parentElement);

    return () => {
      window.removeEventListener('resize', apply);
      observer?.disconnect();
    };
  }, [fill, rows.length]);

  // Хвост списка виден — значит пора за следующей порцией. Наблюдатель не заводится, когда
  // догружать нечего или запрос уже в пути: иначе одна прокрутка выстреливает несколько раз.
  useEffect(() => {
    if (!hasMore || !onLoadMore || loadingMore) return;
    const target = sentinel.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) onLoadMore();
    }, { root: target.closest('.ou-grid__scroll') });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore, rows.length]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string, row: T, index: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        onRowExpand?.(row, index);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!onSelectChange) return;
    onSelectChange(selected.length === rows.length ? [] : rows.map(rowKey));
  };
  const toggle = (id: string) => {
    if (!onSelectChange) return;
    onSelectChange(selected.includes(id)
      ? selected.filter(x => x !== id)
      : [...selected, id]);
  };

  const onClickHeader = (c: DataGridColumn<T>) => {
    if (!c.sortable || !onSort) return;
    const next: SortDir = sortKey === c.key && sortDir === 'asc' ? 'desc' : 'asc';
    onSort(c.key, next);
  };

  // Frozen columns get `col-stick` class; last frozen gets shadow.
  const frozenIndices = useMemo(() => {
    const arr: number[] = [];
    columns.forEach((c, i) => { if (c.frozen) arr.push(i); });
    return arr;
  }, [columns]);
  const lastFrozen = frozenIndices.length ? frozenIndices[frozenIndices.length - 1] : -1;

  const totalRows = total ?? rows.length;
  const showPager = hasMore === undefined
    && page !== undefined && pageSize !== undefined && onPageChange !== undefined;
  const totalPages = showPager ? Math.max(1, Math.ceil(totalRows / pageSize!)) : 1;

  /**
   * Счётчик — спутник заголовка, а не самостоятельный блок: без заголовка, поиска и своих
   * кнопок над таблицей осталось бы одно число, которое читателю не к чему отнести (сколько
   * чего и из скольких — это говорят подвал и подзаголовок карточки).
   */
  const showToolbar = Boolean(title || onQueryChange || toolbarExtra);

  return (
    <div
      className={cn('ou-grid', fill && 'ou-grid--fill', className, cssStyleClass(style, 'ou-grid-sx'))}
      {...rest}
    >
      {/* Toolbar */}
      {showToolbar && (
        <div className="ou-grid__toolbar">
          {title && <span className="ou-grid__toolbar-title">{title}</span>}
          <span className="ou-grid__toolbar-count">{totalRows}</span>
          <span className="ou-grid__toolbar-spacer" />
          {onQueryChange && (
            <div className="ou-grid__search">
              <SearchIcon />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={query ?? ''}
                onChange={(e) => onQueryChange(e.target.value)}
                aria-label={searchPlaceholder}
              />
            </div>
          )}
          {toolbarExtra}
        </div>
      )}

      {/* Bulk bar */}
      {selectable && selected.length > 0 && (
        <div className="ou-grid__bulkbar">
          <span className="ou-grid__bulkbar-count">Выбрано: {selected.length}</span>
          <button
            type="button" className="ou-grid__btn"
            onClick={() => onSelectChange?.([])}
          >Снять выделение</button>
          {bulkActions && <span className="ou-grid__bulkbar-actions">{bulkActions}</span>}
        </div>
      )}

      <div className="ou-grid__scroll" ref={scrollArea}>
        <table className="ou-grid__table">
          <thead>
            <tr>
              {expandable && <th className="ou-grid__control-cell" />}
              {selectable && (
                <th className={cn('ou-grid__control-cell', lastFrozen === -1 && 'col-stick col-stick--shadow')}>
                  <input
                    type="checkbox"
                    className="ou-grid__check"
                    aria-label="Выбрать все"
                    checked={selected.length === rows.length && rows.length > 0}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.length > 0 && selected.length < rows.length;
                    }}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  className={cn(
                    c.frozen && 'col-stick',
                    i === lastFrozen && 'col-stick--shadow',
                    cssStyleClass({ width: c.width, textAlign: columnAlign(c) }, 'ou-grid-cell'),
                  )}
                >
                  {/* Ячейка заголовка — гибкий ряд: `text-align` её не двигает, поэтому
                      выравнивание передаётся модификатором. */}
                  <div
                    className={cn(
                      'ou-grid__th',
                      columnAlign(c) !== 'left' && `ou-grid__th--${columnAlign(c)}`,
                      sortKey === c.key && 'is-sorted',
                      c.sortable && 'is-sortable',
                    )}
                    onClick={() => onClickHeader(c)}
                  >
                    {c.header}
                    {c.sortable && <SortIcon dir={sortDir} active={sortKey === c.key} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0) + (expandable ? 1 : 0)}
                  className="ou-grid__empty"
                >{emptyMessage}</td>
              </tr>
            ) : rows.map((row, idx) => {
              const id = rowKey(row);
              const isSel = selected.includes(id);
              const canExp = expandable ? (canExpand ? canExpand(row, idx) : true) : false;
              const isExp = canExp && expanded.has(id);
              return (
                <React.Fragment key={id}>
                  <tr
                    className={cn(isSel && 'is-selected', onRowClick && 'is-clickable')}
                    onClick={onRowClick
                      ? (e) => { if (!isInteractiveTarget(e.target)) onRowClick(row, idx); }
                      : undefined}
                  >
                    {expandable && (
                      <td className="ou-grid__control-cell">
                        {canExp && (
                          <button
                            type="button"
                            className={cn('ou-grid__expand-btn', isExp && 'is-open')}
                            aria-label={isExp ? 'Свернуть' : 'Развернуть'}
                            {...(isExp ? { 'aria-expanded': 'true' as const } : { 'aria-expanded': 'false' as const })}
                            onClick={() => toggleExpand(id, row, idx)}
                          ><ExpandChev /></button>
                        )}
                      </td>
                    )}
                    {selectable && (
                      <td
                        className={cn('ou-grid__control-cell', lastFrozen === -1 && 'col-stick col-stick--shadow')}
                      >
                        <input
                          type="checkbox"
                          className="ou-grid__check"
                          aria-label={`Выбрать строку ${idx + 1}`}
                          checked={isSel}
                          onChange={() => toggle(id)}
                        />
                      </td>
                    )}
                    {columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={cn(
                          c.numeric && 'is-numeric',
                          // Явное выравнивание перебивает правое у `is-numeric`.
                          c.align && `is-align-${c.align}`,
                          c.frozen && 'col-stick',
                          i === lastFrozen && 'col-stick--shadow',
                          cssStyleClass({ textAlign: columnAlign(c) }, 'ou-grid-cell'),
                        )}
                      >
                        {c.render
                          ? c.render(row, idx)
                          : ((row as unknown as Record<string, React.ReactNode>)[c.key] ?? null)}
                      </td>
                    ))}
                  </tr>
                  {isExp && renderExpanded && (
                    <tr className="ou-grid__expanded">
                      <td colSpan={columns.length + (selectable ? 1 : 0) + 1}>
                        <div className="ou-grid__expanded-inner">
                          {renderExpanded(row, idx)}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {/*
          Хвост для наблюдателя — последний элемент ПРОКРУЧИВАЕМОЙ области. Положенный
          снаружи, он попадает в видимую часть сразу и запускает догрузку до конца списка.
        */}
        {hasMore && <div ref={sentinel} className="ou-grid__sentinel" aria-hidden="true" />}
      </div>

      {/* Подвал ленивого списка: сколько показано из скольких. */}
      {hasMore !== undefined && (
        <div className="ou-grid__footer">
          <span>Показано {rows.length}{total === undefined ? '' : ` из ${total}`}</span>
          <span>{loadingMore ? 'Загружаем следующие…' : hasMore ? 'Следующие подгружаются при прокрутке' : ''}</span>
        </div>
      )}

      {/* Footer / pagination */}
      {showPager && (
        <div className="ou-grid__footer">
          <span>
            Стр. {page} из {totalPages}
            {pageSizeOptions && onPageSizeChange && (
              <>
                {' · '}
                <select
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  aria-label="Размер страницы"
                  className="ou-grid__page-size"
                >
                  {pageSizeOptions.map(s => <option key={s} value={s}>{s} / стр.</option>)}
                </select>
              </>
            )}
          </span>
          <div className="ou-grid__pager">
            <button
              type="button" className="ou-grid__pager-btn"
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >‹</button>
            <span className="ou-grid__pager-btn" aria-current="page">{page}</span>
            <button
              type="button" className="ou-grid__pager-btn"
              disabled={page >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            >›</button>
          </div>
        </div>
      )}
    </div>
  );
}
DataGrid.displayName = 'DataGrid';

// ─────────────────────────────────────────────────────────────────────────
// Helpers: inline progress + cell helpers
// ─────────────────────────────────────────────────────────────────────────

export const DataGridProgress: React.FC<{
  value: number; tone?: 'accent' | 'success' | 'warn' | 'danger';
}> = ({ value, tone = 'accent' }) => (
  <span
    className={cn('ou-grid__progress', tone !== 'accent' && `ou-grid__progress--${tone}`)}
  >
    <span className="ou-grid__progress-track">
      <span
        className={cn(
          'ou-grid__progress-fill',
          cssStyleClass({ width: `${Math.max(0, Math.min(100, value))}%` }, 'ou-grid-progress'),
        )}
      />
    </span>
    <span>{value}%</span>
  </span>
);
DataGridProgress.displayName = 'DataGridProgress';
