/**
 * @module tests/assemble-delivery-port
 *
 * Golden parity test for the PRD-30 delivery STREAM (спека раздел 14). The SCORM
 * runtime carries a hand-maintained plain-JS port (`server/scorm/assets/app.js`:
 * `effectiveSectionOrder` / `orderDeliverySection` / `assembleDelivery`) of the
 * authoritative TypeScript engine (`shared/draw/assemble-delivery.ts`). Both run
 * over the same scenarios with the same deterministic shuffles, so the two hosts
 * cannot silently diverge — the learner must walk the same sequence in the web
 * run and in the package (FR-21).
 *
 * The scenarios cover every branch: inheritance and both directions of the
 * override, topics-as-blocks, the mixed stream, the unbroken fixed block inside
 * it, the sectional degradation and the preordered (variants) topic.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assembleDelivery as tsAssemble,
  effectiveSectionOrder as tsEffective,
  type DeliverySection,
  type TestQuestionOrder,
} from "../shared/draw/assemble-delivery";
import type { OrderableQuestion } from "../shared/draw/order-questions";
import type { ShuffleFn } from "../shared/draw/blueprint";

const src = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");

/** Pull one function out of the shipped runtime source by name. */
function extract(name: string): string {
  const match = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`${name} not found in assets/app.js`);
  return match[0];
}

const PORT_SRC = ["orderQuestions", "effectiveSectionOrder", "orderDeliverySection", "assembleDelivery"]
  .map(extract)
  .join("\n");

type PortAssemble = (
  sections: DeliverySection<OrderableQuestion>[],
  testOrder: string | null | undefined,
  flowMode: string | null | undefined,
  shuffle: ShuffleFn,
) => { sections: OrderableQuestion[][]; flat: OrderableQuestion[] };

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const portAssemble = new Function(`${PORT_SRC}\n;return assembleDelivery;`)() as PortAssemble;
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const portEffective = new Function(`${PORT_SRC}\n;return effectiveSectionOrder;`)() as (
  testOrder: string | null | undefined,
  sectionOrder: string | null | undefined,
) => string;

const identity = <T,>(a: T[]): T[] => a;
const reverse = <T,>(a: T[]): T[] => a.slice().reverse();
/** Rotate by one — a permutation that is neither identity nor its own inverse. */
const rotate = <T,>(a: T[]): T[] => (a.length ? [...a.slice(1), a[0]] : a.slice());
const SHUFFLES: Array<{ name: string; fn: ShuffleFn }> = [
  { name: "identity", fn: identity as ShuffleFn },
  { name: "reverse", fn: reverse as ShuffleFn },
  { name: "rotate", fn: rotate as ShuffleFn },
];

const q = (id: string, orderIndex: number | null = null): OrderableQuestion => ({ id, orderIndex });
const ids = (questions: OrderableQuestion[]) => questions.map((question) => question.id);

interface Scenario {
  name: string;
  sections: DeliverySection<OrderableQuestion>[];
  testOrder: TestQuestionOrder | null | undefined;
  flowMode: string | null | undefined;
}

const topicA: DeliverySection<OrderableQuestion> = {
  questionOrder: null,
  questions: [q("a2", 20), q("a1", 10), q("a3", 30)],
};
const topicB: DeliverySection<OrderableQuestion> = {
  questionOrder: null,
  questions: [q("b1", 10), q("b2", 20)],
};

const SCENARIOS: Scenario[] = [
  { name: "наследование: тест фиксирован", sections: [topicA, topicB], testOrder: "fixed", flowMode: "linear_flat" },
  { name: "наследование: тест перемешивает", sections: [topicA, topicB], testOrder: "random", flowMode: "linear_flat" },
  {
    name: "переопределение темы поверх фиксированного теста",
    sections: [{ ...topicA, questionOrder: "random" }, topicB],
    testOrder: "fixed",
    flowMode: "linear_flat",
  },
  {
    name: "переопределение темы поверх перемешивающего теста",
    sections: [{ ...topicA, questionOrder: "fixed" }, topicB],
    testOrder: "random",
    flowMode: "linear_flat",
  },
  { name: "полное перемешивание", sections: [topicA, topicB], testOrder: "shuffle_all", flowMode: "linear_flat" },
  {
    name: "полное перемешивание с фиксированным блоком",
    sections: [{ ...topicA, questionOrder: "fixed" }, topicB],
    testOrder: "shuffle_all",
    flowMode: "linear_flat",
  },
  {
    name: "полное перемешивание: все темы фиксированы",
    sections: [{ ...topicA, questionOrder: "fixed" }, { ...topicB, questionOrder: "fixed" }],
    testOrder: "shuffle_all",
    flowMode: "linear_flat",
  },
  {
    name: "секционный режим гасит полное перемешивание",
    sections: [{ ...topicA, questionOrder: "fixed" }, topicB],
    testOrder: "shuffle_all",
    flowMode: "linear_by_topics",
  },
  {
    name: "режим роутера",
    sections: [topicA, topicB],
    testOrder: "shuffle_all",
    flowMode: "router_by_topics",
  },
  {
    name: "режим вариантов: список варианта не пересортировывается",
    sections: [
      { questionOrder: "fixed", preordered: true, questions: [q("v3", 30), q("v1", 10), q("v2", 20)] },
      topicB,
    ],
    testOrder: "shuffle_all",
    flowMode: "linear_flat",
  },
  {
    name: "вопросы без индекса",
    sections: [{ questionOrder: "fixed", questions: [q("x", 10), q("y", null), q("z", 30)] }],
    testOrder: "random",
    flowMode: "linear_flat",
  },
  {
    name: "равные индексы",
    sections: [{ questionOrder: "fixed", questions: [q("t1", 20), q("t2", 20), q("lead", 10)] }],
    testOrder: "random",
    flowMode: "linear_flat",
  },
  { name: "пустой тест", sections: [], testOrder: "shuffle_all", flowMode: "linear_flat" },
  {
    name: "пустая тема в потоке",
    sections: [{ questionOrder: null, questions: [] }, topicB],
    testOrder: "shuffle_all",
    flowMode: "linear_flat",
  },
  {
    name: "легаси: значения не заданы",
    sections: [{ questions: topicA.questions }, { questions: topicB.questions }],
    testOrder: undefined,
    flowMode: undefined,
  },
];

describe("effectiveSectionOrder — движок и двойник совпадают", () => {
  const TEST_ORDERS = ["fixed", "random", "shuffle_all", null, undefined];
  const SECTION_ORDERS = ["fixed", "random", null, undefined];

  it.each(TEST_ORDERS)("правило теста %s разрешается одинаково", (testOrder) => {
    for (const sectionOrder of SECTION_ORDERS) {
      expect(portEffective(testOrder, sectionOrder)).toBe(
        tsEffective(testOrder as TestQuestionOrder, sectionOrder as "fixed" | "random" | null),
      );
    }
  });
});

describe("assembleDelivery — движок и двойник совпадают (FR-21)", () => {
  for (const shuffle of SHUFFLES) {
    describe(`перестановка: ${shuffle.name}`, () => {
      it.each(SCENARIOS.map((s) => [s.name, s] as const))("%s", (_name, scenario) => {
        const ts = tsAssemble(scenario.sections, scenario.testOrder, scenario.flowMode, shuffle.fn);
        const port = portAssemble(scenario.sections, scenario.testOrder, scenario.flowMode, shuffle.fn);

        expect(ids(port.flat)).toEqual(ids(ts.flat));
        expect(port.sections.map(ids)).toEqual(ts.sections.map(ids));
      });
    });
  }
});
