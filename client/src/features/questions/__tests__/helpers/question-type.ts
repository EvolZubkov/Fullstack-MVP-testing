/**
 * @module features/questions/__tests__/helpers/question-type
 * @description Test helper driving the question-type Select of the editor
 * drawer. The control used to be a SegmentedControl whose buttons were clicked
 * directly; a Select needs the listbox opened first, so the two-step sequence
 * lives here instead of being repeated in every drawer spec.
 */
import { fireEvent, screen, within } from "@testing-library/react";

/** Opens the question-type listbox (no-op if it is already open). */
export function openQuestionTypeSelect(): void {
  const select = screen.getByTestId("select-question-type");
  const trigger = within(select).getByRole("button");
  if (trigger.getAttribute("aria-expanded") === "true") return;
  fireEvent.click(trigger);
}

/** Opens the listbox and picks the type whose visible label matches. */
export function chooseQuestionType(label: string): void {
  openQuestionTypeSelect();
  fireEvent.click(screen.getByRole("option", { name: label }));
}

/** Labels of every type the drawer offers, in listbox order. */
export function questionTypeOptions(): string[] {
  openQuestionTypeSelect();
  return screen.getAllByRole("option").map((option) => option.textContent ?? "");
}
