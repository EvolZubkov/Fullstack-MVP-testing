/**
 * @module tests/template-parity-standard-rt
 *
 * «Стандартный Ростелеком» — это «Стандартный» плюс брендирование, и ничего больше.
 *
 * Шаблон живёт в ОТДЕЛЬНОМ репозитории только потому, что несёт фирменную гарнитуру и
 * логотипы, которые нельзя положить в поставку продукта. Всё остальное в нём обязано
 * совпадать с `default` ЗНАК В ЗНАК: иначе правка встроенного шаблона молча не доезжает
 * до брендированного, и участник видит разное в зависимости от того, каким шаблоном
 * собран тест. Так уже случилось — стили формулы PRD-57 доехали до обоих вынесенных
 * шаблонов и не доехали до `default`, и заметить это было нечем.
 *
 * Поэтому проверка называет РОВНО ТО, что «Ростелекому» позволено добавить:
 *   - в макете — запасной логотип `{{#unless design.logoUrl}}…{{/unless}}`;
 *   - в теме — гарнитуру (`@font-face`, токен семейства) и правила фирменного лока;
 *   - в манифесте — собственную личность и свои параметры.
 * Всё прочее расхождение — дефект, в какую бы сторону оно ни смотрело.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { templateFile, templateRoot } from "./helpers/template-roots";

const DEFAULT_ID = "default" as const;
const RT_ID = "standard-rt" as const;

/** Перевод строк не различие: файлы приходят из двух репозиториев с разной настройкой. */
const lf = (s: string) => s.replace(/\r\n/g, "\n");

/**
 * Единственная надбавка, которую «Ростелеком» делает в макетах: запасной логотип,
 * показываемый, когда у теста нет своего. Снимаем её — дальше файлы обязаны совпасть.
 */
const stripBrandLogo = (s: string) =>
  s.replace(/\{\{#unless design\.logoUrl\}\}[\s\S]*?\{\{\/unless\}\}/g, "");

/** Относительные пути всех файлов каталога. */
function filesUnder(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? filesUnder(full, base)
      : [path.relative(base, full).split(path.sep).join("/")];
  });
}

/**
 * CSS, разобранный на блоки верхнего уровня: «селектор → тела правил».
 *
 * Разбор наивный (скобочный счётчик, комментарии выброшены) и таким и задуман: цель —
 * сравнить ДВА файла одного происхождения, а не разобрать произвольный CSS. Тела
 * нормализуются по пробелам, потому что различие в отступах различием не является.
 */
function cssBlocks(file: string): Map<string, string[]> {
  const text = lf(fs.readFileSync(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, string[]>();
  let depth = 0;
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const cut = buf.indexOf("{");
        const selector = buf.slice(0, cut).split(/\s+/).filter(Boolean).join(" ");
        const body = buf.slice(cut + 1).replace(/}\s*$/, "").split(/\s+/).filter(Boolean).join(" ");
        out.set(selector, [...(out.get(selector) ?? []), body]);
        buf = "";
      }
    }
  }
  return out;
}

/** Селектор, существование которого оправдано брендированием. */
const isBrandSelector = (selector: string) =>
  selector.startsWith("@font-face") ||
  selector.includes("--brand") ||
  selector.includes("[data-brand-logo") ||
  selector === ".ou, :root";

describe("паритет «Стандартный Ростелеком» ↔ «Стандартный»", () => {
  it("несёт ровно те же макеты", () => {
    expect(filesUnder(path.join(templateRoot(RT_ID), "layouts")).sort()).toEqual(
      filesUnder(path.join(templateRoot(DEFAULT_ID), "layouts")).sort(),
    );
  });

  it.each(filesUnder(path.join(templateRoot(DEFAULT_ID), "layouts")).sort())(
    "макет %s совпадает знак в знак, кроме запасного логотипа",
    (relative) => {
      const base = lf(fs.readFileSync(templateFile(DEFAULT_ID, `layouts/${relative}`), "utf8"));
      const rt = lf(fs.readFileSync(templateFile(RT_ID, `layouts/${relative}`), "utf8"));
      expect(stripBrandLogo(rt)).toBe(stripBrandLogo(base));
    },
  );

  it("несёт те же стили документа отчёта, кроме фирменной гарнитуры", () => {
    // Веб отдаёт отчёту ТОЛЬКО report.css, поэтому гарнитура вшита и сюда: её
    // `@font-face` с пояснением и запасное семейство в `var(--font-sans, …)` — брендирование.
    const unbrand = (css: string) =>
      lf(css)
        .replace(/\/\* BRAND FONT, EMBEDDED\.[\s\S]*?\*\/\n/, "")
        .replace(/@font-face\s*\{[^}]*\}\n*/g, "")
        .replace(/var\(--font-sans, [^)]+\)/g, "var(--font-sans)");
    expect(unbrand(fs.readFileSync(templateFile(RT_ID, "styles/report.css"), "utf8"))).toBe(
      unbrand(fs.readFileSync(templateFile(DEFAULT_ID, "styles/report.css"), "utf8")),
    );
  });

  describe("тема", () => {
    const base = cssBlocks(templateFile(DEFAULT_ID, "styles/theme.css"));
    const rt = cssBlocks(templateFile(RT_ID, "styles/theme.css"));

    // Две стороны одного правила, и нужны обе: расхождение приходит то с одной, то с
    // другой. Стили формулы PRD-57 отстали у ВСТРОЕННОГО шаблона, и поймал бы их второй
    // случай — со стороны РТК они выглядят как «лишнее».
    it("не теряет ни одного правила встроенного шаблона", () => {
      expect([...base.keys()].filter((s) => !rt.has(s))).toEqual([]);
    });

    it("не приносит ничего, кроме брендирования", () => {
      expect([...rt.keys()].filter((s) => !base.has(s) && !isBrandSelector(s))).toEqual([]);
    });

    it("не переписывает тела общих правил, кроме токена гарнитуры", () => {
      const changed = [...base.keys()]
        .filter((s) => rt.has(s) && JSON.stringify(rt.get(s)) !== JSON.stringify(base.get(s)))
        // `:root` несёт `--font-sans`: фирменная гарнитура — это и есть брендирование.
        .filter((s) => s !== ":root");
      expect(changed).toEqual([]);
    });
  });

  it("объявляет то же самое, отличаясь только личностью и своими параметрами", () => {
    const read = (id: typeof DEFAULT_ID | typeof RT_ID) =>
      JSON.parse(fs.readFileSync(templateFile(id, "manifest.json"), "utf8")) as Record<string, unknown>;
    // Личность шаблона, его версия, его картинки и его параметры — своё у каждого.
    const OWN = new Set(["id", "name", "description", "version", "assets", "params"]);
    const strip = (m: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(m).filter(([k]) => !OWN.has(k)));
    expect(Object.keys(read(RT_ID)).sort()).toEqual(Object.keys(read(DEFAULT_ID)).sort());
    expect(strip(read(RT_ID))).toEqual(strip(read(DEFAULT_ID)));
  });
});
