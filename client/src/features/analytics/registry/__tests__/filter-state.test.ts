/**
 * @module features/analytics/registry/__tests__/filter-state
 * @description PRD-56 FR-03: условия отбора живут в адресе страницы.
 *
 * Ссылку на выборку пересылают коллеге, и он обязан увидеть ровно ту же — значит адрес должен
 * нести все условия и переживать круговой рейс без потерь. Обратная сторона: чужая ссылка
 * может прийти с мусором в параметрах, и экран от этого падать не должен.
 */

import { describe, expect, it } from "vitest";

import {
  describeConditions,
  filterToSearch,
  isEmptyFilter,
  parseFilter,
  EMPTY_FILTER,
  type RegistryFilter,
} from "../filter-state";

describe("filter-state", () => {
  it("переживает круговой рейс: условия — адрес — условия", () => {
    const filter: RegistryFilter = {
      testIds: ["t1", "t2"],
      groupIds: ["g1"],
      // Вариант выдачи и версия публикации — такие же условия, как остальные, и ссылку они
      // переживают наравне с ними.
      formIds: ["form-a"],
      snapshotIds: ["snap-1"],
      sources: ["web", "import"],
      outcomes: ["failed"],
      // Оргструктура (FR-06b) — тоже условие адреса.
      organizations: ["АО «Ромашка»"],
      units: ["Отдел продаж"],
      positions: [],
      from: "2026-09-01",
      to: "2026-09-30",
    };

    expect(parseFilter(filterToSearch(filter))).toEqual(filter);
  });

  it("не пишет в адрес пустые условия", () => {
    const search = filterToSearch({ testIds: [], groupIds: [], sources: [], outcomes: [] });

    expect(search).toBe("");
  });

  it("пропускает незнакомые параметры, а не падает на них", () => {
    const filter = parseFilter("?testId=t1&utm_source=mail&sort=date");

    expect(filter.testIds).toEqual(["t1"]);
  });

  it("отбрасывает значения, которых у условия быть не может", () => {
    const filter = parseFilter("?source=web&source=carrier-pigeon&outcome=exploded");

    expect(filter.sources).toEqual(["web"]);
    expect(filter.outcomes).toEqual([]);
  });

  it("понимает период, заданный одной границей", () => {
    expect(parseFilter("?from=2026-09-01").from).toBe("2026-09-01");
    expect(parseFilter("?to=2026-09-30").to).toBe("2026-09-30");
  });

  it("не принимает дату, которой не бывает", () => {
    expect(parseFilter("?from=вчера").from).toBeUndefined();
    expect(parseFilter("?to=2026-13-45").to).toBeUndefined();
  });

  it("читает несколько значений и списком, и повтором параметра", () => {
    expect(parseFilter("?testId=t1,t2").testIds).toEqual(["t1", "t2"]);
    expect(parseFilter("?testId=t1&testId=t2").testIds).toEqual(["t1", "t2"]);
  });

  it("отличает пустой фильтр от заполненного", () => {
    expect(isEmptyFilter(parseFilter(""))).toBe(true);
    expect(isEmptyFilter(parseFilter("?outcome=passed"))).toBe(false);
    // Вариант и версия — полноценные условия: фильтр с ними пустым не считается, иначе
    // «Сбросить» и счётчик на кнопке говорили бы, что отбора нет.
    expect(isEmptyFilter(parseFilter("?formId=form-a"))).toBe(false);
    expect(isEmptyFilter(parseFilter("?snapshotId=snap-1"))).toBe(false);
  });

  /**
   * Подписи условий: одно и то же условие на всех экранах называется одинаково, иначе
   * читатель решит, что выборки разные.
   */
  describe("describeConditions", () => {
    const dictionaries = {
      tests: [{ id: "t1", title: "Сертификация" }],
      groups: [{ id: "g1", name: "Розница" }],
      forms: [{ id: "form-a", label: "Вариант A" }],
      versions: [{ id: "snap-1", version: 9 }],
    };

    it("называет вариант и версию по справочнику теста", () => {
      const items = describeConditions(
        { ...EMPTY_FILTER, formIds: ["form-a"], snapshotIds: ["snap-1"] },
        dictionaries,
      );

      expect(items.map(item => item.label)).toEqual(["Вариант: Вариант A", "Версия: 9"]);
    });

    it("не печатает идентификатор, когда справочник не доехал", () => {
      // Uuid в чипе не говорит читателю ничего: условие честнее назвать «удалённый», чем
      // показать строку, по которой отбор не проверить и не объяснить.
      const items = describeConditions(
        { ...EMPTY_FILTER, formIds: ["form-x"], snapshotIds: ["snap-x"] },
        { tests: [], groups: [] },
      );

      expect(items.map(item => item.label)).toEqual(["Вариант: удалённый", "Версия: публикации"]);
    });
  });
});
