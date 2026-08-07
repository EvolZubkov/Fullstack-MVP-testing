/**
 * @module scripts/dev/rose-wireframe-svg
 *
 * Prints the rose SVG for the ЧИЛ control filling, straight from the core geometry.
 *
 * The wireframe must show what the renderer actually produces: a hand-drawn approximation
 * would be reviewed and approved, and the difference would then surface only in the browser.
 * Run with `npx tsx scripts/dev/rose-wireframe-svg.mts`.
 */

import { buildRoseChart } from "../../shared/template/rose-view";
import { LEVEL_SCHEMES } from "../../shared/template/level-ramp";
import type { RadarAxisInput } from "../../shared/template/radar-view";
import type { ScaleInterpretation } from "../../shared/scales/interpretation";

const styleScale = (): ScaleInterpretation => ({
  domainMin: 0,
  domainMax: 98,
  valence: "none",
  bands: [
    { min: 0, max: 20, level: "low", label: "Слабо выражен" },
    { min: 20, max: 40, level: "mid", label: "Выражен" },
    { min: 40, max: 98, level: "high", label: "Доминирующий" },
  ],
});

const axes: RadarAxisInput[] = [
  ["Целеустремлённый", 34],
  ["Вдохновляющий", 16],
  ["Командный", 14],
  ["Процессный", 34],
].map(([name, value]) => ({
  key: String(name),
  name: String(name),
  value: Number(value),
  visibility: "level_and_value",
  interpretation: styleScale(),
}));

const chart = buildRoseChart({ axes, ramp: LEVEL_SCHEMES.traffic });
if (!chart) throw new Error("роза не построилась");

const lines: string[] = [];
lines.push(`<svg class="tb-rose__svg" viewBox="0 0 ${chart.width} ${chart.height}" role="img"`);
lines.push(`     aria-label="${chart.ariaLabel}">`);
for (const r of chart.rings) {
  lines.push(`  <circle class="tb-rose__ring" cx="${r.cx}" cy="${r.cy}" r="${r.radius}"></circle>`);
}
for (const s of chart.sectors) {
  lines.push(`  <path class="tb-rose__sector" d="${s.d}" style="--tb-hue: ${s.color}"></path>`);
}
// The reference ring goes ON TOP of the fills: underneath them it is entirely hidden, and it
// is the only anchor the reader has for judging the skew.
lines.push(
  `  <circle class="tb-rose__ring tb-rose__ring--even" cx="${chart.evenRing.cx}" cy="${chart.evenRing.cy}" r="${chart.evenRing.radius}"></circle>`,
);
for (const l of chart.labels) {
  lines.push(`  <text class="${l.className}" x="${l.x}" y="${l.y}" text-anchor="${l.anchor}">${l.text}</text>`);
}
// Без подписи пунктирное кольцо — знак, смысл которого с картинки не восстановить.
lines.push(`  <text class="tb-rose__caption" x="6" y="294" text-anchor="start">${chart.evenRingCaption}</text>`);
lines.push("</svg>");

console.log(lines.join("\n"));
console.log("\n<!-- доли: " + chart.sectors.map((s) => `${s.label} ${s.sharePercent}% r=${s.radius}`).join("; ") + " -->");
