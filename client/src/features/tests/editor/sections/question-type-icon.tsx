/**
 * @module features/tests/editor/sections/question-type-icon
 * @description Question-type pictogram — the one convention shared by the editor's
 * question lists (the «Оценка» table and the «Вклады вопросов» cards) and the content
 * tree. The maps used to live inside `scoring-section`; the wireframe puts the same
 * pictogram in front of a contribution card's title, and a second copy of the
 * type -> icon mapping would have started drifting on the first new question type.
 */

import {
  CheckSquare,
  CircleDot,
  ListOrdered,
  SlidersHorizontal,
  TextCursorInput,
  ThermometerSun,
  Unplug,
  type LucideIcon,
  Braces,
  MonitorPlay,
  Pilcrow,
} from "lucide-react";

import type { QuestionType } from "@shared/questions/question-type";
import { t } from "@/lib/i18n";

/** Question-type pictograms — same convention as the content tree (content-tree.tsx). */
export const QUESTION_TYPE_ICON: Record<QuestionType, LucideIcon> = {
  single: CircleDot,
  multiple: CheckSquare,
  matching: Unplug,
  ranking: ListOrdered,
  scale: ThermometerSun,
  allocation: SlidersHorizontal,
  short: TextCursorInput,
  blanks: Braces,
  long: Pilcrow,
  simulation: MonitorPlay,
};

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  single: t.questions.singleChoice,
  multiple: t.questions.multipleChoice,
  matching: t.questions.matching,
  ranking: t.questions.ranking,
  scale: t.questions.scaleChoice,
  allocation: t.questions.allocation,
  short: t.questions.shortAnswer,
  blanks: t.questions.blanks,
  long: t.questions.longAnswer,
  simulation: t.questions.simulation,
};

/**
 * The pictogram as it appears in front of a question's title. `aria-label` on the
 * wrapper, not on the glyph: the type is the only thing this element says, and a
 * screen reader has no other way to hear it.
 */
export function QuestionTypeIcon({ type, size = 16 }: { type: QuestionType; size?: number }) {
  const Icon = QUESTION_TYPE_ICON[type] ?? CircleDot;
  const label = QUESTION_TYPE_LABEL[type] ?? type;
  return (
    <span className="tb-qscoring__qtype" title={label} aria-label={label}>
      <Icon width={size} height={size} aria-hidden="true" />
    </span>
  );
}
