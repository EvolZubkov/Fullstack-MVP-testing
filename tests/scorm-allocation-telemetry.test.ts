/**
 * @module tests/scorm-allocation-telemetry
 *
 * PRD-44 FR-54: как распределение попадает во взаимодействие SCORM.
 *
 * Ответ у типа ВЕКТОРНЫЙ — несколько «индекс: балл» на один вопрос, — и это исключает
 * оба напрашивающихся типа взаимодействия. `numeric` описывает ОДНО число, а `matching`
 * семантически ложен: пар в ответе нет, есть распределение. Остаётся `other` со строкой,
 * которую отчёт LMS может разобрать.
 *
 * Функции извлекаются из рантайма пакета тем же приёмом, что в scoring-pass-rule.test.ts:
 * это ровно тот код, который уезжает в пакет, а не его пересказ.
 *
 * ПОЧЕМУ ЗДЕСЬ СТОЛЬКО ПРОВЕРОК СТРУКТУРЫ ФАЙЛА. Сборка взаимодействия дважды разъезжалась
 * по копиям: правило исхода легло в мёртвую `finishScorm` (229f3d12), а следом туда же —
 * формат ответа, и пакет полгода отправлял распределение пустой строкой. Извлечение по
 * ИМЕНИ функции этого не видит: регекс находит первую копию, и она может быть мёртвой.
 * Поэтому проверяется не только поведение, но и то, что копия ровно одна и её зовут все
 * пути отправки.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUNTIME = "server/scorm/template/app";
const src = readFileSync(resolve(process.cwd(), `${RUNTIME}/render/resultsPage.js`), "utf8");
const qtypeSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/utils/qtype.js`), "utf8");
const textSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/utils/escapeHtml.js`), "utf8");

/** A top-level `function name(...) { ... }` — declared and closed at column 0. */
function extractTopLevel(name: string): string {
  const m = src.match(new RegExp(`^function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "m"));
  if (!m) throw new Error(`${name} не найдена среди функций верхнего уровня resultsPage.js`);
  return m[0];
}

/** How many times the runtime declares a function under this name. */
function declarationCount(name: string): number {
  return (src.match(new RegExp(`function ${name}\\(`, "g")) || []).length;
}

/** The body of one finish path, cut out of the file by name. */
function finishPath(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} не найдена в resultsPage.js`);
  return src.slice(start).match(/^function [^\n]*\n[\s\S]*?\n\}/)![0];
}

const SHARED = ["to1", "mapScormType", "formatResponse", "getCorrectAnswerFor", "interactionResultFor", "buildQuestionInteraction"];

const runtime = new Function(
  `${qtypeSrc}
  ${textSrc}
  ${SHARED.map(extractTopLevel).join("\n")}
  return {
    mapScormType: mapScormType,
    formatResponse: formatResponse,
    interactionResultFor: interactionResultFor,
    buildQuestionInteraction: buildQuestionInteraction
  };`,
)() as {
  mapScormType: (q: { type: string }) => string;
  formatResponse: (q: { type: string }, ans: unknown) => string;
  interactionResultFor: (q: { type: string }, fullCorrect: boolean) => string;
  buildQuestionInteraction: (
    q: { id: string; type: string; prompt?: string; correct?: unknown },
    ans: unknown,
    fullCorrect: boolean,
  ) => { id: string; type: string; result: string; response: string; correct: string; description: string };
};

const ALLOC = { type: "allocation" };

describe("сборка взаимодействия существует в ОДНОМ экземпляре", () => {
  // Копия номер два — это не дублирование кода, а расхождение поведения: пакет
  // отправляет одну из них, а тест по имени находит другую.
  it.each(SHARED)("%s объявлена ровно один раз", (name) => {
    expect(declarationCount(name)).toBe(1);
  });

  it("мёртвой finishScorm в файле нет", () => {
    // Она пережила два фикса, оба раза приняв на себя правку вместо живого пути.
    expect(src).not.toContain("function finishScorm(");
  });

  it("оба пути отправки собирают взаимодействие общей функцией", () => {
    expect(finishPath("finishScormLmsOnly")).toContain("buildQuestionInteraction(");
    expect(finishPath("finishScormAdaptive")).toContain("buildQuestionInteraction(");
  });
});

describe("тип взаимодействия (FR-54)", () => {
  it("распределение пишется как other", () => {
    expect(runtime.mapScormType(ALLOC)).toBe("other");
  });

  it("остальные типы не затронуты", () => {
    expect(runtime.mapScormType({ type: "single" })).toBe("choice");
    expect(runtime.mapScormType({ type: "scale" })).toBe("choice");
    expect(runtime.mapScormType({ type: "multiple" })).toBe("choice");
    expect(runtime.mapScormType({ type: "matching" })).toBe("matching");
    expect(runtime.mapScormType({ type: "ranking" })).toBe("sequencing");
  });
});

describe("исход взаимодействия", () => {
  it("измерительный вопрос помечается neutral, а не incorrect", () => {
    // `incorrect` показал бы в отчёте LMS ошибку ученика там, где эталона нет вовсе.
    expect(runtime.interactionResultFor(ALLOC, false)).toBe("neutral");
    expect(runtime.interactionResultFor({ type: "scale" }, false)).toBe("neutral");
  });

  it("обычный вопрос сохраняет верность ответа", () => {
    expect(runtime.interactionResultFor({ type: "single" }, true)).toBe("correct");
    expect(runtime.interactionResultFor({ type: "single" }, false)).toBe("incorrect");
  });
});

describe("строка ответа (FR-54)", () => {
  it("вектор «индекс[.]балл» через запятую", () => {
    expect(runtime.formatResponse(ALLOC, { 0: 3, 1: 1, 2: 1, 3: 2 })).toBe("0[.]3,1[.]1,2[.]1,3[.]2");
  });

  it("нули не выбрасываются: аналитике важно «поставил ноль», а не «не дошёл»", () => {
    expect(runtime.formatResponse(ALLOC, { 0: 7, 1: 0, 2: 0, 3: 0 })).toBe("0[.]7,1[.]0,2[.]0,3[.]0");
  });

  it("порядок числовой, а не лексикографический", () => {
    const out = runtime.formatResponse(ALLOC, { 10: 1, 2: 3, 1: 2 });
    expect(out).toBe("1[.]2,2[.]3,10[.]1");
  });

  it("нетронутый вопрос даёт пустую строку", () => {
    expect(runtime.formatResponse(ALLOC, null)).toBe("");
    expect(runtime.formatResponse(ALLOC, undefined)).toBe("");
  });

  it("строки остальных типов не изменились", () => {
    expect(runtime.formatResponse({ type: "single" }, 2)).toBe("3");
    expect(runtime.formatResponse({ type: "multiple" }, [0, 2])).toBe("1,3");
    expect(runtime.formatResponse({ type: "ranking" }, [2, 0, 1])).toBe("3,1,2");
    expect(runtime.formatResponse({ type: "matching" }, { 0: 1, 1: 0 })).toBe("1-2,2-1");
  });

  it("пустой ответ не роняет сборку ни на одном типе", () => {
    // Живой путь звал formatResponse и для ЭТАЛОНА, а у измерительного вопроса его нет.
    for (const type of ["single", "scale", "multiple", "matching", "ranking", "allocation"]) {
      expect(runtime.formatResponse({ type }, null)).toBe("");
    }
  });
});

describe("взаимодействие целиком", () => {
  const QUESTION = { id: "q-1", type: "allocation", prompt: "В чём состоит ваш вклад?", correct: {} };

  it("распределение уезжает в LMS со своим ответом", () => {
    const it0 = runtime.buildQuestionInteraction(QUESTION, { 0: 3, 1: 1, 2: 1, 3: 2 }, false);
    expect(it0).toEqual({
      id: "q_q-1",
      type: "other",
      result: "neutral",
      response: "0[.]3,1[.]1,2[.]1,3[.]2",
      correct: "",
      description: "В чём состоит ваш вклад?",
    });
  });

  it("обычный вопрос несёт и ответ, и эталон", () => {
    const single = { id: "q-2", type: "single", prompt: "Вопрос", correct: { correctIndex: 1 } };
    const it0 = runtime.buildQuestionInteraction(single, 1, true);
    expect(it0.type).toBe("choice");
    expect(it0.result).toBe("correct");
    expect(it0.response).toBe("2");
    expect(it0.correct).toBe("2");
  });
});
