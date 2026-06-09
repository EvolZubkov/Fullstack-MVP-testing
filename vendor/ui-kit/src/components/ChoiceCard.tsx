import React, { createContext, forwardRef, useContext, useId } from 'react';
import { cn } from '../utils';

/**
 * Choice card — radio-button rendered as a full-width card with icon, title,
 * description and optional inset content that expands when the card is
 * selected.
 *
 * Usage:
 *   <ChoiceCardGroup name="folder-action" value={value} onChange={setValue}>
 *     <ChoiceCard value="keep" icon={<FolderIcon/>} title="Только папку"
 *                 description="Тесты сохраняются и перемещаются в указанное место.">
 *       <ChoiceCardInset>…контролы видны только при выборе…</ChoiceCardInset>
 *     </ChoiceCard>
 *     <ChoiceCard value="purge" tone="destructive" icon={<TrashIcon/>}
 *                 title="Папку и все тесты"
 *                 description="2 теста будут удалены без возможности восстановления."/>
 *   </ChoiceCardGroup>
 */

export type ChoiceCardTone = 'neutral' | 'destructive';

interface ChoiceCardGroupContextValue {
  name: string;
  value: string | undefined;
  onChange: (next: string) => void;
}

const ChoiceCardGroupContext = createContext<ChoiceCardGroupContextValue | null>(null);

export interface ChoiceCardGroupProps {
  /** Name attribute applied to every nested radio input. */
  name?: string;
  /** Controlled selected value. */
  value?: string;
  /** Initial value when uncontrolled. */
  defaultValue?: string;
  onChange?: (next: string) => void;
  legend?: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function ChoiceCardGroup({
  name, value, defaultValue, onChange, legend, hint, className, children,
}: ChoiceCardGroupProps) {
  const autoName = useId();
  const groupName = name || `ou-choice-card-${autoName}`;
  const [internal, setInternal] = React.useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  const ctx: ChoiceCardGroupContextValue = {
    name: groupName,
    value: current,
    onChange: (next) => {
      if (!isControlled) setInternal(next);
      onChange?.(next);
    },
  };

  return (
    <fieldset className={cn('ou-choice-card-group', className)}>
      {legend && <legend className="ou-choice-card-group__legend">{legend}</legend>}
      {hint && <p className="ou-choice-card-group__hint">{hint}</p>}
      <div className="ou-choice-card-group__items">
        <ChoiceCardGroupContext.Provider value={ctx}>{children}</ChoiceCardGroupContext.Provider>
      </div>
    </fieldset>
  );
}
ChoiceCardGroup.displayName = 'ChoiceCardGroup';

export interface ChoiceCardProps extends Omit<React.LabelHTMLAttributes<HTMLLabelElement>, 'onChange' | 'title'> {
  value: string;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  tone?: ChoiceCardTone;
  disabled?: boolean;
  /** Standalone usage when there is no group: provide your own name + checked/onChange. */
  name?: string;
  checked?: boolean;
  onChange?: (value: string) => void;
  /** Show a visible radio-circle indicator trailing the card content. */
  showRadio?: boolean;
}

export const ChoiceCard = forwardRef<HTMLLabelElement, ChoiceCardProps>(
  ({
    value, icon, title, description, tone = 'neutral', disabled,
    name, checked, onChange, showRadio, className, children, ...rest
  }, ref) => {
    const group = useContext(ChoiceCardGroupContext);
    const effectiveName = group?.name ?? name;
    const effectiveChecked = group ? group.value === value : checked;
    const handleChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
      const next = event.target.value;
      if (group) group.onChange(next);
      else onChange?.(next);
    };

    return (
      <label
        ref={ref}
        className={cn(
          'ou-choice-card',
          tone !== 'neutral' && `ou-choice-card--${tone}`,
          showRadio && 'ou-choice-card--radio',
          effectiveChecked && 'is-selected',
          disabled && 'is-disabled',
          className,
        )}
        {...rest}
      >
        <input
          type="radio"
          className="ou-choice-card__input"
          name={effectiveName}
          value={value}
          checked={effectiveChecked}
          disabled={disabled}
          onChange={handleChange}
        />
        {icon && <span className="ou-choice-card__lead" aria-hidden="true">{icon}</span>}
        <span className="ou-choice-card__body">
          {title && <span className="ou-choice-card__title">{title}</span>}
          {description && <span className="ou-choice-card__desc">{description}</span>}
          {children}
        </span>
        {showRadio && <span className="ou-choice-card__radio" aria-hidden="true" />}
      </label>
    );
  },
);
ChoiceCard.displayName = 'ChoiceCard';

export const ChoiceCardInset: React.FC<React.HTMLAttributes<HTMLDivElement>> =
  ({ className, ...rest }) => (
    <div className={cn('ou-choice-card__inset', className)} {...rest} />
  );
ChoiceCardInset.displayName = 'ChoiceCardInset';
