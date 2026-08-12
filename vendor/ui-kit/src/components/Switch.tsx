import React, { forwardRef, useId, useState, useEffect } from 'react';
import { cn } from '../utils';

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  size?: 's' | 'm' | 'l';
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ label, description, size = 'm', className, id, disabled, checked, defaultChecked, onChange, ...rest }, ref) => {
    const autoId = useId();
    const inputId = id || `ou-switch-${autoId}`;

    const isControlled = checked !== undefined;
    const [isOn, setIsOn] = useState(isControlled ? !!checked : !!defaultChecked);

    useEffect(() => {
      if (isControlled) setIsOn(!!checked);
    }, [checked, isControlled]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) setIsOn(e.target.checked);
      onChange?.(e);
    };

    return (
      <label htmlFor={inputId} className={cn('ou-switch-field', disabled && 'is-disabled', className)}>
        <span className={cn('ou-switch', `ou-switch--${size}`, isOn && 'is-on', disabled && 'is-disabled')}>
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            className="ou-switch__input"
            disabled={disabled}
            checked={isControlled ? checked : isOn}
            onChange={handleChange}
            {...rest}
          />
          <span className="ou-switch__track">
            <span className="ou-switch__thumb" />
          </span>
        </span>
        {(label || description) && (
          <span className="ou-switch-field__text">
            {label && <span className="ou-switch-field__label">{label}</span>}
            {description && <span className="ou-switch-field__desc">{description}</span>}
          </span>
        )}
      </label>
    );
  },
);
Switch.displayName = 'Switch';
