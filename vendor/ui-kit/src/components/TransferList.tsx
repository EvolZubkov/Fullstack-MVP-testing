import React, {
  forwardRef, useCallback, useMemo, useState,
} from 'react';
import { cn, cssStyleClass } from '../utils';

export interface TransferItem {
  id: string;
  name: string;
  /** Подпись под именем. */
  meta?: React.ReactNode;
  /** Маленькая метка справа (например, «12 курсов», «62%»). */
  tag?: React.ReactNode;
  /** Аватар-цвет (purple/blue/green/orange/pink/...). */
  color?: string;
  /** Картинка аватара. Если не задано — нарисуем инициалы. */
  avatarSrc?: string;
  /** Произвольное произвольная категория (для фильтра). */
  category?: string;
  /** Запрещён к выбору. */
  disabled?: boolean;
}

export interface TransferFilter {
  /** Уникальный ключ фильтра. `all` — служебный. */
  value: string;
  label: React.ReactNode;
  /** Кастомная функция (если не передано — фильтрует по `item.category === filter.value`). */
  test?: (item: TransferItem) => boolean;
}

export interface TransferListProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Доступные элементы (левая колонка). */
  available: TransferItem[];
  /** Назначенные элементы (правая колонка). */
  assigned: TransferItem[];
  /** Колбэк при изменении распределения. */
  onChange?: (next: { available: TransferItem[]; assigned: TransferItem[] }) => void;
  /** Заголовок левой панели. */
  leftTitle?: React.ReactNode;
  /** Заголовок правой панели. */
  rightTitle?: React.ReactNode;
  /** Текст-плейсхолдер поиска. */
  searchPlaceholder?: string;
  /** Список фильтров для левой панели. */
  filters?: TransferFilter[];
  /** Компактный режим без аватаров. */
  compact?: boolean;
  /** Кастомный рендер строки (overrides default). */
  renderRow?: (item: TransferItem, side: 'L' | 'R', selected: boolean) => React.ReactNode;
  /** Подвал-summary (под обеими панелями). */
  showSummary?: boolean;
  /** Текст summary (если showSummary). */
  summary?: (state: { available: TransferItem[]; assigned: TransferItem[] }) => React.ReactNode;
}

function initials(name: string): string {
  return name.split(/\s+/).map(s => s.charAt(0)).slice(0, 2).join('').toUpperCase();
}

const Icons = {
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  right: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  ),
  rightAll: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 17 5-5-5-5M13 17l5-5-5-5" />
    </svg>
  ),
  left: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5M11 19l-7-7 7-7" />
    </svg>
  ),
  leftAll: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m18 17-5-5 5-5M11 17l-5-5 5-5" />
    </svg>
  ),
};

export const TransferList = forwardRef<HTMLDivElement, TransferListProps>(
  ({
    available, assigned, onChange,
    leftTitle = 'Доступно', rightTitle = 'Назначено',
    searchPlaceholder = 'Поиск',
    filters, compact, renderRow, showSummary, summary,
    className, style, ...rest
  }, ref) => {
    const [qL, setQL] = useState('');
    const [qR, setQR] = useState('');
    const [selL, setSelL] = useState<Set<string>>(new Set());
    const [selR, setSelR] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState<string>(filters ? filters[0]?.value ?? 'all' : 'all');

    const visible = useCallback((items: TransferItem[], side: 'L' | 'R'): TransferItem[] => {
      const q = (side === 'L' ? qL : qR).trim().toLowerCase();
      return items.filter(it => {
        if (side === 'L' && filters && filter !== 'all') {
          const f = filters.find(x => x.value === filter);
          if (f) {
            if (f.test) { if (!f.test(it)) return false; }
            else if (it.category !== filter) return false;
          }
        }
        if (!q) return true;
        const hay = (it.name + ' ' + (typeof it.meta === 'string' ? it.meta : '')).toLowerCase();
        return hay.includes(q);
      });
    }, [qL, qR, filter, filters]);

    const visAvail = useMemo(() => visible(available, 'L'), [visible, available]);
    const visAssign = useMemo(() => visible(assigned, 'R'), [visible, assigned]);

    const toggleSel = (side: 'L' | 'R', id: string) => {
      const set = side === 'L' ? new Set(selL) : new Set(selR);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      side === 'L' ? setSelL(set) : setSelR(set);
    };

    const selectAll = (side: 'L' | 'R', checked: boolean) => {
      const list = side === 'L' ? visAvail : visAssign;
      const ids = list.filter(i => !i.disabled).map(i => i.id);
      side === 'L' ? setSelL(new Set(checked ? ids : [])) : setSelR(new Set(checked ? ids : []));
    };

    const move = (direction: 'L→R' | 'R→L', all = false) => {
      const fromList = direction === 'L→R' ? available : assigned;
      const toList = direction === 'L→R' ? assigned : available;
      const visFrom = direction === 'L→R' ? visAvail : visAssign;
      const sel = direction === 'L→R' ? selL : selR;
      const move = all ? visFrom.map(i => i.id) : Array.from(sel);
      const moving = fromList.filter(i => move.includes(i.id) && !i.disabled);
      const nextFrom = fromList.filter(i => !move.includes(i.id) || i.disabled);
      const nextTo = [...toList, ...moving];
      if (direction === 'L→R') {
        onChange?.({ available: nextFrom, assigned: nextTo });
        setSelL(new Set());
      } else {
        onChange?.({ available: nextTo, assigned: nextFrom });
        setSelR(new Set());
      }
    };

    const Row = ({ item, side }: { item: TransferItem; side: 'L' | 'R' }) => {
      const sel = (side === 'L' ? selL : selR).has(item.id);
      if (renderRow) return <>{renderRow(item, side, sel)}</>;
      return (
        <div
          className={cn(
            'ou-transfer__row',
            compact && 'ou-transfer__row--compact',
            sel && 'is-selected',
            item.disabled && 'is-disabled',
          )}
          onClick={() => !item.disabled && toggleSel(side, item.id)}
        >
          <input
            type="checkbox"
            checked={sel} readOnly
            disabled={item.disabled}
            aria-label={item.name}
            onClick={(e) => e.stopPropagation()}
            onChange={() => !item.disabled && toggleSel(side, item.id)}
          />
          {!compact && (
            <span className="ou-transfer__row-avatar">
              <span className={cn('ou-avatar', 'ou-avatar--s', item.color && `ou-avatar--c-${item.color}`)}>
                {item.avatarSrc
                  ? <img src={item.avatarSrc} alt="" />
                  : <span className="ou-avatar__initials">{initials(item.name)}</span>}
              </span>
            </span>
          )}
          <span className="ou-transfer__row-text">
            <span className="ou-transfer__row-name">{item.name}</span>
            {item.meta && <span className="ou-transfer__row-meta">{item.meta}</span>}
          </span>
          {item.tag !== undefined && (
            <span className="ou-transfer__row-tag">{item.tag}</span>
          )}
        </div>
      );
    };

    const renderPane = (side: 'L' | 'R') => {
      const items = side === 'L' ? visAvail : visAssign;
      const total = side === 'L' ? available.length : assigned.length;
      const sel = side === 'L' ? selL : selR;
      const allChecked = items.length > 0 && items.every(i => i.disabled || sel.has(i.id));
      return (
        <div className="ou-transfer__pane">
          <div className="ou-transfer__header">
            <h3 className="ou-transfer__title">{side === 'L' ? leftTitle : rightTitle}</h3>
            <span className="ou-transfer__count">
              <strong>{items.length}</strong>{total !== items.length ? ` / ${total}` : ''}
            </span>
          </div>
          <div className="ou-transfer__search">
            {Icons.search}
            <input
              type="text" placeholder={searchPlaceholder}
              value={side === 'L' ? qL : qR}
              onChange={(e) => side === 'L' ? setQL(e.target.value) : setQR(e.target.value)}
              aria-label={`Поиск в «${side === 'L' ? leftTitle : rightTitle}»`}
            />
          </div>
          {side === 'L' && filters && (
            <div className="ou-transfer__filters">
              <button
                type="button"
                className={cn('ou-transfer__filter', filter === 'all' && 'is-active')}
                onClick={() => setFilter('all')}
              >Все</button>
              {filters.map(f => (
                <button
                  key={f.value} type="button"
                  className={cn('ou-transfer__filter', filter === f.value && 'is-active')}
                  onClick={() => setFilter(f.value)}
                >{f.label}</button>
              ))}
            </div>
          )}
          <div className="ou-transfer__toolbar">
            <label className="ou-transfer__select-all">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => selectAll(side, e.target.checked)}
              />
              <span>Выбрать всех{items.length ? ` (${items.length})` : ''}</span>
            </label>
            <span className="ou-transfer__summary-muted">
              {sel.size > 0 && `${sel.size} выбрано`}
            </span>
          </div>
          <div className="ou-transfer__list">
            {items.length === 0 ? (
              <div className="ou-transfer__empty">Ничего не найдено</div>
            ) : items.map(item => (
              <Row key={item.id} item={item} side={side} />
            ))}
          </div>
        </div>
      );
    };

    return (
      <div ref={ref} className={cn('ou-transfer', className, cssStyleClass(style, 'ou-transfer-sx'))} {...rest}>
        {renderPane('L')}
        <div className="ou-transfer__controls">
          <button
            type="button" className="ou-transfer__btn"
            aria-label="Назначить выбранных"
            disabled={selL.size === 0}
            onClick={() => move('L→R')}
          >{Icons.right}</button>
          <button
            type="button" className="ou-transfer__btn"
            aria-label="Назначить всех"
            disabled={visAvail.filter(i => !i.disabled).length === 0}
            onClick={() => move('L→R', true)}
          >{Icons.rightAll}</button>
          <button
            type="button" className="ou-transfer__btn"
            aria-label="Снять выбранных"
            disabled={selR.size === 0}
            onClick={() => move('R→L')}
          >{Icons.left}</button>
          <button
            type="button" className="ou-transfer__btn"
            aria-label="Снять всех"
            disabled={visAssign.filter(i => !i.disabled).length === 0}
            onClick={() => move('R→L', true)}
          >{Icons.leftAll}</button>
        </div>
        {renderPane('R')}
        {showSummary && (
          <div className="ou-transfer__summary">
            <span className="ou-transfer__summary-text">
              {summary
                ? summary({ available, assigned })
                : <>Назначено: <strong>{assigned.length}</strong> · Доступно: <strong>{available.length}</strong></>}
            </span>
          </div>
        )}
      </div>
    );
  },
);
TransferList.displayName = 'TransferList';
