/**
 * @module pages/home
 *
 * PRD-25 FR-03: the home page is ONE page rendered in one of two shells. A
 * profile holding any author- or manager-side capability gets the author shell
 * with the sidebar; a pure learner stays in the learner shell.
 *
 * Rebuilding the learner area around the sidebar would be architecturally
 * cleaner, but it is out of this PRD's scope and needs its own wireframes
 * (decision D-5) — so the shell is picked here rather than unified.
 */
import { AuthorLayout } from "@/pages/author/layout";
import { LearnerLayout } from "@/pages/learner/layout";
import { HomePage } from "@/features/home/home-page";
import { useAuth } from "@/lib/auth";
import type { Capability } from "@shared/access";

/**
 * Capabilities that place a user in the author-side shell. Deliberately the same
 * set the author sidebar gates its entries by: a user who can reach ANY of those
 * screens needs the navigation that leads to them.
 */
const AUTHOR_AREA: Capability[] = [
  "tests.read",
  "topics.manage",
  "users.read",
  "groups.manage",
  "analytics.read",
  "adminTemplates.manage",
  "questions.importExport",
  "logs.read",
];

export default function HomeRoute() {
  const { can } = useAuth();
  const Shell = AUTHOR_AREA.some((cap) => can(cap)) ? AuthorLayout : LearnerLayout;
  return (
    <Shell>
      <HomePage />
    </Shell>
  );
}
