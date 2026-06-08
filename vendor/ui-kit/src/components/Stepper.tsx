import React, { forwardRef } from 'react';
import { cn } from '../utils';

export interface StepperStep {
  id: string;
  title: React.ReactNode;
  /** Подпись под title. */
  description?: React.ReactNode;
  /** Произвольный контент bullet (иначе — номер 1/2/3…). */
  icon?: React.ReactNode;
  disabled?: boolean;
}

export type StepperStatus = 'done' | 'current' | 'pending' | 'error';

export interface StepperProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  steps: StepperStep[];
  /** Активный шаг (id или 0-индекс). */
  current?: string | number;
  /** Кастомный набор статусов на шаг (overrides авто). */
  statuses?: Record<string, StepperStatus>;
  /** Кликабельный (клик по шагу). */
  onStepClick?: (id: string, index: number) => void;
  /** Вертикальная компоновка. */
  vertical?: boolean;
  /** Без подписей. */
  compact?: boolean;
}

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const ErrorIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

function resolveStatus(
  idx: number,
  currentIdx: number,
  step: StepperStep,
  statuses?: Record<string, StepperStatus>,
): StepperStatus {
  if (statuses && statuses[step.id]) return statuses[step.id];
  if (idx < currentIdx) return 'done';
  if (idx === currentIdx) return 'current';
  return 'pending';
}

export const Stepper = forwardRef<HTMLDivElement, StepperProps>(
  ({
    steps, current = 0, statuses, onStepClick,
    vertical, compact, className, ...rest
  }, ref) => {
    const currentIdx = typeof current === 'number'
      ? current
      : Math.max(0, steps.findIndex(s => s.id === current));

    return (
      <div
        ref={ref}
        className={cn(
          'ou-stepper',
          vertical && 'ou-stepper--vertical',
          compact && 'ou-stepper--compact',
          className,
        )}
        role="group" aria-label="Стэппер"
        {...rest}
      >
        {steps.map((step, idx) => {
          const status = resolveStatus(idx, currentIdx, step, statuses);
          const isClickable = !!onStepClick && !step.disabled;
          const Tag = (isClickable ? 'button' : 'div') as 'button' | 'div';

          const bulletContent =
            status === 'done' ? <CheckIcon />
            : status === 'error' ? <ErrorIcon />
            : step.icon ?? <span className="ou-stepper__num" data-step={idx + 1} />;

          return (
            <Tag
              key={step.id}
              type={isClickable ? 'button' : undefined}
              disabled={isClickable && step.disabled}
              onClick={isClickable ? () => onStepClick?.(step.id, idx) : undefined}
              className={cn(
                'ou-stepper__step',
                isClickable && 'ou-stepper__step--btn',
                status === 'done' && 'is-done',
                status === 'current' && 'is-current',
                status === 'error' && 'is-error',
                step.disabled && 'is-disabled',
              )}
              aria-current={status === 'current' ? 'step' : undefined}
            >
              <span className="ou-stepper__bullet">{bulletContent}</span>
              {!compact && (
                <span className="ou-stepper__label">
                  <span className="ou-stepper__title">{step.title}</span>
                  {step.description && <span className="ou-stepper__sub">{step.description}</span>}
                </span>
              )}
            </Tag>
          );
        })}
      </div>
    );
  },
);
Stepper.displayName = 'Stepper';
