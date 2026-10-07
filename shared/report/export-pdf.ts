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
import { renderReportInto, type ReportBlockToRender } from "./render-report";
import { buildReportPages, PAGE_HEIGHT_PX, PAGE_WIDTH_PX } from "./paginate-dom";
import { syncCloneFonts } from "./clone-fonts";

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

/**
 * Правило, которое чинит ИЗМЕРИТЕЛЬ ШРИФТА растеризатора на время экспорта.
 *
 * html2canvas находит базовую линию шрифта скрытой пробой: он кладёт в документ строку из
 * `<span>` с текстом и картинки 1×1 с `vertical-align: baseline`, а подъём шрифта читает
 * как `img.offsetTop - span.offsetTop`. Верно это ровно до тех пор, пока картинка остаётся
 * СТРОЧНОЙ. Глобальный сброс веб-хоста объявляет `img { display: block }`
 * (`client/src/styles/preflight.css`), проба перестаёт быть строкой, «подъём» вырастает на
 * пол-строки — и весь текст снимка съезжает вниз примерно на 0.5em, тогда как карточки,
 * фон и рамки остаются на месте.
 *
 * Для постраничного отчёта это не косметика. Разрывы считаются по ОТРИСОВАННЫМ строкам
 * ({@link module:shared/report/paginate-dom}), а на бумагу их переносит растеризатор:
 * съехавший текст пересекает границу окна страницы, нижняя строка листа режется пополам,
 * и её вторая половина всплывает вверху следующего листа.
 *
 * Правило адресовано ровно этой пробе — по однопиксельному GIF, который html2canvas зашил
 * в свой код. Приложение его не замечает: картинка невидима и живёт доли секунды, а сам
 * стиль уезжает вместе с контейнером отчёта.
 */
const FONT_PROBE_CSS =
  'img[src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"]' +
  "{display:inline!important;vertical-align:baseline!important}";

/**
 * A clickable region carried over into the PDF: a `.pdf-link-btn` chip or one line of an
 * author's `<a href>`.
 */
interface LinkBox {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Адрес авторской ссылки, который можно перенести в PDF.
 *
 * Берутся только адреса, ведущие НАРУЖУ документа: `http(s)` и `mailto`. Якорь `#…` или
 * относительный путь в PDF вести некуда — у файла нет ни страницы-источника, ни адреса.
 */
const PDF_LINK_URL = /^(?:https?:\/\/|mailto:)/i;

/**
 * Кликабельные области страницы, снятые с ОТРИСОВАННОГО листа.
 *
 * Растр сам по себе делает из любой ссылки мёртвую картинку, поэтому каждый адрес
 * возвращается в PDF настоящей ссылкой. Источников два:
 * - чипы рекомендаций `.pdf-link-btn` — адрес в `data-url`, область — сам чип;
 * - ссылки `<a href>` из авторского текста (страницы, колонки, вводный блок). Такая ссылка
 *   строчная и может переноситься, поэтому область берётся ПО СТРОКАМ
 *   (`getClientRects`): одна общая рамка накрыла бы и чужой текст между концом первой
 *   строки и началом второй.
 *
 * Координаты отсчитываются от верха ЭТОГО листа: на второй странице они иначе указали бы
 * в начало документа.
 *
 * @param pageRoot Корень листа (страница целиком либо её клон).
 */
function collectLinks(pageRoot: Element): LinkBox[] {
  const pageRect = pageRoot.getBoundingClientRect();
  const links: LinkBox[] = [];
  const push = (url: string, rect: DOMRect | DOMRectReadOnly) => {
    links.push({
      url,
      x: rect.left - pageRect.left,
      y: rect.top - pageRect.top,
      width: rect.width,
      height: rect.height,
    });
  };
  pageRoot.querySelectorAll(".pdf-link-btn").forEach((chip) => {
    const url = chip.getAttribute("data-url");
    if (!url) return;
    push(url, chip.getBoundingClientRect());
  });
  pageRoot.querySelectorAll("a[href]").forEach((anchor) => {
    const url = (anchor.getAttribute("href") ?? "").trim();
    if (!PDF_LINK_URL.test(url)) return;
    // Пустые прямоугольники отбрасываются: у строчного элемента их дают стыки переноса, и
    // область нулевого размера нажать всё равно нельзя.
    for (const rect of Array.from(anchor.getClientRects())) {
      if (rect.width > 0 && rect.height > 0) push(url, rect);
    }
  });
  return links;
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
  /**
   * PRD-51: ОБОЛОЧКА документа — корневой узел `.tb-report`. Приходит вместе с
   * {@link blocks} у шаблона, объявившего блоки; вместе с ней {@link layout} не нужен.
   */
  shell?: string;
  /**
   * PRD-51: блоки документа в порядке печати, с уже прочитанными раскладками. Пусто или
   * отсутствует — шаблон блоков не объявил, и печатается цельный {@link layout} (§5.4).
   */
  blocks?: readonly ReportBlockToRender[];
}

/**
 * Render the report page into a downloaded PDF.
 *
 * Renders the variant's LAYOUT through the shared renderer — the same renderer the
 * learner screens use — then rasterizes it off-screen, scales it to A4 width and re-adds
 * the recommendation chips and the author's external `<a href>` links as REAL PDF links
 * (the raster alone would make them dead pictures).
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
  // PRD-51: документ приходит ЛИБО блоками (оболочка + список), ЛИБО цельной раскладкой.
  // Пусто и то и другое — печатать нечего, и молча отдать слушателю пустой PDF нельзя.
  const asDocument = !!page?.shell && !!page.blocks?.length;
  if (!page || (!asDocument && !page.layout)) throw new Error("Шаблон не предоставил макет отчёта");

  const container = doc.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  // Заплатка измерителя шрифта — первой: ею меряется КАЖДЫЙ снимок (см. FONT_PROBE_CSS).
  const probeFix = doc.createElement("style");
  probeFix.textContent = FONT_PROBE_CSS;
  container.appendChild(probeFix);
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
    // ДОКУМЕНТ ИЗ БЛОКОВ (PRD-51 §5.3). Шаблон, объявивший блоки, приходит с оболочкой
    // и списком; шаблон без них — со старым цельным `layout`, и путь совместимости
    // остаётся живым (§5.4). Разводить это по двум конвейерам нельзя: постраничная
    // раскладка, стыки листов и растеризация ниже одни и те же, и вторая копия
    // разошлась бы с первой на первой же правке.
    if (asDocument) {
      renderReportInto(stage, { shell: page.shell!, context: page.context, blocks: page.blocks! });
    } else {
      renderScreenInto(stage, { layout: page.layout, context: page.context });
    }
    const rendered = stage.firstElementChild as HTMLElement | null;
    if (!rendered) throw new Error("Макет отчёта ничего не отрисовал");

    // Let the browser lay the page out (web fonts, grid) before rasterizing. The fonts are
    // awaited explicitly: html2canvas places every word where the layout measured it and
    // draws it with the canvas font, so a layout taken while the face was still loading
    // puts words on top of each other — spaces and punctuation vanish from the PDF.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await doc.fonts?.ready;

    // РАСКЛАДКА ПО СТРАНИЦАМ. Отчёт печатался одной страницей произвольной высоты,
    // которую нельзя ни распечатать, ни пролистать; теперь лист всегда A4, а разрыв
    // проходит между карточками. Считает её ОБЩИЙ `paginate-dom`, потому что тот же ответ
    // нужен предпросмотру в редакторе: автор согласовывает документ, который получит
    // слушатель, и две раскладки означали бы два разных документа.
    //
    // Страница приходит ГОТОВЫМ элементом ровно в лист. Раньше конвейер резал один общий
    // снимок, и обе беды стыка росли отсюда: фон продолжался сквозь границу листа, а
    // неполный кусок дотягивался повтором нижней строки пикселей — вместе с буквами.
    const pages = buildReportPages(rendered, doc, stage);
    const pxToMm = A4_WIDTH_MM / PAGE_WIDTH_PX;
    const pdf = new deps.jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [A4_WIDTH_MM, A4_HEIGHT_MM],
    });

    for (const [index, page] of pages.entries()) {
      const canvas = await deps.html2canvas(page, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        logging: false,
        // Слова меряются в КЛОНЕ, а рисуются холстом этого документа: клон обязан видеть те
        // же начертания, иначе слова ложатся друг на друга и пробелы пропадают (clone-fonts).
        onclone: (clonedDoc: Document) => syncCloneFonts(doc, clonedDoc),
      });
      if (index > 0) pdf.addPage?.();
      // Страница и лист — одно и то же, поэтому снимок ложится на всю бумагу: ни белой
      // полосы внизу, ни искажения пропорций.
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM);
      // Ссылки берутся с САМОЙ страницы: содержимое на ней уже сдвинуто, поэтому
      // координаты чипа и строки ссылки отсчитываются от верха листа и поправок не требуют.
      for (const link of collectLinks(page)) {
        if (link.y < 0 || link.y >= PAGE_HEIGHT_PX) continue;
        pdf.link(link.x * pxToMm, link.y * pxToMm, link.width * pxToMm, link.height * pxToMm, {
          url: link.url,
          newWindow: true,
        });
      }
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
