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

/**
 * Contours of the four lucide icons the reference test uses, normalised to path data the way
 * the host will normalise whatever the author picks. Circles are written as two half-arcs:
 * a DSL loop cannot switch the tag it emits, so every node has to become a `path`.
 *
 * Matched by meaning: цель для целеустремлённого, искры для вдохновляющего, люди для
 * командного, шестерёнка для процессного.
 */
const ICONS: Record<string, string[]> = {
  target: [
    "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0",
    "M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0",
    "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
  ],
  sparkles: [
    "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
    "M20 3v4",
    "M22 5h-4",
    "M4 17v2",
    "M5 18H3",
  ],
  "users-round": [
    "M18 21a8 8 0 0 0-16 0",
    "M5 8a5 5 0 1 0 10 0a5 5 0 1 0 -10 0",
    "M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3",
  ],
  settings: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
  ],
};

// У «Командного» пиктограммы НЕТ намеренно: она необязательна, и эскиз должен показывать
// смешанный случай — иначе подпись без иконки нигде не проверяется, а она рисуется иначе
// (блок подписи не резервирует под иконку строку и стоит выше).
const axes: RadarAxisInput[] = [
  ["Целеустремлённый", 34, "target"],
  ["Вдохновляющий", 16, "sparkles"],
  ["Командный", 14, ""],
  ["Процессный", 34, "settings"],
].map(([name, value, icon]) => ({
  key: String(name),
  name: String(name),
  value: Number(value),
  visibility: "level_and_value",
  interpretation: styleScale(),
  iconPaths: ICONS[String(icon)],
}));

const chart = buildRoseChart({ axes, ramp: LEVEL_SCHEMES.traffic });
if (!chart) throw new Error("роза не построилась");

const lines: string[] = [];
lines.push(`<svg class="tb-rose__svg" viewBox="0 0 ${chart.width} ${chart.height}" role="img"`);
lines.push(`     aria-label="${chart.ariaLabel}">`);
for (const s of chart.sectors) {
  lines.push(`  <path class="tb-rose__sector" d="${s.d}" style="--tb-hue: ${s.color}"></path>`);
}
// Сетка ПОВЕРХ заливок: под непрозрачными секторами она видна только в промежутках.
for (const r of chart.rings) {
  lines.push(`  <circle class="tb-rose__ring" cx="${r.cx}" cy="${r.cy}" r="${r.radius}"></circle>`);
}
for (const s of chart.spokes) {
  lines.push(`  <line class="tb-rose__axis" x1="${s.cx}" y1="${s.cy}" x2="${s.x}" y2="${s.y}"></line>`);
}
for (const icon of chart.icons) {
  lines.push(`  <g class="tb-rose__icon" transform="${icon.transform}">`);
  for (const d of icon.paths) lines.push(`    <path d="${d}"></path>`);
  lines.push("  </g>");
}
for (const l of chart.labels) {
  lines.push(`  <text class="${l.className}" x="${l.x}" y="${l.y}" text-anchor="${l.anchor}">${l.text}</text>`);
}
lines.push("</svg>");

console.log(lines.join("\n"));
console.log("\n<!-- доли: " + chart.sectors.map((s) => `${s.label} ${s.sharePercent}% r=${s.radius}`).join("; ") + " -->");
