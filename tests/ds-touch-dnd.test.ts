/**
 * @module tests/ds-touch-dnd
 * @description Гарды тач-перетаскивания. DS-таблица лежит в репозитории ДВУМЯ копиями
 * (`vendor/ui-kit` — источник, попадает в SCORM-пакет; `client/src/styles/vendor` —
 * то, что грузит веб). Правка в одной копии без второй расходит хосты молча, и это уже
 * случалось. Здесь же фиксируется, почему `touch-action` стоит именно на ручке.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DRAG_START_SLOP } from "../shared/template/dnd/pointer-dnd";

const VENDOR = path.resolve(__dirname, "../vendor/ui-kit/css/university-rt.css");
const CLIENT = path.resolve(__dirname, "../client/src/styles/vendor/university-rt.css");

const vendorCss = fs.readFileSync(VENDOR, "utf8");
const clientCss = fs.readFileSync(CLIENT, "utf8");

describe("две копии DS-таблицы", () => {
  it("совпадают побайтово", () => {
    expect(clientCss).toBe(vendorCss);
  });
});

describe("тач-перетаскивание", () => {
  /**
   * Объявления ПЕРВОГО правила, чей список селекторов равен заданному.
   *
   * Точное сравнение обязательно: подстрока `.ou-rank__grip` встречается ещё и в
   * `.ou-rank--no-grip .ou-rank__grip`. Комментарии снимаются заранее — иначе в
   * захват селектора попадает предшествующий ему комментарий, базовое правило не
   * находится, и поиск доезжает до одноимённого правила внутри `@media`.
   */
  function block(css: string, selector: string): string {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1].trim() === selector) return m[2];
    }
    throw new Error(`нет правила с селектором ровно "${selector}"`);
  }

  it("ручка ранжирования отключает жесты браузера", () => {
    // Без этого тач-жест уходит в прокрутку, движок получает pointercancel, и
    // перетаскивание в вопросах на ранжирование на телефоне не работает вовсе.
    expect(block(vendorCss, ".ou-rank__grip")).toMatch(/touch-action:\s*none/);
  });

  it("карточка сопоставления отключает жесты браузера", () => {
    expect(vendorCss).toMatch(/\.ou-match__card--drag[\s\S]{0,400}?touch-action:\s*none/);
  });

  it("строка ранжирования целиком НЕ отключает жесты — иначе теряется прокрутка списка", () => {
    expect(block(vendorCss, ".ou-rank__item")).not.toMatch(/touch-action/);
  });
});

describe("сетка сопоставления переопределяема", () => {
  const render = fs.readFileSync(
    path.resolve(__dirname, "../shared/template/question-interaction.ts"),
    "utf8",
  );

  it("рендерер отдаёт пропорцию колонок переменной, а не инлайновым track list", () => {
    // Инлайновый `grid-template-columns` не перебивается ничем, кроме `!important`:
    // из-за него сворачивание сетки на узком экране не работало вовсе, а колонка-зазор
    // при этом пряталась — три трека на два элемента, и карточки наезжали друг на друга.
    // Именно КОРЕНЬ сетки: `ou-match__card` тоже начинается с `ou-match`.
    const tag = render.match(/<div class="ou-match ou-match--[^`]*?>/);
    expect(tag, "не найден корневой тег .ou-match").toBeTruthy();
    expect(tag![0]).toContain("--ou-match-cols:");
    expect(tag![0]).not.toMatch(/style="grid-template-columns/);
  });

  it("DS читает эту переменную с прежним значением по умолчанию", () => {
    // Фолбэк обязан повторять прежний жёсткий track list, иначе потребитель,
    // который переменную не ставит, получит другую раскладку.
    expect(vendorCss).toMatch(
      /grid-template-columns:\s*var\(--ou-match-cols,\s*minmax\(0, 1fr\)\s*var\(--ou-match-gap-w\)\s*minmax\(0, 1fr\)\)/,
    );
  });
});

describe("движок перетаскивания", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../shared/template/dnd/pointer-dnd.ts"),
    "utf8",
  );

  it("порог старта рассчитан на палец", () => {
    expect(DRAG_START_SLOP).toBe(8);
  });

  it("дефолтный cardSelector называет компоненты, которые рендерер реально выдаёт", () => {
    const m = src.match(/config\.cardSelector\s*\|\|\s*"([^"]+)"/);
    expect(m).toBeTruthy();
    const sel = m![1];
    expect(sel).toContain(".ou-rank__item");
    expect(sel).toContain(".ou-match__card--drag");
    // Прежний дефолт указывал на разметку, живущую только в легаси-превью.
    expect(sel).not.toContain(".rank-item");
    expect(sel).not.toContain(".match-tile");
  });
});
