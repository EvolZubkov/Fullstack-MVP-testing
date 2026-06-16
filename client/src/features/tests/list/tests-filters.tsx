/**
 * @module features/tests/list/tests-filters
 *
 * Facet filter PANEL for the tests list — the «Тесты» analogue of the content
 * section's {@link ContentFilters}. A floating `tl-filterpop` card anchored under
 * the toolbar with a vertical stack of facets (Статус / Режим / Сценарий /
 * Владелец / Область) and a «Сбросить всё» / «Применить» footer. Edits a DRAFT;
 * the list re-filters only on «Применить» (batched). Active-condition chips are
 * rendered by the page. Mirrors the content section so both author lists share
 * one filter UX.
 *
 * Note: the list excludes archived tests upstream, so the «Статус» facet offers
 * Черновик / Опубликован only (the archive is a separate, deferred view).
 */
import { Button, Checkbox, SegmentedControl, Select } from "@universityrt/ui-kit";
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

/** Number of active conditions (drives the "Фильтры (N)" badge + chips). */
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
  value: TestFilterValue;
  onChange: (next: TestFilterValue) => void;
  onApply: () => void;
  onReset: () => void;
  authorOptions: { value: string; label: string }[];
}

/** The facet popover (caller renders it only when open). */
export function TestFilters({ value, onChange, onApply, onReset, authorOptions }: TestFiltersProps) {
  return (
    <div className="tl-filterpop" role="dialog" aria-label="Фильтры">
      <div className="tl-filterpop__body">
        <div className="tl-facet">
          <span className="tl-facet__lbl">Статус</span>
          <div className="tl-facet__row">
            {STATUS_OPTS.map((o) => (
              <Checkbox key={o.value} label={o.label} checked={value.statuses.includes(o.value)} onChange={(e) => onChange({ ...value, statuses: toggle(value.statuses, o.value, e.target.checked) })} />
            ))}
          </div>
        </div>

        <div className="tl-facet">
          <span className="tl-facet__lbl">Режим</span>
          <div className="tl-facet__row">
            {MODE_OPTS.map((o) => (
              <Checkbox key={o.value} label={o.label} checked={value.modes.includes(o.value)} onChange={(e) => onChange({ ...value, modes: toggle(value.modes, o.value, e.target.checked) })} />
            ))}
          </div>
        </div>

        <div className="tl-facet">
          <span className="tl-facet__lbl">Сценарий</span>
          <div className="tl-facet__row">
            {SCENARIO_OPTS.map((o) => (
              <Checkbox key={o.value} label={o.label} checked={value.scenarios.includes(o.value)} onChange={(e) => onChange({ ...value, scenarios: toggle(value.scenarios, o.value, e.target.checked) })} />
            ))}
          </div>
        </div>

        <div className="tl-facet">
          <span className="tl-facet__lbl">Владелец</span>
          <Select value={value.author} onChange={(v) => onChange({ ...value, author: v })} options={[{ value: "", label: "Любой" }, ...authorOptions]} aria-label="Владелец" />
        </div>

        <div className="tl-facet">
          <span className="tl-facet__lbl">Область</span>
          <SegmentedControl<TestScope> value={value.scope} onChange={(v) => onChange({ ...value, scope: v })} items={TEST_SCOPE_OPTS} />
        </div>
      </div>

      <div className="tl-filterpop__foot">
        <Button variant="ghost" onClick={onReset}>Сбросить всё</Button>
        <span className="tl-spacer" />
        <Button variant="primary" onClick={onApply}>Применить</Button>
      </div>
    </div>
  );
}
