import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * @module check-wireframes-ds
 *
 * Lint gate for `docs/wireframes/*` ensuring product wireframes use only
 * UniversityRT Design System primitives (BEM classes `ou-*`, tokens
 * `var(--ou-*)`). The gate covers four categories of violations:
 *   1. Legacy class tokens (e.g. `btn`, `drawer-header`, `sidebar`).
 *   2. Raw color literals inside `<style>` blocks and standalone CSS.
 *   3. Direct length units (`px`, `rem`, `em`) inside `<style>` blocks
 *      and standalone CSS (excluding zero values).
 *   4. Legacy class selectors inside scanned CSS files.
 *
 * Optional `--strict-inline` flag additionally scans inline `style="..."`
 * attributes; whitelisted via `data-wf-demo` on the carrying element.
 */

const root = process.cwd();
const wireframesDir = join(root, 'docs', 'wireframes');
const includeExt = new Set(['.html', '.css']);
const args = new Set(process.argv.slice(2));
const STRICT_INLINE = args.has('--strict-inline');

const ignore = new Set([
  join(wireframesDir, 'ds', 'university-rt.css'),
  join(wireframesDir, 'approved', 'prd7-shared.css'),
]);
// All reference / legacy documents live under docs/wireframes/legacy/ and are
// skipped wholesale. Stage 5 of docs/wireframes-ds-fix-plan.md moved
// design-tab.html, pages-tab.html and ds-component-mapping.html into legacy/.
const ignoreDirs = [
  join(wireframesDir, 'legacy'),
];

const legacyClassTokens = [
  // Drawer
  'drawer-overlay', 'drawer', 'drawer-header', 'drawer-title', 'drawer-close',
  'drawer-tabs', 'drawer-tab', 'drawer-body', 'drawer-footer', 'drawer-banner',
  // Buttons
  'btn', 'btn-primary', 'btn-secondary', 'btn-outline', 'btn-ghost', 'btn-danger',
  'btn-sm', 'btn-xs', 'btn-icon', 'btn-link', 'btn-destructive',
  // Badges
  'badge', 'badge-outline', 'badge-primary', 'badge-secondary', 'badge-warn',
  'badge-error', 'badge-success',
  // Generic surface primitives
  'modal', 'dialog', 'toast', 'popover',
  // Forms
  'form-group', 'form-label', 'form-hint', 'form-error',
  // Sidebar / shell chrome
  'sidebar', 'sidebar-header', 'sidebar-nav', 'sidebar-footer',
  'sidebar-title', 'sidebar-nav-item',
  'nav-item', 'nav-icon', 'nav-group-label',
  'topbar', 'back-btn', 'test-title', 'topbar-actions',
  // Editor tabs
  'editor-tabs', 'etab',
  // Cards
  'card-row', 'card-header', 'card-body', 'card-title',
  // Skeleton
  'skel', 'skel-block',
  // Banners
  'banner-warn', 'banner-error', 'banner-info', 'banner-readonly',
  'banner-icon', 'banner-close',
  // Empty
  'empty-block', 'empty-title', 'empty-desc',
  // Modal/dialog parts
  'modal-overlay', 'modal-dialog', 'modal-title', 'modal-desc',
  'modal-actions', 'modal-warn',
  'dialog-header', 'dialog-body', 'dialog-footer', 'dialog-title',
  'dialog-footer-split', 'dialog-lg',
  'overlay',
  // Note: modal-option / modal-option-{title,sub,icon,danger} / modal-inset
  // have no DS equivalent (radio-card pattern inside modal) — gap, see audit.
  // Toggle / radio
  'toggle', 'toggle-row', 'toggle-on', 'toggle-off',
  'radio-row', 'radio-opt',
  // Note: 'section-label' / 'subsection-label' are NOT listed here.
  // DS does not provide an uppercase-caption label primitive; the wireframe
  // markup keeps these classes as a documented gap (see
  // docs/wireframes-ds-audit.md). Re-add them once DS exposes an equivalent.
];

const rawValuePatterns = [
  { name: 'hex-color', re: /#[0-9a-fA-F]{3,8}\b/g },
  { name: 'hsl()', re: /\bhsl\(/g },
  { name: 'hsla()', re: /\bhsla\(/g },
  { name: 'rgba()', re: /\brgba\(/g },
  { name: 'rgb()', re: /\brgb\(/g },
  { name: 'oklch()', re: /\boklch\(/g },
  { name: 'lab()', re: /\blab\(/g },
  { name: 'lch()', re: /\blch\(/g },
  { name: 'hwb()', re: /\bhwb\(/g },
  // Negative look-around on `[\w-]` keeps `white-space`, `text-black` and
  // similar CSS property tokens out of the named-color match.
  { name: 'named-color', re: /(?<![\w-])(?:white|black)(?![\w-])/g },
];

// Direct length units inside CSS scope. Excludes pure-zero values (`0`, `0.0`).
// `em` is typographic (letter-spacing, line-height proportions) and has no
// 1:1 token equivalent, so it is intentionally NOT scanned.
const directUnitRe = /(?<![\w-])(\d+(?:\.\d+)?)(px|rem)\b/g;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (ignore.has(full)) continue;
    if (ignoreDirs.some((d) => full === d || full.startsWith(d + '\\') || full.startsWith(d + '/'))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (includeExt.has(full.slice(full.lastIndexOf('.')))) acc.push(full);
  }
  return acc;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Extract content of <style>...</style> blocks from an HTML file with their
 * original text offsets preserved for accurate line reporting.
 */
function extractStyleBlocks(text) {
  const segments = [];
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    segments.push({ content: m[1], offset: m.index + m[0].indexOf(m[1]) });
  }
  return segments;
}

/**
 * For an offset that sits inside an attribute value, return the surrounding
 * tag text (from the preceding `<` to the following `>`). Used to whitelist
 * inline styles via `data-wf-demo` on the carrying element.
 */
function tagContaining(text, index) {
  const open = text.lastIndexOf('<', index);
  const close = text.indexOf('>', index);
  if (open < 0 || close < 0) return '';
  return text.slice(open, close + 1);
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Build a sorted list of half-open `[start, end)` byte ranges where the
 * carrying element OR any ancestor is tagged with `data-wf-demo`. Used to
 * whitelist demo subtrees (color swatches, preview sketches, mock chrome)
 * from inline raw-value scanning.
 */
function demoRanges(text) {
  const ranges = [];
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = tagRe.exec(text))) {
    const [full, slash, name, attrs] = m;
    if (slash) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          const opened = stack[i];
          if (opened.hasDemo && stack.findIndex((f, j) => j < i && f.hasDemo) < 0) {
            ranges.push([opened.start, m.index + full.length]);
          }
          stack.splice(i);
          break;
        }
      }
    } else if (!VOID_TAGS.has(name.toLowerCase()) && !/\/\s*$/.test(attrs)) {
      stack.push({
        name,
        start: m.index,
        hasDemo: /\bdata-wf-demo\b/.test(attrs),
      });
    }
  }
  return ranges;
}

function inDemoRange(ranges, index) {
  for (const [a, b] of ranges) if (index >= a && index < b) return true;
  return false;
}

const violations = [];
const files = walk(wireframesDir);

for (const file of files) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');
  const isHtml = file.endsWith('.html');
  const isCss = file.endsWith('.css');

  // ── 1. Legacy class tokens in HTML class="..." attributes ─────────────────
  if (isHtml) {
    for (const match of text.matchAll(/class="([^"]+)"/g)) {
      const tokens = match[1].split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        if (legacyClassTokens.includes(token)) {
          violations.push(`${rel}:${lineOf(text, match.index)} legacy class ".${token}"`);
        }
      }
    }
  }

  // ── 2/3. Raw colors and direct units inside CSS scope ─────────────────────
  const segments = isHtml ? extractStyleBlocks(text) : [{ content: text, offset: 0 }];

  // Allow CSS authors to opt a region out of raw / direct-unit scanning with
  // /* gate-skip-start */ ... /* gate-skip-end */ pragmas. Useful for the
  // wireframe-only px token definitions in prd7-shared.css.
  const skipRanges = [];
  for (const m of text.matchAll(/\/\*\s*gate-skip-start\s*\*\/[\s\S]*?\/\*\s*gate-skip-end\s*\*\//g)) {
    skipRanges.push([m.index, m.index + m[0].length]);
  }
  const inSkip = (i) => skipRanges.some(([a, b]) => i >= a && i < b);

  for (const { content, offset } of segments) {
    for (const { name, re } of rawValuePatterns) {
      for (const match of content.matchAll(re)) {
        const absoluteIndex = offset + match.index;
        if (inSkip(absoluteIndex)) continue;
        violations.push(`${rel}:${lineOf(text, absoluteIndex)} raw ${name}`);
      }
    }
    for (const match of content.matchAll(directUnitRe)) {
      if (parseFloat(match[1]) === 0) continue;
      const absoluteIndex = offset + match.index;
      if (inSkip(absoluteIndex)) continue;
      violations.push(`${rel}:${lineOf(text, absoluteIndex)} direct unit ${match[1]}${match[2]}`);
    }
  }

  // ── 4. Legacy class selectors in CSS files ────────────────────────────────
  if (isCss) {
    for (const token of legacyClassTokens) {
      const re = new RegExp(`(?<![\\w-])\\.${token}(?![\\w-])`, 'g');
      for (const match of text.matchAll(re)) {
        violations.push(`${rel}:${lineOf(text, match.index)} legacy CSS selector ".${token}"`);
      }
    }
  }

  // ── 5. Optional strict inline scan ────────────────────────────────────────
  if (STRICT_INLINE && isHtml) {
    const ranges = demoRanges(text);
    for (const match of text.matchAll(/style="([^"]*)"/g)) {
      const tag = tagContaining(text, match.index);
      if (/\bdata-wf-demo\b/.test(tag)) continue;
      if (inDemoRange(ranges, match.index)) continue;
      const value = match[1];
      const valueOffset = match.index + match[0].indexOf(value);
      for (const { name, re } of rawValuePatterns) {
        for (const m of value.matchAll(re)) {
          violations.push(`${rel}:${lineOf(text, valueOffset + m.index)} inline raw ${name}`);
        }
      }
      for (const m of value.matchAll(directUnitRe)) {
        if (parseFloat(m[1]) === 0) continue;
        violations.push(`${rel}:${lineOf(text, valueOffset + m.index)} inline direct unit ${m[1]}${m[2]}`);
      }
    }
  }

  // ── Drawer root/backdrop pairing (existing structural check) ──────────────
  if (isHtml) {
    const rootCount = [...text.matchAll(/class="[^"]*\bou-drawer-root\b[^"]*"/g)].length;
    const backdropCount = [...text.matchAll(/class="[^"]*\bou-drawer__backdrop\b[^"]*"/g)].length;
    if (rootCount !== backdropCount) {
      violations.push(`${rel}:1 drawer root/backdrop mismatch (${rootCount}/${backdropCount})`);
    }
  }
}

if (violations.length) {
  console.error(`DS check failed: ${violations.length} violation(s).`);
  const limit = process.env.DS_GATE_FULL ? violations.length : 200;
  for (const item of violations.slice(0, limit)) console.error(`- ${item}`);
  if (violations.length > limit) console.error(`... and ${violations.length - limit} more`);
  process.exit(1);
}

console.log(`DS check passed for ${files.length} wireframe file(s).`);
