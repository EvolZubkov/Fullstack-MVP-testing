// @vitest-environment node
/**
 * @module tests/logger.test
 * @description Unit coverage for {@link module:server/logger}: the in-memory ring
 * buffer and its level/text/limit filters, the per-source Pino nodes and level
 * overrides, error de-duplication (suppression after the threshold plus the
 * periodic summary), request-context propagation and the app-managed audit trail.
 * Runs in the `node` environment; the console sink is set to "silent" so the real
 * Pino tree stays wired (levels still gate the ring buffer) without printing, and
 * `fs.appendFileSync` is spied so audit writes never touch disk.
 */
import fs from "fs";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { config } from "../server/config";
import { logger, audit, getRecentLogs, requestContext, SLOW_REQUEST_MS } from "../server/logger";

beforeAll(() => {
  // Set BEFORE the first log call — the Pino tree is built lazily on first emit.
  config.log = {
    fileName: "",
    level: { common: "trace", console: "silent", file: "silent", objects: { quiet: "error" } },
  } as never;
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(fs, "appendFileSync").mockImplementation(() => undefined);
  vi.spyOn(fs, "existsSync").mockReturnValue(true);
});

describe("ring buffer + getRecentLogs", () => {
  it("captures emitted events across all level helpers", () => {
    const tag = `unique-${Math.round(performance.now())}`;
    logger.trace(`t ${tag}`);
    logger.debug(`d ${tag}`);
    logger.info(`i ${tag}`);
    logger.warn(`w ${tag}`);
    const { entries } = getRecentLogs({ search: tag });
    expect(entries.length).toBe(4);
    expect(entries.map((e) => e.level)).toEqual(["trace", "debug", "info", "warn"]);
  });

  it("filters by level and by case-insensitive text (message or source)", () => {
    const tag = `flt-${Math.round(performance.now())}`;
    logger.info(`hello ${tag}`, "alpha");
    logger.warn(`other ${tag}`, "beta");

    expect(getRecentLogs({ level: "warn", search: tag }).entries).toHaveLength(1);
    // Search matches the source name too.
    expect(getRecentLogs({ search: "ALPHA" }).entries.some((e) => e.source === "alpha")).toBe(true);
    // level "all" is a no-op filter.
    expect(getRecentLogs({ level: "all", search: tag }).entries).toHaveLength(2);
  });

  it("honours the limit and reports total vs shown", () => {
    const tag = `lim-${Math.round(performance.now())}`;
    for (let i = 0; i < 5; i++) logger.info(`n${i} ${tag}`);
    const res = getRecentLogs({ search: tag, limit: 2 });
    expect(res.total).toBe(5);
    expect(res.shown).toBe(2);
    expect(res.entries).toHaveLength(2);
  });
});

describe("error formatting + de-duplication", () => {
  it("stringifies Error objects (message + stack) and non-error values", () => {
    const tag = `err-${Math.round(performance.now())}`;
    logger.error(new Error(`boom ${tag}`), "e1");
    logger.fatal(1234, "e2");
    const entries = getRecentLogs({ search: tag }).entries;
    expect(entries.some((e) => e.level === "error" && e.message.includes("boom"))).toBe(true);
    expect(getRecentLogs({ search: "1234" }).entries.some((e) => e.level === "fatal")).toBe(true);
  });

  it("suppresses identical errors past the threshold, then emits a summary", () => {
    const tag = `dup-${Math.round(performance.now())}`;
    for (let i = 0; i < 12; i++) logger.error(`same ${tag}`, "dedup-src");
    // Only the first 3 identical errors are retained (threshold = 3). Filter to
    // the error level so the warn-level de-dup summary (which echoes the key) is
    // not counted.
    const kept = getRecentLogs({ search: `same ${tag}` }).entries.filter((e) => e.level === "error");
    expect(kept.length).toBe(3);
    // At the 10th occurrence a de-dup summary line is emitted.
    expect(getRecentLogs({ search: "[dedup] Suppressed" }).entries.length).toBeGreaterThan(0);
  });
});

describe("per-source level overrides", () => {
  it("isLevelEnabled reflects the configured object override", () => {
    expect(logger.isLevelEnabled("error", "quiet")).toBe(true);
    expect(logger.isLevelEnabled("debug", "quiet")).toBe(false);
    // A source without an override uses the common base level (trace).
    expect(logger.isLevelEnabled("trace", "app")).toBe(true);
  });

  it("drops events below an overridden source's level (never reaches the ring)", () => {
    const tag = `ovr-${Math.round(performance.now())}`;
    logger.debug(`hidden ${tag}`, "quiet");
    expect(getRecentLogs({ search: tag }).entries).toHaveLength(0);
  });
});

describe("request context propagation", () => {
  it("attaches reqId/userId from AsyncLocalStorage to the entry", () => {
    const tag = `ctx-${Math.round(performance.now())}`;
    requestContext.run({ reqId: "R1", userId: "U1", method: "GET", path: "/x" }, () => {
      logger.info(`ctx ${tag}`);
    });
    const [entry] = getRecentLogs({ search: tag }).entries;
    expect(entry.reqId).toBe("R1");
    expect(entry.userId).toBe("U1");
  });
});

describe("audit trail", () => {
  it("writes an audit line to disk and mirrors it to the ring buffer", () => {
    audit.login("a@x.test", true, "127.0.0.1");
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    const line = (fs.appendFileSync as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(line).toContain("auth.login");
    // Mirrored to the in-memory view under the "audit" source.
    expect(getRecentLogs({ search: "auth.login" }).entries.some((e) => e.source === "audit")).toBe(true);
  });

  it("covers the remaining audit actions", () => {
    audit.logout();
    audit.passwordChange("u1");
    audit.passwordReset("u1");
    audit.userCreate("b@x.test", "author");
    audit.userDeactivate("u1");
    audit.userActivate("u1");
    audit.bulkImport(1, 2, 3);
    audit.attemptsReset("u1", null);
    expect(fs.appendFileSync).toHaveBeenCalledTimes(8);
  });

  it("swallows a disk failure without throwing", () => {
    (fs.appendFileSync as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => audit.logout()).not.toThrow();
  });
});

describe("exports", () => {
  it("exposes the slow-request threshold constant", () => {
    expect(SLOW_REQUEST_MS).toBe(1000);
  });
});
