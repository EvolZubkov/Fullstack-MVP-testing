import React, { forwardRef, useState } from 'react';
import { cn, cssStyleClass } from '../utils';

// ─────────────────────────────────────────────────────────────────────────
// Container
// ─────────────────────────────────────────────────────────────────────────

export interface KanbanProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Kanban = forwardRef<HTMLDivElement, KanbanProps>(
  ({ className, children, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-kanban', className)} {...rest}>{children}</div>
  ),
);
Kanban.displayName = 'Kanban';

// ─────────────────────────────────────────────────────────────────────────
// Column
// ─────────────────────────────────────────────────────────────────────────

export type KanbanColumnDot = 'blue' | 'purple' | 'orange' | 'green' | 'pink' | 'gray';

export interface KanbanColumnProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Идентификатор колонки (используется в drag-and-drop). */
  columnId: string;
  title: React.ReactNode;
  count?: number;
  dot?: KanbanColumnDot;
  /** Контент шапки справа (меню/кнопки). */
  actions?: React.ReactNode;
  /** Кнопка/контент в подвале (например, «+ Добавить карточку»). */
  footer?: React.ReactNode;
  /** Колбэк по drop карточки в эту колонку. dataTransfer.types/getData('text/cardid'). */
  onCardDrop?: (cardId: string, sourceColumnId: string, destIndex: number) => void;
}

export const KanbanColumn = forwardRef<HTMLDivElement, KanbanColumnProps>(
  ({
    columnId, title, count, dot, actions, footer,
    onCardDrop, className, children, ...rest
  }, ref) => {
    const [over, setOver] = useState(false);
    return (
      <div
        ref={ref}
        className={cn('ou-kanban__column', className)}
        data-column-id={columnId}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('text/cardid')
            || e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const cardId = e.dataTransfer.getData('text/cardid');
          const srcCol = e.dataTransfer.getData('text/columnid');
          if (cardId && onCardDrop) {
            // index = end of column
            const bodies = (e.currentTarget as HTMLElement).querySelectorAll('.ou-kanban__card');
            onCardDrop(cardId, srcCol || columnId, bodies.length);
          }
        }}
        {...rest}
      >
        <div className="ou-kanban__head">
          {dot && <span className={cn('ou-kanban__head-dot', `ou-kanban__head-dot--${dot}`)} />}
          <span className="ou-kanban__head-title">{title}</span>
          {count !== undefined && <span className="ou-kanban__head-count">{count}</span>}
          {actions && <span className="ou-kanban__head-actions">{actions}</span>}
        </div>
        <div className="ou-kanban__body">
          {children}
          {over && <div className="ou-kanban__dropzone" />}
        </div>
        {footer}
      </div>
    );
  },
);
KanbanColumn.displayName = 'KanbanColumn';

// ─────────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────────

export interface KanbanCardProps extends React.HTMLAttributes<HTMLDivElement> {
  cardId: string;
  /** id исходной колонки (для drag). */
  columnId?: string;
  draggable?: boolean;
  /** Делает карточку «висящей» как пустой плейсхолдер во время drag. */
  isDragging?: boolean;
}

export const KanbanCard = forwardRef<HTMLDivElement, KanbanCardProps>(
  ({ cardId, columnId, draggable = true, isDragging, className, children, onDragStart, onDragEnd, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('ou-kanban__card', isDragging && 'is-dragging', className)}
      draggable={draggable}
      data-card-id={cardId}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/cardid', cardId);
        if (columnId) e.dataTransfer.setData('text/columnid', columnId);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(e);
      }}
      onDragEnd={onDragEnd}
      {...rest}
    >{children}</div>
  ),
);
KanbanCard.displayName = 'KanbanCard';

// ─────────────────────────────────────────────────────────────────────────
// Card slots
// ─────────────────────────────────────────────────────────────────────────

export type KanbanTagTone = 'blue' | 'purple' | 'orange' | 'green' | 'pink' | 'gray';

export interface KanbanTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: KanbanTagTone;
  /** Сплошная заливка (для must-see). */
  solid?: boolean;
}
export const KanbanTag = forwardRef<HTMLSpanElement, KanbanTagProps>(
  ({ tone, solid, className, children, ...rest }, ref) => (
    <span
      ref={ref}
      className={cn(
        'ou-kanban__tag',
        tone && `ou-kanban__tag--${tone}`,
        solid && 'ou-kanban__tag--solid',
        className,
      )}
      {...rest}
    >{children}</span>
  ),
);
KanbanTag.displayName = 'KanbanTag';

export const KanbanCardTags: React.FC<React.HTMLAttributes<HTMLDivElement>> =
  ({ className, ...rest }) => <div className={cn('ou-kanban__card-tags', className)} {...rest} />;
KanbanCardTags.displayName = 'KanbanCardTags';

export const KanbanCardTitle: React.FC<React.HTMLAttributes<HTMLDivElement>> =
  ({ className, ...rest }) => <div className={cn('ou-kanban__card-title', className)} {...rest} />;
KanbanCardTitle.displayName = 'KanbanCardTitle';

export const KanbanCardMeta: React.FC<React.HTMLAttributes<HTMLDivElement>> =
  ({ className, ...rest }) => <div className={cn('ou-kanban__card-meta', className)} {...rest} />;
KanbanCardMeta.displayName = 'KanbanCardMeta';

export interface KanbanCardProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  value: number;
  /** Текст рядом с шкалой (по умолчанию — %). */
  label?: React.ReactNode;
}
export const KanbanCardProgress: React.FC<KanbanCardProgressProps> =
  ({ value, label, className, ...rest }) => (
    <div className={cn('ou-kanban__card-progress', className)} {...rest}>
      <span className="ou-kanban__card-progress-track">
        <span
          className={cn(
            'ou-kanban__card-progress-fill',
            cssStyleClass({ width: `${Math.max(0, Math.min(100, value))}%` }, 'ou-kanban-progress'),
          )}
        />
      </span>
      <span>{label ?? `${value}%`}</span>
    </div>
  );
KanbanCardProgress.displayName = 'KanbanCardProgress';

export const KanbanCardFoot: React.FC<React.HTMLAttributes<HTMLDivElement>> =
  ({ className, ...rest }) => <div className={cn('ou-kanban__card-foot', className)} {...rest} />;
KanbanCardFoot.displayName = 'KanbanCardFoot';

export const KanbanCardFootStats: React.FC<React.HTMLAttributes<HTMLDivElement>> =
  ({ className, ...rest }) => <div className={cn('ou-kanban__card-foot-stats', className)} {...rest} />;
KanbanCardFootStats.displayName = 'KanbanCardFootStats';

// ─────────────────────────────────────────────────────────────────────────
// Extras: add buttons
// ─────────────────────────────────────────────────────────────────────────

export const KanbanAddCard: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> =
  ({ className, children = '+ Добавить', ...rest }) => (
    <button type="button" className={cn('ou-kanban__add', className)} {...rest}>{children}</button>
  );
KanbanAddCard.displayName = 'KanbanAddCard';

export const KanbanAddColumn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> =
  ({ className, children = '+ Добавить колонку', ...rest }) => (
    <button type="button" className={cn('ou-kanban__add-col', className)} {...rest}>{children}</button>
  );
KanbanAddColumn.displayName = 'KanbanAddColumn';
