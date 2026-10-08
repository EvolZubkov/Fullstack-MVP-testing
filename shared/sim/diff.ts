/**
 * @module shared/sim/diff
 *
 * What changes on screen when the run moves from one scene to another.
 *
 * An element that is on both scenes under the same id, with the same image and the same box,
 * STAYS: the host keeps its DOM node, so moving from «menu closed» to «menu open» redraws
 * only the menu. Everything else is removed or added; added elements play their `appear`.
 * Duplicating a scene in the editor keeps element ids — that is what makes the rule work.
 */
import type { FieldPlacement, MediaItem, Scene, SceneElement } from "./contract";

/** The change set between two scenes. */
export interface SceneDiff {
  /** Ids kept as they are. */
  keep: string[];
  /** Elements to add, in the new scene's z-order. */
  add: SceneElement[];
  /** Ids to remove. */
  remove: string[];
}

/** The box an element occupies, with the image size filling the gaps. */
export function elementBox(el: SceneElement, media: Map<string, MediaItem>): { x: number; y: number; w: number; h: number } {
  const m = media.get(el.media);
  return { x: el.x, y: el.y, w: el.w ?? m?.w ?? 0, h: el.h ?? m?.h ?? 0 };
}

/** Where a field sits among the scene's elements. */
export interface FieldStacking {
  /**
   * The element the field belongs to: the smallest one whose box holds the whole field — the form it
   * is typed into. `-1` — no element holds it; the field then sits above every element, as before.
   */
  host: number;
  /** The host is shown: a field of a hidden form is hidden with it. */
  shown: boolean;
  /**
   * A shown element LATER in the scene's order overlaps the field — a dialog opened over the form.
   * The field is drawn under that element and must not take clicks meant for it.
   */
  covered: boolean;
}

/**
 * Stack a field among the scene's elements.
 *
 * The contract gives a field no layer of its own: it belongs to the form it lies on, and an element
 * drawn after that form — a dictionary dialog, a message — covers it. Drawing every field above
 * every element made a dialog show the form's values through itself and let a field under the
 * dialog swallow the clicks on the dialog's rows (images pass clicks through, the input did not).
 *
 * @param isShown Whether an element is currently shown.
 */
export function fieldStacking(
  scene: Scene,
  field: FieldPlacement,
  media: Map<string, MediaItem>,
  isShown: (id: string) => boolean,
): FieldStacking {
  const els = scene.elements;
  // The SMALLEST element that holds the whole field is its form: a dialog box with its own input
  // adopts that input, while a full-frame dialog — a screenshot with its own veil, as large as the
  // screen under it — is no more specific than that screen and does not adopt the form's fields.
  // Among equal sizes the lowest wins, for the same reason.
  let host = -1;
  let hostArea = Infinity;
  for (let i = 0; i < els.length; i += 1) {
    const b = elementBox(els[i], media);
    const holds = b.x <= field.x && b.y <= field.y && b.x + b.w >= field.x + field.w && b.y + b.h >= field.y + field.h;
    const area = b.w * b.h;
    if (holds && area < hostArea) {
      host = i;
      hostArea = area;
    }
  }
  if (host < 0) return { host, shown: true, covered: false };
  let covered = false;
  for (let i = host + 1; i < els.length && !covered; i += 1) {
    if (!isShown(els[i].id)) continue;
    const b = elementBox(els[i], media);
    covered = b.x < field.x + field.w && b.x + b.w > field.x && b.y < field.y + field.h && b.y + b.h > field.y;
  }
  return { host, shown: isShown(els[host].id), covered };
}

function same(a: SceneElement, b: SceneElement, media: Map<string, MediaItem>): boolean {
  if (a.media !== b.media) return false;
  const x = elementBox(a, media);
  const y = elementBox(b, media);
  return x.x === y.x && x.y === y.y && x.w === y.w && x.h === y.h;
}

/**
 * Diff two scenes.
 *
 * @param from  The scene on screen, or null when nothing is drawn yet.
 * @param to    The scene to show.
 * @param media The scenario's media library by id.
 * @returns What to keep, add and remove.
 */
export function diffScenes(from: Scene | null, to: Scene, media: Map<string, MediaItem>): SceneDiff {
  const before = new Map((from?.elements ?? []).map((e) => [e.id, e]));
  const keep: string[] = [];
  const add: SceneElement[] = [];
  for (const el of to.elements) {
    const old = before.get(el.id);
    if (old && same(old, el, media)) keep.push(el.id);
    else add.push(el);
  }
  const kept = new Set(keep);
  const remove = [...before.keys()].filter((id) => !kept.has(id));
  return { keep, add, remove };
}

/**
 * Start delays of added elements, by id: `with-previous` starts with the element before it,
 * `after-previous` waits until that one has finished appearing.
 */
export function appearSchedule(add: SceneElement[]): Map<string, { delayMs: number; durationMs: number; fade: boolean }> {
  const plan = new Map<string, { delayMs: number; durationMs: number; fade: boolean }>();
  let prevStart = 0;
  let prevEnd = 0;
  for (const el of add) {
    const a = el.appear ?? {};
    const fade = a.effect === "fade";
    const durationMs = fade ? (a.durationMs ?? 200) : 0;
    const start = (a.mode === "after-previous" ? prevEnd : prevStart) + (a.delayMs ?? 0);
    plan.set(el.id, { delayMs: start, durationMs, fade });
    prevStart = start;
    prevEnd = start + durationMs;
  }
  return plan;
}
