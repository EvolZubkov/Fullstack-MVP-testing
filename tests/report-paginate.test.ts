/**
 * @module tests/report-paginate
 *
 * Правило разбивки отчёта на страницы A4 — чистая половина конвейера экспорта.
 *
 * Живёт отдельно от `report-export-pdf.test.ts` намеренно: там проверяется, ЧТО уходит в
 * писателя PDF (растеризация, ссылки, уборка контейнера), а здесь — единственное решение,
 * которое принимает раскладка: где кончается страница. Ему не нужен ни DOM, ни браузер,
 * и его дешевле пинить на числах, чем на снимках.
 */

import { describe, it, expect } from "vitest";
import { paginateBlocks, sliceBySafeLines, type ReportBlockBox } from "../shared/report/paginate";

/** Блоки, идущие подряд с заданными высотами и зазором. */
function stack(heights: number[], gap = 0): ReportBlockBox[] {
  const boxes: ReportBlockBox[] = [];
  let top = 0;
  for (const height of heights) {
    boxes.push({ top, bottom: top + height });
    top += height + gap;
  }
  return boxes;
}

describe("paginateBlocks", () => {
  it("контент в одну страницу остаётся одной страницей", () => {
    // Обратная совместимость: короткий отчёт обязан выйти таким же, каким выходил, —
    // одной страницей A4, без единого разрыва.
    const pages = paginateBlocks(stack([100, 200, 150], 15), 802);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ blocks: [0, 1, 2], offset: 0 });
  });

  it("блок, не влезающий в остаток, целиком уходит на следующую страницу", () => {
    // Смысл всей затеи: разрыв проходит МЕЖДУ карточками, а не сквозь них.
    const pages = paginateBlocks(stack([500, 400, 300], 0), 802);
    expect(pages).toHaveLength(2);
    expect(pages[0].blocks).toEqual([0]);
    expect(pages[1].blocks).toEqual([1, 2]);
    // Смещение страницы — верх её первого блока: по нему конвейер обрезает снимок.
    expect(pages[1].offset).toBe(500);
  });

  it("карточка выше страницы начинается там, где стоит, и режется внутри", () => {
    // Единственный случай, где разрыв внутри блока неизбежен: длинное толкование
    // показателя само по себе длиннее A4, и «не рвать» означало бы «не показать».
    // Переносить его на свой лист незачем — разрез всё равно будет, а остаток текущего
    // листа (здесь — шапка и семь сотен пикселей) ушёл бы в макулатуру.
    const pages = paginateBlocks(stack([100, 1800, 100], 0), 802);
    expect(pages.map((p) => p.blocks)).toEqual([[0, 1], [2]]);
    expect(pages[1].offset).toBe(1900);
    // Раскладка не пытается уместить переросток — она отдаёт его как есть, а нарезку
    // растра по кускам делает конвейер: высота страницы известна только ему.
    expect(pages[0].height).toBe(1900);
  });

  it("пустой список страниц не порождает", () => {
    expect(paginateBlocks([], 802)).toEqual([]);
  });

  it("неизвестная высота страницы не дробит документ", () => {
    // jsdom раскладку не считает, и все размеры приходят нулями. Ноль как «страница
    // нулевой высоты» разбил бы документ на страницу из каждого блока; трактуем его как
    // «делить нечем» и отдаём одну страницу — прежнее поведение конвейера.
    expect(paginateBlocks(stack([0, 0, 0]), 0)[0].blocks).toEqual([0, 1, 2]);
    expect(paginateBlocks(stack([300, 300]), 0)).toHaveLength(1);
  });

  it("блок в лист не режется вовсе", () => {
    expect(sliceBySafeLines([100, 200], 300, 802)).toEqual([{ top: 0, height: 300 }]);
  });

  it("разрез идёт по нижней границе строки, а не по краю листа", () => {
    // Строки по 20 px: лист кончается на 802, ближайшая целая строка — 800.
    const lines = Array.from({ length: 100 }, (_, i) => (i + 1) * 20);
    const slices = sliceBySafeLines(lines, 1200, 802);
    expect(slices).toEqual([
      { top: 0, height: 800 },
      { top: 800, height: 400 },
    ]);
  });

  it("подряд идущие листы продолжают друг друга без пропусков и нахлёста", () => {
    const lines = Array.from({ length: 200 }, (_, i) => (i + 1) * 17);
    const slices = sliceBySafeLines(lines, 3000, 802);
    let cursor = 0;
    for (const slice of slices) {
      expect(slice.top).toBe(cursor);
      expect(slice.height).toBeGreaterThan(0);
      expect(slice.height).toBeLessThanOrEqual(802);
      cursor += slice.height;
    }
    // Ни одного потерянного пикселя: куски покрывают блок ровно.
    expect(cursor).toBe(3000);
  });

  it("без безопасных линий режет по листу, а не зацикливается", () => {
    // Так приходит из среды, которая раскладку не считает, и так же выглядит строка
    // выше листа: напечатать документ всё равно надо.
    const slices = sliceBySafeLines([], 2000, 802);
    expect(slices).toEqual([
      { top: 0, height: 802 },
      { top: 802, height: 802 },
      { top: 1604, height: 396 },
    ]);
  });

  it("зазор между карточками учитывается по фактическим координатам", () => {
    // Отступы карточек — часть их положения, а не отдельная поправка: раскладка
    // работает по измеренным top/bottom, поэтому margin уже внутри чисел.
    const pages = paginateBlocks(stack([390, 390, 390], 30), 802);
    // 390 + 30 + 390 = 810 > 802 — вторая карточка не влезает.
    expect(pages.map((p) => p.blocks)).toEqual([[0], [1], [2]]);
  });
});

describe("разрез без висячих строк и по крупным границам", () => {
  /** Строки одинаковой высоты — так выглядит абзац после раскладки. */
  const rows = (step: number, count: number) =>
    Array.from({ length: count }, (_, i) => (i + 1) * step);

  it("не оставляет на следующем листе одну строку", () => {
    // Блок 810 px строками по 20 на листе 802: разрез по краю пришёлся бы на 800, и на
    // второй лист уехали бы жалкие 10 px — половина строки, висящая одна на странице.
    const slices = sliceBySafeLines(rows(20, 41), 810, 802);
    const tail = slices[slices.length - 1];
    expect(tail.height).toBeGreaterThanOrEqual(40);
    // И первый лист при этом не потерял больше, чем отдал.
    expect(slices[0].height + tail.height).toBe(810);
  });

  it("режет по границе вложенного блока, когда она рядом с краем листа", () => {
    // 800 — низ строки, 780 — низ карточки показателя. Разрез по 780 оставляет целый
    // блок на листе; разница в 20 px не стоит разорванной карточки.
    const slices = sliceBySafeLines(rows(20, 100), 1600, 802, { blockLines: [780] });
    expect(slices[0]).toEqual({ top: 0, height: 780 });
  });

  it("далёкую границу блока не предпочитает строке", () => {
    // 400 — это половина листа: резать там значит выбросить 400 px бумаги ради
    // целостности блока, который и так будет разрезан следующим листом.
    const slices = sliceBySafeLines(rows(20, 100), 1600, 802, { blockLines: [400] });
    expect(slices[0].height).toBe(800);
  });

  it("без подсказок ведёт себя как прежде", () => {
    expect(sliceBySafeLines(rows(20, 100), 1200, 802)).toEqual([
      { top: 0, height: 800 },
      { top: 800, height: 400 },
    ]);
  });
});

describe("хвост не превращается в почти пустую страницу", () => {
  it("подтягивает огрызок до четверти листа", () => {
    // Блок 1007 px на листе 802: по краю разрез дал бы 842 + 165 — полная страница и
    // огрызок. Хвост обязан дорасти минимум до четверти листа.
    const lines = Array.from({ length: 100 }, (_, i) => (i + 1) * 14);
    const slices = sliceBySafeLines(lines, 1007, 802);
    const tail = slices[slices.length - 1];
    expect(tail.height).toBeGreaterThanOrEqual(802 * 0.25);
    expect(slices.reduce((sum, s) => sum + s.height, 0)).toBe(1007);
  });

  it("нормальный хвост не трогает", () => {
    const lines = Array.from({ length: 200 }, (_, i) => (i + 1) * 20);
    const slices = sliceBySafeLines(lines, 1400, 802);
    expect(slices[0].height).toBe(800);
    expect(slices[1].height).toBe(600);
  });

  it("отступает назад по ГРАНИЦЕ БЛОКА, а не по строке внутри него", () => {
    // Отчёт РТК: строки тем идут блоками по ~75 px, и подтягивание хвоста уводило разрез
    // на ближайшую строку ТЕКСТА — то есть рассекало строку темы пополам, хотя черта
    // между темами лежала в трёх десятках пикселей выше.
    const lines = Array.from({ length: 100 }, (_, i) => (i + 1) * 14);
    // Границы тем: каждые 75 px.
    const blockLines = Array.from({ length: 18 }, (_, i) => (i + 1) * 75);
    const slices = sliceBySafeLines(lines, 950, 802, { blockLines });
    const tail = slices[slices.length - 1];
    expect(tail.height).toBeGreaterThanOrEqual(802 * 0.25);
    // Разрез стоит ровно на границе темы.
    expect(blockLines).toContain(tail.top);
    expect(slices.reduce((sum, s) => sum + s.height, 0)).toBe(950);
  });

  it("границы блока нет — отступает по строке, как раньше", () => {
    const lines = Array.from({ length: 100 }, (_, i) => (i + 1) * 14);
    const slices = sliceBySafeLines(lines, 950, 802, { blockLines: [] });
    const tail = slices[slices.length - 1];
    expect(tail.height).toBeGreaterThanOrEqual(802 * 0.25);
    expect(lines).toContain(tail.top);
  });
});

describe("принудительный разрыв между блоками документа", () => {
  /**
   * Документ с меткой разрыва между блоками. Метка — блок нулевой высоты, ровно как её
   * рисует `renderReportInto`; её индекс и уходит в `breakBefore`.
   */
  const withMark = (before: number[], markGap: number, after: number[]) => {
    const boxes = stack([...before, 0, ...after], markGap);
    return { boxes, mark: before.length };
  };

  it("раздел за меткой набирается заново: заголовок не остаётся один", () => {
    // Ровно случай из отчёта ЧИЛ: вводный блок 700, за меткой — зонтик «Ваш результат»
    // (30) и карточка шкал (470). По высоте зонтик влезал к вводному блоку, а карточка
    // уже нет, и разрез по метке оставлял его на странице в одиночестве.
    const { boxes, mark } = withMark([700], 0, [30, 470]);
    const pages = paginateBlocks(boxes, 746, new Set([mark]));
    expect(pages).toHaveLength(2);
    expect(pages[0].blocks).toEqual([0]);
    expect(pages[1].blocks).toEqual([1, 2, 3]);
  });

  it("метка перед первым блоком пустой страницы не даёт", () => {
    const pages = paginateBlocks(stack([0, 300, 200]), 746, new Set([0]));
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks).toEqual([0, 1, 2]);
  });

  it("две метки подряд дают один разрыв, а не пустой лист между ними", () => {
    const boxes = stack([300, 0, 0, 200]);
    const pages = paginateBlocks(boxes, 746, new Set([1, 2]));
    expect(pages).toHaveLength(2);
    // Обе метки едут на втором листе вместе с содержимым: высоты у них нет, места они не
    // занимают, а разрыв между ними уже отработан.
    expect(pages[1].blocks).toEqual([1, 2, 3]);
  });

  it("высота листа продолжает работать внутри раздела", () => {
    // За меткой — больше, чем помещается: раздел делится обычным правилом.
    const { boxes, mark } = withMark([300], 0, [500, 400]);
    const pages = paginateBlocks(boxes, 746, new Set([mark]));
    expect(pages.map((p) => p.blocks)).toEqual([[0], [1, 2], [3]]);
  });

  it("без меток раскладка прежняя", () => {
    expect(paginateBlocks(stack([500, 400, 300], 0), 802)).toEqual(
      paginateBlocks(stack([500, 400, 300], 0), 802, new Set()),
    );
  });
});

describe("принудительный разрыв страницы", () => {
  /** Строки одинаковой высоты — так выглядит абзац после раскладки. */
  const rows = (step: number, count: number) =>
    Array.from({ length: count }, (_, i) => (i + 1) * step);

  it("делит содержимое, которое по высоте делить было бы не за чем", () => {
    // Весь блок — 400 px на листе 802: сам по себе он не делится вовсе. Метка в макете
    // приказывает начать лист на 200, и приказ старше высоты листа.
    expect(sliceBySafeLines(rows(20, 20), 400, 802, { forcedLines: [200] })).toEqual([
      { top: 0, height: 200 },
      { top: 200, height: 200 },
    ]);
  });

  it("режет РОВНО по метке, не отступая на ближайшую строку", () => {
    // 210 не совпадает ни с одной границей строки: приказ есть приказ, и разрез идёт
    // именно там, где верстальщик его поставил.
    const slices = sliceBySafeLines(rows(20, 20), 400, 802, { forcedLines: [210] });
    expect(slices[0]).toEqual({ top: 0, height: 210 });
  });

  it("не порождает пустых листов: метка в начале и в конце содержимого игнорируется", () => {
    expect(sliceBySafeLines(rows(20, 20), 400, 802, { forcedLines: [0, 400] })).toEqual([
      { top: 0, height: 400 },
    ]);
  });

  it("две метки подряд дают один разрыв, а не пустой лист между ними", () => {
    const slices = sliceBySafeLines(rows(20, 20), 400, 802, { forcedLines: [200, 200] });
    expect(slices).toHaveLength(2);
    expect(slices.reduce((sum, s) => sum + s.height, 0)).toBe(400);
  });

  it("раздел длиннее листа режется внутри себя по строкам", () => {
    // Первый раздел — 1200 px: он не помещается на лист и делится обычным правилом, по
    // нижней границе строки. Второй начинается ровно с метки.
    const slices = sliceBySafeLines(rows(20, 100), 1600, 802, { forcedLines: [1200] });
    expect(slices).toEqual([
      { top: 0, height: 800 },
      { top: 800, height: 400 },
      { top: 1200, height: 400 },
    ]);
  });

  it("правило висячей строки не сдвигает метку", () => {
    // Хвост раздела — 40 px, меньше четверти листа. Подтягивать его не за счет чего:
    // отступать пришлось бы за метку, а её ставил человек.
    const slices = sliceBySafeLines(rows(20, 60), 1200, 802, { forcedLines: [840] });
    expect(slices[slices.length - 1]).toEqual({ top: 840, height: 360 });
    expect(slices.some((s) => s.top === 840)).toBe(true);
  });

  it("без меток режет ровно как прежде", () => {
    expect(sliceBySafeLines(rows(20, 100), 1200, 802, { forcedLines: [] })).toEqual([
      { top: 0, height: 800 },
      { top: 800, height: 400 },
    ]);
  });
});
