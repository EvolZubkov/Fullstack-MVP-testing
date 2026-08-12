import React, { forwardRef } from 'react';
import { cn } from '../utils';

export type SeparatorOrientation = 'horizontal' | 'vertical';

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: SeparatorOrientation;
  /** Decorative-only (default): removed from the a11y tree. Set `false` for a
   *  semantic separator that conveys grouping to assistive tech. */
  decorative?: boolean;
}

/** UniversityRT · Separator — a hairline rule between content groups. */
export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(
  ({ orientation = 'horizontal', decorative = true, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('ou-separator', `ou-separator--${orientation}`, className)}
      {...(decorative
        ? { role: 'none' }
        : { role: 'separator', 'aria-orientation': orientation })}
      {...rest}
    />
  ),
);
Separator.displayName = 'Separator';
