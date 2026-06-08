/**
 * @module Combobox
 * @description Single and multi-select combobox with search, grouping, chip display, and match highlighting.
 */
import React, {
  forwardRef, useCallback, useEffect, useId, useImperativeHandle,
  useMemo, useRef, useState,
} from 'react';
import { cn, cssStyleClass, type Size } from '../utils';

type Tone = 'default' | 'error';

/**
 * A single option in the Combobox dropdown.
 * @template T - String union type for the option value.
 */
export interface ComboboxOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** Текст для поиска и подсветки совпадений. По умолчанию `label`. */
  searchText?: string;
  /** Группа (заголовок секции). */
  group?: string;
  /** Произвольное содержимое до текста (иконка/аватар). */
  leading?: React.ReactNode;
  /** Мелкий текст под title. */
  meta?: React.ReactNode;
  /** Произвольное содержимое в конце строки. */
  trailing?: React.ReactNode;
  disabled?: boolean;
}

/**
 * Props for the {@link Combobox} component.
 * @template T - String union type constraining selectable values.
 */
export interface ComboboxProps<T extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  size?: Size;
  tone?: Tone;
  placeholder?: string;
  options: ComboboxOption<T>[];
  /** Включает multi-select. */
  multiple?: boolean;
  /** Single mode value. */
  value?: T | null;
  /** Multi-select values. */
  values?: T[];
  onChange?: (value: T | null) => void;
  onValuesChange?: (values: T[]) => void;
  /** Запрос поиска (контролируемый). */
  query?: string;
  onQueryChange?: (q: string) => void;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Сообщение пустого состояния. По умолчанию «Ничего не найдено». */
  emptyMessage?: React.ReactNode;
  /** Подсказка-описание поверх пустого состояния. */
  emptyTitle?: React.ReactNode;
  /** Кнопка-действие в подвале меню (например «+ Создать»). */
  footerAction?: React.ReactNode;
  /** Левая часть подвала (подсказки клавиш и т.п.). */
  footerHint?: React.ReactNode;
  /** Чип-представление выбранного значения (single). По умолчанию label. */
  renderChip?: (opt: ComboboxOption<T>) => React.ReactNode;
  /** Максимум видимых чипов до сворачивания в «+ N» (multi). */
  maxVisibleChips?: number;
  /** Подсветка совпадений запроса. */
  highlightMatches?: boolean;
  id?: string;
  name?: string;
}

const ChevronIcon = () => (
  <svg className="ou-combo__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const idx = lower.indexOf(ql);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function ComboboxInner<T extends string = string>(
  {
    label, hint, error, size = 'm', tone, placeholder,
    options, multiple, value, values, onChange, onValuesChange,
    query: queryProp, onQueryChange,
    disabled, fullWidth,
    emptyMessage = 'Попробуйте другой запрос.',
    emptyTitle = 'Ничего не найдено',
    footerAction, footerHint,
    renderChip, maxVisibleChips, highlightMatches = true,
    id, name, className, style, ...rest
  }: ComboboxProps<T>,
  ref: React.Ref<HTMLInputElement>,
) {
  const autoId = useId();
  const fieldId = id || `ou-combo-${autoId}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  const [open, setOpen] = useState(false);
  const [internalQuery, setInternalQuery] = useState('');
  const query = queryProp !== undefined ? queryProp : internalQuery;
  const setQuery = useCallback((v: string) => {
    if (queryProp === undefined) setInternalQuery(v);
    onQueryChange?.(v);
  }, [queryProp, onQueryChange]);

  const [activeIdx, setActiveIdx] = useState<number>(-1);

  const selectedValues: T[] = useMemo(() => {
    if (multiple) return values ?? [];
    return value != null ? [value] : [];
  }, [multiple, value, values]);

  // Filter options by query.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => {
      const t = (o.searchText ?? (typeof o.label === 'string' ? o.label : '')).toLowerCase();
      return t.includes(q);
    });
  }, [options, query]);

  // Group filtered options by `group`.
  const grouped = useMemo(() => {
    const map = new Map<string | undefined, ComboboxOption<T>[]>();
    filtered.forEach(o => {
      const k = o.group;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const flatList = filtered; // used for keyboard nav

  // Reset active index when filtered list changes.
  useEffect(() => { setActiveIdx(flatList.length ? 0 : -1); }, [flatList.length, query]);

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const t: Tone = error ? 'error' : (tone ?? 'default');

  const isSelected = (v: T) => selectedValues.includes(v);

  const commitSelect = useCallback((opt: ComboboxOption<T>) => {
    if (opt.disabled) return;
    if (multiple) {
      const next = selectedValues.includes(opt.value)
        ? selectedValues.filter(v => v !== opt.value)
        : [...selectedValues, opt.value];
      onValuesChange?.(next);
      setQuery('');
    } else {
      onChange?.(opt.value);
      setQuery('');
      setOpen(false);
    }
    inputRef.current?.focus();
  }, [multiple, selectedValues, onValuesChange, onChange, setQuery]);

  const removeChip = (v: T) => {
    if (multiple) onValuesChange?.(selectedValues.filter(x => x !== v));
    else onChange?.(null);
  };

  const clearAll = () => {
    if (multiple) onValuesChange?.([]);
    else onChange?.(null);
    setQuery('');
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIdx(i => (i + 1) % Math.max(1, flatList.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => (i - 1 + flatList.length) % Math.max(1, flatList.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && flatList[activeIdx]) commitSelect(flatList[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && multiple && selectedValues.length) {
      removeChip(selectedValues[selectedValues.length - 1]);
    }
  };

  // Selected chips for multi-select.
  const visibleChips = multiple
    ? (maxVisibleChips ? selectedValues.slice(0, maxVisibleChips) : selectedValues)
    : [];
  const hiddenChipCount = multiple && maxVisibleChips
    ? Math.max(0, selectedValues.length - maxVisibleChips) : 0;

  // Single-mode selected option chip rendering.
  const singleSelected = !multiple && value != null
    ? options.find(o => o.value === value) ?? null
    : null;

  const showResults = open && !disabled;
  const isEmpty = showResults && flatList.length === 0;
  const listboxId = `${fieldId}-menu`;
  const activeOptionId = open && activeIdx >= 0 && flatList[activeIdx]
    ? `${fieldId}-opt-${flatList[activeIdx].value}`
    : undefined;
  const inputLabel = typeof label === 'string' ? label : 'Выбор значения';
  const inputPlaceholder = (!multiple && singleSelected) ? '' : (placeholder ?? '');

  return (
    <div
      ref={wrapRef}
      className={cn(
        'ou-combo',
        size === 's' && 'ou-combo--s',
        size === 'l' && 'ou-combo--l',
        t === 'error' && 'ou-combo--error',
        fullWidth && 'ou-combo--full',
        disabled && 'is-disabled',
        open && 'is-open',
        className,
        cssStyleClass(style, 'ou-combo-sx'),
      )}
      {...rest}
    >
      {label && <label htmlFor={fieldId} className="ou-combo__lbl">{label}</label>}
      <div
        className="ou-combo__control"
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.ou-combo__chip-x, .ou-combo__clear')) return;
          if (target.closest('.ou-combo__trail')) { setOpen(o => !o); return; }
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {/* Single-mode chip */}
        {!multiple && singleSelected && !query && (
          <span className="ou-combo__chip ou-combo__chip--accent">
            <span className="ou-combo__chip-label">
              {renderChip ? renderChip(singleSelected) : singleSelected.label}
            </span>
            {!disabled && (
              <button
                type="button" className="ou-combo__chip-x"
                aria-label="Закрыть"
                onClick={(e) => { e.stopPropagation(); removeChip(singleSelected.value); }}
              ><CloseIcon /></button>
            )}
          </span>
        )}

        {/* Multi-mode chips */}
        {multiple && visibleChips.map((v) => {
          const opt = options.find(o => o.value === v);
          if (!opt) return null;
          return (
            <span key={v} className="ou-combo__chip">
              {opt.leading}
              <span className="ou-combo__chip-label">
                {renderChip ? renderChip(opt) : opt.label}
              </span>
              {!disabled && (
                <button
                  type="button" className="ou-combo__chip-x"
                  aria-label="Закрыть"
                  onClick={(e) => { e.stopPropagation(); removeChip(v); }}
                ><CloseIcon /></button>
              )}
            </span>
          );
        })}
        {hiddenChipCount > 0 && (
          <span className="ou-combo__chip-more">+ {hiddenChipCount}</span>
        )}

        {open ? (
          <input
            ref={inputRef}
            id={fieldId}
            className="ou-combo__input"
            type="text"
            value={query}
            placeholder={inputPlaceholder}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-label={label ? undefined : inputLabel}
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
        ) : (
          <input
            ref={inputRef}
            id={fieldId}
            className="ou-combo__input"
            type="text"
            value={query}
            placeholder={inputPlaceholder}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-label={label ? undefined : inputLabel}
            aria-expanded="false"
            aria-haspopup="listbox"
            aria-autocomplete="list"
            onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
        )}
        {name !== undefined && !multiple && (
          <input type="hidden" name={name} value={value ?? ''} />
        )}

        <span className="ou-combo__trail">
          {(multiple ? selectedValues.length > 0 : !!singleSelected) && !disabled && (
            <button
              type="button" className="ou-combo__clear"
              aria-label="Очистить всё"
              onClick={(e) => { e.stopPropagation(); clearAll(); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          <ChevronIcon />
        </span>
      </div>

      {showResults && (
        <div className="ou-combo__menu">
          <div className="ou-combo__list" id={listboxId} role="listbox" aria-label="Варианты">
            {isEmpty ? (
              <div
                className="ou-combo__empty"
                role="option"
                aria-selected="false"
                aria-disabled="true"
                aria-live="polite"
              >
                {emptyTitle && (
                  <div className="ou-combo__empty-title">
                    {emptyTitle}
                  </div>
                )}
                {emptyMessage}
              </div>
            ) : (
              grouped.map(([group, items], gi) => (
                <div
                  className="ou-combo__group"
                  key={`${group ?? '_'}-${gi}`}
                  role="group"
                  aria-label={group ? `${group}, ${items.length}` : `Варианты, ${items.length}`}
                >
                  {group && (
                    <div className="ou-combo__group-title" role="presentation" aria-hidden="true">
                      {group} · {items.length}
                    </div>
                  )}
                  {items.map((opt) => {
                    const flatIdx = flatList.indexOf(opt);
                    const active = flatIdx === activeIdx;
                    const selected = isSelected(opt.value);
                    const labelStr = typeof opt.label === 'string' ? opt.label : '';
                    const optionClassName = cn(
                      'ou-combo__option',
                      selected && 'is-selected',
                      active && 'is-active',
                      opt.disabled && 'is-disabled',
                    );
                    const optionContent = (
                      <>
                        <span className="ou-combo__option-check"><CheckIcon /></span>
                        {opt.leading}
                        <span className="ou-combo__option-text">
                          <span className="ou-combo__option-title">
                            {labelStr && highlightMatches
                              ? highlight(labelStr, query)
                              : opt.label}
                          </span>
                          {opt.meta && (
                            <span className="ou-combo__option-meta">{opt.meta}</span>
                          )}
                        </span>
                        {opt.trailing && (
                          <span className="ou-combo__option-trail">{opt.trailing}</span>
                        )}
                      </>
                    );

                    if (selected && opt.disabled) {
                      return (
                        <div
                          key={opt.value}
                          id={`${fieldId}-opt-${opt.value}`}
                          role="option"
                          aria-selected="true"
                          aria-disabled="true"
                          className={optionClassName}
                          onMouseEnter={() => setActiveIdx(flatIdx)}
                          onClick={(e) => { e.stopPropagation(); commitSelect(opt); }}
                        >
                          {optionContent}
                        </div>
                      );
                    }

                    if (selected) {
                      return (
                        <div
                          key={opt.value}
                          id={`${fieldId}-opt-${opt.value}`}
                          role="option"
                          aria-selected="true"
                          className={optionClassName}
                          onMouseEnter={() => setActiveIdx(flatIdx)}
                          onClick={(e) => { e.stopPropagation(); commitSelect(opt); }}
                        >
                          {optionContent}
                        </div>
                      );
                    }

                    if (opt.disabled) {
                      return (
                        <div
                          key={opt.value}
                          id={`${fieldId}-opt-${opt.value}`}
                          role="option"
                          aria-selected="false"
                          aria-disabled="true"
                          className={optionClassName}
                          onMouseEnter={() => setActiveIdx(flatIdx)}
                          onClick={(e) => { e.stopPropagation(); commitSelect(opt); }}
                        >
                          {optionContent}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={opt.value}
                        id={`${fieldId}-opt-${opt.value}`}
                        role="option"
                        aria-selected="false"
                        className={optionClassName}
                        onMouseEnter={() => setActiveIdx(flatIdx)}
                        onClick={(e) => { e.stopPropagation(); commitSelect(opt); }}
                      >
                        {optionContent}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          {(footerAction || footerHint) && (
            <div className="ou-combo__footer">
              <span>{footerHint}</span>
              {typeof footerAction === 'string'
                ? <button type="button" className="ou-combo__footer-action">{footerAction}</button>
                : footerAction}
            </div>
          )}
        </div>
      )}

      {(error || hint) && (
        <span className={cn('ou-combo__hint', t === 'error' && 'is-error')}>{error || hint}</span>
      )}
    </div>
  );
}

/**
 * Accessible combobox with search, single/multi-select, option grouping, chip display, and match highlighting.
 * @template T - String union type constraining selectable values.
 * @example
 * ```tsx
 * <Combobox options={options} value={val} onChange={setVal} label="Country" />
 * ```
 */
export const Combobox = forwardRef(ComboboxInner) as <T extends string = string>(
  p: ComboboxProps<T> & { ref?: React.Ref<HTMLInputElement> },
) => React.ReactElement;
(Combobox as unknown as { displayName: string }).displayName = 'Combobox';
