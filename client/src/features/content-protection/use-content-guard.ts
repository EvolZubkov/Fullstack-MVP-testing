/**
 * @module features/content-protection/use-content-guard
 *
 * Orchestrates the PRD-15 block A "guarded" destructive operations on the
 * client (T-12). The agreed flow (wireframe prd15-content-in-use) is dry-run
 * first:
 *
 *   1. Call the operation with `?dryRun=true` — the server assesses impact
 *      without mutating and returns `{ wouldBlock, blocking, warnings }`.
 *   2. `wouldBlock` -> open the BLOCK dialog (admin may force).
 *   3. otherwise, `warnings.length` -> open the WARN confirmation dialog.
 *   4. otherwise -> execute the real operation immediately.
 *
 * Confirming the warn dialog executes the real request; forcing the block
 * dialog (admin) re-issues it with `?force=true`. A real 409 that slips
 * through (content changed between dry-run and execute) re-opens the block
 * dialog. The hook owns the dialog state and returns ready-to-spread props for
 * {@link ContentImpactDialog}.
 */
import { useCallback, useState } from "react";
import { ROLES } from "@shared/access";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import type {
  ContentInUseError,
  DryRunResult,
  TestFeasibility,
} from "./types";
import type { ContentImpactDialogProps, ContentImpactMode } from "./content-impact-dialog";

/** One guarded operation requested by a call site. */
export interface GuardedOperation {
  /** Base URL without query string, e.g. `/api/topics/abc`. */
  url: string;
  method: "DELETE" | "POST" | "PUT";
  body?: unknown;
  /** Dialog copy. */
  blockTitle: string;
  blockDescription?: string;
  warnTitle: string;
  warnDescription?: string;
  confirmLabel: string;
  /** Warn-mode confirm button variant: delete → destructive (default), edit → primary. */
  confirmVariant?: "primary" | "destructive";
  /**
   * Gate for the no-impact case: when the dry-run finds nothing to block or
   * warn about, this is asked before executing (e.g. a plain "delete?"
   * confirm). Returning false aborts. Omit to execute directly.
   */
  confirmClean?: () => boolean;
  /** Called after the real operation succeeds. */
  onDone: () => void;
}

interface DialogState {
  open: boolean;
  mode: ContentImpactMode;
  tests: TestFeasibility[];
  pending: boolean;
}

const CLOSED: DialogState = { open: false, mode: "block", tests: [], pending: false };

function withQuery(url: string, param: string): string {
  return url + (url.includes("?") ? "&" : "?") + param;
}

async function postJson(url: string, method: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
}

export interface UseContentGuardResult {
  /** Start a guarded operation (dry-run first). */
  guard: (op: GuardedOperation) => Promise<void>;
  /** Props to spread into <ContentImpactDialog>. */
  dialogProps: Pick<
    ContentImpactDialogProps,
    | "open"
    | "mode"
    | "title"
    | "description"
    | "tests"
    | "canForce"
    | "confirmLabel"
    | "confirmVariant"
    | "pending"
    | "currentUserId"
    | "onClose"
    | "onConfirm"
    | "onForce"
  >;
}

export function useContentGuard(): UseContentGuardResult {
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<DialogState>(CLOSED);
  const [op, setOp] = useState<GuardedOperation | null>(null);

  const canForce = hasRole(ROLES.ADMINISTRATOR) || hasRole(ROLES.SUPERADMIN);

  const close = useCallback(() => {
    setState(CLOSED);
    setOp(null);
  }, []);

  /** Execute the real (non-dry-run) operation, optionally forced. */
  const execute = useCallback(
    async (operation: GuardedOperation, force: boolean) => {
      setState((s) => ({ ...s, pending: true }));
      try {
        const url = force ? withQuery(operation.url, "force=true") : operation.url;
        const res = await postJson(url, operation.method, operation.body);
        if (res.status === 409) {
          // Race: content gained a published dependent since the dry-run.
          const payload = (await res.json()) as ContentInUseError;
          setState({ open: true, mode: "block", tests: payload.blocking ?? [], pending: false });
          return;
        }
        if (res.status === 403) {
          const payload = await res.json().catch(() => ({}));
          toast({
            variant: "destructive",
            title: "Недостаточно прав",
            description:
              (payload as { message?: string }).message ??
              "Изменять или удалять этот элемент может его создатель или администратор",
          });
          close();
          return;
        }
        if (!res.ok) throw new Error(`${res.status}`);
        close();
        operation.onDone();
      } catch (e) {
        setState((s) => ({ ...s, pending: false }));
        toast({ variant: "destructive", title: "Ошибка", description: "Операция не выполнена" });
      }
    },
    [close, toast],
  );

  const guard = useCallback(
    async (operation: GuardedOperation) => {
      setOp(operation);
      try {
        const res = await postJson(
          withQuery(operation.url, "dryRun=true"),
          operation.method,
          operation.body,
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const result = (await res.json()) as DryRunResult;
        if (result.wouldBlock) {
          setState({ open: true, mode: "block", tests: result.blocking ?? [], pending: false });
        } else if ((result.warnings ?? []).length > 0) {
          setState({ open: true, mode: "warn", tests: result.warnings ?? [], pending: false });
        } else if (!operation.confirmClean || operation.confirmClean()) {
          await execute(operation, false);
        } else {
          setOp(null);
        }
      } catch (e) {
        toast({ variant: "destructive", title: "Ошибка", description: "Не удалось проверить операцию" });
        setOp(null);
      }
    },
    [execute, toast],
  );

  return {
    guard,
    dialogProps: {
      open: state.open,
      mode: state.mode,
      title: state.mode === "warn" ? (op?.warnTitle ?? "") : (op?.blockTitle ?? ""),
      description: state.mode === "warn" ? op?.warnDescription : op?.blockDescription,
      tests: state.tests,
      canForce,
      confirmLabel: op?.confirmLabel,
      confirmVariant: op?.confirmVariant ?? "destructive",
      pending: state.pending,
      currentUserId: user?.id,
      onClose: close,
      onConfirm: () => op && execute(op, false),
      onForce: () => op && execute(op, true),
    },
  };
}
