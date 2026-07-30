/**
 * @module pages/__tests__/home
 *
 * PRD-25 FR-03: the home page is one page rendered in one of two shells. The rule
 * is easy to break silently — a learner wrongly placed in the author shell would
 * be shown navigation to screens they cannot open, and an author left in the
 * learner shell would lose the sidebar entirely.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Capability } from "@shared/access";

const { canMock } = vi.hoisted(() => ({ canMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: canMock }) }));
vi.mock("@/pages/author/layout", () => ({
  AuthorLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell-author">{children}</div>
  ),
}));
vi.mock("@/pages/learner/layout", () => ({
  LearnerLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell-learner">{children}</div>
  ),
}));
vi.mock("@/features/home/home-page", () => ({
  HomePage: () => <div data-testid="home-body" />,
}));

import HomeRoute from "../home";

/** Grant exactly the listed capabilities and nothing else. */
function grant(...caps: Capability[]) {
  canMock.mockImplementation((cap: Capability) => caps.includes(cap));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HomeRoute — выбор оболочки", () => {
  it("оставляет чистого учащегося в учебной оболочке", () => {
    grant("auth.self", "attempts.take", "attempts.self.read");

    render(<HomeRoute />);

    expect(screen.getByTestId("shell-learner")).toBeInTheDocument();
    expect(screen.queryByTestId("shell-author")).not.toBeInTheDocument();
    expect(screen.getByTestId("home-body")).toBeInTheDocument();
  });

  it("даёт автору авторскую оболочку с боковым меню", () => {
    grant("attempts.self.read", "tests.read", "topics.manage");

    render(<HomeRoute />);

    expect(screen.getByTestId("shell-author")).toBeInTheDocument();
  });

  it("даёт менеджеру авторскую оболочку — ему доступны пользователи", () => {
    grant("attempts.self.read", "users.read");

    render(<HomeRoute />);

    expect(screen.getByTestId("shell-author")).toBeInTheDocument();
  });

  it("одного авторского права достаточно для авторской оболочки", () => {
    grant("logs.read");

    render(<HomeRoute />);

    expect(screen.getByTestId("shell-author")).toBeInTheDocument();
  });

  it("учётная запись без единого права всё равно получает страницу, а не пустоту", () => {
    grant();

    render(<HomeRoute />);

    expect(screen.getByTestId("shell-learner")).toBeInTheDocument();
    expect(screen.getByTestId("home-body")).toBeInTheDocument();
  });
});
