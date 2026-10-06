/**
 * @module shared/sim/geometry
 *
 * Shapes of scenario zones and the hit test behind every click.
 *
 * A zone is a rectangle by default, optionally with rounded corners (`radius`, stage pixels;
 * a click in a cut-off corner is outside). `shape: "ellipse"` keeps the same `x, y, w, h` and means
 * the ellipse inscribed in that rectangle — a circle when `w === h`. `shape: "polygon"` gives
 * the outline as `points` in stage pixels; its rectangle is not stored but derived, so a polygon
 * can never disagree with its own bounding box.
 *
 * One module for the engine, the player and the import checks: whether a click hits a zone is
 * decided in exactly one place.
 */
import type { Box } from "./contract";

/** A point in stage pixels. */
export type Point = [number, number];

/** The geometry part of a zone. */
export type ZoneShape =
  | ({ shape?: "rect"; radius?: number } & Box)
  | ({ shape: "ellipse" } & Box)
  | { shape: "polygon"; points: Point[] };

/** Bounding box of a zone of any shape. */
export function boundsOf(z: ZoneShape): Box {
  if (z.shape === "polygon") {
    const xs = z.points.map((p) => p[0]);
    const ys = z.points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: z.x, y: z.y, w: z.w, h: z.h };
}

/**
 * Is the point inside the polygon? Even-odd ray casting; a point exactly on an edge counts
 * as inside, so a click on a zone's border is never a miss.
 */
export function insidePolygon(points: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (onSegment(xi, yi, xj, yj, x, y)) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function onSegment(x1: number, y1: number, x2: number, y2: number, x: number, y: number): boolean {
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-9) return false;
  return x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
}

/** Tolerance of curved borders: a point on the arc computed in floating point is still on it. */
const EPS = 1e-6;

/** Does a click at stage point (x, y) hit the zone? */
export function contains(z: ZoneShape, x: number, y: number): boolean {
  if (z.shape === "polygon") return insidePolygon(z.points, x, y);
  if (z.shape === "ellipse") {
    const rx = z.w / 2;
    const ry = z.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (x - (z.x + rx)) / rx;
    const dy = (y - (z.y + ry)) / ry;
    return dx * dx + dy * dy <= 1 + EPS;
  }
  if (!(x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h)) return false;
  // Rounded corners: outside the quarter circle of a corner is outside the zone.
  const r = Math.min(z.radius ?? 0, z.w / 2, z.h / 2);
  if (r <= 0) return true;
  const dx = Math.max(z.x + r - x, 0, x - (z.x + z.w - r));
  const dy = Math.max(z.y + r - y, 0, y - (z.y + z.h - r));
  return dx * dx + dy * dy <= r * r * (1 + EPS);
}

/** Corner radius a rectangle zone is drawn with (0 for other shapes). */
export function radiusOf(z: ZoneShape): number {
  if (z.shape === "polygon" || z.shape === "ellipse") return 0;
  return Math.max(0, Math.min(z.radius ?? 0, z.w / 2, z.h / 2));
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * Why a polygon is not usable as a zone, or null when it is.
 *
 * Fewer than three vertices, repeated vertices or crossing edges make «inside» ambiguous, so
 * the import rejects them rather than let the player guess.
 */
export function polygonProblem(points: Point[]): string | null {
  if (!Array.isArray(points) || points.length < 3) return "меньше трёх вершин";
  const seen = new Set<string>();
  for (const p of points) {
    const key = `${p[0]},${p[1]}`;
    if (seen.has(key)) return `вершина ${key} повторяется`;
    seen.add(key);
  }
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // Neighbouring edges share a vertex; that is not a crossing.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return "стороны пересекаются";
    }
  }
  return null;
}

/** SVG `points` attribute of a polygon. */
export function svgPoints(points: Point[]): string {
  return points.map((p) => `${p[0]},${p[1]}`).join(" ");
}
