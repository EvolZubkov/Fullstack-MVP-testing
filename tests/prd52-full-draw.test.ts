/**
 * @module tests/prd52-full-draw
 *
 * PRD-52 FR-11..FR-13: режим «Все вопросы темы». Рецензент вычитывает БАНК, а не
 * ту выборку, которая случайно выпала прогону, поэтому окно рецензирования умеет
 * попросить у рантайма пакета полную выдачу.
 *
 * Механика намеренно повторяет пин варианта из PRD-18: флаг едет хешем launch-URL,
 * а не сборкой. Отсюда главное, что здесь проверяется, — ИНЕРТНОСТЬ в проде: LMS
 * запускает пакет без хеша, и ветка не должна оживать ни от чего другого.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSrc = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");
/** Всё, что нужно выдаче: tbDebugFullDraw, drawSection, orderQuestions, generateVariant. */
const drawSrc = appSrc.slice(0, appSrc.indexOf("function renderResults"));

type RuntimeQuestion = { id: string; type: string; data: unknown };
type RuntimeSection = {
  topicId: string;
  topicName: string;
  drawCount: number;
  questions: RuntimeQuestion[];
  formSet?: { forms: { id: string; questionIds: string[] }[] };
  drawBlueprint?: { strata: { tag: string; count: number }[] };
};

const identityShuffle = <T>(arr: T[]): T[] => arr.slice();

/** Достаёт из рантайма пакета одну функцию, подсунув ей нужное окружение. */
function runtime<T>(name: string, env: Record<string, unknown> = {}): T {
  const keys = ["state", "TEST_DATA", "shuffle", "shuffleMappingFor", "window", ...Object.keys(env)];
  const values = [
    env.state ?? {},
    env.TEST_DATA ?? { sections: [], flowPolicy: { mode: "linear_flat" } },
    identityShuffle,
    () => null,
    env.window ?? { location: { hash: "" } },
    ...Object.values(env),
  ];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(...keys, `${drawSrc}\n;return ${name};`)(...values) as T;
}

/** Прогоняет выдачу на фикстуре и возвращает идентификаторы выданных вопросов. */
function deliver(sections: RuntimeSection[], hash: string): string[] {
  const state: Record<string, unknown> = {};
  const TEST_DATA = { sections, flowPolicy: { mode: "linear_flat" } };
  const generateVariant = runtime<() => void>("generateVariant", {
    state, TEST_DATA, window: { location: { hash } },
  });
  generateVariant();
  return (state.flatQuestions as { question: RuntimeQuestion }[]).map((fq) => fq.question.id);
}

const q = (id: string): RuntimeQuestion => ({ id, type: "single", data: {} });

/** Банк из 12 вопросов при выдаче трёх — разница видна сразу. */
function bank(size: number): RuntimeQuestion[] {
  return Array.from({ length: size }, (_, i) => q(`q${i + 1}`));
}

const plainSection = (): RuntimeSection => ({
  topicId: "tp1", topicName: "О компании", drawCount: 3, questions: bank(12),
});

describe("tbDebugFullDraw — чтение флага", () => {
  const read = (hash: string) =>
    runtime<(win?: unknown) => boolean>("tbDebugFullDraw")({ location: { hash } });

  it("без хеша режим выключен — это состояние прода", () => {
    expect(read("")).toBe(false);
  });

  it("посторонний хеш не включает режим", () => {
    expect(read("#anchor")).toBe(false);
    expect(read("#tbff=%7B%7D")).toBe(false);
  });

  it("мусор в значении флага не включает режим", () => {
    expect(read("#tbfa=да")).toBe(false);
    expect(read("#tbfa=")).toBe(false);
    expect(read("#tbfa=10")).toBe(false);
  });

  it("флаг включает режим — и рядом с другими параметрами тоже", () => {
    expect(read("#tbfa=1")).toBe(true);
    expect(read("#tbff=%7B%7D&tbfa=1")).toBe(true);
  });
});

describe("выдача в режиме полной выдачи", () => {
  it("обычный прогон отдаёт настроенную выборку", () => {
    expect(deliver([plainSection()], "")).toHaveLength(3);
  });

  it("режим отдаёт весь банк темы", () => {
    expect(deliver([plainSection()], "#tbfa=1")).toHaveLength(12);
  });

  it("тема в режиме вариантов отдаёт БАНК, а не объединение форм", () => {
    const section: RuntimeSection = {
      topicId: "tp1", topicName: "О компании", drawCount: 3, questions: bank(12),
      formSet: { forms: [
        { id: "f1", questionIds: ["q1", "q2", "q3"] },
        { id: "f2", questionIds: ["q4", "q5"] },
      ] },
    };
    expect(deliver([section], "#tbfa=1")).toHaveLength(12);
  });

  it("тег-квоты в этом режиме не сужают выдачу", () => {
    const section: RuntimeSection = {
      topicId: "tp1", topicName: "О компании", drawCount: 3, questions: bank(12),
      drawBlueprint: { strata: [{ tag: "Стратегия", count: 2 }] },
    };
    expect(deliver([section], "#tbfa=1")).toHaveLength(12);
  });

  it("несколько тем отдают свои банки целиком, без пересечений", () => {
    const a: RuntimeSection = { topicId: "a", topicName: "A", drawCount: 2, questions: [q("a1"), q("a2"), q("a3")] };
    const b: RuntimeSection = { topicId: "b", topicName: "B", drawCount: 1, questions: [q("b1"), q("b2")] };
    const ids = deliver([a, b], "#tbfa=1");
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });
});
