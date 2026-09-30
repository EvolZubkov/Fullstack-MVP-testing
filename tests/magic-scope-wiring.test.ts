/**
 * @module tests/magic-scope-wiring
 * @description Guards the ORDER of the middleware chain: the scope guard must sit
 * after the session middleware and before the routers, otherwise a restricted
 * session would reach handlers unchecked. Asserted on the module source, because
 * booting the whole app here would drag in the database.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Line endings depend on the checkout (CRLF on a Windows working copy, LF elsewhere):
// normalise them once so the order checks below do not depend on the machine.
const source = readFileSync(path.resolve(process.cwd(), "server/routes.ts"), "utf8").replace(/\r\n/g, "\n");

describe("magic scope wiring", () => {
  it("registers the guard between the session middleware and the routers", () => {
    const session = source.indexOf("app.use(\n    session(");
    // Search for the registration call, not the bare identifier: the import
    // statement also contains "magicScopeGuard" and sits before the session
    // middleware, which would make the identifier-only search a false pass.
    const guard = source.indexOf("app.use(magicScopeGuard)");
    const routers = source.indexOf("for (const { path, router } of routerConfig)");
    expect(session).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(session);
    expect(routers).toBeGreaterThan(guard);
  });

  it("declares no local duplicate of the session type", () => {
    expect(source).not.toContain("declare module \"express-session\"");
  });
});
