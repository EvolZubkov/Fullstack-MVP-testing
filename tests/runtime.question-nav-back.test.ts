/**
 * @module tests/runtime.question-nav-back
 *
 * PRD-19 (Block B) — the SCORM runtime's question navigation must offer a
 * «← Назад» (return to the previous question) button in flexible mode
 * (allowReturnToUnanswered), at parity with the web host (take-test.tsx). The
 * button was missing entirely from `buildQuestionNavHtml`, so a learner could
 * skip / return-via-обзор but had no direct back navigation.
 *
 * The runtime ships as hand-maintained plain JS (server/scorm/template/app/*),
 * not as importable modules, so — like the other *-port tests — we extract the
 * functions under test by source and run them with injected globals.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const answersSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/actions/answers.js"),
  "utf8",
);
const mainRenderSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/mainRender.js"),
  "utf8",
);

function extract(src: string, name: string): string {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`${name} not found in runtime source`);
  return m[0];
}

const prevSrc = extract(answersSrc, "prevAccessibleQuestionIndex");
const navSrc = extract(mainRenderSrc, "buildQuestionNavHtml");

interface Runtime {
  prevAccessibleQuestionIndex: () => number;
  buildQuestionNavHtml: (current: number, total: number) => string;
}

function makeRuntime(TEST_DATA: any, state: any, hasSkippedInScope = () => false): Runtime {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "TEST_DATA",
    "state",
    "hasSkippedInScope",
    `${prevSrc}\n${navSrc}\nreturn { prevAccessibleQuestionIndex: prevAccessibleQuestionIndex, buildQuestionNavHtml: buildQuestionNavHtml };`,
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

describe("PRD-19 SCORM runtime — buildQuestionNavHtml «Назад»", () => {
  it("renders an enabled «Назад» when a previous question is reachable", () => {
    const rt = makeRuntime({ allowReturnToUnanswered: true, answerCommitScope: "section" }, stateAt(1));
    const html = rt.buildQuestionNavHtml(1, 3);
    expect(html).toContain('data-action="answer-back"');
    expect(html).toContain("goBack()");
    expect(html).toContain("Назад");
    // Enabled: the back button itself carries no `disabled` attribute.
    expect(/data-action="answer-back"[^>]*\sdisabled/.test(html)).toBe(false);
    // Flexible mode still offers «Пропустить» before commit.
    expect(html).toContain('data-action="answer-skip"');
  });

  it("renders a disabled «Назад» on the first question of a section", () => {
    const rt = makeRuntime({ allowReturnToUnanswered: true, answerCommitScope: "section" }, stateAt(2));
    const html = rt.buildQuestionNavHtml(2, 3);
    expect(/data-action="answer-back"[^>]*\sdisabled/.test(html)).toBe(true);
  });

  it("offers «Назад» even after the answer is committed (independent of commit state)", () => {
    const state = stateAt(1);
    state.questionStatuses = { q1: "answered" } as any;
    const rt = makeRuntime({ allowReturnToUnanswered: true, answerCommitScope: "section" }, state);
    const html = rt.buildQuestionNavHtml(1, 3);
    expect(html).toContain('data-action="answer-back"');
    expect(html).toContain("Далее"); // committed → forward is «Далее»
  });
});
