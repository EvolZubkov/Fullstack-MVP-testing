import React, { forwardRef, useEffect, useId, useState } from 'react';
import { cn, cssStyleClass, type Size } from '../utils';

export type StepperLayout = 'split' | 'right' | 'inline';

/**
 * Всё, кроме значения: обе разновидности поля — с пустым и без — делят один набор.
 */
export interface NumberInputBaseProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange' | 'value' | 'prefix'> {
  min?: number;
  max?: number;
  step?: number;
  size?: Size;
  layout?: StepperLayout;
  /** Признак pill-варианта (компактные скруглённые края). */
  pill?: boolean;
  label?: React.ReactNode;
  /** Нейтральная подсказка под полем. */
  hint?: React.ReactNode;
  /** Текст ошибки — автоматически переводит поле в состояние ошибки. */
  error?: React.ReactNode;
  /** Единица измерения, например «ч», «%», «дн.». */
  suffix?: React.ReactNode;
  /** Явный флаг ошибки без текста (только рамка). Не нужен, если передан error. */
  invalid?: boolean;
  fullWidth?: boolean;
  /** Ширина внутреннего бокса в px. */
  boxWidth?: number | string;
  /** Подписи для кнопок (a11y). */
  decLabel?: string;
  incLabel?: string;
}

/** Обычное числовое поле: значение есть всегда. */
export interface NumberInputProps extends NumberInputBaseProps {
  allowEmpty?: false;
  /** Текущее значение. Контролируемое поле. */
  value: number;
  onChange?: (value: number) => void;
}

/**
 * Поле, у которого ПУСТО — самостоятельное значение, а не ноль.
 *
 * Нужно там, где «значения нет» и «значение равно нулю» — разные утверждения:
 * вклад вопроса в шкалу, необязательный порог, переопределение цены. Разновидность
 * заведена отдельным типом, а не расширением обычного: иначе каждому из уже
 * существующих полей пришлось бы разбирать `null`, которого оно никогда не получит.
 */
export interface NumberInputEmptyProps extends NumberInputBaseProps {
  allowEmpty: true;
  value: number | null;
  onChange?: (value: number | null) => void;
}

const IconMinus = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M5 12h14" />
  </svg>
);
const IconPlus = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconChevUp = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <polyline points="6 15 12 9 18 15" />
  </svg>
);
const IconChevDown = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/** Внутренняя разновидность: реализация одна на оба типа выше. */
type NumberInputAnyProps = NumberInputBaseProps & {
  allowEmpty?: boolean;
  value: number | null;
  onChange?: (value: never) => void;
};

const NumberInputImpl = forwardRef<HTMLInputElement, NumberInputAnyProps>(
  ({
    value, onChange, allowEmpty, min = -Infinity, max = Infinity, step = 1,
    size = 'm', layout = 'split', pill, label, hint, error, suffix,
    disabled, invalid, fullWidth, boxWidth, className, id,
    decLabel = 'Уменьшить', incLabel = 'Увеличить',
    'aria-label': ariaLabel, onBlur, ...rest
  }, ref) => {
    const autoId = useId();
    const fieldId = id || `ou-number-${autoId}`;
    const resolvedInvalid = invalid || !!error;
    const clamp = (v: number) => Math.min(max, Math.max(min, v));
    const emit = onChange as ((value: number | null) => void) | undefined;
    const empty = value === null || value === undefined;
    const set = (v: number) => {
      if (Number.isNaN(v)) return;
      emit?.(clamp(v));
    };
    // Шаг от пустого поля начинает с нижней границы, а без неё — с нуля: иначе первое
    // нажатие «Больше» не имеет от чего отсчитывать.
    const base = empty ? (Number.isFinite(min) ? min : 0) : (value as number);
    const atMin = !empty && (value as number) <= min;
    const atMax = !empty && (value as number) >= max;

    // Живой текст набора. Без него поле, управляемое ЧИСЛОМ, невозможно набрать: «1,»
    // разбирается в 1, число возвращается в поле и стирает запятую, а «-» разбирается
    // в NaN и стирается целиком. Черновик держит ровно то, что человек напечатал, а
    // наружу уходит только разобранное число.
    const [draft, setDraft] = useState<string | null>(null);
    const parseText = (text: string): number | null | undefined => {
      if (text.trim() === '') return null;
      const n = Number(text.replace(',', '.'));
      return Number.isNaN(n) ? undefined : n;
    };
    useEffect(() => {
      if (draft === null) return;
      // Значение пришло со стороны и разошлось с набранным — черновик больше не про него.
      const shownValue = parseText(draft);
      const target = empty ? null : (value as number);
      if (shownValue !== target) setDraft(null);
      // Пересинхронизацию задаёт только `value`: `draft` здесь — то, что мы защищаем.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
    const shown = draft ?? (empty ? '' : String(value));

    return (
      <div className={cn(
        'ou-number',
        `ou-number--${size}`,
        `ou-number--${layout}`,
        pill && 'ou-number--pill',
        fullWidth && 'ou-number--full',
        disabled && 'is-disabled',
        resolvedInvalid && 'is-invalid',
        className,
      )}>
        {label && <label htmlFor={fieldId} className="ou-number__lbl">{label}</label>}
        <div className={cn('ou-number__box', cssStyleClass(boxWidth ? { width: boxWidth } : undefined, 'ou-number-box'))}>
          {layout === 'split' && (
            <button
              type="button" className="ou-number__btn"
              aria-label={decLabel}
              disabled={disabled || atMin}
              onClick={() => set(base - step)}
            ><IconMinus /></button>
          )}
          <input
            ref={ref}
            id={fieldId}
            className="ou-number__input"
            type="text"
            inputMode="numeric"
            value={shown}
            aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
            aria-invalid={resolvedInvalid || undefined}
            aria-describedby={(error || hint) ? `${fieldId}-msg` : undefined}
            disabled={disabled}
            onChange={(e) => {
              const text = e.target.value;
              setDraft(text);
              const parsed = parseText(text);
              // Пустое поле — значение, а не полпути к числу: сообщаем его сразу, иначе
              // очистить поле невозможно. Незаконченный набор («-», «1,») не сообщаем:
              // числа в нём ещё нет, а черновик его сохранит.
              if (parsed === null) {
                // Поле без пустого значения обязано остаться числом: очистка приводит его
                // к нижней границе — так оно вело себя и до появления черновика.
                if (allowEmpty) emit?.(null);
                else set(0);
                return;
              }
              if (parsed !== undefined) set(parsed);
            }}
            onBlur={(e) => {
              // Re-clamp on blur to ensure value is within bounds.
              const parsed = parseText(e.target.value);
              if (typeof parsed === 'number') {
                const c = clamp(parsed);
                if (c !== value) emit?.(c);
              }
              // Набор закончен — дальше поле снова показывает значение, а не текст.
              setDraft(null);
              onBlur?.(e);
            }}
            {...rest}
          />
          {suffix && <span className="ou-number__suffix">{suffix}</span>}
          {layout === 'split' && (
            <button
              type="button" className="ou-number__btn"
              aria-label={incLabel}
              disabled={disabled || atMax}
              onClick={() => set(base + step)}
            ><IconPlus /></button>
          )}
          {layout === 'right' && (
            <span className="ou-number__stack">
              <button
                type="button" className="ou-number__btn ou-number__btn--stack"
                aria-label={incLabel}
                disabled={disabled || atMax}
                onClick={() => set(base + step)}
              ><IconChevUp /></button>
              <button
                type="button" className="ou-number__btn ou-number__btn--stack"
                aria-label={decLabel}
                disabled={disabled || atMin}
                onClick={() => set(base - step)}
              ><IconChevDown /></button>
            </span>
          )}
          {layout === 'inline' && (
            <>
              <button
                type="button" className="ou-number__btn ou-number__btn--ghost"
                aria-label={decLabel}
                disabled={disabled || atMin}
                onClick={() => set(base - step)}
              ><IconMinus /></button>
              <button
                type="button" className="ou-number__btn ou-number__btn--ghost"
                aria-label={incLabel}
                disabled={disabled || atMax}
                onClick={() => set(base + step)}
              ><IconPlus /></button>
            </>
          )}
        </div>
        {(error || hint) && (
          <div id={`${fieldId}-msg`} className={cn('ou-number__hint', !!error && 'ou-number__hint--error')}>
            {error || hint}
          </div>
        )}
      </div>
    );
  },
);
NumberInputImpl.displayName = 'NumberInput';

/**
 * Поле принимает ЛИБО обычную пару «число + обработчик числа», ЛИБО, при `allowEmpty`,
 * пару, где значением может быть `null`. Перегрузка нужна, чтобы уже написанные поля
 * продолжали получать в обработчик число, а не `number | null`.
 */
export const NumberInput = NumberInputImpl as unknown as {
  (props: NumberInputProps & React.RefAttributes<HTMLInputElement>): React.ReactElement | null;
  (props: NumberInputEmptyProps & React.RefAttributes<HTMLInputElement>): React.ReactElement | null;
  displayName?: string;
};
