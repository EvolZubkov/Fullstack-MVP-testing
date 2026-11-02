/**
 * @module tests/scorm-resume-before-first-question
 * @description A linear SCORM run is checkpointed on its PAGES too, not only on its
 * questions: the attempt is counted on «Начать», so a reload on an intro page used to
 * drop the run and spend that attempt for nothing. Runs the package's own
 * `sessionRecovery.js`:
 *   - `saveSessionOnPage` checkpoints a linear run on a content page or a question,
 *     and nothing else (router mode saves on its own, a finished run has nothing);
 *   - `resumePageIndex` brings a restored run back to the content page it was saved
 *     on, and to the question otherwise.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/sessionRecovery.js"),
  "utf8",
);

/** The module over the given state and TEST_DATA, with `saveCurrentSession` observed. */
function load(state: Record<string, unknown>, flowMode = "linear_by_topics") {
  const TEST_DATA = { mode: "standard", flowPolicy: { mode: flowMode } };
  const saveCurrentSession = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "TEST_DATA", "state", "readSuspendObj", "writeSuspendObj", "console", "saveCurrentSessionSpy",
    `${src}
     saveCurrentSession = saveCurrentSessionSpy;
     return { saveSessionOnPage: saveSessionOnPage, resumePageIndex: resumePageIndex };`,
  );
  const api = factory(
    TEST_DATA, state, () => ({}), () => undefined, { log: () => undefined }, saveCurrentSession,
  ) as {
    saveSessionOnPage: () => void;
    resumePageIndex: (session: unknown) => number;
  };
  return { ...api, saveCurrentSession };
}

const SEQUENCE = [
  { kind: "content", page: { kind: "intro" } },
  { kind: "question", questionIndex: 0 },
  { kind: "question", questionIndex: 1 },
  { kind: "content", page: { kind: "intro", topicId: "t2" } },
  { kind: "question", questionIndex: 2 },
];

describe("saveSessionOnPage", () => {
  it("checkpoints a linear run on a content page", () => {
    const m = load({ phase: "content", submitted: false });
    m.saveSessionOnPage();
    expect(m.saveCurrentSession).toHaveBeenCalledTimes(1);
  });

  it("checkpoints a linear run on a question", () => {
    const m = load({ phase: "question", submitted: false });
    m.saveSessionOnPage();
    expect(m.saveCurrentSession).toHaveBeenCalledTimes(1);
  });

  it("leaves a finished run alone", () => {
    const m = load({ phase: "content", submitted: true });
    m.saveSessionOnPage();
    expect(m.saveCurrentSession).not.toHaveBeenCalled();
  });

  it("leaves the router to its own checkpoints", () => {
    const m = load({ phase: "content", submitted: false }, "router_by_topics");
    m.saveSessionOnPage();
    expect(m.saveCurrentSession).not.toHaveBeenCalled();
  });

  it("does not checkpoint the обзор or the section results", () => {
    for (const phase of ["review", "sectionResults", "start"]) {
      const m = load({ phase, submitted: false });
      m.saveSessionOnPage();
      expect(m.saveCurrentSession).not.toHaveBeenCalled();
    }
  });
});

describe("resumePageIndex", () => {
  it("a run saved on the intro page comes back to the intro page", () => {
    const m = load({ pageSequence: SEQUENCE, currentIndex: 0 });
    expect(m.resumePageIndex({ cpi: 0, i: 0 })).toBe(0);
  });

  it("a run saved on a section intro between sections comes back to it", () => {
    const m = load({ pageSequence: SEQUENCE, currentIndex: 1 });
    expect(m.resumePageIndex({ cpi: 3, i: 1 })).toBe(3);
  });

  it("a run saved on a question comes back to that question", () => {
    const m = load({ pageSequence: SEQUENCE, currentIndex: 1 });
    expect(m.resumePageIndex({ cpi: 2, i: 1 })).toBe(2);
  });

  it("a position past the sequence falls back to the question", () => {
    const m = load({ pageSequence: SEQUENCE, currentIndex: 2 });
    expect(m.resumePageIndex({ cpi: 42, i: 2 })).toBe(4);
  });

  it("a checkpoint without a page position falls back to the question", () => {
    const m = load({ pageSequence: SEQUENCE, currentIndex: 1 });
    expect(m.resumePageIndex({ i: 1 })).toBe(2);
  });

  it("the router hub is never a place to resume a linear run on", () => {
    const seq = [{ kind: "content", isRouter: true, page: {} }, { kind: "question", questionIndex: 0 }];
    const m = load({ pageSequence: seq, currentIndex: 0 });
    expect(m.resumePageIndex({ cpi: 0, i: 0 })).toBe(1);
  });
});
