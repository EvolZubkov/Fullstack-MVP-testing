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
  conditionsToFilter,
  countConditions,
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

    it("называет вопрос условия «ошибка в вопросе» его текстом, длинный — обрезает по слову", () => {
      const prompt = "Какие из перечисленных документов обязательны при оформлении сделки с юридическим лицом";
      const items = describeConditions(
        { ...EMPTY_FILTER, wrongQuestionIds: ["q1"] },
        { tests: [], groups: [], questions: [{ id: "q1", label: prompt }] },
      );

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("wrongQuestion:q1");
      expect(items[0].label.startsWith("Ошибка в вопросе: Какие из перечисленных документов")).toBe(true);
      expect(items[0].label.endsWith("…")).toBe(true);
      // Обрезка по слову: последнее слово перед многоточием целое.
      expect(prompt).toContain(items[0].label.replace("Ошибка в вопросе: ", "").slice(0, -1));
    });
  });

  /** FR-17: прохождения, где ошиблись на вопросе, — переход из строки вопроса теста. */
  describe("условие «ошибка в вопросе»", () => {
    it("переживает круговой рейс через адрес", () => {
      const filter: RegistryFilter = { ...EMPTY_FILTER, testIds: ["t1"], wrongQuestionIds: ["q1"] };

      expect(filterToSearch(filter)).toBe("?testId=t1&wrongQuestionId=q1");
      expect(parseFilter(filterToSearch(filter))).toEqual(filter);
    });

    it("отсутствует в разобранном фильтре, когда его нет в адресе", () => {
      expect("wrongQuestionIds" in parseFilter("?testId=t1")).toBe(false);
    });

    it("делает фильтр непустым и считается на кнопке", () => {
      const filter = parseFilter("?wrongQuestionId=q1");

      expect(isEmptyFilter(filter)).toBe(false);
      expect(countConditions(filter)).toBe(1);
    });

    it("доезжает из сохранённых условий", () => {
      expect(conditionsToFilter({ wrongQuestionIds: ["q1", 7] }).wrongQuestionIds).toEqual(["q1"]);
      expect("wrongQuestionIds" in conditionsToFilter({})).toBe(false);
    });

    it("без справочника называет вопрос «удалённым», а не идентификатором", () => {
      const items = describeConditions(
        { ...EMPTY_FILTER, wrongQuestionIds: ["q-x"] },
        { tests: [], groups: [] },
      );

      expect(items.map(item => item.label)).toEqual(["Ошибка в вопросе: удалённый"]);
    });
  });
});

describe("«Без группы» (замечание владельца 2026-10-04)", () => {
  it("чип называет значение словами, а не идентификатором", () => {
    const items = describeConditions({ ...EMPTY_FILTER, groupIds: ["none"] }, { tests: [], groups: [] } as never);
    expect(items.map(item => item.label)).toContain("Без группы");
  });

  it("живёт в адресе как groupId=none", () => {
    expect(filterToSearch({ ...EMPTY_FILTER, groupIds: ["none"] })).toContain("groupId=none");
  });
});
