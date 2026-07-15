/**
 * @module pages/__tests__/reset-password.test
 * @description Tests for the reset-password page: the invalid/expired-token
 * screen when no token is present, the token-verification path that reveals the
 * new-password form, a successful reset (success screen), and the error toast
 * when the server rejects the reset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const toast = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/reset-password", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import ResetPasswordPage from "../reset-password";

let fetchMock: ReturnType<typeof vi.fn>;
function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setUrl(search: string) {
  window.history.pushState({}, "", `/reset-password${search}`);
}

beforeEach(() => {
  toast.mockReset();
  fetchMock = vi.fn(async () => jsonRes(200, { valid: true }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setUrl("");
});

describe("<ResetPasswordPage />", () => {
  it("shows the invalid-token screen when no token is present", async () => {
    setUrl("");
    render(<ResetPasswordPage />);
    expect(
      await screen.findByRole("heading", { name: "Недействительная или просроченная ссылка" }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies a token and reveals the new-password form", async () => {
    setUrl("?token=abc123");
    fetchMock.mockResolvedValueOnce(jsonRes(200, { valid: true }) as unknown as Response);
    render(<ResetPasswordPage />);
    expect(await screen.findByLabelText("Новый пароль")).toBeInTheDocument();
    expect(screen.getByLabelText("Подтвердите новый пароль")).toBeInTheDocument();
  });

  it("shows the invalid-token screen when the token is rejected", async () => {
    setUrl("?token=stale");
    fetchMock.mockResolvedValueOnce(jsonRes(200, { valid: false }) as unknown as Response);
    render(<ResetPasswordPage />);
    expect(
      await screen.findByRole("heading", { name: "Недействительная или просроченная ссылка" }),
    ).toBeInTheDocument();
  });

  it("resets the password and shows the success screen", async () => {
    setUrl("?token=good");
    fetchMock.mockResolvedValueOnce(jsonRes(200, { valid: true }) as unknown as Response);
    render(<ResetPasswordPage />);
    await screen.findByLabelText("Новый пароль");
    fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true }) as unknown as Response);
    fireEvent.change(screen.getByLabelText("Новый пароль"), { target: { value: "abcd1234" } });
    fireEvent.change(screen.getByLabelText("Подтвердите новый пароль"), { target: { value: "abcd1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Сброс пароля" }));
    expect(await screen.findByRole("heading", { name: "Пароль успешно изменён" })).toBeInTheDocument();
  });

  it("toasts an error when the reset request fails", async () => {
    setUrl("?token=good");
    fetchMock.mockResolvedValueOnce(jsonRes(200, { valid: true }) as unknown as Response);
    render(<ResetPasswordPage />);
    await screen.findByLabelText("Новый пароль");
    fetchMock.mockResolvedValueOnce(jsonRes(400, { error: "Пароль слишком слабый" }) as unknown as Response);
    fireEvent.change(screen.getByLabelText("Новый пароль"), { target: { value: "abcd1234" } });
    fireEvent.change(screen.getByLabelText("Подтвердите новый пароль"), { target: { value: "abcd1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Сброс пароля" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })),
    );
    expect(screen.queryByRole("heading", { name: "Пароль успешно изменён" })).not.toBeInTheDocument();
  });
});
