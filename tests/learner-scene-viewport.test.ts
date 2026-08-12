/**
 * @module tests/learner-scene-viewport
 * @description Ученический экран — «сцена» ровно в окно: шапка и подвал закреплены,
 * скроллится только тело шаблона (`.tb-scene__body`), см. спецификацию ревизии
 * шаблона «Стандартный», раздел 3.3.
 *
 * Тест защищает ДВА свойства вёрстки хоста, без которых модель ломается молча:
 *
 * 1. корень экрана имеет ВЫСОТУ окна (`.tbh-screen`), а не `min-height`. С
 *    `min-height` длинный вопрос растит страницу: уезжают шапка с картой вопросов и
 *    подвал, а подгонка шрифта (`fitQuestionScene`) меряет переполнение `.tb-scene__body`,
 *    которое в растущей странице не наступает НИКОГДА — варианты остаются на
 *    максимальном кегле (дефект «прохождение в вебе», 2026-07-29);
 * 2. хост шаблона (`.tbh-fill`) может сжиматься (`min-height: 0`). Иначе flex-элемент
 *    не опускается ниже своего содержимого и выталкивает подвал за нижнюю кромку окна,
 *    где его срезает `overflow: hidden`.
 *
 * Геометрию (реальные высоты) проверяет браузерная приёмка; здесь фиксируется
 * контракт разметки и CSS, который она использует.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const HOST_CSS = fs.readFileSync(path.resolve("client/src/styles/tb-learner-host.css"), "utf8");

/** Body of a single CSS rule (first match), whitespace collapsed. */
function ruleBody(css: string, selector: string): string {
  const re = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`);
  return (css.match(re)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

/** Learner screens that mount a template scene and must fill the window. */
const SCENE_SCREENS = [
  "client/src/pages/learner/take-test.tsx",
  "client/src/pages/learner/template-question-screen.tsx",
  // Content screens (router hub, section intro, info pages) are scenes too: in the
  // package they fill the window with the footer pinned to the bottom edge, so a
  // content-sized host here would float that footer mid-screen.
  "client/src/pages/learner/template-content-screen.tsx",
];

describe("ученическая сцена занимает окно", () => {
  it("`.tbh-screen` задаёт высоту окна и прячет переполнение", () => {
    const body = ruleBody(HOST_CSS, ".tbh-screen");
    expect(body).toMatch(/height:\s*100dvh/);
    expect(body).toMatch(/overflow:\s*hidden/);
  });

  it("`.tbh-fill` может сжиматься, чтобы подвал остался в окне", () => {
    expect(ruleBody(HOST_CSS, ".tbh-fill")).toMatch(/min-height:\s*0/);
  });

  it("экраны со сценой используют `.tbh-screen`, а не растущий `min-height`", () => {
    for (const rel of SCENE_SCREENS) {
      const src = fs.readFileSync(path.resolve(rel), "utf8");
      expect(src, `${rel}: сцена смонтирована в контейнер с min-height`).not.toMatch(/tbh-minh-screen/);
      expect(src, `${rel}: не найден корень сцены .tbh-screen`).toMatch(/tbh-screen/);
    }
  });
});
