/**
 * @module shared/template/protection/blur-guard
 *
 * PRD-34 (FR-21 — FR-23): hide the task while the window is not active. This does NOT
 * defend against a phone photographing the screen — that takes no focus away (spec §2.2).
 * It defends against the scenario the whole track starts from: carrying the prompt into a
 * search box in the next tab.
 *
 * `visibilitychange` is the primary signal. Window `blur` is secondary and DELAYED,
 * because inside an LMS frame it fires on every click on the surrounding page; an
 * immediate return cancels it, so an accidental click costs the learner nothing at all.
 *
 * The veil lifts BY ITSELF when the window is active again (FR-21): it explains, it does
 * not charge for the interruption. A button would bill the learner a click for every
 * window switch — including the LMS's own popups — and the track introduces no penalties
 * (FR-14, FR-15, FR-23).
 */

import type { RegionTarget } from "./spec";

const VEIL_CLASS = "tb-protection-veil";
const BLUR_DELAY_MS = 300;

/**
 * Compact `ou-empty`: `--inline` + `--horizontal`, glyph beside the text and no `__desc`.
 * The veil covers a REGION two lines tall, not an empty page area — stacked vertically the
 * illustration sits ABOVE the text and the block is clipped at the region's edge.
 */
const VEIL_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M10.6 6.2A9 9 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.5 3"/>' +
  '<path d="M6.3 8.3A17 17 0 0 0 3 12s4 6 9 6a9 9 0 0 0 3.7-.8"/><path d="M3 3l18 18"/></svg>';

const VEIL_HTML =
  '<div class="ou-empty ou-empty--inline ou-empty--horizontal">' +
  '<span class="ou-empty__art" aria-hidden="true">' + VEIL_ICON + "</span>" +
  '<div class="ou-empty__content">' +
  '<p class="ou-empty__title">Задание скрыто, пока окно неактивно</p></div></div>';

function hosts(root: HTMLElement, target: RegionTarget): HTMLElement[] {
  if (target.wholeScene) return [root];
  const out: HTMLElement[] = [];
  for (const selector of target.selectors) {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => out.push(el));
  }
  return out;
}

/**
 * Wire the guard to a rendered scene.
 *
 * @param root   Scene container.
 * @param target What to cover; `null` wires nothing.
 * @returns Detach function — call it before re-rendering the scene.
 */
export function attachBlurGuard(root: HTMLElement, target: RegionTarget | null): () => void {
  if (!target) return () => undefined;
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  let timer: number | undefined;

  const reveal = (): void => {
    root.querySelectorAll("." + VEIL_CLASS).forEach((el) => el.remove());
  };

  const hide = (): void => {
    if (root.querySelector("." + VEIL_CLASS)) return;
    const covered = hosts(root, target);
    if (!covered.length) return;
    // Сообщение печатается ОДИН раз и на самом крупном из закрываемых регионов.
    // Заголовок вопроса — короткая полоска в одну-две строки: на нём текст не
    // помещается и обрезается по границе региона, а на соседнем регионе то же
    // сообщение дублируется. Площадь измеряется по факту, а не выводится из
    // структуры разметки, поэтому правило не зависит от шаблона (FR-34).
    let widest = covered[0];
    let widestArea = -1;
    for (const host of covered) {
      const r = host.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > widestArea) {
        widestArea = area;
        widest = host;
      }
    }
    for (const host of covered) {
      // Позиционирующий контекст даёт ЯДРО инлайном: правка theme.css шаблона сделала
      // бы меру зависимой от того, какой шаблон загружен (FR-34).
      if (view && view.getComputedStyle(host).position === "static") host.style.position = "relative";
      const veil = doc.createElement("div");
      veil.className = VEIL_CLASS;
      if (host === widest) {
        veil.setAttribute("role", "status");
        veil.innerHTML = VEIL_HTML;
      } else {
        veil.setAttribute("aria-hidden", "true");
      }
      host.appendChild(veil);
    }
  };

  // Hiding is delayed (FR-22); revealing is not — a delay on the way back would read as
  // the page hanging.
  const onVisibility = (): void => {
    if (doc.visibilityState === "hidden") hide();
    else reveal();
  };
  const onBlur = (): void => {
    timer = view?.setTimeout(hide, BLUR_DELAY_MS);
  };
  const onFocus = (): void => {
    if (timer !== undefined) view?.clearTimeout(timer);
    timer = undefined;
    reveal();
  };

  doc.addEventListener("visibilitychange", onVisibility);
  view?.addEventListener("blur", onBlur);
  view?.addEventListener("focus", onFocus);

  return () => {
    if (timer !== undefined) view?.clearTimeout(timer);
    doc.removeEventListener("visibilitychange", onVisibility);
    view?.removeEventListener("blur", onBlur);
    view?.removeEventListener("focus", onFocus);
    reveal();
  };
}
