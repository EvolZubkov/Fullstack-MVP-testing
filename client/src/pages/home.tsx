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
import { Box } from "@universityrt/ui-kit";
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
  const inAuthorArea = AUTHOR_AREA.some((cap) => can(cap));

  // Page padding differs by shell, so it belongs here — the only place that knows
  // which shell is in play. The author shell already pads `.ou-shell__main`, and
  // its pages (см. «Темы и вопросы», «Тесты») add none of their own; adding one
  // here would inset the home page deeper than every other author screen. The
  // learner shell pads nothing, so its pages carry their own — matched to the
  // learner test list.
  if (inAuthorArea) {
    return (
      <AuthorLayout>
        <HomePage />
      </AuthorLayout>
    );
  }
  return (
    <LearnerLayout>
      <Box padX={6} padY={8}>
        <HomePage />
      </Box>
    </LearnerLayout>
  );
}
