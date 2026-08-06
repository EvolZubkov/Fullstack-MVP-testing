/**
 * @module scripts/generate-template-scorm
 * @description Template acceptance/debug harness. Takes ANY design template
 * (built-in id, a template folder, or a `manifest.json` path) and generates a
 * SCORM 2004 package on mock data tailored to what the template DECLARES:
 *   - one content page per `contentTemplates[]` variant (intro/info/summary),
 *     with mock values derived from each placeholder's type;
 *   - questions for every mechanic in `capabilities.questionTypes`;
 *   - `designSettings.params` seeded from each `params[].default`.
 *
 * The package is written to `out/template-<id>.zip` and can be played with
 * `npm run scorm:player`.
 *
 * Usage:
 *   npm run scorm:template                 # built-in "default"
 *   npm run scorm:template -- corporate    # built-in id
 *   npm run scorm:template -- ./path/to/template-folder
 *   npm run scorm:template -- ./path/to/manifest.json
 *   npm run scorm:template -- ./templates/certification --theme dark --theme-colors
 *
 * PRD-23 options:
 *   --theme <light|dark|auto>  pin the palette the package opens in
 *   --theme-colors             seed a foreign colour per palette, so the acceptance
 *                              shows whether per-theme overrides reach the screen
 *
 * External templates (outside server/scorm/templates) are staged into the
 * registry under a temporary id for the duration of the export, then removed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateScormPackage } from "../server/scorm-exporter";
import { getTemplatesRootDir } from "../server/scorm/builders/template-copy";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "out");
const REGISTRY_ROOT = getTemplatesRootDir();
const IDENT_PATH = path.resolve(__dirname, "..", "uploads", "scorm", "identifiers.json");

/** The SCORM manifest builder persists a code per test id to a tracked file;
 *  snapshot it so this debug tool leaves no trace there. */
function snapshotIdentifiers(): Buffer | null {
  try {
    return fs.existsSync(IDENT_PATH) ? fs.readFileSync(IDENT_PATH) : null;
  } catch {
    return null;
  }
}
function restoreIdentifiers(snap: Buffer | null): void {
  try {
    if (snap === null) {
      if (fs.existsSync(IDENT_PATH)) fs.rmSync(IDENT_PATH);
    } else {
      fs.writeFileSync(IDENT_PATH, snap);
    }
  } catch {
    /* best-effort */
  }
}

// ─── Template resolution ─────────────────────────────────────────────────────────

type Resolved = {
  templateDir: string;
  manifest: any;
  /** templateId passed to the exporter (registry-relative). */
  templateId: string;
  /** Set when we staged an external template into the registry; removed in finally. */
  stagedDir: string | null;
};

function resolveTemplate(arg: string): Resolved {
  const asPath = path.resolve(process.cwd(), arg);
  let templateDir: string;

  if (fs.existsSync(asPath) && fs.statSync(asPath).isFile()) {
    templateDir = path.dirname(asPath); // a manifest.json (or any file) inside the template folder
  } else if (fs.existsSync(asPath) && fs.statSync(asPath).isDirectory()) {
    templateDir = asPath;
  } else if (fs.existsSync(path.join(REGISTRY_ROOT, arg, "manifest.json"))) {
    templateDir = path.join(REGISTRY_ROOT, arg); // built-in id
  } else {
    throw new Error(
      `Template not found: "${arg}". Pass a built-in id (` +
        fs.readdirSync(REGISTRY_ROOT).filter((d) => fs.existsSync(path.join(REGISTRY_ROOT, d, "manifest.json"))).join(", ") +
        `), a template folder, or a manifest.json path.`,
    );
  }

  const manifestPath = path.join(templateDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${templateDir}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const insideRegistry = path.resolve(path.dirname(templateDir)) === path.resolve(REGISTRY_ROOT);
  if (insideRegistry) {
    return { templateDir, manifest, templateId: path.basename(templateDir), stagedDir: null };
  }
  // Stage external template into the registry under a temp id.
  const templateId = `__debug_${Date.now()}`;
  const stagedDir = path.join(REGISTRY_ROOT, templateId);
  fs.cpSync(templateDir, stagedDir, { recursive: true });
  return { templateDir, manifest, templateId, stagedDir };
}

// ─── Mock builders ───────────────────────────────────────────────────────────────

const TINY_IMAGE =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="100%" height="100%" fill="#3b82f6"/><text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="28" text-anchor="middle" dy=".35em">MOCK IMAGE</text></svg>',
  ).toString("base64");

function mockPlaceholderValue(ph: any): unknown {
  switch (ph.type) {
    case "text":
      return `[${ph.label}] демо-текст`;
    case "textarea":
    case "richText":
      return `<p><strong>${ph.label}</strong>: демонстрационный контент для приёмки шаблона. <em>Курсив</em>, <a href="#">ссылка</a>.</p><ul><li>Пункт списка 1</li><li>Пункт списка 2</li></ul>`;
    case "html":
      return `<div><h3>${ph.label}</h3><p>Произвольный HTML-блок для проверки санитизации и верстки.</p></div>`;
    case "image":
    case "asset":
      return TINY_IMAGE;
    case "number":
      return 1;
    case "boolean":
      return true;
    case "select":
      return (ph.options && ph.options[0]) || "";
    case "resultField":
      return {
        path: ph.defaultPath || (ph.allowedPaths && ph.allowedPaths[0]) || "result.scorePercent",
        renderer: ph.defaultRenderer || (ph.allowedRenderers && ph.allowedRenderers[0]) || "core.textMetric",
        rendererOptions: {},
        label: ph.label,
      };
    default:
      return `[${ph.label}]`;
  }
}

function mockValuesFor(variant: any): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const ph of variant.placeholders || []) values[ph.key] = mockPlaceholderValue(ph);
  if (!("title" in values)) values.title = variant.label || "Демо-страница";
  return values;
}

const TOPIC_ID = "topic-mock";
let cpSeq = 0;
function makeContentPage(args: {
  topicId: string | null;
  position: "before" | "after" | "before_topic" | "after_topic";
  kind: string;
  type: "intro" | "info" | "summary" | "html";
  templateKey: string;
  sortOrder: number;
  values: Record<string, unknown>;
  /** PRD-22 page settings (sequence identifier, caption, background). */
  settings?: Record<string, unknown>;
}) {
  cpSeq += 1;
  return {
    id: `cp-${cpSeq}`,
    testId: "tpl-mock-test",
    topicId: args.topicId,
    position: args.position,
    mode: "template",
    type: args.type,
    kind: args.kind,
    templateKey: args.templateKey,
    sortOrder: args.sortOrder,
    valuesJson: { values: args.values, placeholderStyles: {} },
    settingsJson: args.settings ?? {},
    autoAdvance: false,
    autoAdvanceDelayMs: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

let qSeq = 0;
function makeQuestion(type: string, prompt: string, dataJson: unknown, correctJson: unknown) {
  qSeq += 1;
  return {
    id: `q-${qSeq}`,
    topicId: TOPIC_ID,
    type,
    prompt,
    dataJson,
    correctJson,
    difficulty: 50,
    mediaUrl: null,
    mediaType: null,
    feedback: null,
    feedbackMode: "general",
    feedbackCorrect: null,
    feedbackIncorrect: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Two mock questions per supported mechanic. */
function buildQuestions(types: string[]) {
  const out: ReturnType<typeof makeQuestion>[] = [];
  for (const t of types) {
    if (t === "single") {
      out.push(makeQuestion("single", "Одиночный выбор: какой вариант верный?",
        { options: ["Верный вариант", "Неверный 1", "Неверный 2", "Неверный 3"] }, { correctIndex: 0 }));
      out.push(makeQuestion("single", "Одиночный выбор: выберите столицу.",
        { options: ["Берлин", "Москва", "Париж", "Рим"] }, { correctIndex: 1 }));
    } else if (t === "multiple") {
      out.push(makeQuestion("multiple", "Множественный выбор: отметьте все чётные числа.",
        { options: ["2", "3", "4", "5"] }, { correctIndices: [0, 2] }));
      out.push(makeQuestion("multiple", "Множественный выбор: какие языки — программирования?",
        { options: ["TypeScript", "HTML", "Python", "CSS"] }, { correctIndices: [0, 2] }));
    } else if (t === "matching") {
      out.push(makeQuestion("matching", "Сопоставление: страна и столица.",
        { left: ["Франция", "Германия", "Италия"], right: ["Берлин", "Рим", "Париж"] },
        { pairs: [{ left: 0, right: 2 }, { left: 1, right: 0 }, { left: 2, right: 1 }] }));
      out.push(makeQuestion("matching", "Сопоставление: термин и значение.",
        { left: ["HTTP", "DNS", "TLS"], right: ["Шифрование канала", "Передача гипертекста", "Разрешение имён"] },
        { pairs: [{ left: 0, right: 1 }, { left: 1, right: 2 }, { left: 2, right: 0 }] }));
    } else if (t === "ranking") {
      out.push(makeQuestion("ranking", "Ранжирование: расположите по возрастанию.",
        { items: ["1", "2", "3", "4"] }, { correctOrder: [0, 1, 2, 3] }));
      out.push(makeQuestion("ranking", "Ранжирование: порядок этапов разработки.",
        { items: ["Анализ", "Проектирование", "Реализация", "Тестирование"] }, { correctOrder: [0, 1, 2, 3] }));
    }
  }
  return out;
}

// ─── Assemble + run ────────────────────────────────────────────────────────────────

function buildContentPages(manifest: any) {
  const variants: any[] = manifest.contentTemplates || [];
  const intro = variants.filter((v) => v.kind === "intro");
  const info = variants.filter((v) => v.kind === "info");
  const summary = variants.filter((v) => v.kind === "summary");
  const pages: ReturnType<typeof makeContentPage>[] = [];

  // intro variants → test-scope «До теста»
  intro.forEach((v, i) =>
    pages.push(makeContentPage({ topicId: null, position: "before", kind: "intro", type: "intro", templateKey: v.key, sortOrder: i, values: mockValuesFor(v) })));
  // info variants → before_topic AND after_topic (so both topic zones render).
  // PRD-22: a variant that declares a `sequence` setting gets THREE adjacent pages
  // sharing one identifier — otherwise the navigation indicator has nothing to
  // count and the acceptance package could not show it at all.
  info.forEach((v, i) => {
    const seqKey = (v.settings ?? []).find((s: any) => s?.type === "sequence")?.key;
    if (!seqKey) {
      pages.push(makeContentPage({ topicId: TOPIC_ID, position: "before_topic", kind: "info", type: "info", templateKey: v.key, sortOrder: i * 10, values: mockValuesFor(v) }));
      return;
    }
    for (let n = 0; n < 3; n++) {
      pages.push(makeContentPage({
        topicId: TOPIC_ID,
        position: "before_topic",
        kind: "info",
        type: "info",
        templateKey: v.key,
        sortOrder: i * 10 + n,
        values: mockValuesFor(v),
        settings: { [seqKey]: `seq-${v.key}` },
      }));
    }
  });
  info.forEach((v, i) =>
    pages.push(makeContentPage({ topicId: TOPIC_ID, position: "after_topic", kind: "info", type: "info", templateKey: v.key, sortOrder: i, values: mockValuesFor(v) })));
  // summary variants → test-scope «После теста»
  summary.forEach((v, i) =>
    pages.push(makeContentPage({ topicId: null, position: "after", kind: "summary", type: "summary", templateKey: v.key, sortOrder: i, values: mockValuesFor(v) })));

  return { pages, counts: { intro: intro.length, info: info.length, summary: summary.length } };
}

function buildParams(manifest: any): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const p of manifest.params || []) {
    if (p.default !== null && p.default !== undefined) params[p.key] = p.default;
  }
  return params;
}

/** CLI flag with a value: `--theme dark`. */
function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

/**
 * PRD-23 acceptance seed. A themed template ships its own palettes, so an export
 * with no overrides proves nothing about the printer — both palettes would simply
 * be the template's own. `--theme-colors` therefore seeds an obviously foreign
 * colour per palette: if the package paints THOSE, the per-theme block reached the
 * screen; if the two differ when the palette changes, scoping works.
 */
function buildParamsByTheme(
  manifest: any,
): Record<string, Record<string, unknown>> | undefined {
  if (process.argv.indexOf("--theme-colors") === -1) return undefined;
  const themes: string[] = (manifest.themes || []).map((t: any) => t && t.id).filter(Boolean);
  if (themes.length < 2) return undefined;
  const colourKey = (manifest.params || []).find((p: any) => p.type === "color")?.key;
  if (!colourKey) return undefined;
  const seeded: Record<string, Record<string, unknown>> = {};
  // Deep green vs bright cyan — neither occurs in the shipped templates.
  const byTheme: Record<string, string> = { light: "150 80% 28%", dark: "185 100% 60%" };
  for (const id of themes) if (byTheme[id]) seeded[id] = { [colourKey]: byTheme[id] };
  return Object.keys(seeded).length > 0 ? seeded : undefined;
}

async function main() {
  const arg = process.argv[2] || "default";
  const resolved = resolveTemplate(arg);
  const identSnapshot = snapshotIdentifiers();
  try {
    const manifest = resolved.manifest;
    const supportedTypes: string[] =
      (manifest.capabilities && manifest.capabilities.questionTypes) || ["single", "multiple", "matching", "ranking"];
    const questions = buildQuestions(supportedTypes);
    const { pages, counts } = buildContentPages(manifest);

    // PRD-23: what the package should paint with. Absent flags keep the previous
    // behaviour exactly — a themeless export is byte-identical to before.
    const paramsByTheme = buildParamsByTheme(manifest);
    const themeSettings = {
      ...(flagValue("theme") ? { theme: flagValue("theme") } : {}),
      ...(paramsByTheme ? { paramsByTheme } : {}),
    };

    const topic = { id: TOPIC_ID, name: "Демо-тема", description: "Моковая тема для приёмки шаблона", feedback: null, createdAt: new Date(), updatedAt: new Date() };
    const test = {
      id: "tpl-mock-test",
      title: `Приёмка шаблона: ${manifest.name || resolved.templateId}`,
      description: `Моковый тест для отладки шаблона «${manifest.name || resolved.templateId}» (${manifest.id || resolved.templateId}).`,
      mode: "standard",
      showDifficultyLevel: true,
      overallPassRuleJson: { type: "percent", value: 70 },
      webhookUrl: null,
      feedback: null,
      timeLimitMinutes: null,
      maxAttempts: null,
      showCorrectAnswers: true,
      startPageContent: "Демонстрационный пакет для отладки и приёмки шаблона.",
      published: true,
      status: "published",
      folderId: null,
      designSettingsJson: { templateId: resolved.templateId, params: buildParams(manifest), ...themeSettings },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // PRD-24 acceptance (opt-in via TB_BY_VARIANT=1): put the topic into PRD-17
    // variants mode and gate it with a PER-VARIANT threshold, so the package can be
    // played to check that the verdict follows the variant that actually dropped.
    // Variant 1 demands everything (100%), variant 2 only 40% — so the results screen
    // shows a different «Требуется» depending on which variant actually dropped, and
    // the manifest advertises the LOWEST of the two (0.40).
    const byVariant = process.env.TB_BY_VARIANT === "1" && questions.length >= 2;
    const half = Math.ceil(questions.length / 2);
    const formSetJson = byVariant
      ? {
          forms: [
            { id: "form-1", label: "Вариант 1", questionIds: questions.slice(0, half).map((q) => q.id) },
            { id: "form-2", label: "Вариант 2", questionIds: questions.slice(half).map((q) => q.id) },
          ],
        }
      : null;
    const topicPassRuleJson = byVariant
      ? {
          source: "by_variant",
          byForm: {
            "form-1": { type: "percent", value: 100 },
            "form-2": { type: "percent", value: 40 },
          },
        }
      : null;

    const sections = [
      { id: "section-1", testId: test.id, topicId: TOPIC_ID, drawCount: questions.length, sortOrder: 0, required: true, topicPassRuleJson, formSetJson, timeLimitMinutes: null, feedbackJson: null, topic, questions, courses: [], events: [] },
    ];

    const data = {
      test,
      sections,
      adaptiveSettings: null,
      contentPages: pages,
      designSettings: { templateId: resolved.templateId, params: buildParams(manifest), ...themeSettings },
      telemetry: null,
    };

    fs.mkdirSync(OUT_DIR, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await generateScormPackage(data as any);
    const safeId = String(manifest.id || resolved.templateId).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const zipPath = path.join(OUT_DIR, `template-${safeId}.zip`);
    fs.writeFileSync(zipPath, buffer);

    // eslint-disable-next-line no-console
    console.log(`\nTemplate: ${manifest.name || resolved.templateId} (${manifest.id || resolved.templateId})`);
    // eslint-disable-next-line no-console
    console.log(`Source:   ${resolved.templateDir}${resolved.stagedDir ? " (staged externally)" : ""}`);
    // eslint-disable-next-line no-console
    console.log(`Variants: intro=${counts.intro}, info=${counts.info}, summary=${counts.summary}; questions=${questions.length} (${supportedTypes.join("/")})`);
    // eslint-disable-next-line no-console
    console.log(`Params:   ${Object.keys(buildParams(manifest)).length} seeded from manifest defaults`);
    // eslint-disable-next-line no-console
    console.log(`Output:   ${zipPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
    // eslint-disable-next-line no-console
    console.log(`Play it:  npm run scorm:player  →  http://localhost:5050\n`);
    // eslint-disable-next-line no-console
    console.log(`Note: the current exported runtime renders before_topic/after_topic content + the question stream + built-in results. Test-scope intro/summary pages are in the package data but may not appear until the runtime content flow is completed (PRD-1 §1.9).`);
  } finally {
    restoreIdentifiers(identSnapshot);
    if (resolved.stagedDir && fs.existsSync(resolved.stagedDir)) {
      fs.rmSync(resolved.stagedDir, { recursive: true, force: true });
    }
  }
}

main()
  // Imported server modules keep a heartbeat interval alive, so exit explicitly.
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to generate template SCORM package:", err);
    process.exit(1);
  });
