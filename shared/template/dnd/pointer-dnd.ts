/**
 * @module shared/template/dnd/pointer-dnd
 *
 * Framework-free pointer drag-and-drop controller (PRD-12 DnD unification). It is
 * the single authoritative drag engine shared by both runtime hosts: imported
 * directly by the web host (mounted on a shadow root) and compiled into the SCORM
 * package via {@link module:shared/template/runtime-entry} (exposed on `TBTemplate`,
 * mounted on `document`), replacing the native HTML5 DnD that used to live in the
 * SCORM runtime (`app/dnd/matching.js`).
 *
 * It uses pointer events (mouse + touch) with an explicit, themeable CARD ghost
 * that follows the pointer — NOT the browser's native HTML5 drag image, which is
 * drawn outside the DOM (so it cannot be styled, isolated in a shadow root, or
 * captured in tests). Draggable items carry `data-drag="<id>"`, drop zones
 * `data-drop="<id>"`; a completed drag invokes `onDrop({ dragId, dropId })`. The
 * `dropId` is the empty string when the chip is released away from every zone, so
 * the host can use that to break an existing pairing (pull-away to detach).
 *
 * The drop target is the zone the ghost overlaps MOST by area (a forgiving ~10%
 * of the card area is enough — no need to land the pointer precisely on it). This
 * module owns only the gesture and the ghost; the host decides what a drop means
 * (e.g. via {@link module:shared/template/dnd/matching-model}).
 */

/** A node the controller can delegate events on and host the ghost within. */
export type DndRoot = Document | ShadowRoot | HTMLElement;

/** Configuration for {@link attachPointerDnd}. */
export interface PointerDndConfig {
  /**
   * Called once per completed real drag (one that passed the movement
   * threshold). `dropId` is the `data-drop` value of the overlapped zone, or the
   * empty string when released away from every zone.
   */
  onDrop: (drag: { dragId: string; dropId: string }) => void;
  /**
   * CSS selector for the element cloned as the ghost (the visible card). The
   * nearest match above the grabbed `[data-drag]` element is used; when none
   * matches, the `[data-drag]` element itself is cloned. Defaults to the
   * matching/ranking card containers.
   */
  cardSelector?: string;
  /**
   * Minimum fraction of the ghost's area that must overlap a zone for it to
   * register as the drop target. Defaults to `0.1` (10%).
   */
  overlapThreshold?: number;
}

interface DragState {
  dragId: string;
  card: HTMLElement;
  ghost: HTMLElement | null;
  started: boolean;
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
  width: number;
  sourceDrop: Element | null;
}

/**
 * Attaches the pointer DnD controller to `root`. Returns a detach function that
 * removes every listener and cleans up any in-flight ghost.
 *
 * @param root   The delegation root (a shadow root in the web host, `document`
 *               in the SCORM host).
 * @param config See {@link PointerDndConfig}.
 * @returns A teardown function.
 */
export function attachPointerDnd(root: DndRoot, config: PointerDndConfig): () => void {
  const cardSelector = config.cardSelector || ".match-tile, .rank-item";
  const threshold = typeof config.overlapThreshold === "number" ? config.overlapThreshold : 0.1;
  // Documents cannot host arbitrary children; append the ghost to <body> instead.
  const ghostParent: ParentNode & { appendChild: (n: Node) => Node } =
    root.nodeType === 9 ? (root as Document).body : (root as ShadowRoot | HTMLElement);

  let dragState: DragState | null = null;

  const clearOver = () =>
    root.querySelectorAll(".is-over").forEach((n) => (n as Element).classList.remove("is-over"));

  // The drop zone the dragged card overlaps MOST by area (excluding its own
  // source zone). Registers from `threshold` of the card area — a forgiving drop.
  const overlapDropZone = (st: DragState): Element | null => {
    if (!st.ghost) return null;
    const g = st.ghost.getBoundingClientRect();
    const cardArea = g.width * g.height;
    if (cardArea <= 0) return null;
    let best: Element | null = null;
    let bestArea = 0;
    root.querySelectorAll("[data-drop]").forEach((dz) => {
      if (dz === st.sourceDrop) return;
      const r = (dz as HTMLElement).getBoundingClientRect();
      const ix = Math.max(0, Math.min(g.right, r.right) - Math.max(g.left, r.left));
      const iy = Math.max(0, Math.min(g.bottom, r.bottom) - Math.max(g.top, r.top));
      const area = ix * iy;
      if (area > bestArea) {
        bestArea = area;
        best = dz;
      }
    });
    return bestArea >= threshold * cardArea ? best : null;
  };

  const beginGhost = (st: DragState) => {
    const ghost = st.card.cloneNode(true) as HTMLElement;
    // Strip drag/drop hooks from the clone so it is never itself treated as a
    // draggable or (critically) a drop zone in overlap hit-testing.
    ghost.removeAttribute("data-drag");
    ghost.removeAttribute("data-drop");
    ghost.querySelectorAll("[data-drop],[data-drag]").forEach((n) => {
      (n as Element).removeAttribute("data-drop");
      (n as Element).removeAttribute("data-drag");
    });
    ghost.setAttribute("data-drag-ghost", "");
    ghost.style.position = "fixed";
    ghost.style.zIndex = "9999";
    ghost.style.margin = "0";
    ghost.style.width = `${st.width}px`;
    ghost.style.opacity = "0.6";
    ghost.style.pointerEvents = "none";
    ghost.style.background = "var(--card)";
    ghost.style.border = "1px solid var(--border)";
    ghost.style.borderRadius = "12px";
    ghost.style.boxShadow = "var(--shadow)";
    ghost.style.color = "var(--foreground)";
    ghostParent.appendChild(ghost);
    st.ghost = ghost;
    st.card.classList.add("dragging");
  };

  const onPointerDown = (e: Event) => {
    const pe = e as PointerEvent;
    if (pe.button) return; // primary button / touch only
    const el = (pe.target as Element | null)?.closest?.("[data-drag]") as HTMLElement | null;
    if (!el) return;
    pe.preventDefault();
    const card = (el.closest(cardSelector) as HTMLElement | null) || el;
    const rect = card.getBoundingClientRect();
    dragState = {
      dragId: el.getAttribute("data-drag") || "",
      card,
      ghost: null,
      started: false,
      startX: pe.clientX,
      startY: pe.clientY,
      grabX: pe.clientX - rect.left,
      grabY: pe.clientY - rect.top,
      width: rect.width,
      sourceDrop: el.closest("[data-drop]"),
    };
    try {
      el.setPointerCapture(pe.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerMove = (e: Event) => {
    const st = dragState;
    if (!st) return;
    const pe = e as PointerEvent;
    if (!st.started) {
      if (Math.hypot(pe.clientX - st.startX, pe.clientY - st.startY) < 4) return;
      st.started = true;
      beginGhost(st);
    }
    if (st.ghost) {
      st.ghost.style.left = `${pe.clientX - st.grabX}px`;
      st.ghost.style.top = `${pe.clientY - st.grabY}px`;
    }
    clearOver();
    const dz = overlapDropZone(st);
    if (dz) dz.classList.add("is-over");
  };

  const finish = () => {
    const st = dragState;
    if (!st) return;
    dragState = null;
    const dz = st.started ? overlapDropZone(st) : null;
    if (st.ghost) st.ghost.remove();
    st.card.classList.remove("dragging");
    clearOver();
    // Emit on every real drag (started), even with no target — an empty dropId
    // means "released away from any zone", which the host uses to break a pair.
    if (st.started) config.onDrop({ dropId: dz ? dz.getAttribute("data-drop") || "" : "", dragId: st.dragId });
  };

  // Cards still carry the legacy `draggable="true"` attribute. On a REAL pointer
  // drag the browser would then start a NATIVE HTML5 drag, which fires
  // `pointercancel` and aborts this gesture — so mouse dragging silently did
  // nothing (only synthetic PointerEvents, which never trigger native drag, worked).
  // Suppress the native drag so this pointer engine is the sole mechanic.
  const onDragStart = (e: Event) => {
    if ((e.target as Element | null)?.closest?.("[data-drag]")) e.preventDefault();
  };

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", finish);
  root.addEventListener("pointercancel", finish);
  root.addEventListener("dragstart", onDragStart);
  return () => {
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerup", finish);
    root.removeEventListener("pointercancel", finish);
    root.removeEventListener("dragstart", onDragStart);
    if (dragState?.ghost) dragState.ghost.remove();
  };
}
