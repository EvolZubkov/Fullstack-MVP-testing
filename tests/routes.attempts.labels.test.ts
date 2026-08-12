/**
 * PRD-49. Разрешение надписей на веб-хосте (`resolveScreenLabels`).
 *
 * Проверяется ровно граница между манифестом шаблона и настройками теста: умолчание
 * шаблона, своя формулировка автора, выключенная надпись и шаблон, надписей не
 * объявивший, — последний случай важнее прочих, потому что пустая карта НЕ должна
 * доезжать до построителя контекста (иначе экран получает пустое дерево `labels` там,
 * где ключа не было вовсе).
 */
import { describe, it, expect } from "vitest";
import { resolveScreenLabels } from "../server/services/result-context";
import type { LabelDeclaration } from "@shared/template/labels";
import type { DesignSettings } from "@shared/schema";

const MANIFEST_LABELS: LabelDeclaration[] = [
  { key: "results.scales", group: "Второй уровень", label: "Шкалы", default: "По шкалам" },
  { key: "results.heading", group: "Первый уровень", label: "Зонтик", default: "Ваш результат" },
  {
    key: "recommendations.courses",
    group: "Группы рекомендаций",
    label: "Курсы",
    default: "Пройти обучение",
    defaults: { report: "Рекомендации по курсам" },
  },
];

const BASE = {
  templateId: "default",
  templateVersion: "1.6.0",
  templateApiVersion: "1.0",
  params: {},
} as DesignSettings;

describe("resolveScreenLabels (PRD-49)", () => {
  it("отдаёт умолчания шаблона, когда тест ничего не сохранил", () => {
    const map = resolveScreenLabels(MANIFEST_LABELS, BASE, "results");
    expect(map["results.scales"]).toBe("По шкалам");
    expect(map["results.heading"]).toBe("Ваш результат");
  });

  it("берёт умолчание ЭКРАНА там, где объявление его задаёт", () => {
    expect(resolveScreenLabels(MANIFEST_LABELS, BASE, "report")["recommendations.courses"]).toBe(
      "Рекомендации по курсам",
    );
    expect(resolveScreenLabels(MANIFEST_LABELS, BASE, "results")["recommendations.courses"]).toBe(
      "Пройти обучение",
    );
  });

  it("применяет формулировку теста", () => {
    const design = { ...BASE, labels: { "results.scales": { on: true, text: "Профиль" } } };
    expect(resolveScreenLabels(MANIFEST_LABELS, design, "results")["results.scales"]).toBe("Профиль");
  });

  it("отдаёт пустую строку для выключенной надписи, не теряя остальных", () => {
    const design = { ...BASE, labels: { "results.scales": { on: false } } };
    const map = resolveScreenLabels(MANIFEST_LABELS, design, "results");
    expect(map["results.scales"]).toBe("");
    expect(map["results.heading"]).toBe("Ваш результат");
  });

  it("применяет слой переопределений поверх формулировки теста", () => {
    const design = { ...BASE, labels: { "results.scales": { on: true, text: "Профиль" } } };
    const map = resolveScreenLabels(MANIFEST_LABELS, design, "report", {
      "results.scales": { on: true, text: "Профиль по шкалам" },
    });
    expect(map["results.scales"]).toBe("Профиль по шкалам");
  });

  it("возвращает ПУСТУЮ карту для шаблона без объявлений", () => {
    expect(resolveScreenLabels(undefined, BASE, "results")).toEqual({});
    expect(resolveScreenLabels([], BASE, "results")).toEqual({});
    // …и даже когда у теста свои формулировки: объявляет надписи ШАБЛОН.
    const design = { ...BASE, labels: { "results.scales": { on: true, text: "Профиль" } } };
    expect(resolveScreenLabels(null, design, "results")).toEqual({});
  });
});
