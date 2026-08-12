import React, {
  forwardRef, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../utils';

export interface CommandItem<T = unknown> {
  id: string;
  /** Заголовок строки. */
  title: string;
  /** Иконка слева. */
  icon?: React.ReactNode;
  /** Мелкий мета-текст под title. */
  meta?: React.ReactNode;
  /** Trail-контент (шорткат, бейдж и т.п.). */
  trailing?: React.ReactNode;
  /** Шорткат-подсказка (рендерится как `<kbd>`). */
  shortcut?: string[];
  /** Группа (заголовок секции). */
  group?: string;
  /** Скоуп (для фильтрации по табам). */
  scope?: string;
  /** Произвольные ключевые слова для поиска (доп. к title). */
  keywords?: string[];
  /** Произвольные данные. */
  data?: T;
  disabled?: boolean;
}

export interface CommandScope {
  value: string;
  label: React.ReactNode;
}

export interface CommandPaletteProps<T = unknown> {
  open: boolean;
  onClose: () => void;
  items: CommandItem<T>[];
  /** Скоупы-табы (если есть). Если задано — фильтр срабатывает по `item.scope`. */
  scopes?: CommandScope[];
  /** Стартовый скоуп. */
  defaultScope?: string;
  /** Колбэк при выборе строки. */
  onSelect?: (item: CommandItem<T>) => void;
  /** Плейсхолдер поиска. */
  placeholder?: string;
  /** Подсказка справа в строке поиска (kbd). */
  searchHint?: React.ReactNode;
  /** Содержимое подвала (по умолчанию — стандартные kbd-подсказки). */
  footer?: React.ReactNode;
  /** Включает подсветку совпадений запроса. По умолчанию true. */
  highlightMatches?: boolean;
  /** Render в портале. */
  usePortal?: boolean;
  /** Тестовый id. */
  className?: string;
  /** Сообщение empty-state. */
  emptyMessage?: React.ReactNode;
  /** Label for the "all scopes" tab. Default: 'Все'. */
  allScopeLabel?: React.ReactNode;
}

/** True when running on macOS / iOS. Safe in SSR (returns false). */
const isMac: boolean = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

const CMD_KEYS = new Set(['⌘', 'Cmd', 'Meta', 'Command']);

/** Translates canonical modifier keys to platform-appropriate labels. */
function resolveKey(k: string): string {
  if (CMD_KEYS.has(k)) return isMac ? '⌘' : 'Ctrl';
  return k;
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function CommandPaletteInner<T>(
  {
    open, onClose, items, scopes, defaultScope, onSelect,
    placeholder = 'Поиск команд, курсов, людей…',
    searchHint, footer,
    highlightMatches = true, usePortal = true,
    className, emptyMessage, allScopeLabel = 'Все',
  }: CommandPaletteProps<T>,
  ref: React.Ref<HTMLDivElement>,
) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string>(defaultScope ?? scopes?.[0]?.value ?? 'all');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on open + reset.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    if (defaultScope) setScope(defaultScope);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, defaultScope]);

  // Body scroll lock.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(it => {
      if (scopes && scope !== 'all' && it.scope !== scope) return false;
      if (it.disabled) return true; // keep visible but unactionable within scope
      if (!q) return true;
      const hay = [it.title, ...(it.keywords ?? []), typeof it.meta === 'string' ? it.meta : '']
        .join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [items, query, scope, scopes]);

  // Group filtered items.
  const grouped = useMemo(() => {
    const map = new Map<string | undefined, CommandItem<T>[]>();
    filtered.forEach(it => {
      const k = it.group;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const flatList = filtered.filter(it => !it.disabled);

  useEffect(() => { setActiveIdx(0); }, [query, scope]);

  const commit = useCallback((idx: number) => {
    const it = flatList[idx];
    if (!it) return;
    onSelect?.(it);
    onClose();
  }, [flatList, onSelect, onClose]);

  const onKeyDown: React.KeyboardEventHandler = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % Math.max(1, flatList.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i - 1 + flatList.length) % Math.max(1, flatList.length)); }
    else if (e.key === 'Enter') { e.preventDefault(); commit(activeIdx); }
  };

  if (!open) return null;

  const node = (
    <div className="ou-cmdk-scrim" onClick={onClose}>
      <div
        ref={ref}
        className={cn('ou-cmdk', className)}
        role="dialog"
        aria-label="Палитра команд"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ou-cmdk__search">
          <span className="ou-cmdk__search-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            aria-label="Поиск"
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-autocomplete="list"
            aria-controls="ou-cmdk-list"
            {...(flatList[activeIdx]
              ? { 'aria-activedescendant': `ou-cmdk-item-${flatList[activeIdx].id}` }
              : {}
            )}
          />
          {searchHint && <span className="ou-cmdk__search-hint">{searchHint}</span>}
        </div>

        {scopes && scopes.length > 0 && (
          <div className="ou-cmdk__scopes">
            <button
              type="button"
              className={cn('ou-cmdk__scope', scope === 'all' && 'is-active')}
              onClick={() => setScope('all')}
            >{allScopeLabel}</button>
            {scopes.map(s => (
              <button
                key={s.value} type="button"
                className={cn('ou-cmdk__scope', scope === s.value && 'is-active')}
                onClick={() => setScope(s.value)}
              >{s.label}</button>
            ))}
          </div>
        )}

        <div className="ou-cmdk__list" id="ou-cmdk-list" role="listbox" aria-label="Результаты поиска">
          {flatList.length === 0 ? (
            <div className="ou-cmdk__empty">
              {emptyMessage ?? (
                <>
                  Ничего не найдено по запросу <strong>«{query}»</strong>
                </>
              )}
            </div>
          ) : grouped.map(([groupKey, gItems], gi) => (
            <div className="ou-cmdk__group" key={`${groupKey ?? '_'}-${gi}`}>
              {groupKey && <div className="ou-cmdk__group-title">{groupKey}</div>}
              {gItems.map((it) => {
                const idx = flatList.indexOf(it);
                const active = idx === activeIdx;
                return (
                  <button
                    key={it.id}
                    id={`ou-cmdk-item-${it.id}`}
                    type="button"
                    role="option"
                    {...{ 'aria-selected': active ? 'true' : 'false' }}
                    {...(it.disabled ? { 'aria-disabled': 'true' } : {})}
                    className={cn('ou-cmdk__item', active && 'is-active', it.disabled && 'is-disabled')}
                    onMouseEnter={() => idx !== -1 && setActiveIdx(idx)}
                    onClick={() => idx !== -1 && commit(idx)}
                  >
                    {it.icon && <span className="ou-cmdk__item-ico">{it.icon}</span>}
                    <span className="ou-cmdk__item-text">
                      <span className="ou-cmdk__item-title">
                        {highlightMatches ? highlight(it.title, query) : it.title}
                      </span>
                      {it.meta && <span className="ou-cmdk__item-meta">{it.meta}</span>}
                    </span>
                    {(it.shortcut || it.trailing) && (
                      <span className="ou-cmdk__item-trail">
                        {it.trailing}
                        {it.shortcut?.map((k, i) => (
                          <span key={i} className="ou-kbd">{resolveKey(k)}</span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {(footer !== undefined || flatList.length > 0) && (
          <div className="ou-cmdk__footer">
            {footer ?? (
              <>
                <span className="ou-cmdk__footer-item">
                  <span className="ou-kbd">↑↓</span> навигация
                </span>
                <span className="ou-cmdk__footer-item">
                  <span className="ou-kbd">↵</span> выбрать
                </span>
                <span className="ou-cmdk__footer-item">
                  <span className="ou-kbd">Esc</span> закрыть
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (!usePortal || typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}

const _CommandPalette = forwardRef(CommandPaletteInner) as <T = unknown>(
  p: CommandPaletteProps<T> & { ref?: React.Ref<HTMLDivElement> },
) => React.ReactElement;
(_CommandPalette as unknown as { displayName: string }).displayName = 'CommandPalette';
export const CommandPalette = _CommandPalette;
