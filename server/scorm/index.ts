import { buildZip } from "./zip";
import { buildTestJson, type ExportData } from "./builders/test-json";
import { buildManifest } from "./builders/manifest";
import { buildMetadataXml } from "./builders/metadata";
import { escapeXml } from "./utils/escape";
import { readAsset } from "./assets/read-asset";
import { extractEmbeddedMediaIntoAssets } from "./builders/media-assets";
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
  
  console.log("[tryReadBinaryAsset] Looking for:", relativePath);
  
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        console.log("[tryReadBinaryAsset] Found at:", p);
        return fs.readFileSync(p);
      }
    } catch {
      continue;
    }
  }
  console.log("[tryReadBinaryAsset] Not found:", relativePath);
  return null;
}

export async function generateScormPackage(data: ExportData): Promise<Buffer> {
  const testJson = buildTestJson(data);

  const indexHtml = readAsset("index.html").replace("__TITLE__", escapeXml(data.test.title));
  const runtimeJs = readAsset("runtime.js");
  const stylesCss = readAsset("styles.css");
  
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

  const startPageJs = readOneOf([
    "app/render/startPage.js",
  ]);

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

  let appJs = joinJsParts([
    escapeHtmlJs,
    telemetryJs, 
    shuffleJs,
    suspendAttemptsJs,
    testDataJs,
    stateJs,
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
    resultsPageJs,
    questionMediaJs,
    pdfExportJs,
    adaptiveJs,
    adaptiveRenderJs,
    mainRenderJs,
    appMain,
    feedbackJs,
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

  const files: Record<string, string | Buffer> = {
    "imsmanifest.xml": buildManifest(data.test, data, mediaHrefs), 
    "metadata.xml": buildMetadataXml(data.test),
    "index.html": indexHtml,
    "styles.css": stylesCss,
    "runtime.js": runtimeJs,
    "app.js": appJs,
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
    console.log("PDF assets not found, skipping");
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
