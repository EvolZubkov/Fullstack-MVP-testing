/**
 * Tests for SCORM session recovery logic.
 *
 * Design:
 *   - No timer  → restore in-progress session (questions + answers) from where user left off
 *   - With timer → cannot restore (time is gone); show last attempt result + reset to start
 *   - Adaptive   → cannot restore mid-session; show last attempt result + reset to start
 *
 * The functions tested here will live in:
 *   server/scorm/template/app/utils/scorm/sessionRecovery.js
 *
 * We replicate the logic in TypeScript to keep tests pure (no DOM / SCORM runtime needed).
 */

import { describe, it, expect } from "vitest";

// ─── Types mirroring SCORM state ────────────────────────────────────────────

interface AttemptRecord {
  attemptNumber: number;
  completedAt: string;
  percent: number;
  passed: boolean;
  totalCorrect: number;
  totalQuestions: number;
  earnedPoints: number;
  possiblePoints: number;
  topicResults: any[];
  answers: Record<string, any>;
  flatQuestions: any[];
}

interface SuspendObj {
  attemptsUsed: number;
  attempts: AttemptRecord[];
  currentSession?: CurrentSession | null;
}

interface CurrentSession {
  savedAt: string;
  currentIndex: number;
  answers: Record<string, any>;
  flatQuestions: any[];
  remainingSeconds: number | null;
}

interface TestConfig {
  timeLimitMinutes: number | null;
  mode: "standard" | "adaptive";
}

// ─── Logic replicated from sessionRecovery.js (to be created) ───────────────

function saveCurrentSession(
  suspendObj: SuspendObj,
  currentIndex: number,
  answers: Record<string, any>,
  flatQuestions: any[],
  remainingSeconds: number | null
): SuspendObj {
  return {
    ...suspendObj,
    currentSession: {
      savedAt: new Date().toISOString(),
      currentIndex,
      answers: JSON.parse(JSON.stringify(answers)),
      flatQuestions: JSON.parse(JSON.stringify(flatQuestions)),
      remainingSeconds,
    },
  };
}

function clearCurrentSession(suspendObj: SuspendObj): SuspendObj {
  return { ...suspendObj, currentSession: null };
}

type RecoveryDecision =
  | { action: "restore"; session: CurrentSession }
  | { action: "show_last_attempt"; attempt: AttemptRecord }
  | { action: "start_fresh" };

function determineRecovery(
  suspendObj: SuspendObj,
  testConfig: TestConfig
): RecoveryDecision {
  const session = suspendObj.currentSession;
  const attempts = suspendObj.attempts || [];

  // Adaptive — never restore mid-session
  if (testConfig.mode === "adaptive") {
    if (attempts.length > 0) {
      const last = attempts[attempts.length - 1];
      return { action: "show_last_attempt", attempt: last };
    }
    return { action: "start_fresh" };
  }

  // No in-progress session — start fresh or show results
  if (!session || !session.flatQuestions || session.flatQuestions.length === 0) {
    return { action: "start_fresh" };
  }

  // With timer — cannot restore, time is gone
  if (testConfig.timeLimitMinutes !== null) {
    if (attempts.length > 0) {
      const last = attempts[attempts.length - 1];
      return { action: "show_last_attempt", attempt: last };
    }
    return { action: "start_fresh" };
  }

  // No timer — restore in-progress session
  return { action: "restore", session };
}

function isSessionStale(session: CurrentSession, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  try {
    const saved = new Date(session.savedAt).getTime();
    if (isNaN(saved)) return true;
    return Date.now() - saved > maxAgeMs;
  } catch {
    return true;
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const flatQ1 = { question: { id: "q1", type: "single" }, topicId: "t1", topicName: "JS" };
const flatQ2 = { question: { id: "q2", type: "multiple" }, topicId: "t1", topicName: "JS" };
const flatQ3 = { question: { id: "q3", type: "single" }, topicId: "t2", topicName: "TS" };

const completedAttempt: AttemptRecord = {
  attemptNumber: 1,
  completedAt: new Date(Date.now() - 60_000).toISOString(),
  percent: 80,
  passed: true,
  totalCorrect: 8,
  totalQuestions: 10,
  earnedPoints: 8,
  possiblePoints: 10,
  topicResults: [],
  answers: { q1: 0, q2: [1, 2] },
  flatQuestions: [flatQ1, flatQ2],
};

const inProgressSession: CurrentSession = {
  savedAt: new Date(Date.now() - 5_000).toISOString(), // 5 sec ago — fresh
  currentIndex: 2,
  answers: { q1: 0, q2: [1] },
  flatQuestions: [flatQ1, flatQ2, flatQ3],
  remainingSeconds: null,
};

const emptySuspend: SuspendObj = { attemptsUsed: 0, attempts: [] };

// ─────────────────────────────────────────────────────────────────────────────
// saveCurrentSession
// ─────────────────────────────────────────────────────────────────────────────

describe("saveCurrentSession", () => {
  it("writes currentSession into suspend object", () => {
    const result = saveCurrentSession(emptySuspend, 2, { q1: 0 }, [flatQ1, flatQ2], null);
    expect(result.currentSession).not.toBeNull();
    expect(result.currentSession!.currentIndex).toBe(2);
    expect(result.currentSession!.answers).toEqual({ q1: 0 });
    expect(result.currentSession!.flatQuestions).toHaveLength(2);
  });

  it("stores remainingSeconds for timed tests", () => {
    const result = saveCurrentSession(emptySuspend, 1, {}, [flatQ1], 120);
    expect(result.currentSession!.remainingSeconds).toBe(120);
  });

  it("stores null remainingSeconds for untimed tests", () => {
    const result = saveCurrentSession(emptySuspend, 0, {}, [flatQ1], null);
    expect(result.currentSession!.remainingSeconds).toBeNull();
  });

  it("does not mutate original answers object (deep copy)", () => {
    const answers = { q1: 0 };
    const result = saveCurrentSession(emptySuspend, 0, answers, [], null);
    answers.q1 = 99;
    expect(result.currentSession!.answers.q1).toBe(0);
  });

  it("does not mutate original flatQuestions array (deep copy)", () => {
    const fqs = [{ ...flatQ1 }];
    const result = saveCurrentSession(emptySuspend, 0, {}, fqs, null);
    fqs[0] = { ...flatQ2 };
    expect(result.currentSession!.flatQuestions[0].question.id).toBe("q1");
  });

  it("preserves existing attempts when saving session", () => {
    const suspend: SuspendObj = { ...emptySuspend, attempts: [completedAttempt] };
    const result = saveCurrentSession(suspend, 1, {}, [flatQ1], null);
    expect(result.attempts).toHaveLength(1);
  });

  it("overwrites previous currentSession", () => {
    const suspend: SuspendObj = { ...emptySuspend, currentSession: inProgressSession };
    const result = saveCurrentSession(suspend, 5, { q3: 1 }, [flatQ3], null);
    expect(result.currentSession!.currentIndex).toBe(5);
    expect(result.currentSession!.answers).toEqual({ q3: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearCurrentSession
// ─────────────────────────────────────────────────────────────────────────────

describe("clearCurrentSession", () => {
  it("sets currentSession to null", () => {
    const suspend: SuspendObj = { ...emptySuspend, currentSession: inProgressSession };
    const result = clearCurrentSession(suspend);
    expect(result.currentSession).toBeNull();
  });

  it("preserves attempts when clearing session", () => {
    const suspend: SuspendObj = {
      attemptsUsed: 1,
      attempts: [completedAttempt],
      currentSession: inProgressSession,
    };
    const result = clearCurrentSession(suspend);
    expect(result.attempts).toHaveLength(1);
    expect(result.attemptsUsed).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// determineRecovery — no timer (standard)
// ─────────────────────────────────────────────────────────────────────────────

describe("determineRecovery — standard mode, no timer", () => {
  const cfg: TestConfig = { timeLimitMinutes: null, mode: "standard" };

  it("restores in-progress session when present", () => {
    const suspend: SuspendObj = { ...emptySuspend, currentSession: inProgressSession };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).toBe("restore");
    if (result.action === "restore") {
      expect(result.session.currentIndex).toBe(2);
      expect(result.session.answers).toEqual({ q1: 0, q2: [1] });
    }
  });

  it("restores correct question index from session", () => {
    const session: CurrentSession = { ...inProgressSession, currentIndex: 7 };
    const suspend: SuspendObj = { ...emptySuspend, currentSession: session };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).toBe("restore");
    if (result.action === "restore") {
      expect(result.session.currentIndex).toBe(7);
    }
  });

  it("starts fresh when no session and no attempts", () => {
    const result = determineRecovery(emptySuspend, cfg);
    expect(result.action).toBe("start_fresh");
  });

  it("starts fresh when session has empty flatQuestions", () => {
    const suspend: SuspendObj = {
      ...emptySuspend,
      currentSession: { ...inProgressSession, flatQuestions: [] },
    };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).toBe("start_fresh");
  });

  it("starts fresh when currentSession is null", () => {
    const suspend: SuspendObj = { ...emptySuspend, currentSession: null };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).toBe("start_fresh");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// determineRecovery — with timer (standard)
// ─────────────────────────────────────────────────────────────────────────────

describe("determineRecovery — standard mode, with timer", () => {
  const cfg: TestConfig = { timeLimitMinutes: 30, mode: "standard" };

  it("shows last attempt when session exists (timer gone)", () => {
    const suspend: SuspendObj = {
      attemptsUsed: 1,
      attempts: [completedAttempt],
      currentSession: inProgressSession,
    };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).toBe("show_last_attempt");
  });

  it("starts fresh when timed test has session but no completed attempts", () => {
    const suspend: SuspendObj = { ...emptySuspend, currentSession: inProgressSession };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).toBe("start_fresh");
  });

  it("starts fresh when no session and no attempts", () => {
    const result = determineRecovery(emptySuspend, cfg);
    expect(result.action).toBe("start_fresh");
  });

  it("never returns restore action for timed test", () => {
    const suspend: SuspendObj = {
      attemptsUsed: 1,
      attempts: [completedAttempt],
      currentSession: inProgressSession,
    };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).not.toBe("restore");
  });

  it("shows last attempt (not best) for timed test", () => {
    const older: AttemptRecord = { ...completedAttempt, percent: 90, completedAt: new Date(Date.now() - 120_000).toISOString() };
    const newer: AttemptRecord = { ...completedAttempt, percent: 60, completedAt: new Date(Date.now() - 10_000).toISOString() };
    const suspend: SuspendObj = {
      attemptsUsed: 2,
      attempts: [older, newer],
      currentSession: inProgressSession,
    };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).toBe("show_last_attempt");
    if (result.action === "show_last_attempt") {
      expect(result.attempt.percent).toBe(60); // last, not best
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// determineRecovery — adaptive mode
// ─────────────────────────────────────────────────────────────────────────────

describe("determineRecovery — adaptive mode", () => {
  const cfg: TestConfig = { timeLimitMinutes: null, mode: "adaptive" };

  it("shows last attempt when attempts exist (even with session)", () => {
    const suspend: SuspendObj = {
      attemptsUsed: 1,
      attempts: [completedAttempt],
      currentSession: inProgressSession,
    };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).toBe("show_last_attempt");
  });

  it("starts fresh when no attempts even with session", () => {
    const suspend: SuspendObj = { ...emptySuspend, currentSession: inProgressSession };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).toBe("start_fresh");
  });

  it("never returns restore action for adaptive", () => {
    const suspend: SuspendObj = {
      attemptsUsed: 1,
      attempts: [completedAttempt],
      currentSession: inProgressSession,
    };
    const result = determineRecovery(suspend, cfg);
    expect(result.action).not.toBe("restore");
  });

  it("starts fresh when no session and no attempts", () => {
    const result = determineRecovery(emptySuspend, cfg);
    expect(result.action).toBe("start_fresh");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isSessionStale
// ─────────────────────────────────────────────────────────────────────────────

describe("isSessionStale", () => {
  it("returns false for a session saved 5 seconds ago", () => {
    const session: CurrentSession = {
      ...inProgressSession,
      savedAt: new Date(Date.now() - 5_000).toISOString(),
    };
    expect(isSessionStale(session)).toBe(false);
  });

  it("returns true for a session saved 25 hours ago", () => {
    const session: CurrentSession = {
      ...inProgressSession,
      savedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };
    expect(isSessionStale(session)).toBe(true);
  });

  it("returns false for a session saved 23 hours ago (within default 24h)", () => {
    const session: CurrentSession = {
      ...inProgressSession,
      savedAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    };
    expect(isSessionStale(session)).toBe(false);
  });

  it("returns true for invalid savedAt date", () => {
    const session: CurrentSession = { ...inProgressSession, savedAt: "not-a-date" };
    expect(isSessionStale(session)).toBe(true);
  });

  it("respects custom maxAgeMs", () => {
    const session: CurrentSession = {
      ...inProgressSession,
      savedAt: new Date(Date.now() - 10_000).toISOString(), // 10 sec ago
    };
    expect(isSessionStale(session, 5_000)).toBe(true);   // stale if max is 5s
    expect(isSessionStale(session, 20_000)).toBe(false);  // fresh if max is 20s
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: stale session treated as start_fresh
// ─────────────────────────────────────────────────────────────────────────────

describe("determineRecovery with stale session check", () => {
  const cfg: TestConfig = { timeLimitMinutes: null, mode: "standard" };

  function determineRecoveryWithStaleness(
    suspendObj: SuspendObj,
    testConfig: TestConfig,
    maxAgeMs = 24 * 60 * 60 * 1000
  ): RecoveryDecision {
    if (
      suspendObj.currentSession &&
      isSessionStale(suspendObj.currentSession, maxAgeMs)
    ) {
      return determineRecovery(clearCurrentSession(suspendObj), testConfig);
    }
    return determineRecovery(suspendObj, testConfig);
  }

  it("restores fresh session (saved 1 min ago)", () => {
    const session: CurrentSession = {
      ...inProgressSession,
      savedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const suspend: SuspendObj = { ...emptySuspend, currentSession: session };
    const result = determineRecoveryWithStaleness(suspend, cfg);
    expect(result.action).toBe("restore");
  });

  it("starts fresh when session is stale (saved 2 days ago)", () => {
    const session: CurrentSession = {
      ...inProgressSession,
      savedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const suspend: SuspendObj = { ...emptySuspend, currentSession: session };
    const result = determineRecoveryWithStaleness(suspend, cfg);
    expect(result.action).toBe("start_fresh");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveAttemptResult helper (replicated)
// ─────────────────────────────────────────────────────────────────────────────

function saveAttemptResult(suspendObj: SuspendObj, resultData: Partial<AttemptRecord>): SuspendObj {
  const s = { ...suspendObj, attempts: [...(suspendObj.attempts || [])] };
  s.attempts.push({
    attemptNumber: s.attemptsUsed,
    completedAt: new Date().toISOString(),
    percent: resultData.percent ?? 0,
    passed: resultData.passed ?? false,
    totalCorrect: resultData.totalCorrect ?? 0,
    totalQuestions: resultData.totalQuestions ?? 0,
    earnedPoints: resultData.earnedPoints ?? 0,
    possiblePoints: resultData.possiblePoints ?? 0,
    topicResults: resultData.topicResults ?? [],
    answers: resultData.answers ?? {},
    flatQuestions: resultData.flatQuestions ?? [],
  });
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// restart() — attempt counting
// Попытка должна расходоваться ТОЛЬКО при state.submitted = true.
// Прерванные сессии (submitted=false) не должны расходовать попытку.
// ─────────────────────────────────────────────────────────────────────────────

function simulateRestart(
  suspendObj: SuspendObj,
  submitted: boolean,
  results: Partial<AttemptRecord>
): SuspendObj {
  if (submitted) {
    return saveAttemptResult(suspendObj, results);
  }
  return suspendObj;
}

describe("restart() — attempt counting", () => {
  const results = { percent: 70, passed: false, totalCorrect: 7, totalQuestions: 10 };

  it("does NOT save attempt when submitted=false (interrupted session)", () => {
    const result = simulateRestart(emptySuspend, false, results);
    expect(result.attempts).toHaveLength(0);
  });

  it("saves attempt when submitted=true (test was actually submitted)", () => {
    const result = simulateRestart(emptySuspend, true, results);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].percent).toBe(70);
  });

  it("does NOT increment attempts array on interrupted restart even with answers present", () => {
    const suspendWithSession: SuspendObj = { ...emptySuspend, currentSession: inProgressSession };
    const result = simulateRestart(suspendWithSession, false, results);
    expect(result.attempts).toHaveLength(0);
  });

  it("preserves existing attempts when not saving new one", () => {
    const suspend: SuspendObj = { attemptsUsed: 1, attempts: [completedAttempt] };
    const result = simulateRestart(suspend, false, results);
    expect(result.attempts).toHaveLength(1);
  });

  it("appends attempt to existing ones when submitted=true", () => {
    const suspend: SuspendObj = { attemptsUsed: 1, attempts: [completedAttempt] };
    const result = simulateRestart(suspend, true, results);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1].percent).toBe(70);
  });

  it("attempt record contains correct data when saved", () => {
    const r = { percent: 55, passed: false, totalCorrect: 5, totalQuestions: 10, earnedPoints: 5, possiblePoints: 10 };
    const result = simulateRestart(emptySuspend, true, r);
    const saved = result.attempts[0];
    expect(saved.percent).toBe(55);
    expect(saved.passed).toBe(false);
    expect(saved.earnedPoints).toBe(5);
    expect(saved.possiblePoints).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// beforeunload behavior
// submitted=true && !scormFinished  → сохранить попытку
// submitted=false && phase=question → сохранить сессию
// scormFinished=true               → ничего не делать
// ─────────────────────────────────────────────────────────────────────────────

interface PlayerState {
  submitted: boolean;
  phase: string;
  flatQuestions: any[];
  currentIndex: number;
  answers: Record<string, any>;
}

function simulateBeforeunload(
  state: PlayerState,
  scormFinished: boolean,
  suspendObj: SuspendObj,
  results: Partial<AttemptRecord>
): { suspend: SuspendObj; attemptSaved: boolean; sessionSaved: boolean } {
  let suspend = { ...suspendObj, attempts: [...(suspendObj.attempts || [])] };
  let attemptSaved = false;
  let sessionSaved = false;

  if (!scormFinished) {
    if (state.submitted) {
      suspend = saveAttemptResult(suspend, results);
      suspend = clearCurrentSession(suspend);
      attemptSaved = true;
    } else if (state.phase === "question" && state.flatQuestions && state.flatQuestions.length > 0) {
      suspend = saveCurrentSession(suspend, state.currentIndex, state.answers, state.flatQuestions, null);
      sessionSaved = true;
    }
  }

  return { suspend, attemptSaved, sessionSaved };
}

describe("beforeunload behavior", () => {
  const results = { percent: 80, passed: true, totalCorrect: 8, totalQuestions: 10 };

  const inProgressState: PlayerState = {
    submitted: false,
    phase: "question",
    flatQuestions: [flatQ1, flatQ2, flatQ3],
    currentIndex: 2,
    answers: { q1: 0 },
  };

  const submittedState: PlayerState = {
    submitted: true,
    phase: "question",
    flatQuestions: [flatQ1, flatQ2],
    currentIndex: 2,
    answers: { q1: 0, q2: [1] },
  };

  it("saves attempt when submitted=true and scormFinished=false", () => {
    const { suspend, attemptSaved } = simulateBeforeunload(submittedState, false, emptySuspend, results);
    expect(attemptSaved).toBe(true);
    expect(suspend.attempts).toHaveLength(1);
    expect(suspend.attempts[0].percent).toBe(80);
  });

  it("clears currentSession after saving attempt", () => {
    const suspend: SuspendObj = { ...emptySuspend, currentSession: inProgressSession };
    const { suspend: result } = simulateBeforeunload(submittedState, false, suspend, results);
    expect(result.currentSession).toBeNull();
  });

  it("saves session when submitted=false and phase=question", () => {
    const { suspend, sessionSaved } = simulateBeforeunload(inProgressState, false, emptySuspend, results);
    expect(sessionSaved).toBe(true);
    expect(suspend.currentSession).not.toBeNull();
    expect(suspend.currentSession!.currentIndex).toBe(2);
  });

  it("does nothing when scormFinished=true (finishAndClose was called)", () => {
    const { suspend, attemptSaved, sessionSaved } = simulateBeforeunload(submittedState, true, emptySuspend, results);
    expect(attemptSaved).toBe(false);
    expect(sessionSaved).toBe(false);
    expect(suspend.attempts).toHaveLength(0);
  });

  it("does not double-save if scormFinished=true even with submitted=true", () => {
    const withAttempt: SuspendObj = { attemptsUsed: 1, attempts: [completedAttempt] };
    const { suspend } = simulateBeforeunload(submittedState, true, withAttempt, results);
    expect(suspend.attempts).toHaveLength(1);
  });

  it("does not save session when flatQuestions is empty", () => {
    const emptyState: PlayerState = { ...inProgressState, flatQuestions: [] };
    const { sessionSaved } = simulateBeforeunload(emptyState, false, emptySuspend, results);
    expect(sessionSaved).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// APP_URL trailing slash fix
// ─────────────────────────────────────────────────────────────────────────────

function buildAppUrl(raw: string): string {
  return raw.replace(/\/$/, "");
}

function buildMagicLink(appUrl: string, token: string): string {
  return `${buildAppUrl(appUrl)}/access/${token}`;
}

describe("APP_URL trailing slash fix", () => {
  const token = "abc123token";

  it("removes trailing slash from APP_URL", () => {
    expect(buildAppUrl("https://example.com/")).toBe("https://example.com");
  });

  it("leaves URL without trailing slash unchanged", () => {
    expect(buildAppUrl("https://example.com")).toBe("https://example.com");
  });

  it("generates magic link without double slash when APP_URL has trailing slash", () => {
    const link = buildMagicLink("https://test.edtech-rtk.ru/", token);
    expect(link).toBe(`https://test.edtech-rtk.ru/access/${token}`);
    expect(link).not.toContain("//access/");
  });

  it("generates magic link correctly when APP_URL has no trailing slash", () => {
    const link = buildMagicLink("https://test.edtech-rtk.ru", token);
    expect(link).toBe(`https://test.edtech-rtk.ru/access/${token}`);
  });

  it("handles localhost with port", () => {
    const link = buildMagicLink("http://localhost:5001/", token);
    expect(link).toBe(`http://localhost:5001/access/${token}`);
    expect(link).not.toContain("//access/");
  });
});
