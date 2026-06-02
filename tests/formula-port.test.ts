/**
 * @module tests/formula-port.test
 *
 * Golden parity test for the result-variable formula DSL (PRD-2 §12). The shipped
 * SCORM runtime uses a hand-maintained plain-JS port
 * (server/scorm/template/app/dsl/formula.js) of the authoritative TypeScript
 * implementation (shared/formula). Both are run against a shared corpus so they
 * can never silently diverge: each case asserts TS = expected, port = expected,
 * and TS = port.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parse as tsParse,
  evaluate as tsEvaluate,
  computeResultVariables as tsCompute,
  type ResultVariableSpec,
} from "../shared/formula";

const root = process.cwd();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const corpus: { context: any; cases: Array<{ formula: string; expected: unknown }> } = JSON.parse(
  readFileSync(resolve(root, "tests/fixtures/formula-cases.json"), "utf8"),
);

// Load the runtime port exactly as the package does: execute the concatenated
// script body (which defines `var FormulaDSL`) and capture the global.
const portSrc = readFileSync(resolve(root, "server/scorm/template/app/dsl/formula.js"), "utf8");
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const FormulaPort = new Function(`${portSrc}\n;return FormulaDSL;`)() as {
  evaluate: (src: string, ctx: unknown) => unknown;
  computeResultVariables: (vars: unknown[], base: unknown) => unknown;
};

describe("formula runtime port parity (PRD-2 §12)", () => {
  for (const c of corpus.cases) {
    it(`${c.formula}  ⇒  ${JSON.stringify(c.expected)}`, () => {
      const ts = tsEvaluate(tsParse(c.formula), corpus.context);
      const port = FormulaPort.evaluate(c.formula, corpus.context);
      expect(ts).toEqual(c.expected); // authoritative TS matches the golden expected
      expect(port).toEqual(c.expected); // runtime port matches the golden expected
      expect(port).toEqual(ts); // and the two implementations agree
    });
  }
});

describe("computeResultVariables port parity (PRD-2 §5.1; A7 core)", () => {
  const base = {
    percent: 80,
    topics: { t1: { percent: 90, passed: true, score: 9 } },
    tags: {},
    scales: {},
    sections: {},
  };
  const scenarios: ResultVariableSpec[][] = [
    [
      { name: "a", type: "number", formula: "percent", sortOrder: 0 },
      { name: "b", type: "number", formula: 'var("a") + 1', sortOrder: 1 },
    ],
    [
      { name: "bad", type: "number", formula: "percent >", sortOrder: 0 },
      { name: "ok", type: "number", formula: "1 + 1", sortOrder: 1 },
    ],
    [{ name: "won", type: "boolean", formula: "percent >= 75", controlsStatus: "success", sortOrder: 0 }],
    [{ name: "cat", type: "string", formula: 'IF(percent >= 90, "Expert", "Advanced")', sortOrder: 0 }],
  ];
  scenarios.forEach((vars, i) => {
    it(`scenario ${i + 1} — TS ≡ runtime port`, () => {
      const ts = tsCompute(vars, base);
      const port = FormulaPort.computeResultVariables(vars, base);
      expect(port).toEqual(ts);
    });
  });
});
