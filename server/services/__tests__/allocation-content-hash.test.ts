/**
 * @module server/services/__tests__/allocation-content-hash
 *
 * PRD-44 FR-53: the budget and the per-option domain are CONTENT of a question, so they
 * must reach `content_hash` — the value PRD-15 publication uses to notice that a topic
 * the test draws from has drifted since publish, and the same value the per-test scoring
 * override pins itself to for staleness.
 *
 * The spec says this «is fixed by a test, not assumed», and for a good reason: the hash
 * is computed over `dataJson` as a whole, so it happens to cover the new fields — until
 * someone gives the type its own hashing branch or normalises `dataJson` on the way in.
 * A question whose budget changed from 7 to 10 while the hash stayed put is a published
 * test that silently delivers a different questionnaire.
 */
import { describe, expect, it } from "vitest";
import { computeQuestionHash } from "../questions-import";

const spec = (over: Record<string, unknown> = {}) => ({
  options: ["Разбор задачи", "Знакомство с командой", "Регламент", "Смысл работы"],
  budget: 7,
  minPerOption: 0,
  maxPerOption: 7,
  ...over,
});

const hash = (data: unknown) => computeQuestionHash("allocation", "Как вы распределите внимание?", data);

describe("content_hash вопроса-распределения (FR-53)", () => {
  it("одинаковая конфигурация даёт одинаковый хеш", () => {
    expect(hash(spec())).toBe(hash(spec()));
  });

  it("изменённый бюджет МЕНЯЕТ хеш", () => {
    // Иначе опубликованный тест молча выдавал бы другой опросник: тот же вопрос,
    // другой бюджет — другой профиль на выходе.
    expect(hash(spec({ budget: 10 }))).not.toBe(hash(spec()));
  });

  it("изменённый минимум на вариант МЕНЯЕТ хеш", () => {
    expect(hash(spec({ minPerOption: 1 }))).not.toBe(hash(spec()));
  });

  it("изменённый максимум на вариант МЕНЯЕТ хеш", () => {
    expect(hash(spec({ maxPerOption: 4 }))).not.toBe(hash(spec()));
  });

  it("изменённое утверждение МЕНЯЕТ хеш", () => {
    expect(hash(spec({ options: ["Разбор задачи", "Знакомство", "Регламент", "Смысл"] }))).not.toBe(hash(spec()));
  });

  it("порядок утверждений содержателен: перестановка МЕНЯЕТ хеш", () => {
    // Ответ хранится индексами в авторском порядке, а вклады в шкалы ключуются теми же
    // индексами — перестановка утверждений переносит баллы на другую шкалу.
    const swapped = spec({ options: ["Знакомство с командой", "Разбор задачи", "Регламент", "Смысл работы"] });
    expect(hash(swapped)).not.toBe(hash(spec()));
  });

  it("тип участвует в хеше: та же форма данных у другого типа даёт другой хеш", () => {
    expect(computeQuestionHash("single", "Как вы распределите внимание?", spec())).not.toBe(hash(spec()));
  });
});
