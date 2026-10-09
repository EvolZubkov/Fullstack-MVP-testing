import React, { forwardRef } from 'react';
import { cn } from '../utils';

/**
 * @module components/Typography
 * @description The two text primitives of the Skillum design system: `Text` for body
 * copy and `Heading` for titles.
 *
 * They were two primitives in two places for a while: the kit grew `Text`/`Heading` in 0.2.0
 * while a product had already shipped its own `Text` with a fuller API. Merged here rather
 * than one replacing the other — the product's version carried a type-scale `variant`, status
 * `tone`s, alignment and truncation that the kit's `size`/`tone` pair could not express, and
 * the kit carried `Heading`, which the product lacked. Neither side was a subset.
 *
 * What that costs a reader: `variant` names a step of the type scale (`--ou-text-*`) rather
 * than a t-shirt size. `body-m` is the default, so `size="s"` from the earlier kit API is
 * written `variant="body-s"`, and `weight="strong"` is `weight="semibold"` — the weight names
 * follow the numeric ramp (400/500/600/700) instead of naming only two steps of it.
 */

export type TextVariant =
  | 'display-l' | 'display-m' | 'display-s'
  | 'heading-l' | 'heading-m' | 'heading-s'
  | 'body-l' | 'body-m' | 'body-s' | 'body-xs'
  | 'caption' | 'mono-s';
/** Foreground emphasis from the `--ou-fg-*` ramp, plus the status colours. */
export type TextTone =
  | 'default' | 'soft' | 'muted' | 'subtle'
  | 'success' | 'warning' | 'error' | 'info' | 'accent';
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';
export type TextAlign = 'start' | 'center' | 'end';

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /** Element to render. Inline `span` by default. */
  as?: React.ElementType;
  variant?: TextVariant;
  tone?: TextTone;
  weight?: TextWeight;
  align?: TextAlign;
  /** Single-line ellipsis truncation. */
  truncate?: boolean;
}

/**
 * Body copy: the caption under a title, a muted hint, a secondary identifier.
 *
 * It exists so a product never has to name a token or a class to make text quieter or
 * smaller. Everything it can do is a step on the design system's own ramps — there is no
 * free-form size or colour.
 */
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

export type HeadingLevel = 1 | 2 | 3;
export type HeadingSize = 's' | 'm' | 'l';

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Document level: renders h1/h2/h3 and picks the matching size. */
  level?: HeadingLevel;
  /** Visual size, when the outline level and the wanted size differ. */
  size?: HeadingSize;
}

const LEVEL_SIZE: Record<HeadingLevel, HeadingSize> = { 1: 'l', 2: 'm', 3: 's' };

/**
 * A section or page title.
 *
 * `level` is the document outline and `size` is the appearance. They default to each other,
 * and are separable for the case a screen reader's outline and the visual hierarchy
 * legitimately disagree.
 */
export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ level = 2, size, className, children, ...rest }, ref) => {
    const Component = `h${level}` as React.ElementType;
    return (
      <Component
        ref={ref}
        className={cn('ou-heading', `ou-heading--${size ?? LEVEL_SIZE[level]}`, className)}
        {...rest}
      >
        {children}
      </Component>
    );
  },
);
Heading.displayName = 'Heading';
