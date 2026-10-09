import { describe, expect, it } from "vitest";
import { OUTCOME } from "../../scripts/deps/classify.mjs";
import { PACE } from "../../scripts/deps/pace.mjs";
import { exitCodeFor, formatFlags, renderConsole, renderMarkdown, summarize, toJson } from "../../scripts/deps/report.mjs";

function result(over: Record<string, unknown> = {}) {
  return {
    id: "express@5.2.1",
    name: "express",
    scope: "",
    version: "5.2.1",
    dev: false,
    requiredBy: ["проект"],
    outcome: OUTCOME.OK,
    status: "PERMITTED",
    known: true,
    zone: "MAIN",
    comment: "",
    alerts: [],
    ...over,
  };
}

describe("summarize", () => {
  it("считает исходы", () => {
    const summary = summarize([result(), result({ outcome: OUTCOME.BLOCK, status: "RESTRICTED" })]);
    expect(summary.counts).toMatchObject({ ok: 1, block: 1, warn: 0, error: 0 });
  });

  it("разделяет находки продакшена и dev", () => {
    const summary = summarize([
      result({ id: "a@1", outcome: OUTCOME.BLOCK, status: "RESTRICTED" }),
      result({ id: "b@1", outcome: OUTCOME.BLOCK, status: "ABSENT", dev: true }),
    ]);
    expect(summary.blockedProd.map((r) => r.id)).toEqual(["a@1"]);
    expect(summary.blockedDev.map((r) => r.id)).toEqual(["b@1"]);
  });
});

describe("exitCodeFor", () => {
  it("ноль, когда всё разрешено", () => {
    expect(exitCodeFor(summarize([result()]), {})).toBe(0);
  });

  it("единица при запрете в продакшен-графе", () => {
    expect(exitCodeFor(summarize([result({ outcome: OUTCOME.BLOCK })]), {})).toBe(1);
  });

  it("ноль при запрете только в dev", () => {
    expect(exitCodeFor(summarize([result({ outcome: OUTCOME.BLOCK, dev: true })]), {})).toBe(0);
  });

  it("единица при запрете в dev, когда попрошено строго", () => {
    expect(exitCodeFor(summarize([result({ outcome: OUTCOME.BLOCK, dev: true })]), { strictDev: true })).toBe(1);
  });

  it("двойка, когда часть пакетов не удалось спросить", () => {
    expect(exitCodeFor(summarize([result({ outcome: OUTCOME.ERROR })]), {})).toBe(2);
  });

  it("находка важнее неполноты", () => {
    const summary = summarize([result({ outcome: OUTCOME.BLOCK }), result({ id: "x@1", outcome: OUTCOME.ERROR })]);
    expect(exitCodeFor(summary, {})).toBe(1);
  });
});

describe("renderMarkdown", () => {
  it("называет запрещённый пакет и того, кто его тянет", () => {
    const md = renderMarkdown(
      [result({ outcome: OUTCOME.BLOCK, status: "RESTRICTED", requiredBy: ["проект", "vite@8.0.0"] })],
      { checkedAt: "2026-09-18T10:00:00.000Z", total: 1 },
    );
    expect(md).toContain("express");
    expect(md).toContain("vite@8.0.0");
    expect(md).toContain("RESTRICTED");
  });

  it("не остаётся без заголовка первого уровня", () => {
    expect(renderMarkdown([result()], { checkedAt: "2026-09-18T10:00:00.000Z", total: 1 }).startsWith("# ")).toBe(true);
  });
});

describe("renderConsole", () => {
  it("показывает сводку и не перечисляет разрешённые", () => {
    const text = renderConsole(summarize([result(), result({ id: "b@1", name: "b", outcome: OUTCOME.BLOCK })]));
    expect(text).toContain("Разрешено: 1");
    expect(text).not.toContain("express");
    expect(text).toContain("b");
  });
});

describe("краевые случаи", () => {
  it("пустой список: код 0, сводка из нулей, без разделов находок", () => {
    const summary = summarize([]);
    expect(summary.counts).toMatchObject({ ok: 0, warn: 0, block: 0, error: 0 });
    expect(exitCodeFor(summary, {})).toBe(0);
    const console = renderConsole(summary);
    expect(console).toContain("Разрешено: 0");
    expect(console).not.toContain("Запрещено или нет в базе");
    const md = renderMarkdown([], { checkedAt: "2026-09-18T10:00:00.000Z", total: 0 });
    expect(md).toContain("Все проверенные пакеты разрешены.");
  });

  it("символ | в comment не ломает Markdown-таблицу", () => {
    const md = renderMarkdown(
      [result({ outcome: OUTCOME.WARN, status: "PARTIALLY_PERMITTED", comment: "риск | смотри alerts" })],
      { checkedAt: "2026-09-18T10:00:00.000Z", total: 1 },
    );
    const dataRow = md.split("\n").find((line) => line.includes("риск"));
    expect(dataRow).toBeDefined();
    // экранированный '|' плюс ровно 7 разделительных '|' самой строки таблицы
    expect((dataRow ?? "").split("\\|").length).toBe(2);
    expect((dataRow ?? "").match(/(?<!\\)\|/g)?.length).toBe(8);
  });

  it("очень длинная цепочка requiredBy печатается в Markdown целиком", () => {
    const longChain = Array.from({ length: 40 }, (_, i) => `pkg-${i}@1.0.${i}`);
    const md = renderMarkdown([result({ outcome: OUTCOME.BLOCK, status: "RESTRICTED", requiredBy: longChain })], {
      checkedAt: "2026-09-18T10:00:00.000Z",
      total: 1,
    });
    expect(md).toContain(longChain[0]);
    expect(md).toContain(longChain[longChain.length - 1]);
  });

  it("zone: null отображается прочерком, а не 'null'", () => {
    const md = renderMarkdown([result({ outcome: OUTCOME.BLOCK, status: "ABSENT", zone: null })], {
      checkedAt: "2026-09-18T10:00:00.000Z",
      total: 1,
    });
    expect(md).not.toContain("null");
    const text = renderConsole(summarize([result({ outcome: OUTCOME.BLOCK, status: "ABSENT", zone: null })]));
    expect(text).not.toContain("null");
  });

  it("пакет с областью показан как scope/name в обоих выводах", () => {
    const scoped = result({
      id: "@electric-sql/pglite@0.4.1",
      name: "pglite",
      scope: "@electric-sql",
      outcome: OUTCOME.BLOCK,
      status: "RESTRICTED",
    });
    const md = renderMarkdown([scoped], { checkedAt: "2026-09-18T10:00:00.000Z", total: 1 });
    expect(md).toContain("@electric-sql/pglite");
    const text = renderConsole(summarize([scoped]));
    expect(text).toContain("@electric-sql/pglite");
  });

  it("консоль помечает dev-only находку пометкой '(dev)'", () => {
    const text = renderConsole(summarize([result({ outcome: OUTCOME.BLOCK, status: "RESTRICTED", dev: true })]));
    expect(text).toContain("(dev)");
  });

  it("toJson сохраняет все результаты, включая разрешённые, не только находки", () => {
    const data = toJson([result(), result({ id: "b@1", outcome: OUTCOME.BLOCK })], {
      checkedAt: "2026-09-18T10:00:00.000Z",
      total: 2,
    });
    expect(data.results).toHaveLength(2);
    expect(data.results.map((r: { id: string }) => r.id)).toEqual(["express@5.2.1", "b@1"]);
    expect(data.summary).toMatchObject({ ok: 1, block: 1, warn: 0, error: 0 });
    expect(data.total).toBe(2);
    expect(data.checkedAt).toBe("2026-09-18T10:00:00.000Z");
  });

  it("пакет с ошибкой опроса виден по имени и в консоли, и в Markdown (раздел не пропадает)", () => {
    const v = result({ id: "netfail@1.0.0", name: "netfail", outcome: OUTCOME.ERROR, status: "ERROR" });
    const text = renderConsole(summarize([v]));
    expect(text).toContain("netfail");
    expect(text).toContain("Не удалось спросить");
    const md = renderMarkdown([v], { checkedAt: "2026-09-18T10:00:00.000Z", total: 1 });
    expect(md).toContain("netfail");
    expect(md).toContain("Не удалось спросить");
  });

  it("ABSENT в продакшене — тоже находка (спека §7: наравне с RESTRICTED)", () => {
    const v = result({ outcome: OUTCOME.BLOCK, status: "ABSENT", dev: false });
    expect(exitCodeFor(summarize([v]), {})).toBe(1);
    const text = renderConsole(summarize([v]));
    expect(text).toContain("express");
    expect(text).toContain("Запрещено или нет в базе — продакшен");
  });

  it("summarize бросает на незнакомом outcome, а не тихо обнуляет прогон", () => {
    // @ts-expect-error — умышленно неверное значение, имитирующее опечатку вызывающего
    expect(() => summarize([result({ outcome: "blocked" })])).toThrow(/unknown outcome/);
  });

  it("status и zone с символом | в Markdown-таблице экранируются, как chain и comment", () => {
    const v = result({
      outcome: OUTCOME.WARN,
      status: "CUSTOM|STATUS",
      zone: "WEIRD|ZONE",
    });
    const md = renderMarkdown([v], { checkedAt: "2026-09-18T10:00:00.000Z", total: 1 });
    const dataRow = md.split("\n").find((line) => line.includes("CUSTOM"));
    expect(dataRow).toBeDefined();
    expect(dataRow).toContain("CUSTOM\\|STATUS");
    expect(dataRow).toContain("WEIRD\\|ZONE");
    // 7 колонок => ровно 8 неэкранированных '|'
    expect((dataRow ?? "").match(/(?<!\\)\|/g)?.length).toBe(8);
  });

  it("незнакомый статус (known: false) помечен явно и в консоли, и в Markdown", () => {
    const v = result({ outcome: OUTCOME.WARN, status: "SOMETHING_NEW", known: false });
    const text = renderConsole(summarize([v]));
    expect(text).toContain("незнакомый статус");
    const md = renderMarkdown([v], { checkedAt: "2026-09-18T10:00:00.000Z", total: 1 });
    expect(md).toContain("незнакомый статус");
  });

  it("известный статус не несёт пометку «незнакомый»", () => {
    const v = result({ outcome: OUTCOME.WARN, status: "REQUESTED", known: true });
    expect(renderConsole(summarize([v]))).not.toContain("незнакомый");
    expect(renderMarkdown([v], { checkedAt: "2026-09-18T10:00:00.000Z", total: 1 })).not.toContain("незнакомый");
  });

  it("консоль печатает comment системы, не только Markdown — обрезанная выдача отличима от сетевого сбоя", () => {
    const truncated = result({
      id: "ms@1.0.0",
      name: "ms",
      outcome: OUTCOME.ERROR,
      status: "ERROR",
      comment: "выдача обрезана на 1000 записях, точного совпадения среди них нет",
    });
    const text = renderConsole(summarize([truncated]));
    expect(text).toContain("выдача обрезана");
  });
});

describe("formatFlags", () => {
  it("без флагов — читаемое описание обычного прогона, а не пустая строка", () => {
    expect(formatFlags({})).toMatch(/обычный прогон/);
    expect(formatFlags(undefined)).toMatch(/обычный прогон/);
  });

  it("называет только флаги, отклоняющиеся от умолчания", () => {
    const text = formatFlags({ prod: true, strictDev: false, noCache: false, delayMs: PACE.baseDelayMs });
    expect(text).toContain("--prod");
    expect(text).not.toContain("--strict-dev");
    expect(text).not.toContain("--no-cache");
    expect(text).not.toContain("--delay"); // на полу минимума — не решение, а умолчание
  });

  it("--delay печатается, только когда он выше пола PACE.baseDelayMs", () => {
    expect(formatFlags({ delayMs: PACE.baseDelayMs + 1000 })).toContain("--delay");
    expect(formatFlags({ delayMs: PACE.baseDelayMs })).not.toContain("--delay");
  });

  it("перечисляет несколько отклоняющихся флагов вместе", () => {
    const text = formatFlags({ prod: true, strictDev: true, noCache: true });
    expect(text).toContain("--prod");
    expect(text).toContain("--strict-dev");
    expect(text).toContain("--no-cache");
  });
});

describe("renderMarkdown/toJson — meta: флаги и свежесть кэша", () => {
  const meta = {
    checkedAt: "2026-09-18T10:00:00.000Z",
    total: 1,
    flags: { prod: true, strictDev: false, noCache: false, delayMs: PACE.baseDelayMs },
    fromCache: 1,
    cacheTtlDays: 7,
  };

  it("Markdown называет флаги и долю ответов из кэша", () => {
    const md = renderMarkdown([result()], meta);
    expect(md).toContain("--prod");
    expect(md).toContain("Из кэша: 1 из 1");
    expect(md).toContain("7 дней");
  });

  it("без fromCache в meta строка про кэш не появляется (старый вызов не ломается)", () => {
    const md = renderMarkdown([result()], { checkedAt: meta.checkedAt, total: 1 });
    expect(md).not.toContain("Из кэша");
  });

  it("toJson переносит flags/fromCache/cacheTtlDays как есть, не пересказывая их", () => {
    const json = toJson([result()], meta);
    expect(json.flags).toEqual(meta.flags);
    expect(json.fromCache).toBe(1);
    expect(json.cacheTtlDays).toBe(7);
  });
});
