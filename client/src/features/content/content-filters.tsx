/**
 * @module features/content/content-filters
 *
 * Facet filter PANEL for the unified "Темы и вопросы" tree — a faithful port of
 * the approved wireframe docs/wireframes/approved/content-bank-explorer.html
 * (state s-filters): a floating `cb-filterpop` card anchored under the toolbar
 * with a single vertical stack of facets (Тип вопроса / Сложность / Теги /
 * Медиа / Владелец / Область) and a «Сбросить всё» / «Применить» footer. The panel
 * edits a DRAFT filter; the tree re-filters only on «Применить» (batching —
 * keeps the tree responsive on large banks). Active-condition chips are rendered
 * by the tree itself. See docs/PLAN_content_axis_implementation.md.
 */
import { Button, Checkbox, SegmentedControl, Select, Slider, Switch, TagInput } from "@universityrt/ui-kit";
import { normalizeTag, tagKey, TAG_MAX_LENGTH } from "@shared/tags";
import { t } from "@/lib/i18n";

export type { QuestionType } from "@shared/questions/question-type";
import type { QuestionType } from "@shared/questions/question-type";
export type MediaBucket = "image" | "audio" | "video" | "none";
export type ContentScope = "all" | "mine" | "accessible" | "shared";

export interface ContentFilterValue {
  types: QuestionType[];
  /** Difficulty interval 0–100 (PRD-16 FR-13); full range = not active. */
  diffMin: number;
  diffMax: number;
  /** «Не задана» gate: when on, match questions with no difficulty (interval hidden). */
  diffUnset: boolean;
  tags: string[];
  media: MediaBucket[];
  author: string; // user id, "" = any
  scope: ContentScope;
}

export const EMPTY_FILTER: ContentFilterValue = {
  types: [], diffMin: 0, diffMax: 100, diffUnset: false, tags: [], media: [], author: "", scope: "all",
};

/** Whether the difficulty facet narrows results (interval or «Не задана»). */
export function diffActive(f: ContentFilterValue): boolean {
  return f.diffUnset || f.diffMin > 0 || f.diffMax < 100;
}

/** Number of active conditions (drives the "Фильтры (N)" badge + chips). */
export function filterCount(f: ContentFilterValue): number {
  return f.types.length + (diffActive(f) ? 1 : 0) + f.tags.length + f.media.length + (f.author ? 1 : 0) + (f.scope !== "all" ? 1 : 0);
}

export const TYPE_OPTS: { value: QuestionType; label: string }[] = [
  { value: "single", label: t.questions.singleChoice },
  { value: "multiple", label: t.questions.multipleChoice },
  { value: "matching", label: t.questions.matching },
  { value: "ranking", label: t.questions.ranking },
  { value: "scale", label: t.questions.scaleChoice },
];
export const MEDIA_OPTS: { value: MediaBucket; label: string }[] = [
  { value: "image", label: "С изображением" },
  { value: "audio", label: "С аудио" },
  { value: "video", label: "С видео" },
  { value: "none", label: "Без медиа" },
];
export const SCOPE_OPTS: { value: ContentScope; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "mine", label: "Мои" },
  { value: "accessible", label: "Доступные" },
  { value: "shared", label: "Общие" },
];

function toggle<T>(arr: T[], item: T, on: boolean): T[] {
  return on ? [...arr, item] : arr.filter((x) => x !== item);
}

interface ContentFiltersProps {
  /** Draft value being edited in the panel. */
  value: ContentFilterValue;
  onChange: (next: ContentFilterValue) => void;
  onApply: () => void;
  onReset: () => void;
  tagOptions: string[];
  authorOptions: { value: string; label: string }[];
}

/** The facet popover (caller renders it only when open). */
export function ContentFilters({ value, onChange, onApply, onReset, tagOptions, authorOptions }: ContentFiltersProps) {
  return (
    <div className="ct-filterpop" role="dialog" aria-label="Фильтры">
      <div className="ct-filterpop__body">
        <div className="ct-facet">
          <span className="ct-facet__lbl">Тип вопроса</span>
          <div className="ct-facet__row">
            {TYPE_OPTS.map((o) => (
              <Checkbox key={o.value} label={o.label} checked={value.types.includes(o.value)} onChange={(e) => onChange({ ...value, types: toggle(value.types, o.value, e.target.checked) })} />
            ))}
          </div>
        </div>

        <div className="ct-facet">
          <span className="ct-facet__lbl">Сложность</span>
          <Switch label="Не задана" checked={value.diffUnset} onChange={(e) => onChange({ ...value, diffUnset: e.target.checked })} />
          {!value.diffUnset && (
            <Slider
              range
              min={0}
              max={100}
              step={1}
              value={[value.diffMin, value.diffMax]}
              onChange={(v) => { const [a, b] = v as [number, number]; onChange({ ...value, diffMin: a, diffMax: b }); }}
              label="Интервал"
              ariaLabel="Интервал сложности"
            />
          )}
        </div>

        <div className="ct-facet">
          <span className="ct-facet__lbl">Теги (подтемы)</span>
          <TagInput
            value={value.tags}
            onChange={(tags) => onChange({ ...value, tags })}
            suggestions={tagOptions}
            placeholder="Добавить тег…"
            maxLength={TAG_MAX_LENGTH}
            normalize={normalizeTag}
            dedupeKey={tagKey}
            createLabel={(v) => `Тег «${v}»`}
            removeLabel={(tg) => `Удалить тег ${tg}`}
          />
        </div>

        <div className="ct-facet">
          <span className="ct-facet__lbl">Медиа</span>
          <div className="ct-facet__row">
            {MEDIA_OPTS.map((o) => (
              <Checkbox key={o.value} label={o.label} checked={value.media.includes(o.value)} onChange={(e) => onChange({ ...value, media: toggle(value.media, o.value, e.target.checked) })} />
            ))}
          </div>
        </div>

        <div className="ct-facet">
          <span className="ct-facet__lbl">Владелец</span>
          <Select value={value.author} onChange={(v) => onChange({ ...value, author: v })} options={[{ value: "", label: "Любой" }, ...authorOptions]} aria-label="Владелец" />
        </div>

        <div className="ct-facet">
          <span className="ct-facet__lbl">Область</span>
          <SegmentedControl<ContentScope> value={value.scope} onChange={(v) => onChange({ ...value, scope: v })} items={SCOPE_OPTS} />
        </div>
      </div>

      <div className="ct-filterpop__foot">
        <Button variant="ghost" onClick={onReset}>Сбросить всё</Button>
        <span className="ct-spacer" />
        <Button variant="primary" onClick={onApply}>Применить</Button>
      </div>
    </div>
  );
}
