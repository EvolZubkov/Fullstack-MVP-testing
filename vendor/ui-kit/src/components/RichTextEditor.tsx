import React, { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import { cn, type Size } from '../utils';

/**
 * Entry modes a content field may offer. The consumer decides which of them are
 * available — typically the declared field type acts as a ceiling.
 */
export type RichTextMode = 'plain' | 'rich' | 'html';

export interface RichTextEditorProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  size?: Size;
  fullWidth?: boolean;
  disabled?: boolean;
  /** HTML value. In `plain` mode the value is treated as text. */
  value: string;
  onChange: (value: string) => void;
  /** Modes offered to the author, in display order. One mode hides the switch. */
  modes?: RichTextMode[];
  mode?: RichTextMode;
  onModeChange?: (mode: RichTextMode) => void;
  /**
   * Sanitiser applied to pasted fragments and to the value when leaving `html`
   * mode. Text pasted from Word or a web page carries markup the product may not
   * accept; without normalising it here the author would be told at save time
   * about something they never typed and cannot see.
   */
  sanitize?: (html: string) => string;
  rows?: number;
  id?: string;
  className?: string;
  'data-testid'?: string;
}

const MODE_LABEL: Record<RichTextMode, string> = {
  plain: 'Простой текст',
  rich: 'Форматированный',
  html: 'HTML',
};

/** Strips tags for plain mode; keeps the text content only. */
function toPlainText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent ?? '';
}

/** Escapes plain text back into markup when the author raises the mode. */
function fromPlainText(text: string): string {
  const el = document.createElement('div');
  el.textContent = text;
  return el.innerHTML;
}

interface ToolButton {
  command: string;
  label: string;
  icon: React.ReactNode;
  value?: string;
}

const BOLD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M6 4h8a4 4 0 0 1 0 8H6z" /><path d="M6 12h9a4 4 0 0 1 0 8H6z" />
  </svg>
);
const ITALIC = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" />
  </svg>
);
const STRIKE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><line x1="4" y1="12" x2="20" y2="12" />
  </svg>
);
const LIST_UL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" />
  </svg>
);
const LIST_OL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" />
    <path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 15H4v-1l2-1v-1H4" />
  </svg>
);
const LINK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const CLEAR = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 7V4h16v3" /><path d="M9 20h6" /><line x1="12" y1="4" x2="9" y2="20" /><line x1="4" y1="4" x2="20" y2="20" />
  </svg>
);

const TOOLS: ToolButton[][] = [
  [
    { command: 'bold', label: 'Полужирный', icon: BOLD },
    { command: 'italic', label: 'Курсив', icon: ITALIC },
    { command: 'strikeThrough', label: 'Зачёркнутый', icon: STRIKE },
  ],
  [
    { command: 'insertUnorderedList', label: 'Маркированный список', icon: LIST_UL },
    { command: 'insertOrderedList', label: 'Нумерованный список', icon: LIST_OL },
    { command: 'createLink', label: 'Ссылка', icon: LINK },
  ],
  [{ command: 'removeFormat', label: 'Очистить форматирование', icon: CLEAR }],
];

/**
 * Text field with three entry modes: plain text, formatted text (a fixed toolbar
 * over a contenteditable area) and raw HTML.
 *
 * The formatted mode shows the RESULT, not the markup — the author works with
 * buttons and never sees tags. Pasted fragments are normalised through
 * `sanitize`, so markup the product rejects is removed at the moment it arrives
 * rather than surfacing as a save error the author cannot act on.
 */
export const RichTextEditor = forwardRef<HTMLDivElement, RichTextEditorProps>(
  (
    {
      label, hint, error, required, size = 'm', fullWidth, disabled,
      value, onChange, modes = ['plain', 'rich', 'html'], mode, onModeChange,
      sanitize, rows = 4, id, className, ...rest
    },
    ref,
  ) => {
    const autoId = useId();
    const fieldId = id || `ou-rte-${autoId}`;
    const areaRef = useRef<HTMLDivElement>(null);
    const [internalMode, setInternalMode] = useState<RichTextMode>(mode ?? modes[modes.length - 1] ?? 'plain');
    const current = mode ?? internalMode;
    const [activeMarks, setActiveMarks] = useState<Record<string, boolean>>({});

    const clean = useCallback((html: string) => (sanitize ? sanitize(html) : html), [sanitize]);

    // The contenteditable is uncontrolled by design: rewriting innerHTML on every
    // keystroke would reset the caret. It is synced only when the value changes
    // from the outside (mode switch, external edit).
    useEffect(() => {
      const el = areaRef.current;
      if (!el || current !== 'rich') return;
      if (el.innerHTML !== value) el.innerHTML = value;
    }, [value, current]);

    const switchMode = (next: RichTextMode) => {
      if (next === current) return;
      if (current === 'html') onChange(clean(value));
      if (next === 'plain') onChange(fromPlainText(toPlainText(value)));
      if (mode === undefined) setInternalMode(next);
      onModeChange?.(next);
    };

    const refreshMarks = () => {
      if (typeof document.queryCommandState !== 'function') return;
      const marks: Record<string, boolean> = {};
      for (const group of TOOLS) {
        for (const t of group) {
          try {
            marks[t.command] = document.queryCommandState(t.command);
          } catch {
            marks[t.command] = false;
          }
        }
      }
      setActiveMarks(marks);
    };

    const exec = (tool: ToolButton) => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      if (tool.command === 'createLink') {
        const href = window.prompt('Адрес ссылки', 'https://');
        if (!href) return;
        document.execCommand('createLink', false, href);
      } else {
        document.execCommand(tool.command, false, tool.value);
      }
      onChange(clean(el.innerHTML));
      refreshMarks();
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (!sanitize) return;
      const html = e.clipboardData.getData('text/html');
      if (!html) return;
      e.preventDefault();
      document.execCommand('insertHTML', false, clean(html));
      const el = areaRef.current;
      if (el) onChange(clean(el.innerHTML));
    };

    const showSwitch = modes.length > 1;

    return (
      <div
        ref={ref}
        className={cn('ou-rte', `ou-rte--${size}`, fullWidth && 'ou-rte--full', Boolean(error) && 'ou-rte--error', className)}
        {...rest}
      >
        {label && (
          <label className="ou-rte__lbl" htmlFor={fieldId}>
            {label}
            {required && <span className="ou-rte__lbl-req"> *</span>}
          </label>
        )}

        {(showSwitch || current === 'rich') && (
          <div className="ou-rte__bar">
            {showSwitch && (
              <div className="ou-seg ou-seg--s" role="group" aria-label="Режим ввода">
                {modes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={cn('ou-seg__item', m === current && 'is-active')}
                    onClick={() => switchMode(m)}
                    disabled={disabled}
                    data-testid={`${rest['data-testid'] ?? fieldId}-mode-${m}`}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            )}
            {current === 'rich' && (
              <div className="ou-rte__tools" role="toolbar" aria-label="Форматирование">
                {TOOLS.map((group, gi) => (
                  <React.Fragment key={gi}>
                    {gi > 0 && <span className="ou-rte__tools-sep" aria-hidden="true" />}
                    {group.map((tool) => (
                      <button
                        key={tool.command}
                        type="button"
                        className={cn('ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s', activeMarks[tool.command] && 'is-active')}
                        aria-label={tool.label}
                        aria-pressed={activeMarks[tool.command] ? true : undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => exec(tool)}
                        disabled={disabled}
                      >
                        {tool.icon}
                      </button>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        )}

        {current === 'rich' ? (
          <div className="ou-rte__box">
            <div
              id={fieldId}
              ref={areaRef}
              className="ou-rte__area"
              contentEditable={!disabled}
              role="textbox"
              aria-multiline="true"
              suppressContentEditableWarning
              style={{ minHeight: `${rows * 1.6}em` }}
              onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
              onBlur={(e) => onChange(clean((e.target as HTMLDivElement).innerHTML))}
              onPaste={handlePaste}
              onKeyUp={refreshMarks}
              onMouseUp={refreshMarks}
              data-testid={rest['data-testid'] ? `${rest['data-testid']}-area` : undefined}
            />
          </div>
        ) : (
          <div className="ou-rte__box">
            <textarea
              id={fieldId}
              className={cn('ou-rte__input', current === 'html' && 'ou-rte__input--code')}
              value={current === 'plain' ? toPlainText(value) : value}
              rows={rows}
              disabled={disabled}
              onChange={(e) =>
                onChange(current === 'plain' ? fromPlainText(e.target.value) : e.target.value)
              }
              data-testid={rest['data-testid'] ? `${rest['data-testid']}-input` : undefined}
            />
          </div>
        )}

        {(error || hint) && (
          <span className={cn('ou-rte__msg', Boolean(error) && 'ou-rte__msg--error')}>{error || hint}</span>
        )}
      </div>
    );
  },
);
RichTextEditor.displayName = 'RichTextEditor';
