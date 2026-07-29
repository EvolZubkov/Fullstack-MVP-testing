/**
 * @module lib/report-error
 * @description Single seam for reporting a client-detected failure that the
 * learner must never be asked to interpret.
 *
 * The learner-facing screens show one neutral message («Ошибка сервиса,
 * обратитесь к администратору»); the diagnosis has to reach the people who can
 * act on it, so every such failure is emitted on TWO channels:
 *
 * 1. `console.error` — for whoever has the browser open at that moment;
 * 2. `POST /api/logs/client` — into the server's recent-events buffer, which is
 *    what «Логи» in the author area reads. Without this channel a purely
 *    client-side breakage (a render branch that matches nothing, a screen-template
 *    request the browser could not complete) leaves NO trace anywhere on the
 *    server, which is exactly how an infinite «Подготовка теста...» could sit in
 *    production unnoticed.
 *
 * The report is fire-and-forget: reporting a failure must never itself throw, so
 * the request is not awaited and its own rejection is swallowed.
 */

/**
 * Report a client-detected failure to the console and the server log.
 *
 * @param scope   Short area tag, e.g. `take-test` — prefixes both channels.
 * @param message What broke, in enough detail to act on (no user input, no PII).
 */
export function reportClientError(scope: string, message: string): void {
  // eslint-disable-next-line no-console -- this IS the console channel
  console.error(`[${scope}] ${message}`);
  try {
    void fetch("/api/logs/client", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, message }),
    }).catch(() => {
      /* the log channel is best-effort — never surface its failure */
    });
  } catch {
    /* `fetch` itself unavailable (very old browser / test stub) — console only */
  }
}
