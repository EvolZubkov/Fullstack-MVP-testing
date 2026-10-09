/**
 * @module tests/editor-status-dot-css
 * @description Гард видимости точки состояния (`tb-status-dot`) — контракт
 * «Индикация проблем», строка «Вкладка ящика | ТОЧКА»
 * (`docs/architecture/test-editor-contracts.md`).
 *
 * Точка задаётся `width`/`height`, а они НЕ применяются к строчному
 * (не заменяемому) элементу. В рейле точка — дочерний элемент flex-кнопки, поэтому
 * там бокс блочный и размер работает; подпись вкладки ui-kit заворачивает в
 * `span.ou-tabs__label` с `display: block`, и та же точка схлопывалась в ноль ширины.
 * Автор видел баннер «Название обязательно», точку у «Состава» — и ни одной пометки
 * на вкладке «Основное», где поле названия и лежит.
 *
 * Обёртка подписи — внутренняя разметка ui-kit, поэтому отбивка не имеет права
 * опираться на прямое родство с `.ou-tabs__tab`: DS добавит ещё один узел — и отбивка
 * снова тихо исчезнет.
 *
 * Сверяются ОБЕ копии `tb-components.css`: продуктовая и та, что подключают эскизы.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const COPIES = [
  path.join(ROOT, "client", "src", "styles", "tb-components.css"),
  path.join(ROOT, "docs", "wireframes", "tb-components.css"),
];

/** Тело правила `.tb-status-dot { … }` из файла. */
function baseRule(css: string): string {
  const start = css.indexOf(".tb-status-dot {");
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start) + 1);
}

describe.each(COPIES)("tb-status-dot: %s", (file) => {
  const css = fs.readFileSync(file, "utf8");

  it("точка — блочный бокс, а не строчный: иначе width/height не действуют", () => {
    expect(baseRule(css)).toMatch(/display:\s*inline-block/);
  });

  it("отбивка во вкладке не зависит от обёртки подписи ui-kit", () => {
    expect(css).not.toMatch(/\.ou-tabs__tab\s*>\s*\.tb-status-dot/);
    expect(css).toMatch(/\.ou-tabs__tab\s+\.tb-status-dot/);
  });
});
