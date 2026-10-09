/**
 * @module features/analytics/levels/__tests__/trail
 * @description Путь возврата (замечание владельца 2026-10-05): цепочка крошек пройденного пути в
 * состоянии записи истории — сборка, обрезка при возврате на пройденный шаг, предел длины.
 */
import { describe, expect, it } from "vitest";

import { stateForDive, trailOf } from "../trail";

const BANK = { label: "Темы и вопросы", href: "/author/content?type=single", state: { ctTree: { expandedTopics: ["t1"] } } };
const BANK_Q = { label: "Вопрос банка", href: "/author/analytics/questions/q1" };

describe("trail", () => {
  it("переход вглубь уносит пройденный путь и текущий экран", () => {
    const state = stateForDive(null, BANK, "/author/analytics/questions/q1");
    expect(trailOf(state)).toEqual([BANK]);

    const deeper = stateForDive(trailOf(state), BANK_Q, "/author/analytics/tests/t1/questions/q1");
    expect(trailOf(deeper)).toEqual([BANK, BANK_Q]);
  });

  it("возврат на пройденный шаг другой дорогой обрезает путь до него", () => {
    const here = { label: "Вопрос в тесте", href: "/author/analytics/tests/t1/questions/q1" };
    // Банк → вопрос банка → вопрос в тесте → снова вопрос банка: путь не растёт.
    const state = stateForDive([BANK, BANK_Q], here, "/author/analytics/questions/q1?version=h1");
    expect(trailOf(state)).toEqual([BANK]);
  });

  it("путь без шагов и чужое состояние — пути нет", () => {
    expect(trailOf(null)).toBeNull();
    expect(trailOf({ trail: [] })).toBeNull();
    expect(trailOf({ trail: [{ nope: 1 }] })).toBeNull();
    expect(trailOf({ analyticsReturn: "/author/analytics" })).toBeNull();
  });

  it("путь не длиннее пяти шагов", () => {
    const long = Array.from({ length: 7 }, (_, i) => ({ label: `Шаг ${i}`, href: `/step/${i}` }));
    const state = stateForDive(long, { label: "Здесь", href: "/here" }, "/there");
    expect(trailOf(state)).toHaveLength(5);
    expect(trailOf(state)!.at(-1)!.label).toBe("Здесь");
  });
});
