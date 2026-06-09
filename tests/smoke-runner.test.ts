/**
 * @module tests/smoke-runner
 * @description Unit tests for the PRD-3 Phase 2 browser smoke-test engine
 * (shared/template/smoke-runner) and the demo-dataset bridge
 * (shared/template/preview-context). Runs under jsdom against the shipping
 * `default` template (the "default passes its own smoke-test" guard) plus broken
 * fixtures. No DB — pure renderer path.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildScreenInputs } from "../shared/template/preview-context";
import { runSmokeChecks } from "../shared/template/smoke-runner";

const DEFAULT_DIR = path.resolve(process.cwd(), "server", "scorm", "templates", "default");

function readJson(rel: string): any {
  return JSON.parse(fs.readFileSync(path.join(DEFAULT_DIR, rel), "utf-8"));
}

/** Load layout HTML keyed by the manifest layout key (the keys resolveLayoutKey returns). */
function loadLayouts(manifest: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, rel] of Object.entries(manifest.layouts as Record<string, string>)) {
    if (key === "shell") continue;
    out[key] = fs.readFileSync(path.join(DEFAULT_DIR, rel), "utf-8");
  }
  return out;
}

const manifest = readJson("manifest.json");
const demo = readJson("demo/course.json");
const layouts = loadLayouts(manifest);

// ─── preview-context bridge ─────────────────────────────────────────────────

describe("buildScreenInputs (demo dataset → screen specs)", () => {
  const specs = buildScreenInputs(demo, manifest);

  it("produces one spec per manifest.preview.routes entry", () => {
    expect(specs.length).toBe(manifest.preview.routes.length);
  });

  it("resolves layout keys with fallback (specific → general)", () => {
    const byRoute = Object.fromEntries(specs.map((s) => [s.route, s.layoutKey]));
    expect(byRoute["start"]).toBe("start");
    expect(byRoute["content.intro"]).toBe("content");
    expect(byRoute["question.single"]).toBe("question");
    expect(byRoute["question.matching"]).toBe("question");
    expect(byRoute["results"]).toBe("results");
    expect(byRoute["system.blocked"]).toBe("system.blocked");
  });

  it("question screens require the prompt + interaction slots, filled", () => {
    const q = specs.find((s) => s.route === "question.single")!;
    expect(q.requiredSlots).toEqual(["question-text", "question-interaction"]);
    expect(q.input.slots!["question-text"]).toContain("пароль");
    expect(q.input.slots!["question-interaction"]).toContain("radio");
  });

  it("content screens carry a placeholder skeleton in page-content", () => {
    const intro = specs.find((s) => s.route === "content.intro")!;
    expect(intro.requiredSlots).toEqual(["page-content"]);
    expect(intro.input.slots!["page-content"]).toContain('data-placeholder="title"');
    expect(intro.input.content!.values.title).toBe("Введение в раздел");
  });
});

// ─── smoke-runner: the shipping default passes ──────────────────────────────

describe("runSmokeChecks — default template passes its own smoke-test", () => {
  it("every preview screen renders without blocking errors", () => {
    const report = runSmokeChecks({ dataset: demo, manifest, layouts });
    const failing = report.routes.filter((r) => r.status === "fail");
    if (failing.length) {
      throw new Error("default failed smoke: " + JSON.stringify(failing, null, 2));
    }
    expect(report.ok).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.total).toBe(manifest.preview.routes.length);
    expect(report.passed).toBeGreaterThan(0);
  });

  it("passes a valid template.js and rules file as extra rows", () => {
    const report = runSmokeChecks({
      dataset: demo,
      manifest,
      layouts,
      templateJs: "(function(){ var x = 1; return x; })();",
      rulesJson: '{"rules":[]}',
    });
    expect(report.routes.find((r) => r.route === "template.js")!.status).toBe("pass");
    expect(report.routes.find((r) => r.route === "rules")!.status).toBe("pass");
    expect(report.ok).toBe(true);
  });
});

// ─── smoke-runner: broken fixtures fail ─────────────────────────────────────

describe("runSmokeChecks — broken templates fail", () => {
  it("fails a question screen whose layout drops the interaction slot", () => {
    const broken = { ...layouts, question: '<div class="q"><div data-slot="question-text"></div></div>' };
    const report = runSmokeChecks({ dataset: demo, manifest, layouts: broken });
    expect(report.ok).toBe(false);
    const q = report.routes.find((r) => r.route === "question.single")!;
    expect(q.status).toBe("fail");
    expect(q.errors.join(" ")).toContain("question-interaction");
  });

  it("fails a screen whose layout throws on bad DSL", () => {
    const broken = { ...layouts, start: "{{#if state.canStart}} нет закрывающего тега" };
    const report = runSmokeChecks({ dataset: demo, manifest, layouts: broken });
    const start = report.routes.find((r) => r.route === "start")!;
    expect(start.status).toBe("fail");
    expect(start.errors.join(" ")).toContain("Ошибка отрисовки");
  });

  it("fails when a layout is missing entirely", () => {
    const broken = { ...layouts };
    delete broken.results;
    const report = runSmokeChecks({ dataset: demo, manifest, layouts: broken });
    const res = report.routes.find((r) => r.route === "results")!;
    expect(res.status).toBe("fail");
    expect(res.errors.join(" ")).toContain("макет");
  });

  it("fails on a template.js syntax error and invalid rules JSON", () => {
    const report = runSmokeChecks({
      dataset: demo,
      manifest,
      layouts,
      templateJs: "function (){ this is not valid",
      rulesJson: "{ broken",
    });
    expect(report.routes.find((r) => r.route === "template.js")!.status).toBe("fail");
    expect(report.routes.find((r) => r.route === "rules")!.status).toBe("fail");
    expect(report.ok).toBe(false);
  });
});
