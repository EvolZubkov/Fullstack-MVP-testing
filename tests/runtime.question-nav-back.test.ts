/**
 * @module tests/runtime.question-nav-back
 *
 * PRD-19 (Block B) — which PREVIOUS question the SCORM runtime lets a learner return
 * to: the immediately preceding one in flexible mode (allowReturnToUnanswered), never
 * across a section boundary under sectional commit scope, and never at all in strict
 * mode.
 *
 * Scope note: this file used to also assert the «← Назад» BUTTON markup, extracted from
 * `buildQuestionNavHtml` in mainRender.js. That function is gone — the revision on the
 * design system moved the nav row into the LAYOUT (`state.nav`, built by
 * `shared/template/question-nav`), where its composition is covered by
 * `shared/template/question-nav.test.ts`. The extraction threw at import and took the
 * whole file (including the checks below) down with it; only the button block was
 * removed, the reachability rules it guarded are still the runtime's own.
 *
 * The runtime ships as hand-maintained plain JS (server/scorm/template/app/*),
 * not as importable modules, so — like the other *-port tests — we extract the
 * function under test by source and run it with injected globals.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const answersSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/actions/answers.js"),
  "utf8",
);

function extract(src: string, name: string): string {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`${name} not found in runtime source`);
  return m[0];
}

const prevSrc = extract(answersSrc, "prevAccessibleQuestionIndex");

interface Runtime {
  prevAccessibleQuestionIndex: () => number;
}

function makeRuntime(TEST_DATA: any, state: any, hasSkippedInScope = () => false): Runtime {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "TEST_DATA",
    "state",
    "hasSkippedInScope",
    `${prevSrc}\nreturn { prevAccessibleQuestionIndex: prevAccessibleQuestionIndex };`,
  );
  return factory(TEST_DATA, state, hasSkippedInScope) as Runtime;
}

const fq = (id: string, topicId: string) => ({ topicId, question: { id } });
// q0,q1 in topic t1; q2 in topic t2 (a section boundary at index 2).
const FLAT = [fq("q0", "t1"), fq("q1", "t1"), fq("q2", "t2")];

function stateAt(currentIndex: number) {
  return { currentIndex, flatQuestions: FLAT, questionStatuses: {}, feedbackShown: false, pageSequence: [] };
}

describe("PRD-19 SCORM runtime — prevAccessibleQuestionIndex", () => {
  it("flat flexible: returns the immediately previous index", () => {
    const rt = makeRuntime({ allowReturnToUnanswered: true, answerCommitScope: "test" }, stateAt(1));
    expect(rt.prevAccessibleQuestionIndex()).toBe(0);
  });

  it("flat flexible: crosses a topic boundary (no sections in flat scope)", () => {
    const rt = makeRuntime({ allowReturnToUnanswered: true, answerCommitScope: "test" }, stateAt(2));
    expect(rt.prevAccessibleQuestionIndex()).toBe(1);
  });

  it("first question: no accessible previous", () => {
    const rt = makeRuntime({ allowReturnToUnanswered: true, answerCommitScope: "test" }, stateAt(0));
    expect(rt.prevAccessibleQuestionIndex()).toBe(-1);
  });

  it("sectional scope: stays inside the current section", () => {
    // Within section t1: q1 → q0 allowed.
    const within = makeRuntime({ allowReturnToUnanswered: true, answerCommitScope: "section" }, stateAt(1));
    expect(within.prevAccessibleQuestionIndex()).toBe(0);
    // At the section boundary (q2/t2): the previous question is in t1 — blocked.
    const boundary = makeRuntime({ allowReturnToUnanswered: true, answerCommitScope: "section" }, stateAt(2));
    expect(boundary.prevAccessibleQuestionIndex()).toBe(-1);
  });

  it("strict mode (return disabled): never offers a previous", () => {
    const rt = makeRuntime({ allowReturnToUnanswered: false, answerCommitScope: "test" }, stateAt(2));
    expect(rt.prevAccessibleQuestionIndex()).toBe(-1);
  });
});
