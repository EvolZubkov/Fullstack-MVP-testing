/**
 * @module tests/scorm-question-order-flat
 *
 * PRD-30 in the SCORM runtime, flat flow. `generateVariant` already builds every
 * section through `orderQuestions` (FR-03/04/05), and the package carries both
 * `questionOrder` and `orderIndex` — but in `linear_flat` the runtime then
 * reshuffled the WHOLE delivered list, throwing that order away.
 *
 * The regression this pins is a host divergence: the web host never mixes across
 * topics (the attempt variant keeps `sections[].questionIds` in section order —
 * `server/routes/attempts.ts`, and `take-test.tsx` concatenates the sections as
 * they come), so the same test played in author order on the web and shuffled in
 * the package and the PRD-18 debug player — the FR-13 parity that no
 * shared-engine test can see.
 *
 * The runtime is exercised from the shipped source, the way the package
 * concatenates it, so the assertions are about the code that actually ships.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSrc = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");
/** Everything the draw needs: drawSection, orderQuestions, selectForm, generateVariant. */
const drawSrc = appSrc.slice(0, appSrc.indexOf("function renderResults"));

type RuntimeQuestion = { id: string; type: string; data: unknown; orderIndex?: number };
type RuntimeSection = {
  topicId: string;
  topicName: string;
  drawCount: number;
  questions: RuntimeQuestion[];
  questionOrder?: string;
};

/**
 * A shuffle that reverses instead of randomising: any list that comes back
 * reversed has been through it, and any list that comes back in author order has
 * not. Groups of one element are unaffected, so the per-index sort stays visible.
 */
const reverseShuffle = <T>(arr: T[]): T[] => arr.slice().reverse();

/** Run the shipped `generateVariant` over a TEST_DATA fixture and read the delivery. */
function deliver(sections: RuntimeSection[], flowMode: string): string[] {
  const state: Record<string, unknown> = {};
  const TEST_DATA = { sections, flowPolicy: { mode: flowMode } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const generateVariant = new Function(
    "state",
    "TEST_DATA",
    "shuffle",
    "shuffleMappingFor",
    `${drawSrc}\n;return generateVariant;`,
  )(state, TEST_DATA, reverseShuffle, () => null) as () => void;
  generateVariant();
  return (state.flatQuestions as { question: RuntimeQuestion }[]).map((fq) => fq.question.id);
}

const q = (id: string, orderIndex: number | null): RuntimeQuestion => ({
  id,
  type: "single",
  data: { options: ["A", "B"] },
  ...(orderIndex === null ? {} : { orderIndex }),
});

const fixedTopic = (topicId: string, questions: RuntimeQuestion[]): RuntimeSection => ({
  topicId,
  topicName: topicId,
  drawCount: questions.length,
  questionOrder: "fixed",
  questions,
});

describe("SCORM runtime — a fixed order survives the flat flow (FR-03/FR-12/FR-13)", () => {
  it("delivers the topic in the author's order when the test is one flat list", () => {
    const order = deliver([fixedTopic("t1", [q("a", 10), q("b", 20), q("c", 30)])], "linear_flat");

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("keeps the same order in the sectional flows", () => {
    const sections = [fixedTopic("t1", [q("a", 10), q("b", 20), q("c", 30)])];

    expect(deliver(sections, "linear_by_topics")).toEqual(["a", "b", "c"]);
    expect(deliver(sections, "router_by_topics")).toEqual(["a", "b", "c"]);
  });

  it("puts an unindexed question last in the flat flow too (FR-04)", () => {
    const order = deliver([fixedTopic("t1", [q("a", 10), q("b", null), q("c", 30)])], "linear_flat");

    expect(order).toEqual(["a", "c", "b"]);
  });

  it("keeps every topic's order and the author's topic sequence in one flat list", () => {
    const order = deliver(
      [fixedTopic("t1", [q("a", 10), q("b", 20)]), fixedTopic("t2", [q("c", 10), q("d", 20)])],
      "linear_flat",
    );

    expect(order).toEqual(["a", "b", "c", "d"]);
  });

  it("delivers a random topic whole — the order there is the shuffle's business", () => {
    // The setting is per topic, so a `random` topic keeps going through the draw
    // and the shuffle; only its COMPOSITION is pinned here (the sequence a given
    // shuffle produces belongs to the order-questions unit tests).
    const order = deliver(
      [
        {
          topicId: "t1",
          topicName: "t1",
          drawCount: 3,
          questionOrder: "random",
          questions: [q("a", 10), q("b", 20), q("c", 30)],
        },
      ],
      "linear_flat",
    );

    expect([...order].sort()).toEqual(["a", "b", "c"]);
  });
});
