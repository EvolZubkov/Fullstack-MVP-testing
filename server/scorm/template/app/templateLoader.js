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

  function loadDesignTemplate() {
    var manifestPromise = fetchJson("template/manifest.json");
    var shellPromise = fetchText("template/shell.html").catch(function () {
      return "";
    });

    return Promise.all([manifestPromise, shellPromise])
      .then(function (parts) {
        state.templateManifest = parts[0] || null;
        state.templateShell = parts[1] || "";
        var layouts = (state.templateManifest && state.templateManifest.layouts) || {};
        var layoutKeys = Object.keys(layouts);
        return Promise.all(
          layoutKeys.map(function (key) {
            return fetchText("template/" + layouts[key])
              .then(function (html) {
                return [key, html];
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
          return loadRendererPlugins(state.templateManifest).then(function () {
            if (root.TestBuilder && root.TestBuilder._init) {
              root.TestBuilder._init((state.templateManifest && state.templateManifest.params) || []);
            }
            return state.templateManifest;
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
