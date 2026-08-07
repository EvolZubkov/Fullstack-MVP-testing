/**
 * @module features/tests/editor/sections/tone-chips
 * @description PRD-45. The level's tone as a row of DS SegmentedControl items with
 * a colour dot each. It replaces a `Select` that wrapped «По направлению шкалы»
 * onto three lines inside a 120px table column; a segmented row cannot wrap.
 *
 * A separate module rather than a chunk of the levels editor, so `OutcomesEditor`
 * — which still shows the same closed list as a Select — can adopt it later
 * without moving markup around (see PRD-45 §7).
 */

import { SegmentedControl } from "@universityrt/ui-kit";

import type { LevelTone } from "@shared/scales/interpretation";

/**
 * SegmentedControl keys items by a non-empty string, but the «derive it» tone IS
 * the empty string in the model. The sentinel lives only inside this component.
 */
const AUTO = "auto";

/**
 * The same closed list as `TONE_OPTIONS`, plus a colour token per state. Only the
 * empty tone is reworded: «По направлению шкалы» eats half the row, so the full
 * wording moves to the field description (PRD-45 FR-06).
 */
export const TONE_CHIPS: Array<{ value: LevelTone | ""; label: string; colour: string }> = [
  { value: "", label: "Авто", colour: "var(--ou-fg-muted)" },
  { value: "favorable", label: "Благоприятный", colour: "var(--ou-success-default)" },
  { value: "neutral", label: "Нейтральный", colour: "var(--ou-neutral-400)" },
  { value: "attention", label: "Внимание", colour: "var(--ou-warning-default)" },
  { value: "critical", label: "Критический", colour: "var(--ou-error-default)" },
];

export type ToneChipsProps = {
  value: LevelTone | "";
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: LevelTone | "") => void;
  testId?: string;
};

export function ToneChips({ value, ariaLabel, disabled = false, onChange, testId }: ToneChipsProps) {
  return (
    <SegmentedControl<string>
      size="s"
      value={value === "" ? AUTO : value}
      aria-label={ariaLabel}
      data-testid={testId}
      items={TONE_CHIPS.map((c) => ({
        value: c.value === "" ? AUTO : c.value,
        label: c.label,
        disabled,
        icon: <span className="tb-tone-dot" style={{ background: c.colour }} aria-hidden="true" />,
      }))}
      onChange={(v) => onChange(v === AUTO ? "" : (v as LevelTone))}
    />
  );
}
