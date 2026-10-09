/**
 * @module features/tests/editor/__tests__/test-editor.interpretation.test
 * @description Круг «прочитал - показал - сохранил» для толкований в отображателях редактора.
 *
 * Разделы теста сохраняются ЦЕЛИКОМ: чего отображатель не прислал, то записывается как
 * `null`. Поэтому потеря толкования здесь выглядит не как ошибка, а как успешное сохранение
 * с молча опустевшим полем — и ловится только такой проверкой.
 */
import { describe, expect, it } from "vitest";
import { apiToEditorModel, mapEditorSectionsToPayload } from "../test-editor.mappers";
import type { TestEditorModel } from "../test-editor.types";

/** Ответ API теста с одним разделом: минимум, на котором виден круг. */
function apiTest(sectionOver: Record<string, unknown> = {}) {
  return {
    id: "test-1",
    title: "Сертификация",
    mode: "standard",
    version: 1,
    sections: [
      {
        topicId: "topic-1",
        topicName: "Управляет потенциалом команды",
        drawCount: 4,
        required: true,
        timeLimitMinutes: null,
        topicPassRuleJson: { source: "inherit_overall" },
        feedbackJson: null,
        maxQuestions: 10,
        ...sectionOver,
      },
    ],
  } as never;
}

const firstSection = (model: TestEditorModel) => model.sections[0];
const payloadSection = (model: TestEditorModel) => mapEditorSectionsToPayload(model)[0] as Record<string, unknown>;

describe("толкование темы в отображателях", () => {
  it("прочитано из ответа API и возвращено в полезной нагрузке без изменений", () => {
    const model = apiToEditorModel(apiTest({ interpretationJson: { format: "richText", text: "<p>Текст</p>" } }));
    expect(firstSection(model).interpretation).toEqual({ format: "richText", text: "<p>Текст</p>" });
    expect(payloadSection(model).interpretationJson).toEqual({ format: "richText", text: "<p>Текст</p>" });
  });

  it("пустой текст читается как ОТСУТСТВИЕ: иначе карточка звала бы это переопределением", () => {
    const model = apiToEditorModel(apiTest({ interpretationJson: { format: "plain", text: "   " } }));
    expect(firstSection(model).interpretation).toBeNull();
    expect(payloadSection(model).interpretationJson).toBeNull();
  });

  it("раздел без толкования отдаёт null — и никакого поля у участника", () => {
    const model = apiToEditorModel(apiTest());
    expect(firstSection(model).interpretation).toBeNull();
    expect(payloadSection(model).interpretationJson).toBeNull();
  });
});

describe("толкования подтем в отображателях", () => {
  const keys = {
    "Стратегия компании": { format: "plain", text: "Цели до 2030" },
    "Продукты компании": { format: "plain", text: "   " },
  };

  it("прочитаны по ключам, пустые отсеяны, форма при записи прежняя", () => {
    const model = apiToEditorModel(apiTest({ breakdownInterpretationJson: { axis: "tag", keys } }));
    expect(firstSection(model).breakdownInterpretation).toEqual({
      "Стратегия компании": { format: "plain", text: "Цели до 2030" },
    });
    expect(payloadSection(model).breakdownInterpretationJson).toEqual({
      axis: "tag",
      keys: { "Стратегия компании": { format: "plain", text: "Цели до 2030" } },
    });
  });

  it("карта из одних пустых текстов равна её отсутствию", () => {
    const model = apiToEditorModel(
      apiTest({ breakdownInterpretationJson: { axis: "tag", keys: { "Продукты компании": { text: "" } } } }),
    );
    expect(firstSection(model).breakdownInterpretation).toBeNull();
    expect(payloadSection(model).breakdownInterpretationJson).toBeNull();
  });

  it("испорченный блоб не роняет редактор, а читается как «не написано»", () => {
    const model = apiToEditorModel(apiTest({ breakdownInterpretationJson: { axis: "scale", keys: "ой" } }));
    expect(firstSection(model).breakdownInterpretation).toBeNull();
  });
});

describe("показ толкований подтем", () => {
  it("прочитан из настройки теста", () => {
    const api = {
      ...(apiTest() as unknown as Record<string, unknown>),
      breakdownDisplayJson: { visibility: "bar", basis: "points", showInterpretation: true },
    };
    expect(apiToEditorModel(api as never).runtime.breakdownDisplay?.showInterpretation).toBe(true);
  });

  it("настройка без ключа НЕ дописывает его: тест без толкований остаётся прежним", () => {
    const api = {
      ...(apiTest() as unknown as Record<string, unknown>),
      breakdownDisplayJson: { visibility: "bar", basis: "points" },
    };
    expect(apiToEditorModel(api as never).runtime.breakdownDisplay).toEqual({
      visibility: "bar",
      basis: "points",
    });
  });
});
