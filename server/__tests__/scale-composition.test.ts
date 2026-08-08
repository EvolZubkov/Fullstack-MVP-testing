/**
 * @module server/__tests__/scale-composition
 *
 * PRD-46 §5. Адаптер «строки БД → предикат»: перевод `scaleId` в ключ шкалы, типы вопросов и
 * бюджеты распределения. Сам предикат покрыт отдельно; здесь проверяется именно перевод и
 * дешёвые отказы, ради которых он вызывается только в режиме «авто».
 */
import { describe, expect, it } from "vitest";
import { isTestIpsative, type CompositionQuestion } from "../services/scale-composition";
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
