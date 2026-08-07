/**
 * @module shared/template/chart-frame
 *
 * The frame both cross-scale diagrams share: viewport, ring radius, caption typography and
 * the caption-placement rule (PRD-35 for the radar, PRD-46 for the rose).
 *
 * It exists because the two charts are two READINGS of the same profile, not two widgets.
 * The learner may see a radar in one test and a rose in another, and an author may switch
 * between them on the same test; if the field radius or the label gap drifted between the
 * modules, the switch would move every caption on the screen for no reason the author asked
 * for. Every number here was tuned against the approved wireframe and, in two cases, against
 * a real browser — see the notes on WIDTH and on {@link placeCaption}.
 *
 * Pure — no DOM, no Node.
 */

/** Below three axes there is no figure to read — a pair of rulers reads better. */
export const MIN_AXES = 3;

/**
 * Viewport of the widget, in its own coordinates — the rendered size is CSS's business, so
 * print and a 360px phone reuse the same numbers. Not square: the labels need horizontal
 * room, the rings do not (values taken from the approved wireframe
 * docs/wireframes/prd35-competency-radar.html).
 *
 * The width is 20px wider than that wireframe, and the centre with it: the side labels of a
 * four-axis chart are centred on the ray end at CENTER_X ± 130, so each of them owns twice
 * the gap to the edge. At 340 that gap was 40px and «Вдохновляющий» (92px at the 12px body
 * font) was cut to «Вдохно»; at 360 it is 50px, i.e. 100px of room. HEIGHT stays — nothing
 * overflows vertically.
 */
export const WIDTH = 360;
export const HEIGHT = 300;
export const CENTER_X = 180;
export const CENTER_Y = 150;
/** Radius of the field: the outer ring, which nothing may cross. */
export const RADIUS = 100;
/** Distance from the centre to the caption, past the outer ring. */
export const LABEL_GAP = 30;
/** Baseline step between caption lines. */
export const LINE_STEP = 15;
/**
 * Soft limit for one caption line, in characters.
 *
 * A centred label at the left rim has only twice its distance to the edge to live in, and
 * «Обесценивание достижений» set on one line overflowed the viewport — the browser check
 * caught it, no test would have. Wrapping happens HERE and not in the layout because the DSL
 * cannot measure, split or count anything.
 */
export const MAX_LINE_CHARS = 14;
/** Hard stop, so a pathological name cannot push the level label off the canvas. */
export const MAX_LINES = 3;

/**
 * A ray counts as horizontal when |sin| falls below this. Only EXACTLY horizontal rays are
 * meant — an even axis count puts two of them on the X axis, where `sin` is either 0 or
 * `Math.sin(Math.PI)` ≈ 1.2e-16. The threshold exists solely because of that second value,
 * so it is deliberately a float-noise guard and not a "nearly horizontal" tolerance: a wider
 * one would start catching genuinely slanted rays (with 23 axes the nearest is already at
 * |sin| ≈ 0.068) and centre their captions on a ray that visibly is not horizontal.
 */
export const HORIZONTAL_SIN = 1e-6;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * One line of text on the chart — a wrapped piece of a scale name or its level.
 *
 * Deliberately FLAT and self-sufficient: the layout draws every caption with a single loop,
 * because a DSL loop cannot reach its parent for the shared x or the anchor, and a name may
 * wrap onto a different number of lines than its neighbour.
 */
export interface CtxChartLabel {
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** Component class, e.g. `tb-radar__label` for a name and `tb-radar__level` for a level. */
  className: string;
}

/**
 * Greedy word wrap. A word longer than the limit keeps its own line rather than being cut: a
 * truncated term is worse than a wide one, and scale names are terms.
 */
export function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    // On the last allowed line everything left is kept together: overflowing beats dropping
    // words the reader then cannot recover.
    const isLastLine = lines.length === maxLines - 1;
    if (line && candidate.length > maxChars && !isLastLine) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Side of the icon box, in chart units. Lucide draws on a 24-unit grid, so the icon is scaled
 * by `ICON_SIZE / 24`; the box is one caption line tall, which keeps the block's vertical
 * rhythm the same whether an icon is present or not.
 */
export const ICON_SIZE = 16;

/**
 * An icon above a caption, ready to draw.
 *
 * Geometry and not a component name: the SCORM package renders inside whatever engine the LMS
 * embeds, with no React and no icon font, so whatever the author picked has to arrive as
 * contours. Every source node is normalised to a path `d`, because a DSL loop cannot switch
 * the tag it emits.
 */
export interface CtxChartIcon {
  /** Ready for the `transform` attribute: places and scales the 24-unit grid. */
  transform: string;
  paths: string[];
}

export interface CaptionInput {
  /** Scale name; wrapped here, because the DSL cannot measure text. */
  name: string;
  /** Level label, or an empty string when the value falls outside every declared band. */
  levelText: string;
  /** Direction of the ray the caption belongs to. */
  cos: number;
  sin: number;
  /**
   * Distance from the centre the captions sit at.
   *
   * A parameter and not `RADIUS + LABEL_GAP`, because the two charts measure it from
   * different things. The radar's rays always end at the field edge, so its captions ring
   * the field. The rose's sectors rarely reach the edge — a typical share of a third puts
   * them at 0.59 of it — and a caption ring at the field edge would leave a band of empty
   * canvas a third of the drawing wide between the figure and its own labels.
   */
  ringRadius: number;
  /** Contours of the scale's icon, already normalised to path data; absent when unset. */
  iconPaths?: string[];
  nameClass: string;
  levelClass: string;
}

export interface CaptionOutput {
  labels: CtxChartLabel[];
  icon: CtxChartIcon | null;
}

/**
 * The caption block of one ray: the wrapped name, then the level, all lines already placed.
 *
 * EVERY caption is centred on its ray end — including the side ones, which used to be
 * anchored outwards and so spent the whole gap to the edge on one side: at the right rim
 * «Вдохновляющий» ran off the canvas. Centred, a caption owns twice that gap.
 *
 * Above the circle the block grows UPWARDS, below it downwards: otherwise a two-line name at
 * the top would run into the outer ring. The clamp keeps the block on the canvas — without it
 * a three-line caption at the top started at a NEGATIVE baseline and its first line was cut
 * off by the viewport (found in the browser, not by a test). A horizontal ray has no "above"
 * or "below": its block is centred ON the ray, half over and half under, the way a centred
 * anchor already treats X. Growing downwards there hung the whole caption below the line.
 */
export function placeCaption(input: CaptionInput): CaptionOutput {
  const lines = wrapLabel(input.name, MAX_LINE_CHARS, MAX_LINES);
  const hasIcon = Array.isArray(input.iconPaths) && input.iconPaths.length > 0;
  // The icon takes a line of its own in the block, so a captioned ray keeps the same rhythm
  // with and without one and the «grows upwards» clamp above the circle still holds.
  const blockLines = lines.length + (input.levelText ? 1 : 0) + (hasIcon ? 1 : 0);
  const x = round1(CENTER_X + input.cos * input.ringRadius);
  const baseline = CENTER_Y + input.sin * input.ringRadius;

  let firstY: number;
  if (Math.abs(input.sin) < HORIZONTAL_SIN) {
    firstY = baseline - ((blockLines - 1) * LINE_STEP) / 2;
  } else if (input.sin < 0) {
    firstY = Math.max(LINE_STEP, baseline - (blockLines - 1) * LINE_STEP);
  } else {
    firstY = baseline;
  }

  // The icon owns the first slot; the text starts one line lower when it is present.
  const textFirstY = hasIcon ? firstY + LINE_STEP : firstY;
  const out: CtxChartLabel[] = lines.map((text, line) => ({
    text,
    x,
    y: round1(textFirstY + line * LINE_STEP),
    anchor: "middle" as const,
    className: input.nameClass,
  }));
  if (input.levelText) {
    out.push({
      text: input.levelText,
      x,
      y: round1(textFirstY + lines.length * LINE_STEP),
      anchor: "middle" as const,
      className: input.levelClass,
    });
  }

  const scale = ICON_SIZE / 24;
  const icon = hasIcon
    ? {
        // The slot's baseline is `firstY`; a glyph hangs ABOVE its baseline, so the box top
        // is one icon height up, and the box is centred on the caption's own x.
        transform: `translate(${round1(x - ICON_SIZE / 2)}, ${round1(firstY - ICON_SIZE)}) scale(${Math.round(scale * 1000) / 1000})`,
        paths: input.iconPaths as string[],
      }
    : null;

  return { labels: out, icon };
}
