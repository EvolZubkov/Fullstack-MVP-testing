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

function tryReadBinaryAsset(relativePath: string): Buffer | null {
  const possiblePaths = [
    path.resolve(__dirname, "template", relativePath),
    path.resolve(__dirname, relativePath),
    path.resolve(__dirname, "assets", relativePath),
    path.resolve(process.cwd(), "server", "scorm", "template", relativePath),
    path.resolve(process.cwd(), "dist", "scorm", "template", relativePath),
    path.resolve(process.cwd(), "scorm", "template", relativePath),
  ];
  
  logger.info("[tryReadBinaryAsset] Looking for: " + relativePath);
  
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        logger.info("[tryReadBinaryAsset] Found at: " + p);
        return fs.readFileSync(p);
      }
    } catch {
      continue;
    }
  }
  logger.info("[tryReadBinaryAsset] Not found: " + relativePath);
  return null;
}

export async function generateScormPackage(data: ExportData): Promise<Buffer> {
  const testJson = buildTestJson(data);

  const indexHtml = readAsset("index.html").replace("__TITLE__", escapeXml(data.test.title));
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
  // and the runtime gate. Bundled for every package; the gate only runs when the
  // test carries a retake policy (RetakeGate.isGated), so unpolicied packages are
  // unaffected at runtime (the bundled bytes differ — see test-json conditional export).
  const eligibilityEngineJs = readOneOf(["app/eligibility/engine.js"]);
  const eligibilityPluginsJs = readOneOf(["app/eligibility/plugins.js"]);
  const eligibilityGateJs = readOneOf(["app/eligibility/gate.js"]);

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

  const telemetryJs = telemetryEnabled
    ? tryReadAsset(["app/telemetry/telemetry.js"])
    : "";

  // PRD-12 (2-7): shared template runtime bundled from `@shared` and exposed as the
  // `TBTemplate` global — the same renderer the web host uses. Prepended so every
  // package part can consume it.
  const sharedRuntimeJs = await getSharedRuntimeBundle();

  let appJs = joinJsParts([
    sharedRuntimeJs,
    escapeHtmlJs,
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
  
  if (!telemetryEnabled) {
    appJs = stripTelemetryArtifacts(appJs);
  }

  const mediaHrefs = Object.keys(assets);

  // Добавляем PDF-ассеты в список файлов для манифеста
  const pdfAssetPaths = [
    "assets/media/pdf-bg-1.png",
    "assets/media/pdf-bg-2.png", 
    "assets/media/pdf-bg-3.png",
    "assets/media/logo-light.png"
  ];

  // Добавляем только те PDF-ассеты, которые реально существуют
  pdfAssetPaths.forEach(assetPath => {
    if (tryReadBinaryAsset(assetPath)) {
      mediaHrefs.push(assetPath);
    }
  });

  const templateId = data.designSettings?.templateId ?? "default";
  // Resolve the template's files directory. The route passes `data.templateDir`
  // (built-in or uploaded PRD-3 path, resolved via the templates table). Without
  // it, fall back to the built-in convention `server/scorm/templates/<id>` (and
  // `default` when that id has no shipped directory) — this keeps the exporter
  // usable standalone (acceptance fixtures pass no templateDir).
  const builtinRoot = getTemplatesRootDir();
  const templateDir =
    data.templateDir && fs.existsSync(data.templateDir)
      ? data.templateDir
      : path.join(builtinRoot, fs.existsSync(path.join(builtinRoot, templateId)) ? templateId : "default");

  const templateFiles: Record<string, string | Buffer> = {};
  if (fs.existsSync(templateDir)) {
    copyDirToFiles(templateDir, "template", templateFiles);
  } else {
    logger.warn(`Template directory not found for "${templateId}" (${templateDir})`, "scorm-export");
  }
  const manifestHrefs = mediaHrefs.concat(Object.keys(templateFiles));

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
  const stylesCss = readStyle("theme.css") + "\n" + readStyle("base.css");

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
    ...templateFiles,
  };
  
  // Добавляем подложки и логотипы для PDF (только в assets/media/)
  try {
    const pdfBg1 = tryReadBinaryAsset("assets/media/pdf-bg-1.png");
    const pdfBg2 = tryReadBinaryAsset("assets/media/pdf-bg-2.png");
    const pdfBg3 = tryReadBinaryAsset("assets/media/pdf-bg-3.png");
    const logoLight = tryReadBinaryAsset("assets/media/logo-light.png");
    
    if (pdfBg1) files["assets/media/pdf-bg-1.png"] = pdfBg1;
    if (pdfBg2) files["assets/media/pdf-bg-2.png"] = pdfBg2;
    if (pdfBg3) files["assets/media/pdf-bg-3.png"] = pdfBg3;
    if (logoLight) files["assets/media/logo-light.png"] = logoLight;
  } catch (e) {
    logger.info("PDF assets not found, skipping");
  }
  
  for (const [zipPath, buf] of Object.entries(assets)) {
    files[zipPath] = buf;
  }

  return buildZip(files);
}

function stripTelemetryArtifacts(src: string) {
  // 1) убрать Telemetry.finish({ ... }, ...); и Telemetry.answer({ ... });
  src = src.replace(/Telemetry\.(finish|answer)\(\s*\{[\s\S]*?\}\s*(?:,\s*[^)]*)?\);\s*/g, "");

  // 2) убрать простые вызовы Telemetry.*
  src = src.replace(/^\s*Telemetry\.(init|start|startNewAttempt)\([^)]*\);\s*$/gm, "");
  src = src.replace(/^\s*Telemetry\.(start|startNewAttempt)\(\);\s*$/gm, "");

  // 3) убрать присваивания attemptNumber из телеметрии (обычно используются только для логов/finish)
  src = src.replace(/^\s*var\s+\w+\s*=\s*Telemetry\.getAttemptNumber\(\);\s*$/gm, "");

  // 4) убрать комментарии и логи, где вообще упоминается телеметрия/Telemetry
  src = src.replace(/^\s*\/\/.*(telemetr|Telemetry).*$/gim, "");
  src = src.replace(/^\s*console\.log\(.*(telemetr|Telemetry).*?\);\s*$/gim, "");

  return src;
}
