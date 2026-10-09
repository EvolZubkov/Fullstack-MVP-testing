/**
 * @module shared/breakdown/publish-warnings.test
 * @description PRD-50 FR-45 - FR-47 и FR-56: ловушки выдачи и настройки, о которых автор
 * узнаёт при публикации. Предупреждения, а не запреты: публикация проходит в любом случае.
 */
import { describe, it, expect } from "vitest";
import { checkBreakdownPublish, type BreakdownPublishSection } from "./publish-warnings";

const section = (over: Partial<BreakdownPublishSection> = {}): BreakdownPublishSection => ({
  topicId: "law",
  topicName: "Право",
  drawCount: 3,
  drawAll: false,
  blueprint: null,
  variants: null,
  questions: [
    { id: "q1", tags: ["ПДн"] },
    { id: "q2", tags: ["ПДн"] },
    { id: "q3", tags: ["Коррупция"] },
  ],
  ...over,
});

const codes = (sections: BreakdownPublishSection[]) =>
  checkBreakdownPublish({ sections }).map((w) => w.code);

describe("checkBreakdownPublish", () => {
  it("молчит о разделе без ключей и без порогов", () => {
    expect(checkBreakdownPublish({ sections: [section()] })).toEqual([]);
  });

  it("сумма квот не равна выборке раздела (FR-45)", () => {
    const out = checkBreakdownPublish({ sections: [
      section({ blueprint: { strata: [{ tag: "ПДн", count: 1 }] }, drawCount: 3 }),
    ] });
    expect(out[0]).toMatchObject({ code: "quota_sum_mismatch", count: 1, total: 3 });
  });

  it("есть вопросы без ключа, когда ключи в игре (FR-45)", () => {
    const out = checkBreakdownPublish({ sections: [
      section({
        blueprint: { strata: [{ tag: "ПДн", count: 2 }, { tag: "Коррупция", count: 1 }] },
        questions: [
          { id: "q1", tags: ["ПДн"] },
          { id: "q2", tags: ["ПДн"] },
          { id: "q3", tags: ["Коррупция"] },
          { id: "q4", tags: [] },
        ],
      }),
    ] });
    expect(out.map((w) => w.code)).toContain("questions_without_key");
    expect(out.find((w) => w.code === "questions_without_key")!.count).toBe(1);
  });

  it("FR-56: гейт включён при скрытых подытогах — предупреждение", () => {
    const out = checkBreakdownPublish({
      sections: [section()],
      breakdownGateEnabled: true,
      breakdownVisible: false,
    });
    expect(out.map((w) => w.code)).toContain("gate_without_display");
    // Правило уровня ТЕСТА: темы у него нет, и читателю не за что зацепиться в списке тем.
    expect(out.find((w) => w.code === "gate_without_display")).toMatchObject({
      topicId: null,
      topicName: null,
    });
  });

  it("FR-56: гейт включён и подытоги видны — молчание", () => {
    const out = checkBreakdownPublish({
      sections: [section()],
      breakdownGateEnabled: true,
      breakdownVisible: true,
    });
    expect(out.map((w) => w.code)).not.toContain("gate_without_display");
  });

  it("FR-56: гейт выключен — о скрытых подытогах не говорим", () => {
    const out = checkBreakdownPublish({ sections: [section()], breakdownVisible: false });
    expect(out.map((w) => w.code)).not.toContain("gate_without_display");
  });

  it("вопрос не входит ни в один вариант (FR-47)", () => {
    const out = checkBreakdownPublish({ sections: [
      section({
        variants: [{ id: "f1", label: "Вариант 1", questionIds: ["q1", "q2"] }],
      }),
    ] });
    expect(out.find((w) => w.code === "question_outside_variants")!.count).toBe(1);
  });

  it("заданы и квоты, и варианты — квоты не применяются (FR-47)", () => {
    const out = codes([
      section({
        blueprint: { strata: [{ tag: "ПДн", count: 2 }] },
        variants: [
          { id: "f1", label: "Вариант 1", questionIds: ["q1", "q2", "q3"] },
          { id: "f2", label: "Вариант 2", questionIds: ["q1", "q2", "q3"] },
        ],
      }),
    ]);
    expect(out).toContain("quotas_ignored_in_variants");
  });
});
