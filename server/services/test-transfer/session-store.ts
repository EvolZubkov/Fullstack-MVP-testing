/**
 * @module server/services/test-transfer/session-store
 *
 * Holds an uploaded `.tbtest` between the three steps of a selective import.
 *
 * The steps exist so the author never chooses blind (PRD-48 §5), and re-uploading the file
 * for each of them would be both slow and unsafe: the plan shown and the plan applied must
 * come from the SAME bytes. The package therefore stays in memory under a one-time token,
 * owned by the user who uploaded it.
 *
 * Deliberately shaped after `server/scorm/debug-player/session-store.ts` — in-memory, TTL,
 * LRU cap, owner check — rather than invented anew: two stores of throwaway uploads with
 * different lifetimes would be two sets of rules to remember. Nothing is persisted; a lost
 * session costs one re-upload.
 */
import crypto from "node:crypto";
import type { TestTransferPackage } from "./package";

export interface TransferSession {
  /** The uploaded bytes, kept because `apply` still needs the media out of the ZIP. */
  readonly archive: Buffer;
  /** The manifest, parsed once at the inspect step. */
  readonly pkg: TestTransferPackage;
  readonly userId: string;
  readonly createdAt: number;
}

/** A generous window: the author reads the plan, weighs the deletions, and only then applies. */
const TTL_MS = 30 * 60 * 1000;
/** Cap concurrent uploads in memory; the oldest is evicted past this. */
const MAX_SESSIONS = 50;

const sessions = new Map<string, TransferSession>();

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

/** Registers an uploaded package for `userId` and answers with its one-time token. */
export function createTransferSession(
  userId: string,
  archive: Buffer,
  pkg: TestTransferPackage,
): string {
  evictExpired(Date.now());
  while (sessions.size >= MAX_SESSIONS) evictOldest();

  const token = crypto.randomUUID();
  sessions.set(token, { archive, pkg, userId, createdAt: Date.now() });
  return token;
}

/**
 * Resolves a session the caller OWNS. Returns `"expired"` past the TTL (and drops it), and
 * `undefined` when the token is unknown or belongs to another user — a foreign token is
 * indistinguishable from a missing one, so nothing about somebody else's upload leaks.
 */
export function getTransferSession(
  token: string,
  userId: string,
): TransferSession | "expired" | undefined {
  const s = sessions.get(token);
  if (!s || s.userId !== userId) return undefined;
  if (Date.now() - s.createdAt > TTL_MS) {
    sessions.delete(token);
    return "expired";
  }
  return s;
}

/** Drops a session the caller owns; returns whether one was removed. */
export function dropTransferSession(token: string, userId: string): boolean {
  const s = sessions.get(token);
  if (!s || s.userId !== userId) return false;
  sessions.delete(token);
  return true;
}

/** Test-only: clear all sessions between cases. */
export function __clearTransferSessions(): void {
  sessions.clear();
}
