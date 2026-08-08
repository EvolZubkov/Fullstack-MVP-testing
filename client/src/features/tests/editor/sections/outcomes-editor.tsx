/**
 * @module features/tests/editor/sections/outcomes-editor
 * @description PRD-29: the outcome-list editor — the string/boolean twin of the
 * numeric {@link LevelsEditor} (`levels-editor`). A numeric interpretation attaches
 * its meaning to an INTERVAL; a string or boolean one has no intervals at all, so
 * the formula returns a CODE and the author enumerates the codes it can return.
 *
 * The two editors no longer share a shape: PRD-45 moved the numeric twin off the
 * `tb-bands-table` onto level cards, because interval boundaries are cut points and
 * a table of min/max pairs let silent gaps through. A code list has no boundaries
 * to cut, so this editor keeps its table. What the two still share is the closed
 * list of tones and the recommendations modal — the SHARED
 * {@link FeedbackEditorModal}.
 *
 * The tone options and the feedback helpers are exported because `LevelsEditor`
 * consumes them too: one closed list of methodological states for both editors.
 */

import { Fragment, useState } from "react";
import { Button, Cluster, IconButton, Input, Select, Stack, Textarea } from "@universityrt/ui-kit";
import { Plus, Trash2 } from "lucide-react";

import type { LevelTone } from "@shared/scales/interpretation";
import type { OutcomeModel } from "../test-editor.types";
import { hasFeedbackContent } from "../scales-api";
import { FeedbackEditorModal, type FeedbackEditorValue } from "./feedback-editor-modal";

/**
 * PRD-29: the author's optional override of the level's tone. A closed list of
 * METHODOLOGICAL states, NOT colours — how each state looks is the template's
 * call. Empty means «derive it» (from the scale's valence and the level's position).
 */
export const TONE_OPTIONS: Array<{ value: LevelTone | ""; label: string }> = [
  { value: "", label: "По направлению шкалы" },
  { value: "favorable", label: "Благоприятный" },
  { value: "neutral", label: "Нейтральный" },
  { value: "attention", label: "Внимание" },
  { value: "critical", label: "Критический" },
];

/** A blank feedback value for a level that has no recommendations yet. */
export function emptyFeedbackValue(): FeedbackEditorValue {
  return { format: "plain", text: "", links: [], assets: [], events: [] };
}

let localKeyCounter = 0;

function emptyOutcome(code = "", label = ""): OutcomeModel {
  localKeyCounter += 1;
  return { clientKey: `outcome-${localKeyCounter}`, code, label, text: "", tone: "" };
}

export type OutcomesEditorProps = {
  outcomes: OutcomeModel[];
  /** Index of the owning card — only used to build stable test ids. */
  index: number;
  readOnly: boolean;
  onChange: (outcomes: OutcomeModel[]) => void;
  /**
   * Codes the formula can return (Task 15). Those missing from the list are
   * offered as one-click additions; the block is hidden when nothing is missing.
   */
  suggestedCodes?: string[];
};

/** @public */
export function OutcomesEditor({
  outcomes,
  index,
  readOnly,
  onChange,
  suggestedCodes = [],
}: OutcomesEditorProps) {
  // Which row's recommendations modal is open. Index, not the row itself, so the
  // modal keeps pointing at the same row while the author edits other cells.
  const [feedbackFor, setFeedbackFor] = useState<number | null>(null);

  const update = (j: number, patch: Partial<OutcomeModel>) =>
    onChange(outcomes.map((o, i) => (i === j ? { ...o, ...patch } : o)));
  const remove = (j: number) => onChange(outcomes.filter((_, i) => i !== j));
  const add = () => onChange([...outcomes, emptyOutcome()]);

  const known = new Set(outcomes.map((o) => o.code.trim()).filter((c) => c !== ""));
  const missing = suggestedCodes.filter((c) => c !== "" && !known.has(c));

  const open = feedbackFor !== null ? outcomes[feedbackFor] : undefined;

  return (
    <>
      <table className="tb-table tb-table--mb tb-bands-table" data-testid={`metrics-outcomes-${index}`}>
        <colgroup>
          <col />
          <col />
          <col />
          <col className="tb-bands-table__act" />
        </colgroup>
        <thead>
          <tr>
            <th>Код</th>
            <th>Метка</th>
            <th>Оценка</th>
            <th><span className="sr-only">Действия</span></th>
          </tr>
        </thead>
        <tbody>
          {outcomes.length === 0 ? (
            <tr>
              <td colSpan={4}><span className="tb-card-desc">Исходы не заданы</span></td>
            </tr>
          ) : (
            outcomes.map((o, j) => {
              const k = o.clientKey ?? `outcome-${j}`;
              return (
                <Fragment key={k}>
                  <tr>
                    <td>
                      <Input
                        size="s"
                        value={o.code}
                        disabled={readOnly}
                        placeholder="напр. burnout"
                        aria-label={`код исхода ${j + 1}`}
                        onChange={(e) => update(j, { code: e.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        size="s"
                        value={o.label}
                        disabled={readOnly}
                        placeholder="Что увидит обучающийся"
                        aria-label={`метка исхода ${j + 1}`}
                        onChange={(e) => update(j, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <Select<LevelTone | "">
                        size="s"
                        value={o.tone}
                        disabled={readOnly}
                        options={TONE_OPTIONS}
                        aria-label={`оценка исхода ${j + 1}`}
                        onChange={(value) => update(j, { tone: value })}
                      />
                    </td>
                    <td>
                      {!readOnly && (
                        <IconButton
                          icon={<Trash2 width={14} height={14} aria-hidden="true" />}
                          aria-label={`Удалить исход ${j + 1}`}
                          variant="ghost"
                          size="s"
                          onClick={() => remove(j)}
                        />
                      )}
                    </td>
                  </tr>
                  <tr className="tb-bands-table__detail">
                    <td colSpan={4}>
                      <Stack gap={2} align="start">
                        <Textarea
                          size="s"
                          fullWidth
                          rows={2}
                          value={o.text}
                          disabled={readOnly}
                          placeholder="Что означает этот исход — текст для обучающегося"
                          aria-label={`толкование исхода ${j + 1}`}
                          onChange={(e) => update(j, { text: e.target.value })}
                        />
                        {!readOnly && (
                          <Button size="s" variant="ghost" onClick={() => setFeedbackFor(j)}>
                            {hasFeedbackContent(o.feedback) ? "Рекомендации заданы" : "Рекомендации"}
                          </Button>
                        )}
                      </Stack>
                    </td>
                  </tr>
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>

      {missing.length > 0 && !readOnly && (
        <div className="ou-formfield" data-testid={`metrics-outcomes-suggest-${index}`}>
          <p className="tb-card-desc">
            В формуле встречаются коды, которых нет в перечне. Нажмите, чтобы добавить.
          </p>
          <Cluster gap={2} wrap>
            {missing.map((code) => (
              <Button
                key={code}
                size="s"
                variant="secondary"
                leadingIcon={<Plus size={12} aria-hidden="true" />}
                onClick={() => onChange([...outcomes, emptyOutcome(code, code)])}
              >
                {code}
              </Button>
            ))}
          </Cluster>
        </div>
      )}

      {!readOnly && (
        <Button
          variant="ghost"
          size="s"
          leadingIcon={<Plus size={16} aria-hidden="true" />}
          onClick={add}
          data-testid={`metrics-outcome-add-${index}`}
        >
          Добавить исход
        </Button>
      )}

      {open && feedbackFor !== null && (
        <FeedbackEditorModal
          open
          title={`Рекомендации для исхода «${open.label.trim() || open.code.trim() || `исход ${feedbackFor + 1}`}»`}
          description="Текст и подборка материалов, которые увидит обучающийся с этим исходом"
          value={open.feedback ?? emptyFeedbackValue()}
          onCancel={() => setFeedbackFor(null)}
          onSave={(value) => {
            update(feedbackFor, { feedback: value });
            setFeedbackFor(null);
          }}
          testId={`metrics-outcome-feedback-${index}`}
        />
      )}
    </>
  );
}
