// @vitest-environment jsdom
/**
 * @module tests/question-media-renderer
 * @description PRD-38: the question-media markup is printed by ONE renderer shared by the
 * web host and the SCORM runtime. The type attribute is the hook the template CSS branches
 * on (audio stacks above the prompt, image and video sit beside it), so it is asserted here
 * rather than left to the hosts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { attachQuestionMediaFullscreen, renderQuestionMedia } from "../shared/template/question-media";

describe("renderQuestionMedia", () => {
  it("returns an empty string when the url or the type is missing", () => {
    expect(renderQuestionMedia(undefined)).toBe("");
    expect(renderQuestionMedia({})).toBe("");
    expect(renderQuestionMedia({ mediaUrl: "/api/media/7" })).toBe("");
    expect(renderQuestionMedia({ mediaType: "image" })).toBe("");
    expect(renderQuestionMedia({ mediaUrl: "/api/media/7", mediaType: "pdf" })).toBe("");
  });

  it("wraps every type in .question-media carrying data-media-type", () => {
    for (const mediaType of ["image", "audio", "video"]) {
      const html = renderQuestionMedia({ mediaUrl: "/api/media/7", mediaType });
      expect(html.startsWith(`<div class="question-media" data-media-type="${mediaType}">`)).toBe(true);
      expect(html.endsWith("</div>")).toBe(true);
    }
  });

  it("gives image and video a fullscreen button and audio none", () => {
    expect(renderQuestionMedia({ mediaUrl: "/a.png", mediaType: "image" })).toContain("data-media-fullscreen");
    expect(renderQuestionMedia({ mediaUrl: "/a.mp4", mediaType: "video" })).toContain("data-media-fullscreen");
    expect(renderQuestionMedia({ mediaUrl: "/a.mp3", mediaType: "audio" })).not.toContain("data-media-fullscreen");
  });

  it("prints no inline event handlers and no inline sizing", () => {
    for (const mediaType of ["image", "audio", "video"]) {
      const html = renderQuestionMedia({ mediaUrl: "/api/media/7", mediaType });
      expect(html).not.toContain("onclick");
      expect(html).not.toContain("style=");
    }
  });

  it("loads metadata only, so the asset is not fetched before playback", () => {
    expect(renderQuestionMedia({ mediaUrl: "/a.mp3", mediaType: "audio" })).toContain('preload="metadata"');
    expect(renderQuestionMedia({ mediaUrl: "/a.mp4", mediaType: "video" })).toContain('preload="metadata"');
  });

  it("escapes the url so a crafted asset name cannot inject markup", () => {
    const html = renderQuestionMedia({ mediaUrl: '/a.png" onerror="alert(1)', mediaType: "image" });
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&quot;");
  });
});

describe("attachQuestionMediaFullscreen", () => {
  // Every test mounts its own overlay under the (module-level, singleton-per-root) id
  // "qm-overlay". Without a wipe, a PREVIOUS test's root — never removed, only detached —
  // stays in `document.body` and collides with the next test's `#qm-overlay` lookup: jsdom's
  // ID-selector fast path resolves `#id` against the whole document's first match rather
  // than genuinely scoping to the queried root's subtree, so a leftover element with the
  // same id shadows the new root's own overlay. Real hosts never hit this — the package has
  // exactly one document, and each web shadow root is a separate ID scope — so this is a
  // test-hygiene fix, not a product one.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function mount(): { root: HTMLElement; detach: () => void } {
    const root = document.createElement("div");
    root.innerHTML = renderQuestionMedia({ mediaUrl: "/a.png", mediaType: "image" });
    document.body.appendChild(root);
    return { root, detach: attachQuestionMediaFullscreen(root) };
  }

  it("opens the overlay with the clicked asset and closes it on Escape", () => {
    const { root, detach } = mount();
    root.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();

    const overlay = document.getElementById("qm-overlay")!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.querySelector("img")?.getAttribute("src")).toBe("/a.png");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlay.hidden).toBe(true);
    expect(overlay.querySelector("img")).toBeNull();
    detach();
  });

  it("is idempotent: two attachments open one overlay, and detaching stops the handler", () => {
    const { root, detach } = mount();
    const second = attachQuestionMediaFullscreen(root);
    root.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();
    expect(document.querySelectorAll("#qm-overlay").length).toBe(1);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    detach();
    second();
    root.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();
    expect(document.getElementById("qm-overlay")!.hidden).toBe(true);
  });

  it("mounts the overlay in a shadow root, not in the light DOM, so the template's theme.css can reach it", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = renderQuestionMedia({ mediaUrl: "/a.png", mediaType: "image" });
    const detach = attachQuestionMediaFullscreen(shadow);

    shadow.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();

    const overlayInShadow = shadow.querySelector<HTMLElement>("#qm-overlay");
    expect(overlayInShadow).not.toBeNull();
    expect(overlayInShadow!.hidden).toBe(false);
    // The light DOM must stay clean: an overlay mounted via `ownerDocument.body` would
    // show up here instead, unreachable by the shadow root's injected stylesheet.
    expect(document.body.querySelector("#qm-overlay")).toBeNull();
    expect(document.getElementById("qm-overlay")).toBeNull();

    // Escape still reaches it: keydown is a composed event that bubbles past the shadow
    // boundary up to the document, which is where the listener is bound.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlayInShadow!.hidden).toBe(true);

    detach();
  });
});
