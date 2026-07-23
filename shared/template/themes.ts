/**
 * @module shared/template/themes
 *
 * The SINGLE registry of THEMES a design template may declare (PRD-23).
 *
 * A template ships one palette per theme in its stylesheet: the base one on
 * `:root` and, optionally, a dark one behind `prefers-color-scheme: dark` plus an
 * explicit `:root[data-theme="dark"]` override. Until PRD-23 the platform knew
 * nothing about that split — the author of a test could neither pin how the test
 * looks nor set a colour per palette, and a single override value silently
 * repainted BOTH palettes (white background over the template's near-white dark
 * text).
 *
 * `themes[]` in the manifest is what makes the split visible to the platform. The
 * list is closed, exactly like the PRD-22 field-type registry: an id outside it is
 * a template error, not a silently ignored entry. Consumers derive behaviour here:
 *   - the manifest validator checks the declaration at upload AND at activation;
 *   - the editor decides whether to show the theme switch and the per-theme colour
 *     table;
 *   - the renderer picks the `data-theme` value and prints overrides per theme.
 *
 * Framework-free and browser-safe: bundled verbatim into the SCORM package.
 */
import { extractThemeTokens } from "./theme-tokens";

/** Themes a template may declare. Closed: extending the platform is a change HERE. */
export const THEME_IDS = ["light", "dark"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/**
 * What a TEST stores: a pinned theme, or `auto` — follow the viewer's system
 * setting. Absence of a stored value reads as `auto`, which is what templates with
 * a `prefers-color-scheme` block already did before PRD-23.
 */
export const TEST_THEMES = ["light", "dark", "auto"] as const;

export type TestTheme = (typeof TEST_THEMES)[number];

/** One theme as the manifest declares it. */
export interface TemplateThemeDef {
  id: ThemeId;
  /** Column header in the colour table and label of the switch item. */
  label: string;
}

/** Minimal manifest shape this module reads. */
interface ThemeCarryingManifest {
  themes?: unknown;
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).indexOf(value) !== -1;
}

export function isTestTheme(value: unknown): value is TestTheme {
  return typeof value === "string" && (TEST_THEMES as readonly string[]).indexOf(value) !== -1;
}

/**
 * Normalises a stored theme choice. Anything unknown or absent becomes `auto`
 * rather than throwing: a test saved by a newer build must stay openable.
 */
export function readTestTheme(value: unknown): TestTheme {
  return isTestTheme(value) ? value : "auto";
}

/**
 * Themes the manifest declares, in declaration order, keeping only well-formed
 * entries. Malformed ones are dropped here and REPORTED by
 * {@link validateManifestThemes} — reading and diagnosing are separate jobs.
 */
export function declaredThemes(manifest: unknown): TemplateThemeDef[] {
  const raw = (manifest as ThemeCarryingManifest | null | undefined)?.themes;
  if (!Array.isArray(raw)) return [];
  const out: TemplateThemeDef[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const def = (entry ?? {}) as { id?: unknown; label?: unknown };
    if (!isThemeId(def.id) || seen.has(def.id)) continue;
    if (typeof def.label !== "string" || def.label.length === 0) continue;
    seen.add(def.id);
    out.push({ id: def.id, label: def.label });
  }
  return out;
}

/**
 * True when the template offers the author a CHOICE of palettes. One declared
 * theme is not a choice: the switch would have a single item and the colour table
 * a single column, which is what the flat list already does.
 */
export function supportsThemes(manifest: unknown): boolean {
  return declaredThemes(manifest).length >= 2;
}

/** One problem found in a `themes[]` declaration. */
export interface ThemeIssue {
  /** Declared id, or `#N` when the entry has no usable one. */
  theme: string;
  message: string;
  /** `blocking` refuses upload and activation; `warning` is advisory. */
  level: "blocking" | "warning";
}

/**
 * Validates a manifest's `themes[]`, optionally against the template's own
 * stylesheet.
 *
 * Without `css` only the declaration itself is checked — that is the activation
 * gate, which sees the stored manifest and no package files. With `css` the
 * declaration is additionally reconciled with reality: a theme nobody backs with
 * tokens would give the author a colour column that paints nothing.
 *
 * @param manifest Parsed manifest (any shape; only `themes` is read).
 * @param css      Concatenated template stylesheet, when available.
 */
export function validateManifestThemes(manifest: unknown, css?: string): ThemeIssue[] {
  const raw = (manifest as ThemeCarryingManifest | null | undefined)?.themes;
  const tokens = typeof css === "string" && css.length > 0 ? extractThemeTokens(css) : null;

  if (raw === undefined || raw === null) {
    // Not declaring themes is legal — but shipping a second palette and NOT
    // declaring it means the author cannot reach it, which is worth saying.
    if (tokens && Object.keys(tokens.dark).length > 0) {
      return [
        {
          theme: "dark",
          level: "warning",
          message:
            "шаблон поставляет тёмную палитру, но не объявляет themes[] — автор не сможет " +
            "выбрать вид теста и задать цвета для второй палитры",
        },
      ];
    }
    return [];
  }

  if (!Array.isArray(raw)) {
    return [{ theme: "", level: "blocking", message: "themes должен быть массивом" }];
  }

  const issues: ThemeIssue[] = [];
  const seen = new Set<string>();
  let wellFormed = 0;

  raw.forEach((entry, index) => {
    const def = (entry ?? {}) as { id?: unknown; label?: unknown };
    const label = isThemeId(def.id) ? def.id : `#${index + 1}`;

    if (!isThemeId(def.id)) {
      issues.push({
        theme: label,
        level: "blocking",
        message: `неизвестная тема "${String(def.id)}"; допустимы: ${THEME_IDS.join(", ")}`,
      });
      return;
    }
    if (seen.has(def.id)) {
      issues.push({ theme: label, level: "blocking", message: "тема объявлена дважды" });
      return;
    }
    seen.add(def.id);

    if (typeof def.label !== "string" || def.label.length === 0) {
      issues.push({
        theme: label,
        level: "blocking",
        message: "не задан label — нечем подписать колонку цветов и пункт переключателя",
      });
      return;
    }
    if (tokens && Object.keys(tokens[def.id]).length === 0) {
      issues.push({
        theme: label,
        level: "blocking",
        message: "объявлена, но в стилях шаблона нет ни одного её токена",
      });
      return;
    }
    wellFormed++;
  });

  // Only when nothing else is wrong: a template that declared two themes and got
  // one of them rejected does not also need to be told it has one left.
  if (wellFormed === 1 && issues.length === 0) {
    issues.push({
      theme: "",
      level: "warning",
      message:
        "объявлена одна тема — платформа считает, что шаблон тем не поддерживает; " +
        "для выбора вида теста нужны обе",
    });
  }

  return issues;
}
