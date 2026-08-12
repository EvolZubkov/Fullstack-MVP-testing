/**
 * @module shared/template/lucide-contours
 *
 * Turns a lucide icon declaration into plain PATH data (PRD-46 §8).
 *
 * Why contours and not a name. The pictogram an author picks has to be drawn on the results
 * chart of BOTH players, and a SCORM package is a folder of static files: no React, no icon
 * font, no library to look a name up in. So the geometry has to travel with the data, and the
 * only shape every renderer can draw without help is `<path d="…">`.
 *
 * Why every node collapses to a path rather than being copied as `<circle>`/`<rect>`. The chart
 * context is a flat list of `d` strings the layout loops over once; keeping the element kind
 * would put a conditional into a template language that has no conditionals, and would force
 * the same conversion on every layout that ever draws an icon. A circle becomes two half-arcs —
 * the classic way to describe a full circle in path data, and the same form lucide's own SVG
 * export uses.
 *
 * The conversion runs where the library IS available (on the host, at bake or context time),
 * never in the package.
 *
 * Pure — no DOM, no Node.
 */

/** One lucide node: the element name plus its attributes, exactly as `iconNode` carries it. */
export type LucideNode = [string, Record<string, string | number>];

/** Trim the float noise `12 - 10` style arithmetic leaves behind, then drop a trailing `.0`. */
function num(value: string | number | undefined, fallback = 0): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * A full ellipse as TWO half-arcs.
 *
 * One arc cannot close an ellipse: an arc command whose endpoints coincide is degenerate and
 * renderers drop it, so the glyph would silently lose its circle. Two half-turns are what SVG
 * exporters emit for the same reason.
 */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const w = rx * 2;
  return (
    `M${fmt(cx - rx)} ${fmt(cy)}` +
    `a${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(w)} 0` +
    `a${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(-w)} 0`
  );
}

/** `x,y x,y …` or `x y x y …` — lucide writes both. */
function points(raw: string | number | undefined): Array<[number, number]> {
  const parts = String(raw ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter((p) => p !== "")
    .map((p) => parseFloat(p));
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (Number.isFinite(parts[i]) && Number.isFinite(parts[i + 1])) out.push([parts[i], parts[i + 1]]);
  }
  return out;
}

function polyPath(raw: string | number | undefined, close: boolean): string | null {
  const pts = points(raw);
  if (pts.length === 0) return null;
  const [first, ...rest] = pts;
  const line = rest.map(([x, y]) => `L${fmt(x)} ${fmt(y)}`).join("");
  return `M${fmt(first[0])} ${fmt(first[1])}${line}${close ? "Z" : ""}`;
}

/**
 * Rectangle, with rounded corners when the declaration asks for them.
 *
 * The radius is CLAMPED to half the side, as SVG itself does: lucide keeps a few glyphs whose
 * `rx` exceeds the box, and an unclamped corner arc turns them inside out.
 */
function rectPath(attrs: Record<string, string | number>): string | null {
  const x = num(attrs.x);
  const y = num(attrs.y);
  const w = num(attrs.width);
  const h = num(attrs.height);
  if (!(w > 0) || !(h > 0)) return null;

  const hasRx = attrs.rx !== undefined || attrs.ry !== undefined;
  const rx = Math.min(hasRx ? num(attrs.rx ?? attrs.ry) : 0, w / 2);
  const ry = Math.min(hasRx ? num(attrs.ry ?? attrs.rx) : 0, h / 2);
  if (!(rx > 0) || !(ry > 0)) {
    return `M${fmt(x)} ${fmt(y)}h${fmt(w)}v${fmt(h)}h${fmt(-w)}Z`;
  }
  return (
    `M${fmt(x + rx)} ${fmt(y)}` +
    `h${fmt(w - rx * 2)}a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(rx)} ${fmt(ry)}` +
    `v${fmt(h - ry * 2)}a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(-rx)} ${fmt(ry)}` +
    `h${fmt(-(w - rx * 2))}a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(-rx)} ${fmt(-ry)}` +
    `v${fmt(-(h - ry * 2))}a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(rx)} ${fmt(-ry)}Z`
  );
}

/** One node as path data, or `null` for an element kind that draws nothing. */
export function nodeToPath(node: LucideNode): string | null {
  const [kind, attrs] = node;
  switch (kind) {
    case "path": {
      const d = String(attrs?.d ?? "").trim();
      return d === "" ? null : d;
    }
    case "circle": {
      const r = num(attrs?.r);
      return r > 0 ? ellipsePath(num(attrs?.cx), num(attrs?.cy), r, r) : null;
    }
    case "ellipse": {
      const rx = num(attrs?.rx);
      const ry = num(attrs?.ry);
      return rx > 0 && ry > 0 ? ellipsePath(num(attrs?.cx), num(attrs?.cy), rx, ry) : null;
    }
    case "line":
      return `M${fmt(num(attrs?.x1))} ${fmt(num(attrs?.y1))}L${fmt(num(attrs?.x2))} ${fmt(num(attrs?.y2))}`;
    case "polyline":
      return polyPath(attrs?.points, false);
    case "polygon":
      return polyPath(attrs?.points, true);
    case "rect":
      return rectPath(attrs ?? {});
    default:
      // An element kind this converter does not know is DROPPED, not guessed at. The glyph
      // loses a stroke and stays recognisable; an invented path would draw a wrong shape and
      // look deliberate.
      return null;
  }
}

/** The whole glyph as path data, in declaration order. */
export function iconToPaths(nodes: readonly LucideNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes ?? []) {
    if (!Array.isArray(node) || typeof node[0] !== "string") continue;
    const d = nodeToPath(node);
    if (d) out.push(d);
  }
  return out;
}
