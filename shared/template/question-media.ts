/**
 * @module shared/template/question-media
 * @description PRD-38. Single source of the question-media markup and of its fullscreen
 * overlay, shared by BOTH hosts: the web screen imports it, the SCORM runtime reaches it
 * through the `TBTemplate` global. Before this module the two hosts printed different
 * wrappers and different inline sizes, which is why the template CSS could not control the
 * media at all — inline styles from the runtime outrank `theme.css`.
 *
 * The wrapper carries `data-media-type` because the question layout must stay byte-identical
 * across templates (tests/template-layout-parity) and the template DSL has no expressions:
 * the «audio stacks above the prompt, image sits beside it» rule can therefore only be
 * expressed in CSS, and CSS needs an attribute to branch on.
 *
 * The fullscreen overlay used to live only in the SCORM runtime and opened through an
 * inline `onclick="qmOpenFromEl(this)"` handler baked into the markup. Once the markup is
 * shared, an inline handler either duplicates itself on both hosts or does nothing on the
 * one that never defined `qmOpenFromEl` (the web host). The overlay therefore moves here
 * too, and the button carries a plain `data-media-fullscreen` marker: {@link
 * attachQuestionMediaFullscreen} wires it up by event delegation, so no inline handler is
 * ever printed (FR-15, FR-16).
 */
import { escapeHtml } from "../text/escape";

/** Media kinds a question can carry. Anything else renders nothing. */
export type QuestionMediaType = "image" | "audio" | "video";

/** The two question fields this module reads; both hosts pass the question object itself. */
export interface QuestionMediaInput {
  mediaUrl?: string | null;
  mediaType?: string | null;
}

/** Marks the fullscreen affordance for the delegated handler below. */
const FULLSCREEN_ATTR = "data-media-fullscreen";

/** Fullscreen is offered for what has a picture; audio has none. */
function isZoomable(type: string): type is "image" | "video" {
  return type === "image" || type === "video";
}

/**
 * Markup of the question media slot. Sizing and spacing are deliberately absent: they belong
 * to the template's `theme.css`, which cannot outrank an inline style.
 *
 * @param media Question (or any object carrying `mediaUrl` / `mediaType`).
 * @returns HTML string; empty when there is nothing to show.
 */
export function renderQuestionMedia(media: QuestionMediaInput | null | undefined): string {
  const url = media?.mediaUrl;
  const type = media?.mediaType;
  if (!url || !type) return "";

  const src = escapeHtml(url);
  const kind = escapeHtml(type);
  const open = `<div class="question-media" data-media-type="${kind}">`;
  const zoom = isZoomable(type)
    ? `<button type="button" class="qm-fs-btn" ${FULLSCREEN_ATTR}` +
      ` data-media-url="${src}" data-media-type="${kind}"` +
      ` aria-label="Открыть во весь экран">⛶</button>`
    : "";

  if (type === "image") {
    return open + zoom + `<img class="qm-preview" src="${src}" alt=""></div>`;
  }
  if (type === "video") {
    return (
      open + zoom +
      `<video class="qm-preview" controls preload="metadata">` +
      `<source src="${src}">Ваш браузер не воспроизводит видео.</video></div>`
    );
  }
  if (type === "audio") {
    return (
      open +
      `<audio class="qm-audio" controls preload="metadata">` +
      `<source src="${src}">Ваш браузер не воспроизводит аудио.</audio></div>`
    );
  }
  return "";
}

/** Single overlay per document, reused by every screen and both hosts. */
const OVERLAY_ID = "qm-overlay";

/** Builds the overlay lazily; a package screen without media never pays for it. */
function ensureOverlay(doc: Document): HTMLElement {
  const existing = doc.getElementById(OVERLAY_ID);
  if (existing) return existing;

  const overlay = doc.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "qm-overlay";
  overlay.hidden = true;
  overlay.innerHTML =
    '<button type="button" class="qm-overlay__close" aria-label="Закрыть">✕</button>' +
    '<div class="qm-overlay__stage"></div>';
  doc.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    // Background and the close button dismiss; a click on the asset itself does not.
    const target = e.target as HTMLElement;
    if (target === overlay || target.closest(".qm-overlay__close")) closeOverlay(doc);
  });
  doc.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") closeOverlay(doc);
  });
  return overlay;
}

/** Empties the stage — that also stops a playing video — and hides the overlay. */
function closeOverlay(doc: Document): void {
  const overlay = doc.getElementById(OVERLAY_ID);
  if (!overlay) return;
  const stage = overlay.querySelector(".qm-overlay__stage");
  if (stage) stage.innerHTML = "";
  overlay.hidden = true;
}

/**
 * Shows one asset full screen.
 *
 * @param doc  Owner document (the web host lives in a shadow root, whose document this is).
 * @param url  Asset address, already resolved by the host.
 * @param type Media kind; anything but image and video is ignored.
 */
export function openQuestionMediaOverlay(doc: Document, url: string, type: string): void {
  if (!isZoomable(type)) return;
  const overlay = ensureOverlay(doc);
  const stage = overlay.querySelector(".qm-overlay__stage")!;
  stage.innerHTML =
    type === "image"
      ? `<img src="${escapeHtml(url)}" alt="">`
      : `<video controls autoplay><source src="${escapeHtml(url)}"></video>`;
  overlay.hidden = false;
}

/**
 * Wires the fullscreen affordance by delegation, so it survives the re-render both hosts do
 * on every question. Idempotent: attaching twice adds one listener per call but still yields
 * a single overlay.
 *
 * @param root Shadow root (web) or document (package).
 * @returns Detach function.
 */
export function attachQuestionMediaFullscreen(root: Document | ShadowRoot | Element): () => void {
  const onClick = (e: Event) => {
    const el = (e.target as HTMLElement | null)?.closest?.(`[${FULLSCREEN_ATTR}]`);
    if (!el) return;
    const url = el.getAttribute("data-media-url");
    const type = el.getAttribute("data-media-type");
    if (!url || !type) return;
    openQuestionMediaOverlay(el.ownerDocument, url, type);
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
