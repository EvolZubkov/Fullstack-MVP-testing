/**
 * @module hooks/use-toast
 *
 * Compatibility adapter that maps the legacy shadcn `useToast()` API onto the
 * design-system toast system (`@universityrt/ui-kit`). Existing call sites keep
 * using `const { toast } = useToast(); toast({ title, description, variant })`
 * unchanged; under the hood the notification is pushed through the ui-kit
 * `ToastProvider` queue mounted once in `App`.
 *
 * Bridging is done via a module-level reference to the provider API, registered
 * by the `<ToastBridge>` component (mounted inside `<ToastProvider>`). This
 * keeps two legacy guarantees that the ui-kit hook does not provide on its own:
 *  - `toast()` is callable as a plain function (no hook/provider lookup at the
 *    call site), and
 *  - calling it outside a mounted provider (e.g. in unit tests that render a
 *    toast-using component without the app shell) degrades to a silent no-op
 *    instead of throwing.
 *
 * Variant -> tone mapping: legacy "destructive" -> "error"; legacy "default"
 * (and an omitted variant) -> "success", because every legacy call site that
 * omits a variant is a success confirmation. Explicit design-system tones
 * ("success" | "info" | "warning" | "error") are also accepted and passed
 * through, so new call sites can opt into the full tone set.
 */
import * as React from "react";
import { useToast as useDsToast, type ToastTone } from "@universityrt/ui-kit";

/**
 * Accepted toast variant: the legacy shadcn pair plus the design-system tones.
 * Legacy call sites pass "default"/"destructive"; new ones may pass a tone.
 */
type ToastVariant = "default" | "destructive" | ToastTone;

/** Input accepted by the legacy `toast()` function. */
export interface ToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms; falls back to the provider default when omitted. */
  duration?: number;
}

/** Handle returned by `toast()` for imperative dismissal. */
export interface ToastHandle {
  id: string;
  dismiss: () => void;
}

type DsToastApi = ReturnType<typeof useDsToast>;

/** Live reference to the ui-kit toast queue, set while a provider is mounted. */
let dsApi: DsToastApi | null = null;

function toTone(variant?: ToastVariant): ToastTone {
  switch (variant) {
    case "destructive":
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
    // "default" | "success" | undefined: legacy no-variant calls are all
    // success confirmations, so they render with the success tone.
    default:
      return "success";
  }
}

/**
 * Bridge component: grabs the ui-kit toast API from context and publishes it to
 * the module-level reference so the plain `toast()` function can reach it.
 * Rendered once inside `<ToastProvider>` in `App`; renders nothing.
 */
export function ToastBridge(): null {
  const api = useDsToast();
  React.useEffect(() => {
    dsApi = api;
    return () => {
      if (dsApi === api) dsApi = null;
    };
  }, [api]);
  return null;
}

/** Push a toast through the design-system queue (no-op when no provider mounted). */
export function toast(input: ToastInput): ToastHandle {
  if (!dsApi) return { id: "", dismiss: () => {} };
  const id = dsApi.push({
    tone: toTone(input.variant),
    title: input.title,
    description: input.description,
    duration: input.duration,
  });
  const api = dsApi;
  return { id, dismiss: () => api.dismiss(id) };
}

/** Dismiss a toast by id, or clear all toasts when called without an id. */
function dismiss(id?: string): void {
  if (!dsApi) return;
  if (id) dsApi.dismiss(id);
  else dsApi.clear();
}

/**
 * Drop-in replacement for the former shadcn hook. Returns a stable `toast`
 * function plus `dismiss`. Both are module-level functions, so the returned
 * object is referentially stable across renders.
 */
export function useToast(): { toast: typeof toast; dismiss: typeof dismiss } {
  return { toast, dismiss };
}
