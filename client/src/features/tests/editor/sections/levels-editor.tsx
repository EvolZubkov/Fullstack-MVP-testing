/**
 * @module features/tests/editor/sections/levels-editor
 * @description PRD-45. The numeric interpretation editor: a coverage ribbon over a
 * list of level cards separated by single threshold fields. Replaces the six-column
 * `tb-bands-table`, whose header — the only carrier of field labels — scrolled away,
 * whose columns clipped their content, and whose min/max pairs allowed silent gaps.
 *
 * Stateless by design: the draft is derived from `bands` on every render and folded
 * back on every edit (see `levels-model`). Shared with the «Показатели» tab's
 * numeric indicator, exactly as its predecessor was — one notion, one editor.
 */

import { useState } from "react";
import {
  Banner,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  IconButton,
  Input,
  Textarea,
} from "@universityrt/ui-kit";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";

import { deriveLevelTone } from "@shared/template/measure-view";
import type { LevelTone, Valence } from "@shared/scales/interpretation";

import { pluralize } from "@/lib/i18n";

import { hasFeedbackContent } from "../scales-api";
import type { ScaleBandModel } from "../test-editor.types";
import { FeedbackEditorModal } from "./feedback-editor-modal";
import { emptyFeedbackValue } from "./outcomes-editor";
import { ToneChips, toneColour, toneRibbon } from "./tone-chips";
import {
  addLevel,
  bandsToDraft,
  coverageSegments,
  draftErrors,
  draftToBands,
  hasStoredGap,
  levelBounds,
  removeLevel,
  type LevelDraft,
  type LevelsDraft,
} from "./levels-model";

export type LevelsEditorProps = {
  bands: ScaleBandModel[];
  /** Index of the owning card — only used to build stable test ids. */
  index: number;
  readOnly: boolean;
  onChange: (bands: ScaleBandModel[]) => void;
  /** Distinguishes the scale card's editor from the indicator card's one. */
  testIdPrefix?: string;
  /** Effective scale domain for the ribbon; null when nothing declares one. */
  domain?: { min: number; max: number } | null;
  /**
   * The owning scale's / indicator's favourable direction. Needed because a level
   * whose tone is «Авто» has no colour of its own — it inherits one from the ramp,
   * and the ramp runs the way the valence points.
   */
  valence: Valence;
};

/**
 * What the author sees as this level's name: their label, else its code, else its
 * ordinal. One helper because the name appears in four places — ribbon stripe, card
 * title, threshold caption, feedback modal — and a level with a code but no label
 * used to read as «high» in the header and «уровень 2» forty pixels below it.
 */
function levelTitle(level: LevelDraft, i: number): string {
  return level.label.trim() || level.level.trim() || `Уровень ${i + 1}`;
}

/** The computed «from … to» caption in a card header — text, never a field. */
function rangeOf(draft: LevelsDraft, i: number): string {
  const { from, to } = levelBounds(draft, i);
  return `${from || "?"} … ${to || "?"}`;
}

/**
 * What the recommendations fold reports without being opened: the author needs to
 * know whether there is a text, attachments, or both, not merely «заданы». Courses,
 * files and events all count as one kind of «материал» — the fold is a summary, and
 * splitting three counters across a badge would say less, not more.
 */
function feedbackBadge(value: LevelDraft["feedback"]): string {
  if (!hasFeedbackContent(value)) return "не заданы";
  const hasText = (value?.text ?? "").trim() !== "";
  const items = (value?.links.length ?? 0) + (value?.assets.length ?? 0) + (value?.events?.length ?? 0);
  const materials = items > 0 ? `${items} ${pluralize(items, "материал", "материала", "материалов")}` : "";
  return [hasText ? "текст" : "", materials].filter(Boolean).join(", ");
}

export function LevelsEditor({
  bands,
  index,
  readOnly,
  onChange,
  testIdPrefix = "scales",
  domain = null,
  valence,
}: LevelsEditorProps) {
  // Which level's recommendations modal is open (level index, not the level).
  const [feedbackFor, setFeedbackFor] = useState<number | null>(null);

  const draft = bandsToDraft(bands);
  const errors = draftErrors(draft);
  const segments = coverageSegments(draft, domain);
  const total = draft.levels.length;

  /**
   * The colour a level is actually drawn in — its explicit tone, else the one the
   * results screen would derive for it. The ribbon is a preview of the split the
   * LEARNER sees, so painting an untouched level grey would preview a screen that
   * does not exist: `deriveLevelTone` is the very function that colours the result.
   */
  const effectiveTone = (level: LevelDraft, i: number): LevelTone | "" =>
    level.tone || deriveLevelTone(valence, i, total);

  const emit = (next: LevelsDraft) => onChange(draftToBands(next));
  const setBound = (patch: Partial<Pick<LevelsDraft, "start" | "end">>) => emit({ ...draft, ...patch });
  const setCut = (i: number, raw: string) =>
    emit({ ...draft, cuts: draft.cuts.map((c, j) => (j === i ? raw : c)) });
  const setLevel = (i: number, patch: Partial<LevelsDraft["levels"][number]>) =>
    emit({ ...draft, levels: draft.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const open = feedbackFor !== null ? draft.levels[feedbackFor] : undefined;

  if (total === 0) {
    return (
      <div className="tb-levels" data-testid={`${testIdPrefix}-levels-${index}`}>
        <div className="tb-levels__empty" data-testid={`${testIdPrefix}-levels-empty-${index}`}>
          Уровни не заданы — обучающийся увидит только числовой балл
          {!readOnly && (
            <div className="tb-levels__empty-act">
              <Button
                size="s"
                leadingIcon={<Plus size={16} aria-hidden="true" />}
                onClick={() => emit(addLevel(draft, domain))}
                data-testid={`${testIdPrefix}-level-add-${index}`}
              >
                Добавить уровень
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="tb-levels" data-testid={`${testIdPrefix}-levels-${index}`}>
      <div className="tb-levels__cover">
        <span className="tb-levels__caplbl">Начало</span>
        <span className="tb-levels__caplbl">Покрытие шкалы</span>
        <span className="tb-levels__caplbl tb-levels__caplbl--end">Конец</span>

        <Input
          size="s"
          fullWidth
          aria-label="Начало"
          value={draft.start}
          disabled={readOnly}
          error={errors.start ?? undefined}
          onChange={(e) => setBound({ start: e.target.value })}
          data-testid={`${testIdPrefix}-levels-start-${index}`}
        />
        <div className="tb-levels__ribbon">
          {segments === null ? (
            // Two different faults hide behind one `null`, and the author fixes
            // them differently. `errors.kind` names the one that actually fired
            // (see `LevelsErrors.kind`); «не полностью» over four filled fields
            // sent the author hunting for an empty one that does not exist.
            <div className="tb-levels__seg tb-levels__seg--unknown" data-testid={`${testIdPrefix}-levels-noribbon-${index}`}>
              <span className="tb-levels__seglbl">
                {errors.kind === "order" ? "Порядок границ нарушен" : "Границы заданы не полностью"}
              </span>
            </div>
          ) : (
            segments.map((s, i) =>
              s.kind === "gap" ? (
                <div
                  key={`gap-${i}`}
                  className="tb-levels__seg tb-levels__seg--gap"
                  style={{ flexGrow: Math.max(s.to - s.from, 0.001) }}
                  title="не разобрано"
                >
                  <span className="tb-levels__seglbl">не разобрано</span>
                </div>
              ) : (
                <div
                  key={`seg-${s.index}`}
                  className="tb-levels__seg"
                  style={{
                    flexGrow: Math.max(s.to - s.from, 0.001),
                    background: toneRibbon(effectiveTone(draft.levels[s.index], s.index)).bg,
                    color: toneRibbon(effectiveTone(draft.levels[s.index], s.index)).fg,
                  }}
                  // A narrow stripe now ellipses its caption (see `tb-levels__seglbl`),
                  // so the full name has to stay reachable — hovering is the only
                  // affordance a stripe has.
                  title={levelTitle(draft.levels[s.index], s.index)}
                  data-testid={`${testIdPrefix}-level-seg-${index}-${s.index}`}
                >
                  <span className="tb-levels__seglbl">{levelTitle(draft.levels[s.index], s.index)}</span>
                </div>
              ),
            )
          )}
        </div>
        <Input
          size="s"
          fullWidth
          aria-label="Конец"
          value={draft.end}
          disabled={readOnly}
          error={errors.end ?? undefined}
          onChange={(e) => setBound({ end: e.target.value })}
          data-testid={`${testIdPrefix}-levels-end-${index}`}
        />

        {/* The ribbon's own caption. It replaces the numbers that used to be
            repeated under both ends — a scale reads as covered or not, and that
            verdict is what the author is looking for, not the digits again. */}
        {segments !== null && (
          <div className="tb-levels__coverstat">
            {segments.some((s) => s.kind === "gap") && domain !== null
              ? `Границы шкалы ${domain.min} … ${domain.max}, уровнями закрыто ${draft.start} … ${draft.end}`
              : `Шкала разобрана целиком, ${total} ${pluralize(total, "уровень", "уровня", "уровней")}`}
          </div>
        )}
      </div>

      {draft.levels.map((l, i) => (
        <div key={l.clientKey}>
          {i > 0 && (
            <div className="tb-levels__cut">
              <div className="tb-levels__cutfield">
                <Input
                  size="s"
                  fullWidth
                  aria-label={`Порог между уровнями ${i} и ${i + 1}`}
                  value={draft.cuts[i - 1]}
                  disabled={readOnly}
                  error={errors.cuts[i - 1] ?? undefined}
                  onChange={(e) => setCut(i - 1, e.target.value)}
                  data-testid={`${testIdPrefix}-level-cut-${index}-${i - 1}`}
                />
              </div>
              <div className="tb-levels__cutrule">
                <span className="tb-levels__cutline" />
                <span className="tb-levels__cutlbl">
                  {`порог: ${draft.cuts[i - 1] || "?"} и ниже — «${levelTitle(draft.levels[i - 1], i - 1)}», выше — «${levelTitle(l, i)}»`}
                </span>
                <span className="tb-levels__cutline" />
              </div>
            </div>
          )}

          <section className="tb-levels__card" style={{ borderLeftColor: toneColour(effectiveTone(l, i)) }}>
            {/* No drag handle: reordering level content is deferred to technical
                debt (decision of 2026-08-07), and a grip that grabs nothing is a
                promise the card cannot keep. `moveLevel` in `levels-model` stays
                ready for the day the debt is picked up. */}
            <header className="tb-levels__head">
              <span className="tb-levels__title">{levelTitle(l, i)}</span>
              <span className="tb-levels__spacer" />
              <span className="tb-levels__range" data-testid={`${testIdPrefix}-level-range-${index}-${i}`}>
                {rangeOf(draft, i)}
              </span>
              {!readOnly && (
                <IconButton
                  icon={<Trash2 width={14} height={14} aria-hidden="true" />}
                  aria-label={`Удалить уровень ${i + 1}`}
                  variant="ghost"
                  size="s"
                  onClick={() => emit(removeLevel(draft, i))}
                />
              )}
            </header>

            <div className="tb-levels__grid">
              <Input
                size="s"
                fullWidth
                label="Название для обучающегося"
                aria-label={`Название уровня ${i + 1}`}
                value={l.label}
                disabled={readOnly}
                onChange={(e) => setLevel(i, { label: e.target.value })}
              />
              <Input
                size="s"
                fullWidth
                label="Код уровня"
                aria-label={`Код уровня ${i + 1}`}
                hint="Машинное имя для формул показателей"
                placeholder="напр. high"
                value={l.level}
                disabled={readOnly}
                error={errors.levels[i] ?? undefined}
                onChange={(e) => setLevel(i, { level: e.target.value })}
              />
            </div>

            <div className="tb-levels__tone">
              <span className="tb-levels__tonelbl">Как трактовать</span>
              <ToneChips
                value={l.tone}
                disabled={readOnly}
                ariaLabel={`Оценка уровня ${i + 1}`}
                onChange={(tone) => setLevel(i, { tone })}
                testId={`${testIdPrefix}-level-tone-${index}-${i}`}
              />
              {/* `ToneChips` shortens «По направлению шкалы» to «Авто» so the row
                  cannot wrap; its full meaning is spelled out here (PRD-45 FR-06). */}
              <span className="tb-levels__tonehint">Авто — цвет по направлению шкалы</span>
            </div>

            {/* A level that already has an interpretation opens with it visible: a
                card showing only the «задано» badge hides the very text the author
                came to check. Uncontrolled — the author's own toggling wins after. */}
            <Collapsible defaultOpen={l.text.trim() !== ""}>
              <CollapsibleTrigger className="tb-levels__fold">
                <ChevronRight className="tb-levels__chev" width={14} height={14} aria-hidden="true" />
                Толкование для обучающегося
                <span className="tb-levels__spacer" />
                <span className="tb-levels__badge">{l.text.trim() === "" ? "не задано" : "задано"}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Textarea
                  size="s"
                  fullWidth
                  rows={3}
                  value={l.text}
                  disabled={readOnly}
                  placeholder="Что означает этот уровень — текст для обучающегося"
                  aria-label={`Толкование уровня ${i + 1}`}
                  onChange={(e) => setLevel(i, { text: e.target.value })}
                />
              </CollapsibleContent>
            </Collapsible>

            {/* Keeps the fold row's geometry so the two rows line up, but NOT its
                promise: recommendations open in a modal, so the leading icon is the
                pencil every other modal editor in the editor uses (see
                `feedback-preview`, `scoring-section`), not a chevron that would
                announce an expansion that never happens. The chevron rotation is
                keyed to `[data-state]`, which only a Collapsible trigger carries,
                so nothing here can spin.

                Stays visible while reading, like the interpretation fold above it:
                whether recommendations exist is part of what the author came to
                see, so the row is disabled rather than removed. */}
            <button
              type="button"
              className="tb-levels__fold"
              disabled={readOnly}
              onClick={() => setFeedbackFor(i)}
            >
              <Pencil className="tb-levels__chev" width={14} height={14} aria-hidden="true" />
              Рекомендации
              <span className="tb-levels__spacer" />
              <span className="tb-levels__badge">{feedbackBadge(l.feedback)}</span>
            </button>
          </section>
        </div>
      ))}

      {!readOnly && (
        <Button
          variant="ghost"
          size="s"
          leadingIcon={<Plus size={16} aria-hidden="true" />}
          onClick={() => emit(addLevel(draft, domain))}
          data-testid={`${testIdPrefix}-level-add-${index}`}
        >
          Добавить уровень
        </Button>
      )}

      {errors.blocking && (
        <Banner
          tone="error"
          size="sm"
          description={errors.blocking}
          data-testid={`${testIdPrefix}-levels-error-${index}`}
        />
      )}
      {!errors.blocking && segments !== null && segments.some((s) => s.kind === "gap") && (
        <Banner
          tone="warning"
          size="sm"
          description={`Баллы вне ${draft.start} … ${draft.end} останутся без уровня. Растяните крайние поля до границ шкалы или сузьте границы.`}
          data-testid={`${testIdPrefix}-levels-uncovered-${index}`}
        />
      )}
      {hasStoredGap(bands) && (
        <Banner
          tone="info"
          size="sm"
          description={
            "Границы уровней сомкнуты в редакторе — баллы, прежде не попадавшие ни в один " +
            "уровень, показаны в нижнем из соседних. Чтобы смыкание сохранилось, измените " +
            "любое поле уровней перед сохранением теста."
          }
          data-testid={`${testIdPrefix}-levels-closed-gap-${index}`}
        />
      )}
      {/* Deliberately path-free: the same editor serves the «Показатели» tab, where
          no `scale.<key>` address exists, so naming one would be wrong half the time. */}
      <Banner
        tone="info"
        size="sm"
        description={
          "«Код уровня» — машинное имя, по которому уровень доступен формулам показателей. " +
          "«Название» видит обучающийся; пусто — покажется код."
        }
      />

      {open && feedbackFor !== null && (
        <FeedbackEditorModal
          open
          title={`Рекомендации для уровня «${levelTitle(open, feedbackFor)}»`}
          description="Текст и подборка материалов, которые увидит обучающийся с этим уровнем"
          value={open.feedback ?? emptyFeedbackValue()}
          hideAssets={false}
          onCancel={() => setFeedbackFor(null)}
          onSave={(value) => {
            setLevel(feedbackFor, { feedback: value });
            setFeedbackFor(null);
          }}
          testId={`${testIdPrefix}-level-feedback-${index}`}
        />
      )}
    </div>
  );
}
