/**
 * @module tests/results-render-measures
 *
 * PRD-29 Task 8b: the measurement blocks reach the results screen on the WEB host.
 *
 * The chain is `routes/attempts` -> `readResultsRenderPayload` -> `buildResultContext`.
 * These tests lock the middle link: the payload reader accepts a measures source,
 * fills it with the values of the SAVED attempt result and with the design params it
 * resolved ONCE for the layout, and hands it to the context builder. A test with no
 * scales and no indicators must keep exactly the context it has always produced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import { readResultsRenderPayload } from "../server/services/template-render";

const DIR = "server/scorm/templates/default";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getAttempt: vi.fn(),
    getTest: vi.fn(),
    // PRD-31 добавил обращение к назначению в тот же маршрут; без заглушки он падает
    // на несуществующем методе ещё до кода, который проверяет этот файл.
    getCurrentAssignmentId: vi.fn().mockResolvedValue(null),
    getSnapshot: vi.fn(),
    getAttemptsByUserAndTest: vi.fn().mockResolvedValue([]),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["learner"]),
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getContentPages: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
// The route resolves template directories through the db; the layout itself is read
// from the real «Стандартный» template, so the assertions run against real markup.
vi.mock("../server/services/template-dir", () => ({
  resolveSystemScreenDir: vi.fn().mockResolvedValue("server/scorm/templates/default"),
  resolveTemplateDir: vi.fn().mockResolvedValue("server/scorm/templates/default"),
}));

const RESULT = {
  overallPassed: false,
  overallPercent: 0,
  totalQuestions: 22,
  totalCorrect: 0,
  totalEarnedPoints: 0,
  totalPossiblePoints: 0,
  topicResults: [],
  scaleResults: { ee: { raw: 27, normalized: 27, percent: 0, level: "high", label: "Высокий", hasValue: true } },
  resultVariables: {},
} as never;

const MEASURES = {
  scales: [
    {
      key: "ee",
      label: "Эмоциональное истощение",
      learnerVisibility: "level_and_value",
      sortOrder: 0,
      configJson: {
        domainMin: 0,
        domainMax: 45,
        valence: "lower_is_better",
        bands: [
          { min: 0, max: 24, level: "low", label: "Низкий" },
          { min: 25, max: 45, level: "high", label: "Высокий", text: "Ресурс расходуется быстрее." },
        ],
      },
    },
  ],
  variables: [],
  params: {},
  blockSettings: {},
  hasPassThreshold: false,
  testFeedback: null,
} as never;

describe("readResultsRenderPayload + измерения", () => {
  it("без измерений контекст не получает новых полей", () => {
    const payload = readResultsRenderPayload(DIR, RESULT, "Маслач");
    expect(payload).not.toBeNull();
    expect((payload!.context.result as Record<string, unknown>).scales).toBeUndefined();
  });

  it("с измерениями кладёт шкалу в контекст", () => {
    const payload = readResultsRenderPayload(DIR, RESULT, "Маслач", null, undefined, undefined, MEASURES);
    const scales = (payload!.context.result as { scales?: Array<{ levelLabel: string; valueText: string }> }).scales;
    expect(scales).toHaveLength(1);
    expect(scales![0].levelLabel).toBe("Высокий");
    expect(scales![0].valueText).toBe("27");
  });

  it("скрытая шкала в контекст не попадает", () => {
    const hidden = { ...MEASURES, scales: [{ ...MEASURES.scales[0], learnerVisibility: "hidden" }] };
    const payload = readResultsRenderPayload(DIR, RESULT, "Маслач", null, undefined, undefined, hidden as never);
    expect((payload!.context.result as Record<string, unknown>).scales).toBeUndefined();
  });

  it("вид шкалы берётся из разрешённых параметров дизайна, а не из второго расчёта", () => {
    const design = { params: { scaleRenderKind: "value_of_max" } };
    const payload = readResultsRenderPayload(DIR, RESULT, "Маслач", design, undefined, undefined, MEASURES);
    const scales = (payload!.context.result as { scales?: Array<{ renderKind: string }> }).scales;
    expect(scales![0].renderKind).toBe("value_of_max");
  });

  it("адаптивный результат измерений не получает", () => {
    const adaptive = { ...(RESULT as object), mode: "adaptive", topicResults: [] } as never;
    const payload = readResultsRenderPayload(DIR, adaptive, "Маслач", null, undefined, undefined, MEASURES);
    expect((payload!.context.result as Record<string, unknown>).scales).toBeUndefined();
  });

  it("материал обратной связи ТЕСТА доезжает до блока рекомендаций и получает адрес", () => {
    const withFeedback = {
      ...MEASURES,
      testFeedback: {
        format: "plain",
        text: "Опросник носит справочный характер.",
        links: [{ title: "Курс", url: "https://e/x" }],
        events: [{ title: "Вебинар" }],
        assets: [{ title: "Памятка.pdf", fileName: "p.pdf", mimeType: "application/pdf", scormHref: "/uploads/p.pdf" }],
      },
    };
    const payload = readResultsRenderPayload(DIR, RESULT, "Маслач", null, undefined, undefined, withFeedback as never);
    const recommendations = (payload!.context.result as {
      recommendations?: {
        texts: string[];
        links: Array<{ title: string; url?: string }>;
        events: Array<{ title: string }>;
        assets: Array<{ title: string; url?: string }>;
      };
    }).recommendations;
    expect(recommendations!.texts).toContain("Опросник носит справочный характер.");
    expect(recommendations!.links).toEqual([{ title: "Курс", url: "https://e/x" }]);
    expect(recommendations!.events).toEqual([{ title: "Вебинар" }]);
    expect(recommendations!.assets).toEqual([{ title: "Памятка.pdf", url: "/uploads/p.pdf" }]);
  });

  it("обратная связь ТЕСТА доезжает и БЕЗ шкал и показателей (дефект Д-3)", () => {
    // Самая массовая конфигурация продукта: контрольный тест без измерений. Обратная
    // связь теста собиралась внутри ветки измерений, поэтому такой тест не получал
    // блока рекомендаций вовсе — хотя обратная связь в нём существует ровно затем,
    // чтобы её показали.
    const plain = {
      ...MEASURES,
      scales: [],
      variables: [],
      testFeedback: {
        format: "plain",
        text: "Спасибо за участие.",
        links: [],
        events: [],
        assets: [
          { title: "Памятка.pdf", fileName: "p.pdf", mimeType: "application/pdf", url: "/api/media/aaaa" },
        ],
      },
    };
    const payload = readResultsRenderPayload(DIR, RESULT, "Опрос", null, undefined, undefined, plain as never);
    const result = payload!.context.result as {
      scales?: unknown;
      recommendations?: { texts: string[]; assets: Array<{ title: string; url?: string }> };
    };
    // Карточек измерений нет — тест их не объявляет; блок рекомендаций есть.
    expect(result.scales).toBeUndefined();
    expect(result.recommendations!.texts).toEqual(["Спасибо за участие."]);
    expect(result.recommendations!.assets).toEqual([{ title: "Памятка.pdf", url: "/api/media/aaaa" }]);
  });
});

// ─── Маршрут: источник строк (PRD-15 block B) ────────────────────────────────

import attemptsRouter from "../server/routes/attempts";

const app = express();
app.use(express.json());
app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
app.use((req: any, _res: any, next: any) => {
  req.session.userId = "learner1";
  next();
});
app.use("/api", attemptsRouter);

/** One scale row; only the interpretation label differs between live and frozen. */
function scaleRow(label: string) {
  return {
    id: "s1",
    testId: "test1",
    key: "ee",
    label: "Эмоциональное истощение",
    learnerVisibility: "level_and_value",
    sortOrder: 0,
    aggregation: "sum",
    normalization: "none",
    direction: "positive",
    configJson: {
      domainMin: 0,
      domainMax: 45,
      valence: "lower_is_better",
      bands: [
        { min: 0, max: 24, level: "low", label: "Низкий" },
        { min: 25, max: 45, level: "high", label },
      ],
    },
  };
}

const liveTest = {
  id: "test1",
  title: "Маслач",
  mode: "standard",
  status: "published",
  maxAttempts: null,
  designSettingsJson: { templateId: "default", params: {} },
  overallPassRuleJson: { type: "none", value: 0 },
  feedbackJson: null,
  createdAt: new Date(),
};

const attempt = {
  id: "atmp1",
  userId: "learner1",
  testId: "test1",
  snapshotId: "snap1",
  variantJson: { sections: [] },
  answersJson: {},
  resultJson: {
    mode: "standard",
    totalCorrect: 0,
    totalQuestions: 22,
    overallPercent: 0,
    totalEarnedPoints: 0,
    totalPossiblePoints: 0,
    overallPassed: false,
    topicResults: [],
    scaleResults: { ee: { raw: 27, normalized: 27, percent: 60, level: "high", label: "x", hasValue: true } },
    resultVariables: {},
  },
  startedAt: new Date(),
  finishedAt: new Date(),
  testVersion: 1,
};

/** Frozen deliverable: the interpretation as it was at publication. */
const snapshot = {
  id: "snap1",
  contentJson: {
    test: { ...liveTest, feedbackJson: null },
    sections: [],
    topics: [],
    questionsByTopic: {},
    topicCoursesByTopic: {},
    topicEventsByTopic: {},
    adaptiveSettings: [],
    adaptiveLevels: [],
    adaptiveLevelLinksByLevel: {},
    scales: [scaleRow("Замороженный")],
    measurements: [],
    resultVariables: [],
    contentPages: [],
    questionScoring: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue({ id: "learner1", name: "Ученик" });
  storageMock.getUserRoles.mockResolvedValue(["learner"]);
  storageMock.getTest.mockResolvedValue(liveTest);
  storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
  storageMock.getAttempt.mockResolvedValue(attempt);
  storageMock.getSnapshot.mockResolvedValue(snapshot);
  // Живые строки автор уже поправил — попытка их видеть не должна.
  storageMock.getScales.mockResolvedValue([scaleRow("Правленый сегодня")]);
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.getContentPages.mockResolvedValue([]);
});

describe("GET /attempts/:id/result — источник толкований", () => {
  it("попытка на снимке берёт толкование ИЗ СНИМКА, а не из живых строк", async () => {
    const res = await request(app).get("/api/attempts/atmp1/result");
    expect(res.status).toBe(200);
    const scales = res.body.render?.context?.result?.scales;
    expect(scales).toHaveLength(1);
    expect(scales[0].levelLabel).toBe("Замороженный");
  });

  it("попытка без снимка берёт живые строки", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...attempt, snapshotId: null });
    const res = await request(app).get("/api/attempts/atmp1/result");
    expect(res.status).toBe(200);
    expect(res.body.render.context.result.scales[0].levelLabel).toBe("Правленый сегодня");
    expect(storageMock.getSnapshot).not.toHaveBeenCalled();
  });

  it("тест без шкал и показателей контекста не меняет", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...attempt, snapshotId: null });
    storageMock.getScales.mockResolvedValue([]);
    const res = await request(app).get("/api/attempts/atmp1/result");
    expect(res.status).toBe(200);
    expect(res.body.render.context.result.scales).toBeUndefined();
    expect(res.body.render.context.result.showScoreSummary).toBeUndefined();
  });

  it("тест БЕЗ шкал и показателей всё равно отдаёт обратную связь теста (Д-3, веб-путь)", async () => {
    // Проверка идёт через МАРШРУТ, а не через адаптер: ломалось именно здесь —
    // материал итогов не собирался вовсе, когда у теста нет измерений, и обратная
    // связь теста терялась вместе с ним ещё до сборщика контекста.
    storageMock.getAttempt.mockResolvedValue({ ...attempt, snapshotId: null });
    storageMock.getScales.mockResolvedValue([]);
    storageMock.getResultVariables.mockResolvedValue([]);
    storageMock.getTest.mockResolvedValue({
      ...liveTest,
      feedbackJson: {
        format: "plain",
        text: "Спасибо за участие.",
        links: [],
        events: [],
        assets: [
          { title: "Памятка.pdf", fileName: "p.pdf", mimeType: "application/pdf", url: "/api/media/aaaa" },
        ],
      },
    });

    const res = await request(app).get("/api/attempts/atmp1/result");

    expect(res.status).toBe(200);
    const result = res.body.render.context.result;
    expect(result.recommendations.texts).toEqual(["Спасибо за участие."]);
    expect(result.recommendations.assets).toEqual([{ title: "Памятка.pdf", url: "/api/media/aaaa" }]);
    // Карточек измерений по-прежнему нет, и ответ не несёт `measures` — клиентский
    // отчёт печатает шкалы только у теста, который их объявляет.
    expect(result.scales).toBeUndefined();
    expect(res.body.measures).toBeUndefined();
  });
});
