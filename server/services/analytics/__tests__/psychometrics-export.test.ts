/**
 * @module server/services/analytics/__tests__/psychometrics-export
 * @description PRD-66 FR-53, FR-54: листы выгрузки проверяются по ЗНАЧЕНИЯМ, а не по байтам.
 */
import { describe, expect, it } from "vitest";

import { computePsychometrics, type QuestionInfo } from "../psychometrics";
import {
  MATRIX_NOT_DELIVERED,
  MATRIX_NOT_GRADED,
  itemsSheet,
  matrixSheet,
  sampleHeader,
  testSheet,
  type ExportContext,
} from "../psychometrics-export";
import type { ResponseFact } from "../response-matrix";

function fact(over: Partial<ResponseFact> & Pick<ResponseFact, "questionId" | "respondentId">): ResponseFact {
  return {
    observationId: `obs-${over.respondentId}`,
    source: "web",
    psychoHash: "hash-1",
    outcome: "correct",
    score: null,
    maxScore: null,
    scoreRatio: 1,
    latencyMs: null,
    answer: null,
    formKey: null,
    groupKeys: [],
    occurredAt: new Date("2026-09-20T10:00:00Z"),
    ...over,
  } as ResponseFact;
}

/**
 * Четыре респондента: у трёх оба задания, у C только первое — им и проверяется «не выдавалось».
 *
 * Суммы у полных наборов РАЗНЫЕ (2, 1, 0) намеренно: при одинаковых суммах разброс нулевой, и
 * надёжность законно не считается вовсе — на такой фикстуре лист «Тест» проверить было бы нечем.
 */
const RESPONSES: ResponseFact[] = [
  fact({ respondentId: "A", questionId: "q1", scoreRatio: 1 }),
  fact({ respondentId: "A", questionId: "q2", scoreRatio: 1 }),
  fact({ respondentId: "B", questionId: "q1", scoreRatio: 1 }),
  fact({ respondentId: "B", questionId: "q2", scoreRatio: 0 }),
  fact({ respondentId: "C", questionId: "q1", scoreRatio: 0.5 }),
  fact({ respondentId: "D", questionId: "q1", scoreRatio: 0 }),
  fact({ respondentId: "D", questionId: "q2", scoreRatio: 0 }),
];

const QUESTIONS = new Map<string, QuestionInfo>([
  ["q1", { id: "q1", type: "single", prompt: "Первый", dataJson: { options: ["A", "B"] }, difficulty: 50 }],
  ["q2", { id: "q2", type: "single", prompt: "Второй", dataJson: { options: ["A", "B"] }, difficulty: null }],
]);

const CTX: ExportContext = {
  testTitle: "Сертификация",
  conditions: "группа: Розница",
  attempts: "first",
  generatedAt: new Date("2026-09-24T09:30:00Z"),
};

const PSYCHOMETRICS = computePsychometrics(RESPONSES, { questionById: QUESTIONS, minObservations: 10 });

describe("sampleHeader", () => {
  it("печатает условия отбора и режим попыток", () => {
    // Выгрузку читают отдельно от экрана: лист без условий невозможно ни повторить, ни
    // оспорить, и он превращается в набор чисел без происхождения.
    const lines = sampleHeader(CTX, PSYCHOMETRICS.sample).map(row => String(row[0] ?? ""));

    expect(lines.some(l => l.includes("Сертификация"))).toBe(true);
    expect(lines.some(l => l.includes("группа: Розница"))).toBe(true);
    expect(lines.some(l => l.includes("только первая"))).toBe(true);
    expect(lines.some(l => l.includes("респондентов 4"))).toBe(true);
  });

  it("называет долю наблюдений с неизвестной редакцией", () => {
    const withUnknown = computePsychometrics(
      [...RESPONSES, fact({ respondentId: "D", questionId: "q1", psychoHash: null })],
      { questionById: QUESTIONS, minObservations: 10 },
    );
    const lines = sampleHeader(CTX, withUnknown.sample).map(row => String(row[0] ?? ""));
    expect(lines.some(l => l.includes("Редакция неизвестна"))).toBe(true);
  });
});

describe("itemsSheet", () => {
  it("даёт по строке на задание с величинами и признаками", () => {
    const rows = itemsSheet(CTX, PSYCHOMETRICS, new Map([["q1", "Первый"], ["q2", "Второй"]]));
    const header = rows.find(row => row[0] === "Вопрос")!;
    const q1 = rows.find(row => row[0] === "q1")!;

    expect(header).toContain("Трудность");
    expect(header).toContain("Дискриминативность (r)");
    expect(q1[1]).toBe("Первый");
    expect(q1[2]).toBe(4);
    // Отчёт округляет до двух знаков: он для чтения. Сырьём служит матрица — там четыре.
    expect(q1[3]).toBe(0.63);
  });

  it("невычислимую величину печатает прочерком, а не нулём", () => {
    // Ноль в колонке дискриминативности означал бы «задание никого не различает», а это
    // совсем другое утверждение, чем «посчитать было не на чем».
    const rows = itemsSheet(CTX, PSYCHOMETRICS, new Map());
    const q1 = rows.find(row => row[0] === "q1")!;
    expect(q1[7]).toBe(50);
    const q2 = rows.find(row => row[0] === "q2")!;
    expect(q2[7]).toBe("—");
  });

  it("слабую дискриминативность называет тем же симптомом, что и экран", () => {
    // Решение владельца 2026-09-25: 0 ≤ r < 0,20 — «Сильные и слабые отвечают одинаково».
    // Флаг подставлен руками: здесь проверяется подпись листа, а не расчёт движка.
    const weak = {
      ...PSYCHOMETRICS,
      items: PSYCHOMETRICS.items.map(item => item.questionId === "q1"
        ? { ...item, flags: { ...item.flags, weakDiscrimination: true } }
        : item),
    };
    const rows = itemsSheet(CTX, weak, new Map());
    const header = rows.find(row => row[0] === "Вопрос")!;
    const q1 = rows.find(row => row[0] === "q1")!;

    expect(q1[header.indexOf("Признаки")]).toBe("сильные и слабые отвечают одинаково");
  });
});

describe("testSheet", () => {
  it("печатает надёжность и то, что из неё следует", () => {
    const rows = testSheet(CTX, PSYCHOMETRICS);
    const names = rows.map(row => String(row[0] ?? ""));

    expect(names).toContain("Надёжность (альфа)");
    expect(names).toContain("Респондентов в расчёте");
    expect(names).toContain("Ошибка измерения (SEM)");
  });

  it("причину отказа называет словами, а не пустой клеткой", () => {
    // Пустая клетка на месте альфы читается как ошибка выгрузки, а не как «считать не на чем».
    const thin = computePsychometrics(
      [fact({ respondentId: "A", questionId: "q1" })],
      { questionById: QUESTIONS, minObservations: 10 },
    );
    const rows = testSheet(CTX, thin);
    const alpha = rows.find(row => row[0] === "Надёжность (альфа)")!;

    expect(alpha[1]).toBe("—");
    expect(String(alpha[2])).toContain("меньше двух вопросов");
  });
});

describe("matrixSheet", () => {
  it("строит таблицу «респондент × задание» с долями балла", () => {
    const rows = matrixSheet(CTX, RESPONSES, PSYCHOMETRICS.sample);
    const header = rows.find(row => row[0] === "Респондент")!;
    const a = rows.find(row => row[0] === "A")!;

    expect(header).toEqual(["Респондент", "q1", "q2"]);
    expect(a).toEqual(["A", 1, 1]);
  });

  it("«не выдавалось» и «выдано, ответа нет» кодируются РАЗНЫМИ значениями (FR-54a)", () => {
    // Свести их к пустой ячейке значило бы воспроизвести тот самый дефект разбора: задание,
    // которого человек не видел, считалось бы проваленным.
    const rows = matrixSheet(CTX, RESPONSES, PSYCHOMETRICS.sample);
    const c = rows.find(row => row[0] === "C")!;

    expect(c[1]).toBe(0.5);
    expect(c[2]).toBe(MATRIX_NOT_DELIVERED);
    // У D задание выдано и провалено — это ноль, а не «не выдавалось».
    const d = rows.find(row => row[0] === "D")!;
    expect(d[2]).toBe(0);
  });

  it("измерительный ответ помечается своим кодом", () => {
    const withNeutral = [...RESPONSES, fact({ respondentId: "A", questionId: "q3", scoreRatio: null })];
    const rows = matrixSheet(CTX, withNeutral, PSYCHOMETRICS.sample);
    const header = rows.find(row => row[0] === "Респондент")!;
    const a = rows.find(row => row[0] === "A")!;

    expect(a[header.indexOf("q3")]).toBe(MATRIX_NOT_GRADED);
  });

  it("строка подписана ключом респондента, а не именем (FR-54c)", () => {
    const rows = matrixSheet(CTX, RESPONSES, PSYCHOMETRICS.sample);
    const names = rows.map(row => String(row[0] ?? ""));
    expect(names).toContain("A");
    expect(names.some(n => n.includes("Иванов"))).toBe(false);
  });

  it("несёт легенду обозначений", () => {
    const rows = matrixSheet(CTX, RESPONSES, PSYCHOMETRICS.sample);
    expect(rows.some(row => String(row[0] ?? "").includes("Обозначения"))).toBe(true);
  });
});
