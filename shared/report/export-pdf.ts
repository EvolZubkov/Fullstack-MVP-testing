/**
 * @module shared/report/export-pdf
 *
 * Turns a report page ({@link module:shared/report/report-html}) into a downloaded PDF —
 * the SAME routine on both hosts, so a learner gets the same file whether the test ran
 * as a SCORM package in the LMS or on the web.
 *
 * The two libraries are INJECTED rather than imported: the package ships them vendored
 * (`vendor/html2canvas.min.js` + `vendor/jspdf.umd.min.js`, loaded as globals because a
 * package must work offline inside an LMS), and the web host loads those same vendored
 * builds on demand. Injecting them keeps ONE pipeline over one library version instead
 * of a per-host copy.
 *
 * Browser-only (it needs a live DOM to rasterize), like `shared/template/dnd`.
 */

import { reportFileName } from "./report-html";
import { renderScreenInto } from "../template/render-screen";
import { buildReportSheets, PAGE_HEIGHT_PX, PAGE_WIDTH_PX } from "./paginate-dom";

/** Minimal surface this module uses from jsPDF. */
export interface JsPdfLike {
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): unknown;
  /** Начать следующий лист. Зовётся только у многостраничного отчёта. */
  addPage?(): unknown;
  link(x: number, y: number, w: number, h: number, options: { url: string; newWindow?: boolean }): unknown;
  save(fileName: string): unknown;
}

/** The libraries + page the export needs, injected by the host. */
export interface ExportDeps {
  /** jsPDF constructor (`window.jspdf.jsPDF` / the npm default export). */
  jsPDF: new (opts: { orientation: string; unit: string; format: [number, number] }) => JsPdfLike;
  /** html2canvas entry point. */
  html2canvas: (el: Element, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  /** Document to build the off-screen container in (defaults to the ambient one). */
  document?: Document;
}

/** A4 width in millimetres — the PDF page width the image is scaled to. */
const A4_WIDTH_MM = 210;
/** A4 height in millimetres. Every page of the report is exactly this tall. */
const A4_HEIGHT_MM = 297;
// Размеры страницы отчёта в CSS-пикселях приходят из `paginate-dom`: там же живёт
// раскладка, и второй набор констант рано или поздно разошёлся бы с ней.

/** A clickable region carried over from a `.pdf-link-btn` chip. */
interface LinkBox {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Кликабельные области страницы: чипы рекомендаций, снятые с ОТРИСОВАННОГО листа.
 *
 * Растр сам по себе делает из чипа мёртвую картинку, поэтому каждый адрес возвращается в
 * PDF настоящей ссылкой. Координаты отсчитываются от верха ЭТОГО листа: на второй странице
 * они иначе указали бы в начало документа.
 *
 * @param pageRoot Корень листа (страница целиком либо её клон).
 */
function collectLinks(pageRoot: Element): LinkBox[] {
  const pageRect = pageRoot.getBoundingClientRect();
  const links: LinkBox[] = [];
  pageRoot.querySelectorAll(".pdf-link-btn").forEach((chip) => {
    const url = chip.getAttribute("data-url");
    if (!url) return;
    const rect = chip.getBoundingClientRect();
    links.push({
      url,
      x: rect.left - pageRect.left,
      y: rect.top - pageRect.top,
      width: rect.width,
      height: rect.height,
    });
  });
  return links;
}

/**
 * Вырезать из снимка страницы кусок высотой в лист.
 *
 * Нужно единственному случаю — карточке, которая выше страницы сама по себе: перенести её
 * некуда, и она печатается несколькими листами. Возвращает `null`, когда резать нечем
 * (нет 2D-контекста, как в jsdom) — вызывающий тогда печатает снимок целиком, что для
 * одностраничного отчёта и есть верный ответ.
 *
 * @param canvas Снимок листа.
 * @param sliceTop Верх куска в пикселях снимка.
 * @param sliceHeight Высота куска в пикселях снимка.
 * @param doc Документ, в котором создаётся промежуточный холст.
 */
function sliceCanvas(
  canvas: HTMLCanvasElement,
  sliceTop: number,
  sliceHeight: number,
  doc: Document,
  padTo?: number,
): HTMLCanvasElement | null {
  const copied = Math.min(sliceHeight, canvas.height - sliceTop);
  const target = doc.createElement("canvas");
  target.width = canvas.width;
  // ЛИСТ ВСЕГДА ПОЛНОЙ ВЫСОТЫ. Кусок, которым кончается разрезанная карточка, короче
  // страницы, и снимок «сколько получилось» ложился на A4 картинкой в треть листа — низ
  // оставался БЕЛОЙ БУМАГОЙ, потому что фон отчёта живёт в снимке, а не в PDF.
  target.height = Math.max(copied, padTo ?? 0);
  const ctx = target.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, sliceTop, canvas.width, copied, 0, 0, canvas.width, copied);
  // Добор фоном: берётся НИЖНЯЯ строка пикселей самого куска и растягивается вниз. Фон
  // страницы — вертикальный градиент, поэтому его продолжение и есть последняя строка;
  // отдельного знания о цвете шаблона конвейеру не требуется, а внешний шаблон с любой
  // подложкой получает своё продолжение, а не выдуманный цвет.
  if (target.height > copied && copied > 0) {
    ctx.drawImage(
      canvas,
      0, sliceTop + copied - 1, canvas.width, 1,
      0, copied, canvas.width, target.height - copied,
    );
  }
  return target;
}

/** Страница отчёта: макет варианта, его CSS и контекст (PRD-27 Фаза 2). */
export interface ReportPage {
  /** Макет варианта (`contentTemplates[].layoutFile`). */
  layout: string;
  /**
   * CSS варианта. Пакету не нужен — там таблица отчёта уже в документе внутри
   * `styles.css`; веб передаёт её здесь. Скоуплена в `.tb-report`, поэтому внедрение в
   * главный документ ни на что не влияет (§6.3).
   */
  css?: string;
  /**
   * Токены оформления теста как CSS-переменные. Ставятся на КОНТЕЙНЕР отчёта: сцены
   * здесь нет, `:root` отчёту не принадлежит, и это единственный канал темы (§6.3).
   */
  cssVars?: Record<string, string>;
  /** Контекст из `buildReportContext` / `buildAdaptiveReportContext`. */
  context: unknown;
}

/**
 * Render the report page into a downloaded PDF.
 *
 * Renders the variant's LAYOUT through the shared renderer — the same renderer the
 * learner screens use — then rasterizes it off-screen, scales it to A4 width and re-adds
 * the recommendation chips as REAL PDF links (the raster alone would make them dead
 * pictures).
 *
 * @param page Layout, optional CSS and context. See {@link ReportPage}.
 * @param testName Test title — only used to name the downloaded file.
 * @param deps See {@link ExportDeps}.
 * @returns The file name that was saved.
 * @throws When a library is missing or rasterizing fails — the caller decides how to
 *   surface it (both hosts show the failure to the learner rather than failing silently).
 */
export async function exportReportPdf(page: ReportPage, testName: string, deps: ExportDeps): Promise<string> {
  const doc = deps.document || (typeof document !== "undefined" ? document : null);
  if (!doc) throw new Error("Экспорт отчёта требует браузерного окружения");
  if (!deps.jsPDF || !deps.html2canvas) throw new Error("Библиотеки jsPDF или html2canvas не загружены");
  if (!page || !page.layout) throw new Error("Шаблон не предоставил макет отчёта");

  const container = doc.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  // CSS варианта живёт ВНУТРИ контейнера и уходит вместе с ним: пока отчёт строится,
  // лишних правил в документе нет, а после — и следа не остаётся.
  if (page.css) {
    const style = doc.createElement("style");
    style.textContent = page.css;
    container.appendChild(style);
  }
  const stage = doc.createElement("div");
  for (const [name, value] of Object.entries(page.cssVars ?? {})) {
    stage.style.setProperty(name, value);
  }
  container.appendChild(stage);
  doc.body.appendChild(container);

  try {
    renderScreenInto(stage, { layout: page.layout, context: page.context });
    const rendered = stage.firstElementChild as HTMLElement | null;
    if (!rendered) throw new Error("Макет отчёта ничего не отрисовал");

    // Let the browser lay the page out (web fonts, grid) before rasterizing.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // РАСКЛАДКА ПО ЛИСТАМ. Отчёт печатался одной страницей произвольной высоты, которую
    // нельзя ни распечатать, ни пролистать; теперь лист всегда A4, а разрыв проходит между
    // карточками. Считает её ОБЩИЙ `paginate-dom`, потому что тот же ответ нужен
    // предпросмотру в редакторе: автор согласовывает документ, который получит слушатель, и
    // две раскладки означали бы два разных документа.
    const sheets = buildReportSheets(rendered, doc, stage);
    const pxToMm = A4_WIDTH_MM / PAGE_WIDTH_PX;
    const pdf = new deps.jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [A4_WIDTH_MM, A4_HEIGHT_MM],
    });

    // Снимок на КОРЕНЬ, а не на лист: у карточки-переростка листы делят один и тот же
    // элемент, и растеризовать его заново на каждый кусок значило бы платить за одно и то
    // же по нескольку раз.
    const shots = new Map<HTMLElement, HTMLCanvasElement>();
    let sheetIndex = 0;
    for (const sheet of sheets) {
      let canvas = shots.get(sheet.root);
      if (!canvas) {
        canvas = await deps.html2canvas(sheet.root, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
          logging: false,
        });
        shots.set(sheet.root, canvas);
      }
      const links = collectLinks(sheet.root);
      const pxPerCssPx = canvas.width / PAGE_WIDTH_PX;
      // Кусок вырезается только тогда, когда лист не покрывает элемент целиком; резать
      // нечем (нет 2D-контекста, как в jsdom) — печатается снимок целиком.
      const pageHeightPx = Math.round(PAGE_HEIGHT_PX * pxPerCssPx);
      // Два РАЗНЫХ повода тронуть снимок, и путать их нельзя. РЕЗАТЬ надо, когда лист не
      // покрывает элемент целиком. ДОПОЛНЯТЬ — когда снимок ниже страницы: иначе внизу
      // листа останется белая бумага вместо фона отчёта.
      const whole = sheet.top === 0 && sheet.height * pxPerCssPx >= canvas.height - 1;
      const short = canvas.height < pageHeightPx - 1;
      const image =
        whole && !short
          ? canvas
          : sliceCanvas(
              canvas,
              Math.round(sheet.top * pxPerCssPx),
              Math.round(sheet.height * pxPerCssPx),
              doc,
              pageHeightPx,
            );
      const drawn = image ?? canvas;
      if (sheetIndex > 0) pdf.addPage?.();
      sheetIndex += 1;
      const imgHeight = (drawn.height * A4_WIDTH_MM) / drawn.width;
      pdf.addImage(drawn.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, A4_WIDTH_MM, imgHeight);
      // Ссылки этого листа: координаты чипа отсчитываются от верха ЭЛЕМЕНТА, поэтому у
      // продолжающих листов из них вычитается уже напечатанная высота.
      for (const link of links) {
        const y = link.y - sheet.top;
        if (y < 0 || y >= sheet.height) continue;
        pdf.link(link.x * pxToMm, y * pxToMm, link.width * pxToMm, link.height * pxToMm, {
          url: link.url,
          newWindow: true,
        });
      }
      // Прерываться можно ТОЛЬКО когда не удалось разрезать там, где разрез был нужен
      // (нет 2D-контекста — так выглядит jsdom). Неудавшийся ДОБОР фона документ не
      // портит: лист печатается как есть, остальные листы по-прежнему нужны.
      if (!image && !whole) break;
    }

    const fileName = reportFileName(testName);
    pdf.save(fileName);
    return fileName;
  } finally {
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}

/**
 * Read an image URL as a data URL, so the rasterizer never has to fetch it (a tainted
 * canvas silently drops the background). Resolves `null` when the asset is unavailable —
 * the report then falls back to its gradient/no-logo form rather than failing.
 *
 * @param src Image URL (package-relative in SCORM, an API path on the web).
 * @returns Data URL, or `null` when the image could not be read.
 */
export function loadImageDataUrl(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Inline the variant's pictures as data URLs, ready for the rasterizer (PRD-27 FR-05).
 *
 * The rasterizer never fetches anything: it snapshots what the DOM already has, and a
 * canvas tainted by a cross-origin image silently drops the picture. So every image the
 * page prints is read here first — the background and logo the TEMPLATE declared, or
 * whatever the author put in their place.
 *
 * An image that cannot be read resolves to an empty string rather than failing the
 * export: the layout gates its rows on the value, so the report degrades to «no
 * background / no logo» instead of not existing.
 *
 * @param values Values of the variant's `settings[]`, already resolved to URLs by
 *   {@link module:shared/report/report-assets resolveReportImageValues}.
 * @param imageKeys Which keys hold pictures (`ReportBake.imageKeys`).
 * @returns A copy of `values` with those keys replaced by data URLs.
 */
export async function inlineReportImageValues(
  values: Record<string, unknown> | null | undefined,
  imageKeys: readonly string[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...(values ?? {}) };
  await Promise.all(
    imageKeys.map(async (key) => {
      const src = typeof out[key] === "string" ? (out[key] as string) : "";
      if (!src) {
        out[key] = "";
        return;
      }
      if (src.startsWith("data:")) return;
      out[key] = (await loadImageDataUrl(src)) ?? "";
    }),
  );
  return out;
}
