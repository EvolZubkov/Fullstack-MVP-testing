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
import path from "node:path";
import { resolveScreenLabels } from "../server/services/result-context";
import { readResultsDeclarations } from "../server/services/template-render";
import { buildSectionResultContext } from "@shared/template/result-context";
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

  it("разводит экраны, когда объявление задаёт умолчание адаптивным итогам", () => {
    // Ради этого разрешение и делается для КАЖДОГО экрана отдельно — и на вебе, и на
    // сборке пакета: одна карта на все экраны напечатала бы здесь «Ваш результат».
    const decls: LabelDeclaration[] = [
      {
        key: "results.heading",
        group: "Первый уровень",
        label: "Зонтик",
        default: "Ваш результат",
        defaults: { "results.adaptive": "Ваш уровень" },
      },
    ];
    expect(resolveScreenLabels(decls, BASE, "results")["results.heading"]).toBe("Ваш результат");
    expect(resolveScreenLabels(decls, BASE, "results.adaptive")["results.heading"]).toBe("Ваш уровень");
    // Своя формулировка автора — одна на все экраны, она перекрывает и умолчание экрана.
    const design = { ...BASE, labels: { "results.heading": { on: true, text: "Итог" } } };
    expect(resolveScreenLabels(decls, design, "results.adaptive")["results.heading"]).toBe("Итог");
  });
});

/**
 * Итоги РАЗДЕЛА на вебе (PRD-49). Экран собирается в браузере
 * (`client/src/pages/learner/take-test.tsx`), но надписи ему разрешает СЕРВЕР — тем же
 * адаптером и против того же манифеста, что и экрану итогов, — и отдаёт готовой плоской
 * картой в ответе `POST /attempts/:id/section-result`. Здесь проверяется вся эта цепочка,
 * от манифеста стандартного шаблона до дерева контекста, которое печатает макет.
 */
describe("надписи итогов раздела на веб-хосте (PRD-49)", () => {
  const DEFAULT_TEMPLATE_DIR = path.resolve(process.cwd(), "server/scorm/templates/default");

  const SECTION_INPUT = {
    topicName: "Раздел",
    correct: 3,
    total: 5,
    percent: 60,
    passed: null,
    courseTitle: "Тест",
  };

  it("манифест стандартного шаблона объявляет надписи этого экрана", () => {
    const declarations = readResultsDeclarations(DEFAULT_TEMPLATE_DIR);
    const labels = resolveScreenLabels(declarations.labels, BASE, "section-results");
    expect(labels["section.eyebrow"]).toBe("Итоги раздела");
    expect(labels["facts.questions"]).toBe("вопросов");
  });

  it("разрешённая карта доезжает до контекста экрана деревом", () => {
    const declarations = readResultsDeclarations(DEFAULT_TEMPLATE_DIR);
    const design = { ...BASE, labels: { "section.eyebrow": { on: true, text: "Итоги части" } } };
    const labels = resolveScreenLabels(declarations.labels, design, "section-results");
    const ctx = buildSectionResultContext(SECTION_INPUT, { labels });
    const tree = ctx.labels as { section: { eyebrow: string }; facts: { correct: string } };
    expect(tree.section.eyebrow).toBe("Итоги части");
    // Дерево строит ЯДРО: хост отдаёт ему плоскую карту и ничего не разворачивает сам.
    expect(tree.facts.correct).toBe("верно");
  });

  it("выключенная надпись доезжает пустой строкой, а не пропадает", () => {
    const declarations = readResultsDeclarations(DEFAULT_TEMPLATE_DIR);
    const design = { ...BASE, labels: { "section.eyebrow": { on: false } } };
    const labels = resolveScreenLabels(declarations.labels, design, "section-results");
    const ctx = buildSectionResultContext(SECTION_INPUT, { labels });
    expect((ctx.labels as { section: { eyebrow: string } }).section.eyebrow).toBe("");
  });

  it("шаблон без объявлений не добавляет экрану ключа labels", () => {
    const labels = resolveScreenLabels([], BASE, "section-results");
    // Ровно то условие, по которому маршрут не кладёт карту в ответ, а страница — в опции.
    expect(Object.keys(labels).length).toBe(0);
    expect(buildSectionResultContext(SECTION_INPUT, {}).labels).toBeUndefined();
  });
});
