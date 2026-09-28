/**
 * @module features/users/org-field-control
 * @description Profile field for an org-structure value — organisation, unit
 * or position (org-structure plan, decision Р-3).
 *
 * The value is chosen from those already in use, or created — there is no free
 * text. A typo («Отдел продаж» / «Отдел продаж » / «Отдел продж») would silently
 * split one department into two slices of the analytics, and nobody would see
 * why. The same rule and the same control shape as the sequence field of PRD-22
 * (`SequenceSettingControl`), which dropped free text for the same reason.
 *
 * Each option says how often the value occurs in profiles and in passages: a
 * value known only from passages is the spelling an LMS export brought in, and
 * picking it keeps the profile and the export in one slice.
 */
import { useMemo, useState } from "react";
import { Combobox } from "@skillum/ui-kit";
import { pluralize } from "@/lib/i18n";
import { normalizeOrgValue, orgValueKey, type OrgValueCount } from "@shared/org-fields";

/** «14 пользователей · 212 прохождений» — only the non-zero parts. */
function usageOf(entry: OrgValueCount): string {
  const parts: string[] = [];
  if (entry.users > 0) {
    parts.push(`${entry.users} ${pluralize(entry.users, "пользователь", "пользователя", "пользователей")}`);
  }
  if (entry.attempts > 0) {
    parts.push(`${entry.attempts} ${pluralize(entry.attempts, "прохождение", "прохождения", "прохождений")}`);
  }
  return parts.join(" · ");
}

export interface OrgFieldControlProps {
  label: string;
  /** Current value; `""` when not set. */
  value: string;
  /** Values in use for this field (`GET /api/users/org-values`). */
  options: readonly OrgValueCount[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

export function OrgFieldControl(props: OrgFieldControlProps) {
  const { label, value, options, onChange, placeholder = "Не указано", disabled } = props;
  const [query, setQuery] = useState("");

  const comboOptions = useMemo(() => {
    const currentKey = orgValueKey(value);
    const list = options.map((entry) => {
      // The dictionary shows one spelling per value; a profile may store another
      // («ОТДЕЛ ПРОДАЖ» folded into «Отдел продаж»). That option then carries the
      // STORED spelling: otherwise nothing matches the value exactly and the
      // field reads «Не указано» for a person who has a unit.
      const spelling = currentKey !== null && orgValueKey(entry.value) === currentKey ? value : entry.value;
      return { value: spelling, label: spelling, meta: usageOf(entry) || undefined };
    });
    // The current value stays choosable even when no one else has it (or the
    // dictionary has not loaded yet) — otherwise the field would show it empty.
    if (value && !list.some((o) => o.value === value)) {
      list.unshift({ value, label: value, meta: undefined });
    }
    return list;
  }, [options, value]);

  const typed = normalizeOrgValue(query);
  // No creation for a value that exists in another spelling: that is exactly
  // the split this control is here to prevent.
  const canCreate = typed !== null && !comboOptions.some((o) => orgValueKey(o.value) === orgValueKey(typed));

  return (
    <Combobox<string>
      label={label}
      value={value || null}
      options={comboOptions}
      query={query}
      onQueryChange={setQuery}
      onChange={(next) => onChange(next ?? "")}
      placeholder={placeholder}
      disabled={disabled}
      fullWidth
      emptyMessage="Пока нет значений"
      footerAction={
        canCreate ? (
          <button
            type="button"
            className="ou-combo__footer-action"
            onClick={() => {
              onChange(typed);
              setQuery("");
            }}
          >
            + Создать «{typed}»
          </button>
        ) : undefined
      }
      data-testid={props["data-testid"]}
    />
  );
}
