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

  it("карточка выше страницы занимает свою страницу и режется внутри", () => {
    // Единственный случай, где разрыв внутри блока неизбежен: длинное толкование
    // показателя само по себе длиннее A4, и «не рвать» означало бы «не показать».
    const pages = paginateBlocks(stack([100, 1800, 100], 0), 802);
    expect(pages.map((p) => p.blocks)).toEqual([[0], [1], [2]]);
    expect(pages[1].offset).toBe(100);
    // Раскладка не пытается уместить переросток — она отдаёт его как есть, а нарезку
    // растра по кускам делает конвейер: высота страницы известна только ему.
    expect(pages[1].height).toBe(1800);
    expect(pages[0].height).toBe(802);
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
});
