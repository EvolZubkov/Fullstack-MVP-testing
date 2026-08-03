/**
 * @module shared/template/question-media
 * @description PRD-38. Single source of the question-media markup, shared by BOTH hosts:
 * the web screen imports it, the SCORM runtime reaches it through the `TBTemplate` global.
 * Before this module the two hosts printed different wrappers and different inline sizes,
 * which is why the template CSS could not control the media at all — inline styles from the
 * runtime outrank `theme.css`.
 *
 * The wrapper carries `data-media-type` because the question layout must stay byte-identical
 * across templates (tests/template-layout-parity) and the template DSL has no expressions:
 * the «audio stacks above the prompt, image sits beside it» rule can therefore only be
 * expressed in CSS, and CSS needs an attribute to branch on.
 */
import { escapeHtml } from "../text/escape";

/** Media kinds a question can carry. Anything else renders nothing. */
export type QuestionMediaType = "image" | "audio" | "video";

/** The two question fields this module reads; both hosts pass the question object itself. */
export interface QuestionMediaInput {
  mediaUrl?: string | null;
  mediaType?: string | null;
}

/** Marks the fullscreen affordance for the delegated handler in this module. */
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
