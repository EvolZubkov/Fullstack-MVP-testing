/**
 * @module server/services/formula-render
 *
 * Рендер формулы в SVG (PRD-57 §4.2, FR-07).
 *
 * Решение владельца 2026-09-18 — вариант А, серверный пререндер: в SCORM-пакет уезжает
 * ТОЛЬКО картинка, ни библиотеки, ни шрифтов, ни таблицы стилей. Рантайм пакета при этом
 * не меняется вовсе, а паритет хостов выполняется по построению — оба показывают один и
 * тот же SVG.
 *
 * Движок — MathJax (`tex-svg`, Apache-2.0), и это выбор ФАКТА, а не вкуса: спека называла
 * основным кандидатом KaTeX, но KaTeX печатает HTML со своей таблицей стилей и своими
 * шрифтами, а не автономный SVG. Положить шрифты в каждый ZIP §4.2.1 уже отвергал.
 * MathJax отдаёт контуры букв прямо в разметке — файл самодостаточен.
 *
 * Размеры проставляются ЯВНО (FR-07): `html2canvas`, которым печатается PDF-отчёт, без
 * них рисует SVG непредсказуемо — известная слабость библиотеки.
 */
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

/**
 * Документ MathJax создаётся ОДИН раз: разбор пакетов TeX стоит десятки миллисекунд, а
 * формулы приходят пачками — по одной на каждое вхождение в каждом вопросе теста.
 */
const document = mathjax.document("", {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: "local" }),
});

/** Результат рендера одной формулы. */
export interface RenderedFormula {
  /** Готовый SVG или пустая строка, если запись не разобралась. */
  svg: string;
  /** Ширина и высота в пикселях — для явных размеров и для раскладки. */
  width: number;
  height: number;
  /** Текстовая альтернатива: исходная запись (FR-09). */
  alt: string;
  /** Текст ошибки разбора — его видит АВТОР в редакторе, но не участник (FR-10). */
  error?: string;
}

/** `1.234ex` → пиксели. Базовая высота строки MathJax — 8 пикселей на `ex`. */
const EX_IN_PX = 8;

/**
 * Отрисовать одну формулу.
 *
 * @param latex Запись в нотации LaTeX, как её набрал автор (без ограждения `$$`).
 * @param options `display` — выключная формула (своя строка), иначе строчная.
 */
export function renderFormula(latex: string, options: { display?: boolean } = {}): RenderedFormula {
  const source = typeof latex === "string" ? latex.trim() : "";
  if (source === "") {
    return { svg: "", width: 0, height: 0, alt: "", error: "Пустая запись формулы" };
  }
  try {
    const node = document.convert(source, { display: options.display === true });
    const svg = adaptor.innerHTML(node);
    // MathJax сообщает об ошибке разбора внутри самой разметки — заголовком `merror`.
    if (svg.indexOf("data-mjx-error") !== -1 || svg.indexOf("merror") !== -1) {
      return { svg: "", width: 0, height: 0, alt: source, error: "Запись формулы не разобрана" };
    }
    const width = exToPx(svg, /width="([\d.]+)ex"/);
    const height = exToPx(svg, /height="([\d.]+)ex"/);
    return { svg: withExplicitSize(svg, width, height, source), width, height, alt: source };
  } catch (error) {
    return { svg: "", width: 0, height: 0, alt: source, error: (error as Error).message };
  }
}

/** Прочитать размер из разметки MathJax и перевести в пиксели. */
function exToPx(svg: string, pattern: RegExp): number {
  const found = pattern.exec(svg);
  return found ? Math.round(Number(found[1]) * EX_IN_PX) : 0;
}

/**
 * Проставить явные размеры и альтернативу.
 *
 * Размеры в `ex` заменяются пикселями: `html2canvas` считает `ex` от шрифта страницы,
 * которого в его собственном контексте нет, и формула в PDF-отчёте выходит то крошечной,
 * то на полстраницы.
 */
function withExplicitSize(svg: string, width: number, height: number, alt: string): string {
  return svg
    .replace(/width="[\d.]+ex"/, `width="${width}"`)
    .replace(/height="[\d.]+ex"/, `height="${height}"`)
    .replace("<svg", `<svg role="img" aria-label="${alt.replace(/"/g, "&quot;")}"`);
}
