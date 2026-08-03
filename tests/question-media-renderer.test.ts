// @vitest-environment jsdom
/**
 * @module tests/question-media-renderer
 * @description PRD-38: the question-media markup is printed by ONE renderer shared by the
 * web host and the SCORM runtime. The type attribute is the hook the template CSS branches
 * on (audio stacks above the prompt, image and video sit beside it), so it is asserted here
 * rather than left to the hosts.
 */
import { describe, expect, it } from "vitest";
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
});
