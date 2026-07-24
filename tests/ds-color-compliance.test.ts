/**
 * @module tests/ds-color-compliance
 * @description Цвет в приложении приходит из токенов DS (`--ou-*`) или из палитры
 * шаблона оформления. Литерал (`#hex` / `rgb()` / `hsl()` с числами) — исключение,
 * которое живёт в ALLOWED и объясняется там же. Новый литерал роняет тест.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("client/src");
const SKIP_DIRS = new Set(["vendor", "__tests__"]);
const EXT = new Set([".css", ".ts", ".tsx"]);

/** Literal colour: #rgb/#rrggbb(aa), rgb()/rgba(), hsl()/hsla() with a numeric first arg. */
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]|hsla?\(\s*[\d.$]/;

/** Known, justified literals: file → why. Everything else must use tokens. */
const ALLOWED: Record<string, string> = {
  "index.css": "легаси-палитра, вычищается задачей 5",
  "styles/preflight.css": "сброс на legacy --border, переводится задачей 5",
  "styles/tb-components.css": "фолбэки внутри var(--ou-…, …)",
  "features/tests/editor/sections/color-format.ts": "утилита конвертации цвета",
  "features/tests/editor/sections/design-section.tsx": "#000000 — значение по умолчанию пипетки",
  // ↓ вычёркиваются по мере выполнения плана PLAN_DS_COLOR_COMPLIANCE
  "pages/author/analytics.tsx": "задача 4",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
      continue;
    }
    if (EXT.has(path.extname(entry.name))) out.push(path.join(dir, entry.name));
  }
  return out;
}

describe("цвета приложения приходят из токенов", () => {
  it("литералы встречаются только в объяснённых местах", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (ALLOWED[rel]) continue;
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (LITERAL.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("список исключений не разрастается молча", () => {
    expect(Object.keys(ALLOWED).length).toBeLessThanOrEqual(10);
  });
});
