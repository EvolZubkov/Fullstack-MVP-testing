import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { cn } from '../utils';
import { Button } from './Button';
import { Chip } from './Chip';
import { Input } from './Input';
import { Cluster } from './Layout';
import { MenuItem, MenuLabel, MenuTrigger } from './Menu';
import { Popover } from './Popover';

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
  /**
   * The name offered when saving. By default — the labels of the applied chips
   * joined with « · », so the person only confirms or shortens it.
   */
  suggestedName?: string;
  filterLabel?: string;
  resetLabel?: string;
  savedLabel?: string;
  /** The save action in the row of applied conditions. */
  saveLabel?: string;
}

/** Longest name offered by default: a set name is a label on a button, not a description. */
const SUGGESTED_MAX = 80;

/** Default name of a new set: the chip labels that are plain text, joined. */
function suggestedFrom(applied: readonly FilterBarAppliedItem[]): string {
  const text = applied
    .map((item) => (typeof item.label === 'string' ? item.label : ''))
    .filter(Boolean)
    .join(' · ');
  return text.length > SUGGESTED_MAX ? `${text.slice(0, SUGGESTED_MAX - 1).trimEnd()}…` : text;
}

/**
 * One filtering pattern for every list: search, a filter button with a counter,
 * saved sets, and a second row that appears only while something is applied,
 * with removable chips, the save actions and the single reset.
 *
 * Saving lives in the row of applied conditions, next to what is being saved, and
 * appears only when there is something to save: conditions are applied and they are
 * not exactly a saved set. A changed set offers «update» and «save as new». The
 * «Сохранённые» menu only applies and deletes sets: a name field hidden in a menu
 * that reads as a list was not found by the people it was meant for.
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
    suggestedName,
    filterLabel = 'Фильтр',
    resetLabel = 'Сбросить фильтры',
    savedLabel = 'Сохранённые',
    saveLabel = 'Сохранить фильтр',
    className,
    ...rest
  }, ref) => {
    const [name, setName] = useState('');
    const [saveOpen, setSaveOpen] = useState(false);
    const saveButtonRef = useRef<HTMLButtonElement | null>(null);
    const nameRef = useRef<HTMLInputElement | null>(null);
    const activeSet = savedSets.find((set) => set.id === activeSetId) ?? null;
    const hasApplied = applied.length > 0;
    // Nothing to save while the applied conditions are exactly a saved set.
    const offerSave = Boolean(onSaveSet) && hasApplied && (!activeSet || dirty);
    const offerUpdate = Boolean(onUpdateSet) && hasApplied && Boolean(activeSet) && dirty;
    // The control keeps its place whether sets exist or not: a button that comes
    // and goes as conditions change makes the row jump under the hand.
    const showSaved = Boolean(onApplySet) || Boolean(onSaveSet) || savedSets.length > 0;

    // The name field closes as soon as saving stops making sense (conditions reset,
    // a set applied): an open field for an action that is gone would save the wrong thing.
    useEffect(() => {
      if (!offerSave) setSaveOpen(false);
    }, [offerSave]);

    // The field opens with the offered name selected: Enter keeps it, typing replaces it.
    useEffect(() => {
      if (!saveOpen) return;
      nameRef.current?.focus();
      nameRef.current?.select();
    }, [saveOpen]);

    const toggleSave = () => {
      if (saveOpen) {
        setSaveOpen(false);
        return;
      }
      setName(suggestedName ?? suggestedFrom(applied));
      setSaveOpen(true);
    };

    const closeSave = () => {
      setSaveOpen(false);
      saveButtonRef.current?.focus();
    };

    const save = () => {
      const trimmed = name.trim();
      if (!trimmed) return;
      onSaveSet?.(trimmed);
      setName('');
      closeSave();
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
                // The empty menu says where saving is — the only place a person who
                // came here to save will look.
                <div className="ou-filterbar__empty">
                  {onSaveSet
                    ? `Наборов пока нет: отберите условия и нажмите «${saveLabel}»`
                    : 'Наборов пока нет'}
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
            </MenuTrigger>
          )}

          {/* The actions are a group, not one control: a bare box would let them touch,
              because sibling elements carry no spacing of their own. One row of akin
              controls is 1x on the modular grid, so the gap is `--ou-space-1`. */}
          {actions && <Cluster gap={1} className="ou-filterbar__spacer">{actions}</Cluster>}
        </div>

        {hasApplied && (
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
            {(offerUpdate || offerSave) && (
              <span className="ou-filterbar__saveactions">
                {offerUpdate && activeSet && (
                  <Button variant="ghost" size="s" onClick={() => onUpdateSet?.(activeSet.id)}>
                    Обновить «{activeSet.name}»
                  </Button>
                )}
                {offerSave && (
                  <Button
                    ref={saveButtonRef}
                    variant="ghost"
                    size="s"
                    onClick={toggleSave}
                    aria-haspopup="dialog"
                    aria-expanded={saveOpen}
                  >
                    {activeSet ? 'Сохранить как новый' : saveLabel}
                  </Button>
                )}
              </span>
            )}
            <Button variant="ghost" size="s" className="ou-filterbar__reset" onClick={onReset}>
              {resetLabel}
            </Button>
          </div>
        )}

        <Popover
          open={saveOpen}
          onClose={closeSave}
          anchorRef={saveButtonRef}
          placement="bottom"
          align="start"
          size="lg"
          arrow={false}
          offset={4}
          aria-label={activeSet ? 'Сохранить как новый набор' : saveLabel}
          className="ou-filterbar__savepop"
          footer={(
            <Button variant="primary" size="s" onClick={save} disabled={!name.trim()}>
              Сохранить
            </Button>
          )}
        >
          <Input
            ref={nameRef}
            size="s"
            fullWidth
            label="Название"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // Focus returns to the save button inside save(): without this the same Enter
              // would press that button and open the field again.
              event.preventDefault();
              save();
            }}
          />
        </Popover>
      </div>
    );
  },
);

FilterBar.displayName = 'FilterBar';
