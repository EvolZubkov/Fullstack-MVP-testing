/**
 * @module shared/template/allocation-dom
 *
 * Live input for the budget-allocation group (PRD-44 §6) — the half of the interaction
 * that cannot live in the markup: dragging, typing and stepping, plus patching the group
 * in place while it happens.
 *
 * Why in place, and why the commit is separate. The DS slider is NOT a native
 * `<input type="range">` — it is a div with pointer handlers — and both hosts render the
 * scene by writing HTML into a slot. Re-render on every pointermove would replace the very
 * node the finger is holding, and the gesture would die on the first pixel. So a drag
 * patches the DOM directly and tells the host NOTHING until it ends; discrete inputs (the
 * stepper, the number field, the keyboard) commit at once, because there is no gesture to
 * preserve. Either way the host then re-renders to exactly the same DOM, so nothing jumps.
 *
 * Framework-free — no DOM types from Node, no React. The web host attaches it to the
 * shadow root, the SCORM runtime to the document, and both get identical behaviour
 * because the arithmetic comes from the shared model, not from a copy per host.
 */

import {
  allocationRemaining,
  isAllocationComplete,
  normalizeAllocation,
  optionCeiling,
  setAllocationValue,
  type AllocationAnswer,
  type AllocationSpec,
} from "../questions/allocation";

/** Minimal element shape used here — keeps the module free of `lib.dom` assumptions. */
type El = {
  querySelector(sel: string): El | null;
  querySelectorAll(sel: string): ArrayLike<El>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  closest?(sel: string): El | null;
  classList: { add(c: string): void; remove(c: string): void; toggle(c: string, on?: boolean): void };
  style: { setProperty(k: string, v: string): void; left?: string; right?: string };
  getBoundingClientRect(): { left: number; width: number };
  innerHTML: string;
  value?: string;
  disabled?: boolean;
  addEventListener(type: string, cb: (e: never) => void): void;
  removeEventListener(type: string, cb: (e: never) => void): void;
};

/** Percent position of `value` on a track whose scale is the whole budget. */
function percent(value: number, budget: number): string {
  const pct = budget > 0 ? Math.min(100, Math.max(0, (value / budget) * 100)) : 0;
  return `${Math.round(pct * 10) / 10}%`;
}

/** Statement index carried by an element (`data-alloc`), or `null`. */
export function allocIndexOf(el: El | null): number | null {
  const raw = el?.getAttribute("data-alloc");
  if (raw === null || raw === undefined) return null;
  const i = Number(raw);
  return Number.isInteger(i) && i >= 0 ? i : null;
}

/**
 * Patch a rendered group to `answer` WITHOUT replacing any node: values, the moving
 * ceiling of every row, the unreachable tail, the stepper's disabled states and the
 * counter. This is what keeps a drag alive, and it is also what makes the counter update
 * as the thumb moves rather than after it is released.
 */
export function syncAllocationDom(root: El | null | undefined, spec: AllocationSpec, answer: unknown): void {
  if (!root) return;
  const values = normalizeAllocation(spec, answer);
  const remaining = allocationRemaining(spec, values);
  const complete = isAllocationComplete(spec, values);

  const counter = root.querySelector(".ou-alloc__counter");
  if (counter) {
    counter.classList.toggle("is-complete", complete);
    counter.innerHTML = complete
      ? "Вы использовали все баллы"
      : `Осталось: <strong>${remaining}</strong> из ${spec.budget}`;
  }

  const rows = root.querySelectorAll(".ou-alloc__row");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const index = Number(row.getAttribute("data-index"));
    if (!Number.isInteger(index)) continue;
    const value = values[index] ?? spec.minPerOption;
    const ceiling = optionCeiling(spec, values, index);

    // «Выше минимума», не «не ноль»: при предзаполнении отметка соврала бы про выбор.
    row.classList.toggle("is-weighted", value > spec.minPerOption);

    const fill = row.querySelector(".ou-slider__fill");
    if (fill) fill.style.setProperty("right", percent(spec.budget - value, spec.budget));

    const thumb = row.querySelector(".ou-slider__thumb");
    if (thumb) {
      thumb.style.setProperty("left", percent(value, spec.budget));
      thumb.setAttribute("aria-valuenow", String(value));
      thumb.setAttribute("aria-valuemax", String(ceiling));
    }

    const cap = row.querySelector(".ou-alloc__cap");
    if (cap) cap.style.setProperty("left", percent(ceiling, spec.budget));

    const input = row.querySelector(".ou-number__input");
    if (input) input.value = String(value);

    // The stepper's own limits: a disabled button is the honest signal that this row
    // cannot move further, and it is what a mouse user reads before trying.
    const buttons = row.querySelectorAll(".ou-number__btn");
    if (buttons.length >= 2) {
      buttons[0].disabled = value <= spec.minPerOption;
      buttons[1].disabled = value >= ceiling;
    }
  }
}

/** What {@link attachAllocation} needs from its host. */
export interface AllocationHost {
  /** Current spec of the question on screen, or `null` when it is not an allocation. */
  getSpec(): AllocationSpec | null;
  /** Current answer as the host stores it. */
  getAnswer(): unknown;
  /** Called with a COMPLETE answer once a change is final (drag end, step, typing). */
  onCommit(answer: AllocationAnswer): void;
  /** True while the answer is read-only (feedback shown, section frozen). */
  isLocked?(): boolean;
}

/** Detaches every listener {@link attachAllocation} installed. */
export type DetachAllocation = () => void;

/**
 * Wire a rendered group to its host: pointer drag on the track, keyboard on the thumb,
 * the stepper buttons and the number field.
 *
 * Bound ONCE per host on a container that survives re-renders (the shadow root / the
 * document), not per row: rows are replaced on every re-render, and per-row listeners
 * would leak one set per repaint.
 */
export function attachAllocation(root: El, host: AllocationHost): DetachAllocation {
  /** The answer being edited — local during a drag, the host's between gestures. */
  let working: AllocationAnswer | null = null;
  let dragIndex: number | null = null;

  const specNow = (): AllocationSpec | null => (host.isLocked?.() ? null : host.getSpec());
  const answerNow = (): AllocationAnswer | null => {
    const spec = specNow();
    return spec ? working ?? normalizeAllocation(spec, host.getAnswer()) : null;
  };

  /** Value under a pointer at `clientX`, on the row's own track. */
  const valueFromPointer = (row: El, clientX: number, spec: AllocationSpec): number => {
    const rail = row.querySelector(".ou-slider__rail");
    if (!rail) return 0;
    const box = rail.getBoundingClientRect();
    if (!(box.width > 0)) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return Math.round(ratio * spec.budget);
  };

  const apply = (index: number, next: number, commit: boolean): void => {
    const spec = specNow();
    const current = answerNow();
    if (!spec || !current) return;
    const updated = setAllocationValue(spec, current, index, next);
    working = updated;
    syncAllocationDom(root, spec, updated);
    if (commit) {
      working = null;
      host.onCommit(updated);
    }
  };

  const onPointerDown = (e: { target: El | null; clientX: number; pointerId?: number; preventDefault(): void }): void => {
    const spec = specNow();
    if (!spec) return;
    const target = e.target;
    const slider = target?.closest?.(".ou-alloc__slider");
    if (!slider) return;
    const row = target?.closest?.(".ou-alloc__row");
    const index = row ? Number(row.getAttribute("data-index")) : NaN;
    if (!Number.isInteger(index)) return;
    e.preventDefault();
    dragIndex = index;
    working = normalizeAllocation(spec, host.getAnswer());
    apply(index, valueFromPointer(row as El, e.clientX, spec), false);
  };

  const onPointerMove = (e: { clientX: number }): void => {
    if (dragIndex === null) return;
    const spec = specNow();
    if (!spec) return;
    const row = root.querySelector(`.ou-alloc__row[data-index="${dragIndex}"]`);
    if (!row) return;
    apply(dragIndex, valueFromPointer(row, e.clientX, spec), false);
  };

  const onPointerUp = (): void => {
    if (dragIndex === null) return;
    const spec = specNow();
    const pending = working;
    dragIndex = null;
    working = null;
    // The commit happens ONCE, when the finger lifts: only then may the host re-render
    // and replace the nodes the gesture was holding.
    if (spec && pending) host.onCommit(pending);
  };

  const onClick = (e: { target: El | null }): void => {
    const btn = e.target?.closest?.("[data-alloc-step]");
    const raw = btn?.getAttribute("data-alloc-step");
    if (!raw) return;
    const [idxRaw, deltaRaw] = raw.split(":");
    const index = Number(idxRaw);
    const delta = Number(deltaRaw);
    const spec = specNow();
    const current = answerNow();
    if (!spec || !current || !Number.isInteger(index) || !Number.isFinite(delta)) return;
    apply(index, (current[index] ?? spec.minPerOption) + delta, true);
  };

  const onInputChange = (e: { target: El | null }): void => {
    const target = e.target;
    const index = allocIndexOf(target);
    if (index === null || target?.value === undefined) return;
    // A typed value is clamped by the shared model, so «99» becomes the ceiling instead
    // of an error: there is no overshoot state to report (FR-29).
    apply(index, Number(String(target.value).replace(/[^\d-]/g, "")), true);
  };

  const onKeyDown = (e: { target: El | null; key: string; preventDefault(): void }): void => {
    const thumb = e.target?.closest?.(".ou-slider__thumb");
    const index = allocIndexOf(thumb ?? null);
    if (index === null) return;
    const spec = specNow();
    const current = answerNow();
    if (!spec || !current) return;
    const value = current[index] ?? spec.minPerOption;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = value + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = value - 1;
    else if (e.key === "Home") next = spec.minPerOption;
    else if (e.key === "End") next = optionCeiling(spec, current, index);
    if (next === null) return;
    e.preventDefault();
    apply(index, next, true);
  };

  root.addEventListener("pointerdown", onPointerDown as never);
  root.addEventListener("pointermove", onPointerMove as never);
  root.addEventListener("pointerup", onPointerUp as never);
  root.addEventListener("pointercancel", onPointerUp as never);
  root.addEventListener("click", onClick as never);
  root.addEventListener("change", onInputChange as never);
  root.addEventListener("keydown", onKeyDown as never);

  return () => {
    root.removeEventListener("pointerdown", onPointerDown as never);
    root.removeEventListener("pointermove", onPointerMove as never);
    root.removeEventListener("pointerup", onPointerUp as never);
    root.removeEventListener("pointercancel", onPointerUp as never);
    root.removeEventListener("click", onClick as never);
    root.removeEventListener("change", onInputChange as never);
    root.removeEventListener("keydown", onKeyDown as never);
  };
}
