import React, { forwardRef, useCallback, useRef, useState } from 'react';
import { cn, cssStyleClass } from '../utils';

// ─────────────────────────────────────────────────────────────────────────
// FileUploader · dropzone (Compact / Full)
// ─────────────────────────────────────────────────────────────────────────

export interface FileUploaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onError' | 'onChange' | 'title'> {
  /** Заголовок dropzone. */
  title?: React.ReactNode;
  /** Подзаголовок (поясняющая строка). */
  description?: React.ReactNode;
  /** CTA-кнопка. */
  cta?: React.ReactNode;
  /** Принимаемые типы файлов (input[type=file]#accept). */
  accept?: string;
  /** Разрешить выбор нескольких файлов. */
  multiple?: boolean;
  /** Лимит размера каждого файла (МБ). 0 — без лимита. */
  maxSizeMb?: number;
  /** Компактный режим (одной строкой). */
  compact?: boolean;
  /** Состояние ошибки. */
  error?: boolean;
  /** Disabled. */
  disabled?: boolean;
  /** Колбэк со списком выбранных/перетащенных файлов. */
  onFiles?: (files: File[]) => void;
  /** Кастомное содержимое (заменяет icon/title/description/cta). */
  children?: React.ReactNode;
  /** Кастомная иконка. */
  icon?: React.ReactNode;
}

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export const FileUploader = forwardRef<HTMLDivElement, FileUploaderProps>(
  ({
    title = 'Перетащите файл сюда',
    description = 'или нажмите, чтобы выбрать',
    cta = 'Выбрать файл',
    accept, multiple, maxSizeMb,
    compact, error, disabled,
    onFiles, icon, children,
    className, onClick, style, ...rest
  }, ref) => {
    const [active, setActive] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const filterValid = useCallback((files: File[]) => {
      if (!maxSizeMb) return files;
      return files.filter(f => f.size <= maxSizeMb * 1024 * 1024);
    }, [maxSizeMb]);

    const openPicker = () => inputRef.current?.click();

    const onDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setActive(true);
    };
    const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setActive(false); };
    const onDrop = (e: React.DragEvent) => {
      e.preventDefault(); setActive(false);
      if (disabled) return;
      const files = filterValid(Array.from(e.dataTransfer?.files ?? []));
      if (files.length) onFiles?.(files);
    };
    const onChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
      const files = filterValid(Array.from(e.target.files ?? []));
      if (files.length) onFiles?.(files);
      e.target.value = '';
    };

    return (
      <>
        <div
          ref={ref}
          className={cn(
            'ou-uploader',
            compact && 'ou-uploader--compact',
            active && !disabled && 'is-active',
            error && 'is-error',
            disabled && 'is-disabled',
            className,
            cssStyleClass(style, 'ou-uploader-sx'),
          )}
          onClick={(e) => { if (!disabled) openPicker(); onClick?.(e); }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          role="button"
          tabIndex={disabled ? -1 : 0}
          {...(disabled ? { 'aria-disabled': 'true' as const } : {})}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
          }}
          {...rest}
        >
          {children ?? (
            <>
              <span className="ou-uploader__icon">{icon ?? (error ? <AlertIcon /> : <UploadIcon />)}</span>
              <span className="ou-uploader__title">{title}</span>
              {description && <span className="ou-uploader__sub">{description}</span>}
              {cta && !disabled && (
                <span className="ou-uploader__cta" aria-hidden="true">{cta}</span>
              )}
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          className="ou-uploader__input"
          aria-label="Выбор файлов"
          aria-hidden="true"
          tabIndex={-1}
          accept={accept}
          multiple={multiple}
          onChange={onChange}
        />
      </>
    );
  },
);
FileUploader.displayName = 'FileUploader';

// ─────────────────────────────────────────────────────────────────────────
// FileItem · одна строка списка
// ─────────────────────────────────────────────────────────────────────────

export type FileItemStatus = 'idle' | 'uploading' | 'success' | 'error';
export type FileItemKind = 'pdf' | 'doc' | 'xls' | 'zip' | 'img' | 'other';

export interface FileItemAction {
  icon: React.ReactNode;
  ariaLabel: string;
  /** Красный акцент для danger-действий. */
  danger?: boolean;
  onClick?: () => void;
}

export interface FileItemProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  /** Подсказка/мета: размер, дата. */
  meta?: React.ReactNode;
  /** Тип файла для thumb (определяет цвет). */
  kind?: FileItemKind;
  /** Что показать в превью (по умолчанию аббревиатура от kind). */
  thumb?: React.ReactNode;
  /** Состояние. */
  status?: FileItemStatus;
  /** Прогресс 0-100 для статуса uploading. */
  progress?: number;
  /** Кастомные действия справа. */
  actions?: FileItemAction[];
}

const KIND_LABEL: Record<FileItemKind, string> = {
  pdf: 'PDF', doc: 'DOC', xls: 'XLS', zip: 'ZIP', img: 'IMG', other: 'FILE',
};

export const FileItem = forwardRef<HTMLDivElement, FileItemProps>(
  ({
    name, meta, kind = 'other', thumb, status = 'idle', progress = 0, actions,
    className, ...rest
  }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'ou-file',
          status === 'uploading' && 'is-uploading',
          status === 'success' && 'is-success',
          status === 'error' && 'is-error',
          className,
        )}
        {...rest}
      >
        <div className={cn('ou-file__thumb', `ou-file__thumb--${kind}`)}>
          {thumb ?? KIND_LABEL[kind]}
        </div>
        <div className="ou-file__main">
          <div className="ou-file__name">{name}</div>
          {status === 'uploading' && (
            <div className="ou-file__progress">
              <i className={cssStyleClass({ width: `${Math.max(0, Math.min(100, progress))}%` }, 'ou-file-progress')} />
            </div>
          )}
          {meta && <div className="ou-file__meta">{meta}</div>}
        </div>
        {actions && actions.length > 0 && (
          <div className="ou-file__actions">
            {actions.map((a, i) => (
              <button
                key={i}
                type="button"
                className={cn('ou-file__btn', a.danger && 'ou-file__btn--danger')}
                aria-label={a.ariaLabel}
                onClick={a.onClick}
              >{a.icon}</button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
FileItem.displayName = 'FileItem';

// ─────────────────────────────────────────────────────────────────────────
// FileTile · вертикальный тайл для галерейного списка
// ─────────────────────────────────────────────────────────────────────────

export interface FileTileProps extends React.HTMLAttributes<HTMLDivElement> {
  name?: string;
  meta?: React.ReactNode;
  /** Подпись типа (JPG, PDF…). */
  tag?: React.ReactNode;
  /** Превью-картинка (URL). Иначе — иконка/тег. */
  previewSrc?: string;
  /** CSS background для превью (когда нет previewSrc). */
  previewBackground?: string;
  /** Кастомное содержимое внутри preview-окна. */
  previewContent?: React.ReactNode;
  /** Колбэк по кнопке «×» (удаление). null — кнопка не показывается. */
  onRemove?: (() => void) | null;
  /** Тайл «Добавить файл». */
  add?: boolean;
  /** Подпись под иконкой для add-режима. */
  addHint?: React.ReactNode;
}

export const FileTile = forwardRef<HTMLDivElement, FileTileProps>(
  ({
    name, meta, tag, previewSrc, previewBackground, previewContent,
    onRemove, add, addHint = 'Добавить файл',
    className, style, ...rest
  }, ref) => {
    if (add) {
      return (
        <div ref={ref} className={cn('ou-file-tile ou-file-tile--add', className, cssStyleClass(style, 'ou-file-tile-sx'))} {...rest}>
          <div className="ou-file-tile__preview">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="ou-file-tile__hint">{addHint}</span>
          </div>
        </div>
      );
    }
    const previewStyle: React.CSSProperties = previewSrc
      ? { background: `url(${previewSrc}) center/cover` }
      : previewBackground
        ? { background: previewBackground }
        : {};
    return (
      <div ref={ref} className={cn('ou-file-tile', className, cssStyleClass(style, 'ou-file-tile-sx'))} {...rest}>
        <div className={cn('ou-file-tile__preview', cssStyleClass(previewStyle, 'ou-file-preview'))}>
          {tag && <span className="ou-file-tile__tag">{tag}</span>}
          {onRemove && (
            <button
              type="button" className="ou-file-tile__close"
              aria-label="Удалить"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          )}
          {previewContent}
        </div>
        {name && <div className="ou-file-tile__name">{name}</div>}
        {meta && <div className="ou-file-tile__meta">{meta}</div>}
      </div>
    );
  },
);
FileTile.displayName = 'FileTile';
