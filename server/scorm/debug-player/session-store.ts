/**
 * @module scorm/debug-player/session-store
 * @description In-memory store for PRD-18 debug-player runs (Phase 3). A run's
 * freshly-built SCORM package is unzipped ONCE into a token-keyed session and
 * served same-origin by the play route. Nothing is persisted — no `attempts`, no
 * telemetry (NFR-19, R-2). Sessions expire on a TTL and are LRU-capped (OQ-1).
 */
import crypto from "node:crypto";
import JSZip from "jszip";

export interface DebugSession {
  readonly files: Map<string, Buffer>;
  readonly launch: string;
  readonly testId: string;
  readonly userId: string;
  readonly createdAt: number;
}

/** A run is throwaway; a generous window covers a manual debugging session. */
const TTL_MS = 30 * 60 * 1000;
/** Cap concurrent in-memory runs (OQ-1); the oldest is evicted past this. */
const MAX_SESSIONS = 50;

const sessions = new Map<string, DebugSession>();

/** Finds the SCO launch href in `imsmanifest.xml`; falls back to `index.html`. Ported from the CLI player. */
function detectLaunch(files: Map<string, Buffer>): string {
  const manifest = files.get("imsmanifest.xml");
  if (manifest) {
    const xml = manifest.toString("utf8");
    const sco = xml.match(/<resource\b[^>]*scormType="sco"[^>]*\bhref="([^"]+)"/i);
    const any = xml.match(/<resource\b[^>]*\bhref="([^"]+)"/i);
    const href = (sco && sco[1]) || (any && any[1]);
    if (href && files.has(href)) return href;
  }
  if (files.has("index.html")) return "index.html";
  for (const k of files.keys()) if (k.toLowerCase().endsWith(".html")) return k;
  return "index.html";
}

function evictExpired(now: number): void {
  for (const [token, s] of sessions) if (now - s.createdAt > TTL_MS) sessions.delete(token);
}

function evictOldest(): void {
  let oldestToken: string | undefined;
  let oldest = Infinity;
  for (const [token, s] of sessions) {
    if (s.createdAt < oldest) {
      oldest = s.createdAt;
      oldestToken = token;
    }
  }
  if (oldestToken) sessions.delete(oldestToken);
}

/** Unzip the freshly-built debug package and register a token-keyed session for `userId`. */
export async function createDebugSession(
  testId: string,
  userId: string,
  zipBuffer: Buffer,
): Promise<{ token: string; launch: string }> {
  evictExpired(Date.now());
  while (sessions.size >= MAX_SESSIONS) evictOldest();

  const zip = await JSZip.loadAsync(zipBuffer);
  const files = new Map<string, Buffer>();
  await Promise.all(
    Object.values(zip.files).map(async (entry) => {
      if (entry.dir) return;
      files.set(entry.name, await entry.async("nodebuffer"));
    }),
  );

  const launch = detectLaunch(files);
  const token = crypto.randomUUID();
  sessions.set(token, { files, launch, testId, userId, createdAt: Date.now() });
  return { token, launch };
}

/**
 * Resolve a session the caller OWNS. Returns `"expired"` past the TTL (and drops
 * it), `undefined` if the token is unknown or belongs to another user (so a
 * foreign token is indistinguishable from a missing one).
 */
export function getDebugSession(token: string, userId: string): DebugSession | "expired" | undefined {
  const s = sessions.get(token);
  if (!s || s.userId !== userId) return undefined;
  if (Date.now() - s.createdAt > TTL_MS) {
    sessions.delete(token);
    return "expired";
  }
  return s;
}

/** Drop a session the caller owns; returns whether one was removed. */
export function dropDebugSession(token: string, userId: string): boolean {
  const s = sessions.get(token);
  if (!s || s.userId !== userId) return false;
  sessions.delete(token);
  return true;
}

/** Test-only: clear all sessions between cases. */
export function __clearDebugSessions(): void {
  sessions.clear();
}
