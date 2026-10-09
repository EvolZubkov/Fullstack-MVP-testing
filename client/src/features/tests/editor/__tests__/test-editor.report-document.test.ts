/**
 * @module features/tests/editor/__tests__/test-editor.report-document
 *
 * PRD-51, задача 5 плана Э3 — ДОКУМЕНТ ОТЧЁТА в модели редактора: чтение из API и сборка
 * тела запроса.
 *
 * Здесь пиннится главное правило шва: ОТСУТСТВИЕ поля `reportBlocks` в теле запроса и
 * ПУСТОЙ массив — разные вещи. Первое значит «не трогать», второе стирает документ.
 * Перепутать их — значит терять собранный документ на сохранении с чужой вкладки.
 */
import { describe, expect, it } from "vitest";
import { apiToEditorModel, editorModelToPayload } from "../test-editor.mappers";
import type { TestEditorModel } from "../test-editor.types";
import type { DraftBlock } from "../use-report-document";

/** Ответ API в объёме, который читает маппер. */
function apiTest(reportBlocks?: unknown) {
  return {
    id: "test-1",
    title: "Сертификация",
    mode: "standard",
    sections: [],
    ...(reportBlocks === undefined ? {} : { reportBlocks }),
  } as never;
}

const row = (block: string, sortOrder: number, over: Record<string, unknown> = {}) => ({
  block,
  sortOrder,
  enabled: true,
  templateKey: null,
  valuesJson: {},
  settingsJson: {},
  ...over,
});

const draft = (block: string, over: Partial<DraftBlock> = {}): DraftBlock => ({
  block,
  templateKey: null,
  enabled: true,
  values: {},
  settings: {},
  ...over,
});

/** Модель с черновиком документа заданной ветви. */
function modelWithDraft(mode: "standard" | "adaptive", blocks: DraftBlock[]): TestEditorModel {
  const model = apiToEditorModel(apiTest());
  return {
    ...model,
    mode,
    reportDocument: { ...model.reportDocument, draft: { [mode]: blocks } },
  };
}

describe("документ отчёта в модели редактора", () => {
  it("читает строки обеих ветвей и выстраивает их по порядку печати", () => {
    const model = apiToEditorModel(
      apiTest({
        standard: [row("topics", 1), row("header", 0)],
        adaptive: [row("header", 0)],
      }),
    );
    expect(model.reportDocument?.saved?.standard?.map((b) => b.block)).toEqual(["header", "topics"]);
    expect(model.reportDocument?.saved?.adaptive?.map((b) => b.block)).toEqual(["header"]);
  });

  it("забывает sortOrder: дальше порядок несёт сама позиция в списке", () => {
    const model = apiToEditorModel(apiTest({ standard: [row("header", 7)] }));
    expect(model.reportDocument?.saved?.standard?.[0]).not.toHaveProperty("sortOrder");
  });

  it("переносит выбранный вариант, признак показа и содержимое строки", () => {
    const model = apiToEditorModel(
      apiTest({
        standard: [
          row("page", 0, {
            templateKey: "v.page.text",
            enabled: false,
            valuesJson: { title: "О тесте" },
            settingsJson: { align: "left" },
          }),
        ],
      }),
    );
    expect(model.reportDocument?.saved?.standard?.[0]).toEqual({
      block: "page",
      templateKey: "v.page.text",
      enabled: false,
      values: { title: "О тесте" },
      settings: { align: "left" },
    });
  });

  it("тест без документа читается без строк, а не с пустыми", () => {
    const model = apiToEditorModel(apiTest());
    expect(model.reportDocument?.saved).toEqual({});
  });

  it("НЕ шлёт документ, пока автор его не правил", () => {
    const payload = editorModelToPayload(apiToEditorModel(apiTest({ standard: [row("header", 0)] })));
    expect(payload).not.toHaveProperty("reportBlocks");
  });

  it("шлёт правленый документ ИМЕНАМИ КОНТРАКТА МАРШРУТА, сохраняя порядок списка", () => {
    // Имена полей проверяются буквально. Тело запроса разбирает zod, и незаявленный ключ
    // он выбрасывает молча: подстановка формы строки разрешения (`valuesJson`) уже стоила
    // молча потерянного текста авторских страниц — поймано только живой приёмкой.
    const payload = editorModelToPayload(
      modelWithDraft("standard", [
        draft("page", { templateKey: "v.page.text", values: { title: "О тесте" }, settings: { align: "left" } }),
        draft("header", { enabled: false }),
      ]),
    );
    expect(payload.reportBlocks).toEqual([
      {
        block: "page",
        templateKey: "v.page.text",
        enabled: true,
        values: { title: "О тесте" },
        settings: { align: "left" },
      },
      { block: "header", templateKey: null, enabled: false, values: {}, settings: {} },
    ]);
    // Порядок тело не несёт: его выводит сервер из позиции, и второе поле спорило бы с ним.
    expect(payload.reportBlocks?.[0]).not.toHaveProperty("sortOrder");
  });

  it("пустой список шлётся: это осознанное «печатать нечего»", () => {
    const payload = editorModelToPayload(modelWithDraft("standard", []));
    expect(payload.reportBlocks).toEqual([]);
  });

  it("шлёт ветвь ТЕКУЩЕГО режима, не задевая вторую", () => {
    const payload = editorModelToPayload(modelWithDraft("adaptive", [draft("header")]));
    expect(payload.reportBlocks?.map((b) => b.block)).toEqual(["header"]);

    // Черновик другой ветви на запрос не влияет: сервер заменяет строки по паре
    // «тест + режим», и отправить чужую ветвь значило бы стереть не тот документ.
    const model = modelWithDraft("standard", [draft("summary")]);
    const mixed = editorModelToPayload({
      ...model,
      reportDocument: { draft: { standard: [draft("summary")], adaptive: [draft("scales")] } },
    });
    expect(mixed.reportBlocks?.map((b) => b.block)).toEqual(["summary"]);
  });
});
