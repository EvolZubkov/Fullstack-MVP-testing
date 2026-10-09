#!/usr/bin/env node
/**
 * @module scripts/check/check-editor-conformance
 * @description Guard: the test-editor drawer must match the approved wireframe — both its
 * spacing contract and its structure.
 *
 * Why this exists. The 2026-09-03 acceptance of the editor restructure checked the plan's
 * checklist — "seven tabs, rails in the right order" — and not the drawing, and 219
 * divergences shipped with it. Six spacing overrides had never been ported, two whole form
 * sections existed only in code comments, and nobody could see any of it because nobody was
 * measuring. This guard re-derives the contract from the wireframe on every run and measures
 * the live drawer against it.
 *
 * Two passes, and they fail for different reasons:
 *
 *   1. Spacing — every override the wireframe states in its own `<style>` block, measured as
 *      computed style. Any divergence fails the run outright: the contract is unambiguous.
 *   2. Structure — headings, labels, hints, controls, buttons, table columns and their order,
 *      compared state by state through `map.json`. Here a BASELINE of known divergences is
 *      tolerated (the drawer starts with two hundred), and only new ones fail. Entries that
 *      stop occurring are reported as progress so they can be struck from the registry.
 *
 * What it does NOT cover, deliberately: modal dialogs and states that need interaction —
 * unsaved draft, blocking validation, the changes popover, close and conflict dialogs. Those
 * are checked by hand against the acceptance report. Pretending otherwise would be worse than
 * the gap; see the comment block in `map.json`.
 *
 * Usage: `npm run check:editor-ui`, with `npm run dev` already running.
 *   EDITOR_UI_BASE            — dev origin, default http://localhost:8081
 *   EDITOR_UI_TEST_ID         — test whose drawer is measured when a state names none
 *   EDITOR_UI_PORT            — CDP port, default 9222
 *   EDITOR_UI_WRITE_BASELINE  — 1 to record the current divergences as the new baseline
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, sessionCookie, splitCookie } from "./editor-conformance/cdp.mjs";
import { readExpectations } from "./editor-conformance/expectations.mjs";
import { EXTRACT } from "./editor-conformance/inventory.mjs";
import { applyBaseline, diffInventories } from "./editor-conformance/diff.mjs";
import { startStaticServer } from "./editor-conformance/static-server.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HERE = join(REPO_ROOT, "scripts", "check", "editor-conformance");
const WIREFRAME = join(REPO_ROOT, "docs", "wireframes", "editor-settings-target.html");
const WIREFRAME_URL_PATH = "/docs/wireframes/editor-settings-target.html";
const BASELINE_PATH = join(HERE, "baseline.json");

const DEV = process.env.EDITOR_UI_BASE ?? "http://localhost:8081";
const DEFAULT_TEST_ID = process.env.EDITOR_UI_TEST_ID ?? "6e10d1e6-0fc9-4e5a-a498-41662c663633";
const CDP_PORT = Number(process.env.EDITOR_UI_PORT ?? 9222);
const WRITE_BASELINE = process.env.EDITOR_UI_WRITE_BASELINE === "1";
const VERBOSE = process.env.EDITOR_UI_VERBOSE === "1" || WRITE_BASELINE;

/** Tab captions to their stable DOM ids. Ordinals would move with the first reordering. */
const TAB_IDS = {
  "Основное": "tab-main",
  "Состав и сценарий": "tab-composition",
  "Правила прохождения": "tab-rules",
  "Оценка результата": "tab-scoring",
  "Обратная связь и итоги": "tab-feedback",
  "Оформление": "tab-design",
  "Комментарии": "tab-review",
};

const map = JSON.parse(readFileSync(join(HERE, "map.json"), "utf8"));
const states = Object.entries(map).filter(([key]) => !key.startsWith("_"));
const baseline = !WRITE_BASELINE && existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : [];

/** Measures every spacing expectation against whatever the page currently shows. */
const measureSource = (rows) => `() => {
  const rows = ${JSON.stringify(rows)};
  const out = {};
  for (const r of rows) {
    const el = [...document.querySelectorAll(r.selector)].find((e) => e.closest(".ou-drawer"));
    if (!el) continue;
    const cs = getComputedStyle(el);
    out[r.selector + "|" + r.property] = cs[r.property === "padding-inline" ? "paddingLeft" : r.property];
  }
  return out;
}`;

/** Activates one wireframe state. The switcher reacts to a click; it does not read the hash. */
const showStateSource = (state) => `() => {
  const btn = [...document.querySelectorAll(".wf-nav button")]
    .find((b) => (b.getAttribute("onclick") || "").includes("'${state}'"));
  if (!btn) return false;
  btn.click();
  return true;
}`;

const { expectations, contradictions } = readExpectations(WIREFRAME);
if (!expectations.length) {
  console.error("Из эскиза не вычитано ни одной перебивки — сверять нечего. Проверьте блок <style>.");
  process.exit(1);
}

const server = await startStaticServer(0);
let browser;
const measured = new Map();
const wireframeInventories = new Map();
const structural = [];

try {
  browser = await launch({ port: CDP_PORT });

  // ── Проход первый: описи эскиза ───────────────────────────────────────────
  await browser.goto(`http://127.0.0.1:${server.port}${WIREFRAME_URL_PATH}`, 2000);
  for (const [state] of states) {
    if (!(await browser.evaluate(showStateSource(state)))) {
      throw new Error(`В эскизе нет состояния «${state}» — map.json разошёлся с эскизом.`);
    }
    await new Promise((wait) => setTimeout(wait, 350));
    wireframeInventories.set(state, (await browser.evaluate(EXTRACT)) ?? []);
    if (VERBOSE) console.error(`  эскиз: ${state} — элементов ${wireframeInventories.get(state).length}`);
  }

  // ── Проход второй: живой ящик ─────────────────────────────────────────────
  const { name, value } = splitCookie(await sessionCookie(DEV));
  await browser.send("Network.setCookie", { name, value, domain: new URL(DEV).hostname, path: "/" });

  // Состояния сгруппированы по тесту: открывать ящик заново на каждое из них — минуты
  // впустую, а данные теста меняют только те состояния, что их прямо требуют.
  const byTest = new Map();
  for (const [state, target] of states) {
    const testId = target.testId ?? DEFAULT_TEST_ID;
    if (!byTest.has(testId)) byTest.set(testId, []);
    byTest.get(testId).push([state, target]);
  }

  for (const [testId, group] of byTest) {
    if (VERBOSE) console.error(`тест ${testId}: состояний ${group.length}`);
    await browser.goto(`${DEV}/author/tests`, 4500);
    await browser.clickSelector(`[data-testid="test-edit-${testId}"]`, 3500);
    const opened = await browser.evaluate('() => document.querySelectorAll(".ou-drawer").length === 1');
    if (!opened) throw new Error(`Ящик редактора не открылся на тесте ${testId}.`);

    for (const [state, target] of group) {
      const tabId = TAB_IDS[target.tab];
      if (!tabId) throw new Error(`В map.json состояние «${state}» ссылается на неизвестную вкладку «${target.tab}».`);
      await browser.clickSelector(`#${tabId}`, 1200);

      if (target.rail) {
        const chosen = await browser.evaluate(`() => {
          const item = [...document.querySelectorAll(".ou-drawer__rail-item")]
            .find((el) => el.textContent.trim() === ${JSON.stringify(target.rail)});
          if (!item) return false;
          item.click();
          return true;
        }`);
        if (!chosen) throw new Error(`На вкладке «${target.tab}» нет раздела «${target.rail}» (состояние «${state}»).`);
        await new Promise((wait) => setTimeout(wait, 900));
      }

      for (const [key, actual] of Object.entries(await browser.evaluate(measureSource(expectations)))) {
        if (!measured.has(key)) measured.set(key, actual);
      }

      const impl = (await browser.evaluate(EXTRACT)) ?? [];
      if (VERBOSE) console.error(`  ящик: ${state} — элементов ${impl.length}`);
      for (const item of diffInventories(wireframeInventories.get(state) ?? [], impl)) {
        structural.push({ ...item, state });
      }
    }
  }
} finally {
  if (browser) await browser.close();
  await server.close();
}

// ── Отчёт ───────────────────────────────────────────────────────────────────
const spacingFailures = expectations
  .map((row) => ({ ...row, actual: measured.get(`${row.selector}|${row.property}`) }))
  .filter((row) => row.actual !== undefined && row.actual !== row.expected);
const notSeen = expectations.filter((r) => !measured.has(`${r.selector}|${r.property}`));

if (WRITE_BASELINE) {
  // Пометки `finding` переносятся на совпавшие записи. Без этого каждая перезапись
  // стирала объяснения — «почему эта запись принята», — и накопленные решения
  // («разница данных», «долг пришёл из main», «эскиз ещё не знает решения») исчезали
  // молча, оставляя линию из безымянных строк. Совпадение ищется один-к-одному: две
  // одинаковые записи не должны обе забрать одну и ту же пометку.
  const previous = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
    : [];
  const keyOfRow = (r) => JSON.stringify([r.op, r.role, r.text, r.state]);
  const labels = new Map();
  for (const row of previous) {
    if (!row.finding) continue;
    const key = keyOfRow(row);
    labels.set(key, [...(labels.get(key) ?? []), row.finding]);
  }
  let carried = 0;
  const rows = structural.map((item) => {
    const queue = labels.get(keyOfRow(item));
    const finding = queue?.length ? queue.shift() : null;
    if (finding) carried += 1;
    return { ...item, finding };
  });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  console.log(`Базовая линия записана: структурных расхождений ${rows.length} -> ${BASELINE_PATH}`);
  console.log(`Перенесено пометок с прежней линии: ${carried}.`);
  console.log("Проставьте новым записям поле finding — идентификатор из реестра находок.");
  process.exit(0);
}

if (contradictions.length) {
  console.warn(`Эскиз противоречит сам себе, эти правила исключены из контракта: ${contradictions.length}`);
  for (const c of contradictions) {
    console.warn(`  ${c.selector} { ${c.property} }: токен даёт ${c.token}px, комментарий обещает ${c.stated}px`);
  }
}
if (notSeen.length) {
  console.warn(`Не встретились на экране, не проверено: ${notSeen.map((r) => r.selector).join(", ")}`);
}

const { unexpected, stale } = applyBaseline(structural, baseline);
if (stale.length) {
  console.log(`Прогресс: перестали воспроизводиться ${stale.length} — ${stale.map((s) => s.finding ?? "без id").join(", ")}`);
  console.log("Вычистите их из baseline.json и переведите находки в status «fixed».");
}

if (spacingFailures.length || unexpected.length) {
  if (spacingFailures.length) {
    console.error(`Отступы разошлись с эскизом: ${spacingFailures.length} из ${expectations.length}`);
    for (const f of spacingFailures) {
      console.error(`  ${f.selector} { ${f.property} } = ${f.actual}, эскиз требует ${f.expected}`);
    }
  }
  if (unexpected.length) {
    console.error(`Структура разошлась с эскизом вне базовой линии: ${unexpected.length}`);
    for (const u of unexpected) {
      console.error(`  [${u.state}] ${u.op}: ${u.role} «${u.text}»`);
    }
  }
  console.error("");
  console.error(
    "Эталон — docs/wireframes/editor-settings-target.html. Правьте реализацию, а не эскиз, " +
      "и не ослабляйте проверку: базовая линия нужна для СТАРОГО долга, а не для нового.",
  );
  process.exit(1);
}

console.log(
  `OK: отступов ${expectations.length - notSeen.length} из ${expectations.length}, ` +
    `структура — состояний ${states.length}, известных расхождений ${baseline.length}, новых 0.`,
);
