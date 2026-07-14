import React, { useId, useMemo, useRef, useState } from 'react';
import { cn } from '../utils';
import { Tag } from './Tag';

/**
 * @module components/TagInput
 * @description A chip/token input: type to add a tag, Backspace to remove the
 * last, with an autocomplete menu over `suggestions` and a "create new" option.
 * Domain rules (normalization, dedup key, max length) are injected via props so
 * the host keeps a single source of truth; chips render as design-system `Tag`s.
 */

export interface TagInputProps {
  /** Current tags (storage form). */
  value: string[];
  /** Emit the next tag list. */
  onChange: (tags: string[]) => void;
  /** Distinct tags used elsewhere, offered as suggestions. */
  suggestions?: string[];
  label?: React.ReactNode;
  hint?: React.ReactNode;
  placeholder?: string;
  maxLength?: number;
  /** Normalize raw input into a storage tag (default: trim). */
  normalize?: (raw: string) => string;
  /** Comparison key for dedup/match (default: trimmed lower-case). */
  dedupeKey?: (tag: string) => string;
  /** Heading above existing-tag suggestions. */
  existingLabel?: React.ReactNode;
  /** Renders the "create new tag" option label for the typed value. */
  createLabel?: (value: string) => React.ReactNode;
  /** Accessible label for a chip's remove button. */
  removeLabel?: (tag: string) => string;
  id?: string;
  inputTestId?: string;
  className?: string;
}

const XIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
       strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);
const TagIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
  </svg>
);
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
);

export function TagInput({
  value, onChange, suggestions = [], label, hint, placeholder, maxLength,
  normalize = (r) => r.trim(),
  dedupeKey = (t) => t.trim().toLowerCase(),
  existingLabel, createLabel, removeLabel, id, inputTestId, className,
}: TagInputProps) {
  const autoId = useId();
  const fieldId = id || `ou-taginput-${autoId}`;
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const has = (raw: string) => {
    const key = dedupeKey(raw);
    return value.some((v) => dedupeKey(v) === key);
  };

  const addTag = (raw: string) => {
    const tag = normalize(raw);
    if (!tag || has(tag)) { setInput(''); return; }
    onChange([...value, maxLength ? tag.slice(0, maxLength) : tag]);
    setInput('');
  };

  const removeTag = (index: number) => onChange(value.filter((_, i) => i !== index));

  const matches = useMemo(() => {
    const q = dedupeKey(input);
    const seen = new Set(value.map(dedupeKey));
    const out: string[] = [];
    for (const s of suggestions) {
      const key = dedupeKey(s);
      if (seen.has(key)) continue;
      if (q && !key.includes(q)) continue;
      if (out.some((o) => dedupeKey(o) === key)) continue;
      out.push(s);
      if (out.length >= 8) break;
    }
    return out;
  }, [input, suggestions, value, dedupeKey]);

  const normalizedInput = normalize(input);
  const canCreate =
    !!normalizedInput &&
    !has(normalizedInput) &&
    !matches.some((m) => dedupeKey(m) === dedupeKey(normalizedInput));
  const showMenu = input.length > 0 && (matches.length > 0 || canCreate);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      removeTag(value.length - 1);
    }
  };

  const focus = () => inputRef.current?.focus();

  return (
    <div className={cn('ou-taginput', className)}>
      {label && (
        <label htmlFor={fieldId} className="ou-field__lbl" onClick={focus}>{label}</label>
      )}
      <div className="ou-taginput__wrap">
        <div className="ou-taginput__field" onClick={focus}>
          {value.map((tag, index) => (
            <Tag key={`${dedupeKey(tag)}-${index}`}>
              {tag}
              <button
                type="button"
                className="ou-taginput__remove"
                aria-label={removeLabel?.(tag)}
                onClick={(e) => { e.stopPropagation(); removeTag(index); }}
              ><XIcon /></button>
            </Tag>
          ))}
          <input
            ref={inputRef}
            id={fieldId}
            className="ou-taginput__input"
            value={input}
            maxLength={maxLength}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? placeholder : ''}
            aria-label={typeof label === 'string' ? label : undefined}
            data-testid={inputTestId}
          />
        </div>

        {showMenu && (
          <div className="ou-taginput__menu" role="listbox">
            {matches.length > 0 && existingLabel && (
              <div className="ou-taginput__menu-label">{existingLabel}</div>
            )}
            {matches.map((s) => (
              <button
                key={dedupeKey(s)}
                type="button"
                className="ou-taginput__opt"
                onClick={() => { addTag(s); focus(); }}
              ><TagIcon />{s}</button>
            ))}
            {canCreate && (
              <>
                {matches.length > 0 && <div className="ou-taginput__divider" />}
                <button
                  type="button"
                  className="ou-taginput__opt"
                  onClick={() => { addTag(input); focus(); }}
                ><PlusIcon />{createLabel ? createLabel(normalizedInput) : normalizedInput}</button>
              </>
            )}
          </div>
        )}
      </div>
      {hint && <div className="ou-field__msg ou-field__msg--default">{hint}</div>}
    </div>
  );
}
TagInput.displayName = 'TagInput';
