/**
 * @module generate-prd1-template-previews
 * @description Wrapper script that generates preview.html for every template
 * found under server/scorm/templates/. All HTML, CSS, JS, and data are read
 * from the template directory and the PRD1 runtime; the script itself contains
 * no layout or styling logic.
 *
 * Usage: node scripts/generate-prd1-template-previews.mjs
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const templatesRoot = path.join(root, "server", "scorm", "templates");
const runtimeDir    = path.join(root, "server", "scorm", "template", "app");

/** PRD1 runtime files inlined into every preview. */
const PRD1_RUNTIME_FILES = [
  path.join(runtimeDir, "templateCore.js"),
  path.join(runtimeDir, "render", "renderers.js"),
  path.join(runtimeDir, "render", "contentPage.js"),
];

/** Shared browser bootstrap (route switching, DSL, question interactions). */
const BOOTSTRAP_FILE = path.join(root, "scripts", "_preview-bootstrap.js");

// ─── Utilities ────────────────────────────────────────────────────────────────

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function scriptSafe(src) {
  return src.replace(/<\/script/gi, "<\\/script");
}

function jsonInline(value) {
  return scriptSafe(JSON.stringify(value, null, 2));
}

function escAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Template discovery ───────────────────────────────────────────────────────

function discoverTemplateIds() {
  return fs.readdirSync(templatesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(templatesRoot, e.name, "manifest.json")))
    .map((e) => e.name);
}

// ─── Template file reading ────────────────────────────────────────────────────

function readLayouts(templateDir, manifest) {
  const layouts = manifest.layouts || {};
  const result = {};

  for (const [key, relPath] of Object.entries(layouts)) {
    const full = path.join(templateDir, relPath);
    if (fs.existsSync(full)) {
      result[key] = readText(full);
    } else {
      console.warn(`  [warn] layout "${key}" not found: ${relPath}`);
      result[key] = "";
    }
  }

  // System page layouts — keyed by page id (e.g. "system.locked")
  for (const page of (manifest.systemPages || [])) {
    if (page.id && page.layout) {
      const full = path.join(templateDir, page.layout);
      if (fs.existsSync(full)) {
        result[page.id] = readText(full);
      } else {
        console.warn(`  [warn] system page layout "${page.id}" not found: ${page.layout}`);
      }
    }
  }

  // Partials — keyed by partial name for {{> name }} resolution in bootstrap
  for (const [key, relPath] of Object.entries(manifest.partials || {})) {
    const full = path.join(templateDir, relPath);
    if (fs.existsSync(full)) {
      result[key] = readText(full);
    } else {
      console.warn(`  [warn] partial "${key}" not found: ${relPath}`);
    }
  }

  return result;
}

function readAssetStyles(templateDir, manifest) {
  const styles = (manifest.assets || {}).styles || [];
  return styles
    .map((rel) => {
      const full = path.join(templateDir, rel);
      if (fs.existsSync(full)) return `/* ${rel} */\n${readText(full)}`;
      console.warn(`  [warn] style not found: ${rel}`);
      return "";
    })
    .join("\n");
}

function readAssetScripts(templateDir, manifest) {
  const scripts = (manifest.assets || {}).scripts || [];
  return scripts
    .map((rel) => {
      const full = path.join(templateDir, rel);
      if (fs.existsSync(full)) return `/* ${rel} */\n${readText(full)}`;
      console.warn(`  [warn] script not found: ${rel}`);
      return "";
    })
    .join("\n");
}

function readDemoData(templateDir, manifest) {
  const demoDataPath = (manifest.preview || {}).demoData;
  if (!demoDataPath) return {};
  const full = path.join(templateDir, demoDataPath);
  if (!fs.existsSync(full)) {
    console.warn(`  [warn] demoData not found: ${demoDataPath}`);
    return {};
  }
  return readJson(full);
}

function readPrd1Runtime() {
  return PRD1_RUNTIME_FILES
    .map((file) => {
      if (!fs.existsSync(file)) {
        console.warn(`  [warn] PRD1 runtime file not found: ${file}`);
        return "";
      }
      return `/* ${path.relative(root, file)} */\n${readText(file)}`;
    })
    .join("\n\n");
}

function readBootstrap() {
  if (!fs.existsSync(BOOTSTRAP_FILE)) {
    throw new Error(`Preview bootstrap not found: ${BOOTSTRAP_FILE}`);
  }
  return readText(BOOTSTRAP_FILE);
}

// ─── Preview chrome CSS (builder UI mock + two-panel dialog) ─────────────────

function previewChromeCss() {
  return `
    :root{--pv-bg:#fff;--pv-fg:hsl(0 0% 9%);--pv-border:hsl(0 0% 89%);--pv-card:hsl(0 0% 98%);--pv-card-b:hsl(0 0% 94%);--pv-sidebar:hsl(0 0% 96%);--pv-sidebar-b:hsl(0 0% 92%);--pv-primary:hsl(217 91% 42%);--pv-muted:hsl(217 10% 92%);--pv-muted-fg:hsl(0 0% 35%);--pv-radius:9px;--pv-radius-sm:4px}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Inter,system-ui,sans-serif;font-size:14px;background:#e5e7eb;color:var(--pv-fg);line-height:1.5}
    .shell{display:flex;background:var(--pv-bg);min-height:100vh}
    .pv-sidebar{width:224px;flex-shrink:0;background:var(--pv-sidebar);border-right:1px solid var(--pv-sidebar-b);display:flex;flex-direction:column;height:100vh}
    .pv-sidebar-head{padding:16px;border-bottom:1px solid var(--pv-sidebar-b);display:flex;align-items:center;gap:8px}
    .pv-logo{width:28px;height:28px;background:var(--pv-primary);border-radius:5px;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:700}
    .pv-app-name{font-size:13px;font-weight:600}
    .pv-main{flex:1;display:flex;flex-direction:column;min-width:0;filter:blur(1px);opacity:.4}
    .pv-topbar{border-bottom:1px solid var(--pv-border);padding:10px 20px;display:flex;align-items:center;gap:12px}
    .pv-test-title{font-size:15px;font-weight:600;flex:1}
    .pv-overlay{position:absolute;inset:0;background:rgba(0,0,0,.52);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px}
    .pv-dialog{background:var(--pv-bg);border-radius:var(--pv-radius);box-shadow:0 24px 64px rgba(0,0,0,.35);width:100%;max-width:1140px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden}
    .pv-dialog-head{padding:14px 20px;border-bottom:1px solid var(--pv-border);display:flex;align-items:center;gap:12px;flex-shrink:0}
    .pv-dialog-title{font-size:15px;font-weight:600}
    .pv-dialog-sub{font-size:12px;color:var(--pv-muted-fg)}
    .pv-body{display:flex;flex:1;overflow:hidden;min-height:0}
    .pv-nav{width:220px;flex-shrink:0;border-right:1px solid var(--pv-border);overflow-y:auto;padding:6px 0;background:var(--pv-sidebar)}
    .pv-nav-item{display:block;width:calc(100% - 12px);margin:0 6px 1px;padding:7px 8px;border:0;border-radius:3px;background:transparent;color:var(--pv-fg);text-align:left;font:inherit;font-size:13px;cursor:pointer;transition:background .12s,color .12s}
    .pv-nav-item:hover{background:var(--pv-muted)}
    .pv-nav-item.pv-active{background:var(--pv-primary);color:#fff}
    .pv-stage-wrap{flex:1;overflow-y:auto;background:hsl(0 0% 91%);padding:20px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:10px}
    .pv-stage{width:100%;max-width:960px;border-radius:var(--pv-radius-sm);overflow:hidden;box-shadow:0 2px 18px rgba(0,0,0,.14)}
    .pv-caption{font-size:11px;color:hsl(0 0% 55%)}
    .pv-dialog-foot{padding:10px 20px;border-top:1px solid var(--pv-border);display:flex;align-items:center;gap:12px;flex-shrink:0;color:var(--pv-muted-fg);font-size:12px}
    .pv-btn{display:inline-flex;align-items:center;justify-content:center;padding:0 14px;height:32px;border-radius:var(--pv-radius-sm);font-size:12px;font-weight:500;cursor:pointer;border:1px solid var(--pv-border);background:var(--pv-bg);color:var(--pv-fg);font-family:inherit;margin-left:auto}
    @media(max-width:860px){.pv-sidebar{display:none}.pv-overlay{padding:8px}.pv-nav{width:100%;max-height:160px;border-right:0;border-bottom:1px solid var(--pv-border)}.pv-body{flex-direction:column}.pv-stage{max-width:100%}}
  `;
}

// ─── Post-template override CSS ───────────────────────────────────────────────
// Applied after template CSS so these rules win regardless of template resets.

function previewFixesCss() {
  return `
    /* Undo template global resets that break the preview chrome */
    html,body{overflow:auto!important;display:block!important;height:auto!important;min-height:100vh!important;background:#e5e7eb!important}
    /* Force top-level player elements to fill the stage container instead of the viewport.
       The template's own aspect-ratio rule (if any) is preserved — only width/max-width are fixed. */
    #pv-stage>*{position:relative!important;width:100%!important;max-width:100%!important;height:auto!important;max-height:none!important}
  `;
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildPreviewHtml(manifest, templateDir) {
  const demoData       = readDemoData(templateDir, manifest);
  const layouts        = readLayouts(templateDir, manifest);
  const templateCss    = readAssetStyles(templateDir, manifest);
  const templateScript = readAssetScripts(templateDir, manifest);
  const prd1Runtime    = readPrd1Runtime();
  const bootstrap      = readBootstrap();

  const routeCount    = ((manifest.preview || {}).routes || []).length;
  const contentCount  = (manifest.contentTemplates || []).length;
  const footerInfo    = `${routeCount} экранов · ${contentCount} шаблонов контента · шаблон «${escAttr(manifest.name)}» v${escAttr(manifest.version)}`;
  const testTitle     = ((demoData.course || {}).title) || manifest.name;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escAttr(manifest.name)} · preview</title>
  <style>${previewChromeCss()}</style>
  <style id="tpl-styles">${templateCss}</style>
  <style id="pv-fixes">${previewFixesCss()}</style>
</head>
<body>
<div id="s-preview" class="shell" style="position:relative;">
  <div class="pv-sidebar">
    <div class="pv-sidebar-head">
      <div class="pv-logo">TB</div>
      <div class="pv-app-name">Test Builder</div>
    </div>
  </div>
  <div class="pv-main">
    <div class="pv-topbar"><span class="pv-test-title">${escAttr(testTitle)}</span></div>
  </div>

  <div class="pv-overlay">
    <div class="pv-dialog">
      <div class="pv-dialog-head">
        <div class="pv-dialog-title">Шаблон «${escAttr(manifest.name)}» — элементы и их вид</div>
        <div class="pv-dialog-sub">Демо-данные · элементы управления работают</div>
      </div>

      <div class="pv-body">
        <nav class="pv-nav" id="pv-nav" aria-label="Навигация по элементам шаблона"></nav>

        <div class="pv-stage-wrap">
          <div class="pv-stage" id="pv-stage"></div>
          <div class="pv-caption" id="pv-caption">${escAttr(manifest.name)}</div>
        </div>
      </div>

      <div class="pv-dialog-foot">
        <span>${footerInfo}</span>
        <button type="button" class="pv-btn">Закрыть</button>
      </div>
    </div>
  </div>
</div>

<script>
  /* ── Manifest and demo data ── */
  window.PRD1_PREVIEW_MANIFEST  = ${jsonInline(manifest)};
  window.PRD1_PREVIEW_DEMO_DATA = ${jsonInline(demoData)};
  window.PRD1_PREVIEW_LAYOUTS   = ${jsonInline(layouts)};

  /* ── Shared helpers expected by contentPage.js ── */
  window.escapeHtml = function(v) {
    return String(v == null ? "" : v)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  };
  window.advancePageSequence = function() {};
</script>

<!-- PRD1 runtime: templateCore, renderers, contentPage -->
<script>${scriptSafe(prd1Runtime)}</script>

<!-- Template-specific script -->
<script>${scriptSafe(templateScript)}</script>

<!-- Preview bootstrap: nav, routing, DSL, question interactions -->
<script>${scriptSafe(bootstrap)}</script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const templateIds = discoverTemplateIds();
console.log(`Found ${templateIds.length} template(s): ${templateIds.join(", ")}`);

for (const id of templateIds) {
  const templateDir = path.join(templatesRoot, id);
  try {
    const manifest = readJson(path.join(templateDir, "manifest.json"));
    const output   = path.join(templateDir, "preview.html");
    const html     = buildPreviewHtml(manifest, templateDir);
    fs.writeFileSync(output, html, "utf8");
    console.log(`  ✓ ${path.relative(root, output)}`);
  } catch (err) {
    console.error(`  ✗ ${id}: ${err.message}`);
  }
}
