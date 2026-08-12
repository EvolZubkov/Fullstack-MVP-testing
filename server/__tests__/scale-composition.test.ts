/**
 * @module server/__tests__/scale-composition
 *
 * PRD-46 §5. Адаптер «строки БД → предикат»: перевод `scaleId` в ключ шкалы, типы вопросов и
 * бюджеты распределения. Сам предикат покрыт отдельно; здесь проверяется именно перевод и
 * дешёвые отказы, ради которых он вызывается только в режиме «авто».
 */
import { describe, expect, it, vi } from "vitest";
import {
  ipsativeScalesForDelivery,
  isTestIpsative,
  type CompositionQuestion,
} from "../services/scale-composition";
import type { QuestionMeasurement, Scale } from "@shared/schema";

const SCALE_KEYS = ["cel", "vdo", "kom", "pro"];

const scales = SCALE_KEYS.map((key, i) => ({ id: `sc-${i}`, key }) as unknown as Scale);

/** Четыре варианта блока кормят четыре шкалы один к одному — устройство ЧИЛ. */
function block(questionId: string): QuestionMeasurement[] {
  return SCALE_KEYS.map((_key, index) => ({
    questionId,
    scaleId: `sc-${index}`,
    sourceType: "option_allocation",
    sourceKey: String(index),
    valueJson: 1,
    weight: 1,
  }) as unknown as QuestionMeasurement);
}

const questions: CompositionQuestion[] = ["q1", "q2"].map((id) => ({
  id,
  type: "allocation",
  dataJson: { options: ["a", "b", "c", "d"], budget: 7 },
}));

const measurements = [...block("q1"), ...block("q2")];

describe("isTestIpsative", () => {
  it("признаёт устройство ЧИЛ, переводя scaleId в ключ шкалы", () => {
    expect(isTestIpsative({ scales, scaleKeys: SCALE_KEYS, measurements, questions })).toBe(true);
  });

  it("отвергает, когда шкала спрятана и её вариант перестал кормить кого-либо", () => {
    // Автор скрыл «Процессного»: доля, отданная его варианту, уходит из профиля,
    // и сумма показанных шкал перестаёт быть постоянной.
    expect(
      isTestIpsative({ scales, scaleKeys: SCALE_KEYS.slice(0, 3), measurements, questions }),
    ).toBe(false);
  });

  it("отвергает вопрос не того типа: бюджета у него нет", () => {
    const single = questions.map((q) => ({ ...q, type: "single" }));
    expect(isTestIpsative({ scales, scaleKeys: SCALE_KEYS, measurements, questions: single })).toBe(false);
  });

  it("отвечает без работы, когда шкал меньше двух или вкладов нет вовсе", () => {
    expect(isTestIpsative({ scales, scaleKeys: ["cel"], measurements, questions })).toBe(false);
    expect(isTestIpsative({ scales, scaleKeys: SCALE_KEYS, measurements: [], questions })).toBe(false);
  });

  it("не спотыкается о вклад осиротевшей шкалы", () => {
    const orphan = [
      ...measurements,
      { questionId: "q1", scaleId: "sc-нет", sourceType: "option_allocation", sourceKey: "0", valueJson: 1, weight: 1 } as unknown as QuestionMeasurement,
    ];
    expect(isTestIpsative({ scales, scaleKeys: SCALE_KEYS, measurements: orphan, questions })).toBe(true);
  });
});

describe("ipsativeScalesForDelivery", () => {
  const visible = SCALE_KEYS.map((key, i) => ({
    id: `sc-${i}`,
    key,
    learnerVisibility: "level_and_value",
  }) as unknown as Scale);

  function source() {
    return {
      getQuestionMeasurements: vi.fn(async () => [...block("q1"), ...block("q2")]),
      getTestSections: vi.fn(async () => [{ topicId: "tp1" }] as never),
      getQuestionsByTopic: vi.fn(async () => questions as never),
    };
  }

  it("при выборе «авто» отвечает по модели вкладов", async () => {
    const src = source();
    await expect(
      ipsativeScalesForDelivery(src, "t1", visible, { scalesChartKind: "auto" }),
    ).resolves.toBe(true);
  });

  it("скрытая шкала выводит модель из ипсативных", async () => {
    const hidden = visible.map((s, i) =>
      (i === 3 ? { ...s, learnerVisibility: "hidden" } : s) as Scale);
    await expect(
      ipsativeScalesForDelivery(source(), "t1", hidden, { scalesChartKind: "auto" }),
    ).resolves.toBe(false);
  });

  it("при явном виде диаграммы не читает НИЧЕГО — ответ ничего не изменит", async () => {
    // Ради этого guard'а вычисление и оставлено «на лету»: экран итогов рисуется на
    // каждый заход, а платят за ответ только те тесты, чей автор попросил систему решить.
    for (const settings of [{ scalesChartKind: "rose" as const }, { showCompetencyRadar: true }, {}]) {
      const src = source();
      await expect(ipsativeScalesForDelivery(src, "t1", visible, settings)).resolves.toBe(false);
      expect(src.getQuestionMeasurements).not.toHaveBeenCalled();
      expect(src.getTestSections).not.toHaveBeenCalled();
    }
  });

  it("считает признак, когда «авто» стоит ТОЛЬКО в отчёте (PRD-47 §4.3)", async () => {
    // Экран называет вид явно, отчёт оставлен на «авто». Без признака отчёт нарисует
    // радар на ипсативной методике — расхождение двух документов одного продукта.
    // Считать при генерации отчёта нельзя: в пакете он собирается на клиенте из
    // запечённых данных, читать оттуда нечем.
    await expect(
      ipsativeScalesForDelivery(source(), "t1", visible, { scalesChartKind: "rose" }, { scalesChartKind: "auto" }),
    ).resolves.toBe(true);
  });

  it("не читает ничего, когда «авто» нет ни на экране, ни в отчёте", async () => {
    const src = source();
    await expect(
      ipsativeScalesForDelivery(src, "t1", visible, { scalesChartKind: "rose" }, { scalesChartKind: "radar" }),
    ).resolves.toBe(false);
    expect(src.getQuestionMeasurements).not.toHaveBeenCalled();
  });

  it("не читает вопросы, когда показанных шкал меньше двух", async () => {
    const src = source();
    await expect(
      ipsativeScalesForDelivery(src, "t1", visible.slice(0, 1), { scalesChartKind: "auto" }),
    ).resolves.toBe(false);
    expect(src.getTestSections).not.toHaveBeenCalled();
  });
});
