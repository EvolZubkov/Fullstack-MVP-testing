/**
 * @module client/pages/author/tags-input
 *
 * Chip/token input for a question's sub-topic tags (PRD-11 §3a). Tags are
 * free-form labels — spaces allowed; on add they are normalized (trim + collapse
 * spaces, capped at {@link TAG_MAX_LENGTH}) and deduped case-insensitively
 * (shared/tags.ts), matching the server-side rules. Existing tags across the
 * question bank are offered as autocomplete suggestions; a non-matching input
 * can be created as a new tag. By these tags the author later sets per-topic
 * draw quotas (the quota Select reads the real tags set here).
 */
import { useMemo, useState, useRef } from "react";
import { X, Plus, Tag as TagIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { normalizeTag, tagKey, TAG_MAX_LENGTH } from "@shared/tags";

interface TagsInputProps {
  /** Current tags (storage form). */
  value: string[];
  /** Emit the next tag list. */
  onChange: (tags: string[]) => void;
  /** Distinct tags used elsewhere in the bank, offered as suggestions. */
  suggestions?: string[];
}

export function TagsInput({ value, onChange, suggestions = [] }: TagsInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const has = (raw: string) => {
    const key = tagKey(raw);
    return value.some((v) => tagKey(v) === key);
  };

  const addTag = (raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag || has(tag)) {
      setInput("");
      return;
    }
    onChange([...value, tag.slice(0, TAG_MAX_LENGTH)]);
    setInput("");
  };

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  // Suggestions: distinct bank tags matching the input and not already added.
  const matches = useMemo(() => {
    const q = tagKey(input);
    const seen = new Set(value.map(tagKey));
    const out: string[] = [];
    for (const s of suggestions) {
      const key = tagKey(s);
      if (seen.has(key)) continue;
      if (q && !key.includes(q)) continue;
      if (out.some((o) => tagKey(o) === key)) continue;
      out.push(s);
      if (out.length >= 8) break;
    }
    return out;
  }, [input, suggestions, value]);

  const normalizedInput = normalizeTag(input);
  // Offer "create" only when the typed value is new (not an exact existing match).
  const canCreate =
    !!normalizedInput &&
    !has(normalizedInput) &&
    !matches.some((m) => tagKey(m) === tagKey(normalizedInput));
  const showMenu = input.length > 0 && (matches.length > 0 || canCreate);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && input === "" && value.length > 0) {
      removeTag(value.length - 1);
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" onClick={() => inputRef.current?.focus()}>
        {t.questions.tagsLabel}
      </label>
      <div className="relative">
        <div
          className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
          onClick={() => inputRef.current?.focus()}
        >
          {value.map((tag, index) => (
            <Badge key={`${tagKey(tag)}-${index}`} variant="secondary" className="gap-1 pr-1 font-normal">
              {tag}
              <button
                type="button"
                aria-label={`${t.questions.tagsRemove} ${tag}`}
                className="rounded-sm opacity-60 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(index);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <input
            ref={inputRef}
            value={input}
            maxLength={TAG_MAX_LENGTH}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? t.questions.tagsPlaceholder : ""}
            aria-label={t.questions.tagsLabel}
            className="flex-1 min-w-[8rem] border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground"
            data-testid="input-question-tag"
          />
        </div>

        {showMenu && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
            {matches.length > 0 && (
              <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {t.questions.tagsExisting}
              </div>
            )}
            {matches.map((s) => (
              <button
                key={tagKey(s)}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  addTag(s);
                  inputRef.current?.focus();
                }}
              >
                <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
                {s}
              </button>
            ))}
            {canCreate && (
              <>
                {matches.length > 0 && <div className="my-1 h-px bg-border" />}
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    addTag(input);
                    inputRef.current?.focus();
                  }}
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  {t.questions.tagsCreate} «{normalizedInput}»
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t.questions.tagsHint}</p>
    </div>
  );
}
