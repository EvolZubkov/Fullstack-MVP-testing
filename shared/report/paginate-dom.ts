/**
 * @module shared/report/paginate-dom
 *
 * Измерительная половина постраничной раскладки отчёта: она смотрит на ОТРИСОВАННУЮ
 * страницу и превращает её в листы A4. Правило разрыва в ней не живёт — оно в чистом
 * {@link module:shared/report/paginate}, который считает по числам и проверяется без
 * браузера.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫМ МОДУЛЕМ. Листы нужны ДВУМ местам, и они обязаны совпадать: конвейер
 * экспорта режет по ним PDF, а предпросмотр в редакторе показывает автору то, что уйдёт в
 * файл. Пока раскладка жила внутри экспорта, предпросмотр рисовал документ одной лентой —
 * автор согласовывал не тот документ, который получит слушатель.
 *
 * Браузерный модуль (нужен живой DOM), как `shared/template/dnd`.
 */

import { paginateBlocks, sliceBySafeLines, type ReportBlockBox } from "./paginate";

/** Ширина страницы отчёта в CSS-пикселях (A4 при 72 dpi). */
export const PAGE_WIDTH_PX = 595;
/** Высота страницы отчёта в CSS-пикселях. */
export const PAGE_HEIGHT_PX = 842;

/**
 * Начиная с какой высоты вложенный элемент считается БЛОКОМ, а не строкой текста.
 * Строка отчёта — 12–20 px с интерлиньяжем; всё, что заметно выше, — контейнер, и его
 * нижняя граница годится в предпочтительное место разреза.
 */
const MIN_BLOCK_HEIGHT_PX = 40;

/**
 * Один лист документа.
 *
 * `root` — элемент, который печатается; `top`/`height` — видимая часть этого элемента.
 * Смещение ненулевое только у листов, продолжающих карточку-переросток: она выше страницы,
 * и её единственный элемент показывается несколькими листами по очереди.
 */
export interface ReportSheet {
  root: HTMLElement;
  top: number;
  height: number;
}

/**
 * Полезная высота листа: A4 минус собственные поля страницы отчёта.
 *
 * Поля читаются с ОТРИСОВАННОГО корня, а не берутся числом: они принадлежат CSS шаблона, и
 * внешний шаблон вправе задать свои. Среда без раскладки (jsdom) отдаёт пустые значения —
 * тогда полем считается ноль, и это ровно то, чего от неё ждут: делить документ ей нечем.
 */
function usablePageHeight(rendered: Element, doc: Document): number {
  const style = doc.defaultView?.getComputedStyle(rendered);
  const pad = (value: string | undefined) => Number.parseFloat(value || "0") || 0;
  return PAGE_HEIGHT_PX - pad(style?.paddingTop) - pad(style?.paddingBottom);
}

/**
 * Во сколько раз страница ПОКАЗАНА мельче, чем свёрстана.
 *
 * Предпросмотр в редакторе уменьшает документ (`zoom` на сцене), и `getBoundingClientRect`
 * отдаёт уже уменьшенные числа, тогда как высота листа задана в собственных пикселях
 * страницы. Без поправки документ «умещался» куда не следовало: план клал на лист больше,
 * чем на нём помещается, и лист потом дорезался растром — вместо разрыва между карточками.
 *
 * Масштаб берётся из ОТНОШЕНИЯ измерений, а не из известной ширины: `offsetHeight` зум не
 * трогает, `getBoundingClientRect` трогает, и их частное верно при любой ширине страницы —
 * в том числе у внешнего шаблона, который свёрстан не под 595 px.
 */
function renderScale(rendered: HTMLElement): number {
  const rect = rendered.getBoundingClientRect();
  if (!(rect.height > 0) || !(rendered.offsetHeight > 0)) return 1;
  return rect.height / rendered.offsetHeight;
}

/**
 * Границы блоков верхнего уровня относительно верха страницы — вход раскладки.
 *
 * Блок — прямой ребёнок корня: строка шапки или карточка отчёта. Более мелкое дробление
 * (абзац, строка таблицы) намеренно не рассматривается: разрыв внутри карточки — то, ради
 * чего постраничная выдача и делалась.
 *
 * Меряется `offsetTop`/`offsetHeight`: они в собственных пикселях страницы, и масштаб
 * показа на них не влияет. Корень отчёта позиционирован (`position: relative`), поэтому
 * `offsetTop` прямого ребёнка отсчитывается от него же.
 */
function measureBlocks(rendered: HTMLElement, scale: number): ReportBlockBox[] {
  const rootTop = rendered.getBoundingClientRect().top;
  return [...rendered.children].map((child) => {
    const el = child as HTMLElement;
    if (el.offsetHeight > 0 && el.offsetParent) {
      return { top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight };
    }
    // Запасной путь для среды без раскладки (jsdom) и для непозиционированного корня.
    const rect = el.getBoundingClientRect();
    return { top: (rect.top - rootTop) / scale, bottom: (rect.bottom - rootTop) / scale };
  });
}

/**
 * Ординаты, по которым лист можно разрезать, не рассекая строку текста.
 *
 * Собирается ДВУМЯ источниками. Первый — низ каждой визуальной строки: где браузер перенёс
 * текст, знает только он, и `Range.getClientRects()` отдаёт по прямоугольнику на строку —
 * единственный доступный способ это узнать. Второй — низ каждого вложенного элемента: между
 * абзацем и заголовком резать можно, а строки внутри пустого элемента нет.
 *
 * Среда без раскладки вернёт пустой список — тогда {@link sliceBySafeLines} режет по высоте
 * листа, то есть ровно так, как резал бы без этой функции.
 */
/**
 * Границы КРУПНЫХ вложенных блоков — карточки показателя, строки шкалы, абзаца
 * рекомендаций. Разрез по ним оставляет блок целым, поэтому у края листа они выигрывают
 * у строки (см. {@link module:shared/report/paginate} `SliceOptions.blockLines`).
 *
 * Крупным считается элемент не глубже третьего уровня и выше одной строки: глубже лежат
 * уже сами строки и подписи, а их низы и так собирает {@link safeCutLines}. Отбор идёт по
 * ГЕОМЕТРИИ, а не по классам: имена классов принадлежат шаблону, и внешний шаблон,
 * назвавший карточку иначе, потерял бы это правило молча.
 */
function blockCutLines(root: HTMLElement, scale: number, minHeight: number): number[] {
  const rootTop = root.getBoundingClientRect().top;
  const lines: number[] = [];
  const walk = (el: Element, depth: number) => {
    for (const child of [...el.children]) {
      const rect = child.getBoundingClientRect();
      const height = rect.height / scale;
      if (height >= minHeight) lines.push((rect.bottom - rootTop) / scale);
      if (depth < 3) walk(child, depth + 1);
    }
  };
  walk(root, 1);
  return lines;
}

function safeCutLines(root: Element, doc: Document, scale: number): number[] {
  const rootTop = root.getBoundingClientRect().top;
  const lines: number[] = [];
  root.querySelectorAll("*").forEach((el) => {
    lines.push((el.getBoundingClientRect().bottom - rootTop) / scale);
  });
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!String(node.nodeValue ?? "").trim()) continue;
    range.selectNodeContents(node);
    const rects = range.getClientRects?.();
    if (!rects) continue;
    for (let i = 0; i < rects.length; i += 1) lines.push((rects[i].bottom - rootTop) / scale);
  }
  return lines;
}

/**
 * Разложить отрисованную страницу отчёта на листы A4.
 *
 * Документ в один лист возвращается КАК ЕСТЬ, тем же элементом и без клона: так у экспорта
 * сохраняется прежнее окружение (CSS варианта, токены оформления на контейнере) и прежний
 * результат байт в байт. Многолистовой документ клонируется, и каждый лист получает только
 * свои блоки.
 *
 * @param rendered Корень отрисованной страницы (`.tb-report`).
 * @param doc Документ, в котором она живёт.
 * @param mount Куда положить клоны листов, чтобы они получили раскладку и стили. Без него
 *   клоны кладутся рядом с оригиналом.
 * @returns Листы в порядке документа; для однолистового отчёта — ровно один.
 */
export function buildReportSheets(rendered: HTMLElement, doc: Document, mount?: HTMLElement): ReportSheet[] {
  const scale = renderScale(rendered);
  const usable = usablePageHeight(rendered, doc);
  const planned = paginateBlocks(measureBlocks(rendered, scale), usable);
  // Макет без блоков верхнего уровня (один текст в корне — так выглядят проверочные
  // страницы и вырожденные шаблоны) делить не на что: он остаётся одним листом.
  const plan = planned.length ? planned : [{ blocks: [], offset: 0, height: 0 }];
  if (plan.length === 1) {
    return [{ root: rendered, top: 0, height: plan[0].height }];
  }

  // Эталон снимается ДО того, как оригинал будет спрятан: клон копирует и инлайн-стили,
  // поэтому лист, склонированный с уже скрытой страницы, ушёл бы в растеризатор невидимым
  // и вернулся пустым холстом.
  const pristine = rendered.cloneNode(true) as HTMLElement;
  const parent = mount ?? (rendered.parentElement as HTMLElement | null);
  rendered.style.display = "none";

  const sheets: ReportSheet[] = [];
  for (const pagePlan of plan) {
    const sheetRoot = pristine.cloneNode(true) as HTMLElement;
    const keep = new Set(pagePlan.blocks);
    [...sheetRoot.children].forEach((child, i) => {
      if (!keep.has(i)) child.remove();
    });
    parent?.appendChild(sheetRoot);
    // Карточка выше листа печатается несколькими листами — единственное место, где разрыв
    // проходит ВНУТРИ блока. Проходит он по нижней границе строки: строка, разрезанная
    // пополам, нечитаема на обеих половинах.
    const height = sheetRoot.offsetHeight || sheetRoot.getBoundingClientRect().height / scale || pagePlan.height;
    // Подсказки о крупных границах считаются от той же высоты строки, что и правило
    // висячей строки: «выше одной строки» — это и есть «не строка, а блок».
    const lines = safeCutLines(sheetRoot, doc, scale);
    const blockLines = blockCutLines(sheetRoot, scale, MIN_BLOCK_HEIGHT_PX);
    for (const slice of sliceBySafeLines(lines, height, PAGE_HEIGHT_PX, { blockLines })) {
      sheets.push({ root: sheetRoot, top: slice.top, height: slice.height });
    }
  }
  return sheets;
}
