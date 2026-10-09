/**
 * @module tests/breakdown-adaptive
 * @description PRD-50 FR-17: разрезы считаются и в адаптивном режиме. До этой работы
 * `adaptiveResultAsStandard` их не считал, а теги адаптивных вопросов уже выпекались в
 * каждый пакет и никем не читались.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { adaptiveResultAsStandard, type AdaptiveResult } from "../shared/scoring/aggregate";
import { TEST_SCOPE, sectionScope } from "../shared/breakdown/compute";
import type { BreakdownItem } from "../shared/breakdown/types";
import { adaptiveAttemptResultSchema } from "../shared/schema";
import { buildAdaptiveResultContext } from "../shared/template/result-context";

const adaptiveSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/adaptive/adaptive.js"),
  "utf8",
);

/** Lift the package's plain-JS `adaptiveBreakdownItems` and bind it to injected globals. */
function makeAdaptiveBreakdownItems(state: unknown, testData: unknown, checkAnswer: unknown) {
  const match = adaptiveSrc.match(/function adaptiveBreakdownItems\(\)[\s\S]*?\n\}/);
  if (!match) throw new Error("adaptiveBreakdownItems not found in adaptive.js");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    "state", "TEST_DATA", "checkAnswer",
    `${match[0]}\n;return adaptiveBreakdownItems;`,
  )(state, testData, checkAnswer) as () => unknown[];
}

const topic = (topicId: string, answered: number, correct: number) => ({
  topicId,
  topicName: topicId,
  achievedLevelIndex: 0,
  achievedLevelName: "Базовый",
  levelPercent: 100,
  totalQuestionsAnswered: answered,
  totalCorrect: correct,
  levelsAttempted: [],
  feedback: null,
  recommendedLinks: [],
});

const result = {
  mode: "adaptive" as const,
  overallPassed: true,
  topicResults: [topic("law", 2, 1), topic("sec", 1, 1)],
} as AdaptiveResult;

const item = (sectionId: string, tags: string[], earned: number): BreakdownItem => ({
  sectionId, axisKeys: { tag: tags }, earned, possible: 1, answered: true,
});

describe("adaptiveResultAsStandard + разрезы", () => {
  it("без элементов даёт пустые списки и прежний пересказ (обратная совместимость)", () => {
    const flat = adaptiveResultAsStandard(result);
    expect(flat.breakdowns).toEqual([]);
    expect(flat.topicResults.map((t) => t.breakdown)).toEqual([[], []]);
    expect(flat.percent).toBe((2 / 3) * 100);
  });

  it("кладёт записи раздела на тему, записи теста — в результат", () => {
    const flat = adaptiveResultAsStandard(result, [
      item("law", ["ПДн"], 1),
      item("law", ["ПДн"], 0),
      item("sec", ["ПДн"], 1),
    ]);
    expect(flat.topicResults[0].breakdown).toEqual([
      expect.objectContaining({ scope: sectionScope("law"), key: "ПДн", items: 2, percentUnits: 50 }),
    ]);
    expect(flat.topicResults[1].breakdown).toEqual([
      expect.objectContaining({ scope: sectionScope("sec"), key: "ПДн", items: 1, percentUnits: 100 }),
    ]);
    expect(flat.breakdowns).toEqual([
      expect.objectContaining({ scope: TEST_SCOPE, key: "ПДн", items: 3, percentUnits: (2 / 3) * 100 }),
    ]);
  });

  it("тема без единого тега получает пустой список, а не отсутствующее поле", () => {
    const flat = adaptiveResultAsStandard(result, [item("law", ["ПДн"], 1)]);
    expect(flat.topicResults[1].breakdown).toEqual([]);
  });
});

/**
 * PRD-50 §16: у ступени адаптивной лестницы порога нет и быть не может, поэтому подтемы
 * адаптивного теста судит ОБЩИЙ порог теста — и сводные записи, и записи области раздела.
 */
describe("адаптив судит подтемы общим порогом теста (§16)", () => {
  const gateItems = [
    item("law", ["Охрана труда"], 1),
    item("law", ["Охрана труда"], 0),
    item("sec", ["Пожарная безопасность"], 1),
  ];

  it("PRD-50 §16: адаптив судит подтемы общим порогом теста", () => {
    const out = adaptiveResultAsStandard(result, gateItems, { type: "percent", value: 70 });
    const low = out.breakdowns.find((e) => e.key === "Охрана труда");
    expect(low?.passed).toBe(false);
    expect(low?.thresholdPercent).toBe(70);
    expect(out.topicResults[0].breakdown.some((e) => e.passed === false)).toBe(true);
  });

  it("PRD-50 §16: без общего порога подтемы адаптива молчат", () => {
    const out = adaptiveResultAsStandard(result, gateItems, { type: "none" });
    for (const e of out.breakdowns) expect(e.passed).toBeNull();
    for (const t of out.topicResults) for (const e of t.breakdown) expect(e.passed).toBeNull();
  });

  it("правило в БАЛЛАХ переводится в долю от выданных вопросов", () => {
    // Балл адаптива — один за вопрос, поэтому достижимое равно числу выданных вопросов (3):
    // порог «2 балла» = 66.7 %, и подтема с 50 % его не берёт.
    const out = adaptiveResultAsStandard(result, gateItems, { type: "absolute", value: 2 });
    const low = out.breakdowns.find((e) => e.key === "Охрана труда");
    expect(low?.passed).toBe(false);
    expect(low?.thresholdPercent).toBeCloseTo((2 / 3) * 100, 6);
    expect(out.breakdowns.find((e) => e.key === "Пожарная безопасность")?.passed).toBe(true);
  });

  it("без третьего аргумента исход не выносится (обратная совместимость)", () => {
    const out = adaptiveResultAsStandard(result, gateItems);
    for (const e of out.breakdowns) expect(e.passed).toBeNull();
  });
});

describe("хранение адаптивного результата", () => {
  const topicRow = {
    topicId: "law", topicName: "Право", achievedLevelIndex: 0, achievedLevelName: "Базовый",
    levelPercent: 100, totalQuestionsAnswered: 2, totalCorrect: 1, levelsAttempted: [],
    feedback: null, recommendedLinks: [],
  };
  const entry = {
    scope: "section:law", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1,
    possible: 2, unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50,
  };

  it("тема несёт свои записи, результат — записи области теста", () => {
    const parsed = adaptiveAttemptResultSchema.parse({
      mode: "adaptive", overallPassed: true,
      topicResults: [{ ...topicRow, breakdown: [entry] }],
      breakdowns: [{ ...entry, scope: "test" }],
    });
    expect(parsed.topicResults[0].breakdown).toHaveLength(1);
    expect(parsed.breakdowns).toHaveLength(1);
  });

  it("адаптивная попытка, завершённая до этой работы, остаётся валидной", () => {
    const parsed = adaptiveAttemptResultSchema.parse({
      mode: "adaptive", overallPassed: true, topicResults: [topicRow],
    });
    expect(parsed.topicResults[0].breakdown).toEqual([]);
    expect(parsed.breakdowns).toBeUndefined();
  });
});

describe("рантайм пакета: сборка элементов адаптивного разреза", () => {
  const state = {
    answers: { q1: 0, q2: 1, q3: 0 },
    adaptiveState: {
      topics: [
        { topicId: "law", levelsState: [{ answeredQuestionIds: ["q1", "q2"] }] },
        { topicId: "sec", levelsState: [{ answeredQuestionIds: ["q3"] }] },
      ],
    },
  };
  const TEST_DATA = {
    adaptiveTopics: [
      { topicId: "law", questions: [
        { id: "q1", tags: ["ПДн"], correct: { correctIndex: 0 } },
        { id: "q2", tags: ["ПДн"], correct: { correctIndex: 0 } },
      ] },
      { topicId: "sec", questions: [{ id: "q3", correct: { correctIndex: 0 } }] },
    ],
  };
  const checkAnswer = (q: any, a: unknown) => (a === q.correct.correctIndex ? 1 : 0);

  it("берёт только вопросы с тегами и даёт им цену в один балл", () => {
    const items = makeAdaptiveBreakdownItems(state, TEST_DATA, checkAnswer)();
    expect(items).toEqual([
      { sectionId: "law", axisKeys: { tag: ["ПДн"] }, earned: 1, possible: 1, answered: true },
      { sectionId: "law", axisKeys: { tag: ["ПДн"] }, earned: 0, possible: 1, answered: true },
    ]);
  });

  it("даёт те же записи, что и веб-хост на тех же данных", () => {
    const items = makeAdaptiveBreakdownItems(state, TEST_DATA, checkAnswer)();
    const flat = adaptiveResultAsStandard(result, items as never);
    expect(flat.topicResults[0].breakdown[0]).toMatchObject({ items: 2, percentUnits: 50 });
  });
});

/**
 * PRD-50 FR-28, Э5: сводный блок на АДАПТИВНОМ экране.
 *
 * Записи считались и хранились с FR-17/FR-39, но до этого этапа их никто не читал
 * обратно: посчитанное молча не показывалось. Разрез РАЗДЕЛА сюда сознательно не
 * приходит — карточка адаптивной темы говорит подтверждённым УРОВНЕМ, и полоса
 * процентов рядом с «Уровень 2» предлагала бы смысл, которого у лестницы нет.
 */
describe("сводный блок разреза на адаптивном экране итогов", () => {
  const entry = (key: string, percentUnits: number) => ({
    scope: TEST_SCOPE,
    axis: "tag" as const,
    key,
    items: 4,
    answered: 4,
    earned: percentUnits / 25,
    possible: 4,
    percentUnits,
    percentPoints: percentUnits,
  });

  const adaptiveInput = {
    passed: true,
    topicResults: [
      { topicName: "Право", achievedLevelIndex: 0, achievedLevelName: "Базовый" },
    ],
    breakdowns: [entry("ПДн", 75), entry("Крипто", 25)],
  };

  const display = { visibility: "bar_and_value" as const, basis: "units" as const, placement: "block" as const };

  it("печатает строки и объявляет подблок, когда автор включил сводный блок", () => {
    const ctx = buildAdaptiveResultContext(adaptiveInput, "Адаптивный", {
      breakdownDisplay: display,
      templateBlockOrder: ["topics", "scales", "indicators", "breakdown"],
    });
    expect(ctx.result.breakdown?.map((r) => [r.key, r.barPercent, r.valueLabel])).toEqual([
      ["ПДн", 75, "75 %"],
      ["Крипто", 25, "25 %"],
    ]);
    const block = ctx.result.blocks?.find((b) => b.key === "breakdown");
    expect(block?.isBreakdown).toBe(true);
    // Подблок стоит последним — тот же порядок, что объявляет манифест этого экрана.
    expect(ctx.result.blocks?.map((b) => b.key)).toEqual(["topics", "breakdown"]);
  });

  it("молчит, пока автор просит полосы только в карточках тем", () => {
    const ctx = buildAdaptiveResultContext(adaptiveInput, "Адаптивный", {
      breakdownDisplay: { ...display, placement: "topics" },
      templateBlockOrder: ["topics", "scales", "indicators", "breakdown"],
    });
    expect(ctx.result.breakdown).toBeUndefined();
    expect(ctx.result.blocks?.map((b) => b.key)).toEqual(["topics"]);
  });

  it("без настройки показа контекст остаётся ровно прежним", () => {
    const ctx = buildAdaptiveResultContext(adaptiveInput, "Адаптивный", {
      templateBlockOrder: ["topics", "scales", "indicators", "breakdown"],
    });
    expect(ctx.result.breakdown).toBeUndefined();
  });

  it("попытка без записей не даёт пустого блока", () => {
    const ctx = buildAdaptiveResultContext(
      { ...adaptiveInput, breakdowns: [] },
      "Адаптивный",
      { breakdownDisplay: display, templateBlockOrder: ["topics", "scales", "indicators", "breakdown"] },
    );
    expect(ctx.result.breakdown).toBeUndefined();
    expect(ctx.result.blocks?.map((b) => b.key)).toEqual(["topics"]);
  });

  it("карточка адаптивной темы полос не несёт — там подтверждённый уровень", () => {
    const ctx = buildAdaptiveResultContext(adaptiveInput, "Адаптивный", {
      breakdownDisplay: display,
      templateBlockOrder: ["topics", "scales", "indicators", "breakdown"],
    });
    expect(ctx.result.topicResults?.[0]).not.toHaveProperty("breakdown");
  });

  it("строка разреза СЛОВА не несёт, а заголовок блока берётся из словаря", () => {
    // PRD-50 §16: исход у строки есть, но выражен классом, а не словом — `statusLabel` в
    // ней не появляется. Адаптивный экран порогов подтем не штампует, поэтому исход пустой.
    const ctx = buildAdaptiveResultContext(
      { ...adaptiveInput, breakdowns: [entry("ПДн", 75)] },
      "Адаптивный",
      {
        breakdownDisplay: display,
        templateBlockOrder: ["topics", "scales", "indicators", "breakdown"],
        labels: { "topic.verdict.failed": "Не зачтено", "results.breakdown": "Разрез результата" },
      },
    );
    const row = ctx.result.breakdown?.[0] as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect("statusLabel" in row!).toBe(false);
    expect(row!.passed).toBeNull();
    expect(row!.passClass).toBe("");
    expect(ctx.result.blocks?.find((b) => b.key === "breakdown")?.heading).toBe("Разрез результата");
  });
});

/**
 * PRD-50 §16 / FR-55: тексты подтем на АДАПТИВНОМ экране итогов.
 *
 * Отбор один на оба режима — общий построитель читает исход записи, — но записи раздела
 * должны до него доехать: без них адаптивный экран молчал бы, сколько бы автор ни написал.
 */
describe("тексты подтем на адаптивном экране итогов", () => {
  const sectionEntry = (key: string, passed: boolean | null) => ({
    scope: sectionScope("law"),
    axis: "tag" as const,
    key,
    items: 2,
    answered: 2,
    earned: 1,
    possible: 2,
    percentPoints: 50,
    percentUnits: 50,
    passed,
    thresholdPercent: passed === null ? null : 70,
  });

  const topicInput = (passed: boolean | null) => ({
    passed: true,
    topicResults: [
      {
        topicName: "Право",
        achievedLevelIndex: 0,
        achievedLevelName: "Базовый",
        breakdown: [sectionEntry("Охрана труда", passed)],
        breakdownFeedback: { "Охрана труда": { text: "Повторите охрану труда" } },
      },
    ],
  });

  it("непройденная подтема говорит даже у темы с подтверждённым уровнем", () => {
    const ctx = buildAdaptiveResultContext(topicInput(false) as never, "Адаптивный", {} as never);
    expect(ctx.result.recommendations?.texts).toEqual(["Повторите охрану труда"]);
  });

  it("взятая подтема и запись без исхода молчат", () => {
    expect(
      buildAdaptiveResultContext(topicInput(true) as never, "Адаптивный", {} as never)
        .result.recommendations?.texts ?? [],
    ).toEqual([]);
    expect(
      buildAdaptiveResultContext(topicInput(null) as never, "Адаптивный", {} as never)
        .result.recommendations?.texts ?? [],
    ).toEqual([]);
  });
});
