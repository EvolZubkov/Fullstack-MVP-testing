/**
 * @module pages/__tests__/first-login.test
 * @description Tests for the first-login completion page (PRD-13 GDPR + forced
 * password change): the password fields appear only when a change is required, a
 * successful completion refreshes the user and navigates home, and a server
 * rejection raises a destructive toast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigate = vi.fn();
const refreshUser = vi.fn().mockResolvedValue(undefined);
const toast = vi.fn();

vi.mock("wouter", () => ({ useLocation: () => ["/first-login", navigate] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ refreshUser }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import FirstLoginPage from "../first-login";

let fetchMock: ReturnType<typeof vi.fn>;
function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  navigate.mockReset();
  refreshUser.mockClear();
  toast.mockReset();
  fetchMock = vi.fn(async () => jsonRes(200, { ok: true }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("<FirstLoginPage />", () => {
  it("hides the password fields when no change is required", () => {
    render(<FirstLoginPage mustChangePassword={false} />);
    expect(screen.getByRole("heading", { name: "Завершение регистрации" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Новый пароль")).not.toBeInTheDocument();
  });

  it("shows the password fields when a change is required", () => {
    render(<FirstLoginPage mustChangePassword />);
    expect(screen.getByLabelText("Новый пароль")).toBeInTheDocument();
    expect(screen.getByLabelText("Подтвердите новый пароль")).toBeInTheDocument();
  });

  it("completes registration, refreshes the user and navigates home", async () => {
    render(<FirstLoginPage mustChangePassword={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Завершить регистрацию/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/complete-first-login", expect.any(Object)),
    );
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("submits the chosen password when a change is required", async () => {
    render(<FirstLoginPage mustChangePassword />);
    fireEvent.change(screen.getByLabelText("Новый пароль"), { target: { value: "abcd1234" } });
    fireEvent.change(screen.getByLabelText("Подтвердите новый пароль"), { target: { value: "abcd1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Завершить регистрацию/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.newPassword).toBe("abcd1234");
    expect(body.gdprConsent).toBe(true);
  });

  it("toasts a destructive error when the server rejects", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(400, { error: "Слабый пароль" }) as unknown as Response);
    render(<FirstLoginPage mustChangePassword={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Завершить регистрацию/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
