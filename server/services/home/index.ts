/**
 * @module server/services/home/index
 *
 * PRD-25: assembles the payload of `GET /api/home` out of the per-section
 * builders. Two invariants live here and nowhere else.
 *
 * 1. Gating (FR-02): a section builder is not even CALLED unless the user holds
 *    its capability, so an ABSENT key in the payload is proof of an absent right
 *    — not merely a hidden card. Putting the check inside the builders would
 *    make «no right» indistinguishable from «nothing to show».
 * 2. Failure isolation (FR-15): every section is awaited independently, and a
 *    thrown builder becomes `{ failed: true }` for its own key only, leaving the
 *    rest of the page intact. One dead query must not blank the landing screen.
 *
 * Sections run in PARALLEL: they share no state, and the home page is the first
 * screen after login, so its latency is the slowest section rather than their
 * sum. «Требует внимания» is the single exception — it is derived from the
 * already-built sections (`buildAttention` computes nothing itself), so it is
 * assembled after the others have settled.
 */
import { hasPermission, type Capability, type Role } from "@shared/access";
import type { HomePayload, HomeSection } from "@shared/home/contract";
import { sectionData } from "@shared/home/contract";
import { logger } from "../../logger";
import { duplicateNameGroups } from "../topic-access";
import { buildAssigned, buildRecentResults } from "./assigned";
import { buildAttention } from "./attention";
import { buildMaterials } from "./materials";
import { buildMyTests } from "./my-tests";
import { buildMyTopics } from "./my-topics";
import { buildPeople } from "./people";
import { buildQuickActions } from "./quick-actions";
import { buildSummary } from "./summary";

/** Log source of this module, so home failures are filterable on their own. */
const LOG_SOURCE = "home";

/**
 * Run one section builder, turning any failure into the `{ failed: true }`
 * marker of the contract. The error is logged rather than swallowed: the user
 * sees a degraded card, the operator sees the cause.
 *
 * @param name - section key, used in the log line.
 * @param build - the builder to run.
 * @returns the built section, or the failure marker.
 */
async function guard<T>(name: string, build: () => Promise<T>): Promise<HomeSection<T>> {
  try {
    return await build();
  } catch (error) {
    logger.error(`home section "${name}" failed: ${(error as Error).message}`, LOG_SOURCE);
    return { failed: true };
  }
}

/**
 * Build the whole home payload for one user.
 *
 * @param userId - the current session user.
 * @param roles - the effective role set (stored roles plus the runtime
 *   superadmin flag), already resolved by the caller.
 * @returns the payload; keys the user holds no right to are absent entirely.
 */
export async function buildHome(userId: string, roles: readonly Role[]): Promise<HomePayload> {
  const can = (cap: Capability): boolean => hasPermission(roles, cap);
  const payload: HomePayload = {};
  const jobs: Array<Promise<void>> = [];

  if (can("attempts.self.read")) {
    jobs.push(
      guard("assigned", () => buildAssigned(userId)).then((section) => {
        payload.assigned = section;
      }),
      guard("recentResults", () => buildRecentResults(userId)).then((section) => {
        payload.recentResults = section;
      }),
    );
  }
  if (can("tests.read")) {
    jobs.push(
      guard("myTests", () => buildMyTests(userId, roles)).then((section) => {
        payload.myTests = section;
      }),
    );
  }
  if (can("topics.manage")) {
    jobs.push(
      guard("myTopics", () => buildMyTopics(userId, roles)).then((section) => {
        payload.myTopics = section;
      }),
    );
  }
  // Three different jobs land on this section: a manager sees the assignments,
  // an administrator the users, and either right alone is enough to make the
  // counters meaningful.
  if (can("users.read") || can("groups.manage") || can("assignments.manage")) {
    jobs.push(
      guard("peopleAssignments", () => buildPeople()).then((section) => {
        payload.peopleAssignments = section;
      }),
    );
  }
  if (can("analytics.read")) {
    jobs.push(
      guard("summary", () => buildSummary(userId, roles)).then((section) => {
        payload.summary = section;
      }),
    );
  }
  if (can("adminTemplates.manage")) {
    jobs.push(
      guard("materials", () => buildMaterials()).then((section) => {
        payload.materials = section;
      }),
    );
  }

  // The duplicates report feeds ONE attention rule and belongs to the same
  // right as «Мои темы», so it is gated by that right and runs alongside the
  // sections rather than after them.
  let duplicateTopicGroups = 0;
  if (can("topics.manage")) {
    jobs.push(
      guard("topicDuplicates", () => duplicateNameGroups()).then((groups) => {
        duplicateTopicGroups = Array.isArray(groups) ? groups.length : 0;
      }),
    );
  }

  await Promise.all(jobs);

  // FR-06: the section is dropped entirely when the user may perform no action,
  // rather than shown as an empty row of buttons.
  const quickActions = buildQuickActions(roles);
  if (quickActions.length > 0) payload.quickActions = quickActions;

  // FR-05/FR-17: «Требует внимания» has no empty state — an absent key here
  // means «nothing needs attention». Inputs come from the already-built
  // sections, so a section that is absent or failed simply contributes no rows.
  const attention = buildAttention({
    assigned: sectionData(payload.assigned)?.items,
    myTests: sectionData(payload.myTests)?.items,
    duplicateTopicGroups,
    assignmentsNotStarted: sectionData(payload.peopleAssignments)?.notStarted ?? 0,
  });
  if (attention.length > 0) payload.attention = attention;

  return payload;
}
