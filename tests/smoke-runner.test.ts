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

  it("appends the declared router variant the default omits from preview.routes", () => {
    // The default lists intro/info/summary in preview.routes but NOT its router
    // variant (`router.menu`), so exactly that one content variant is appended.
    expect(specs.length).toBe(manifest.preview.routes.length + 1);
    expect(specs.some((s) => s.route === "content.router")).toBe(true);
  });

  it("assigns each spec a unique id", () => {
    const ids = specs.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
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
    // PRD-1 §4.3: the default intro variant (intro.standard) carries a single
    // `instruction` author placeholder (topic name/count/time render from the section).
    const intro = specs.find((s) => s.route === "content.intro")!;
    expect(intro.requiredSlots).toEqual(["page-content"]);
    expect(intro.input.slots!["page-content"]).toContain('data-placeholder="instruction"');
    expect(String(intro.input.content!.values.instruction)).toContain("ответьте внимательно");
  });
});

// ─── comprehensive content-variant enumeration (PRD-3 §3.4) ──────────────────
//
// Regression: a template that declares several render variants of a content kind
// (e.g. two `intro`, two `info`) but lists only some in preview.routes must still
// produce a preview screen for EVERY declared intro/info/summary variant — so the
// «учебные страницы» and the extra render variants are not silently dropped.
describe("buildScreenInputs — every declared content variant is enumerated", () => {
  const multiManifest = {
    layouts: {
      shell: "shell.html",
      start: "layouts/start.html",
      content: "layouts/content.html",
      question: "layouts/question.html",
      results: "layouts/results.html",
    },
    contentTemplates: [
      { key: "intro.a", label: "Введение", kind: "intro", pageKind: "content.intro", placeholders: [{ key: "title", type: "text" }] },
      { key: "info.a", label: "Материал", kind: "info", pageKind: "content.info", placeholders: [{ key: "title", type: "text" }, { key: "body", type: "richText" }] },
      { key: "summary.a", label: "Итог", kind: "summary", pageKind: "content.summary", placeholders: [{ key: "title", type: "text" }] },
      { key: "router.a", label: "Меню", kind: "router", pageKind: "content.router", placeholders: [] },
      { key: "intro.b", label: "Введение 2", kind: "intro", pageKind: "content.intro", placeholders: [{ key: "title", type: "text" }] },
      { key: "info.b", label: "Материал 2", kind: "info", pageKind: "content.info", placeholders: [{ key: "title", type: "text" }, { key: "body", type: "richText" }] },
      { key: "questions.a", label: "Вопрос", kind: "questions", placeholders: [] },
    ],
    preview: {
      defaultRoute: "start",
      // Only ONE intro variant and NO info variant are listed here.
      routes: [
        { route: "start", label: "Старт" },
        { route: "content.intro", templateKey: "intro.a", label: "Введение" },
        { route: "content.summary", templateKey: "summary.a", label: "Итог" },
        { route: "question.single", questionId: "q1", label: "Вопрос" },
        { route: "results", label: "Результаты" },
      ],
    },
  };
  const multiDemo = {
    course: {
      title: "Демо",
      questionCount: 1,
      topics: [
        { id: "t1", title: "Тема 1", status: "available" },
        { id: "t2", title: "Тема 2", status: "locked" },
      ],
      contentPages: [
        { id: "p-intro", type: "intro", route: "content.intro", templateKey: "intro.a", values: { title: "A" } },
        { id: "p-info", type: "info", route: "content.info", templateKey: "info.a", values: { title: "M", body: "<p>x</p>" } },
        { id: "p-summary", type: "summary", route: "content.summary", templateKey: "summary.a", values: { title: "S" } },
      ],
      questions: [{ id: "q1", type: "single", prompt: "P?", options: [{ id: "o1", text: "a", correct: true }] }],
    },
    runtime: { result: { scorePercent: 80, status: "passed", passed: true } },
  };

  const specs = buildScreenInputs(multiDemo as any, multiManifest as any);

  it("includes BOTH intro variants and BOTH info variants", () => {
    const ids = specs.map((s) => s.id);
    expect(ids).toContain("intro.a");
    expect(ids).toContain("intro.b"); // declared but absent from preview.routes
    expect(ids).toContain("info.a"); // info kind entirely absent from preview.routes
    expect(ids).toContain("info.b");
    expect(ids).toContain("summary.a");
  });

  it("keeps every spec id unique even when variants share a route", () => {
    const intros = specs.filter((s) => s.route === "content.intro");
    expect(intros.map((s) => s.id).sort()).toEqual(["intro.a", "intro.b"]);
    const infos = specs.filter((s) => s.route === "content.info");
    expect(infos.map((s) => s.id).sort()).toEqual(["info.a", "info.b"]);
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
  });

  it("binds demo values by variant key, falling back to the kind's route page", () => {
    // info.a is bound to its own demo content page by templateKey.
    const infoA = specs.find((s) => s.id === "info.a")!;
    expect(infoA.input.content!.values.title).toBe("M");
    // info.b has no demo page of its own → reuses the content.info demo page by
    // route, so the appended variant still renders representative (non-empty)
    // content in the generic `content` layout the runtime uses.
    const infoB = specs.find((s) => s.id === "info.b")!;
    expect(infoB.input.content!.values.title).toBe("M");
    expect(infoB.layoutKey).toBe("content");
    expect(infoB.input.slots!["page-content"]).toContain('data-placeholder="body"');
  });

  it("enumerates the router variant (topic menu on demo topics) but NOT the questions kind", () => {
    // Router IS previewed — its screen carries the runtime topic-menu built from
    // the demo topics; the `questions` kind is shown via the question.* routes, not
    // as a content screen.
    expect(specs.some((s) => s.id === "questions.a")).toBe(false);
    const router = specs.find((s) => s.id === "router.a")!;
    expect(router.route).toBe("content.router");
    const html = router.input.slots!["page-content"];
    expect(html).toContain("router-topic-cards");
    expect(html).toContain("Тема 1");
    expect(html).toContain("router-topic-card--locked"); // t2 is locked
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
    // +1: the default's `router.menu` variant is appended (not in preview.routes).
    expect(report.total).toBe(manifest.preview.routes.length + 1);
    expect(report.passed).toBeGreaterThan(0);
    // The appended router screen renders the topic menu on the demo topics.
    const router = report.routes.find((r) => r.route === "content.router")!;
    expect(router.status).not.toBe("fail");
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
