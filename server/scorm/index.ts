import { buildZip } from "./zip";
import { logger } from "../logger";
import { buildTestJson, type ExportData } from "./builders/test-json";
import { buildManifest } from "./builders/manifest";
import { buildMetadataXml } from "./builders/metadata";
import { escapeXml } from "./utils/escape";
import { readAsset } from "./assets/read-asset";
import { extractEmbeddedMediaIntoAssets } from "./builders/media-assets";
import { copyDirToFiles, getTemplatesRootDir } from "./builders/template-copy";
import { getSharedRuntimeBundle } from "./builders/shared-runtime";
import { readVendorDsCss, readPackageFontFiles, assemblePackageStyles } from "./builders/ds-styles";
import { resolveReportBake, reportKindForMode } from "@shared/report/report-variants";
import type { ReportSettings } from "@shared/schema";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function joinJsParts(parts: string[]) {
  return parts.filter(Boolean).join("\n;\n");
}

function readOneOf(paths: string[]) {
  const errors: string[] = [];
  for (const p of paths) {
    try {
      return readAsset(p);
    } catch (e: any) {
      errors.push(`${p}: ${e?.message ?? e}`);
    }
  }
  throw new Error("None of SCORM assets found:\n" + errors.join("\n"));
}

function tryReadAsset(paths: string[]): string {
  for (const p of paths) {
    try {
      return readAsset(p);
    } catch {
      continue;
    }
  }
  return "";
}

/**
 * System screens that fall back to the `default` template when the active template
 * does not declare them (PRD-1 §4.3.2, PRD-3 NFR-06), mapped to the layout key the
 * runtime looks the screen up by.
 *
 * The key is NOT always the kind: the runtime renders `questions` through
 * `layouts.question` and `intro` through `layouts["section-intro"]`. `router`/
 * `summary` are absent on purpose — they render through the GENERIC `content`
 * layout, so swapping in the standard template's identical generic layout would buy
 * nothing; their real fallback is at the variant level (`variant-binding.ts`).
 */
/** Where the ACTIVE template's own files sit inside the package. */
const PACKAGE_TEMPLATE_DIR = "template";
/** Where the bundled `default` sits when the active template needs fallbacks (G21). */
const PACKAGE_DEFAULT_TEMPLATE_DIR = "template-default";

const FALLBACK_KIND_LAYOUT: Record<string, string> = {
  start: "start",
  results: "results",
  questions: "question",
  intro: "section-intro",
  review: "review",
  "section-results": "section-results",
  // PRD-27 FR-10: шаблон, не объявивший вида отчёта, отчёта не лишает — страница
  // берётся из вложенного «Стандартного». Ключ макета совпадает с видом.
  report: "report",
  "report.adaptive": "report.adaptive",
};

/**
 * LAYOUT KEYS of the system screens the active template does not declare — those
 * render from the bundled `default` template. Layout keys (not kinds) because that
 * is what the runtime looks a screen up by (`systemLayout`), and the two differ:
 * kind `questions` → layout `question`, kind `intro` → layout `section-intro`.
 *
 * Returns `[]` when the active template IS `default`. A manifest that cannot be read
 * declares nothing, so every screen falls back (fail-safe: a standard screen beats a
 * missing one).
 */
function computeFallbackLayoutKeys(templateDir: string, defaultDir: string): string[] {
  if (path.resolve(templateDir) === path.resolve(defaultDir)) return [];
  let declared: Set<string>;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(templateDir, "manifest.json"), "utf8"),
    ) as { contentTemplates?: Array<{ kind?: string }> };
    declared = new Set(
      (manifest.contentTemplates ?? [])
        .map((c) => c?.kind)
        .filter((k): k is string => typeof k === "string"),
    );
  } catch {
    declared = new Set();
  }
  return Object.entries(FALLBACK_KIND_LAYOUT)
    .filter(([kind]) => !declared.has(kind))
    .map(([, layoutKey]) => layoutKey);
}

/**
 * CSS выбранного варианта отчёта (PRD-27 FR-22).
 *
 * Ищется сначала в активном шаблоне, затем во вложенном `default`: когда активный вида
 * отчёта не объявил, макет берётся из `default` — и стиль обязан приехать оттуда же,
 * иначе страница соберётся без оформления.
 *
 * @param templateDir Каталог активного шаблона.
 * @param defaultDir Каталог вложенного «Стандартного».
 * @param styleFile Путь из манифеста относительно корня шаблона; `null` — стиля нет.
 */
function readReportStyle(templateDir: string, defaultDir: string, styleFile: string | null): string {
  if (!styleFile) return "";
  for (const dir of [templateDir, defaultDir]) {
    try {
      return fs.readFileSync(path.join(dir, styleFile), "utf8");
    } catch {
      // Следующий каталог.
    }
  }
  return "";
}

/** Разобранный `manifest.json` каталога шаблона; `null` — прочитать не удалось. */
function readTemplateManifest(dir: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function generateScormPackage(data: ExportData): Promise<Buffer> {
  // Resolve the template directory up-front so we can detect which system screens
  // the active template doesn't declare and must fall back to the bundled `default`
  // template for (PRD-1 §4.3.2, PRD-3 NFR-05/NFR-06). Mutating designSettings here
  // lets the flag flow through buildTestJson into TEST_DATA for the runtime.
  const templateId = data.designSettings?.templateId ?? "default";
  const builtinRoot = getTemplatesRootDir();
  const templateDir =
    data.templateDir && fs.existsSync(data.templateDir)
      ? data.templateDir
      : path.join(builtinRoot, fs.existsSync(path.join(builtinRoot, templateId)) ? templateId : "default");
  const defaultDir = path.join(builtinRoot, "default");
  const fallbackLayoutKeys = computeFallbackLayoutKeys(templateDir, defaultDir);
  if (data.designSettings && fallbackLayoutKeys.length > 0) {
    data.designSettings.fallbackLayoutKeys = fallbackLayoutKeys;
  }

  // PRD-27 FR-22: выбор ВАРИАНТА отчёта разрешается здесь — только сборщик видит и
  // манифест активного шаблона, и выбор автора. Дальше он едет в TEST_DATA (для
  // рантайма) и определяет, чей `styleFile` вложить в `styles.css`. Когда вид отчёта
  // не объявлен, деградация та же, что у прочих системных экранов: макет из
  // вложенного `default` — иначе тест на стороннем шаблоне остался бы без отчёта.
  const reportKind = reportKindForMode(data.test.mode);
  let reportBake = resolveReportBake(
    readTemplateManifest(templateDir),
    reportKind,
    (data.test.reportSettingsJson as ReportSettings | null)?.[
      data.test.mode === "adaptive" ? "adaptive" : "standard"
    ] ?? null,
    // FR-05: картинки варианта — файлы ШАБЛОНА, а он лежит в пакете под `template/`.
    // Резолвятся здесь, а не в рантайме: только сборщик знает, из какого каталога
    // приехал вариант.
    `${PACKAGE_TEMPLATE_DIR}/`,
  );
  if (!reportBake.variantKey) {
    // Активный шаблон вида не объявил. Макет приходит из вложенного «Стандартного» по
    // КАНОНИЧЕСКОМУ ключу (так его находит `systemLayout`), а стиль — из его же
    // варианта: без этого шага страница собиралась бы вообще без оформления, потому
    // что своего `styleFile` у несуществующего варианта нет. Оттуда же берутся и его
    // картинки — база другая, потому что `default` лежит в пакете рядом, отдельно.
    const fromDefault = resolveReportBake(
      readTemplateManifest(defaultDir),
      reportKind,
      null,
      `${PACKAGE_DEFAULT_TEMPLATE_DIR}/`,
    );
    reportBake = { ...fromDefault, variantKey: null, layoutKey: reportKind };
  }
  if (data.designSettings) data.designSettings.report = reportBake;

  const testJson = buildTestJson(data);

  const indexHtml = readAsset("index.html")
    .replace("__TITLE__", escapeXml(data.test.title))
    .replace(
      "__FALLBACK_STYLES__",
      fallbackLayoutKeys.length > 0
        ? '<link rel="stylesheet" href="styles-default.css" id="styles-fallback" disabled />'
        : "",
    );
  const runtimeJs = readAsset("runtime.js");

  const testObj = JSON.parse(testJson);
  const { testObj: patchedTestObj, assets } = extractEmbeddedMediaIntoAssets(testObj);

  const appTpl = readAsset("app.js");
  const testJsonB64 = Buffer.from(JSON.stringify(patchedTestObj), "utf8").toString("base64");

  const appMain = appTpl;

  // ✅ утилиты подключаем ДО app.js
  const escapeHtmlJs = readOneOf([
    "app/utils/scorm/escapeHtml.js",
    "app/utils/escapeHtml.js",
  ]);

  // PRD-26: question-type traits — the ES5 mirror of shared/questions/question-type.
  // Must precede every part that branches on the question type.
  const qTypeJs = readOneOf([
    "app/utils/qtype.js",
  ]);

  const shuffleJs = readOneOf([
    "app/utils/scorm/shuffle.js",
    "app/utils/shuffle.js",
  ]);

  const suspendAttemptsJs = readOneOf([
    "app/utils/scorm/suspendAttempts.js",
    "app/utils/suspendAttempts.js",
  ]);

  const sessionRecoveryJs = readOneOf([
    "app/utils/scorm/sessionRecovery.js",
  ]);

  const testDataJs = readOneOf([
    "app/bootstrap/testData.js",
    "app/scorm/testData.js", 
  ]);

  const bootstrapMainJs = readOneOf([
    "app/bootstrap/main.js",
  ]);

  const stateJs = readOneOf([
    "app/state.js",
  ]);

  const templateCoreJs = readOneOf([
    "app/templateCore.js",
  ]);

  const templateLoaderJs = readOneOf([
    "app/templateLoader.js",
  ]);

  const contentFlowJs = readOneOf([
    "app/contentFlow.js",
  ]);

  // PRD-4 v1.1 Phase 4c — router_by_topics state machine. Loaded for every
  // package (idempotent: no-op when flowPolicy.mode !== "router_by_topics").
  const routerFlowJs = readOneOf([
    "app/routerFlow.js",
  ]);

  // PRD-4 v1.1 Phase 4d — single-topic adaptive session wrapper. Loaded for
  // every package; only used when mode='adaptive' AND a per-topic session is
  // launched by routerFlow.selectRouterTopic / contentFlow (linear_by_topics).
  const adaptiveSessionJs = readOneOf([
    "app/adaptiveSession.js",
  ]);

  const renderersJs = readOneOf([
    "app/render/renderers.js",
  ]);

  const contentPageJs = readOneOf([
    "app/render/contentPage.js",
  ]);

  const startPageJs = readOneOf([
    "app/render/startPage.js",
  ]);

  // Scale engine — plain-JS port of shared/scales/engine (PRD-5). Joined before
  // resultsPage.js, which computes scales (scale.*) before result variables.
  const scaleEngineJs = readOneOf([
    "app/scales/engine.js",
  ]);

  // Graded-answer scoring engine — plain-JS port of shared/scoring/engine
  // (PRD-10). Joined before resultsPage.js, whose checkAnswer delegates to
  // ScoringEngine.scoreAnswer for weighted/tiered scoring.
  const scoringEngineJs = readOneOf([
    "app/scoring/engine.js",
  ]);

  // Result-variable formula DSL — plain-JS port of shared/formula (PRD-2). Must
  // be joined before resultsPage.js, which evaluates formulas via FormulaDSL.
  const formulaJs = readOneOf([
    "app/dsl/formula.js",
  ]);

  // PRD-6 retake gate — plain-JS ports of shared/eligibility/* (engine + plugins)
  // and the runtime gate. Bundled ONLY when the test actually has the cooldown
  // restriction switched on: buildTestJson bakes `retakePolicy` + the resolved
  // `retakePlugin` under exactly that condition, and without them the gate could
  // never fire (RetakeGate.isGated reads the same two fields), so for every other
  // package these are dead bytes. bootstrap/main.js guards the call with
  // `typeof RetakeGate !== "undefined"`, so the absent globals boot the course directly.
  const retakeGated = !!(
    patchedTestObj?.retakePolicy?.enabled === true &&
    patchedTestObj?.retakePolicy?.eligibilityPlugin?.key &&
    patchedTestObj?.retakePlugin?.runtimeEntry
  );
  const eligibilityEngineJs = retakeGated ? readOneOf(["app/eligibility/engine.js"]) : "";
  const eligibilityPluginsJs = retakeGated ? readOneOf(["app/eligibility/plugins.js"]) : "";
  const eligibilityGateJs = retakeGated ? readOneOf(["app/eligibility/gate.js"]) : "";

  const resultsPageJs = readOneOf([
    "app/render/resultsPage.js",
  ]);

  const mainRenderJs = readOneOf([
    "app/render/mainRender.js",
  ]);

  const timerJs = readOneOf([
    "app/timer/timer.js",
  ]);

  const qSingleJs   = readOneOf(["app/render/questions/single.js"]);
  const qMultipleJs = readOneOf(["app/render/questions/multiple.js"]);
  const qMatchingJs = readOneOf(["app/render/questions/matching.js"]);
  const qRankingJs  = readOneOf(["app/render/questions/ranking.js"]);
  const qScaleJs    = readOneOf(["app/render/questions/scale.js"]);
  const qIndexJs    = readOneOf(["app/render/questions/index.js"]);
  const viewResultsJs = readOneOf(["app/render/viewResults.js"]);


  const matchingDndJs = readOneOf([
    "app/dnd/matching.js",
  ]);

  const rankingDndJs = readOneOf([
    "app/dnd/ranking.js",
  ]);

  const answerActionsJs = readOneOf([
    "app/actions/answers.js",
  ]);

  const feedbackJs = readOneOf([
    "app/feedback/feedback.js",
  ]);

  const questionMediaJs = readOneOf([
    "app/render/questionMedia.js",
  ]);

  const pdfExportJs = readOneOf([
    "app/utils/pdfExport.js",
  ]);

  // Adaptive mode files (optional - only if test is adaptive)
  const adaptiveJs = tryReadAsset([
    "app/adaptive/adaptive.js",
  ]);

  const adaptiveRenderJs = tryReadAsset([
    "app/render/adaptiveRender.js",
  ]);
  const telemetryEnabled = !!(data.telemetry && data.telemetry.enabled);

  // Telemetry OFF ships a no-op stand-in rather than the real runtime: no endpoint, no
  // request signing, no LMS profile reads, no retry buffer. The `Telemetry` NAME still
  // has to be bound — its call sites are spread across the render/action code, and the
  // adaptive screens are bundled in every package regardless of the test's mode, so an
  // unresolved reference is a ReferenceError as soon as the learner reaches that screen.
  // Removing the call sites by regex instead is what used to leave that hole: a form the
  // pattern did not anticipate (`Telemetry.finish(results)`) survived the strip.
  const telemetryJs = telemetryEnabled
    ? tryReadAsset(["app/telemetry/telemetry.js"])
    : readOneOf(["app/telemetry/telemetry-disabled.js"]);

  // PRD-12 (2-7): shared template runtime bundled from `@shared` and exposed as the
  // `TBTemplate` global — the same renderer the web host uses. Prepended so every
  // package part can consume it.
  const sharedRuntimeJs = await getSharedRuntimeBundle();

  let appJs = joinJsParts([
    sharedRuntimeJs,
    escapeHtmlJs,
    qTypeJs,
    telemetryJs,
    shuffleJs,
    suspendAttemptsJs,
    sessionRecoveryJs,
    testDataJs,
    stateJs,
    templateCoreJs,
    templateLoaderJs,
    contentFlowJs,
    routerFlowJs,
    renderersJs,
    timerJs,
    qSingleJs,
    qMultipleJs,
    qMatchingJs,
    qRankingJs,
    qScaleJs,
    qIndexJs,
    answerActionsJs,
    matchingDndJs,
    rankingDndJs,
    startPageJs,
    viewResultsJs,
    scaleEngineJs,
    scoringEngineJs,
    formulaJs,
    resultsPageJs,
    questionMediaJs,
    pdfExportJs,
    adaptiveJs,
    adaptiveRenderJs,
    adaptiveSessionJs,
    contentPageJs,
    mainRenderJs,
    appMain,
    feedbackJs,
    eligibilityEngineJs,
    eligibilityPluginsJs,
    eligibilityGateJs,
    bootstrapMainJs,
  ]).replace("__TEST_JSON_B64__", testJsonB64);

  // Картинки отчёта здесь больше не перечисляются: с PRD-27 FR-05 подложка и логотип —
  // файлы ШАБЛОНА, они приезжают вместе с его каталогом (`template/…`) и попадают в
  // манифест ниже, вместе со всеми прочими файлами шаблона.
  const mediaHrefs = Object.keys(assets);

  // templateId / builtinRoot / templateDir / defaultDir / fallbackLayoutKeys were
  // resolved at the top of the function (needed before buildTestJson).
  const templateFiles: Record<string, string | Buffer> = {};
  if (fs.existsSync(templateDir)) {
    copyDirToFiles(templateDir, PACKAGE_TEMPLATE_DIR, templateFiles);
  } else {
    logger.warn(`Template directory not found for "${templateId}" (${templateDir})`, "scorm-export");
  }
  // PRD-7 G21: bundle the `default` template under `template-default/` so the
  // runtime can render fallback system screens (start/results the active template
  // doesn't declare) from default's own layout + CSS.
  if (fallbackLayoutKeys.length > 0 && fs.existsSync(defaultDir) && path.resolve(defaultDir) !== path.resolve(templateDir)) {
    copyDirToFiles(defaultDir, PACKAGE_DEFAULT_TEMPLATE_DIR, templateFiles);
  }
  // Revision «Стандартный» on ui-kit: brand-font woff2 embedded under assets/fonts/,
  // referenced by the vendored DS `@font-face` in styles.css. Declared in the manifest
  // alongside media so strict LMS validators see every packaged resource.
  const fontFiles = readPackageFontFiles();
  const manifestHrefs = mediaHrefs.concat(Object.keys(templateFiles)).concat(Object.keys(fontFiles));

  // PRD-12 CSS unification: the package stylesheet is the SINGLE template CSS source
  // (theme.css tokens + base.css), the SAME files the web host loads — no separate
  // hand-maintained runtime stylesheet to drift out of sync.
  const stylesDir = path.join(templateDir, "styles");
  const readStyle = (f: string): string => {
    try {
      return fs.readFileSync(path.join(stylesDir, f), "utf8");
    } catch {
      return "";
    }
  };
  // Revision «Стандартный» on ui-kit: the design system + brand font are vendored
  // FIRST, the template's own theme.css/base.css layer OVER it, and the palette bridge
  // is appended — so `.ou-*` learner screens render identically to the web host offline
  // in the LMS and the DS accent follows the test's --primary.
  const stylesCss = assemblePackageStyles(
    readVendorDsCss(),
    readStyle("theme.css"),
    readStyle("base.css"),
    // PRD-27 FR-22: стиль ВЫБРАННОГО варианта отчёта, а не какой-нибудь `report.css`
    // по соглашению об имени: варианты вправе иметь разные `styleFile`. Он обязан
    // лежать в документе к моменту растеризации — читать файл из рантайма для этого
    // поздно. Путь в манифесте задан от корня шаблона, а `readStyle` смотрит в
    // `styles/`, поэтому файл читается от каталога шаблона напрямую.
    readReportStyle(templateDir, defaultDir, reportBake.styleFile),
  );

  // PRD-7 G21: default template CSS for fallback system screens. Loaded into the
  // package as `styles-default.css` and toggled active by the runtime only while a
  // fallback screen is shown (the package is one screen at a time), so it never
  // conflicts with the active template's own screens. The default ships a single
  // scene stylesheet now (theme.css) — the legacy base.css was folded into it.
  const readDefaultStyle = (f: string): string => {
    try {
      return fs.readFileSync(path.join(defaultDir, "styles", f), "utf8");
    } catch {
      return "";
    }
  };
  const stylesDefaultCss = fallbackLayoutKeys.length > 0 ? readDefaultStyle("theme.css") : "";

  // Vendored PDF-export libraries (no CDN — the package must work offline inside the LMS).
  // html2canvas + jsPDF are shipped in the package (from server/scorm/assets/vendor/) and
  // loaded by index.html as window globals consumed by app/utils/pdfExport.js.
  const html2canvasJs = readAsset("vendor/html2canvas.min.js");
  const jspdfJs = readAsset("vendor/jspdf.umd.min.js");

  const files: Record<string, string | Buffer> = {
    "imsmanifest.xml": buildManifest(data.test, data, manifestHrefs),
    "metadata.xml": buildMetadataXml(data.test),
    "index.html": indexHtml,
    "styles.css": stylesCss,
    "runtime.js": runtimeJs,
    "app.js": appJs,
    "vendor/html2canvas.min.js": html2canvasJs,
    "vendor/jspdf.umd.min.js": jspdfJs,
    ...fontFiles,
    ...templateFiles,
  };
  if (stylesDefaultCss) files["styles-default.css"] = stylesDefaultCss;

  for (const [zipPath, buf] of Object.entries(assets)) {
    files[zipPath] = buf;
  }

  return buildZip(files);
}

