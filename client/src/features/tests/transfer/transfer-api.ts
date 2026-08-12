/**
 * @module features/tests/transfer/transfer-api
 *
 * The three steps of a selective import as the client sees them (PRD-48 §5).
 *
 * The shapes mirror the server's (`server/services/test-transfer/{inspect,diff}.ts`) and are
 * declared rather than imported: the client bundle must not pull server modules in. They are
 * read-only here — the client never composes operations, it sends the author's CHOICE and the
 * server recomputes what that choice means.
 */

/** How a topic of the package meets this installation. */
export type TransferTopicState = "new" | "existing" | "foreign";

export interface TransferTopicSummary {
  id: string;
  name: string;
  questions: number;
  state: TransferTopicState;
}

/** The inventory of the five parts, in the order the form shows them. */
export interface TransferParts {
  structure: { sections: number; topics: number; questions: number };
  scoring: { overrides: number; hasPassRule: boolean };
  scales: { scales: number; measurements: number; resultVariables: number };
  results: { contentPages: number };
  media: { files: number };
}

export interface TransferInspection {
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  test: { id: string; title: string; exists: boolean };
  parts: TransferParts;
  topics: TransferTopicSummary[];
  missingMedia: string[];
}

export type PartName = keyof TransferParts;
export type PartMode = "upsert" | "replace";
export type TopicPolicy = "merge" | "new" | "replace";

export interface TransferOptions {
  parts: Record<PartName, boolean>;
  modes: { scoring: PartMode; scales: PartMode };
  topics: Record<string, TopicPolicy>;
}

export interface TransferOperation {
  kind: "create" | "update" | "delete";
  entity: string;
  id: string;
  sourceId?: string;
  title: string;
  usedInAttempts?: boolean;
}

export interface TransferApplyReport {
  testId: string;
  created: Record<string, number>;
  updated: Record<string, number>;
  deleted: Record<string, number>;
  renamedTopics: string[];
  mediaReused: number;
  mediaCreated: number;
  missingMedia: string[];
}

/** Reads the server's answer, surfacing its message rather than a generic failure. */
async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message = `Ошибка ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    /* keep the status-based message */
  }
  throw new Error(message);
}

/** Step 1: read the package, write nothing, receive the token the next steps use. */
export async function inspectTransferPackage(
  file: File,
): Promise<{ token: string; summary: TransferInspection }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/tests/transfer/inspect", {
    method: "POST",
    body: form,
    credentials: "include",
  });
  return unwrap(res);
}

/** Step 2: what the chosen options WOULD do. Recomputed on every change. */
export async function planTransferImport(
  token: string,
  options: TransferOptions,
): Promise<{ operations: TransferOperation[]; summary: TransferInspection }> {
  const res = await fetch("/api/tests/transfer/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, ...options }),
    credentials: "include",
  });
  return unwrap(res);
}

/** Step 3: apply. The server recomputes the plan from the same package before writing. */
export async function applyTransferImport(
  token: string,
  options: TransferOptions,
): Promise<TransferApplyReport> {
  const res = await fetch("/api/tests/transfer/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, ...options }),
    credentials: "include",
  });
  return unwrap(res);
}
