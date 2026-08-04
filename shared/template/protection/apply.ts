/**
 * @module shared/template/protection/apply
 *
 * PRD-34 (FR-10 — FR-13, FR-31 — FR-33): applies the decision of
 * {@link module:shared/template/protection/spec} to a rendered scene.
 *
 * Selection is disabled with INLINE properties on purpose (FR-31): the runtime
 * itself prints inline styles elsewhere (font fitting, matching layout), so a rule
 * living in a stylesheet could be outranked — an inline property cannot be.
 *
 * The one CSS rule that inline cannot express — printing — is INJECTED into the
 * scene's root node (FR-33). A rule shipped inside a template file would be absent
 * from an externally loaded template (PRD-3); an injected one never is (FR-34).
 */

import type { RegionTarget } from "./spec";

/** Marks every element the measures cover. Print rule and listeners key off it. */
export const PROTECTED_ATTR = "data-tb-protected";

const STYLE_ATTR = "data-tb-protection";
const WIRED_ATTR = "data-tb-protection-wired";
/** DS toast stack — the design system owns both the look AND the position (fixed, bottom right). */
const TOAST_CLASS = "ou-toast-stack";
const TOAST_TITLE = "Копирование отключено";
const TOAST_DESC = "В этом тесте текст задания защищён от копирования.";
const TOAST_MS = 2500;

/** Info glyph for the toast; matches the stroke style used across the learner screens. */
const INFO_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/></svg>';

/**
 * The PRD-34 stylesheet: the print rule (FR-10.5, FR-12) plus the presentation of the
 * core-built elements. Scoped to core-owned attributes and DS class names, so it cannot
 * leak into a template's own markup — and it never touches the PDF report, whose subtree
 * carries no {@link PROTECTED_ATTR}.
 */
const PROTECTION_CSS = `
@media print { [${PROTECTED_ATTR}] { display: none !important; } }
/* The DS toast stack already positions itself; the only deviation is that our notice has no
   close button and fades on its own, so it must not intercept clicks. */
.${TOAST_CLASS} { pointer-events: none; }
/* FR-16: fixed minimal type — NOT the fitted --tb-question-fs/--tb-answer-fs tokens, so the
   mark never competes with the content for space and never changes size between screens. No
   margin and no padding: it shares the hint row the layout already has, so it costs the fixed
   stage no height of its own. Pushed to the right edge in both a flex row and a flex column. */
.tb-protection-mark { flex: 0 0 auto; margin: 0; margin-inline-start: auto;
  align-self: flex-end; padding: 0; white-space: nowrap;
  font-size: 10px; line-height: 1.2; letter-spacing: .02em;
  color: var(--ou-fg-muted); opacity: .35;
  pointer-events: none; user-select: none; -webkit-user-select: none; }
.tb-protection-veil { position: absolute; inset: 0; z-index: 35;
  /* Раскладку содержимого задаёт сам компонент ДС; вуаль только центрирует его,
     гасит фон и приглушает цвет, чтобы штатная разметка не спорила яркостью с тем,
     что она закрывает. */
  display: grid; place-items: center; padding: var(--ou-space-4);
  color: var(--ou-fg-muted); backdrop-filter: blur(8px);
  background: color-mix(in srgb, var(--ou-bg-surface-2) 80%, transparent); }
/* The glyph aligns with the text on the middle line and shrinks to line size: the stock 56 px
   art is meant for an empty PAGE area and next to a single heading line reads as a separate
   element rather than its icon. */
.tb-protection-veil .ou-empty { align-items: center; --_art-size: 22px; }
.tb-protection-veil .ou-empty__art { align-self: center; }
`;

/** Inject the stylesheet once per root node (document head or shadow root). */
function ensureStyle(root: HTMLElement): void {
  const rootNode = root.getRootNode() as Document | ShadowRoot;
  const host: ParentNode =
    (rootNode as Document).head ?? (rootNode as ShadowRoot) ?? root.ownerDocument.head;
  if (host.querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = root.ownerDocument.createElement("style");
  style.setAttribute(STYLE_ATTR, "");
  style.textContent = PROTECTION_CSS;
  host.appendChild(style);
}

/** Show the FR-13 notice. Only `copy`/`cut` produce it — a right click must stay quiet. */
function notify(root: HTMLElement): void {
  if (root.querySelector("." + TOAST_CLASS)) return;
  // `ou-toast`, not `ou-banner`: the DS calls the banner an INLINE notification and states it
  // is not a toast. The stack also supplies the position, so no placement of our own is invented.
  const el = root.ownerDocument.createElement("div");
  el.className = TOAST_CLASS;
  el.innerHTML =
    '<div class="ou-toast ou-toast--info" role="status">' +
    '<span class="ou-toast__ico" aria-hidden="true">' + INFO_ICON + "</span>" +
    '<div class="ou-toast__body"><div class="ou-toast__title"></div>' +
    '<div class="ou-toast__desc"></div></div></div>';
  (el.querySelector(".ou-toast__title") as HTMLElement).textContent = TOAST_TITLE;
  (el.querySelector(".ou-toast__desc") as HTMLElement).textContent = TOAST_DESC;
  root.appendChild(el);
  root.ownerDocument.defaultView?.setTimeout(() => el.remove(), TOAST_MS);
}

/** Is the event inside a region the core marked? Self-describing — no spec needed here. */
function inPerimeter(root: HTMLElement, target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  if (root.hasAttribute(PROTECTED_ATTR)) return root.contains(el);
  return el.closest("[" + PROTECTED_ATTR + "]") !== null;
}

/** Attach the four listeners once per scene root (idempotent across re-renders). */
function ensureListeners(root: HTMLElement): void {
  if (root.hasAttribute(WIRED_ATTR)) return;
  root.setAttribute(WIRED_ATTR, "");
  for (const type of ["copy", "cut", "contextmenu", "dragstart"]) {
    root.addEventListener(type, (ev: Event) => {
      if (!inPerimeter(root, ev.target)) return;
      ev.preventDefault();
      if (type === "copy" || type === "cut") notify(root);
    });
  }
}

function elementsOf(root: HTMLElement, target: RegionTarget): HTMLElement[] {
  if (target.wholeScene) return [root];
  const out: HTMLElement[] = [];
  for (const selector of target.selectors) {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => out.push(el));
  }
  return out;
}

function mark(el: HTMLElement): void {
  el.setAttribute(PROTECTED_ATTR, "");
  el.style.userSelect = "none";
  el.style.setProperty("-webkit-user-select", "none");
  // FR-27: the long-press callout on touch screens is a separate switch from selection.
  el.style.setProperty("-webkit-touch-callout", "none");
}

function unmark(el: HTMLElement): void {
  el.removeAttribute(PROTECTED_ATTR);
  el.style.removeProperty("user-select");
  el.style.removeProperty("-webkit-user-select");
  el.style.removeProperty("-webkit-touch-callout");
}

/**
 * Apply (or lift) copy protection on a freshly rendered scene.
 *
 * @param root   Scene container the host rendered into.
 * @param target What to protect; `null` lifts every mark this module placed.
 */
export function applyProtection(root: HTMLElement, target: RegionTarget | null): void {
  // Injected unconditionally: the sheet also carries the watermark and blur-veil
  // presentation, and those can be the ONLY measure active on a screen (e.g. the
  // PRD-18 debug run always shows the mark while `copy` is forced to `null` — FR-25).
  // Gating this on `target` left the mark and veil unstyled whenever copy protection
  // itself was off.
  ensureStyle(root);
  root.querySelectorAll<HTMLElement>("[" + PROTECTED_ATTR + "]").forEach(unmark);
  if (root.hasAttribute(PROTECTED_ATTR)) unmark(root);
  if (!target) return;
  for (const el of elementsOf(root, target)) mark(el);
  ensureListeners(root);
}
