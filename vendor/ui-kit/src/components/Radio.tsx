import React, { forwardRef, useId } from 'react';

export interface RadioOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string = string> {
  name?: string;
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  options: RadioOption<T>[];
  className?: string;
  layout?: 'column' | 'row';
  legend?: React.ReactNode;
  hint?: React.ReactNode;
}

export function RadioGroup<T extends string = string>({
  name, value, defaultValue, onChange, options, className, layout = 'column', legend, hint,
}: RadioGroupProps<T>) {
  const autoName = useId();
  const groupName = name || `ou-radio-${autoName}`;
  const isVertical = layout === 'column';
  return (
    <fieldset className={['ou-radio-group', isVertical && 'ou-radio-group--vertical', className].filter(Boolean).join(' ')}>
      {legend && <legend className="ou-radio-group__legend">{legend}</legend>}
      {hint && <p className="ou-radio-group__hint">{hint}</p>}
      <div className="ou-radio-group__items">
        {options.map((opt) => {
          const checked = value !== undefined ? value === opt.value : undefined;
          const defaultChecked = value === undefined ? defaultValue === opt.value : undefined;
          return (
            <label key={opt.value} className={['ou-radio-field', opt.disabled && 'is-disabled'].filter(Boolean).join(' ')}>
              <span className={['ou-radio ou-radio--m', checked && 'is-on'].filter(Boolean).join(' ')}>
                <input
                  type="radio"
                  name={groupName}
                  value={opt.value}
                  className="ou-radio__input"
                  checked={checked}
                  defaultChecked={defaultChecked}
                  disabled={opt.disabled}
                  onChange={(e) => onChange?.(e.target.value as T)}
                />
                <span className="ou-radio__ring"><span className="ou-radio__dot" /></span>
              </span>
              <span className="ou-radio-field__text">
                <span className="ou-radio-field__label">{opt.label}</span>
                {opt.description && <span className="ou-radio-field__desc">{opt.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
RadioGroup.displayName = 'RadioGroup';

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  size?: 'm' | 's';
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  ({ label, description, id, disabled, checked, className, size = 'm', ...rest }, ref) => {
    const autoId = useId();
    const inputId = id || `ou-radio-${autoId}`;
    return (
      <label htmlFor={inputId} className={['ou-radio-field', disabled && 'is-disabled', className].filter(Boolean).join(' ')}>
        <span className={['ou-radio', `ou-radio--${size}`, checked && 'is-on'].filter(Boolean).join(' ')}>
          <input ref={ref} id={inputId} type="radio" className="ou-radio__input" disabled={disabled} checked={checked} {...rest} />
          <span className="ou-radio__ring"><span className="ou-radio__dot" /></span>
        </span>
        {(label || description) && (
          <span className="ou-radio-field__text">
            {label && <span className="ou-radio-field__label">{label}</span>}
            {description && <span className="ou-radio-field__desc">{description}</span>}
          </span>
        )}
      </label>
    );
  },
);
Radio.displayName = 'Radio';
