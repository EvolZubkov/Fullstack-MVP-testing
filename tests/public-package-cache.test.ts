/**
 * @module tests/public-package-cache
 * @description The public-link package cache builds one package per (test, snapshot),
 * shares in-flight builds, builds without telemetry and forgets failed builds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const buildScormExportData = vi.hoisted(() => vi.fn());
const generateScormPackage = vi.hoisted(() => vi.fn());
const unzipPackage = vi.hoisted(() => vi.fn());

vi.mock("../server/scorm/build-export-data", () => ({ buildScormExportData }));
vi.mock("../server/scorm-exporter", () => ({ generateScormPackage }));
vi.mock("../server/scorm/debug-player/session-store", () => ({ unzipPackage }));

import { getPublicPackage, __clearPublicPackages } from "../server/scorm/debug-player/public-package-cache";

beforeEach(() => {
  __clearPublicPackages();
  vi.clearAllMocks();
  buildScormExportData.mockResolvedValue({ test: { title: "T" } });
  generateScormPackage.mockResolvedValue(Buffer.from("zip"));
  unzipPackage.mockResolvedValue({ files: new Map([["index.html", Buffer.from("x")]]), launch: "index.html" });
});

afterEach(() => vi.useRealTimers());

describe("getPublicPackage", () => {
  it("rebuilds a live entry after its TTL", async () => {
    vi.useFakeTimers();
    await getPublicPackage("t1", "live:1", { ttlMs: 1000 });
    await getPublicPackage("t1", "live:1", { ttlMs: 1000 });
    expect(buildScormExportData).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1001);
    await getPublicPackage("t1", "live:1", { ttlMs: 1000 });
    expect(buildScormExportData).toHaveBeenCalledTimes(2);
  });

  it("never expires a snapshot entry", async () => {
    vi.useFakeTimers();
    await getPublicPackage("t1", "snap:s1");
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await getPublicPackage("t1", "snap:s1");
    expect(buildScormExportData).toHaveBeenCalledTimes(1);
  });

  it("builds once for parallel calls with the same key", async () => {
    const [a, b] = await Promise.all([getPublicPackage("t1", "s1"), getPublicPackage("t1", "s1")]);
    expect(a).toBe(b);
    expect(buildScormExportData).toHaveBeenCalledTimes(1);
  });

  it("rebuilds for a new snapshot", async () => {
    await getPublicPackage("t1", "s1");
    await getPublicPackage("t1", "s2");
    expect(buildScormExportData).toHaveBeenCalledTimes(2);
  });

  it("builds from the export source without telemetry", async () => {
    await getPublicPackage("t1", "s1");
    expect(buildScormExportData).toHaveBeenCalledWith("t1", { source: "export" });
    expect(generateScormPackage).toHaveBeenCalledWith(expect.objectContaining({ telemetry: null }));
  });

  it("does not keep a failed build in the cache", async () => {
    buildScormExportData.mockRejectedValueOnce(new Error("boom"));
    await expect(getPublicPackage("t1", "s1")).rejects.toThrow("boom");
    await new Promise((r) => setTimeout(r, 0));
    await expect(getPublicPackage("t1", "s1")).resolves.toMatchObject({ launch: "index.html" });
    expect(buildScormExportData).toHaveBeenCalledTimes(2);
  });
});
