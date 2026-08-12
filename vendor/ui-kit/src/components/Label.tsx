import React, { forwardRef } from 'react';
import { cn } from '../utils';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Renders the red required marker «*» after the text (DS convention). */
  required?: boolean;
}

/**
 * Standalone form label using the design-system field-label convention
 * (`ou-field__lbl`). Use it for controls that do NOT render their own label —
 * a `Checkbox`/`Radio`, a custom control, or a small section sub-heading. For a
 * plain text input prefer `Input`'s built-in `label` prop instead.
 */
export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ required, className, children, ...rest }, ref) => (
    <label ref={ref} className={cn('ou-field__lbl', className)} {...rest}>
      {children}
      {required && <span className="ou-field__lbl-req"> *</span>}
    </label>
  ),
);
Label.displayName = 'Label';
