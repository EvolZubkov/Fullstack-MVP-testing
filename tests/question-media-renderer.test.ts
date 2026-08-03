// @vitest-environment jsdom
/**
 * @module tests/question-media-renderer
 * @description PRD-38: the question-media markup is printed by ONE renderer shared by the
 * web host and the SCORM runtime. The type attribute is the hook the template CSS branches
 * on (audio stacks above the prompt, image and video sit beside it), so it is asserted here
 * rather than left to the hosts. The fullscreen-overlay suite below mounts into a REAL shadow
 * root (`attachShadow`), not a plain `<div>`: that is one of the two trees the module actually
 * supports (`QuestionMediaRoot = Document | ShadowRoot`) and it is what exercises the id-scoped
 * lookup the whole PRD-38 fix is about.
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

  it("gives the question image a real description, not an empty (decorative) alt", () => {
    const html = renderQuestionMedia({ mediaUrl: "/a.png", mediaType: "image" });
    expect(html).not.toContain('alt=""');
    expect(html).toContain('alt="Изображение к вопросу"');
  });
});

describe("attachQuestionMediaFullscreen", () => {
  // Each `mount()` call registers a real listener pair (click + document keydown). A test
  // that asserts and fails BEFORE its own cleanup runs would otherwise leak the keydown
  // listener into every later test in this file (they all share one jsdom `document`), which
  // is exactly the kind of bug that only shows up as flakiness in a LATER, unrelated test.
  // Every `mount()` registers its detach here; `afterEach` sweeps whatever a test did not
  // already detach itself.
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  /** Mounts one media element into a REAL shadow root and wires the fullscreen affordance. */
  function mount(mediaUrl = "/a.png", mediaType = "image"): { shadow: ShadowRoot; detach: () => void } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = renderQuestionMedia({ mediaUrl, mediaType });
    const detach = attachQuestionMediaFullscreen(shadow);
    cleanups.push(detach);
    return { shadow, detach };
  }

  it("opens the overlay with the clicked asset and closes it on Escape", () => {
    const { shadow } = mount();
    shadow.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();

    const overlay = shadow.querySelector<HTMLElement>("#qm-overlay")!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.querySelector("img")?.getAttribute("src")).toBe("/a.png");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlay.hidden).toBe(true);
    expect(overlay.querySelector("img")).toBeNull();
  });

  it("closes when the background is clicked", () => {
    const { shadow } = mount();
    shadow.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();
    const overlay = shadow.querySelector<HTMLElement>("#qm-overlay")!;
    expect(overlay.hidden).toBe(false);

    overlay.click(); // the overlay backdrop IS the element being clicked here
    expect(overlay.hidden).toBe(true);
  });

  it("closes when the close button is clicked", () => {
    const { shadow } = mount();
    shadow.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();
    const overlay = shadow.querySelector<HTMLElement>("#qm-overlay")!;
    expect(overlay.hidden).toBe(false);

    overlay.querySelector<HTMLElement>(".qm-overlay__close")!.click();
    expect(overlay.hidden).toBe(true);
  });

  it("opens the overlay for a video asset too", () => {
    const { shadow } = mount("/a.mp4", "video");
    shadow.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();

    const overlay = shadow.querySelector<HTMLElement>("#qm-overlay")!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.querySelector("video")).not.toBeNull();
  });

  it("never opens for audio: there is no fullscreen button to click", () => {
    const { shadow } = mount("/a.mp3", "audio");
    expect(shadow.querySelector("[data-media-fullscreen]")).toBeNull();

    shadow.querySelector<HTMLElement>(".qm-audio")!.click();
    expect(shadow.querySelector("#qm-overlay")).toBeNull();
  });

  it("is safe to attach twice: two attachments still show one overlay, and detaching removes it", () => {
    const { shadow, detach } = mount();
    const second = attachQuestionMediaFullscreen(shadow);
    shadow.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();
    expect(shadow.querySelectorAll("#qm-overlay").length).toBe(1);

    detach();
    second();
    // Both listeners are gone, so this click reaches no handler and the overlay `detach`
    // removed does not come back.
    shadow.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();
    expect(shadow.querySelector("#qm-overlay")).toBeNull();
  });

  it("detach closes and removes the overlay node, not just the listeners", () => {
    const { shadow, detach } = mount();
    shadow.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();
    expect(shadow.querySelector("#qm-overlay")).not.toBeNull();

    detach();
    expect(shadow.querySelector("#qm-overlay")).toBeNull();
  });

  it("mounts the overlay inside the shadow root, not the light DOM, so the template's theme.css can reach it", () => {
    const { shadow } = mount();
    shadow.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();

    const overlayInShadow = shadow.querySelector<HTMLElement>("#qm-overlay");
    expect(overlayInShadow).not.toBeNull();
    expect(overlayInShadow!.hidden).toBe(false);
    // The light DOM must stay clean: an overlay mounted via `ownerDocument.body` would show
    // up here instead, unreachable by the shadow root's injected stylesheet.
    expect(document.body.querySelector("#qm-overlay")).toBeNull();
    expect(document.getElementById("qm-overlay")).toBeNull();
  });
});
