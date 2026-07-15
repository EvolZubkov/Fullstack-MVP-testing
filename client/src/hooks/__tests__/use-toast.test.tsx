/**
 * @module hooks/__tests__/use-toast.test
 * @description Tests for the legacy shadcn -> ui-kit toast adapter. Verifies the
 * silent no-op when no provider is mounted, the stable hook return, and — once a
 * <ToastProvider>/<ToastBridge> pair is mounted — that `toast()` pushes through
 * the design-system queue with the correct legacy-variant -> tone mapping and can
 * be dismissed.
 */
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@universityrt/ui-kit";
import { ToastBridge, toast, useToast } from "../use-toast";

afterEach(() => {
  // Drain any toast the module-level queue might still hold between tests.
  useToast().dismiss();
});

describe("use-toast (no provider mounted)", () => {
  it("toast() is a silent no-op returning an empty handle", () => {
    const handle = toast({ title: "Ignored" });
    expect(handle.id).toBe("");
    // Calling dismiss on the no-op handle must not throw.
    expect(() => handle.dismiss()).not.toThrow();
  });

  it("useToast() returns stable toast + dismiss functions", () => {
    const { result, rerender } = renderHook(() => useToast());
    const first = result.current;
    rerender();
    expect(result.current.toast).toBe(first.toast);
    expect(result.current.dismiss).toBe(first.dismiss);
    expect(result.current.toast).toBe(toast);
  });
});

describe("use-toast (provider mounted via ToastBridge)", () => {
  async function mountBridge() {
    render(
      <ToastProvider>
        <ToastBridge />
      </ToastProvider>,
    );
    // The bridge publishes the ds API in an effect; wait until a push works.
    await waitFor(() => {
      const h = toast({ title: "__probe__", duration: 0 });
      expect(h.id).not.toBe("");
      h.dismiss();
    });
  }

  it("pushes a toast that renders and returns a non-empty handle", async () => {
    await mountBridge();
    let handle: ReturnType<typeof toast> = { id: "", dismiss: () => {} };
    act(() => {
      handle = toast({ title: "Сохранено", description: "Готово", duration: 0 });
    });
    expect(handle.id).not.toBe("");
    expect(await screen.findByText("Сохранено")).toBeInTheDocument();
    expect(screen.getByText("Готово")).toBeInTheDocument();
  });

  it("maps the legacy 'destructive' variant to the error tone", async () => {
    await mountBridge();
    act(() => {
      toast({ title: "Ошибка сети", variant: "destructive", duration: 0 });
    });
    const node = await screen.findByText("Ошибка сети");
    expect(node.closest(".ou-toast--error")).not.toBeNull();
  });

  it("maps an omitted variant to the success tone", async () => {
    await mountBridge();
    act(() => {
      toast({ title: "Успех", duration: 0 });
    });
    const node = await screen.findByText("Успех");
    expect(node.closest(".ou-toast--success")).not.toBeNull();
  });

  it("dismiss(id) removes a specific toast", async () => {
    await mountBridge();
    let handle: ReturnType<typeof toast> = { id: "", dismiss: () => {} };
    act(() => {
      handle = toast({ title: "Исчезну", duration: 0 });
    });
    expect(await screen.findByText("Исчезну")).toBeInTheDocument();
    act(() => handle.dismiss());
    await waitFor(() => expect(screen.queryByText("Исчезну")).not.toBeInTheDocument());
  });
});
