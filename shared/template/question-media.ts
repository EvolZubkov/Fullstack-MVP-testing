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
 *
 * The overlay is mounted into the SAME node the host passes in, not derived from
 * `ownerDocument`. On the web host the question scene lives in a Shadow DOM, and the
 * template's `theme.css` is injected as a `<style>` INSIDE that same shadow root
 * (`client/src/components/template-screen.tsx`) — a shadow tree's stylesheet only paints
 * nodes that live in that same tree. An element's `ownerDocument` is always the top
 * document regardless of how deep inside a shadow tree it sits, so mounting the overlay via
 * `element.ownerDocument.body` would silently escape the shadow root: the overlay would
 * render in the light DOM, past the reach of `theme.css`, as an unstyled image at the
 * bottom of the page. Passing the actual root through — and searching it with
 * `querySelector` rather than `Document#getElementById`, which `ShadowRoot` does not have —
 * keeps the overlay inside whichever tree carries the stylesheet.
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
function isZoomable(type: string): type is Extract<QuestionMediaType, "image" | "video"> {
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
    // The image IS the content the question asks about ("what is depicted"), so it needs a
    // real description, not an empty (= decorative, screen-reader-skipped) alt. There is no
    // author-supplied alt field on the question yet (a separate future task); this generic
    // label is strictly better than silence.
    return open + zoom + `<img class="qm-preview" src="${src}" alt="Изображение к вопросу"></div>`;
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

/** Single overlay per mounted root, reused by every screen inside that root. */
const OVERLAY_ID = "qm-overlay";

/**
 * The node an overlay can be mounted into and searched within: the whole document (package
 * host) or a shadow root (web host — the tree carrying the template's injected `theme.css`).
 * Nothing wider: the overlay's identity relies on `id` uniqueness WITHIN the searched tree,
 * which an arbitrary `Element` cannot guarantee — attaching to some element `B` and later to
 * a descendant `A` of `B` would produce a second `#qm-overlay` node in the very same tree.
 * The two real hosts never do that: the package always passes `document`, the web host
 * always passes the one shadow root the scene lives in.
 */
export type QuestionMediaRoot = Document | ShadowRoot;

/**
 * The document that owns `root`, for `createElement`. A `Document` node's own
 * `ownerDocument` is `null` (a document does not own itself), so it is returned as-is;
 * a `ShadowRoot` yields the document it is attached to.
 */
function documentOf(root: QuestionMediaRoot): Document {
  return root.nodeType === 9 ? (root as Document) : (root.ownerDocument as Document);
}

/**
 * Where the overlay element itself gets appended: `document.body` for a `Document` root, the
 * root itself for a `ShadowRoot` (see the module doc for why it must be the actual root).
 */
function mountPointOf(root: QuestionMediaRoot): Element | ShadowRoot {
  return root.nodeType === 9 ? (root as Document).body : (root as ShadowRoot);
}

/** Builds the overlay lazily inside `root`; a screen without media never pays for it. */
function ensureOverlay(root: QuestionMediaRoot): HTMLElement {
  const existing = root.querySelector<HTMLElement>(`#${OVERLAY_ID}`);
  if (existing) return existing;

  const doc = documentOf(root);
  const overlay = doc.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "qm-overlay";
  overlay.hidden = true;
  overlay.innerHTML =
    '<button type="button" class="qm-overlay__close" aria-label="Закрыть">✕</button>' +
    '<div class="qm-overlay__stage"></div>';
  mountPointOf(root).appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    // Background and the close button dismiss; a click on the asset itself does not.
    const target = e.target as HTMLElement;
    if (target === overlay || target.closest(".qm-overlay__close")) closeOverlay(root);
  });
  return overlay;
}

/** Empties the stage — that also stops a playing video — and hides the overlay. */
function closeOverlay(root: QuestionMediaRoot): void {
  const overlay = root.querySelector<HTMLElement>(`#${OVERLAY_ID}`);
  if (!overlay) return;
  const stage = overlay.querySelector(".qm-overlay__stage");
  if (stage) {
    // Removing a <video> from the document pauses it per spec, so the innerHTML wipe below
    // is enough in a browser. The target runtime is a WebTutor SCORM player we have no way
    // to load and verify locally (PRD-38 acceptance note) — an explicit pause costs one
    // line and removes the dependency on that spec guarantee holding there too.
    stage.querySelector("video")?.pause();
    stage.innerHTML = "";
  }
  overlay.hidden = true;
}

/**
 * Shows one asset full screen, inside `root`.
 *
 * @param root Same node passed to {@link attachQuestionMediaFullscreen} — see the module doc
 *             for why it must be the actual root, not something derived from it.
 * @param url  Asset address, already resolved by the host.
 * @param type Media kind; anything but image and video is ignored.
 */
export function openQuestionMediaOverlay(root: QuestionMediaRoot, url: string, type: string): void {
  if (!isZoomable(type)) return;
  const overlay = ensureOverlay(root);
  const stage = overlay.querySelector(".qm-overlay__stage")!;
  stage.innerHTML =
    type === "image"
      ? `<img src="${escapeHtml(url)}" alt="">`
      : // No `autoplay`: LMS/browser autoplay policies block it more often than not, and
        // `muted` would be needed to make it reliable — which defeats the point of playing a
        // video question. The legacy runtime made the same call on purpose (see the removed
        // `server/scorm/template/app/render/questionMedia.js`); this keeps it, not reopens it.
        `<video controls><source src="${escapeHtml(url)}"></video>`;
  overlay.hidden = false;
}

/**
 * Wires the fullscreen affordance by delegation, so it survives the re-render both hosts do
 * on every question. Safe to attach more than once — one overlay per root: a second
 * attachment adds a second click listener (each one fires on the same click, but
 * `ensureOverlay` still finds the single existing node by `querySelector`, so the overlay
 * itself is never duplicated).
 *
 * Escape is bound on `root`'s OWNER DOCUMENT, not on `root` itself: a shadow root never
 * receives a `keydown` fired outside it directly, but the DOM spec has such events RETARGET
 * and bubble up through the shadow boundary to `document` regardless of which shadow tree
 * (if any) the focused element sits in, so binding on the document alone covers every host.
 *
 * @param root Shadow root (web) or document (package) — see the module doc for why.
 * @returns Detach function: removes the click and keydown listeners, and also closes AND
 *          removes the overlay node itself. Without that a screen that unmounts while the
 *          overlay is open would leave a `position: fixed` layer (and a still-playing
 *          `<video>`) sitting on top of whatever renders next; a later re-attach rebuilds
 *          the overlay lazily via `ensureOverlay`, so removing it here is not wasteful.
 */
export function attachQuestionMediaFullscreen(root: QuestionMediaRoot): () => void {
  const onClick = (e: Event) => {
    const el = (e.target as HTMLElement | null)?.closest?.(`[${FULLSCREEN_ATTR}]`);
    if (!el) return;
    const url = el.getAttribute("data-media-url");
    const type = el.getAttribute("data-media-type");
    if (!url || !type) return;
    openQuestionMediaOverlay(root, url, type);
  };
  const onKeydown = (e: Event) => {
    if ((e as KeyboardEvent).key === "Escape") closeOverlay(root);
  };
  const doc = documentOf(root);
  root.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKeydown);
  return () => {
    root.removeEventListener("click", onClick);
    doc.removeEventListener("keydown", onKeydown);
    closeOverlay(root);
    root.querySelector<HTMLElement>(`#${OVERLAY_ID}`)?.remove();
  };
}
