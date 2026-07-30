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

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_LAYOUTS = path.join(REPO_ROOT, "server", "scorm", "templates", "default", "layouts");
const CERT_DIR = path.join(REPO_ROOT, "templates", "certification");
const CERT_LAYOUTS = path.join(CERT_DIR, "layouts");

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
  const standardFiles = htmlIn(DEFAULT_LAYOUTS);

  it("declares every layout the standard template ships, and no others", () => {
    expect(htmlIn(CERT_LAYOUTS)).toEqual(standardFiles);
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

  it("declares only theme.css as its stylesheet", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(CERT_DIR, "manifest.json"), "utf8"));
    expect(manifest.assets.styles).toEqual(["styles/theme.css"]);
  });

  it("uses no container-query units in theme.css", () => {
    const css = fs.readFileSync(path.join(CERT_DIR, "styles", "theme.css"), "utf8");
    expect(css).not.toMatch(/\d(cqh|cqw)\b/);
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

  it("offers the same page variants — a test switches templates without rebinding pages", () => {
    const keys = (m: { contentTemplates: { key: string }[] }) => m.contentTemplates.map((t) => t.key).sort();
    expect(keys(cert)).toEqual(keys(std));
  });

  it("offers the same design params", () => {
    const keys = (m: { params: { key: string }[] }) => m.params.map((p) => p.key).sort();
    expect(keys(cert)).toEqual(keys(std));
  });

  it("resolves the same system layout keys", () => {
    expect(Object.keys(cert.layouts).sort()).toEqual(Object.keys(std.layouts).sort());
  });
});
