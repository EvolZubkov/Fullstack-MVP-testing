/**
 * @module shared/psychometrics/__tests__/question-flag.test
 * @description Э4б: одно правило признака вопроса для сервера и клиента.
 */
import { describe, expect, it } from "vitest";

import { isSuspicious, isThin, questionFlag, suspicionRank, THIN_RANK, type FlagSource } from "../question-flag";

const row = (over: Partial<FlagSource> = {}): FlagSource => ({
  observations: 120,
  difficulty: 0.5,
  correctedDifficulty: 0.33,
  itemRest: 0.35,
  discrimination: 0.4,
  coefficientConfidence: "reliable",
  flags: { negativeDiscrimination: false, atChanceLevel: false, weakDiscrimination: false, tooHard: false, tooEasy: false },
  timingFlags: { rushed: false, slow: false },
  ...over,
});
const flags = (over: Partial<FlagSource["flags"]>) => ({ ...row().flags, ...over });

describe("questionFlag", () => {
  it("испорченный ключ — первым, с числами", () => {
    const flag = questionFlag(row({ itemRest: -0.21, discrimination: -0.14, flags: flags({ negativeDiscrimination: true, tooEasy: true }) }));
    expect(flag).toEqual({ tone: "error", title: "Сильные ошибаются чаще", detail: "вероятна ошибка в ключе: r = −0,21, D = −0,14" });
  });

  it("эвристика ревизии стоит за прямыми дефектами и перед слабой дискриминативностью", () => {
    const heuristic = { kinds: ["fast-and-wrong"], exposurePercent: 60, correctPercent: 20, latencyMedianMs: 3_000 };
    expect(questionFlag(row({ flags: flags({ weakDiscrimination: true }) }), heuristic)?.title).toBe("Слишком быстрые ответы");
    expect(questionFlag(row({ flags: flags({ atChanceLevel: true }) }), heuristic)?.title).toBe("На уровне угадывания");
  });

  it("мало данных — признак-сведение, а не подозрение", () => {
    const thin = row({ observations: 12, coefficientConfidence: "insufficient" });
    expect(questionFlag(thin)).toMatchObject({ tone: "info", title: "Мало данных", detail: "12 из 30 · нужно ещё 18 наблюдений" });
    expect(isSuspicious(thin)).toBe(false);
    expect(isThin(thin)).toBe(true);
    expect(suspicionRank(thin)).toBe(THIN_RANK);
  });
});

describe("isSuspicious", () => {
  it("любой психометрический признак — под подозрением; без признаков — нет", () => {
    expect(isSuspicious(row({ timingFlags: { rushed: false, slow: true } }))).toBe(true);
    expect(isSuspicious(row())).toBe(false);
  });

  it("невыданный вопрос не подозрителен", () => {
    expect(isSuspicious(row({ neverDelivered: true, flags: flags({ tooHard: true }) }))).toBe(false);
  });
});
