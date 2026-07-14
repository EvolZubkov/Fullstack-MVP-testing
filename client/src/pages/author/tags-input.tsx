/**
 * @module client/pages/author/tags-input
 *
 * Chip/token input for a question's sub-topic tags (PRD-11 §3a). A thin wrapper
 * over the design-system {@link TagInput}: it injects the domain rules — tags are
 * free-form (spaces allowed), normalized (trim + collapse spaces, capped at
 * {@link TAG_MAX_LENGTH}) and deduped case-insensitively via shared/tags.ts,
 * matching the server-side rules. Existing tags across the question bank are
 * offered as autocomplete suggestions; a non-matching input can be created as a
 * new tag. By these tags the author later sets per-topic draw quotas.
 */
import { TagInput } from "@universityrt/ui-kit";
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
  return (
    <TagInput
      value={value}
      onChange={onChange}
      suggestions={suggestions}
      label={t.questions.tagsLabel}
      hint={t.questions.tagsHint}
      placeholder={t.questions.tagsPlaceholder}
      maxLength={TAG_MAX_LENGTH}
      normalize={normalizeTag}
      dedupeKey={tagKey}
      existingLabel={t.questions.tagsExisting}
      createLabel={(value) => `${t.questions.tagsCreate} «${value}»`}
      removeLabel={(tag) => `${t.questions.tagsRemove} ${tag}`}
      inputTestId="input-question-tag"
    />
  );
}
