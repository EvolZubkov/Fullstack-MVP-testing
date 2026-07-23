/**
 * @module tests/template-render-themes
 *
 * PRD-23: what the web host receives for a THEMED template. The payload must split
 * the author's branding in two — params that paint the same in both palettes stay
 * inline (`cssVars`), colours become a CSS block (`themeCss`) scoped to the palette.
 * Getting this wrong is invisible in a screenshot of one theme and wrong in the
 * other, so it is locked here rather than left to the eye.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readScreenTemplate } from "../server/services/template-render";

let root: string;

/** Writes a minimal template dir; `themes` is omitted for the themeless case. */
function writeTemplate(id: string, themes?: unknown): string {
  const dir = path.join(root, id);
  fs.mkdirSync(path.join(dir, "layouts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "styles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "layouts", "start.html"), "<div class=\"screen\"></div>");
  fs.writeFileSync(path.join(dir, "styles", "base.css"), ".screen{display:block}");
  fs.writeFileSync(
    path.join(dir, "styles", "theme.css"),
    ":root{--primary: 0 0% 0%; --background: 0 0% 100%; --font-sans: Inter}",
  );
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      id,
      params: [
        { key: "primaryColor", type: "color", cssVar: "--primary" },
        { key: "fontFamily", type: "select", cssVar: "--font-sans" },
      ],
      ...(themes ? { themes } : {}),
    }),
  );
  return dir;
}

let themedDir: string;
let flatDir: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-themes-"));
  themedDir = writeTemplate("themed", [
    { id: "light", label: "Светлая" },
    { id: "dark", label: "Тёмная" },
  ]);
  flatDir = writeTemplate("flat");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("readScreenTemplate — themed template (PRD-23)", () => {
  it("prints colours as a :host-scoped block and keeps the rest inline", () => {
    const payload = readScreenTemplate(themedDir, "start.html", {
      params: { fontFamily: "Rostelecom Basis" },
      paramsByTheme: { light: { primaryColor: "L" }, dark: { primaryColor: "D" } },
    })!;
    expect(payload).not.toBeNull();
    // The palette-independent param still travels inline…
    expect(payload.cssVars).toEqual({ "--font-sans": "Rostelecom Basis" });
    // …and the colour does not, or it would freeze one palette.
    expect(payload.cssVars).not.toHaveProperty("--primary");
    expect(payload.themeCss).toContain(":host { --primary: L; }");
    expect(payload.themeCss).toContain(':host([data-theme="dark"]) { --primary: D; }');
  });

  it("passes the pinned palette as dataTheme and omits it for «Авто»", () => {
    const pinned = readScreenTemplate(themedDir, "start.html", {
      theme: "dark",
      paramsByTheme: { dark: { primaryColor: "D" } },
    })!;
    expect(pinned.dataTheme).toBe("dark");

    const auto = readScreenTemplate(themedDir, "start.html", {
      theme: "auto",
      paramsByTheme: { dark: { primaryColor: "D" } },
    })!;
    expect(auto.dataTheme).toBeUndefined();
  });

  it("carries a colour saved flat into both palettes (FR-17)", () => {
    const payload = readScreenTemplate(themedDir, "start.html", {
      params: { primaryColor: "OLD" },
    })!;
    expect(payload.themeCss).toContain(":host { --primary: OLD; }");
    expect(payload.themeCss).toContain(':host([data-theme="dark"]) { --primary: OLD; }');
  });
});

describe("readScreenTemplate — template without themes", () => {
  it("keeps the pre-PRD-23 payload exactly: colours inline, no theme fields", () => {
    const payload = readScreenTemplate(flatDir, "start.html", {
      params: { primaryColor: "217 91% 42%", fontFamily: "Inter" },
    })!;
    expect(payload.cssVars).toEqual({ "--primary": "217 91% 42%", "--font-sans": "Inter" });
    expect(payload).not.toHaveProperty("themeCss");
    expect(payload).not.toHaveProperty("dataTheme");
  });
});
