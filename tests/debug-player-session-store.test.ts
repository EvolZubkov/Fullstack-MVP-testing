/**
 * @module tests/debug-player-session-store
 * @description PRD-18 Phase 3 — unit tests for the in-memory debug-run store
 * (`server/scorm/debug-player/session-store.ts`): unzip-once + token keying, SCO
 * launch detection, per-user ownership isolation (R-7), TTL expiry and LRU
 * eviction (OQ-1). Uses a real in-memory zip; nothing here touches the DB.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import JSZip from "jszip";
import {
  createDebugSession,
  getDebugSession,
  dropDebugSession,
  __clearDebugSessions,
} from "../server/scorm/debug-player/session-store";

const TTL_MS = 30 * 60 * 1000;

/** Build a minimal in-memory package zip. */
async function makeZip(opts: { manifest?: string; files?: Record<string, string> } = {}): Promise<Buffer> {
  const zip = new JSZip();
  if (opts.manifest !== undefined) zip.file("imsmanifest.xml", opts.manifest);
  for (const [name, body] of Object.entries(opts.files ?? { "index.html": "<html></html>" })) {
    zip.file(name, body);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

const SCO_MANIFEST =
  '<?xml version="1.0"?><manifest><resources>' +
  '<resource scormType="sco" href="scormcontent/index.html"></resource>' +
  "</resources></manifest>";

beforeEach(() => {
  __clearDebugSessions();
});

afterEach(() => {
  vi.useRealTimers();
  __clearDebugSessions();
});

describe("createDebugSession", () => {
  it("unzips the package and detects the SCO launch href from the manifest", async () => {
    const zip = await makeZip({
      manifest: SCO_MANIFEST,
      files: { "scormcontent/index.html": "<html>sco</html>" },
    });
    const { token, launch } = await createDebugSession("test-1", "user-1", zip);
    expect(token).toMatch(/[0-9a-f-]{36}/i);
    expect(launch).toBe("scormcontent/index.html");

    const s = getDebugSession(token, "user-1");
    expect(s).not.toBe("expired");
    expect(s).toBeTruthy();
    expect((s as { files: Map<string, Buffer> }).files.get("scormcontent/index.html")?.toString()).toBe(
      "<html>sco</html>",
    );
  });

  it("falls back to index.html when there is no manifest", async () => {
    const zip = await makeZip({ files: { "index.html": "<html>x</html>" } });
    const { launch } = await createDebugSession("test-1", "user-1", zip);
    expect(launch).toBe("index.html");
  });
});

describe("getDebugSession ownership + expiry", () => {
  it("hides a session from a different user (foreign token reads as missing)", async () => {
    const { token } = await createDebugSession("test-1", "owner", await makeZip());
    expect(getDebugSession(token, "intruder")).toBeUndefined();
    expect(getDebugSession(token, "owner")).toBeTruthy();
  });

  it("returns 'expired' once the TTL elapses and drops the session", async () => {
    const { token } = await createDebugSession("test-1", "user-1", await makeZip());
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + TTL_MS + 1000);
    expect(getDebugSession(token, "user-1")).toBe("expired");
    // Dropped on expiry: a second read is a plain miss.
    expect(getDebugSession(token, "user-1")).toBeUndefined();
  });
});

describe("dropDebugSession", () => {
  it("drops a session the caller owns", async () => {
    const { token } = await createDebugSession("test-1", "user-1", await makeZip());
    expect(dropDebugSession(token, "user-1")).toBe(true);
    expect(getDebugSession(token, "user-1")).toBeUndefined();
  });

  it("refuses to drop a foreign or unknown token", async () => {
    const { token } = await createDebugSession("test-1", "owner", await makeZip());
    expect(dropDebugSession(token, "intruder")).toBe(false);
    expect(dropDebugSession("no-such-token", "owner")).toBe(false);
    expect(getDebugSession(token, "owner")).toBeTruthy();
  });
});

describe("LRU eviction", () => {
  it("evicts the oldest run once the cap is exceeded", async () => {
    const zip = await makeZip();
    const tokens: string[] = [];
    for (let i = 0; i < 51; i++) {
      tokens.push((await createDebugSession("test-1", "user-1", zip)).token);
    }
    // The very first run was evicted to make room for the 51st.
    expect(getDebugSession(tokens[0], "user-1")).toBeUndefined();
    expect(getDebugSession(tokens[50], "user-1")).toBeTruthy();
  });
});
