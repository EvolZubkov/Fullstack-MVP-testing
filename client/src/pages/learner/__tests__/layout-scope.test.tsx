/**
 * @module client/src/pages/learner/__tests__/layout-scope
 * @description Tests that the learner header offers no navigation a magic-link
 * session cannot follow: the Home/Tests/History cluster disappears and the logo
 * stops linking to the test list, while logout stays available.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LearnerLayout } from "../layout";
import { t } from "@/lib/i18n";

vi.mock("wouter", () => ({
  useLocation: () => ["/learner/test/t1", vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

// ThemeToggle reads its state from ThemeProvider context, which this test does
// not mount; stub it out so the unrelated "must be used within a ThemeProvider"
// throw does not mask the assertions this test actually cares about.
vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button data-testid="button-theme-toggle" type="button" />,
}));

const authState = { user: { id: "u1", name: "Ученик" } as Record<string, unknown>, logout: vi.fn() };
vi.mock("@/lib/auth", () => ({ useAuth: () => authState }));

describe("LearnerLayout under a magic-link session", () => {
  it("renders the navigation for a normal session", () => {
    authState.user = { id: "u1", name: "Ученик", magicScope: null };
    render(<LearnerLayout><div /></LearnerLayout>);
    expect(screen.getByTestId("link-home")).toBeInTheDocument();
    expect(screen.getByTestId("link-tests")).toBeInTheDocument();
    expect(screen.getByTestId("link-history")).toBeInTheDocument();
    // The logo itself must be a link ("/learner") in an unrestricted session.
    // The wouter mock renders `Link` as a plain `<a href>`, so all four `Link`
    // instances in this branch — the logo plus the three nav buttons ("/",
    // "/learner", "/learner/history") — surface as role="link": 4 in total.
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByRole("link", { name: t.navigation.testCenter })).toHaveAttribute("href", "/learner");
  });

  it("hides every navigation target for a restricted session", () => {
    authState.user = { id: "u1", name: "Ученик", magicScope: { testId: "t1" } };
    render(<LearnerLayout><div /></LearnerLayout>);
    expect(screen.queryByTestId("link-home")).toBeNull();
    expect(screen.queryByTestId("link-tests")).toBeNull();
    expect(screen.queryByTestId("link-history")).toBeNull();
    expect(screen.getByTestId("button-logout")).toBeInTheDocument();
    // Regression guard: the logo must not be re-wrapped in a `Link` (the exact
    // defect this task fixed — a magic-link session could otherwise reach the
    // test list through the logo and bounce to /login). With the nav cluster
    // also gone, no `Link` at all should remain in a restricted header.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
