/**
 * @module pages/__tests__/login.test
 * @description Tests for the login page: field validation, a successful sign-in
 * (auth `login` -> success toast -> navigate home), a failed sign-in (error
 * toast, no navigation), and an unexpected error path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigate = vi.fn();
const login = vi.fn();
const logout = vi.fn();
const toast = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/login", navigate],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ login, logout }) }));
vi.mock("@skillum/ui-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@skillum/ui-kit")>()),
  useToast: () => ({ push: toast, dismiss: vi.fn(), clear: vi.fn() }),
}));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));

import LoginPage from "../login";
import { t } from "@/lib/i18n";

beforeEach(() => {
  navigate.mockReset();
  login.mockReset();
  logout.mockReset();
  logout.mockResolvedValue(undefined);
  toast.mockReset();
});
afterEach(() => vi.clearAllMocks());

function fill(email: string, password: string) {
  fireEvent.change(screen.getByTestId("input-email"), { target: { value: email } });
  fireEvent.change(screen.getByTestId("input-password"), { target: { value: password } });
}

describe("<LoginPage />", () => {
  it("renders the sign-in form", () => {
    render(<LoginPage />);
    expect(screen.getByTestId("input-email")).toBeInTheDocument();
    expect(screen.getByTestId("input-password")).toBeInTheDocument();
    expect(screen.getByTestId("button-login")).toBeInTheDocument();
  });

  it("signs in, toasts success and navigates home on valid credentials", async () => {
    login.mockResolvedValue("ok");
    render(<LoginPage />);
    fill("user@e.test", "secret");
    fireEvent.click(screen.getByTestId("button-login"));
    await waitFor(() => expect(login).toHaveBeenCalledWith("user@e.test", "secret"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.any(String) }));
    expect(toast.mock.calls[0][0]).not.toHaveProperty("variant", "destructive");
  });

  it("toasts a destructive error and stays put on bad credentials", async () => {
    login.mockResolvedValue("invalid-credentials");
    render(<LoginPage />);
    fill("user@e.test", "wrong");
    fireEvent.click(screen.getByTestId("button-login"));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "error" })),
    );
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  // A session still holding an invitation link refuses the sign-in itself. Ending
  // that session here is what makes the next attempt succeed — otherwise the only
  // cure is deleting the cookie by hand.
  it("ends the invitation-link session when it is what blocked the sign-in", async () => {
    login.mockResolvedValue("link-scope");
    render(<LoginPage />);
    fill("user@e.test", "right-password");
    fireEvent.click(screen.getByTestId("button-login"));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error", description: t.auth.linkScopeBlocksLogin }),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("toasts a destructive error when login throws", async () => {
    login.mockRejectedValue(new Error("boom"));
    render(<LoginPage />);
    fill("user@e.test", "secret");
    fireEvent.click(screen.getByTestId("button-login"));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "error" })),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
