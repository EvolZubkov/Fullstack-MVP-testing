/**
 * @module tests/runtime.duration-format
 * @description The in-package runtime prints time budgets through the SHARED
 * duration formatter (`TBTemplate`), not through a plain-JS copy of its own.
 *
 * Both the countdown in the scene header and the section-intro limit used to be
 * formatted inside the package: `M:SS` for the countdown («20160:00» on a
 * two-week budget) and a minute count with its own plural for the intro
 * («20160 минут»). The web host meanwhile formats both through
 * `shared/template/duration`, so the same test read differently in a browser and
 * in an LMS. These tests pin the delegation that removes the second copy — and
 * the degradation when the bundle is missing, where the countdown falls back to
 * the historical `M:SS` rather than throwing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatCountdown, formatMinutesHuman } from "../shared/template/duration";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Evaluate a runtime source file and hand back one symbol under test. */
function loadSymbol<T>(relPath: string, symbol: string): T {
  const src = readFileSync(path.resolve(__dirname, relPath), "utf8");
  return new Function(`${src}\nreturn ${symbol};`)() as T;
}

type WindowWithBundle = typeof globalThis & { TBTemplate?: Record<string, unknown> };

const win = globalThis as WindowWithBundle;

beforeEach(() => {
  // The real shared functions, exactly as the bundle exposes them to the package.
  win.TBTemplate = { formatCountdown, formatMinutesHuman };
});

afterEach(() => {
  delete win.TBTemplate;
});

describe("timer.js formatTime", () => {
  const load = () => loadSymbol<(s: number) => string>(
    "../server/scorm/template/app/timer/timer.js",
    "formatTime",
  );

  it("печатает отсчёт общим форматом — с часами и днями", () => {
    const formatTime = load();
    expect(formatTime(591)).toBe("9:51");
    expect(formatTime(9000)).toBe("2:30:00");
    expect(formatTime(1209600)).toBe("14 д 0:00:00");
  });

  it("без бандла деградирует к прежнему M:SS, а не падает", () => {
    delete win.TBTemplate;
    const formatTime = load();
    expect(formatTime(591)).toBe("9:51");
    expect(formatTime(-3)).toBe("0:00");
  });
});

describe("contentPage.js — интро раздела", () => {
  const load = () => loadSymbol<(inp: Record<string, unknown>) => { sectionIntro: { timeLimitLabel: string; hasTimeLimit: boolean } }>(
    "../server/scorm/template/app/render/contentPage.js",
    "buildSectionIntroFallback",
  );

  it("печатает лимит той же строкой, что и веб-хост", () => {
    const build = load();
    expect(build({ timeLimitMinutes: 20160 }).sectionIntro.timeLimitLabel).toBe("14 дней");
    expect(build({ timeLimitMinutes: 150 }).sectionIntro.timeLimitLabel).toBe("2 ч 30 мин");
    expect(build({ timeLimitMinutes: 17 }).sectionIntro.timeLimitLabel).toBe("17 мин");
  });

  it("без лимита строки нет", () => {
    const build = load();
    const { sectionIntro } = build({});
    expect(sectionIntro.hasTimeLimit).toBe(false);
    expect(sectionIntro.timeLimitLabel).toBe("");
  });
});
