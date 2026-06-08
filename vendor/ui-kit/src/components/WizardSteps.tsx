import React, { forwardRef, useState } from 'react';
import { cn } from '../utils';
import type { StepperStatus } from './Stepper';

export interface WizardStep {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Контент панели. */
  content?: React.ReactNode;
  /** Заголовок над контентом. */
  heading?: React.ReactNode;
  /** Подпись над заголовком («ШАГ 1 ИЗ 3»). */
  counter?: React.ReactNode;
  /** Описание под заголовком. */
  bodyDescription?: React.ReactNode;
  disabled?: boolean;
}

export interface WizardStepsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  steps: WizardStep[];
  /** Контролируемое значение (id или индекс). */
  current?: string | number;
  defaultCurrent?: string | number;
  onChange?: (id: string, index: number) => void;
  /** Кастомные статусы (overrides авто). */
  statuses?: Record<string, StepperStatus>;
  /** Горизонтальная навигация (вместо колоночной). */
  horizontal?: boolean;
  /** Узкий сайдбар. */
  narrow?: boolean;
  /** Кнопки навигации (rendered в footer). По умолчанию — auto. */
  footer?: React.ReactNode;
  /** Колбэки навигации. */
  onBack?: () => void;
  onNext?: () => void;
  onFinish?: () => void;
  /** Метки кнопок. */
  backLabel?: React.ReactNode;
  nextLabel?: React.ReactNode;
  finishLabel?: React.ReactNode;
}

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8.5l3 3 5-6" />
  </svg>
);

function resolveStatus(
  idx: number,
  currentIdx: number,
  step: WizardStep,
  statuses?: Record<string, StepperStatus>,
): StepperStatus {
  if (statuses && statuses[step.id]) return statuses[step.id];
  if (idx < currentIdx) return 'done';
  if (idx === currentIdx) return 'current';
  return 'pending';
}

export const WizardSteps = forwardRef<HTMLDivElement, WizardStepsProps>(
  ({
    steps, current, defaultCurrent, onChange, statuses,
    horizontal, narrow, footer,
    onBack, onNext, onFinish,
    backLabel = 'Назад', nextLabel = 'Далее', finishLabel = 'Готово',
    className, ...rest
  }, ref) => {
    const controlled = current !== undefined;
    const initial = defaultCurrent ?? steps[0]?.id;
    const [internal, setInternal] = useState<string | number>(initial as string | number);
    const value = controlled ? current : internal;
    const currentIdx = typeof value === 'number'
      ? (value as number)
      : Math.max(0, steps.findIndex(s => s.id === value));

    const setCurrent = (idx: number) => {
      const step = steps[idx];
      if (!step) return;
      if (!controlled) setInternal(step.id);
      onChange?.(step.id, idx);
    };

    const step = steps[currentIdx];
    const isLast = currentIdx === steps.length - 1;

    return (
      <div
        ref={ref}
        className={cn(
          'ou-wiz',
          horizontal && 'ou-wiz--horizontal',
          narrow && 'ou-wiz--narrow',
          className,
        )}
        {...rest}
      >
        <div className="ou-wiz__nav" role="tablist" {...(horizontal ? { 'aria-orientation': 'horizontal' as const } : { 'aria-orientation': 'vertical' as const })}>
          {steps.map((s, idx) => {
            const status = resolveStatus(idx, currentIdx, s, statuses);
            return (
              <button
                key={s.id} type="button"
                role="tab"
                {...(idx === currentIdx ? { 'aria-selected': 'true' as const } : { 'aria-selected': 'false' as const })}
                {...(s.disabled ? { 'aria-disabled': 'true' as const } : {})}
                tabIndex={idx === currentIdx ? 0 : -1}
                className={cn(
                  'ou-wiz__step',
                  status === 'done' && 'is-done',
                  status === 'current' && 'is-current',
                  status === 'error' && 'is-error',
                  s.disabled && 'is-disabled',
                )}
                onClick={() => !s.disabled && setCurrent(idx)}
              >
                <span className="ou-wiz__bullet">
                  {status === 'done' ? <CheckIcon /> : idx + 1}
                </span>
                <span className="ou-wiz__label">
                  <span className="ou-wiz__title">{s.title}</span>
                  {s.description && <span className="ou-wiz__sub">{s.description}</span>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="ou-wiz__body">
          {(step?.counter || step?.heading || step?.bodyDescription) && (
            <div className="ou-wiz__head">
              <span className="ou-wiz__counter">
                {step?.counter ?? `Шаг ${currentIdx + 1} из ${steps.length}`}
              </span>
              {step?.heading && <h2 className="ou-wiz__heading">{step.heading}</h2>}
              {step?.bodyDescription && <p className="ou-wiz__desc">{step.bodyDescription}</p>}
            </div>
          )}
          <div className="ou-wiz__content">{step?.content}</div>
          {footer ?? (
            <div className="ou-wiz__footer">
              <button
                type="button" className="ou-btn ou-btn--secondary"
                disabled={currentIdx === 0}
                onClick={() => { onBack?.(); setCurrent(currentIdx - 1); }}
              >{backLabel}</button>
              <span className="ou-wiz__footer-right">
                {isLast ? (
                  <button
                    type="button" className="ou-btn ou-btn--primary"
                    onClick={() => onFinish?.()}
                  >{finishLabel}</button>
                ) : (
                  <button
                    type="button" className="ou-btn ou-btn--primary"
                    onClick={() => { onNext?.(); setCurrent(currentIdx + 1); }}
                  >{nextLabel}</button>
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  },
);
WizardSteps.displayName = 'WizardSteps';
