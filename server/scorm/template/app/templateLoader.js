/**
 * @module templateLoader
 * Loads the selected SCORM design template manifest/shell from the local
 * template/ directory. The runtime keeps old rendering paths as fallback.
 */
(function (root) {
  "use strict";

  function fetchText(path) {
    return fetch(path, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error(path + " returned " + res.status);
      return res.text();
    });
  }

  function fetchJson(path) {
    return fetchText(path).then(function (txt) {
      return JSON.parse(txt);
    });
  }

  function showCoreError(message) {
    var app = document.getElementById("app");
    if (!app) return;
    app.innerHTML =
      '<div class="card" role="alert">' +
      '<h1>Ошибка шаблона</h1>' +
      '<p style="color:hsl(var(--muted-foreground));">' +
      (typeof escapeHtml === "function" ? escapeHtml(message) : String(message)) +
      "</p>" +
      "</div>";
  }

  function loadRendererPlugins(manifest) {
    var plugins = (manifest && manifest.rendererPlugins) || [];
    return Promise.all(
      plugins.map(function (plugin) {
        var src = plugin.path || plugin.src;
        if (!src) return Promise.resolve();
        return new Promise(function (resolve) {
          var script = document.createElement("script");
          script.src = src.indexOf("template/") === 0 ? src : "template/" + src;
          script.onload = function () { resolve(); };
          script.onerror = function () {
            console.warn("[templateLoader] renderer plugin failed:", src);
            resolve();
          };
          document.head.appendChild(script);
        });
      })
    );
  }

  /**
   * PRD-1 §4.3.2 / PRD-3 NFR-06: loads the bundled `default` template's layouts for
   * the system screens the active template doesn't declare (TEST_DATA.designSettings
   * .fallbackLayoutKeys — LAYOUT KEYS, the same keys `systemLayout()` looks up).
   * Stored in state.fallbackLayouts so each system renderer can mount default's
   * screen with default's CSS. No-op when there are none (the package then ships no
   * template-default/).
   */
  /**
   * PRD-22 FR-36: a layout may reference the template's own files by a RELATIVE
   * path (`<img src="assets/images/logo.png">`), exactly as they sit in the ZIP.
   * Inside the package those files live under `template/` while the page itself
   * is `index.html` in the root, so an untouched relative path resolves to
   * nothing. The base is applied here, once per loaded layout, using the SHARED
   * rewriter — the same one the web host and the content pipeline use.
   * @param {string} html  Layout markup as shipped in the package
   * @param {string} base  Package directory of the template files
   * @returns {string}
   */
  function withAssetBase(html, base) {
    var TB = (typeof window !== "undefined") ? window.TBTemplate : null;
    return (TB && TB.withTemplateAssetBase) ? TB.withTemplateAssetBase(html, base) : html;
  }

  function loadFallbackTemplate() {
    var ds = (typeof TEST_DATA !== "undefined" && TEST_DATA.designSettings) || null;
    var fallbackLayoutKeys = (ds && ds.fallbackLayoutKeys) || [];
    state.fallbackLayouts = {};
    if (!fallbackLayoutKeys.length) return Promise.resolve();
    return fetchJson("template-default/manifest.json")
      .then(function (manifest) {
        state.fallbackManifest = manifest || null;
        var layouts = (manifest && manifest.layouts) || {};
        return Promise.all(
          fallbackLayoutKeys.map(function (key) {
            var rel = layouts[key];
            if (!rel) return null;
            return fetchText("template-default/" + rel)
              .then(function (html) { return [key, withAssetBase(html, "template-default/")]; })
              .catch(function () { return null; });
          })
        ).then(function (entries) {
          entries.forEach(function (entry) {
            if (entry) state.fallbackLayouts[entry[0]] = entry[1];
          });
        });
      })
      .catch(function (err) {
        console.warn("[templateLoader] failed to load fallback template:", err);
      });
  }

  /**
   * Applies the design template's own shell (manifest layouts.shell -> state.templateShell)
   * as the SCORM package chrome, when the manifest opts in via `mountShell: true`.
   * The base index.html ships a generic `.container > #app`; a template whose CSS keys on
   * its own shell structure (e.g. certification's fixed 16:9 `.tb-frame > .tb-stage >
   * #app.tb-pad`) sets `mountShell` so the package matches the web host / offline preview /
   * PRD-3 admin preview, which already render through shell.html. Templates without the flag
   * (e.g. the built-in `default`, whose base.css targets the base `.container`) keep the base
   * shell unchanged. The shell must contain an element with id="app" (the new mount point);
   * any existing #app content (the loading placeholder) is moved into it. No-op when the flag
   * is off, the shell is empty, or it carries no #app.
   */
  function applyTemplateShell() {
    var manifest = state.templateManifest;
    if (!manifest || manifest.mountShell !== true || !state.templateShell) return;
    var oldApp = document.getElementById("app");
    if (!oldApp || !oldApp.parentNode) return;
    var tmp = document.createElement("div");
    tmp.innerHTML = state.templateShell;
    var shellRoot = tmp.firstElementChild;
    var shellApp = tmp.querySelector("#app");
    if (!shellRoot || !shellApp) return; // malformed shell -> keep the base mount
    while (oldApp.firstChild) shellApp.appendChild(oldApp.firstChild); // preserve #loading etc.
    oldApp.parentNode.replaceChild(shellRoot, oldApp);
  }

  function loadDesignTemplate() {
    var manifestPromise = fetchJson("template/manifest.json");
    var shellPromise = fetchText("template/shell.html").catch(function () {
      return "";
    });

    return Promise.all([manifestPromise, shellPromise])
      .then(function (parts) {
        state.templateManifest = parts[0] || null;
        state.templateShell = parts[1] || "";
        applyTemplateShell();
        var layouts = (state.templateManifest && state.templateManifest.layouts) || {};
        // A variant names its layout by `contentTemplates[].layoutFile` (spec §8.2) —
        // load those under their PATH as the key, so `renderContentPage` can resolve a
        // page to its own layout. Without this a template built one-layout-per-page
        // renders every content page through the single `content` layout.
        var refs = {};
        Object.keys(layouts).forEach(function (k) { refs[k] = layouts[k]; });
        ((state.templateManifest && state.templateManifest.contentTemplates) || []).forEach(function (ct) {
          if (ct && ct.layoutFile && !refs[ct.layoutFile]) refs[ct.layoutFile] = ct.layoutFile;
        });
        var layoutKeys = Object.keys(refs);
        return Promise.all(
          layoutKeys.map(function (key) {
            return fetchText("template/" + refs[key])
              .then(function (html) {
                return [key, withAssetBase(html, "template/")];
              })
              .catch(function () {
                return [key, ""];
              });
          })
        ).then(function (loadedLayouts) {
          state.templateLayouts = {};
          loadedLayouts.forEach(function (entry) {
            state.templateLayouts[entry[0]] = entry[1];
          });
          return loadFallbackTemplate().then(function () {
            return loadRendererPlugins(state.templateManifest).then(function () {
              if (root.TestBuilder && root.TestBuilder._init) {
                root.TestBuilder._init(
                  (state.templateManifest && state.templateManifest.params) || [],
                  // PRD-23: the whole manifest, so `themes[]` reaches the painter.
                  state.templateManifest
                );
              }
              return state.templateManifest;
            });
          });
        });
      })
      .catch(function (err) {
        console.warn("[templateLoader] failed to load template:", err);
        state.templateManifest = {
          id: "default",
          params: [],
          contentTemplates: []
        };
        if (root.TestBuilder && root.TestBuilder._init) root.TestBuilder._init([]);
        showCoreError("Не удалось загрузить шаблон оформления. Используется базовый runtime.");
        return state.templateManifest;
      });
  }

  root.loadDesignTemplate = loadDesignTemplate;
  root.showCoreError = showCoreError;
})(typeof window !== "undefined" ? window : global);
