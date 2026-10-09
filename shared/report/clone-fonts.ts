/**
 * @module shared/report/clone-fonts
 *
 * Makes the rasterizer's CLONE see the same fonts the canvas draws with.
 *
 * html2canvas does its work in two documents. It copies the page into a hidden iframe and
 * measures every word THERE (`Range.getBoundingClientRect`), then paints each word with
 * `fillText` on a canvas owned by the SOURCE document, at the measured spot. When the two
 * documents resolve the face differently — the clone has not decoded the embedded woff2 yet,
 * or falls back to another family — every word is painted wider (or narrower) than the gap
 * the layout left for it, and the PDF loses its spaces: «несколькимтемам»,
 * «стандартуруководителяв». The fault is invisible on screen and depends on the machine,
 * which is why it kept escaping reproduction.
 *
 * `syncCloneFonts` runs as html2canvas `onclone` (before any measuring) and establishes the
 * invariant explicitly instead of trusting `fonts.ready`:
 * 1. every face the source document has LOADED is requested in the clone and awaited;
 * 2. a probe string is measured in the clone's DOM and on a source-document canvas, and the
 *    export waits until the widths agree.
 * Both steps are bounded by one deadline: a stuck font must not hang the learner's download,
 * so after it the page prints as is and the mismatch is reported to the console.
 *
 * Browser-only in effect; without the Font Loading API (jsdom, very old engines) it is a no-op.
 */

/** Knobs of {@link syncCloneFonts}; defaults suit a real export. */
export interface SyncCloneFontsOptions {
  /** Overall deadline for loading and verification, ms. */
  timeoutMs?: number;
  /** Pause between width checks while the clone is still catching up, ms. */
  pollMs?: number;
}

/** The part of `FontFace` this module reads. */
interface FaceLike {
  family: string;
  weight: string;
  style: string;
  status: string;
}

/** The part of `FontFaceSet` this module uses. */
interface FontSetLike {
  forEach(fn: (face: FaceLike) => void): void;
  load(font: string, text?: string): Promise<unknown>;
  ready?: Promise<unknown>;
}

/** Default overall deadline, ms. */
const DEFAULT_TIMEOUT_MS = 5000;
/** Default pause between width checks, ms. */
const DEFAULT_POLL_MS = 50;
/** Size the faces are requested and compared at; widths scale linearly with it. */
const PROBE_SIZE_PX = 16;
/**
 * Probe text: Cyrillic and Latin letters, digits, punctuation and spaces — the glyphs whose
 * advances decide where the report's words land.
 */
const PROBE_TEXT = "Съешь же ещё этих мягких французских булок, да выпей чаю. Quick fox 0123456789";
/** Width difference still treated as «the same face», as a share of the width. */
const WIDTH_TOLERANCE = 0.005;

/**
 * Font set of a document, when the engine has the Font Loading API.
 *
 * @param doc Document to read.
 */
function fontSetOf(doc: Document): FontSetLike | null {
  const fonts = (doc as Document & { fonts?: FontSetLike }).fonts;
  return fonts && typeof fonts.forEach === "function" && typeof fonts.load === "function" ? fonts : null;
}

/**
 * CSS `font` shorthands of the faces the source document has actually loaded.
 *
 * Only loaded faces matter: a face the page never used is not on the canvas either. A
 * variable face reports its weight as a range — its lower bound is enough to request it.
 *
 * @param fonts Source font set.
 */
function loadedFaceDescriptors(fonts: FontSetLike): string[] {
  const seen = new Set<string>();
  fonts.forEach((face) => {
    if (face.status !== "loaded") return;
    const family = face.family.replace(/^["']|["']$/g, "");
    const weight = String(face.weight).trim().split(/\s+/)[0] || "400";
    const style = face.style || "normal";
    seen.add(`${style} ${weight} ${PROBE_SIZE_PX}px "${family}"`);
  });
  return [...seen];
}

/**
 * Resolves after `ms` — or never rejects, so it can bound a race.
 *
 * @param ms Delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Faces whose probe width in the clone differs from the canvas width in the source.
 *
 * @param source Document that owns the canvas.
 * @param clone Rasterizer's clone.
 * @param descriptors Faces to compare.
 * @returns Mismatching descriptors; empty when nothing can be measured (no canvas).
 */
function mismatchedFaces(source: Document, clone: Document, descriptors: string[]): string[] {
  const ctx = source.createElement("canvas").getContext("2d");
  if (!ctx || !clone.body) return [];
  const bad: string[] = [];
  for (const font of descriptors) {
    ctx.font = font;
    const canvasWidth = ctx.measureText(PROBE_TEXT).width;
    const probe = clone.createElement("span");
    probe.setAttribute("data-tb-font-probe", "");
    probe.style.cssText = "position:absolute;left:-9999px;top:0;white-space:pre;visibility:hidden;";
    probe.style.font = font;
    probe.textContent = PROBE_TEXT;
    clone.body.appendChild(probe);
    const domWidth = probe.getBoundingClientRect().width;
    probe.remove();
    if (!canvasWidth || !domWidth) continue;
    if (Math.abs(domWidth - canvasWidth) > canvasWidth * WIDTH_TOLERANCE) bad.push(font);
  }
  return bad;
}

/**
 * Make the clone measure text with the faces the canvas paints with. Use as (or inside)
 * html2canvas `onclone`.
 *
 * @param source Document that owns the page and the canvas.
 * @param clone The clone html2canvas is about to measure.
 * @param options See {@link SyncCloneFontsOptions}.
 * @returns Resolves when the faces agree or the deadline passes; never rejects.
 */
export async function syncCloneFonts(
  source: Document,
  clone: Document,
  options: SyncCloneFontsOptions = {},
): Promise<void> {
  const sourceFonts = fontSetOf(source);
  const cloneFonts = fontSetOf(clone);
  if (!sourceFonts || !cloneFonts) return;
  const descriptors = loadedFaceDescriptors(sourceFonts);
  if (!descriptors.length) return;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());

  try {
    // 1. Request every face explicitly. `fonts.ready` alone resolves as soon as nothing is
    //    PENDING — and a face the clone's layout has not asked for yet is not pending.
    await Promise.race([
      Promise.all(descriptors.map((font) => cloneFonts.load(font, PROBE_TEXT).catch(() => []))).then(
        () => cloneFonts.ready,
      ),
      delay(remaining()),
    ]);

    // 2. Verify the invariant itself: same probe, same width in the clone and on the canvas.
    let bad = mismatchedFaces(source, clone, descriptors);
    while (bad.length && remaining() > 0) {
      await delay(Math.min(pollMs, remaining()));
      bad = mismatchedFaces(source, clone, bad);
    }
    if (bad.length) {
      console.warn("[report-pdf] шрифт клона растеризатора расходится с холстом:", bad.join("; "));
    }
  } catch {
    // The export must not fail over a font: print with what the clone has.
  }
}
