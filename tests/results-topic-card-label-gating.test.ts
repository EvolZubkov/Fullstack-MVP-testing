// @vitest-environment jsdom
/**
 * @module tests/results-topic-card-label-gating
 *
 * PRD-49: слот карточки темы гейтится СВОЕЙ надписью — во всех поставляемых шаблонах.
 *
 * Тумблер «Показывать» у надписи разрешается в пустую строку (`shared/template/labels`),
 * и до этой проверки макеты пустую строку не замечали: вердикт печатался пустой ЦВЕТНОЙ
 * пилюлей, а «Правильно»/«Баллов» — строкой с пустым заголовком и осиротевшим числом
 * «4 / 5». То есть автор выключал надпись, а элемент оставался.
 *
 * Проверяется на ТРЁХ шаблонах сразу: паритет между поставляемым `default` и вынесенными
 * держится вручную, и правка, забытая в одном из них, иначе осталась бы незамеченной.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildResultContext, type ResultInput, type TopicInput } from "../shared/template/result-context";
import { TEMPLATE_IDS, TEMPLATE_NAMES, templateFile } from "./helpers/template-roots";

const TOPIC: TopicInput = {
  topicId: "t1", topicName: "Тема А", correct: 4, total: 5, percent: 80,
  earnedPoints: 4, possiblePoints: 5, passed: true,
};

const INPUT: ResultInput = {
  passed: true, percent: 80, totalQuestions: 5, correct: 4,
  earnedPoints: 4, possiblePoints: 5, topicResults: [TOPIC],
};

/** Полный словарь надписей карточки; `""` = автор выключил надпись. */
const labels = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  "topic.correct": "Правильно",
  "topic.points": "Баллов",
  "topic.verdict.passed": "Пройдено",
  "topic.verdict.failed": "Не пройдено",
  "topic.verdict.unknown": "",
  ...over,
});

/**
 * Карточка темы, отрисованная шаблоном `id`. `withPoints` включает строку «Баллов»:
 * `pointsLabel` заполняет только пакет, веб его не печатает вовсе.
 */
function card(id: (typeof TEMPLATE_IDS)[number], dict: Record<string, string>, withPoints = false) {
  const layout = fs.readFileSync(templateFile(id, "layouts/results.html"), "utf8");
  const context = buildResultContext(INPUT, "Тест", { labels: dict, withTopicPoints: withPoints });
  const root = document.createElement("div");
  renderScreenInto(root, { layout, context });
  const node = root.querySelector(".tb-topic-card");
  expect(node, `${TEMPLATE_NAMES[id]}: карточки темы нет вовсе`).toBeTruthy();
  return node!;
}

describe.each(TEMPLATE_IDS)("карточка темы шаблона «%s»", (id) => {
  it("печатает вердикт и строки, пока надписи включены", () => {
    const node = card(id, labels(), true);
    expect(node.querySelector(".ou-tag")?.textContent).toBe("Пройдено");
    const rows = Array.from(node.querySelectorAll(".ou-stat-row"));
    expect(rows.map((r) => r.querySelector(".ou-stat-row__title")?.textContent)).toEqual([
      "Правильно",
      "Баллов",
    ]);
    expect(rows.map((r) => r.querySelector(".tb-stat-val")?.textContent)).toEqual(["4 / 5", "4 / 5"]);
  });

  it("убирает вердикт ЦЕЛИКОМ, а не только слово", () => {
    // Пустая пилюля несёт цвет исхода — то есть продолжает говорить то, что автор скрыл.
    const node = card(id, labels({ "topic.verdict.passed": "" }));
    expect(node.querySelector(".ou-tag")).toBeNull();
    expect(node.textContent).toContain("Тема А");
  });

  it("убирает строку «Правильно» вместе с числом", () => {
    const node = card(id, labels({ "topic.correct": "" }));
    expect(node.querySelector(".ou-stat-row")).toBeNull();
    expect(node.textContent).not.toContain("4 / 5");
  });

  it("убирает строку «Баллов», не трогая «Правильно»", () => {
    const node = card(id, labels({ "topic.points": "" }), true);
    const rows = Array.from(node.querySelectorAll(".ou-stat-row"));
    expect(rows.map((r) => r.querySelector(".ou-stat-row__title")?.textContent)).toEqual([
      "Правильно",
    ]);
  });

  // Тема без порога не имеет вердикта, и умолчание `topic.verdict.unknown` пустое:
  // пилюли там быть не должно и без всяких тумблеров.
  it("не печатает пилюлю у темы без порога", () => {
    const layout = fs.readFileSync(templateFile(id, "layouts/results.html"), "utf8");
    const context = buildResultContext(
      { ...INPUT, topicResults: [{ ...TOPIC, passed: null }] },
      "Тест",
      { labels: labels() },
    );
    const root = document.createElement("div");
    renderScreenInto(root, { layout, context });
    expect(root.querySelector(".tb-topic-card .ou-tag")).toBeNull();
  });
});
