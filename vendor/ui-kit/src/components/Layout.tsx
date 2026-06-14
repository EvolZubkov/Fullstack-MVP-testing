import React, { forwardRef } from 'react';
import { cn } from '../utils';

/**
 * @module components/Layout
 * @description Framework-free layout primitives for the UniversityRT design
 * system. They replace ad-hoc utility-class layout (flex/grid/spacing) with
 * token-driven components: spacing comes from `--ou-space-*`, surfaces from
 * `--ou-bg-*`, radii from `--ou-radius-*`. No arbitrary values, no inline
 * styles — every knob maps to a BEM modifier class.
 *
 * - `Stack`   — flex flow (column by default) with a token gap.
 * - `Cluster` — horizontal, wrapping group (chips, buttons, inline meta).
 * - `Grid`    — fixed-column or responsive auto-fit grid with a token gap.
 * - `Box`     — padded/surfaced container (replaces `p-* bg-* rounded-*`).
 */

/** Spacing step mapped to `--ou-space-{n}`. */
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type StackAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type StackJustify = 'start' | 'center' | 'end' | 'between' | 'around';

/**
 * Token-driven padding props shared by `Box` and the flow primitives
 * (`Stack`/`Cluster`). Each maps to an `ou-box--pad*` utility class so a flex
 * container can carry its own padding without an extra wrapper element.
 */
export interface PaddingProps {
  /** Padding on all sides (`--ou-space-{pad}`). */
  pad?: Space;
  /** Inline (left+right) padding. */
  padX?: Space;
  /** Block (top+bottom) padding. */
  padY?: Space;
  padTop?: Space;
  padBottom?: Space;
  /** Inline-start (left in LTR) padding — e.g. tree indents. */
  padStart?: Space;
  /** Inline-end (right in LTR) padding. */
  padEnd?: Space;
}

/** Build the `ou-box--pad*` utility classes for the given padding props. */
function padClasses(p: PaddingProps): Array<string | false> {
  return [
    p.pad != null && `ou-box--pad-${p.pad}`,
    p.padX != null && `ou-box--padx-${p.padX}`,
    p.padY != null && `ou-box--pady-${p.padY}`,
    p.padTop != null && `ou-box--padt-${p.padTop}`,
    p.padBottom != null && `ou-box--padb-${p.padBottom}`,
    p.padStart != null && `ou-box--pads-${p.padStart}`,
    p.padEnd != null && `ou-box--pade-${p.padEnd}`,
  ];
}

export interface StackProps extends React.HTMLAttributes<HTMLDivElement>, PaddingProps {
  /** Main axis. Default `col`. */
  direction?: 'row' | 'col';
  /** Gap between children (`--ou-space-{gap}`). Default 4. */
  gap?: Space;
  align?: StackAlign;
  justify?: StackJustify;
  wrap?: boolean;
  /** Stretch to full width. */
  full?: boolean;
  /** Grow to fill available space when nested in a flex parent (`flex: 1`). */
  grow?: boolean;
  /** Minimum height: `screen` = 100dvh (full-height app/auth columns). */
  minH?: 'screen' | 'full';
  as?: React.ElementType;
}

export const Stack = forwardRef<HTMLDivElement, StackProps>(
  ({ direction = 'col', gap = 4, align, justify, wrap, full, grow, minH,
     pad, padX, padY, padTop, padBottom, padStart, padEnd,
     as: Tag = 'div', className, ...rest }, ref) => (
    <Tag
      ref={ref}
      className={cn(
        'ou-stack',
        direction === 'row' && 'ou-stack--row',
        `ou-stack--gap-${gap}`,
        align && `ou-stack--ai-${align}`,
        justify && `ou-stack--jc-${justify}`,
        wrap && 'ou-stack--wrap',
        full && 'ou-stack--full',
        grow && 'ou-grow',
        minH && `ou-stack--minh-${minH}`,
        ...padClasses({ pad, padX, padY, padTop, padBottom, padStart, padEnd }),
        className,
      )}
      {...rest}
    />
  ),
);
Stack.displayName = 'Stack';

export interface ClusterProps extends Omit<StackProps, 'direction'> {}

/** Horizontal, wrapping group — items centered by default. A `Stack` preset. */
export const Cluster = forwardRef<HTMLDivElement, ClusterProps>(
  ({ align = 'center', gap = 2, wrap = true, ...rest }, ref) => (
    <Stack ref={ref} direction="row" align={align} gap={gap} wrap={wrap} {...rest} />
  ),
);
Cluster.displayName = 'Cluster';

export type GridMinItem = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fixed column count (ignored when `minItem` is set). */
  cols?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Responsive auto-fit: each column is at least this preset min-width. */
  minItem?: GridMinItem;
  gap?: Space;
}

export const Grid = forwardRef<HTMLDivElement, GridProps>(
  ({ cols, minItem, gap = 4, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'ou-lgrid',
        `ou-lgrid--gap-${gap}`,
        minItem ? `ou-lgrid--auto ou-lgrid--min-${minItem}` : cols && `ou-lgrid--cols-${cols}`,
        className,
      )}
      {...rest}
    />
  ),
);
Grid.displayName = 'Grid';

export type BoxSurface = 'muted' | 'subtle' | 'elevated';
export type BoxRadius = 's' | 'm' | 'l';
/** Named max-width caps for content/cards (auto-centered; no arbitrary values). */
export type BoxMaxW = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';

export interface BoxProps extends React.HTMLAttributes<HTMLDivElement>, PaddingProps {
  surface?: BoxSurface;
  border?: boolean;
  radius?: BoxRadius;
  /** Cap content width to a named preset and center it horizontally. */
  maxW?: BoxMaxW;
  /** Grow to fill available space when nested in a flex parent (`flex: 1`). */
  grow?: boolean;
  /** Stretch to full width. */
  full?: boolean;
  as?: React.ElementType;
}

export const Box = forwardRef<HTMLDivElement, BoxProps>(
  ({ pad, padX, padY, padTop, padBottom, padStart, padEnd, surface, border, radius, maxW, grow, full, as: Tag = 'div', className, ...rest }, ref) => (
    <Tag
      ref={ref}
      className={cn(
        'ou-box',
        ...padClasses({ pad, padX, padY, padTop, padBottom, padStart, padEnd }),
        surface && `ou-box--surface-${surface}`,
        border && 'ou-box--border',
        radius && `ou-box--radius-${radius}`,
        maxW && `ou-box--maxw-${maxW}`,
        grow && 'ou-grow',
        full && 'ou-box--full',
        className,
      )}
      {...rest}
    />
  ),
);
Box.displayName = 'Box';
