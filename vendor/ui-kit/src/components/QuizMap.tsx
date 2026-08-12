import React, { forwardRef } from 'react';
import { cn } from '../utils';

/**
 * @module QuizMap
 * Question-map / progress tracker for tests and assessments.
 *
 * Renders a grid of clickable (or read-only) dots, one per question,
 * in three shapes (circle, square, pill) and four sizes (xs–l).
 *
 * Two usage modes:
 *  - **in-progress** — states: answered / current / flagged
 *  - **review** — states: correct / incorrect / partial / unanswered
 *
 * Sub-components: {@link QuizSummary} — compact inline score badge.
 */

/* ── types ────────────────────────────────────────────────────────── */

/** Dot state. Empty string = unanswered (default). */
export type QuizDotState =
  | ''                  // unanswered
  | 'answered'          // answered (in-progress)
  | 'current'           // currently active question
  | 'flagged'           // flagged for review, not yet answered
  | 'answered-flagged'  // answered AND flagged for revisit
  | 'correct'           // correct (review mode)
  | 'incorrect'         // wrong (review mode)
  | 'partial'           // partially correct (review mode)
  | 'unanswered'        // explicitly unanswered in review (shows border)
  | 'skipped';          // skipped

export type QuizShape = 'circle' | 'square' | 'pill';
export type QuizSize  = 'xs' | 's' | 'm' | 'l';

/** Legend entry rendered below the dot grid. */
export interface QuizLegendItem {
  /** Maps to a legend-dot CSS modifier class. */
  state: QuizDotState;
  label: React.ReactNode;
}

/** Section for grouped tests (chapters, topics). */
export interface QuizSection {
  /** Left-column label (e.g. `<><strong>Формулы</strong>8/8</>`). */
  label: React.ReactNode;
  states: QuizDotState[];
  /**
   * Override the first question number for this section.
   * Defaults to cumulative count from previous sections.
   */
  start?: number;
}

export interface QuizMapProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** One entry per question; value is the dot state. Ignored when `sections` is set. */
  states?: QuizDotState[];
  shape?: QuizShape;
  size?: QuizSize;
  /** Header label (left). */
  label?: React.ReactNode;
  /** Header value text (right). Pass `null` to suppress. */
  valueLabel?: React.ReactNode;
  /** Hide question numbers inside each dot (dense / small sizes). */
  hideNumbers?: boolean;
  /** First question number for the flat dots list. Default: 1. */
  start?: number;
  /** Legend row below the dots. */
  legend?: QuizLegendItem[];
  /** Grouped layout — replaces flat dots with sectioned rows. */
  sections?: QuizSection[];
  /**
   * Lay out dots in an N-column CSS grid.
   * Useful for long tests (e.g. 10 columns for 60 questions).
   */
  dotsColumns?: number;
  /**
   * When `dotsColumns` is set: use `1fr` columns (fills full width)
   * instead of `auto` (natural dot size). Required for pill-as-bar layout.
   */
  dotsColumnsFill?: boolean;
  /** Dot click callback; receives 1-based question number. */
  onDotClick?: (questionNumber: number) => void;
}

export interface QuizSummaryProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Number of correct answers. */
  score: number;
  /** Total questions. */
  total: number;
  /** Custom label. Default: `из {total} правильно · {pct}%`. */
  label?: React.ReactNode;
  /** `'warn'` → yellow badge, `'fail'` → red badge; omit for green. */
  variant?: 'warn' | 'fail';
}

/* ── helpers ──────────────────────────────────────────────────────── */

function dotCls(state: QuizDotState): string {
  switch (state) {
    case 'answered':         return 'is-answered';
    case 'current':          return 'is-current';
    case 'flagged':          return 'is-flagged';
    case 'answered-flagged': return 'is-answered is-flagged';
    case 'correct':          return 'is-correct';
    case 'incorrect':        return 'is-incorrect';
    case 'partial':          return 'is-partial';
    case 'unanswered':       return 'is-unanswered';
    case 'skipped':          return 'is-skipped';
    default:                 return '';
  }
}

function legendDotCls(state: QuizDotState): string {
  switch (state) {
    case 'answered':
    case 'current':          return 'is-answered'; // same accent colour
    case 'flagged':
    case 'answered-flagged': return 'is-flagged';
    case 'correct':          return 'is-correct';
    case 'incorrect':        return 'is-incorrect';
    case 'partial':          return 'is-partial';
    default:                 return '';
  }
}

/* ── QuizDots (internal) ──────────────────────────────────────────── */

interface QuizDotsProps {
  states: QuizDotState[];
  start: number;
  hideNumbers: boolean;
  dotsColumns?: number;
  dotsColumnsFill?: boolean;
  interactive: boolean;
  onDotClick?: (n: number) => void;
}

function QuizDots({
  states, start, hideNumbers,
  dotsColumns, dotsColumnsFill,
  interactive, onDotClick,
}: QuizDotsProps): React.ReactElement {
  return (
    <div
      className={cn(
        'ou-quiz__dots',
        !!dotsColumns && 'ou-quiz__dots--grid',
        !!dotsColumns && dotsColumnsFill && 'ou-quiz__dots--fill',
        !!dotsColumns && `ou-quiz__dots--cols-${dotsColumns}`,
      )}
    >
      {states.map((state, i) => {
        const num = start + i;
        const cls = cn('ou-quiz__dot', dotCls(state));
        const aria = `Вопрос ${num}`;
        const content = hideNumbers ? undefined : num;
        return interactive
          ? (
            <button
              key={num} type="button"
              className={cls} aria-label={aria}
              onClick={() => onDotClick?.(num)}
            >{content}</button>
          )
          : (
            <span key={num} className={cls} aria-label={aria}>{content}</span>
          );
      })}
    </div>
  );
}

/* ── QuizMap ──────────────────────────────────────────────────────── */

export const QuizMap = forwardRef<HTMLDivElement, QuizMapProps>(
  ({
    states = [],
    shape = 'circle', size = 'm',
    label, valueLabel,
    hideNumbers = false, start = 1,
    legend, sections,
    dotsColumns, dotsColumnsFill,
    onDotClick,
    className, ...rest
  }, ref) => {
    const interactive = !!onDotClick;

    return (
      <div
        ref={ref}
        className={cn('ou-quiz', `ou-quiz--${shape}`, `ou-quiz--${size}`, className)}
        {...rest}
      >
        {(label || valueLabel != null) && (
          <div className="ou-quiz__head">
            {label && <span className="ou-quiz__lbl">{label}</span>}
            {valueLabel != null && <span className="ou-quiz__val">{valueLabel}</span>}
          </div>
        )}

        {sections ? (
          <div className="ou-quiz__sections">
            {sections.map((sec, si) => {
              const prevCount = sections.slice(0, si).reduce((s, x) => s + x.states.length, 0);
              const secStart  = sec.start ?? (start + prevCount);
              return (
                <div key={si} className="ou-quiz__section">
                  <span className="ou-quiz__section-lbl">{sec.label}</span>
                  <QuizDots
                    states={sec.states} start={secStart}
                    hideNumbers={hideNumbers}
                    dotsColumns={dotsColumns} dotsColumnsFill={dotsColumnsFill}
                    interactive={interactive} onDotClick={onDotClick}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <QuizDots
            states={states} start={start}
            hideNumbers={hideNumbers}
            dotsColumns={dotsColumns} dotsColumnsFill={dotsColumnsFill}
            interactive={interactive} onDotClick={onDotClick}
          />
        )}

        {legend && (
          <div className="ou-quiz__legend">
            {legend.map((it, i) => (
              <span key={i} className="ou-quiz__legend-item">
                <span className={cn('ou-quiz__legend-dot', legendDotCls(it.state))} />
                {it.label}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  },
);
QuizMap.displayName = 'QuizMap';

/* ── QuizSummary ──────────────────────────────────────────────────── */

export const QuizSummary = forwardRef<HTMLSpanElement, QuizSummaryProps>(
  ({ score, total, label, variant, className, ...rest }, ref) => {
    const pct = Math.round((score / total) * 100);
    return (
      <span
        ref={ref}
        className={cn(
          'ou-quiz-summary',
          variant === 'warn' && 'ou-quiz-summary--warn',
          variant === 'fail' && 'ou-quiz-summary--fail',
          className,
        )}
        {...rest}
      >
        <span className="ou-quiz-summary__badge">{score}</span>
        <span className="ou-quiz-summary__lbl">
          {label ?? <>из {total} правильно <span>· {pct}%</span></>}
        </span>
      </span>
    );
  },
);
QuizSummary.displayName = 'QuizSummary';
