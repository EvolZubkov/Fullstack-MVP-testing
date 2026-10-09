/**
 * @module features/tests/list/tests-filters
 *
 * Facet filter PANEL for the tests list — the «Тесты» analogue of the content
 * section's {@link ContentFilters}: the one filter form of the product (PRD-70 FR-70 -
 * FR-78) — a ui-kit `FilterPanel` under the «Фильтр» button of the list's `FilterBar`,
 * facets Статус / Режим / Сценарий / Владелец / Область and a «Сбросить» / «Применить»
 * footer. Edits a DRAFT;
 * the list re-filters only on «Применить» (batched). Active-condition chips are
 * rendered by the page. Mirrors the content section so both author lists share
 * one filter UX.
 *
 * Note: the list excludes archived tests upstream, so the «Статус» facet offers
 * Черновик / Опубликован only (the archive is a separate, deferred view).
 */
import { mergeShape } from "@/features/saved-filters/use-list-filters";
import type { RefObject } from "react";
import { Checkbox, FilterPanel, FilterPanelGroup, SegmentedControl, Select } from "@skillum/ui-kit";
import type { TestListEntry, TestListMode, TestListStatus, TestListFlowMode } from "./tests-list.types";

export type TestScope = "all" | "mine" | "accessible";

export interface TestFilterValue {
  statuses: TestListStatus[];
  modes: TestListMode[];
  scenarios: TestListFlowMode[];
  author: string; // ownerId, "" = any
  scope: TestScope;
}

export const EMPTY_TEST_FILTER: TestFilterValue = {
  statuses: [], modes: [], scenarios: [], author: "", scope: "all",
};

/**
 * Условия сохранённого набора «Тестов» → фильтр экрана: только известные поля и значения.
 * Набор, сохранённый до появления нового значения или с исчезнувшим, применяется без него.
 *
 * @param conditions условия набора
 */
export function testFilterOf(conditions: unknown): TestFilterValue {
  const raw = mergeShape(EMPTY_TEST_FILTER, conditions);
  const known = <V extends string>(values: string[], opts: { value: V }[]) =>
    values.filter((v): v is V => opts.some((o) => o.value === v));
  return {
    statuses: known(raw.statuses, STATUS_OPTS),
    modes: known(raw.modes, MODE_OPTS),
    scenarios: known(raw.scenarios, SCENARIO_OPTS),
    author: raw.author,
    scope: TEST_SCOPE_OPTS.some((o) => o.value === raw.scope) ? raw.scope : "all",
  };
}

/** Number of active conditions (drives the counter of the «Фильтр» button + chips). */
export function testFilterCount(f: TestFilterValue): number {
  return f.statuses.length + f.modes.length + f.scenarios.length + (f.author ? 1 : 0) + (f.scope !== "all" ? 1 : 0);
}

export const STATUS_OPTS: { value: TestListStatus; label: string }[] = [
  { value: "draft", label: "Черновик" },
  { value: "published", label: "Опубликован" },
];
export const MODE_OPTS: { value: TestListMode; label: string }[] = [
  { value: "standard", label: "Стандарт" },
  { value: "adaptive", label: "Адаптив" },
];
// Подписи совпадают с колонкой «Сценарий» в дереве тестов (flow-chip):
// Линейный / По темам / Роутер — единая терминология на странице.
export const SCENARIO_OPTS: { value: TestListFlowMode; label: string }[] = [
  { value: "linear_flat", label: "Линейный" },
  { value: "linear_by_topics", label: "По темам" },
  { value: "router_by_topics", label: "Роутер" },
];
export const TEST_SCOPE_OPTS: { value: TestScope; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "mine", label: "Мои" },
  { value: "accessible", label: "Доступные" },
];

function toggle<T>(arr: T[], item: T, on: boolean): T[] {
  return on ? [...arr, item] : arr.filter((x) => x !== item);
}

/** Pure facet predicate (scope is applied by the page — it needs the user id). */
export function testFacetMatch(e: TestListEntry, f: TestFilterValue): boolean {
  if (f.statuses.length && !f.statuses.includes(e.status)) return false;
  if (f.modes.length && !f.modes.includes(e.mode)) return false;
  if (f.scenarios.length && !f.scenarios.includes(e.flowMode)) return false;
  if (f.author && e.ownerId !== f.author) return false;
  return true;
}

interface TestFiltersProps {
  /** The panel is open. */
  open: boolean;
  /** Closes without applying — the draft is dropped. */
  onClose: () => void;
  /** The «Фильтр» button of the bar the panel opens under. */
  anchorRef: RefObject<HTMLElement | null>;
  value: TestFilterValue;
  onChange: (next: TestFilterValue) => void;
  onApply: () => void;
  /** Clears the draft (not what is applied). */
  onReset: () => void;
  authorOptions: { value: string; label: string }[];
}

/** The facet panel — the one filter form of the product (PRD-70 FR-71). */
export function TestFilters({ open, onClose, anchorRef, value, onChange, onApply, onReset, authorOptions }: TestFiltersProps) {
  return (
    <FilterPanel open={open} onClose={onClose} anchorRef={anchorRef} onApply={onApply} onReset={onReset}>
      <FilterPanelGroup title="Статус" inline>
        {STATUS_OPTS.map((o) => (
          <Checkbox key={o.value} label={o.label} checked={value.statuses.includes(o.value)} onChange={(e) => onChange({ ...value, statuses: toggle(value.statuses, o.value, e.target.checked) })} />
        ))}
      </FilterPanelGroup>

      <FilterPanelGroup title="Режим" inline>
        {MODE_OPTS.map((o) => (
          <Checkbox key={o.value} label={o.label} checked={value.modes.includes(o.value)} onChange={(e) => onChange({ ...value, modes: toggle(value.modes, o.value, e.target.checked) })} />
        ))}
      </FilterPanelGroup>

      <FilterPanelGroup title="Сценарий" inline>
        {SCENARIO_OPTS.map((o) => (
          <Checkbox key={o.value} label={o.label} checked={value.scenarios.includes(o.value)} onChange={(e) => onChange({ ...value, scenarios: toggle(value.scenarios, o.value, e.target.checked) })} />
        ))}
      </FilterPanelGroup>

      <FilterPanelGroup title="Владелец">
        <Select value={value.author} onChange={(v) => onChange({ ...value, author: v })} options={[{ value: "", label: "Любой" }, ...authorOptions]} aria-label="Владелец" />
      </FilterPanelGroup>

      <FilterPanelGroup title="Область">
        <SegmentedControl<TestScope> value={value.scope} onChange={(v) => onChange({ ...value, scope: v })} items={TEST_SCOPE_OPTS} />
      </FilterPanelGroup>
    </FilterPanel>
  );
}
