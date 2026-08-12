/**
 * @module pages/__tests__/forgot-password.test
 * @description Tests for the forgot-password page: renders the request form, a
 * successful submit switches to the "link sent" confirmation, a rate-limit (429)
 * raises a destructive toast without leaving the form, and the email-existence
 * probe on blur surfaces the masked address.
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
afterEach(() => vi.unstubAllGlobals());

describe("<ForgotPasswordPage />", () => {
  it("renders the reset-password request form", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("heading", { name: "Сброс пароля" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("shows the confirmation screen after a successful submit", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { maskedEmail: "u***@e.test" }) as unknown as Response);
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@e.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Отправить ссылку|Отправить/ }));
    expect(await screen.findByText("Ссылка отправлена")).toBeInTheDocument();
    expect(screen.getByText("u***@e.test")).toBeInTheDocument();
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

  it("probes email existence on blur and shows the masked address", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(200, { exists: true, maskedEmail: "j***@e.test" }) as unknown as Response,
    );
    render(<ForgotPasswordPage />);
    const input = screen.getByLabelText("Email");
    fireEvent.change(input, { target: { value: "john@e.test" } });
    fireEvent.blur(input);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/check-email", expect.any(Object)));
    expect(await screen.findByText("j***@e.test")).toBeInTheDocument();
  });
});
