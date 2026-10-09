/**
 * @module tests/scorm-interactions
 *
 * PRD-57 FR-27: как короткий ответ уезжает в отчёт LMS.
 *
 * Функции рантайма пакета исполняются в песочнице тем же приёмом, каким это делает
 * `tests/lms-attempt-result.test.ts`: объявления функций не требуют ни состояния прогона,
 * ни SCORM-хоста, поэтому проверять их можно по отдельности.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const qTypeSrc = readFileSync(resolve(process.cwd(), "server/scorm/template/app/utils/qtype.js"), "utf8");
const resultsSrc = readFileSync(resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"), "utf8");

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const runtime = new Function(
  "TBTemplate",
  `${qTypeSrc}
   ${resultsSrc}
   return { mapScormType: mapScormType, formatResponse: formatResponse,
            correctPatternFor: correctPatternFor };`,
)({
  // Эталон пропуска считает общий модуль — в пакете он приезжает в бандле рантайма.
  referenceAnswer: (set: { rules?: Array<Record<string, unknown>> }) => {
    const rules = Array.isArray(set?.rules) ? set.rules : [];
    for (const rule of rules) {
      if (rule.kind === "number") {
        if (rule.op === "eq" && !rule.tolerance) return String(rule.value);
        continue;
      }
      if (rule.match !== "wildcard") continue;
      const value = String(rule.value ?? "");
      if (value.includes("*") || value.includes("?") || value.trim() === "") continue;
      return value;
    }
    return null;
  },
}) as {
  mapScormType: (q: unknown) => string;
  formatResponse: (q: unknown, ans: unknown) => string;
  correctPatternFor: (q: unknown) => string;
};

const literalRules = {
  answerKind: "text",
  join: "any",
  rules: [
    { kind: "text", match: "wildcard", value: "Ростехнадзор" },
    { kind: "text", match: "wildcard", value: "РТН" },
  ],
};

const wildcardRules = {
  answerKind: "text",
  join: "any",
  rules: [{ kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" }],
};

describe("короткий ответ в отчёте LMS", () => {
  it("уезжает взаимодействием fill-in", () => {
    expect(runtime.mapScormType({ type: "short" })).toBe("fill-in");
  });

  it("ответ участника уходит строкой как есть", () => {
    expect(runtime.formatResponse({ type: "short" }, "  Ростехнадзор ")).toBe("  Ростехнадзор ");
    expect(runtime.formatResponse({ type: "short" }, null)).toBe("");
  });

  it("эталон пишется, когда все правила буквальные", () => {
    expect(runtime.correctPatternFor({ type: "short", correct: literalRules })).toBe("Ростехнадзор[,]РТН");
  });

  it("правило с подстановочным знаком эталона не даёт вовсе", () => {
    // `*` не предусмотрен стандартом для `fill-in`: отправить образец эталоном значило бы
    // соврать в отчёте, а промолчать — честно.
    expect(runtime.correctPatternFor({ type: "short", correct: wildcardRules })).toBe("");
  });

  it("у задания без правил эталона нет", () => {
    expect(runtime.correctPatternFor({ type: "short", correct: { answerKind: "text", join: "any", rules: [] } })).toBe("");
    expect(runtime.correctPatternFor({ type: "short", correct: {} })).toBe("");
  });

  it("прочие типы своего эталона не теряют", () => {
    expect(runtime.correctPatternFor({ type: "single", correct: { correctIndex: 2 } })).toBe("3");
  });
});

describe("взаимодействие задания с пропусками (PRD-57 FR-24h)", () => {
  const question = {
    id: "q-blanks",
    type: "blanks",
    prompt: "Надзор: {{organ}}, срок {{srok}}",
    correct: {
      blanks: [
        { id: "organ", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }] },
        { id: "srok", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 15 }] },
      ],
    },
  };

  it("одно взаимодействие fill-in на задание, а не по одному на пропуск", () => {
    expect(runtime.mapScormType(question)).toBe("fill-in");
  });

  it("ответы пропусков разделяются [,] в порядке набора", () => {
    expect(runtime.formatResponse(question, { srok: "15", organ: "РТН" })).toBe("РТН[,]15");
  });

  it("незаполненный пропуск оставляет своё место пустым", () => {
    expect(runtime.formatResponse(question, { organ: "РТН" })).toBe("РТН[,]");
  });

  it("эталоны идут тем же порядком и тем же разделителем", () => {
    expect(runtime.correctPatternFor(question)).toBe("Ростехнадзор[,]15");
  });

  it("пропуск без эталона обнуляет весь образец: половина эталона хуже, чем ничего", () => {
    const wild = {
      ...question,
      correct: {
        blanks: [
          { id: "organ", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "Федеральная * надзору" }] },
          question.correct.blanks[1],
        ],
      },
    };
    expect(runtime.correctPatternFor(wild)).toBe("");
  });
});

describe("развёрнутый ответ в отчёте LMS (PRD-57 FR-19)", () => {
  const q = { id: "q-long", type: "long", correct: {} };

  it("уезжает взаимодействием long-fill-in", () => {
    expect(runtime.mapScormType(q)).toBe("long-fill-in");
  });

  it("ответ уходит текстом как есть", () => {
    expect(runtime.formatResponse(q, "Развёрнутый ответ участника")).toBe("Развёрнутый ответ участника");
  });

  it("эталон не пишется вовсе: его не существует", () => {
    expect(runtime.correctPatternFor(q)).toBe("");
  });
});
