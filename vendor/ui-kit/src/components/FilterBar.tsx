import React, { forwardRef, useState } from 'react';
import { cn } from '../utils';
import { Button } from './Button';
import { Chip } from './Chip';
import { Input } from './Input';
import { Cluster } from './Layout';
import { MenuDivider, MenuItem, MenuLabel, MenuTrigger } from './Menu';

export interface FilterBarAppliedItem {
  /** Stable key of the applied condition. */
  id: string;
  /** What the chip says: usually «поле: значение». */
  label: React.ReactNode;
}

export interface FilterBarSavedSet {
  id: string;
  name: string;
  /** Visible to everyone who can see the list, not only to its author. */
  shared?: boolean;
}

export interface FilterBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onReset'> {
  /** Search control of the list this bar belongs to. */
  search?: React.ReactNode;
  /** How many conditions are applied; shown on the filter button. */
  count?: number;
  /** Applied conditions, each removable on its own. */
  applied?: readonly FilterBarAppliedItem[];
  /** Saved sets of conditions available for this list. */
  savedSets?: readonly FilterBarSavedSet[];
  /** Which saved set the applied conditions came from. */
  activeSetId?: string | null;
  /** The applied conditions no longer match the set they came from. */
  dirty?: boolean;
  /** Anything that belongs to the right end of the first row. */
  actions?: React.ReactNode;
  onOpenFilter?: () => void;
  /**
   * The filter button, for the panel that opens under it (`FilterPanel` takes it as
   * `anchorRef`): the bar draws the button, the panel needs its edges.
   */
  filterButtonRef?: React.Ref<HTMLButtonElement>;
  /** The panel of this bar is open — the button says so to assistive technology. */
  filterOpen?: boolean;
  onRemove?: (id: string) => void;
  onReset?: () => void;
  onApplySet?: (id: string) => void;
  /** Saves what is applied right now under a new name. */
  onSaveSet?: (name: string) => void;
  /** Writes what is applied right now into the set it came from. */
  onUpdateSet?: (id: string) => void;
  onDeleteSet?: (id: string) => void;
  filterLabel?: string;
  resetLabel?: string;
  savedLabel?: string;
}

/**
 * One filtering pattern for every list: search, a filter button with a counter,
 * saved sets, and a second row that appears only while something is applied,
 * with removable chips and the single reset.
 *
 * The component holds no conditions and no storage: it shows what it is given
 * and reports what the person did. Where the sets live and who sees them is the
 * product's business, not the kit's.
 */
export const FilterBar = forwardRef<HTMLDivElement, FilterBarProps>(
  ({
    search,
    count = 0,
    applied = [],
    savedSets = [],
    activeSetId = null,
    dirty = false,
    actions,
    onOpenFilter,
    filterButtonRef,
    filterOpen,
    onRemove,
    onReset,
    onApplySet,
    onSaveSet,
    onUpdateSet,
    onDeleteSet,
    filterLabel = 'Фильтр',
    resetLabel = 'Сбросить фильтры',
    savedLabel = 'Сохранённые',
    className,
    ...rest
  }, ref) => {
    const [name, setName] = useState('');
    const activeSet = savedSets.find((set) => set.id === activeSetId) ?? null;
    const canSave = Boolean(onSaveSet) && applied.length > 0;
    // The control keeps its place whether sets exist or not: a button that comes
    // and goes as conditions change makes the row jump under the hand.
    const showSaved = Boolean(onApplySet) || Boolean(onSaveSet) || savedSets.length > 0;

    const save = () => {
      const trimmed = name.trim();
      if (!trimmed) return;
      onSaveSet?.(trimmed);
      setName('');
    };

    return (
      <div ref={ref} className={cn('ou-filterbar', className)} {...rest}>
        <div className="ou-filterbar__row">
          {search && <div className="ou-filterbar__search">{search}</div>}

          <Button
            ref={filterButtonRef}
            variant="secondary"
            size="s"
            onClick={onOpenFilter}
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
          >
            {filterLabel}
            {count > 0 && <span className="ou-chip__count">{count}</span>}
          </Button>

          {showSaved && (
            <MenuTrigger
              size="sm"
              closeOnSelect={false}
              trigger={(
                <Button variant="ghost" size="s" className="ou-filterbar__saved">
                  {activeSet ? activeSet.name : savedLabel}
                  {activeSet && dirty && <span className="ou-filterbar__dirty">изменён</span>}
                </Button>
              )}
            >
              {savedSets.length > 0 && <MenuLabel>Наборы условий</MenuLabel>}
              {savedSets.length === 0 && (
                <div className="ou-filterbar__empty">
                  {canSave ? 'Сохранённых наборов пока нет' : 'Сохранённых наборов пока нет: отберите условия и сохраните их'}
                </div>
              )}
              {savedSets.map((set) => (
                <MenuItem
                  key={set.id}
                  selected={set.id === activeSetId}
                  onClick={() => onApplySet?.(set.id)}
                  trailing={onDeleteSet && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="ou-filterbar__setdrop"
                      onClick={(event) => { event.stopPropagation(); onDeleteSet(set.id); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.stopPropagation();
                          onDeleteSet(set.id);
                        }
                      }}
                    >
                      удалить
                    </span>
                  )}
                >
                  {set.name}
                </MenuItem>
              ))}

              {savedSets.length > 0 && canSave && <MenuDivider />}

              {canSave && (
                <div className="ou-filterbar__save">
                  <Input
                    size="s"
                    value={name}
                    placeholder="Название набора"
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') save(); }}
                  />
                  <Button variant="primary" size="s" onClick={save} disabled={!name.trim()}>
                    Сохранить
                  </Button>
                </div>
              )}

              {activeSet && dirty && onUpdateSet && (
                <MenuItem onClick={() => onUpdateSet(activeSet.id)}>
                  Обновить «{activeSet.name}»
                </MenuItem>
              )}
            </MenuTrigger>
          )}

          {/* The actions are a group, not one control: a bare box would let them touch,
              because sibling elements carry no spacing of their own. One row of akin
              controls is 1x on the modular grid, so the gap is `--ou-space-1`. */}
          {actions && <Cluster gap={1} className="ou-filterbar__spacer">{actions}</Cluster>}
        </div>

        {applied.length > 0 && (
          <div className="ou-filterbar__applied">
            {applied.map((item) => (
              <Chip
                key={item.id}
                size="s"
                onRemove={onRemove ? () => onRemove(item.id) : undefined}
                // Условие называется в подписи: ряд одинаковых «Удалить» не говорит
                // ничего о том, какое из них что снимает.
                removeLabel={typeof item.label === 'string' ? `Снять условие: ${item.label}` : 'Снять условие'}
              >
                {item.label}
              </Chip>
            ))}
            <Button variant="ghost" size="s" className="ou-filterbar__reset" onClick={onReset}>
              {resetLabel}
            </Button>
          </div>
        )}
      </div>
    );
  },
);

FilterBar.displayName = 'FilterBar';
