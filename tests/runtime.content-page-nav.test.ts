/**
 * @module tests/runtime.content-page-nav
 * @description The runtime finds a content page's navigation by the `data-nav`
 * contract, not by a `.navigation` wrapper class.
 *
 * A layout owns its own footer markup: the shipped `content` layout wraps the
 * buttons in `.navigation`, while the certification gallery uses `.gallery__nav`.
 * The runtime used to look the «Далее» button up as `.navigation [data-nav="next"]`,
 * so the gallery's button was never wired and the learner could not leave the
 * page. These tests pin the contract that fixes it — and the boundary that keeps
 * a stray `data-nav` in AUTHOR content from becoming the screen's navigation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Loads the runtime module and returns its `findScreenNavButton`. The real source
 * is evaluated (not a re-implementation), so the test exercises what ships.
 */
function loadFinder(): (app: Element, dir: string) => Element | null {
  const src = readFileSync(
    path.resolve(__dirname, "../server/scorm/template/app/render/contentPage.js"),
    "utf8",
  );
  // The runtime file is a plain script that declares globals; evaluating it inside
  // a function and handing back the one symbol under test keeps the rest of the
  // runtime (which needs `state`, `TEST_DATA`, …) out of the way.
  return new Function(`${src}\nreturn findScreenNavButton;`)() as (
    app: Element,
    dir: string,
  ) => Element | null;
}

let findScreenNavButton: (app: Element, dir: string) => Element | null;

beforeEach(() => {
  findScreenNavButton = loadFinder();
  document.body.innerHTML = "";
});

/** Mounts markup as the screen root and returns it. */
function mount(html: string): Element {
  const app = document.createElement("div");
  app.id = "app";
  app.innerHTML = html;
  document.body.appendChild(app);
  return app;
}

describe("Runtime content page — navigation lookup", () => {
  it("finds the button inside the shipped `.navigation` footer", () => {
    const app = mount(
      '<div class="layout-content-wrap"><div data-slot="page-content"></div>' +
        '<div class="navigation"><button data-nav="next">Далее</button></div></div>',
    );

    expect(findScreenNavButton(app, "next")?.textContent).toBe("Далее");
  });

  it("finds the button in a layout that names its footer otherwise", () => {
    // The certification gallery: `.gallery__nav`, no `.navigation` anywhere.
    const app = mount(
      '<div class="gallery"><div data-slot="page-content"></div>' +
        '<div class="gallery__foot"><div class="gallery__nav">' +
        '<button data-nav="prev">Назад</button><button data-nav="next">Далее</button>' +
        "</div></div></div>",
    );

    expect(findScreenNavButton(app, "next")?.textContent).toBe("Далее");
    expect(findScreenNavButton(app, "prev")?.textContent).toBe("Назад");
  });

  it("ignores a `data-nav` that sits in the author's content", () => {
    // Pasted markup must not hijack the screen's navigation: the button inside
    // the page-content slot is skipped in favour of the layout's own.
    const app = mount(
      '<div class="gallery"><div data-slot="page-content">' +
        '<button data-nav="next">ссылка автора</button></div>' +
        '<div class="gallery__nav"><button data-nav="next">Далее</button></div></div>',
    );

    expect(findScreenNavButton(app, "next")?.textContent).toBe("Далее");
  });

  it("returns null when the layout renders no such button", () => {
    // «Назад» is optional — a layout without it must not blow up the render.
    const app = mount('<div class="gallery"><div class="gallery__nav">' +
      '<button data-nav="next">Далее</button></div></div>');

    expect(findScreenNavButton(app, "prev")).toBeNull();
  });

  it("takes the layout's button when the author's is the only other one", () => {
    // Degenerate case: content slot holds a nav button and the layout holds none.
    // Nothing is returned rather than wiring the author's markup by accident.
    const app = mount(
      '<div class="gallery"><div data-slot="page-content">' +
        '<button data-nav="next">ссылка автора</button></div></div>',
    );

    expect(findScreenNavButton(app, "next")).toBeNull();
  });
});

/** Loads contentFlow.js the way the package does: as a script over globals. */
function loadContentFlow() {
  const src = readFileSync(
    path.resolve(__dirname, "../server/scorm/template/app/contentFlow.js"),
    "utf8",
  );
  new Function(src)();
}

describe("Runtime post-results pages — navigation on a custom footer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    const g = globalThis as any;
    g.findScreenNavButton = loadFinder();
    // The page itself is rendered by renderContentPage; here only its RESULT
    // matters, so the DOM is prepared by the test and the renderer is a no-op.
    g.renderContentPage = vi.fn();
    g.finishAndClose = vi.fn();
    g.render = vi.fn();
    g.TBTemplate = {};
    loadContentFlow();
  });

  /** Mounts a gallery-style screen (no `.navigation` wrapper anywhere). */
  function mountGalleryScreen() {
    const app = document.createElement("div");
    app.id = "app";
    app.innerHTML =
      '<div class="gallery"><div data-slot="page-content"></div>' +
      '<div class="gallery__nav"><button data-nav="next">Далее</button></div></div>';
    document.body.appendChild(app);
    return app;
  }

  it("rewires the layout's own button to walk the post-results chain", () => {
    const g = globalThis as any;
    g.state = {
      postResultsPages: [{ id: "p1" }, { id: "p2" }],
      postResultsIndex: 0,
      templateManifest: {},
    };
    const app = mountGalleryScreen();

    g.renderPostResults();

    const btn = app.querySelector('[data-nav="next"]') as HTMLButtonElement;
    // Without the rewiring the button would still advance the ordinary page
    // sequence and walk straight out of the post-results chain.
    expect(btn.onclick).toBe(g.nextPostResults);
    expect(btn.textContent).toBe("Далее");
  });

  it("turns the last page's button into «Завершить тест»", () => {
    const g = globalThis as any;
    g.state = {
      postResultsPages: [{ id: "p1" }, { id: "p2" }],
      postResultsIndex: 1,
      templateManifest: {},
    };
    const app = mountGalleryScreen();

    g.renderPostResults();

    const btn = app.querySelector("button") as HTMLButtonElement;
    expect(btn.textContent).toBe("Завершить тест");
    expect(btn.getAttribute("data-action")).toBe("test-finish");
    expect(btn.getAttribute("data-nav")).toBeNull();
    expect(btn.onclick).toBe(g.finishAndClose);
  });

  it("still rewrites the shipped `.navigation` footer wholesale", () => {
    const g = globalThis as any;
    g.state = {
      postResultsPages: [{ id: "p1" }, { id: "p2" }],
      postResultsIndex: 0,
      templateManifest: {},
    };
    const app = document.createElement("div");
    app.id = "app";
    app.innerHTML =
      '<div class="layout-content-wrap"><div data-slot="page-content"></div>' +
      '<div class="navigation"><button data-nav="next">Далее</button></div></div>';
    document.body.appendChild(app);

    g.renderPostResults();

    const nav = app.querySelector(".navigation") as HTMLElement;
    expect(nav.innerHTML).toContain("nextPostResults()");
  });
});
