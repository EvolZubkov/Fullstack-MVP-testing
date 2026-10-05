/**
 * @module tests/routes.analytics-psychometrics
 * @description PRD-66 FR-56 - FR-58: ручка психометрики теста.
 *
 * Расчёт проверен на движке и на сведении; здесь — то, что относится к ручке: область
 * видимости, режим попыток по умолчанию, кэш и поведение на пустой выборке.
 */
import ExcelJS from "exceljs";
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(),
    getTests: vi.fn().mockResolvedValue([]),
    getTestSections: vi.fn().mockResolvedValue([]),
    getQuestionsByTopic: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getLmsImportBatches: vi.fn().mockResolvedValue([]),
    getSlices: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([{ id: "t1", name: "Тема" }]),
    getQuestionsByIds: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    selectObservations: vi.fn().mockResolvedValue({ web: [], lms: [], order: [], total: 0 }),
    // План оргструктуры: хранящиеся написания оргполей.
    selectOrgSpellings: vi.fn().mockResolvedValue({ organization: [], unit: [], position: [] }),
    getAttemptsByIds: vi.fn().mockResolvedValue([]),
    selectAnswersForAttempts: vi.fn().mockResolvedValue([]),
    selectGroupsOfUsers: vi.fn().mockResolvedValue(new Map()),
    getSnapshot: vi.fn().mockResolvedValue(undefined),
    getScormPackages: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelsByTest: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
// Расчёт идёт настоящий; обёртка нужна одному тесту, которому признаки проще подставить, чем
// собрать выборку из тридцати участников ради порога коэффициентов.
vi.mock("../server/services/analytics/psychometrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/analytics/psychometrics")>();
  return { ...actual, computePsychometrics: vi.fn(actual.computePsychometrics) };
});

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import psychometricsRouter, {
  resetPsychometricsCache,
  testPsychometrics,
} from "../server/routes/analytics/psychometrics";
// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { computePsychometrics } from "../server/services/analytics/psychometrics";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard", version: 3,
  overallPassRuleJson: { type: "percent", value: 70 }, createdBy: "author1",
};

const TOPIC_QUESTIONS = [
  {
    id: "q1", topicId: "t1", type: "single", prompt: "Вопрос",
    dataJson: { options: ["A", "B", "C", "D"] }, correctJson: { correctIndex: 0 }, difficulty: 40,
  },
];

/** Две веб-попытки одного участника: первая верная, вторая нет. */
const ATTEMPTS = [
  {
    id: "a1", userId: "u1", testId: "test1", snapshotId: null,
    variantJson: { sections: [{ topicId: "t1", questionIds: ["q1"] }], psychoHashes: { q1: "hash-1" } },
    answersJson: { q1: 0 },
    resultJson: { overallPercent: 100, questionOutcomes: [{ questionId: "q1", result: "correct", earned: 1, possible: 1 }] },
    startedAt: new Date("2026-09-01T10:00:00Z"),
    finishedAt: new Date("2026-09-01T10:10:00Z"),
  },
  {
    id: "a2", userId: "u1", testId: "test1", snapshotId: null,
    variantJson: { sections: [{ topicId: "t1", questionIds: ["q1"] }], psychoHashes: { q1: "hash-1" } },
    answersJson: { q1: 1 },
    resultJson: { overallPercent: 0, questionOutcomes: [{ questionId: "q1", result: "incorrect", earned: 0, possible: 1 }] },
    startedAt: new Date("2026-09-05T10:00:00Z"),
    finishedAt: new Date("2026-09-05T10:10:00Z"),
  },
];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", psychometricsRouter);
  return app;
}

const ask = (query = "") =>
  request(makeApp()).get(`/api/analytics/psychometrics/test1${query}`).set("x-test-user", "a1");

beforeEach(() => {
  vi.clearAllMocks();
  // Кэш живёт в модуле и переживает отдельный тест — как и в бою между запросами.
  resetPsychometricsCache();
  storageMock.getUser.mockResolvedValue({ id: "a1", name: "Админ", email: "a@b.c" });
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTests.mockResolvedValue([TEST]);
  storageMock.getTestSections.mockResolvedValue([{ id: "s1", testId: "test1", topicId: "t1" }]);
  storageMock.getQuestionsByTopic.mockResolvedValue(TOPIC_QUESTIONS);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getLmsImportBatches.mockResolvedValue([]);
  storageMock.getSlices.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "Тема" }]);
  storageMock.getQuestionsByIds.mockResolvedValue(TOPIC_QUESTIONS);
  storageMock.getAttemptsByIds.mockResolvedValue(ATTEMPTS);
  storageMock.selectAnswersForAttempts.mockResolvedValue([]);
  storageMock.selectGroupsOfUsers.mockResolvedValue(new Map());
  storageMock.selectObservations.mockResolvedValue({
    web: ATTEMPTS,
    lms: [],
    order: ATTEMPTS.map(a => ({ id: a.id, source: "web" })),
    total: ATTEMPTS.length,
  });
});

describe("GET /analytics/psychometrics/:testId — оргусловия (FR-06b)", () => {
  it("отбирает по подразделению тем же разбором, что реестр", async () => {
    storageMock.selectOrgSpellings.mockResolvedValue({
      organization: [], unit: ["Отдел продаж", "ОТДЕЛ ПРОДАЖ"], position: [],
    });

    const res = await ask(`?unit=${encodeURIComponent("Отдел продаж")}`);

    expect(res.status).toBe(200);
    const query = storageMock.selectObservations.mock.calls[0][0];
    expect(query.orgValues).toEqual({ unit: ["Отдел продаж", "ОТДЕЛ ПРОДАЖ"] });
  });
});

describe("GET /analytics/psychometrics/:testId", () => {
  it("считает психометрику теста", async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ questionId: "q1", declaredDifficulty: 40 });
  });

  it("отдаёт порог наблюдений трудности — экран «данных мало» называет его (FR-46)", async () => {
    const res = await ask();
    expect(typeof res.body.minObservations).toBe("number");
    expect(res.body.minObservations).toBeGreaterThan(0);
  });

  describe("несопоставленные взаимодействия рядом с n (FR-11)", () => {
    const BATCHES = [
      { id: "b1", testId: "test1", groupId: "g1", rowsUnmatched: 7 },
      { id: "b2", testId: "test1", groupId: "g2", rowsUnmatched: 3 },
    ];

    it("складывает потери всех загрузок", async () => {
      storageMock.getLmsImportBatches.mockResolvedValue(BATCHES);
      const res = await ask();
      expect(res.body.unmatched).toBe(10);
    });

    it("считает только загрузки отобранных групп", async () => {
      storageMock.getLmsImportBatches.mockResolvedValue(BATCHES);
      const res = await ask("?groupId=g2");
      expect(res.body.unmatched).toBe(3);
    });

    it("без импорта в выборке потерь нет", async () => {
      storageMock.getLmsImportBatches.mockResolvedValue(BATCHES);
      const res = await ask("?source=web");
      expect(res.body.unmatched).toBe(0);
    });

    it("загрузки без записанного числа дают ноль, а не ошибку", async () => {
      // Партии, загруженные до FR-11, числа не хранят.
      storageMock.getLmsImportBatches.mockResolvedValue([{ id: "b1", testId: "test1", groupId: null }]);
      const res = await ask();
      expect(res.body.unmatched).toBe(0);
    });
  });

  describe("ключи участников, построенные разными алгоритмами (FR-43)", () => {
    /** `external_id` нашего вида: 64 шестнадцатеричных знака в нижнем регистре. */
    const OWN = (n: number) => String(n).repeat(64).slice(0, 64);

    /**
     * Выборка из прохождений LMS с заданными ключами.
     *
     * @param keys ключ участника либо пара «ключ, источник»; по умолчанию источник — импорт
     */
    function importedWith(keys: Array<string | [string, "import" | "telemetry"]>) {
      const lms = keys.map((entry, i) => {
        const [participantKey, origin] = typeof entry === "string" ? [entry, "import"] : entry;
        return {
          id: `l${i}`, packageId: null, testId: "test1", origin, userId: null,
          participantKey, groupId: null, lmsUserName: null, lmsUserId: null,
          resultPercent: null, resultPassed: null, maxPoints: null, totalPoints: null,
          startedAt: new Date("2026-09-01T10:00:00Z"), finishedAt: new Date("2026-09-01T10:00:00Z"),
        };
      });
      storageMock.selectObservations.mockResolvedValue({
        web: [], lms, order: lms.map(r => ({ id: r.id, source: r.origin })), total: lms.length,
      });
    }

    it("ключ нашего вида рядом с заведомо чужим — это смешение", async () => {
      // Чужой вид значит чужой алгоритм: один человек мог получить в двух файлах два ключа,
      // считается дважды, и число респондентов завышено — молчать об этом нельзя.
      importedWith([OWN(1), "ext-1"]);

      const res = await ask();

      expect(res.body.bias.mixedAnonymity).toBe(true);
    });

    it("файлы с колонкой external_id и без неё при одном алгоритме смешением НЕ считаются", async () => {
      // Скрипт обезличивания и импорт считают ключ одинаково (PRD-54 BR-54-22): это законное
      // сочетание, и прежний признак по флажку партии давал здесь ложную тревогу.
      importedWith([OWN(1), OWN(2)]);

      const res = await ask();

      expect(res.body.bias.mixedAnonymity).toBe(false);
    });

    it("одни чужие ключи смешением не считаются: алгоритм у них один", async () => {
      importedWith(["ext-1", "ext-2"]);

      const res = await ask();

      expect(res.body.bias.mixedAnonymity).toBe(false);
    });

    it("тот же хеш в верхнем регистре — уже чужой вид", async () => {
      // Сравнение ключей точное: `ABC…` и `abc…` — два разных участника.
      importedWith(["a".repeat(64), "A".repeat(64)]);

      const res = await ask();

      expect(res.body.bias.mixedAnonymity).toBe(true);
    });

    it("телеметрия в признаке не участвует", async () => {
      // У телеметрии своя идентичность (`learner_id`), `external_id` она не несёт.
      // Ключ нашего вида у импорта и «чужой» у телеметрии смешения не дают.
      importedWith([OWN(1), ["whatever", "telemetry"]]);

      const res = await ask();

      expect(res.body.bias.mixedAnonymity).toBe(false);
    });
  });

  it("доносит прогноз длины теста до экрана (FR-22)", async () => {
    // Движок считает его с самого Э3, но до FR-22 ручка его не отдавала, и на экране числа
    // не было вовсе. Поле обязано доезжать целиком: цель нужна, чтобы «ещё 25 заданий»
    // что-то значило.
    const res = await ask();

    expect(res.body).toHaveProperty("lengthForecast");
    if (res.body.lengthForecast !== null) {
      expect(res.body.lengthForecast.target).toBe(0.8);
    }
  });

  it("по умолчанию берёт ТОЛЬКО первую попытку участника", async () => {
    // Повторная попытка не независима: человек помнит задания. Первая — верная, значит
    // трудность равна единице; учти ручка обе, вышло бы 0,5.
    const res = await ask();

    expect(res.body.firstAttemptOnly).toBe(true);
    expect(res.body.items[0].difficulty).toBe(1);
    expect(res.body.sample.responses).toBe(1);
  });

  it("режим со всеми попытками включается явно", async () => {
    const res = await ask("?firstAttemptOnly=false");

    expect(res.body.firstAttemptOnly).toBe(false);
    expect(res.body.items[0].difficulty).toBe(0.5);
    expect(res.body.sample.responses).toBe(2);
  });

  it("называет состав выборки по источникам", async () => {
    const res = await ask();
    expect(res.body.sample.bySource).toEqual({ web: 1 });
  });

  it("на пустой выборке отвечает пустотой, а не ошибкой", async () => {
    // Скудная выборка не повод ронять экран: метрика деградирует до «недостаточно данных».
    storageMock.selectObservations.mockResolvedValue({ web: [], lms: [], order: [], total: 0 });

    const res = await ask();

    expect(res.status).toBe(200);
    // Вопрос пула остаётся строкой «ещё не выдавался» (решение владельца 2026-09-26) — но
    // числа теста от него не зависят: надёжности по-прежнему нет.
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ questionId: "q1", neverDelivered: true, observations: 0 });
    expect(res.body.reliability).toBe("too-few-items");
    expect(res.body.measurementOnly).toBe(false);
  });

  describe("вопросы пула, которых выборка не видела (решение владельца 2026-09-26)", () => {
    const Q = (id: string, over: Record<string, unknown> = {}) => ({
      ...TOPIC_QUESTIONS[0], id, prompt: `Вопрос ${id}`, ...over,
    });

    it("невыданный вопрос пула идёт строкой в конце, с пустыми числами и подписью", async () => {
      storageMock.getQuestionsByTopic.mockResolvedValue([Q("q1"), Q("q2")]);
      storageMock.getQuestionsByIds.mockImplementation(async (ids: string[]) =>
        [Q("q1"), Q("q2")].filter(q => ids.includes(q.id)));

      const res = await ask();

      expect(res.body.items.map((i: { questionId: string }) => i.questionId)).toEqual(["q1", "q2"]);
      expect(res.body.items[0].neverDelivered).toBeUndefined();
      expect(res.body.items[1]).toMatchObject({
        questionId: "q2",
        prompt: "Вопрос q2",
        topicName: "Тема",
        neverDelivered: true,
        observations: 0,
        difficulty: null,
        itemRest: null,
        discrimination: null,
        difficultyConfidence: "insufficient",
        coefficientConfidence: "insufficient",
        flags: { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false, weakDiscrimination: false },
      });
    });

    /** Строки листа книги, пришедшей файлом. */
    async function sheetOf(path: string, sheet: string): Promise<unknown[][]> {
      const res = await request(makeApp())
        .get(path)
        .set("x-test-user", "a1")
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as never);
      const rows: unknown[][] = [];
      workbook.getWorksheet(sheet)?.eachRow(row => rows.push((row.values as unknown[]).slice(1)));
      return rows;
    }

    it("психометрический отчёт перечисляет и невыданный вопрос — как экран", async () => {
      storageMock.getQuestionsByTopic.mockResolvedValue([Q("q1"), Q("q2")]);
      storageMock.getQuestionsByIds.mockImplementation(async (ids: string[]) =>
        [Q("q1"), Q("q2")].filter(q => ids.includes(q.id)));

      const rows = await sheetOf("/api/analytics/psychometrics/test1/export", "Вопросы");
      const q2 = rows.find(row => row[0] === "q2");

      expect(q2).toBeTruthy();
      expect(q2![1]).toBe("Вопрос q2");
      expect(q2![2]).toBe(0);
      expect(String(q2![q2!.length - 1])).toContain("вопрос ещё не выдавался");
    });

    it("матрица ответов колонку невыданному вопросу не заводит", async () => {
      storageMock.getQuestionsByTopic.mockResolvedValue([Q("q1"), Q("q2")]);
      storageMock.getQuestionsByIds.mockImplementation(async (ids: string[]) =>
        [Q("q1"), Q("q2")].filter(q => ids.includes(q.id)));

      const rows = await sheetOf("/api/analytics/psychometrics/test1/matrix", "Матрица ответов");
      const header = rows.find(row => row[0] === "Респондент");

      expect(header).toContain("q1");
      expect(header).not.toContain("q2");
    });

    it("исключённый из выдачи вопрос в пул не входит", async () => {
      storageMock.getQuestionsByTopic.mockResolvedValue([Q("q1"), Q("q2")]);
      storageMock.getTestQuestionScoring.mockResolvedValue([
        { testId: "test1", questionId: "q2", excludedFromDelivery: true },
      ]);

      const res = await ask();

      expect(res.body.items.map((i: { questionId: string }) => i.questionId)).toEqual(["q1"]);
    });

    it("у раздела с вариантами пул — вопросы вариантов", async () => {
      storageMock.getQuestionsByTopic.mockResolvedValue([Q("q1"), Q("q2"), Q("q3")]);
      storageMock.getTestSections.mockResolvedValue([{
        id: "s1", testId: "test1", topicId: "t1",
        formSetJson: { forms: [{ id: "f1", label: "Форма 1", questionIds: ["q1", "q3"] }] },
      }]);

      const res = await ask();

      expect(res.body.items.map((i: { questionId: string }) => i.questionId)).toEqual(["q1", "q3"]);
    });

    it("у адаптивного теста пул — вопросы, чья трудность попадает в полосу уровня", async () => {
      storageMock.getTest.mockResolvedValue({ ...TEST, mode: "adaptive" });
      storageMock.getQuestionsByTopic.mockResolvedValue([
        Q("q1", { difficulty: 40 }), Q("q2", { difficulty: 90 }), Q("q3", { difficulty: 20 }),
        Q("q4", { difficulty: null }),
      ]);
      storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
        { id: "l1", testId: "test1", topicId: "t1", levelIndex: 0, minDifficulty: 10, maxDifficulty: 50, questionsCount: 1 },
      ]);
      // Действующая трудность теста перебивает базовую (FR-34): q2 опущен в полосу уровня.
      storageMock.getTestQuestionScoring.mockResolvedValue([
        { testId: "test1", questionId: "q2", difficulty: 30, excludedFromDelivery: false },
      ]);

      const res = await ask();

      expect(res.body.items.map((i: { questionId: string }) => i.questionId)).toEqual(["q1", "q2", "q3"]);
    });

    it("невыданные вопросы не трогают надёжность и не делают тест измерительным", async () => {
      storageMock.getQuestionsByTopic.mockResolvedValue([Q("q1")]);
      const before = (await ask()).body;
      resetPsychometricsCache();
      storageMock.getQuestionsByTopic.mockResolvedValue([Q("q1"), Q("q2"), Q("q3")]);
      const after = (await ask()).body;

      expect(after.items).toHaveLength(3);
      expect(after.reliability).toEqual(before.reliability);
      expect(after.sem).toEqual(before.sem);
      expect(after.sample).toEqual(before.sample);
      expect(after.measurementOnly).toBe(false);
    });
  });

  it("неизвестный тест — 404", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    expect((await ask()).status).toBe(404);
  });

  it("чужой тест не отдаётся", async () => {
    // Право открывает действие, тест решает: область у психометрики ТА ЖЕ, что у аналитики.
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTests.mockResolvedValue([]);

    expect((await ask()).status).toBe(403);
  });

  it("повторный запрос с теми же условиями считается из кэша", async () => {
    await ask();
    const callsAfterFirst = storageMock.selectObservations.mock.calls.length;
    await ask();

    expect(storageMock.selectObservations.mock.calls.length).toBe(callsAfterFirst);
  });

  it("фоновый расчёт теста берёт расчёт экрана из общего кэша (PRD-70 FR-02)", async () => {
    await ask();
    const callsAfterScreen = storageMock.selectObservations.mock.calls.length;
    const core = await testPsychometrics(TEST as never, { testIds: ["test1"] }, true);

    expect(core.psychometrics.items).toHaveLength(1);
    expect(storageMock.selectObservations.mock.calls.length).toBe(callsAfterScreen);
  });

  it("экран после фонового расчёта тест заново не считает (PRD-70 FR-02)", async () => {
    await testPsychometrics(TEST as never, { testIds: ["test1"] }, true);
    const callsAfterCount = storageMock.selectObservations.mock.calls.length;
    const res = await ask();

    expect(res.status).toBe(200);
    expect(storageMock.selectObservations.mock.calls.length).toBe(callsAfterCount);
  });

  it("смена условий отбора кэш не переиспользует", async () => {
    await ask();
    const callsAfterFirst = storageMock.selectObservations.mock.calls.length;
    await ask("?source=web");

    expect(storageMock.selectObservations.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("отдаёт психометрический отчёт файлом", async () => {
    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/export")
      .set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain("psychometrics");
  });

  it("отдаёт матрицу ответов файлом", async () => {
    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/matrix")
      .set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("response_matrix");
  });

  it("выгрузка требует права на выгрузку, а не только на чтение", async () => {
    // Файл уносят из системы — это отдельное действие, и право у него своё.
    storageMock.getUserRoles.mockResolvedValue(["manager"]);

    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/export")
      .set("x-test-user", "a1");

    expect(res.status).toBe(403);
  });

  it("сравнение срезов считает психометрику по каждому срезу", async () => {
    // Свой механизм сравнения трек не заводит: срезы те же, что у раздела «Аналитика»,
    // меняется только содержимое таблиц (FR-04b, FR-04b1).
    storageMock.getSlices.mockResolvedValue([
      { id: "s1", name: "Розница", conditionsJson: { groupIds: ["g1"] } },
      { id: "s2", name: "Опт", conditionsJson: { groupIds: ["g2"] } },
    ]);

    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/slices?withWhole=1")
      .set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.body.slices.map((s: { name: string }) => s.name))
      .toEqual(["Тест целиком", "Розница", "Опт"]);
    expect(res.body.slices[0]).toHaveProperty("alpha");
    expect(res.body.slices[0]).toHaveProperty("suspiciousCount");
  });

  it("«под подозрением» среза считает и слабую дискриминативность", async () => {
    // Счётчик перечисляет признаки поимённо: новый признак, забытый в перечне, развёл бы число
    // среза с плиткой вкладки «Качество вопросов».
    storageMock.getSlices.mockResolvedValue([
      { id: "s1", name: "Розница", conditionsJson: { groupIds: ["g1"] } },
    ]);
    const actual = await vi.importActual<typeof import("../server/services/analytics/psychometrics")>(
      "../server/services/analytics/psychometrics",
    );
    vi.mocked(computePsychometrics).mockImplementationOnce((responses, ctx) => {
      const real = actual.computePsychometrics(responses, ctx);
      return {
        ...real,
        items: real.items.map(item => ({ ...item, flags: { ...item.flags, weakDiscrimination: true } })),
      };
    });

    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/slices?sliceId=s1")
      .set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.body.slices[0].suspiciousCount).toBe(1);
  });

  it("сравнение берёт только срезы этого теста (Э3)", async () => {
    await request(makeApp())
      .get("/api/analytics/psychometrics/test1/slices?withWhole=1")
      .set("x-test-user", "a1");
    expect(storageMock.getSlices).toHaveBeenCalledWith("a1", "slice", "test1");
  });

  it("срез отдаёт трудность ПО ЗАДАНИЯМ — иначе сравнивать нечего", async () => {
    storageMock.getSlices.mockResolvedValue([
      { id: "s1", name: "Розница", conditionsJson: { groupIds: ["g1"] } },
    ]);

    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/slices?sliceId=s1")
      .set("x-test-user", "a1");

    expect(res.body.slices).toHaveLength(1);
    expect(res.body.slices[0].items[0]).toMatchObject({ questionId: "q1" });
  });

  describe("разбор вопроса (FR-24, FR-49a)", () => {
    const askItem = (query = "") =>
      request(makeApp()).get(`/api/analytics/psychometrics/test1/items/q1${query}`).set("x-test-user", "a1");

    it("отдаёт тему и подтемы для подзаголовка «Тема · подтема · N наблюдений»", async () => {
      storageMock.getQuestionsByIds.mockResolvedValue([
        { ...TOPIC_QUESTIONS[0], tags: ["Антикоррупция"], psychoHash: "hash-1" },
      ]);

      const res = await askItem();

      expect(res.status).toBe(200);
      expect(res.body.topicName).toBe("Тема");
      expect(res.body.tags).toEqual(["Антикоррупция"]);
      expect(res.body.currentVersion).toBe("hash-1");
      // Редакция одна — выбирать нечего, и карточка считается по всей выборке.
      expect(res.body).not.toHaveProperty("selectedVersion");
    });

    it("при нескольких редакциях по умолчанию считает карточку по текущей", async () => {
      storageMock.getQuestionsByIds.mockResolvedValue([{ ...TOPIC_QUESTIONS[0], psychoHash: "hash-1" }]);
      const attempts = [
        ATTEMPTS[0],
        { ...ATTEMPTS[1], userId: "u2", variantJson: { ...ATTEMPTS[1].variantJson, psychoHashes: { q1: "hash-0" } } },
      ];
      storageMock.getAttemptsByIds.mockResolvedValue(attempts);
      storageMock.selectObservations.mockResolvedValue({
        web: attempts, lms: [], order: attempts.map(a => ({ id: a.id, source: "web" })), total: attempts.length,
      });

      const byDefault = await askItem();
      expect(byDefault.body.versions).toHaveLength(2);
      expect(byDefault.body.selectedVersion).toBe("hash-1");
      expect(byDefault.body.item.observations).toBe(1);
      expect(byDefault.body.item.difficulty).toBe(1);
      expect(byDefault.body.versions[0]).toHaveProperty("itemRest");

      const older = await askItem("?version=hash-0");
      expect(older.body.selectedVersion).toBe("hash-0");
      expect(older.body.item.difficulty).toBe(0);
    });
  });

  it("откат партии пересчитывает, а не отдаёт прежние числа", async () => {
    // Состав партий в ключе кэша именно поэтому: загрузка и откат меняют выборку, не трогая ни
    // теста, ни его содержания.
    storageMock.getLmsImportBatches.mockResolvedValue([{ id: "b1" }, { id: "b2" }]);
    await ask();
    const callsAfterFirst = storageMock.selectObservations.mock.calls.length;

    storageMock.getLmsImportBatches.mockResolvedValue([{ id: "b1" }]);
    await ask();

    expect(storageMock.selectObservations.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
