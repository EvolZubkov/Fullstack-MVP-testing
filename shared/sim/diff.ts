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
import type { MediaItem, Scene, SceneElement } from "./contract";

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
