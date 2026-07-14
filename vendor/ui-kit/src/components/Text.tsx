import React, { forwardRef } from 'react';
import { cn } from '../utils';

/**
 * @module components/Text
 * @description Typography primitive for the UniversityRT design system. Renders
 * text with a type-scale `variant` (`--ou-text-*`), a semantic colour `tone`
 * (`--ou-fg-*` / `--ou-{status}-*`) and optional weight/alignment/truncation —
 * so product code never reaches for raw `text-*` / colour utility classes.
 */

export type TextVariant =
  | 'display-l' | 'display-m' | 'display-s'
  | 'heading-l' | 'heading-m' | 'heading-s'
  | 'body-l' | 'body-m' | 'body-s' | 'body-xs'
  | 'caption' | 'mono-s';
export type TextTone =
  | 'default' | 'muted' | 'subtle'
  | 'success' | 'warning' | 'error' | 'info' | 'accent';
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';
export type TextAlign = 'start' | 'center' | 'end';

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  as?: React.ElementType;
  variant?: TextVariant;
  tone?: TextTone;
  weight?: TextWeight;
  align?: TextAlign;
  /** Single-line ellipsis truncation. */
  truncate?: boolean;
}

export const Text = forwardRef<HTMLElement, TextProps>(
  ({ as: Tag = 'span', variant = 'body-m', tone = 'default', weight, align, truncate, className, ...rest }, ref) => (
    <Tag
      ref={ref}
      className={cn(
        'ou-text',
        `ou-text--${variant}`,
        `ou-text--tone-${tone}`,
        weight && `ou-text--w-${weight}`,
        align && `ou-text--${align}`,
        truncate && 'ou-text--truncate',
        className,
      )}
      {...rest}
    />
  ),
);
Text.displayName = 'Text';
