/**
 * @module tests/scorm-report-document
 *
 * PRD-51 §5.3 — ДОКУМЕНТ ОТЧЁТА в SCORM-пакете.
 *
 * Предмет проверки — что попадает в `TEST_DATA`: строки документа едут СЫРЫМИ (связать их
 * с раскладками блоков может только сторона, видящая манифест, и это сборщик, а не
 * рантайм), а разметка авторских областей проходит ту же очистку, что и значения
 * контентных страниц. В пакете она попадает в НАСТОЯЩИЙ документ, где авторское правило
 * `body { … }` перекрасило бы плеер, а `<script>` исполнился бы.
 */
import { describe, expect, it } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";
import type { Test } from "@shared/schema";

const test = {
  id: "t1",
  title: "Сертификация",
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 80 },
} as unknown as Test;

/** Разбирает `TEST_DATA` обратно в объект. */
function bake(reportBlocks: unknown[]): Record<string, unknown> {
  const js = buildTestJson({
    test,
    sections: [],
    reportBlocks: reportBlocks as never,
  } as never);
  const json = js.slice(js.indexOf("{"), js.lastIndexOf("}") + 1);
  return JSON.parse(json) as Record<string, unknown>;
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    testId: "t1",
    mode: "standard",
    block: "page",
    templateKey: "report.block.page.text",
    sortOrder: 2,
    enabled: true,
    valuesJson: { body: "<p>О тесте</p>" },
    settingsJson: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe("документ отчёта в пакете", () => {
  it("строки документа едут в TEST_DATA с порядком и признаком показа", () => {
    const baked = bake([row(), row({ id: "b2", block: "topics", sortOrder: 1, enabled: false })]);
    const blocks = (baked.reportBlocks ?? []) as Array<Record<string, unknown>>;
    expect(blocks.map((b) => b.block)).toEqual(["page", "topics"]);
    expect(blocks.map((b) => b.sortOrder)).toEqual([2, 1]);
    expect(blocks[1].enabled).toBe(false);
    expect(blocks[0].templateKey).toBe("report.block.page.text");
  });

  it("разметка области очищается: скрипт и обработчик не доезжают", () => {
    const baked = bake([
      row({ valuesJson: { body: '<p onclick="steal()">Текст</p><script>alert(1)</script>' } }),
    ]);
    const blocks = baked.reportBlocks as Array<{ values: Record<string, string> }>;
    expect(blocks[0].values.body).not.toContain("<script");
    expect(blocks[0].values.body).not.toContain("onclick");
    expect(blocks[0].values.body).toContain("Текст");
  });

  it("авторский CSS запирается в область поля, а не красит плеер", () => {
    const baked = bake([
      row({ valuesJson: { body: "<style>body { background: red; }</style><p>Текст</p>" } }),
    ]);
    const blocks = baked.reportBlocks as Array<{ values: Record<string, string> }>;
    expect(blocks[0].values.body).toContain('[data-placeholder="body"]');
    expect(blocks[0].values.body).not.toMatch(/(^|[^\]])\bbody\s*\{/);
  });

  it("у теста без документа ключа в TEST_DATA нет вовсе", () => {
    expect(bake([]).reportBlocks).toBeUndefined();
  });
});
