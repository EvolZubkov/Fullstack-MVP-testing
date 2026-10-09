/**
 * @module shared/questions/question-label
 *
 * The name a list shows for a question.
 *
 * For every type it is the text of the task. A «Сценарий в ИС» question is the exception: its
 * task is a paragraph of instructions, while the scenario has a title of its own
 * (`meta.title`) — the name the author gave it and the one the bank shows
 * (`docs/wireframes/sim-scenario-question.html`). Lists that name questions take the label
 * from here, so the rule is written once.
 */
import { isSimulation } from "./question-type";

/** The fields of a question the label reads. */
export interface LabelledQuestion {
  type: string;
  prompt: string;
  dataJson?: unknown;
}

/** The name of a question in a list. */
export function questionLabel(question: LabelledQuestion): string {
  if (isSimulation(question.type)) {
    const title = (question.dataJson as { scenario?: { meta?: { title?: unknown } } } | null | undefined)?.scenario?.meta?.title;
    if (typeof title === "string" && title.trim()) return title;
  }
  return question.prompt;
}
