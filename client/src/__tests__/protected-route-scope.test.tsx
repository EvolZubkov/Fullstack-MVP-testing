/**
 * @module client/src/__tests__/protected-route-scope
 * @description Tests for the restricted-session branch of ProtectedRoute: inside the
 * link's test the page renders, outside it the learner is redirected to the login
 * form, the first-login gate is bypassed, and a scope violation redirects too.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { raiseScopeViolation, resetScopeViolation } from "@/lib/magic-scope";

let currentLocation = "/learner/test/t1";
vi.mock("wouter", () => ({
  useLocation: () => [currentLocation, vi.fn()],
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  Route: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Switch: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const authState = {
  user: null as unknown,
  isLoading: false,
  can: () => true,
};
vi.mock("@/lib/auth", () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ProtectedRoute } from "../App";

const scopedUser = {
  id: "u1",
  gdprConsent: false,
  mustChangePassword: true,
  magicScope: { testId: "t1" },
};

describe("ProtectedRoute under a magic-link session", () => {
  beforeEach(() => {
    resetScopeViolation();
    authState.user = scopedUser;
    currentLocation = "/learner/test/t1";
  });

  it("renders the test page inside the scope and skips the first-login gate", () => {
    render(<ProtectedRoute><div data-testid="page">тест</div></ProtectedRoute>);
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("allows a result page of any attempt — the server decides ownership", () => {
    currentLocation = "/learner/result/at1";
    render(<ProtectedRoute><div data-testid="page">результат</div></ProtectedRoute>);
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("renders the test page with a trailing slash — wouter treats it as the same route", () => {
    currentLocation = "/learner/test/t1/";
    render(<ProtectedRoute><div data-testid="page">тест</div></ProtectedRoute>);
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("allows a result page with a trailing slash", () => {
    currentLocation = "/learner/result/at1/";
    render(<ProtectedRoute><div data-testid="page">результат</div></ProtectedRoute>);
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("redirects a route outside the scope to the login form", () => {
    currentLocation = "/learner/history";
    render(<ProtectedRoute><div data-testid="page">история</div></ProtectedRoute>);
    expect(screen.queryByTestId("page")).toBeNull();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/login");
  });

  it("redirects another test's page", () => {
    currentLocation = "/learner/test/t2";
    render(<ProtectedRoute><div data-testid="page">чужой тест</div></ProtectedRoute>);
    expect(screen.queryByTestId("page")).toBeNull();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/login");
  });

  it("redirects after the API reported a scope violation", () => {
    raiseScopeViolation();
    render(<ProtectedRoute><div data-testid="page">тест</div></ProtectedRoute>);
    expect(screen.queryByTestId("page")).toBeNull();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/login");
  });

  it("keeps the first-login gate for a normal session", () => {
    authState.user = { ...scopedUser, magicScope: null };
    render(<ProtectedRoute><div data-testid="page">тест</div></ProtectedRoute>);
    expect(screen.queryByTestId("page")).toBeNull();
  });
});
