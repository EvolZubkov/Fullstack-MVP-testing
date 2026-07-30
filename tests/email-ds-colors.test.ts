/**
 * @module tests/email-ds-colors
 * @description Письма красятся палитрой дизайн-системы. Почтовые клиенты не
 * понимают ни CSS-переменные, ни `color-mix()`, поэтому значения токенов DS
 * разворачиваются в литералы в `server/email-theme.ts` — а этот тест сверяет их
 * с `vendor/ui-kit/css/university-rt.css`, чтобы разворот не разошёлся с DS,
 * и следит, что в самих письмах не осталось произвольных цветов.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EMAIL_COLORS, tintWithWhite } from "../server/email-theme";

const DS_CSS = fs.readFileSync(path.resolve("vendor/ui-kit/css/university-rt.css"), "utf8");

/** Value of a DS token declaration, e.g. `--ou-neutral-0: #FFFFFF;` -> `#FFFFFF`. */
function dsToken(name: string): string {
  const m = DS_CSS.match(new RegExp(`--ou-${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`DS token --ou-${name} not found`);
  return m[1].trim();
}

/** White share of a DS `color-mix(in oklch, #fff N%, …)` ramp step. */
function dsWhitePercent(name: string): number {
  const m = dsToken(name).match(/#fff\s+(\d+)%/i);
  if (!m) throw new Error(`--ou-${name} is not a white mix`);
  return Number(m[1]);
}

describe("палитра писем повторяет токены DS", () => {
  it("прямые токены совпадают со значениями из ui-kit", () => {
    expect(EMAIL_COLORS.accent).toBe(dsToken("purple-500"));
    expect(EMAIL_COLORS.accentText).toBe(dsToken("neutral-0"));
    expect(EMAIL_COLORS.surface).toBe(dsToken("neutral-0"));
    expect(EMAIL_COLORS.page).toBe(dsToken("neutral-50"));
    expect(EMAIL_COLORS.sunken).toBe(dsToken("neutral-100"));
    expect(EMAIL_COLORS.border).toBe(dsToken("neutral-200"));
    expect(EMAIL_COLORS.fg).toBe(dsToken("neutral-900"));
    expect(EMAIL_COLORS.fgMuted).toBe(dsToken("neutral-500"));
    expect(EMAIL_COLORS.warning).toBe(dsToken("warning-500"));
  });

  it("мягкие подложки повторяют долю осветления из ui-kit", () => {
    // Меняется якорь или доля в DS — тест краснеет, письма надо пересобрать.
    expect(EMAIL_COLORS.accentSoft).toBe(
      tintWithWhite(dsToken("purple-500"), dsWhitePercent("purple-50")),
    );
    expect(EMAIL_COLORS.warningSoft).toBe(
      tintWithWhite(dsToken("warning-500"), dsWhitePercent("warning-50")),
    );
  });

  it("значения оттенков зафиксированы (сверены с расчётом color-mix в браузере)", () => {
    expect(EMAIL_COLORS.accentSoft).toBe("#F2F0FF");
    expect(EMAIL_COLORS.warningSoft).toBe("#FFF8ED");
  });

  it("белый остаётся белым, чёрный якорь не выцветает полностью", () => {
    expect(tintWithWhite("#7700FF", 100)).toBe("#FFFFFF");
    expect(tintWithWhite("#7700FF", 0)).toBe("#7700FF");
  });
});

describe("письма не содержат цветов мимо палитры", () => {
  it("в server/email.ts нет литеральных цветов", () => {
    const source = fs.readFileSync(path.resolve("server/email.ts"), "utf8");
    const offenders = source
      .split(/\r?\n/)
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]|hsla?\(\s*[\d.]/.test(line))
      // Ссылки-«якоря» вида #L10 и подобное сюда не попадают: в письмах их нет.
      .map(({ line, no }) => `email.ts:${no}  ${line.slice(0, 80)}`);
    expect(offenders).toEqual([]);
  });

  it("именованные цвета (white/black/...) тоже не используются", () => {
    const source = fs.readFileSync(path.resolve("server/email.ts"), "utf8");
    expect(source).not.toMatch(/:\s*(white|black|red|orange|yellow|green|blue|gray|grey)\b/i);
  });
});
