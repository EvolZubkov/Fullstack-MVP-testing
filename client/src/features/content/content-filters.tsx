/**
 * @module features/content/content-filters
 *
 * Facet filter PANEL for the unified "Темы и вопросы" tree — the one filter form of
 * the product (PRD-70 FR-70 - FR-78, docs/wireframes/approved/filters-unified.html): a
 * ui-kit `FilterPanel` under the «Фильтр» button of the tree's `FilterBar`, with the
 * facets Тип вопроса / Сложность / Теги / Медиа / Состояние (PRD-70 FR-23) / Владелец /
 * Область and a «Сбросить» /
 * «Применить» footer. The panel edits a DRAFT filter; the tree re-filters only on
 * «Применить» (batching — keeps the tree responsive on large banks). Active-condition
 * chips are rendered by the bar. See docs/PLAN_content_axis_implementation.md.
 */
import type { RefObject } from "react";
import { Checkbox, FilterPanel, FilterPanelGroup, SegmentedControl, Select, Slider, Switch, TagInput } from "@skillum/ui-kit";
import { normalizeTag, tagKey, TAG_MAX_LENGTH } from "@shared/tags";
import { t } from "@/lib/i18n";
import { STATE_OPTS, type ContentState } from "./bank-quality";
import { mergeShape } from "@/features/saved-filters/use-list-filters";

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
  /** PRD-70 FR-23: состояние вопроса по тестам читателя — отмеченные через «или». */
  states: ContentState[];
}

export const EMPTY_FILTER: ContentFilterValue = {
  types: [], diffMin: 0, diffMax: 100, diffUnset: false, tags: [], media: [], author: "", scope: "all", states: [],
};

/** Whether the difficulty facet narrows results (interval or «Не задана»). */
export function diffActive(f: ContentFilterValue): boolean {
  return f.diffUnset || f.diffMin > 0 || f.diffMax < 100;
}

/** Number of active conditions (drives the "Фильтры (N)" badge + chips). */
export function filterCount(f: ContentFilterValue): number {
  return f.types.length + (diffActive(f) ? 1 : 0) + f.tags.length + f.media.length + (f.author ? 1 : 0) + (f.scope !== "all" ? 1 : 0) + f.states.length;
}

export const TYPE_OPTS: { value: QuestionType; label: string }[] = [
  { value: "single", label: t.questions.singleChoice },
  { value: "multiple", label: t.questions.multipleChoice },
  { value: "matching", label: t.questions.matching },
  { value: "ranking", label: t.questions.ranking },
  { value: "scale", label: t.questions.scaleChoice },
  { value: "allocation", label: t.questions.allocation },
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
  /** The panel is open. */
  open: boolean;
  /** Closes without applying — the draft is dropped. */
  onClose: () => void;
  /** The «Фильтр» button of the bar the panel opens under. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Draft value being edited in the panel. */
  value: ContentFilterValue;
  onChange: (next: ContentFilterValue) => void;
  onApply: () => void;
  /** Clears the draft (not what is applied). */
  onReset: () => void;
  tagOptions: string[];
  authorOptions: { value: string; label: string }[];
  /** Показывать «Состояние»: оно из аналитики, и без права на неё судить не по чему. */
  showStates?: boolean;
}

/** The facet panel — the one filter form of the product (PRD-70 FR-71). */
export function ContentFilters({ open, onClose, anchorRef, value, onChange, onApply, onReset, tagOptions, authorOptions, showStates = false }: ContentFiltersProps) {
  return (
    <FilterPanel open={open} onClose={onClose} anchorRef={anchorRef} onApply={onApply} onReset={onReset}>
      <FilterPanelGroup title="Тип вопроса" inline>
        {TYPE_OPTS.map((o) => (
          <Checkbox key={o.value} label={o.label} checked={value.types.includes(o.value)} onChange={(e) => onChange({ ...value, types: toggle(value.types, o.value, e.target.checked) })} />
        ))}
      </FilterPanelGroup>

      <FilterPanelGroup title="Сложность">
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
      </FilterPanelGroup>

      <FilterPanelGroup title="Теги (подтемы)">
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
      </FilterPanelGroup>

      <FilterPanelGroup title="Медиа" inline>
        {MEDIA_OPTS.map((o) => (
          <Checkbox key={o.value} label={o.label} checked={value.media.includes(o.value)} onChange={(e) => onChange({ ...value, media: toggle(value.media, o.value, e.target.checked) })} />
        ))}
      </FilterPanelGroup>

      {showStates && (
        <FilterPanelGroup title="Состояние" inline>
          {STATE_OPTS.map((o) => (
            <Checkbox key={o.value} label={o.label} checked={value.states.includes(o.value)} onChange={(e) => onChange({ ...value, states: toggle(value.states, o.value, e.target.checked) })} />
          ))}
        </FilterPanelGroup>
      )}

      <FilterPanelGroup title="Владелец">
        <Select value={value.author} onChange={(v) => onChange({ ...value, author: v })} options={[{ value: "", label: "Любой" }, ...authorOptions]} aria-label="Владелец" />
      </FilterPanelGroup>

      <FilterPanelGroup title="Область">
        <SegmentedControl<ContentScope> value={value.scope} onChange={(v) => onChange({ ...value, scope: v })} items={SCOPE_OPTS} />
      </FilterPanelGroup>
    </FilterPanel>
  );
}

/**
 * Условия фильтра в параметрах адреса (замечание владельца 2026-10-05 о возврате): дерево, на
 * которое вернулись крошкой или «Назад», должно показать тот же отбор. Пустые условия не пишутся.
 *
 * @param f условия
 * @param params параметры адреса, куда писать; прочие параметры не трогаются
 */
export function writeContentFilter(f: ContentFilterValue, params: URLSearchParams): void {
  for (const key of ["type", "diff", "tag", "media", "owner", "scope", "state"]) params.delete(key);
  for (const ty of f.types) params.append("type", ty);
  if (f.diffUnset) params.set("diff", "unset");
  else if (f.diffMin > 0 || f.diffMax < 100) params.set("diff", `${f.diffMin}-${f.diffMax}`);
  for (const tg of f.tags) params.append("tag", tg);
  for (const m of f.media) params.append("media", m);
  if (f.author) params.set("owner", f.author);
  if (f.scope !== "all") params.set("scope", f.scope);
  for (const st of f.states) params.append("state", st);
}

/**
 * Условия сохранённого набора банка → фильтр экрана. Идут тем же путём, что условия из адреса:
 * всё незнакомое отбрасывается, интервал сложности приводится к 0–100.
 *
 * @param conditions условия набора
 */
export function contentFilterOf(conditions: unknown): ContentFilterValue {
  const params = new URLSearchParams();
  writeContentFilter(mergeShape(EMPTY_FILTER, conditions), params);
  return readContentFilter(params.toString());
}

/**
 * Условия фильтра из адреса; всё, что не похоже на условие, отбрасывается молча.
 *
 * @param search строка запроса адреса
 */
export function readContentFilter(search: string): ContentFilterValue {
  const params = new URLSearchParams(search);
  const types = TYPE_OPTS.map((o) => o.value);
  const media = MEDIA_OPTS.map((o) => o.value);
  const scopes = SCOPE_OPTS.map((o) => o.value);
  const states: string[] = ["review", "overexposed", "never"];
  const diff = params.get("diff") ?? "";
  const range = /^(\d{1,3})-(\d{1,3})$/.exec(diff);
  const scope = params.get("scope") ?? "all";
  return {
    ...EMPTY_FILTER,
    types: params.getAll("type").filter((v): v is QuestionType => (types as string[]).includes(v)),
    diffUnset: diff === "unset",
    diffMin: range ? Math.min(100, Number(range[1])) : 0,
    diffMax: range ? Math.min(100, Number(range[2])) : 100,
    tags: params.getAll("tag"),
    media: params.getAll("media").filter((v): v is MediaBucket => (media as string[]).includes(v)),
    author: params.get("owner") ?? "",
    scope: (scopes as string[]).includes(scope) ? (scope as ContentScope) : "all",
    states: params.getAll("state").filter((v): v is ContentState => states.includes(v)),
  };
}
