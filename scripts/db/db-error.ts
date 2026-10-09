/**
 * @module scripts/db/db-error
 *
 * Error helpers shared by the deploy-time database scripts (`migrate`,
 * `reconcile-migration-ledger`). Drizzle wraps a driver failure in «Failed query: …»
 * and keeps the part an operator needs — «no pg_hba.conf entry for host …»,
 * «password authentication failed», ECONNREFUSED, the SQLSTATE — in `cause`, so
 * both helpers walk the cause chain instead of reading only the outer error.
 */

/** How deep the cause chain is followed; drizzle nests two or three levels. */
const MAX_DEPTH = 5;

/**
 * PostgreSQL error code, dug out of however many wrappers drizzle put around it.
 *
 * @param error Anything thrown by drizzle or the `pg` driver.
 * @returns The SQLSTATE (e.g. `42P01`) or a Node error code (e.g. `ECONNREFUSED`).
 */
export function errorCode(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e != null && depth < MAX_DEPTH; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * The message plus every wrapped cause, joined into one line.
 *
 * Printing only `error.message` hid the one thing an operator needs: a deploy once
 * spent an hour blind because the real complaint sat in `cause`.
 *
 * @param error Anything thrown by drizzle or the `pg` driver.
 * @returns Distinct messages of the chain, outermost first, separated by ` | `.
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  const add = (text: string): void => {
    if (text && !parts.includes(text)) parts.push(text);
  };
  for (let e: unknown = error, depth = 0; e != null && depth < MAX_DEPTH; e = (e as { cause?: unknown }).cause, depth++) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string") add(message.trim());
    // A refused TCP connection arrives as an AggregateError with an EMPTY message:
    // Node tried every resolved address (::1 and 127.0.0.1) and keeps each failure
    // — «connect ECONNREFUSED 127.0.0.1:5432» — in `errors`.
    const nested = (e as { errors?: unknown }).errors;
    if (Array.isArray(nested)) {
      for (const inner of nested) {
        const innerMessage = (inner as { message?: unknown })?.message;
        if (typeof innerMessage === "string") add(innerMessage.trim());
      }
    }
  }
  return parts.join(" | ") || String(error);
}
