/**
 * @module server/middleware/magic-scope-rules
 * @description The allow-list for a magic-link session and its path matcher. A
 * session opened through `/access/:token` may reach ONLY what this table names:
 * anything absent is denied, so a newly added route is closed until someone puts
 * it here deliberately. Keeping the whole scope in one file is the point — it is
 * reviewable at a glance.
 *
 * `bind` says what the guard must additionally verify:
 *   - `none`    — no object binding (session-level routes);
 *   - `test`    — the captured `testId` must equal the session's magic test;
 *   - `attempt` — the captured `attemptId` must be an attempt of that test owned
 *                 by the session user.
 *
 * A trailing `*` segment matches the REST of the path — used only where the route
 * itself takes a file path (template assets). It never spans a bind, so the widening
 * stays confined to one route.
 */

/** How a matched route is bound to the session's magic scope. */
export type MagicScopeBind = "none" | "test" | "attempt";

/** One entry of the allow-list. */
export interface MagicScopeRule {
  method: string;
  /** Path pattern; a `:name` segment captures a parameter. */
  pattern: string;
  bind: MagicScopeBind;
}

/** A matched rule together with the captured path parameters. */
export interface MagicScopeMatch {
  rule: MagicScopeRule;
  params: Record<string, string>;
}

/**
 * Everything a magic-link session may call. Ordered by area: session, the test's
 * own metadata and templates, the attempt lifecycle, the attempt report assets.
 */
export const MAGIC_SCOPE_RULES: MagicScopeRule[] = [
  { method: "GET", pattern: "/api/auth/me", bind: "none" },
  { method: "POST", pattern: "/api/auth/logout", bind: "none" },
  // The route handler itself narrows the payload down to the magic test; see
  // `server/routes/attempts.ts` (covered by `tests/routes.attempts-tests.test.ts`)
  // for where that narrowing is actually enforced.
  { method: "GET", pattern: "/api/learner/tests", bind: "none" },
  { method: "GET", pattern: "/api/tests/:testId/screen-template/:screen", bind: "test" },
  { method: "POST", pattern: "/api/tests/:testId/attempts/start", bind: "test" },
  { method: "POST", pattern: "/api/tests/:testId/attempts/start-adaptive", bind: "test" },
  { method: "GET", pattern: "/api/tests/:testId/resume", bind: "test" },
  { method: "POST", pattern: "/api/attempts/:attemptId/save-progress", bind: "attempt" },
  { method: "POST", pattern: "/api/attempts/:attemptId/section-timer", bind: "attempt" },
  { method: "POST", pattern: "/api/attempts/:attemptId/section-result", bind: "attempt" },
  { method: "POST", pattern: "/api/attempts/:attemptId/finish", bind: "attempt" },
  { method: "POST", pattern: "/api/attempts/:attemptId/answer-adaptive", bind: "attempt" },
  { method: "POST", pattern: "/api/attempts/:attemptId/expire-topic-adaptive", bind: "attempt" },
  { method: "GET", pattern: "/api/attempts/:attemptId/result", bind: "attempt" },
  { method: "GET", pattern: "/api/report/lib/:file", bind: "none" },
  // PRD-27 FR-05: подложка и логотип отчёта — файлы ШАБЛОНА, а не ассеты продукта
  // (прежний `/api/report/asset/:file` удалён вместе с ними). Без этой строки ученик,
  // пришедший по ссылке-приглашению, скачал бы отчёт без оформления.
  { method: "GET", pattern: "/api/templates/:templateId/assets/*", bind: "none" },
];

function splitPath(value: string): string[] {
  return value.split("/").filter(Boolean);
}

/**
 * Find the rule covering `method` plus `pathname`, capturing `:name` segments.
 * Returns `null` when nothing matches — the caller must treat that as a denial.
 *
 * Literal segments are compared case-INSENSITIVELY, matching Express 5's own
 * case-insensitive routing (`/API/tests/...` must match the same as `/api/tests/...`).
 * Captured `:name` segments keep the ORIGINAL case of `pathname` — they are
 * identifiers (test/attempt ids), not routing literals, so their case is significant
 * and must survive untouched into the returned `params`.
 */
export function matchMagicScopeRule(method: string, pathname: string): MagicScopeMatch | null {
  const actual = splitPath(pathname);
  for (const rule of MAGIC_SCOPE_RULES) {
    if (rule.method !== method.toUpperCase()) continue;
    const expected = splitPath(rule.pattern);
    const wildcard = expected[expected.length - 1] === "*";
    // A `*` tail absorbs the remaining segments, so it needs at least one of them:
    // `/assets` alone is not `/assets/<file>` and must not match.
    if (wildcard ? actual.length <= expected.length - 1 : expected.length !== actual.length) continue;

    const params: Record<string, string> = {};
    let ok = true;
    // Literal segments are compared UNDECODED on purpose, while only captured
    // parameters are decoded: this asymmetry is deliberate and errs toward
    // denial (an encoded literal segment simply fails to match, rather than
    // being decoded into something that could equal a literal by surprise).
    for (let i = 0; i < expected.length; i += 1) {
      const segment = expected[i];
      if (segment === "*") {
        // The tail is a file path handled (and traversal-guarded) by the route itself.
        break;
      }
      if (segment.startsWith(":")) {
        try {
          params[segment.slice(1)] = decodeURIComponent(actual[i]);
        } catch {
          // Malformed percent-encoding (e.g. a bare "%") must not throw: the
          // function's contract is to return null on anything it can't match,
          // so a bad segment just fails this rule and falls through to denial.
          ok = false;
          break;
        }
      } else if (segment.toLowerCase() !== actual[i].toLowerCase()) {
        ok = false;
        break;
      }
    }
    if (ok) return { rule, params };
  }
  return null;
}
