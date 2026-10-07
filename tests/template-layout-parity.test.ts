/**
 * @module tests/template-layout-parity
 *
 * @description Guards external design templates against falling behind the standard
 * template's screen contract.
 *
 * Why this guard exists: the runtime binds behaviour to markup the LAYOUT owns now —
 * the nav row (`.tb-scene__foot`, from `state.nav`), the question map
 * (`.ou-quiz__dot`), the DS timers (`#timer-display` / `#section-timer-display`) and
 * the text-fit targets (`.tb-scene__body` / `.tb-scene__col` / `.tb-scene__q`). A
 * template whose layouts predate a revision therefore renders a DEAD screen while
 * every structural validator stays green. That is exactly how `certification` broke:
 * its question screen rendered with no answer options and no navigation at all, and
 * the PRD-3 validator reported 0 blocking issues throughout.
 *
 * The rule: an external template's layout is a BYTE-IDENTICAL copy of the standard
 * one, except for the deltas enumerated in INTENDED_DELTAS.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { templateLayouts, templateRoot } from "./helpers/template-roots";

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_LAYOUTS = path.join(REPO_ROOT, "server", "scorm", "templates", "default", "layouts");
// «Сертификация» вынесена в собственный репозиторий: путь к ней знает один модуль, а
// не каждый тест. Прежний путь внутри дерева продукта умер вместе с выносом, и гард
// падал на чтении манифеста — то есть не проверял ничего.
const CERT_DIR = templateRoot("certification");
const CERT_LAYOUTS = templateLayouts("certification");

/** Indentation of the eyebrow row inside the cover layouts (14 spaces). */
const EYEBROW_INDENT = " ".repeat(14);

/** The RTK brand line: a STATIC word, so it cannot be expressed through data. */
const BRANDLINE = '<span class="tb-cover__brandline">Сертификация</span>';

/** The anchor both cover layouts share. */
const EYEBROW_ANCHOR = '{{#if course.subtitle}}<span data-path="course.subtitle"></span>{{/if}}';

/**
 * Layouts the certification template intentionally diverges on, with the exact
 * substitution applied to the standard source. Anything not listed here must match
 * byte for byte.
 *
 * Adding an entry is a DESIGN decision — justify it in
 * docs/plans/PLAN_CERTIFICATION_TEMPLATE_REVISION.md. Everything else that makes
 * «Сертификация» look like itself (palette, brand font, cover brand plate, orange
 * list markers, author-background scrim) is expressed in `styles/theme.css` and
 * needs NO markup delta.
 *
 * `course.subtitle` cannot carry the brand line: the runtime puts «Попытка N из M»
 * there (`scormCourseSubtitle`).
 */
const INTENDED_DELTAS: Record<string, { find: string; replace: string }[]> = {
  "start.html": [
    { find: EYEBROW_ANCHOR, replace: `${BRANDLINE}\n${EYEBROW_INDENT}${EYEBROW_ANCHOR}` },
  ],
  "start.image-right.html": [
    { find: EYEBROW_ANCHOR, replace: `${BRANDLINE}\n${EYEBROW_INDENT}${EYEBROW_ANCHOR}` },
  ],
};

/**
 * Line endings are NOT part of the contract: the repo stores LF while a Windows
 * checkout has CRLF, so both sides are normalized before comparing.
 */
const lf = (s: string): string => s.replace(/\r\n/g, "\n");

/** Applies the intended deltas to a standard layout to get the expected cert layout. */
function expectedCertLayout(file: string, standard: string): string {
  const deltas = INTENDED_DELTAS[file] ?? [];
  return deltas.reduce((acc, d) => {
    expect(acc, `delta anchor missing in default/${file}`).toContain(d.find);
    return acc.replace(d.find, d.replace);
  }, lf(standard));
}

const htmlIn = (dir: string): string[] =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .sort();

describe("certification layouts track the standard template", () => {
  /**
   * PRD-51 §10.4: `report.html` и `report.adaptive.html` из сравнения выведены — у
   * «Сертификации» свой документ (§10.1). Под гардом остаются 17 раскладок УЧЕНИЧЕСКИХ
   * экранов: именно там он ловит расхождения контракта рантайма, ради которых заводился.
   *
   * Каталог `layouts/report/` сюда не попадает и без фильтра: `htmlIn` читает только
   * верхний уровень. Фильтр назван явно, чтобы правило было ВИДНО, а не выводилось из
   * особенности чтения каталога.
   */
  const isReportLayout = (f: string): boolean => f.startsWith("report.");
  const standardFiles = htmlIn(DEFAULT_LAYOUTS).filter((f) => !isReportLayout(f));

  it("declares every learner-screen layout the standard template ships, and no others", () => {
    expect(htmlIn(CERT_LAYOUTS).filter((f) => !isReportLayout(f))).toEqual(standardFiles);
  });

  for (const file of standardFiles) {
    it(`${file} matches the standard layout (modulo intended deltas)`, () => {
      const standard = fs.readFileSync(path.join(DEFAULT_LAYOUTS, file), "utf8");
      const cert = fs.readFileSync(path.join(CERT_LAYOUTS, file), "utf8");
      expect(lf(cert)).toBe(expectedCertLayout(file, standard));
    });
  }
});

describe("certification ships no layer of the retired fixed-stage model", () => {
  it("has no base.css", () => {
    expect(fs.existsSync(path.join(CERT_DIR, "styles", "base.css"))).toBe(false);
  });

  it("declares no base.css among its stylesheets", () => {
    // Проверяется именно отставленный слой, а не «ровно один лист»: PRD-27 добавил
    // законный второй — `styles/report.css` со страницей отчёта, скоупленной в
    // `.tb-report`. Запрет на любой второй лист поймал бы его как регрессию.
    const manifest = JSON.parse(fs.readFileSync(path.join(CERT_DIR, "manifest.json"), "utf8"));
    expect(manifest.assets.styles).toContain("styles/theme.css");
    expect(manifest.assets.styles).not.toContain("styles/base.css");
  });

  it("uses no container-query units in theme.css", () => {
    const css = fs.readFileSync(path.join(CERT_DIR, "styles", "theme.css"), "utf8");
    expect(css).not.toMatch(/\d(cqh|cqw)\b/);
  });

  /**
   * Twin of the standard template's guard (tests/template-scene-css): the start cover
   * and the info-page frame get their height from the layout, which is not a definite
   * height a percentage can resolve against. An illustration left in flow therefore
   * fell back to its natural ratio and outgrew the panel — past the field on the cover,
   * past the 4:3 frame on an info page. Both templates carry the same media rules by
   * hand, so the certification copy is guarded here too.
   */
  it("keeps the cover / content illustration out of flow so it cannot outgrow its panel", () => {
    const css = fs
      .readFileSync(path.join(CERT_DIR, "styles", "theme.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const panel of [".tb-cover__media", ".tb-content__media"]) {
      const esc = panel.replace(".", "\\.");
      expect(css, `${panel} must position its panel`).toMatch(new RegExp(`${esc}\\s*\\{[^}]*position:\\s*relative`));
      expect(css, `${panel} img must be absolute inside it`).toMatch(
        new RegExp(`${esc}\\s+img\\s*\\{[^}]*position:\\s*absolute[^}]*inset:\\s*0`),
      );
    }
  });

  it("mounts the standard shell (no mountShell wrapper)", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(CERT_DIR, "manifest.json"), "utf8"));
    expect(manifest.mountShell).toBeUndefined();
    const shell = fs.readFileSync(path.join(CERT_DIR, "shell.html"), "utf8");
    expect(shell).toContain('id="tb-progress-fill"');
    expect(shell).not.toContain("tb-frame");
  });
});

describe("certification manifest stays in parity with the standard one", () => {
  const std = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "server", "scorm", "templates", "default", "manifest.json"), "utf8"),
  );
  const cert = JSON.parse(fs.readFileSync(path.join(CERT_DIR, "manifest.json"), "utf8"));

  /**
   * PRD-51 §10.4: из-под паритета выведено ВСЁ семейство отчёта — оболочка, её поля и
   * раскладки блоков.
   *
   * Документ у шаблонов свой: эталон печатает сегодняшние секции, «Сертификация» — лист
   * по референсу (§10.1). Требовать здесь совпадения значило бы требовать, чтобы два
   * разных документа состояли из одних и тех же разделов с одними и теми же полями.
   *
   * Одних блоков мало: «Сертификации» нужно СВОЁ поле оболочки (иллюстрация титула), а
   * `settings[]` вида `report` гард сравнивает с эталоном. Объявить это поле у эталона
   * значило бы завести настройку без слота за ней — ровно тот дефект, ради которого гард
   * настроек и писался (см. комментарий про PRD-29 ниже).
   *
   * Исключение снимается по ВИДУ, а не перечнем ключей: число раскладок блоков будет
   * меняться, и перечень протух бы на первой же правке шаблона.
   */
  const REPORT_KINDS = new Set(["report", "report.adaptive", "report.block"]);
  const isReportVariant = (t: { key: string; kind?: string }): boolean =>
    REPORT_KINDS.has(String(t.kind)) || t.key.startsWith("report.");

  it("offers the same page variants — a test switches templates without rebinding pages", () => {
    const keys = (m: { contentTemplates: { key: string; kind?: string }[] }) =>
      m.contentTemplates
        .filter((t) => !isReportVariant(t))
        .map((t) => t.key)
        .sort();
    expect(keys(cert)).toEqual(keys(std));
  });

  it("offers the same design params", () => {
    // The brand font is not a choice in «Сертификация»: the typeface is embedded and the
    // «Шрифт» param is dropped, as in «Стандартный Ростелеком». Every other key must match.
    const BRAND_OWN = new Set(["fontFamily"]);
    const keys = (m: { params: { key: string }[] }) =>
      m.params.map((p) => p.key).filter((k) => !BRAND_OWN.has(k)).sort();
    expect(keys(cert)).toEqual(keys(std));
  });

  it("offers the same CHOICES inside those params, not just the same keys", () => {
    // Ключи совпадают, а список вариантов у select-параметра — нет: автор одного шаблона
    // видит вид рендера, которого во втором нет. Ключевой diff такого не показывает — ровно
    // так же, как он не показал расхождение `contentTemplates` в PRD-29 (см. ниже).
    //
    // Шрифт из сверки исключён СОЗНАТЕЛЬНО: гарнитура — часть облика шаблона, и
    // «Сертификация» возит свою фирменную («Rostelecom Basis»), которой в эталоне нет и
    // быть не должно. Всё остальное — виды рендера, схемы уровней — это контракт ядра, и
    // расходиться ему нельзя.
    const BRAND_OWN = new Set(["fontFamily"]);
    const choices = (m: { params: Array<{ key: string; type: string; options?: string[] }> }) =>
      Object.fromEntries(
        m.params
          .filter((p) => p.type === "select" && Array.isArray(p.options) && !BRAND_OWN.has(p.key))
          .map((p) => [p.key, p.options]),
      );
    expect(choices(cert)).toEqual(choices(std));
  });

  it("resolves the same system layout keys", () => {
    expect(Object.keys(cert.layouts).sort()).toEqual(Object.keys(std.layouts).sort());
  });

  // The test above only compares contentTemplates KEYS. A variant can keep its key
  // and still drift on what it actually offers the author — that is exactly how PRD-29
  // broke: three visibility settings (`scoreSummary`/`indicators`/`scales`) were absent
  // from certification's `results.standard`, and a dead `illustration` setting (no
  // layout slot behind it) was declared where the standard has none. Neither shows up
  // in a key-only diff.
  const settingKeys = (ct: { settings?: { key: string }[] }): string[] => (ct.settings ?? []).map((s) => s.key).sort();

  for (const stdCt of (std.contentTemplates as Array<{ key: string; kind?: string; settings?: { key: string }[] }>).filter(
    (t) => !isReportVariant(t),
  )) {
    it(`contentTemplates["${stdCt.key}"] offers the same settings[] keys as the standard template`, () => {
      const certCt = (cert.contentTemplates as Array<{ key: string; settings?: { key: string }[] }>).find(
        (c) => c.key === stdCt.key,
      );
      expect(certCt, `manifest.json: contentTemplates["${stdCt.key}"] is missing from certification`).toBeDefined();
      expect(
        settingKeys(certCt as { settings?: { key: string }[] }),
        `manifest.json: contentTemplates["${stdCt.key}"].settings[] keys differ from the standard template ` +
          `(either missing a setting the standard exposes, or declaring one — like a dead "illustration" — the ` +
          `standard does not)`,
      ).toEqual(settingKeys(stdCt));
    });
  }
});

describe("certification results block order stays in parity with the standard one", () => {
  const std = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "server", "scorm", "templates", "default", "manifest.json"), "utf8"),
  ).resultsBlockOrder as Record<string, string[]>;
  const cert = JSON.parse(fs.readFileSync(path.join(CERT_DIR, "manifest.json"), "utf8"))
    .resultsBlockOrder as Record<string, string[]>;

  /**
   * Screens where certification is deliberately allowed to declare a subblock order
   * that differs from the standard template's — each entry MUST carry the reason.
   * Empty today: certification tracks the standard order on every declared screen.
   */
  const ORDER_EXCEPTIONS: Record<string, string> = {};

  it("declares resultsBlockOrder for the same set of screens", () => {
    expect(
      Object.keys(cert).sort(),
      "manifest.json: resultsBlockOrder — set of screens differs from the standard template",
    ).toEqual(Object.keys(std).sort());
  });

  for (const screen of Object.keys(std)) {
    it(`resultsBlockOrder["${screen}"] matches the standard composition and order`, () => {
      if (screen in ORDER_EXCEPTIONS) return; // documented divergence, see ORDER_EXCEPTIONS above
      expect(
        cert[screen],
        `manifest.json: resultsBlockOrder["${screen}"] — subblock composition or order differs from the ` +
          `standard template (std: [${(std[screen] ?? []).join(", ")}])`,
      ).toEqual(std[screen]);
    });
  }
});

/**
 * Extracts the set of selectors a stylesheet DECLARES — what rules are scoped to, not
 * what they say. A hand-rolled brace-depth walk (no CSS parser dependency, per the
 * project's "no new dependencies" rule):
 *
 * - `@media` / `@container` / `@supports` bodies are descended into, because their
 *   nested rules declare REAL selectors (both stylesheets here use `@media` for the
 *   dark-theme override and `@container` for scene-width breakpoints).
 * - Any other at-rule (`@font-face`, `@keyframes`, …) is treated as a declaration
 *   block with nothing to collect — neither stylesheet uses one today, but an
 *   at-rule prelude like `@keyframes fade { 0% { ... } }` is not a CSS selector and
 *   must never be added to the set.
 * - A selector LIST (`.a, .b { … }`) is split on top-level commas only (commas
 *   inside `:not(...)`/`:is(...)` parens do not separate selectors).
 */
function extractDeclaredSelectors(css: string): Set<string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = new Set<string>();
  let i = 0;
  const n = text.length;

  const splitTopLevelCommas = (s: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    parts.push(cur);
    return parts;
  };

  const parseBlock = (collectHere: boolean): void => {
    let buffer = "";
    while (i < n) {
      const ch = text[i];
      if (ch === "{") {
        i++;
        const prelude = buffer.trim();
        buffer = "";
        if (prelude.startsWith("@")) {
          const atName = (prelude.match(/^@([a-zA-Z-]+)/)?.[1] ?? "").toLowerCase();
          const passthrough = atName === "media" || atName === "container" || atName === "supports";
          parseBlock(collectHere && passthrough);
        } else {
          if (collectHere && prelude) {
            for (const raw of splitTopLevelCommas(prelude)) {
              const sel = raw.trim().replace(/\s+/g, " ");
              if (sel) selectors.add(sel);
            }
          }
          parseBlock(false); // declaration body: nothing to collect inside
        }
      } else if (ch === "}") {
        i++;
        return;
      } else {
        buffer += ch;
        i++;
      }
    }
  };

  parseBlock(true);
  return selectors;
}

describe("certification CSS declares every selector the standard stylesheet does", () => {
  /**
   * Selectors the standard template declares that certification legitimately has no
   * use for, keyed by the stylesheet they live in. Empty today: every rule in
   * default's theme.css/report.css has a certification counterpart (this is exactly
   * the check that would have caught the missing `.tb-breakdown__*` / PRD-50 cut-band
   * rules and the missing `.ou-stepper--choice` PRD-26 scale-question styling — both
   * landed on certification only after this guard was written).
   *
   * Add an entry here ONLY with a comment justifying why certification cannot or
   * should not carry that selector — never to silence a real gap.
   */
  const ALLOWED_MISSING: Record<string, string[]> = {
    "styles/theme.css": [],
    "styles/report.css": [],
  };

  for (const styleFile of ["styles/theme.css", "styles/report.css"]) {
    it(`${styleFile}: every selector default declares exists in certification's copy too`, () => {
      const stdCss = fs.readFileSync(
        path.join(REPO_ROOT, "server", "scorm", "templates", "default", styleFile),
        "utf8",
      );
      const certCss = fs.readFileSync(path.join(CERT_DIR, styleFile), "utf8");
      const stdSelectors = extractDeclaredSelectors(stdCss);
      const certSelectors = extractDeclaredSelectors(certCss);
      const allowedMissing = new Set(ALLOWED_MISSING[styleFile] ?? []);
      const missing = [...stdSelectors].filter((s) => !certSelectors.has(s) && !allowedMissing.has(s));
      expect(
        missing,
        `certification/${styleFile} is missing selector(s) declared in default/${styleFile}: ${missing.join(", ")}`,
      ).toEqual([]);
    });
  }
});

describe("certification demo dataset stays structurally in parity with the standard one", () => {
  // Content (titles, texts, topic/page counts) is deliberately NOT compared here: the
  // demo course is a showcase, not a contract. Only the KEY STRUCTURE the preview
  // bridge actually reads (`shared/template/preview-context.ts`, `PreviewDemoDataset`)
  // has to line up — this is exactly the check that would have caught certification's
  // demo dataset shipping without a `runtime.measures` block at all.
  const std = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "server", "scorm", "templates", "default", "demo", "course.json"), "utf8"),
  );
  const cert = JSON.parse(fs.readFileSync(path.join(CERT_DIR, "demo", "course.json"), "utf8"));

  const keysOf = (o: unknown): string[] =>
    o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o as object).sort() : [];

  it("declares the same top-level keys", () => {
    expect(
      keysOf(cert),
      "demo/course.json: top-level key set differs from the standard template's demo dataset",
    ).toEqual(keysOf(std));
  });

  it("declares the same runtime.measures fields", () => {
    expect(
      keysOf((cert as { runtime?: { measures?: unknown } }).runtime?.measures),
      "demo/course.json: runtime.measures — field set differs from the standard template's demo dataset",
    ).toEqual(keysOf((std as { runtime?: { measures?: unknown } }).runtime?.measures));
  });

  // `ramp` and `chartSettings` are fixed-shape structural subfields of measures — as
  // opposed to `scales`/`indicators`, which are id-keyed demo DATA (their count and
  // labels are a showcase choice, not a contract, so they are deliberately excluded).
  for (const field of ["ramp", "chartSettings"]) {
    it(`declares the same runtime.measures.${field} fields`, () => {
      const get = (o: unknown): unknown => (o as { runtime?: { measures?: Record<string, unknown> } })?.runtime
        ?.measures?.[field];
      expect(
        keysOf(get(cert)),
        `demo/course.json: runtime.measures.${field} — field set differs from the standard template's demo dataset`,
      ).toEqual(keysOf(get(std)));
    });
  }
});

describe("PRD-51 §10.4: из-под паритета выведено ВСЁ семейство отчёта", () => {
  const cert = JSON.parse(fs.readFileSync(path.join(CERT_DIR, "manifest.json"), "utf8"));

  it("гард стережёт РОВНО 17 раскладок ученических экранов", () => {
    // Девятнадцать минус две раскладки отчёта. Число названо явно: молчаливое сокращение
    // списка — это и есть та регрессия, ради которой гард заведён.
    expect(htmlIn(DEFAULT_LAYOUTS).filter((f) => !f.startsWith("report."))).toHaveLength(17);
  });

  it("«Сертификация» вправе объявить своё поле оболочки отчёта", () => {
    const shell = cert.contentTemplates.find((t: { key: string }) => t.key === "report.standard");
    expect(shell.settings.map((s: { key: string }) => s.key)).toContain("coverImage");
  });
});
