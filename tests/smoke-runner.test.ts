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
import { buildScreenInputs, type PreviewManifest } from "../shared/template/preview-context";
import { runSmokeChecks } from "../shared/template/smoke-runner";

const DEFAULT_DIR = path.resolve(process.cwd(), "server", "scorm", "templates", "default");

function readJson(rel: string): any {
  return JSON.parse(fs.readFileSync(path.join(DEFAULT_DIR, rel), "utf-8"));
}

/**
 * Load layout HTML the way the real bundle readers do (`readTemplateBundle` /
 * the admin smoke-bundle): keyed by BOTH the `manifest.layouts` key and each
 * `contentTemplates[].layoutFile` path — the two ways a screen names its layout
 * (spec §8.2), and the two kinds of key `resolveLayoutKey` returns.
 */
function loadLayouts(manifest: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, rel] of Object.entries(manifest.layouts as Record<string, string>)) {
    if (key === "shell") continue;
    out[key] = fs.readFileSync(path.join(DEFAULT_DIR, rel), "utf-8");
  }
  for (const ct of (manifest.contentTemplates ?? []) as Array<{ layoutFile?: string }>) {
    if (!ct.layoutFile || out[ct.layoutFile] != null) continue;
    out[ct.layoutFile] = fs.readFileSync(path.join(DEFAULT_DIR, ct.layoutFile), "utf-8");
  }
  return out;
}

const manifest = readJson("manifest.json");
const demo = readJson("demo/course.json");
const layouts = loadLayouts(manifest);

/**
 * How many screens the default is expected to produce: one per `preview.routes[]`
 * entry plus one per declared content variant no route already covers. Computed
 * rather than hard-coded, because the PRD-22 variant grid grows the second term —
 * a fixed number would only ever pin the count of the day.
 */
function expectedScreenCount(): number {
  const covered = new Set(
    (manifest.preview.routes as Array<string | { route: string; templateKey?: string }>)
      .map((r) => (typeof r === "string" ? undefined : r.templateKey))
      .filter(Boolean),
  );
  // Mirror the source's CONTENT_VARIANT_KINDS (shared/template/preview-context):
  // `summary` is the LEGACY «Итог раздела» kind — PRD-19 made it an invisible flow
  // boundary (its role is now the computed section-results node), so it is NOT
  // enumerated as a preview screen. Keeping it here over-counted by one.
  const kinds = new Set(["intro", "info", "router"]);
  const appended = (manifest.contentTemplates as Array<{ key: string; kind?: string }>).filter(
    (c) => kinds.has(c.kind ?? "") && !covered.has(c.key),
  );
  return manifest.preview.routes.length + appended.length;
}

/**
 * Сколько строк отчёта ждём в отчёте проверки: по ОДНОМУ варианту на объявленный вид
 * (PRD-27 FR-26). Тоже считается, а не пишется числом: шаблон вправе объявить только
 * обычный вид, только адаптивный или оба.
 */
function expectedReportRows(): number {
  const kinds = new Set(
    (manifest.contentTemplates as Array<{ kind?: string }>)
      .map((c) => c.kind ?? "")
      .filter((k) => k === "report" || k === "report.adaptive"),
  );
  return kinds.size;
}

// ─── preview-context bridge ─────────────────────────────────────────────────

describe("buildScreenInputs (demo dataset → screen specs)", () => {
  const specs = buildScreenInputs(demo, manifest);

  it("appends every declared content variant preview.routes omits", () => {
    // The default lists only intro/summary in preview.routes; its router variant
    // and the whole PRD-22 variant grid are appended from `contentTemplates[]`, so
    // no variant the author can pick is missing from the preview.
    expect(specs.length).toBe(expectedScreenCount());
    expect(specs.some((s) => s.route === "content.router")).toBe(true);
    const gridKeys = (manifest.contentTemplates as Array<{ key: string }>)
      .map((c) => c.key)
      .filter((k) => /^(info|gallery)\./.test(k));
    expect(gridKeys.length).toBe(12);
    for (const key of gridKeys) expect(specs.some((s) => s.variantKey === key)).toBe(true);
  });

  it("assigns each spec a unique id", () => {
    const ids = specs.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Regression: `certification` previews TWO gallery screens (gallery-1 / gallery-2)
  // bound to ONE variant (`gallery.card`). Keying identity on the variant collided —
  // duplicate ids break the rail's per-screen status and React keys.
  it("keeps screens that share one variant distinct (id from the bound page)", () => {
    const manifestTwoPages: PreviewManifest = {
      layouts: { shell: "shell.html", content: "layouts/content.html" },
      contentTemplates: [
        { key: "gallery.card", label: "Галерея", kind: "gallery", pageKind: "content.gallery" },
      ],
      preview: {
        routes: [
          { route: "content.gallery.1", pageId: "gallery-1", label: "Галерея 1" },
          { route: "content.gallery.2", pageId: "gallery-2", label: "Галерея 2" },
        ],
      },
    };
    const ds = {
      course: {
        title: "T",
        contentPages: [
          { id: "gallery-1", type: "gallery", route: "content.gallery", templateKey: "gallery.card", values: {} },
          { id: "gallery-2", type: "gallery", route: "content.gallery", templateKey: "gallery.card", values: {} },
        ],
      },
    } as any;
    const ids = buildScreenInputs(ds, manifestTwoPages)
      .filter((s) => s.route.startsWith("content.gallery"))
      .map((s) => s.id);
    expect(ids).toEqual(["gallery-1", "gallery-2"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves a variant-backed screen through its layoutFile, not a page-kind key", () => {
    // Rule §8.2: the variant's `layoutFile` names the layout. A key named after the
    // page kind (`layouts["content.intro"]`) is NOT part of the contract — the
    // runtime never reads one either.
    const byRoute = Object.fromEntries(specs.map((s) => [s.route, s.layoutKey]));
    expect(byRoute["start"]).toBe("layouts/start.html"); // start.standard.layoutFile
    expect(byRoute["results"]).toBe("layouts/results.html"); // results.standard
  });

  it("resolves «Введение раздела» by the fixed section-intro key, as the runtime does", () => {
    // `contentPage.js → renderSectionIntro` reads `layouts["section-intro"]`, NOT the
    // intro variant's layoutFile — the resolver must not diverge from it.
    const byRoute = Object.fromEntries(specs.map((s) => [s.route, s.layoutKey]));
    expect(byRoute["content.intro"]).toBe("section-intro");
  });

  it("an intro variant without a section-intro layout renders as a plain content page", () => {
    // Builder-exported templates bind `kind: intro` to an ordinary page layout and
    // declare no `section-intro` key. The runtime falls through to the generic content
    // render; keying the pipeline on layoutFile would preview an empty screen.
    const plainIntro: PreviewManifest = {
      layouts: { shell: "shell.html", content: "layouts/content.html" },
      contentTemplates: [
        {
          key: "intro.builder",
          label: "Введение",
          kind: "intro",
          pageKind: "content.intro",
          layoutFile: "layouts/page-1.html",
          placeholders: [{ key: "title", type: "text" } as any],
        },
      ],
      preview: { routes: [{ route: "content.intro", label: "Введение" }] },
    };
    const spec = buildScreenInputs({ course: { title: "T" } } as any, plainIntro)[0];
    expect(spec.layoutKey).toBe("layouts/page-1.html");
    // A variant-owned layout is not required to expose `page-content`: it places
    // the fields itself, marked `data-placeholder`. What it owes is checked
    // against the rendered DOM instead (see «поля варианта не попадут на экран»).
    expect(spec.expectedSlots).toEqual([]);
  });

  it("falls back to the generic layout when the variant declares no layoutFile", () => {
    // router/questions ship without a layoutFile in the default and render through
    // the generic `content`/`question` layouts — as the runtime does.
    const byRoute = Object.fromEntries(specs.map((s) => [s.route, s.layoutKey]));
    expect(byRoute["question.single"]).toBe("question");
    expect(byRoute["question.matching"]).toBe("question");
    expect(byRoute["content.router"]).toBe("content");
    expect(byRoute["system.blocked"]).toBe("system.blocked");
  });

  it("a variant with its own layoutFile renders through THAT layout", () => {
    // PRD-22 grid: each shape has a layout, and the two «-lead» twins of a shape
    // share it — they differ by declared fields, not by markup.
    const byVariant = Object.fromEntries(specs.map((s) => [s.variantKey ?? s.id, s.layoutKey]));
    expect(byVariant["info.text"]).toBe("layouts/content.text.html");
    expect(byVariant["info.text-lead"]).toBe("layouts/content.text.html");
    expect(byVariant["info.image-left"]).toBe("layouts/content.image-left.html");
    expect(byVariant["gallery.image-right-lead"]).toBe("layouts/gallery.image-right.html");
  });

  it("question screens expect the prompt + interaction slots, filled", () => {
    const q = specs.find((s) => s.route === "question.single")!;
    expect(q.expectedSlots).toEqual(["question-text", "question-interaction"]);
    expect(q.input.slots!["question-text"]).toContain("пароль");
    expect(q.input.slots!["question-interaction"]).toContain("radio");
  });

  it("the intro screen renders through the section-intro pipeline, as the runtime does", () => {
    // PRD-1 §4.3 / PRD-19: «Введение раздела» is NOT a generic content page — the
    // runtime (`contentPage.js → renderSectionIntro`) feeds it a computed
    // `sectionIntro` context plus the author instruction as a slot. Feeding it a
    // page-content skeleton (as the preview used to) checks a screen nobody renders.
    const intro = specs.find((s) => s.route === "content.intro")!;
    expect(intro.expectedSlots).toEqual(["instruction"]);
    expect(intro.input.slots!["instruction"]).toContain("ответьте внимательно");
    const ctx = intro.input.context as { sectionIntro: { topicName: string; hasInstruction: boolean } };
    expect(ctx.sectionIntro.hasInstruction).toBe(true);
    expect(ctx.sectionIntro.topicName).toBe("Базовые угрозы");
  });

  it("generic content screens carry a placeholder skeleton in page-content", () => {
    // content.router renders through the generic `content` layout; its declared
    // placeholders reach the screen as a page-content skeleton.
    const router = specs.find((s) => s.route === "content.router")!;
    expect(router.expectedSlots).toEqual(["page-content"]);
    expect(router.input.slots!["page-content"]).toContain('data-placeholder="title"');
  });

  it("a variant-owned layout expects no page-content slot (Э1)", () => {
    // Its fields reach the screen through `data-placeholder`, so demanding the
    // generic wrapper's slot warned about a screen that renders perfectly.
    const gallery = specs.find((s) => s.variantKey === "gallery.text")!;
    expect(gallery.expectedSlots).toEqual([]);
  });

  it("the gallery demos form ONE sequence, so every slide shows the indicator", () => {
    // PRD-22: the demo does not need a page per slide — the six gallery variants
    // share one identifier, so each previews with the full set of dots.
    const gallery = specs.filter((s) => /^gallery\./.test(s.variantKey ?? ""));
    expect(gallery).toHaveLength(6);
    for (const spec of gallery) {
      const page = (spec.input.context as { page?: { dotsTotal?: number } }).page;
      expect(page?.dotsTotal).toBe(6);
    }
  });

  it("the «Далее» caption comes from the page setting, defaulting to «Далее»", () => {
    const pageOf = (key: string) =>
      (specs.find((s) => s.variantKey === key)!.input.context as { page: { nextLabel: string } }).page;
    expect(pageOf("gallery.image-right-lead").nextLabel).toBe("Начать");
    expect(pageOf("gallery.text").nextLabel).toBe("Далее");
    expect(pageOf("info.text").nextLabel).toBe("Далее");
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
    expect(report.total).toBe(expectedScreenCount() + expectedReportRows());
    expect(report.passed).toBeGreaterThan(0);
    // The appended router screen renders the topic menu on the demo topics.
    const router = report.routes.find((r) => r.route === "content.router")!;
    expect(router.status).not.toBe("fail");
  });

  it("проверяет виды ОТЧЁТА наравне с экранами (PRD-27 FR-26)", () => {
    const report = runSmokeChecks({ dataset: demo, manifest, layouts });
    // «Стандартный» объявляет оба вида — оба обязаны быть в отчёте проверки и оба
    // обязаны отрисоваться: сломанный макет отчёта иначе всплывает только у
    // обучающегося, который не смог скачать PDF.
    const reportKeys = (manifest.contentTemplates as Array<{ key: string; kind?: string }>)
      .filter((c) => c.kind === "report" || c.kind === "report.adaptive")
      .map((c) => c.key);
    expect(reportKeys.length).toBeGreaterThan(0);
    for (const key of reportKeys) {
      const row = report.routes.find((r) => r.id === key);
      expect(row, `нет строки проверки для вида отчёта ${key}`).toBeTruthy();
      expect(row!.status).not.toBe("fail");
    }
  });

  it("ломаный макет отчёта — БЛОКИРУЮЩАЯ ошибка, а не молчание", () => {
    const reportVariant = (manifest.contentTemplates as Array<{ key: string; kind?: string; layoutFile?: string }>)
      .find((c) => c.kind === "report")!;
    // Пустой макет: страница отрисуется пустой — ровно тот случай, ради которого
    // проверка и существует.
    const broken = { ...layouts, [reportVariant.layoutFile!]: "   " };
    const report = runSmokeChecks({ dataset: demo, manifest, layouts: broken });
    const row = report.routes.find((r) => r.id === reportVariant.key)!;
    expect(row.status).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("passes a valid template.js as an extra row", () => {
    const report = runSmokeChecks({
      dataset: demo,
      manifest,
      layouts,
      templateJs: "(function(){ var x = 1; return x; })();",
    });
    expect(report.routes.find((r) => r.route === "template.js")!.status).toBe("pass");
    expect(report.ok).toBe(true);
  });
});

// ─── smoke-runner: broken fixtures fail ─────────────────────────────────────

describe("runSmokeChecks — broken templates fail", () => {
  // A missing slot/layout is NOT blocking (spec §17.1/§17.2, PRD-3 NFR-06): such a
  // screen renders from the standard template, so it warns instead of failing.
  it("warns — does not fail — when a question layout drops the interaction slot", () => {
    const broken = { ...layouts, question: '<div class="q"><div data-slot="question-text"></div></div>' };
    const report = runSmokeChecks({ dataset: demo, manifest, layouts: broken });
    const q = report.routes.find((r) => r.route === "question.single")!;
    expect(q.status).toBe("warn");
    expect(q.errors).toEqual([]);
    expect(q.warnings.join(" ")).toContain("question-interaction");
    // The warning names the real consequence — that part of the screen stays
    // empty. «Отрисован из стандартного шаблона» is reserved for a MISSING
    // layout; saying it here claimed a substitution that never happens.
    expect(q.warnings.join(" ")).toContain("не будет заполнена");
    expect(q.warnings.join(" ")).not.toContain("стандартного шаблона");
    expect(report.ok).toBe(true);
  });

  it("fails a screen whose layout throws on bad DSL", () => {
    // Invalid DSL stays blocking — the package is broken, not merely incomplete.
    const broken = { ...layouts, "layouts/start.html": "{{#if state.canStart}} нет закрывающего тега" };
    const report = runSmokeChecks({ dataset: demo, manifest, layouts: broken });
    const start = report.routes.find((r) => r.route === "start")!;
    expect(start.status).toBe("fail");
    expect(start.errors.join(" ")).toContain("Ошибка отрисовки");
    expect(report.ok).toBe(false);
  });

  it("warns — does not fail — when a layout is missing entirely", () => {
    const broken = { ...layouts };
    delete broken["layouts/results.html"];
    const report = runSmokeChecks({ dataset: demo, manifest, layouts: broken });
    const res = report.routes.find((r) => r.route === "results")!;
    expect(res.status).toBe("warn");
    expect(res.errors).toEqual([]);
    expect(res.warnings.join(" ")).toContain("не объявлен");
    expect(report.ok).toBe(true);
  });

  it("renders a missing screen from the standard template when its layouts are supplied", () => {
    const broken = { ...layouts };
    delete broken["layouts/results.html"];
    const report = runSmokeChecks({
      dataset: demo,
      manifest,
      layouts: broken,
      fallbackLayouts: layouts, // the standard template's layouts
    });
    const res = report.routes.find((r) => r.route === "results")!;
    expect(res.status).toBe("warn");
    expect(res.warnings.join(" ")).toContain("отрисован из стандартного шаблона");
    expect(report.ok).toBe(true);
  });

  // PRD-22: a variant may ship its own layout and place the author's fields in
  // `data-placeholder` regions instead of the generic `page-content` slot. The
  // check must not demand a slot such a layout does not need — the shipping
  // gallery is exactly that case, and it used to warn on every render.
  describe("variant-owned layouts", () => {
    /** Manifest with one info variant backed by its own layout file. */
    function manifestWithVariantLayout(): PreviewManifest {
      return {
        layouts: { content: "layouts/content.html" },
        contentTemplates: [
          {
            key: "gallery.card",
            label: "Галерея: карточка",
            kind: "info",
            pageKind: "content.info",
            layoutFile: "layouts/gallery.html",
            placeholders: [
              { key: "title", type: "text" } as any,
              { key: "body", type: "richText" } as any,
            ],
          },
        ],
        preview: { routes: [{ route: "content.info", templateKey: "gallery.card", label: "Галерея" }] },
      };
    }
    const dataset = {
      course: {
        title: "T",
        contentPages: [
          { id: "p1", templateKey: "gallery.card", values: { title: "Заголовок", body: "<p>Текст</p>" } },
        ],
      },
    } as any;

    it("passes a layout that places fields in data-placeholder regions", () => {
      const report = runSmokeChecks({
        dataset,
        manifest: manifestWithVariantLayout(),
        layouts: {
          "layouts/content.html": '<div><div data-slot="page-content"></div></div>',
          "layouts/gallery.html":
            '<div class="gallery"><h1 data-placeholder="title"></h1><div data-placeholder="body"></div></div>',
        },
      });

      expect(report.routes[0].status).toBe("pass");
      expect(report.routes[0].warnings).toEqual([]);
    });

    it("warns when the layout offers neither placeholders nor the slot", () => {
      // The author fills fields in «Структуре» and none of it reaches the learner —
      // exactly what a builder-exported layout with baked-in text does.
      const report = runSmokeChecks({
        dataset,
        manifest: manifestWithVariantLayout(),
        layouts: {
          "layouts/content.html": '<div><div data-slot="page-content"></div></div>',
          "layouts/gallery.html": '<div class="gallery"><h1>Зашитый заголовок</h1></div>',
        },
      });

      expect(report.routes[0].status).toBe("warn");
      expect(report.routes[0].warnings.join(" ")).toContain("Поля варианта не попадут на экран");
      expect(report.ok).toBe(true);
    });

    it("names the fields a layout implements only partially", () => {
      // The sneakier half of the same defect: the screen looks fine in the preview,
      // and only the author who filled `body` notices the value vanished.
      const report = runSmokeChecks({
        dataset,
        manifest: manifestWithVariantLayout(),
        layouts: {
          "layouts/content.html": '<div><div data-slot="page-content"></div></div>',
          "layouts/gallery.html": '<div class="gallery"><h1 data-placeholder="title"></h1></div>',
        },
      });

      expect(report.routes[0].status).toBe("warn");
      expect(report.routes[0].warnings.join(" ")).toContain("body");
      expect(report.routes[0].warnings.join(" ")).not.toContain("ни одного data-placeholder");
      expect(report.ok).toBe(true);
    });

    it("stays silent when the layout carries the generic slot instead", () => {
      const report = runSmokeChecks({
        dataset,
        manifest: manifestWithVariantLayout(),
        layouts: {
          "layouts/content.html": '<div><div data-slot="page-content"></div></div>',
          "layouts/gallery.html": '<div class="gallery"><div data-slot="page-content"></div></div>',
        },
      });

      expect(report.routes[0].warnings).toEqual([]);
    });

    it("does not fire for a variant that declares no fields", () => {
      const manifestNoFields: PreviewManifest = {
        layouts: { content: "layouts/content.html", review: "layouts/review.html" },
        contentTemplates: [],
        preview: { routes: [{ route: "review", label: "Обзор" }] },
      };
      const report = runSmokeChecks({
        dataset: { course: { title: "T" } } as any,
        manifest: manifestNoFields,
        // Keyed the way the bundle readers key it: by the `layouts` KEY for a
        // system screen, by `layoutFile` path for a variant-owned layout.
        layouts: {
          content: '<div><div data-slot="page-content"></div></div>',
          review: '<div class="review">Обзор</div>',
        },
      });

      expect(report.routes[0].warnings).toEqual([]);
    });
  });

  it("fails on a template.js syntax error", () => {
    const report = runSmokeChecks({
      dataset: demo,
      manifest,
      layouts,
      templateJs: "function (){ this is not valid",
    });
    expect(report.routes.find((r) => r.route === "template.js")!.status).toBe("fail");
    expect(report.ok).toBe(false);
  });
});
