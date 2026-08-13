import React, { forwardRef } from 'react';
import { cn, cssStyleClass } from '../utils';

// ─────────────────────────────────────────────────────────────────────────
// FormField — лейбл + контрол + подсказка/ошибка/успех
// ─────────────────────────────────────────────────────────────────────────

export type FormFieldTone = 'default' | 'error' | 'success' | 'warning';

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** Маркер обязательности «*». */
  required?: boolean;
  /** Метка «опционально». */
  optional?: boolean;
  /** Подсказка под полем. */
  hint?: React.ReactNode;
  /** Текст ошибки (приоритетнее success). */
  error?: React.ReactNode;
  /** Текст успешной валидации. */
  success?: React.ReactNode;
  /** Тон вручную (если не задан error/success). */
  tone?: FormFieldTone;
  /** Иконка справа от лейбла (подсказка). */
  info?: React.ReactNode;
  /** Горизонтальная компоновка (label слева). */
  horizontal?: boolean;
  /** id связанного контрола (для for/htmlFor). */
  htmlFor?: string;
  children?: React.ReactNode;
}

export const FormField = forwardRef<HTMLDivElement, FormFieldProps>(
  ({
    label, description, required, optional, hint, error, success, tone,
    info, horizontal, htmlFor, className, children, ...rest
  }, ref) => {
    const t: FormFieldTone = error ? 'error' : success ? 'success' : (tone ?? 'default');
    const msg = error ?? success ?? hint;
    return (
      <div
        ref={ref}
        className={cn(
          'ou-formfield',
          horizontal && 'ou-formfield--horizontal',
          className,
        )}
        {...rest}
      >
        {(label || description) && (
          <div className="ou-formfield__head">
            {label && (
              <label htmlFor={htmlFor} className="ou-formfield__lbl">
                {label}
                {required && <span className="ou-formfield__lbl-req"> *</span>}
                {optional && <span className="ou-formfield__lbl-opt"> опционально</span>}
                {info && <span className="ou-formfield__lbl-info" aria-hidden="true">{info}</span>}
              </label>
            )}
            {description && <span className="ou-formfield__desc">{description}</span>}
          </div>
        )}
        <div className="ou-formfield__body">
          {children}
          {msg && (
            <span className={cn('ou-formfield__msg', t !== 'default' && `ou-formfield__msg--${t}`)}>
              {msg}
            </span>
          )}
        </div>
      </div>
    );
  },
);
FormField.displayName = 'FormField';

// ─────────────────────────────────────────────────────────────────────────
// FormGroup — сетка из 1/2/3 колонок
// ─────────────────────────────────────────────────────────────────────────

export interface FormGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: 'one' | 'two' | 'three';
}

export const FormGroup = forwardRef<HTMLDivElement, FormGroupProps>(
  ({ columns = 'two', className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('ou-formgroup', `ou-formgroup--${columns}`, className)}
      {...rest}
    >{children}</div>
  ),
);
FormGroup.displayName = 'FormGroup';

// ─────────────────────────────────────────────────────────────────────────
// FormSection — секция: intro + body
// ─────────────────────────────────────────────────────────────────────────

export interface FormSectionProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  /**
   * Заголовок НАД содержимым, а не в отдельной колонке слева. Нужен в узком
   * контейнере (карточка, панель-ящик), где колонка в 280px забирает у полей
   * половину ширины. Модификатор `--stacked` в стилях был, а способа его
   * включить — нет.
   */
  stacked?: boolean;
}

export const FormSection = forwardRef<HTMLDivElement, FormSectionProps>(
  ({ title, subtitle, meta, stacked, className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('ou-formsection', stacked && 'ou-formsection--stacked', className)}
      {...rest}
    >
      {(title || subtitle || meta) && (
        <div className="ou-formsection__intro">
          {title && <h3 className="ou-formsection__title">{title}</h3>}
          {subtitle && <p className="ou-formsection__sub">{subtitle}</p>}
          {meta && <span className="ou-formsection__meta">{meta}</span>}
        </div>
      )}
      <div className="ou-formsection__body">{children}</div>
    </div>
  ),
);
FormSection.displayName = 'FormSection';

// ─────────────────────────────────────────────────────────────────────────
// FormCard — контейнер: header + body + footer
// ─────────────────────────────────────────────────────────────────────────

export interface FormCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Доп. контент в шапке (бейдж шага, действия). */
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  /** Padding для тела (override). */
  bodyStyle?: React.CSSProperties;
}

export const FormCard = forwardRef<HTMLDivElement, FormCardProps>(
  ({ title, subtitle, headerExtra, footer, bodyStyle, className, children, ...rest }, ref) => (
    <div ref={ref} className={cn('ou-formcard', className)} {...rest}>
      {(title || subtitle || headerExtra) && (
        <div className="ou-formcard__header">
          <div className="ou-formcard__header-text">
            {title && <h2 className="ou-formcard__title">{title}</h2>}
            {subtitle && <p className="ou-formcard__sub">{subtitle}</p>}
          </div>
          {headerExtra}
        </div>
      )}
      <div className={cn('ou-formcard__body', cssStyleClass(bodyStyle, 'ou-formcard-body'))}>{children}</div>
      {footer && <div className="ou-formcard__footer">{footer}</div>}
    </div>
  ),
);
FormCard.displayName = 'FormCard';

// ─────────────────────────────────────────────────────────────────────────
// FormActions — фикс-футер с действиями
// ─────────────────────────────────────────────────────────────────────────

export interface FormActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Положение основных кнопок. */
  align?: 'start' | 'end' | 'between';
  /** Левая часть (например, статус «не сохранено»). */
  meta?: React.ReactNode;
  /** Прилипает к низу окна. */
  sticky?: boolean;
}

export const FormActions = forwardRef<HTMLDivElement, FormActionsProps>(
  ({ align = 'end', meta, sticky, className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'ou-formactions',
        `ou-formactions--${align}`,
        sticky && 'ou-formactions--sticky',
        className,
      )}
      {...rest}
    >
      {meta && <span className="ou-formactions__meta">{meta}</span>}
      <span className="ou-formactions__buttons">{children}</span>
    </div>
  ),
);
FormActions.displayName = 'FormActions';
