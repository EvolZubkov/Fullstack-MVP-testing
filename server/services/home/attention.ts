/**
 * @module server/services/home/attention
 *
 * PRD-25 section 5: the rules behind «Требует внимания». This module derives rows
 * from data the other section builders already produced — it computes nothing on
 * its own, so a rule can never disagree with the card it points at. Callers pass
 * only what the user is allowed to see, which is what keeps the section gated:
 * an ABSENT input key means «that section is not visible to this user», and the
 * section therefore owns no permission check of its own.
 *
 * Wording follows the approved wireframe (`docs/wireframes/approved/prd25-home.html`).
 * Internal vocabulary never reaches the screen — «pool drift» is shown as
 * «Содержимое тем изменилось».
 */
import type {
  AssignedTestItem,
  AttentionItem,
  AttentionKind,
  AttentionSeverity,
  MyTestItem,
} from "@shared/home/contract";

/** Inputs, all optional: an absent key means «that section is not visible». */
export interface AttentionInput {
  /** Assigned tests exactly as «Мне назначено» built them (FR-07). */
  assigned?: AssignedTestItem[];
  /** Authored tests exactly as «Мои тесты» built them, flags included (FR-09). */
  myTests?: MyTestItem[];
  /** Number of same-name topic groups reported by the duplicates report. */
  duplicateTopicGroups?: number;
  /** Number of assignments without a single started attempt (FR-11). */
  assignmentsNotStarted?: number;
}

/** Russian plural pick: 1 группа / 2 группы / 5 групп. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** On-screen text of every test flag, keyed by the flag itself. */
const TEST_FLAG_TEXT: Partial<
  Record<AttentionKind, { title: string; action: string; severity: AttentionSeverity }>
> = {
  "test-empty-draft": {
    title: "Черновик без вопросов",
    action: "Открыть редактор",
    // Warning, not info: the approved wireframe renders this row with the warning
    // tone, and a test that cannot be taken at all is a blocker for its author.
    severity: "warning",
  },
  "test-edited-after-publish": {
    title: "Изменён после публикации",
    action: "Опубликовать заново",
    severity: "warning",
  },
  "test-pool-drift": {
    title: "Содержимое тем изменилось",
    action: "Посмотреть расхождения",
    severity: "warning",
  },
};

/** Subtitle of a retake row: the test, plus the attempts left when they are capped. */
function retakeSubtitle(test: AssignedTestItem): string {
  if (test.maxAttempts === null) return test.title;
  const left = test.maxAttempts - test.completedAttempts;
  return `${test.title} · осталось ${left} ${plural(left, "попытка", "попытки", "попыток")}`;
}

/**
 * Build the attention rows. Returns an empty array when nothing applies — the UI
 * then drops the section entirely, because «Требует внимания» has no empty state
 * (FR-05, FR-17).
 *
 * @param input - already-built section data; an absent key hides its rules.
 * @returns rows ordered warnings-first, then informational ones.
 */
export function buildAttention(input: AttentionInput): AttentionItem[] {
  const rows: AttentionItem[] = [];

  for (const test of input.assigned ?? []) {
    if (test.inProgressAttemptId) {
      rows.push({
        id: `attempt-in-progress:${test.testId}`,
        kind: "attempt-in-progress",
        severity: "info",
        title: "Незавершённая попытка",
        subtitle: test.title,
        href: `/learner/test/${test.testId}`,
        action: "Продолжить",
      });
      // An unfinished attempt is the only thing to do with this test: a retake row
      // next to it would offer to start over what is already running.
      continue;
    }
    // A retake is worth surfacing only when the cooldown is open AND the learner
    // still has attempts left — otherwise the row would offer a dead action.
    const attemptsLeft = test.maxAttempts === null || test.completedAttempts < test.maxAttempts;
    if (test.blockedUntil === null && test.completedAttempts > 0 && attemptsLeft) {
      rows.push({
        id: `retake-available:${test.testId}`,
        kind: "retake-available",
        severity: "info",
        title: "Пересдача доступна",
        subtitle: retakeSubtitle(test),
        href: `/learner/test/${test.testId}`,
        action: "Пройти снова",
      });
    }
  }

  for (const test of input.myTests ?? []) {
    for (const flag of test.flags) {
      const text = TEST_FLAG_TEXT[flag];
      if (!text) continue;
      rows.push({
        id: `${flag}:${test.testId}`,
        kind: flag,
        severity: text.severity,
        title: text.title,
        subtitle: test.title,
        href: "/author/tests",
        action: text.action,
      });
    }
  }

  const duplicates = input.duplicateTopicGroups ?? 0;
  if (duplicates > 0) {
    rows.push({
      id: "topic-duplicates",
      kind: "topic-duplicates",
      severity: "info",
      title: "Дубликаты тем",
      subtitle: `${duplicates} ${plural(duplicates, "группа", "группы", "групп")} совпадающих названий`,
      href: "/author/content",
      action: "Открыть отчёт",
    });
  }

  const notStarted = input.assignmentsNotStarted ?? 0;
  if (notStarted > 0) {
    rows.push({
      id: "assignment-not-started",
      kind: "assignment-not-started",
      severity: "info",
      title: "Назначения без единой попытки",
      subtitle: `${notStarted} ${plural(notStarted, "назначение", "назначения", "назначений")} без начатых попыток`,
      href: "/author/tests",
      action: "Открыть назначения",
    });
  }

  // Warnings first — a test that diverged from its published version outranks a
  // nudge about an open retake.
  return [
    ...rows.filter((r) => r.severity === "warning"),
    ...rows.filter((r) => r.severity === "info"),
  ];
}
