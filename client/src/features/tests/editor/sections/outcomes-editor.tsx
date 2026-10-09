/**
 * @module features/tests/editor/sections/outcomes-editor
 * @description PRD-29: the outcome-list editor — the string/boolean twin of the
 * numeric {@link LevelsEditor} (`levels-editor`). A numeric interpretation attaches
 * its meaning to an INTERVAL; a string or boolean one has no intervals at all, so
 * the formula returns a CODE and the author enumerates the codes it can return.
 *
 * PRD-53 moved this editor off the `tb-bands-table` onto the SAME collapsible cards
 * the scales tab uses (`tb-level-card`), following the approved wireframe
 * `docs/wireframes/approved/prd53-profile-indicator.html`. The table was written for
 * a handful of rows: a profile over four scales has fifteen, over five thirty-one,
 * and in a table each row shows only its first line — the author had to guess which
 * field a value belonged to, and the delete control drifted away from the row it
 * removes. A collapsed card states the outcome in one line («cel · толкование
 * задано»); an expanded one lays the fields out with their labels.
 *
 * What the two editors share is the closed list of tones, the interpretation fold
 * and the recommendations modal — the SHARED {@link FeedbackEditorModal}.
 *
 * The tone options and the feedback helpers are exported because `LevelsEditor`
 * consumes them too: one closed list of methodological states for both editors.
 */

import { useMemo, useState } from "react";
import {
  Button,
  Cluster,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  IconButton,
  Input,
  Textarea,
} from "@skillum/ui-kit";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Pencil, Plus, Trash2 } from "lucide-react";

import type { LevelTone } from "@shared/scales/interpretation";
import type { OutcomeModel } from "../test-editor.types";
import { hasFeedbackContent } from "../scales-api";
import { FeedbackEditorModal, type FeedbackEditorValue } from "./feedback-editor-modal";
import { ToneChips } from "./tone-chips";

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

/** Заголовок свёрнутой карточки: метка, а без неё — код, а без обоих — номер. */
function outcomeTitle(o: OutcomeModel, j: number): string {
  return o.label.trim() || o.code.trim() || `Исход ${j + 1}`;
}

/**
 * Строка под заголовком: то, что нужно знать, НЕ разворачивая карточку, — код исхода
 * и есть ли у него толкование. Без последнего свёрнутый список пятнадцати профилей
 * не отвечает на единственный вопрос автора: где ещё не написан текст.
 */
function outcomeSummary(o: OutcomeModel): string {
  const code = o.code.trim() || "без кода";
  return `${code} · ${o.text.trim() === "" ? "толкование не задано" : "толкование задано"}`;
}

function feedbackBadge(value: FeedbackEditorValue | undefined): string {
  return hasFeedbackContent(value) ? "заданы" : "не заданы";
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

  /**
   * Свёрнутые карточки — по клиентскому ключу, а не по индексу: удаление исхода
   * сдвигает индексы, и состояние переехало бы на соседа. Пусто = развёрнуто всё:
   * автор, открывший показатель с тремя исходами, не должен их раскрывать по одному.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const keys = useMemo(() => outcomes.map((o, j) => o.clientKey ?? `outcome-${j}`), [outcomes]);
  const allCollapsed = keys.length > 0 && keys.every((k) => collapsed.has(k));
  const anyCollapsed = keys.some((k) => collapsed.has(k));

  const update = (j: number, patch: Partial<OutcomeModel>) =>
    onChange(outcomes.map((o, i) => (i === j ? { ...o, ...patch } : o)));
  const remove = (j: number) => onChange(outcomes.filter((_, i) => i !== j));
  const add = () => onChange([...outcomes, emptyOutcome()]);

  const known = new Set(outcomes.map((o) => o.code.trim()).filter((c) => c !== ""));
  const missing = suggestedCodes.filter((c) => c !== "" && !known.has(c));

  const open = feedbackFor !== null ? outcomes[feedbackFor] : undefined;

  return (
    <>
      {outcomes.length > 1 && (
        <div className="tb-fold-toolbar">
          <span className="tb-fold-actions">
            <Button
              variant="ghost"
              size="s"
              leadingIcon={<ChevronsUpDown width={14} height={14} aria-hidden="true" />}
              disabled={!anyCollapsed}
              onClick={() => setCollapsed(new Set())}
              data-testid={`metrics-outcomes-expand-all-${index}`}
            >
              Развернуть все
            </Button>
            <Button
              variant="ghost"
              size="s"
              leadingIcon={<ChevronsDownUp width={14} height={14} aria-hidden="true" />}
              disabled={allCollapsed}
              onClick={() => setCollapsed(new Set(keys))}
              data-testid={`metrics-outcomes-collapse-all-${index}`}
            >
              Свернуть все
            </Button>
          </span>
        </div>
      )}

      <div className="tb-outcome-list" data-testid={`metrics-outcomes-${index}`}>
        {outcomes.length === 0 ? (
          <div className="tb-levels__empty" data-testid={`metrics-outcomes-empty-${index}`}>
            Исходы не заданы
          </div>
        ) : (
          outcomes.map((o, j) => {
            const k = keys[j];
            const isOpen = !collapsed.has(k);
            return (
              <section
                key={k}
                className={"ou-card ou-card--outlined ou-card--sm tb-level-card" + (isOpen ? "" : " is-collapsed")}
                data-testid={`metrics-outcome-card-${index}-${j}`}
              >
                <header className="ou-card__header tb-level-card__head">
                  <div className="ou-card__heading tb-level-card__heading">
                    <h5 className="ou-card__title tb-level-card__title">{outcomeTitle(o, j)}</h5>
                    <p className="ou-card__subtitle tb-level-card__summary">{outcomeSummary(o)}</p>
                  </div>
                  <div className="ou-card__trail tb-level-card__trail">
                    {!readOnly && (
                      <IconButton
                        icon={<Trash2 width={14} height={14} aria-hidden="true" />}
                        aria-label={`Удалить исход ${j + 1}`}
                        variant="ghost"
                        size="s"
                        onClick={() => remove(j)}
                      />
                    )}
                    <button
                      type="button"
                      className="tb-level-card__chev"
                      aria-label={isOpen ? `Свернуть исход ${j + 1}` : `Развернуть исход ${j + 1}`}
                      aria-expanded={isOpen}
                      onClick={() =>
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          return next;
                        })
                      }
                      data-testid={`metrics-outcome-toggle-${index}-${j}`}
                    >
                      <ChevronDown width={16} height={16} aria-hidden="true" />
                    </button>
                  </div>
                </header>

                {isOpen && (
                  <div className="ou-card__body tb-level-card__body">
                    <div className="tb-levels__grid">
                      <Input
                        size="s"
                        fullWidth
                        label="Название для обучающегося"
                        aria-label={`метка исхода ${j + 1}`}
                        placeholder="Что увидит обучающийся"
                        value={o.label}
                        disabled={readOnly}
                        onChange={(e) => update(j, { label: e.target.value })}
                      />
                      <Input
                        size="s"
                        fullWidth
                        label="Код исхода"
                        aria-label={`код исхода ${j + 1}`}
                        hint="Значение, которое возвращает формула; у профиля — ключи шкал через «+»"
                        placeholder="напр. burnout"
                        value={o.code}
                        disabled={readOnly}
                        onChange={(e) => update(j, { code: e.target.value })}
                      />
                    </div>

                    <div className="tb-levels__tone">
                      <span className="tb-levels__tonelbl">Как трактовать</span>
                      <ToneChips
                        value={o.tone}
                        disabled={readOnly}
                        ariaLabel={`оценка исхода ${j + 1}`}
                        onChange={(tone) => update(j, { tone })}
                        testId={`metrics-outcome-tone-${index}-${j}`}
                      />
                      <span className="tb-levels__tonehint">Авто — цвет по направлению шкалы</span>
                    </div>

                    {/* Исход с толкованием открывается с ним на виду: карточка, показывающая
                        одну лишь метку «задано», прячет тот самый текст, ради которого автор
                        её и открыл. Неуправляемый — дальше решает автор. */}
                    <Collapsible defaultOpen={o.text.trim() !== ""}>
                      <CollapsibleTrigger className="tb-levels__fold">
                        <ChevronRight className="tb-levels__chev" width={14} height={14} aria-hidden="true" />
                        Толкование для обучающегося
                        <span className="tb-levels__spacer" />
                        <span className="tb-levels__badge">{o.text.trim() === "" ? "не задано" : "задано"}</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <Textarea
                          size="s"
                          fullWidth
                          rows={3}
                          value={o.text}
                          disabled={readOnly}
                          placeholder="Что означает этот исход — текст для обучающегося"
                          aria-label={`толкование исхода ${j + 1}`}
                          onChange={(e) => update(j, { text: e.target.value })}
                        />
                      </CollapsibleContent>
                    </Collapsible>

                    {/* Та же геометрия, что у складки выше, но не её обещание: рекомендации
                        открываются модальным окном, поэтому ведущий значок — карандаш, а не
                        шеврон, который объявил бы разворот, которого не будет. */}
                    <button
                      type="button"
                      className="tb-levels__fold"
                      disabled={readOnly}
                      onClick={() => setFeedbackFor(j)}
                      data-testid={`metrics-outcome-feedback-open-${index}-${j}`}
                    >
                      <Pencil className="tb-levels__chev" width={14} height={14} aria-hidden="true" />
                      Рекомендации
                      <span className="tb-levels__spacer" />
                      <span className="tb-levels__badge">{feedbackBadge(o.feedback)}</span>
                    </button>
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

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
