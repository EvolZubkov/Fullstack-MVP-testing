#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const storiesDir = path.join(root, 'src', 'components');
const registryFile = path.join(root, 'storybook-qa.json');
const allowedStatuses = new Set([
  'unvalidated',
  'draft',
  'review',
  'blocked',
  'visual-ok',
  'functional-ok',
  'stable',
]);
const allowedChecks = new Set(['todo', 'ok', 'blocked', 'skip']);
const strict = process.argv.includes('--strict');
const json = process.argv.includes('--json');

function readRegistry() {
  if (!fs.existsSync(registryFile)) return {};
  return JSON.parse(fs.readFileSync(registryFile, 'utf8') || '{}');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.stories\.(t|j)sx?$/.test(entry.name) ? [full] : [];
  });
}

function readStringProp(source, prop) {
  const re = new RegExp(`${prop}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`);
  return source.match(re)?.[1];
}

function readQaBlock(source) {
  const match = source.match(/qa\s*:\s*\{([\s\S]*?)\n\s*\}/);
  return match?.[1] ?? '';
}

function readMetaBlock(source) {
  const match = source.match(/const\s+meta(?:\s*:\s*[^=]+)?\s*=\s*\{([\s\S]*?)\n\};/);
  return match?.[1] ?? source;
}

function exportToStoryName(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function readStoryNames(source) {
  return [...source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*:/g)]
    .map((match) => exportToStoryName(match[1]));
}

function readEntry(title, storyName, qaBlock, registry) {
  const storyKey = `${title}/${storyName}`;
  const registryQa = registry[storyKey] ?? registry[title] ?? {};
  const status = registryQa.status ?? readStringProp(qaBlock, 'status') ?? 'unvalidated';
  const stableDefaults = status === 'stable';
  const visual = registryQa.visual ?? readStringProp(qaBlock, 'visual') ?? (stableDefaults ? 'ok' : 'todo');
  const functional = registryQa.functional ?? readStringProp(qaBlock, 'functional') ?? (stableDefaults ? 'ok' : 'todo');
  const a11y = registryQa.a11y ?? readStringProp(qaBlock, 'a11y') ?? (stableDefaults ? 'ok' : 'todo');
  const source = registry[storyKey] ? 'registry:story'
    : registry[title] ? 'registry:component'
      : qaBlock.length > 0 ? 'parameters' : 'missing qa';

  return { storyKey, status, visual, functional, a11y, source };
}

function analyze(file, registry) {
  const source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const metaBlock = readMetaBlock(source);
  const qaBlock = readQaBlock(source);
  const title = readStringProp(metaBlock, 'title') ?? path.basename(file);
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  const storyNames = readStoryNames(source);

  return storyNames.map((storyName) => {
    const entry = readEntry(title, storyName, qaBlock, registry);
    return {
      title,
      story: storyName,
      target: entry.storyKey,
      file: relative,
      status: entry.status,
      visual: entry.visual,
      functional: entry.functional,
      a11y: entry.a11y,
      source: entry.source,
      validStatus: allowedStatuses.has(entry.status),
      validChecks: [entry.visual, entry.functional, entry.a11y].every((check) => allowedChecks.has(check)),
      ready: entry.status === 'stable' && entry.visual === 'ok' && entry.functional === 'ok' && entry.a11y === 'ok',
    };
  });
}

const registry = readRegistry();
const rows = walk(storiesDir).sort().flatMap((file) => analyze(file, registry));
const remaining = rows.filter((row) => !row.ready);
const invalid = rows.filter((row) => !row.validStatus || !row.validChecks);
const byStatus = rows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] ?? 0) + 1;
  return acc;
}, {});

const result = {
  total: rows.length,
  ready: rows.length - remaining.length,
  remaining: remaining.length,
  byStatus,
  invalid,
  remainingItems: remaining,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('Storybook QA status report');
  console.log(`Total: ${result.total}`);
  console.log(`Ready: ${result.ready}`);
  console.log(`Remaining: ${result.remaining}`);
  console.log('');
  console.log('By status:');
  for (const [status, count] of Object.entries(byStatus).sort()) {
    console.log(`- ${status}: ${count}`);
  }

  if (invalid.length > 0) {
    console.log('');
    console.log('Invalid QA metadata:');
    for (const row of invalid) {
      console.log(`- ${row.target} (${row.file}) status=${row.status} visual=${row.visual} functional=${row.functional} a11y=${row.a11y}`);
    }
  }

  if (remaining.length > 0) {
    console.log('');
    console.log('Remaining validation work:');
    for (const row of remaining) {
      console.log(`- ${row.target} (${row.file}) status=${row.status} visual=${row.visual} functional=${row.functional} a11y=${row.a11y} [${row.source}]`);
    }
  }
}

if (strict && (remaining.length > 0 || invalid.length > 0)) {
  process.exitCode = 1;
}
