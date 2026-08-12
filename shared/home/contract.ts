/**
 * @module shared/home/contract
 *
 * PRD-25: the wire contract of `GET /api/home`. Both hosts import it — the server
 * builds this shape, the React page consumes it — so a section cannot drift
 * between them.
 *
 * Every section is OPTIONAL, and the three possible states of a key are load
 * bearing: an ABSENT key means «the user holds no right to this section» (FR-02),
 * a present `{ failed: true }` means «the section's source errored» (FR-15), and
 * a present payload with empty items means «nothing here yet» (FR-17). Collapsing
 * these into one «empty» state would make a permission boundary indistinguishable
 * from an outage.
 */

/** Severity of an attention row; drives the tone of the DS tag. */
export type AttentionSeverity = "info" | "warning";

/** Machine-readable kind of an attention row (spec section 5). */
export type AttentionKind =
  | "attempt-in-progress"
  | "retake-available"
  | "test-empty-draft"
  | "test-edited-after-publish"
  | "test-pool-drift"
  | "topic-duplicates"
  | "assignment-not-started";

/** One actionable row of the «Требует внимания» section. */
export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  title: string;
  subtitle: string | null;
  href: string;
  action: string;
}

/** One button of the «Быстрые действия» section. */
export interface QuickAction {
  id: string;
  label: string;
  href: string;
}

/** A test the current user is assigned to take. */
export interface AssignedTestItem {
  testId: string;
  title: string;
  description: string | null;
  questionCount: number;
  completedAttempts: number;
  maxAttempts: number | null;
  inProgressAttemptId: string | null;
  /** Set when a cooldown blocks a new attempt (PRD-6); null = may start now. */
  blockedUntil: string | null;
}

/** A finished attempt of the current user. */
export interface RecentResultItem {
  attemptId: string;
  testTitle: string;
  finishedAt: string;
  percent: number;
  passed: boolean | null;
}

/** Publication state of a test as shown on the home page. */
export type HomeTestStatus = "draft" | "published" | "published_with_changes" | "archived";

/** A test the current user owns or has been granted access to. */
export interface MyTestItem {
  testId: string;
  title: string;
  status: HomeTestStatus;
  sectionCount: number;
  questionCount: number;
  updatedAt: string;
  owned: boolean;
  /** Attention kinds raised for this test, so the card can badge itself. */
  flags: AttentionKind[];
  canEdit: boolean;
  canDebug: boolean;
  canExport: boolean;
}

/** A topic the current user owns or may use. */
export interface MyTopicItem {
  topicId: string;
  name: string;
  code: string | null;
  questionCount: number;
  updatedAt: string;
  owned: boolean;
}

/** A section that may be present, absent (no right) or failed (FR-15). */
export type HomeSection<T> = T | { failed: true };

/** The whole payload of `GET /api/home`. */
export interface HomePayload {
  attention?: HomeSection<AttentionItem[]>;
  quickActions?: HomeSection<QuickAction[]>;
  assigned?: HomeSection<{ items: AssignedTestItem[]; total: number }>;
  recentResults?: HomeSection<{ items: RecentResultItem[] }>;
  myTests?: HomeSection<{ items: MyTestItem[]; total: number }>;
  myTopics?: HomeSection<{ items: MyTopicItem[]; total: number }>;
  peopleAssignments?: HomeSection<{ activeAssignments: number; notStarted: number; newUsers7d: number }>;
  summary?: HomeSection<{ attempts30d: number; passRate: number; avgPercent: number; activeUsers: number }>;
  /** `activeTemplates` are NAMES: PRD-3 allows several templates in the `active` state at once. */
  materials?: HomeSection<{ activeTemplates: string[]; docs: Array<{ id: string; label: string; href: string }> }>;
}

/** Narrowing helper: did this section fail to load. */
export function sectionFailed<T>(section: HomeSection<T> | undefined): section is { failed: true } {
  return !!section && typeof section === "object" && (section as { failed?: boolean }).failed === true;
}

/**
 * Narrowing helper: the section's data, or `null` when it is absent or failed.
 * Callers that must tell «absent» from «failed» apart (to choose between hiding
 * the section and rendering a retry state) test the raw key first.
 */
export function sectionData<T>(section: HomeSection<T> | undefined): T | null {
  if (!section || sectionFailed(section)) return null;
  return section as T;
}
