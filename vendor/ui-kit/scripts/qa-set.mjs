#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const registryFile = path.join(root, 'storybook-qa.json');
const storiesDir = path.join(root, 'src', 'components');
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

function usage() {
  console.error('Usage: npm run qa:set -- <Storybook title[/Story name]> --status <status> [--visual <check>] [--functional <check>] [--a11y <check>] [--notes <text>]');
  console.error('Example: npm run qa:set -- Inputs/Button/Primary --status stable');
  console.error('Component-level fallback also works: npm run qa:set -- Inputs/Button --status review');
  console.error('Legacy positional format still works: npm run qa:set -- Pickers/Calendar stable ok todo todo');
  console.error('Statuses: unvalidated, draft, review, blocked, visual-ok, functional-ok, stable');
  console.error('Checks: todo, ok, blocked, skip');
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

function getKnownTargets() {
  const targets = new Set();

  for (const file of walk(storiesDir)) {
    const source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const title = readStringProp(readMetaBlock(source), 'title');
    if (!title) continue;

    targets.add(title);
    for (const storyName of readStoryNames(source)) {
      targets.add(`${title}/${storyName}`);
    }
  }

  return [...targets].sort();
}

function readRegistry() {
  if (!fs.existsSync(registryFile)) return {};
  return JSON.parse(fs.readFileSync(registryFile, 'utf8') || '{}');
}

function writeRegistry(registry) {
  fs.writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const [rawName, inlineValue] = token.slice(2).split('=', 2);
    const name = rawName.trim();
    const value = inlineValue ?? argv[i + 1];

    if (!name || value === undefined || value.startsWith('--')) {
      console.error(`Missing value for --${name}`);
      usage();
      process.exit(1);
    }

    flags[name] = value;
    if (inlineValue === undefined) i += 1;
  }

  return {
    title: flags.title ?? positional[0],
    status: flags.status ?? positional[1],
    visual: flags.visual ?? positional[2],
    functional: flags.functional ?? positional[3],
    a11y: flags.a11y ?? positional[4],
    notes: flags.notes,
  };
}

const {
  title,
  status,
  visual: visualArg,
  functional: functionalArg,
  a11y: a11yArg,
  notes,
} = parseArgs(process.argv.slice(2));

if (!title || !status) {
  usage();
  process.exit(1);
}

if (!allowedStatuses.has(status)) {
  console.error(`Invalid QA status: ${status}`);
  usage();
  process.exit(1);
}

for (const check of [visualArg, functionalArg, a11yArg].filter(Boolean)) {
  if (!allowedChecks.has(check)) {
    console.error(`Invalid QA check: ${check}`);
    usage();
    process.exit(1);
  }
}

const targets = getKnownTargets();
if (!targets.includes(title)) {
  console.error(`Unknown Storybook QA target: ${title}`);
  console.error('');
  console.error('Known targets:');
  for (const knownTarget of targets) console.error(`- ${knownTarget}`);
  process.exit(1);
}

const registry = readRegistry();
const stableDefaults = status === 'stable';

const prefix = `${title}/`;
const childTargets = [
  ...new Set([
    ...targets.filter((t) => t.startsWith(prefix)),
    ...Object.keys(registry).filter((k) => k.startsWith(prefix)),
  ]),
].sort();

const allTargets = [title, ...childTargets];

for (const key of allTargets) {
  registry[key] = {
    ...registry[key],
    status,
    visual: visualArg ?? (stableDefaults ? 'ok' : registry[key]?.visual ?? 'todo'),
    functional: functionalArg ?? (stableDefaults ? 'ok' : registry[key]?.functional ?? 'todo'),
    a11y: a11yArg ?? (stableDefaults ? 'ok' : registry[key]?.a11y ?? 'todo'),
  };
  if (notes !== undefined) registry[key].notes = notes;
  else if (stableDefaults) delete registry[key].notes;
}

writeRegistry(registry);

for (const key of allTargets) {
  console.log(`Updated ${key}: status=${registry[key].status} visual=${registry[key].visual} functional=${registry[key].functional} a11y=${registry[key].a11y}`);
}
