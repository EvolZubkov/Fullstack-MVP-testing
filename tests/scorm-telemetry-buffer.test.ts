/**
 * @module tests/scorm-telemetry-buffer
 *
 * Guards the retry buffer of the SCORM telemetry runtime
 * (server/scorm/template/app/telemetry/telemetry.js).
 *
 * The buffer is a best-effort safety net for a flaky link and must never become a
 * load source itself: a permanently failing endpoint has to go quiet after a bounded
 * number of tries, a 4xx refusal has to stop delivery for the session outright, and
 * the queue must stay bounded. The earlier version re-queued the head item without
 * advancing its counter, so it retried forever every 5 s while the queue grew by one
 * entry per tick — a corporate perimeter scored that as a flood and answered 403.
 *
 * The module is a plain-JS IIFE bundled into the package, so it is loaded here through
 * `new Function` with its ambient dependencies injected, which keeps every request,
 * clock and storage access under the test's control.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/telemetry/telemetry.js"),
  "utf8",
);

const CONFIG = {
  enabled: true,
  packageId: "pkg-1",
  secretKey: "secret",
  apiBaseUrl: "https://telemetry.example",
};

/** HMAC signing stub — the real one needs SubtleCrypto, which jsdom does not provide. */
const cryptoStub = {
  subtle: {
    importKey: async () => ({}),
    sign: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  },
};

/** `getLmsUserData` walks up `window.parent` until it reaches itself. */
function windowStub() {
  const w: Record<string, unknown> = { addEventListener: () => {} };
  w.parent = w;
  return w;
}

const silentConsole = { log: () => {}, warn: () => {}, error: () => {} };

function okResponse() {
  return { ok: true, status: 200, clone: () => ({ json: async () => ({}) }) };
}

/** A `Request` whose instances expose `keepalive` — i.e. a browser that supports it. */
class KeepaliveRequest {
  keepalive = false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Overrides = { navigator?: any; Request?: any };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadTelemetry(fetchImpl: any, overrides: Overrides = {}): any {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "fetch",
    "crypto",
    "window",
    "localStorage",
    "console",
    "navigator",
    "Request",
    `${SRC}\n;return Telemetry;`,
  );
  return factory(
    fetchImpl,
    cryptoStub,
    windowStub(),
    { getItem: () => null, setItem: () => {} },
    silentConsole,
    overrides.navigator ?? {},
    overrides.Request ?? KeepaliveRequest,
  );
}

/** Let the pending sign/fetch microtasks settle without firing any retry timer. */
const settle = () => vi.advanceTimersByTimeAsync(1);

describe("SCORM telemetry — retry buffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on a permanently failing endpoint after a bounded number of tries", async () => {
    const fetchStub = vi.fn(async () => {
      throw new Error("network down");
    });
    const telemetry = loadTelemetry(fetchStub);
    telemetry.init(CONFIG);

    telemetry.finish({ percent: 50, passed: false });
    await settle();
    expect(fetchStub).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const total = fetchStub.mock.calls.length;
    // One initial attempt plus at most three retries — never an open-ended stream.
    expect(total).toBeLessThanOrEqual(4);

    // And it stays quiet: no timer keeps ticking once the budget is spent.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchStub).toHaveBeenCalledTimes(total);
  });

  it("stops delivery for the session on a 4xx refusal instead of retrying", async () => {
    const fetchStub = vi.fn(async () => ({
      ok: false,
      status: 403,
      clone: () => ({ json: async () => ({}) }),
    }));
    const telemetry = loadTelemetry(fetchStub);
    telemetry.init(CONFIG);

    telemetry.finish({ percent: 50, passed: false });
    await settle();
    expect(fetchStub).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    // A refusal is terminal: later events are not sent either, so a blocked client
    // cannot keep knocking and deepen the block.
    telemetry.answer({ questionId: "q-after-block" });
    await settle();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("delivers a buffered event once the link recovers", async () => {
    let offline = true;
    const fetchStub = vi.fn(async () => {
      if (offline) throw new Error("offline");
      return okResponse();
    });
    const telemetry = loadTelemetry(fetchStub);
    telemetry.init(CONFIG);

    telemetry.finish({ percent: 50, passed: false });
    await settle();
    expect(fetchStub).toHaveBeenCalledTimes(1);

    offline = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchStub).toHaveBeenCalledTimes(2);

    // Delivered once — the entry leaves the queue and nothing re-sends it.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("keeps the queue bounded, dropping the oldest events", async () => {
    let offline = true;
    const fetchStub = vi.fn(async () => {
      if (offline) throw new Error("offline");
      return okResponse();
    });
    const telemetry = loadTelemetry(fetchStub);
    telemetry.init(CONFIG);

    for (let i = 0; i < 60; i++) {
      telemetry.answer({ questionId: "q" + i });
      await settle();
    }
    expect(fetchStub).toHaveBeenCalledTimes(60);

    offline = false;
    await vi.advanceTimersByTimeAsync(30 * 60_000);

    const delivered = new Set(
      fetchStub.mock.calls
        .slice(60)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((call: any) => JSON.parse(call[1].body).data.questionId),
    );
    // The queue caps at 50, so the 10 oldest events were dropped instead of piling up.
    expect(delivered.size).toBe(50);
    expect(delivered.has("q0")).toBe(false);
    expect(delivered.has("q59")).toBe(true);
  });
});

describe("SCORM telemetry — surviving page unload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the attempt result with keepalive so a closing page cannot cancel it", async () => {
    const fetchStub = vi.fn(async () => okResponse());
    const telemetry = loadTelemetry(fetchStub);
    telemetry.init(CONFIG);

    telemetry.finish({ percent: 80, passed: true });
    await settle();

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CONFIG.apiBaseUrl + "/api/scorm-telemetry/finish");
    expect(init.keepalive).toBe(true);
    // The wire format is unchanged: still a signed JSON envelope.
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string).data.percent).toBe(80);
  });

  it("leaves ordinary events as plain requests", async () => {
    const fetchStub = vi.fn(async () => okResponse());
    const telemetry = loadTelemetry(fetchStub);
    telemetry.init(CONFIG);

    telemetry.answer({ questionId: "q1" });
    await settle();

    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    // keepalive shares a small per-page budget; spending it on in-progress events
    // would starve the one payload that actually has to outlive the page.
    expect(init.keepalive).toBeFalsy();
  });

  it("falls back to sendBeacon when the browser cannot keep a fetch alive", async () => {
    const fetchStub = vi.fn(async () => okResponse());
    const sendBeacon = vi.fn(() => true);
    // A Request implementation without `keepalive` — the older embedded browsers some
    // LMS platforms still ship.
    class LegacyRequest {}
    const telemetry = loadTelemetry(fetchStub, {
      navigator: { sendBeacon },
      Request: LegacyRequest,
    });
    telemetry.init(CONFIG);

    telemetry.finish({ percent: 80, passed: true });
    await settle();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchStub).not.toHaveBeenCalled();

    const [beaconUrl, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(beaconUrl).toBe(CONFIG.apiBaseUrl + "/api/scorm-telemetry/finish");
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text()).data.percent).toBe(80);

    // A queued beacon counts as delivered: there is no response to observe, and
    // re-sending would double-count the attempt.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("retries within the normal budget when the beacon is refused", async () => {
    const fetchStub = vi.fn(async () => okResponse());
    const sendBeacon = vi.fn(() => false);
    class LegacyRequest {}
    const telemetry = loadTelemetry(fetchStub, {
      navigator: { sendBeacon },
      Request: LegacyRequest,
    });
    telemetry.init(CONFIG);

    telemetry.finish({ percent: 80, passed: true });
    await settle();
    expect(sendBeacon).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    // Same budget as any other failure — one try plus three retries, then quiet.
    expect(sendBeacon.mock.calls.length).toBeLessThanOrEqual(4);
    const total = sendBeacon.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(sendBeacon).toHaveBeenCalledTimes(total);
  });

  it("sends an oversized result as an ordinary request rather than not at all", async () => {
    const fetchStub = vi.fn(async () => okResponse());
    const telemetry = loadTelemetry(fetchStub);
    telemetry.init(CONFIG);

    // keepalive bodies are capped at 64 KiB; over that the browser rejects the call.
    telemetry.finish({ percent: 80, passed: true, achievedLevels: "x".repeat(70_000) });
    await settle();

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.keepalive).toBeFalsy();
  });
});
