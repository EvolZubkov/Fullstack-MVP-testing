/**
 * @module tests/workbook-section-groups
 * @description PRD-50 FR-11: блоки итогов в книге Excel — список на листе «Настройки»,
 * членство разделов колонкой листа «Структура».
 *
 * Книга адресует блок НАЗВАНИЕМ, а база хранит `key`, на который ссылается раздел. Значит,
 * ключ надо восстанавливать при каждой загрузке, и именно здесь живёт цена ошибки: ключ,
 * подобранный не тому блоку, тихо перекладывает разделы, а автор увидит это только на
 * экране итогов.
 */
import { describe, it, expect } from "vitest";
import { resolveSectionGroups } from "../server/services/workbook-import";
import { parseSettingsSheet, serializeSettingsRows } from "../server/utils/workbook-settings";

const row = (value: string) => ({ "Параметр": "Блоки итогов", "Значение": value });
const cell = (src: Parameters<typeof serializeSettingsRows>[0]) =>
  serializeSettingsRows(src).find((r) => r["Параметр"] === "Блоки итогов")?.["Значение"];

describe("параметр «Блоки итогов»", () => {
  it("выгружает названия в порядке автора и без ключей", () => {
    expect(cell({
      sectionGroupsJson: [
        { key: "block-2", label: "Практика", order: 1 },
        { key: "block-1", label: "Теория", order: 0 },
      ],
    } as never)).toBe("Теория; Практика");
  });

  it("тест без блоков даёт пустую ячейку", () => {
    expect(cell({} as never)).toBe("");
  });

  it("читает список, снимая лишние пробелы", () => {
    const { draft, errors } = parseSettingsSheet([row(" Теория ;Практика; ")]);
    expect(errors).toEqual([]);
    expect(draft.sectionGroupLabels).toEqual(["Теория", "Практика"]);
  });

  it("два блока с одним названием — ошибка", () => {
    // Колонка «Структура» адресует блок названием, и выбирать за автора нельзя.
    const { errors } = parseSettingsSheet([row("Теория; теория")]);
    expect(errors).toHaveLength(1);
    // Названо ВТОРОЕ вхождение и ровно так, как автор его написал: искать в ячейке он
    // будет глазами, а не по нормализованной форме.
    expect(errors[0]).toContain('"теория"');
  });
});

describe("resolveSectionGroups", () => {
  const current = [
    { key: "block-1", label: "Теория" },
    { key: "block-2", label: "Практика" },
  ];

  it("блок с прежним названием сохраняет ключ — разделы остаются в нём", () => {
    expect(resolveSectionGroups(["Практика", "Теория"], current)).toEqual([
      { key: "block-2", label: "Практика", order: 0 },
      { key: "block-1", label: "Теория", order: 1 },
    ]);
  });

  it("название сопоставляется без оглядки на регистр и пробелы", () => {
    expect(resolveSectionGroups(["  практика  "], current)[0].key).toBe("block-2");
  });

  it("новый блок получает свободный ключ, а не чужой", () => {
    const out = resolveSectionGroups(["Теория", "Итоговый"], current);
    expect(out[0].key).toBe("block-1");
    expect(out[1].key).not.toBe("block-1");
    expect(out[1].key).not.toBe("block-2");
    expect(out[1].label).toBe("Итоговый");
  });

  it("переименованный блок — это НОВЫЙ блок: ключ прежнего не наследуется", () => {
    // Иначе книга, переименовавшая блок, молча забрала бы себе разделы старого — а
    // членство книга задаёт сама, колонкой «Блок итогов».
    const out = resolveSectionGroups(["Основы"], current);
    expect(out[0].key).not.toBe("block-1");
    expect(out[0].key).not.toBe("block-2");
  });

  it("пустой список стирает блоки", () => {
    expect(resolveSectionGroups([], current)).toEqual([]);
  });

  it("порядок — тот, в котором названия перечислены в ячейке", () => {
    const out = resolveSectionGroups(["Практика", "Теория"], current);
    expect(out.map((g) => g.order)).toEqual([0, 1]);
  });
});
