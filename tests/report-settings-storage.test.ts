/**
 * @module tests/report-settings-storage
 *
 * PRD-27 Фаза 3 — хранение выбора варианта отчёта (`tests.report_settings_json`) и его
 * путь до страницы: сервер обязан отдать МАКЕТ выбранного варианта и значения полей,
 * которые заполнил автор, а не только умолчания манифеста.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reportSettingsSchema } from "../shared/schema";
import { readReportRenderPayload } from "../server/services/template-render";

/** Временный шаблон с двумя вариантами отчёта: выбор автора должен что-то менять. */
function makeTemplate(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-report-"));
  fs.mkdirSync(path.join(dir, "layouts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "styles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "layouts", "a.html"), '<div class="tb-report">A</div>');
  fs.writeFileSync(path.join(dir, "layouts", "b.html"), '<div class="tb-report">B</div>');
  fs.writeFileSync(path.join(dir, "styles", "report.css"), ".tb-report { color: red }");
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      id: "tmp",
      params: [],
      contentTemplates: [
        {
          key: "report.a",
          kind: "report",
          layoutFile: "layouts/a.html",
          styleFile: "styles/report.css",
          isDefault: true,
          settings: [
            { key: "headline", type: "text", default: "Итоги" },
            { key: "showRecs", type: "boolean", default: true },
          ],
        },
        {
          key: "report.b",
          kind: "report",
          layoutFile: "layouts/b.html",
          settings: [{ key: "headline", type: "text", default: "Сводка" }],
        },
      ],
    }),
  );
  return dir;
}

describe("схема tests.report_settings_json", () => {
  it("хранит выбор по РЕЖИМУ теста, обе ветки независимы", () => {
    const parsed = reportSettingsSchema.parse({
      standard: { variantKey: "report.a", values: { headline: "Итоги" } },
      adaptive: { variantKey: "report.adaptive.x", values: {} },
    });
    expect(parsed.standard?.variantKey).toBe("report.a");
    expect(parsed.adaptive?.variantKey).toBe("report.adaptive.x");
  });

  it("ветка одного режима не обязывает заполнять другую", () => {
    const parsed = reportSettingsSchema.parse({ standard: { variantKey: "report.a", values: {} } });
    expect(parsed.adaptive == null).toBe(true);
  });

  it("значения по умолчанию — пустой объект, а не undefined", () => {
    const parsed = reportSettingsSchema.parse({ standard: { variantKey: "report.a" } });
    expect(parsed.standard?.values).toEqual({});
  });

  it("пустой ключ варианта отклоняется: выбирать нечего", () => {
    expect(() => reportSettingsSchema.parse({ standard: { variantKey: "" } })).toThrow();
  });

  it("ветка БЕЗ ключа варианта сохраняется: так лежат настройки времён PRD-35", () => {
    // Отчёт настраивался раньше, чем у него появились варианты, и такие ветки в базе
    // ключа не несут. Отклонять их значит терять настройку, по которой хосты уже
    // собирают отчёт: отсутствие ключа разрешается вариантом с `isDefault`.
    const parsed = reportSettingsSchema.parse({ standard: { values: { showCompetencyRadar: true } } });
    expect(parsed.standard?.variantKey).toBeUndefined();
    expect(parsed.standard?.values).toEqual({ showCompetencyRadar: true });
  });
});

describe("выбор автора доходит до страницы отчёта", () => {
  it("без выбора берётся вариант с isDefault и умолчания полей", () => {
    const dir = makeTemplate();
    const payload = readReportRenderPayload(dir, "report", null);
    expect(payload?.variantKey).toBe("report.a");
    expect(payload?.layout).toContain(">A<");
    expect(payload?.values).toEqual({ headline: "Итоги", showRecs: true });
  });

  it("выбранный вариант меняет и макет, и набор полей", () => {
    const dir = makeTemplate();
    const payload = readReportRenderPayload(dir, "report", { variantKey: "report.b", values: {} });
    expect(payload?.variantKey).toBe("report.b");
    expect(payload?.layout).toContain(">B<");
    // У «b» нет поля showRecs — значение чужого варианта не протекает.
    expect(payload?.values).toEqual({ headline: "Сводка" });
  });

  it("значения автора накладываются на умолчания манифеста", () => {
    const dir = makeTemplate();
    const payload = readReportRenderPayload(dir, "report", {
      variantKey: "report.a",
      values: { headline: "Аттестация", showRecs: false },
    });
    expect(payload?.values).toEqual({ headline: "Аттестация", showRecs: false });
  });

  it("исчезнувший из шаблона выбор откатывается на isDefault, а не ломает отчёт", () => {
    const dir = makeTemplate();
    const payload = readReportRenderPayload(dir, "report", { variantKey: "нет-такого", values: {} });
    expect(payload?.variantKey).toBe("report.a");
  });

  it("CSS варианта приезжает вместе с макетом, вида без варианта — нет", () => {
    const dir = makeTemplate();
    expect(readReportRenderPayload(dir, "report", null)?.css).toContain(".tb-report");
    // Вариант «b» стилей не объявляет — пустая строка, а не падение.
    expect(readReportRenderPayload(dir, "report", { variantKey: "report.b" })?.css).toBe("");
    // Адаптивного вида шаблон не объявил — хост обязан деградировать (FR-10).
    expect(readReportRenderPayload(dir, "report.adaptive", null)).toBeNull();
  });

  it("шаблон без манифеста не роняет выдачу результата", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "tb-empty-"));
    expect(readReportRenderPayload(empty, "report", null)).toBeNull();
  });
});
