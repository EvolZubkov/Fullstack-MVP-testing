import React, { useId } from 'react';
import { cn, cssStyleClass } from '../utils';
import { NumberInput } from './NumberInput';
import { Slider } from './Slider';

/** Одно утверждение группы: подпись и присвоенный балл. */
export interface BudgetAllocationItem {
  /** Подпись утверждения. */
  label: React.ReactNode;
  /** Подпись для программ чтения с экрана, если `label` не строка. */
  ariaLabel?: string;
}

export interface BudgetAllocationProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Утверждения в авторском порядке. */
  items: BudgetAllocationItem[];
  /** Присвоенные баллы по индексам утверждений. Контролируемое значение. */
  value: number[];
  onChange?: (value: number[]) => void;
  /** Общий бюджет, который распределяется целиком. */
  budget: number;
  /** Наименьший балл на одно утверждение. */
  minPerOption?: number;
  /** Наибольший балл на одно утверждение. */
  maxPerOption?: number;
  /** Только чтение: интерактив снят, значения показаны как есть. */
  readOnly?: boolean;
  disabled?: boolean;
  /**
   * Текст счётчика остатка. По умолчанию «Осталось: N из M», а при нулевом
   * остатке — «Вы использовали все баллы».
   */
  renderCounter?: (remaining: number, budget: number) => React.ReactNode;
}

/**
 * Распределение бюджета между утверждениями: учащийся делит фиксированное число
 * баллов, и сумма обязана сойтись ровно.
 *
 * Почему это ОДИН компонент, а не два примитива рядом. Доступный максимум КАЖДОЙ
 * строки зависит от значений соседних строк — он равен `min(максимум на вариант,
 * своё значение + остаток)`. Это состояние группы; владей им вызывающий экран,
 * синхронизацию пришлось бы повторять на каждом экране заново, и первое же
 * расхождение дало бы конфигурацию, которую нельзя заполнить.
 *
 * Превышение бюджета невозможно ПО ПОСТРОЕНИЮ, а не отклоняется после ввода:
 * ползунок и поле публикуют текущий доступный максимум, поэтому состояния
 * «перебор» не существует ни у мыши, ни у клавиатуры, ни у вставки. Возможен
 * только недобор, и о нём говорит счётчик остатка.
 *
 * Шкала ползунка ФИКСИРОВАНА бюджетом: длина дорожки всегда означает одно и то же.
 * Растяни её до текущего потолка — и значение строки визуально прыгало бы при
 * изменении СОСЕДНЕЙ строки, хотя сама строка не менялась. Подвижен только стоп,
 * и он показан глушёной зоной: иначе ползунок упирается в невидимую стену.
 */
export function BudgetAllocation({
  items,
  value,
  onChange,
  budget,
  minPerOption = 0,
  maxPerOption,
  readOnly,
  disabled,
  renderCounter,
  className,
  style,
  ...rest
}: BudgetAllocationProps) {
  const groupId = useId();
  const ceilingPerOption = maxPerOption ?? budget;

  const amounts = items.map((_, i) => {
    const raw = value[i];
    return Number.isFinite(raw) ? (raw as number) : minPerOption;
  });
  const total = amounts.reduce((sum, n) => sum + n, 0);
  const remaining = Math.max(0, budget - total);
  const complete = remaining === 0 && total === budget;

  /** Доступный максимум строки прямо сейчас: свой потолок в пределах остатка. */
  const ceilingOf = (index: number) => Math.min(ceilingPerOption, amounts[index] + remaining);

  const setAt = (index: number, next: number) => {
    if (readOnly || disabled) return;
    const clamped = Math.min(Math.max(Math.round(next), minPerOption), ceilingOf(index));
    if (clamped === amounts[index]) return;
    const out = [...amounts];
    out[index] = clamped;
    onChange?.(out);
  };

  const counter = renderCounter
    ? renderCounter(remaining, budget)
    : complete
      ? 'Вы использовали все баллы'
      : (
        <>
          Осталось: <strong>{remaining}</strong> из {budget}
        </>
      );

  return (
    <div
      className={cn(
        'ou-alloc',
        readOnly && 'ou-alloc--readonly',
        disabled && 'is-disabled',
        className,
        cssStyleClass(style, 'ou-alloc-sx'),
      )}
      {...rest}
    >
      {/* Счётчик остатка — живая область: смена остатка это главное событие экрана,
          и экранный диктор должен её озвучивать, а не молчать до конца ввода. */}
      <div className={cn('ou-alloc__counter', complete && 'is-complete')} role="status" aria-live="polite">
        {counter}
      </div>

      <div className="ou-alloc__rows">
        {items.map((item, i) => {
          const amount = amounts[i];
          const ceiling = ceilingOf(i);
          const name = item.ariaLabel ?? (typeof item.label === 'string' ? item.label : `Утверждение ${i + 1}`);
          // «Выше минимума», а не «не ноль»: при ненулевом минимуме поля
          // предзаполнены, и правило «не ноль» отметило бы все строки сразу —
          // подсветка сказала бы «вы это выбрали» там, где выбрала система.
          const weighted = amount > minPerOption;
          const capPercent = budget > 0 ? Math.min(100, (ceiling / budget) * 100) : 100;

          return (
            <div
              key={i}
              className={cn('ou-alloc__row', weighted && 'is-weighted')}
              data-index={i}
            >
              <span className="ou-alloc__label" id={`${groupId}-label-${i}`}>{item.label}</span>

              <div className="ou-alloc__slider">
                <Slider
                  min={0}
                  max={budget}
                  step={1}
                  value={amount}
                  ariaLabel={name}
                  disabled={disabled || readOnly}
                  onChange={(v) => setAt(i, Array.isArray(v) ? v[1] : v)}
                />
                {capPercent < 100 && (
                  <span
                    className={cn('ou-alloc__cap', cssStyleClass({ left: `${capPercent}%` }, 'ou-alloc-cap'))}
                    aria-hidden="true"
                  />
                )}
              </div>

              {readOnly ? (
                <span className="ou-alloc__value">{amount}</span>
              ) : (
                <div className="ou-alloc__field">
                  <NumberInput
                    value={amount}
                    min={minPerOption}
                    max={ceiling}
                    step={1}
                    size="m"
                    layout="split"
                    disabled={disabled}
                    aria-label={`Баллы: ${name}`}
                    onChange={(v) => setAt(i, v)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
BudgetAllocation.displayName = 'BudgetAllocation';
