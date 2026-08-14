/**
 * @module pages/__tests__/forgot-password.test
 * @description Tests for the forgot-password page: renders the request form, a
 * successful submit switches to the "link sent" confirmation, a rate-limit (429)
 * raises a destructive toast without leaving the form, and — the account-
 * enumeration guard — the screen never discloses whether the address exists: it
 * probes no existence endpoint and shows one and the same neutral confirmation
 * whatever the server replies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const toast = vi.fn();
vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import ForgotPasswordPage from "../forgot-password";

let fetchMock: ReturnType<typeof vi.fn>;
function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  toast.mockReset();
  fetchMock = vi.fn(async () => jsonRes(200, {}) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  // The page reads `?email=` off the location at render, so a test that sets it
  // must not leak the query into the next one.
  window.history.replaceState({}, "", "/");
});

describe("<ForgotPasswordPage />", () => {
  it("renders the reset-password request form", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("heading", { name: "Сброс пароля" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("shows the confirmation screen after a successful submit", async () => {
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@e.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Отправить ссылку|Отправить/ }));
    expect(await screen.findByText("Ссылка отправлена")).toBeInTheDocument();
    expect(
      screen.getByText(/Если аккаунт с таким email существует/),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/forgot-password", expect.any(Object));
  });

  it("keeps the confirmation neutral even if the reply carries a masked address", async () => {
    // A masked address in the reply names the mailbox and thereby confirms the
    // account exists; the screen must not put it on the page.
    fetchMock.mockResolvedValueOnce(
      jsonRes(200, { success: true, maskedEmail: "u***@e.test", hint: "u***@e.test" }) as unknown as Response,
    );
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@e.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Отправить ссылку|Отправить/ }));
    expect(await screen.findByText("Ссылка отправлена")).toBeInTheDocument();
    expect(screen.queryByText("u***@e.test")).not.toBeInTheDocument();
  });

  it("raises a destructive toast on a 429 and stays on the form", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(429, {}) as unknown as Response);
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@e.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Отправить/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })),
    );
    expect(screen.queryByText("Ссылка отправлена")).not.toBeInTheDocument();
  });

  it("does not probe whether the address exists — neither on blur nor on load", async () => {
    // The removed `POST /api/auth/check-email` answered `{exists}` to anyone; no
    // request of any kind may go out before the form is actually submitted.
    window.history.replaceState({}, "", "/forgot-password?email=john@e.test");
    render(<ForgotPasswordPage />);
    const input = screen.getByLabelText("Email");
    fireEvent.change(input, { target: { value: "john@e.test" } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("john@e.test"));
    expect(fetchMock).not.toHaveBeenCalled();

    // And the address the screen was opened with is never echoed back as a
    // masked hint: the form text stays the generic invitation to enter one.
    expect(screen.getByText("Введите ваш email для получения ссылки на сброс пароля")).toBeInTheDocument();
  });
});
