import React, { forwardRef } from 'react';
import { cn, cssStyleClass } from '../utils';

export type SkeletonShape = 'line' | 'circle' | 'button' | 'block';
export type SkeletonLineSize = 'caption' | 'body' | 'heading' | 'display';
export type SkeletonAnim = 'shimmer' | 'pulse' | 'static';
/** Полезные ширины для line/button. */
export type SkeletonWidth = '1/4' | '1/3' | '1/2' | '2/3' | '3/4' | 'full' | number | string;

export interface SkeletonProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  shape?: SkeletonShape;
  /** Для shape='line' — пресет высоты. */
  size?: SkeletonLineSize;
  /** Тип анимации. */
  animation?: SkeletonAnim;
  /** Ширина (token, '50%', '120px' или число px). */
  width?: SkeletonWidth;
  /** Высота. */
  height?: number | string;
}

function widthToClass(w?: SkeletonWidth): string | undefined {
  if (typeof w !== 'string') return undefined;
  if (w === '1/4' || w === '1/3' || w === '1/2' || w === '2/3' || w === '3/4' || w === 'full') {
    return `ou-skel--w-${w}`;
  }
  return undefined;
}
function widthToStyle(w?: SkeletonWidth): string | undefined {
  if (w == null) return undefined;
  if (typeof w === 'number') return `${w}px`;
  if (w === '1/4' || w === '1/3' || w === '1/2' || w === '2/3' || w === '3/4' || w === 'full') return undefined;
  return w;
}

const SHAPE_CLASS: Record<SkeletonShape, string | null> = {
  line: 'ou-skel--line', circle: 'ou-skel--circle', button: 'ou-skel--button', block: null,
};

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({
    shape = 'line', size, animation,
    width, height, className, style, ...rest
  }, ref) => {
    const sizeCls = shape === 'line' && size && size !== 'body' ? `is-${size}` : undefined;
    const animCls = animation === 'pulse' ? 'ou-skel--pulse'
      : animation === 'static' ? 'ou-skel--static'
      : undefined;
    return (
      <div
        ref={ref}
        className={cn(
          'ou-skel',
          SHAPE_CLASS[shape],
          sizeCls,
          animCls,
          widthToClass(width),
          className,
          cssStyleClass({
            width: widthToStyle(width),
            height: typeof height === 'number' ? `${height}px` : height,
            ...style,
          }, 'ou-skel-sx'),
        )}
        aria-hidden="true"
        {...rest}
      />
    );
  },
);
Skeleton.displayName = 'Skeleton';

// ─────────────────────────────────────────────────────────────────────────
// Layout helpers
// ─────────────────────────────────────────────────────────────────────────

export interface SkeletonStackProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: 'tight' | 'normal' | 'loose';
}
export const SkeletonStack = forwardRef<HTMLDivElement, SkeletonStackProps>(
  ({ density = 'normal', className, style, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'ou-skel-stack',
        density === 'tight' && 'ou-skel-stack--tight',
        density === 'loose' && 'ou-skel-stack--loose',
        className,
        cssStyleClass(style, 'ou-skel-stack-sx'),
      )}
      {...rest}
    />
  ),
);
SkeletonStack.displayName = 'SkeletonStack';

export const SkeletonRow = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-skel-row', className, cssStyleClass(style, 'ou-skel-row-sx'))} {...rest} />
  ),
);
SkeletonRow.displayName = 'SkeletonRow';

// ─────────────────────────────────────────────────────────────────────────
// SkeletonCard — пресет «карточка с media + текст»
// ─────────────────────────────────────────────────────────────────────────

export interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Показать media-блок сверху. */
  media?: boolean;
  /** Строк текста. */
  lines?: number;
}
export const SkeletonCard = forwardRef<HTMLDivElement, SkeletonCardProps>(
  ({ media, lines = 3, className, children, style, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-skel-card', className, cssStyleClass(style, 'ou-skel-card-sx'))} {...rest}>
      {media && <Skeleton shape="block" className="ou-skel-card__media" />}
      <Skeleton shape="line" size="heading" width="2/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} shape="line" width={i === lines - 1 ? '1/2' : 'full'} />
      ))}
      {children}
    </div>
  ),
);
SkeletonCard.displayName = 'SkeletonCard';

// ─────────────────────────────────────────────────────────────────────────
// SkeletonListRow — пресет «строка списка с аватаром»
// ─────────────────────────────────────────────────────────────────────────

export interface SkeletonListRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Аватар слева. */
  avatar?: boolean;
  /** Подпись (две строки). */
  hasMeta?: boolean;
  /** Кол-во trail-плейсхолдеров. */
  trail?: number;
}
export const SkeletonListRow = forwardRef<HTMLDivElement, SkeletonListRowProps>(
  ({ avatar = true, hasMeta = true, trail = 1, className, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-skel-list-row', className)} {...rest}>
      {avatar && <Skeleton shape="circle" />}
      <div className="ou-skel-list-row__lines">
        <Skeleton shape="line" width="2/3" />
        {hasMeta && <Skeleton shape="line" width="1/3" size="caption" />}
      </div>
      {trail > 0 && (
        <div className="ou-skel-list-row__trail">
          {Array.from({ length: trail }, (_, i) => (
            <Skeleton key={i} shape="line" width={64} />
          ))}
        </div>
      )}
    </div>
  ),
);
SkeletonListRow.displayName = 'SkeletonListRow';
