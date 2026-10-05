/**
 * @module features/content/__tests__/content-filter-url
 * @description Условия фильтра банка в адресе (замечание владельца 2026-10-05 о возврате): дерево,
 * на которое вернулись, показывает тот же отбор; прочие параметры адреса не трогаются.
 */
import { describe, expect, it } from "vitest";

import { EMPTY_FILTER, readContentFilter, writeContentFilter } from "../content-filters";

describe("условия фильтра банка в адресе", () => {
  it("туда и обратно — те же условия", () => {
    const filter = {
      ...EMPTY_FILTER,
      types: ["single" as const, "matching" as const],
      diffMin: 20,
      diffMax: 70,
      tags: ["Антикоррупция"],
      media: ["image" as const],
      author: "u1",
      scope: "mine" as const,
      states: ["review" as const],
    };
    const params = new URLSearchParams("view=quality");
    writeContentFilter(filter, params);

    expect(params.get("view")).toBe("quality");
    expect(readContentFilter(`?${params.toString()}`)).toEqual(filter);
  });

  it("«не задана» и пустой фильтр", () => {
    const params = new URLSearchParams();
    writeContentFilter({ ...EMPTY_FILTER, diffUnset: true }, params);
    expect(params.toString()).toBe("diff=unset");
    expect(readContentFilter("?diff=unset").diffUnset).toBe(true);

    writeContentFilter(EMPTY_FILTER, params);
    expect(params.toString()).toBe("");
    expect(readContentFilter("")).toEqual(EMPTY_FILTER);
  });

  it("мусор в адресе отбрасывается молча", () => {
    expect(readContentFilter("?type=nope&scope=all-of-them&state=bad&diff=x")).toEqual(EMPTY_FILTER);
  });
});
