import React, { forwardRef } from 'react';
import { cn, type Size, type ButtonVariant } from '../utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

/** Primary action trigger. Variants: primary | secondary | ghost | destructive. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    variant = 'primary',
    size = 'm',
    fullWidth,
    loading,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    ...rest
  }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'ou-btn',
          `ou-btn--${variant}`,
          `ou-btn--${size}`,
          fullWidth && 'ou-btn--full',
          loading && 'is-loading',
          className,
        )}
        disabled={disabled || loading}
        {...rest}
      >
        {loading && <span className="ou-btn__spin" aria-hidden="true" />}
        {leadingIcon && !loading && <span className="ou-btn__ico">{leadingIcon}</span>}
        {children && <span>{children}</span>}
        {trailingIcon && !loading && <span className="ou-btn__ico">{trailingIcon}</span>}
      </button>
    );
  },
);
Button.displayName = 'Button';
