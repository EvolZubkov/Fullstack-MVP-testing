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
 * The same closed list as `TONE_OPTIONS`, plus the colours each state is drawn in.
 * Only the empty tone is reworded: «По направлению шкалы» eats half the row, so the
 * full wording moves to the field description (PRD-45 FR-06).
 *
 * Two colour roles, not one. `colour` is a solid accent seen against the surface —
 * a dot, a card's left rule — where only the hue matters. A ribbon stripe instead
 * carries TEXT on that hue, so it needs a background/foreground PAIR that the
 * caption survives. The two cannot be the same value: every pair below was measured
 * in a browser against the real `university-rt.css`, in both themes, and each clears
 * WCAG AA 4.5:1 (the caption is `--ou-text-body-xs`, i.e. small text):
 *
 * | tone       | ratio light | ratio dark |
 * |------------|-------------|------------|
 * | ""         | 14.00       | 13.09      |
 * | favorable  | 7.11        | 7.11       |
 * | neutral    | 8.76        | 8.76       |
 * | attention  | 9.59        | 9.59       |
 * | critical   | 5.38        | 5.38       |
 *
 * Three obvious-looking pairs were rejected by measurement, not taste: white on
 * `--ou-success-default` is 2.16:1, white on `--ou-warning-default` is 1.76:1, and
 * white on `--ou-error-default` is 3.78:1 — all illegible, all in BOTH themes.
 */
export const TONE_CHIPS: Array<{
  value: LevelTone | "";
  label: string;
  /** Solid colour for the chip dot and the card's left rule. */
  colour: string;
  /** Ribbon stripe: a background the stripe caption can actually be read on. */
  ribbonBg: string;
  ribbonFg: string;
}> = [
  // «Авто» has no colour of its own, so its stripe is a surface rather than a fill.
  { value: "", label: "Авто", colour: "var(--ou-fg-muted)", ribbonBg: "var(--ou-bg-muted)", ribbonFg: "var(--ou-fg-default)" },
  { value: "favorable", label: "Благоприятный", colour: "var(--ou-success-default)", ribbonBg: "var(--ou-success-default)", ribbonFg: "var(--ou-neutral-900)" },
  // `--ou-neutral-400` is the dot's shade; as a stripe it reaches only 3.6:1, so the
  // stripe steps down the same ramp to -600.
  { value: "neutral", label: "Нейтральный", colour: "var(--ou-neutral-400)", ribbonBg: "var(--ou-neutral-600)", ribbonFg: "var(--ou-neutral-0)" },
  // `--ou-warning-on` is the DS's own answer to «what text goes on warning».
  { value: "attention", label: "Внимание", colour: "var(--ou-warning-default)", ribbonBg: "var(--ou-warning-default)", ribbonFg: "var(--ou-warning-on)" },
  // Neither white nor dark text clears 4.5:1 on `--ou-error-default`; -600 does.
  { value: "critical", label: "Критический", colour: "var(--ou-error-default)", ribbonBg: "var(--ou-error-600)", ribbonFg: "var(--ou-neutral-0)" },
];

/**
 * The tone's solid accent — the chip dot and the level card's left rule. Lives here
 * next to the list so a tone's colour has ONE address; the ribbon's pair is read
 * straight off {@link TONE_CHIPS}.
 *
 * @public
 */
export function toneColour(tone: string): string {
  return TONE_CHIPS.find((c) => c.value === tone)?.colour ?? "var(--ou-fg-muted)";
}

/** The ribbon stripe's background/foreground pair for a tone. @public */
export function toneRibbon(tone: string): { bg: string; fg: string } {
  const chip = TONE_CHIPS.find((c) => c.value === tone) ?? TONE_CHIPS[0];
  return { bg: chip.ribbonBg, fg: chip.ribbonFg };
}

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
