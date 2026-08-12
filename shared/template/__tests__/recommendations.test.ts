// shared/template/__tests__/recommendations.test.ts
import { describe, it, expect } from "vitest";
import { collectRecommendations } from "../recommendations";

const COURSE = { title: "Управление нагрузкой", url: "https://lms/1" };

describe("collectRecommendations", () => {
  it("собирает пустой блок, когда источников нет", () => {
    const r = collectRecommendations([]);
    expect(r.hasAny).toBe(false);
    expect(r.texts).toEqual([]);
  });

  it("сохраняет порядок источников", () => {
    const r = collectRecommendations([
      { text: "Общая по тесту" },
      { text: "От профиля" },
      { text: "От шкалы" },
    ]);
    expect(r.texts).toEqual(["Общая по тесту", "От профиля", "От шкалы"]);
  });

  it("схлопывает одинаковые ссылки первым вхождением", () => {
    const r = collectRecommendations([
      { links: [COURSE] },
      { links: [{ ...COURSE }] },
    ]);
    expect(r.links).toHaveLength(1);
  });

  it("различает ссылки с одинаковым названием и разными адресами", () => {
    const r = collectRecommendations([
      { links: [COURSE, { title: COURSE.title, url: "https://lms/2" }] },
    ]);
    expect(r.links).toHaveLength(2);
  });

  it("схлопывает одинаковые тексты", () => {
    const r = collectRecommendations([{ text: "Отдых" }, { text: "Отдых" }]);
    expect(r.texts).toEqual(["Отдых"]);
  });

  it("игнорирует пустые и пробельные тексты", () => {
    const r = collectRecommendations([{ text: "   " }, { text: "" }]);
    expect(r.texts).toEqual([]);
    expect(r.hasAny).toBe(false);
  });

  it("разносит мероприятия и материалы по своим спискам", () => {
    const r = collectRecommendations([
      { events: [{ title: "Встреча группы" }], assets: [{ title: "Памятка.pdf", url: "/a.pdf" }] },
    ]);
    expect(r.events).toHaveLength(1);
    expect(r.assets).toHaveLength(1);
    expect(r.hasAny).toBe(true);
  });

  it("пропускает отсутствующие источники", () => {
    const r = collectRecommendations([null, undefined, { text: "Есть" }]);
    expect(r.texts).toEqual(["Есть"]);
  });
});
