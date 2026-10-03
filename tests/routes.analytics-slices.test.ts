/**
 * @module tests/routes.analytics-slices
 * @description PRD-56 FR-06, FR-07e, FR-07i: ручка срезов.
 *
 * Срез хранит условия и пересчитывается при каждом открытии (FR-07d), поэтому ручка не отдаёт
 * сохранённые числа: она считает их по наблюдениям здесь и сейчас, в рамке «тест плюс период».
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { observationsDouble } from "./helpers/observations-double";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTests: vi.fn(), getTest: vi.fn(),
    getAllAttempts: vi.fn(), getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    // Э3: область теста у ручек срезов — тот же расчёт, что у requireTestScope.
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    selectObservations: vi.fn(),
    getSlices: vi.fn(), getSlice: vi.fn(), createSlice: vi.fn(),
    updateSlice: vi.fn(), deleteSlice: vi.fn(),
    // Справочники оси разбиения: членство, названия групп, снимки публикации.
    getGroups: vi.fn().mockResolvedValue([]),
    getUserGroups: vi.fn().mockResolvedValue([]),
    getGroupUsers: vi.fn().mockResolvedValue([]),
    getSnapshotsForTest: vi.fn().mockResolvedValue([]),
    // PRD-56 FR-18: названия вариантов оси «вариант» берутся из наборов форм разделов.
    getTestSections: vi.fn().mockResolvedValue([]),
    // «Назначено»: назначения теста; по умолчанию их нет.
    getTestAssignments: vi.fn().mockResolvedValue([]),
    // PRD-56 FR-06e: разворот строки среза читает ответы теста общим сбором.
    getQuestionsByIds: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    selectAnswersForTest: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import slicesRouter from "../server/routes/analytics/slices";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", slicesRouter);
  return app;
}

const ask = (query = "") =>
  request(makeApp()).get(`/api/analytics/slices${query}`).set("x-test-user", "u-owner");

const save = (body: Record<string, unknown>) =>
  request(makeApp()).post("/api/analytics/slices").set("x-test-user", "u-owner").send(body);

/** Двенадцать веб-попыток: выборка выше порога наблюдений. */
function attempts(count: number, passedCount: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `web-${index}`, testId: "test1", userId: `u${index}`,
    startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
    variantJson: {}, answersJson: {},
    resultJson: {
      overallPercent: index < passedCount ? 80 : 40,
      overallPassed: index < passedCount,
      totalPossiblePoints: 20,
      totalEarnedPoints: index < passedCount ? 16 : 8,
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u-owner", name: "Оценщик", email: "o@b.c" });
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTests.mockResolvedValue([TEST]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue(attempts(12, 9));
  storageMock.getGroups.mockResolvedValue([]);
  storageMock.getGroupUsers.mockResolvedValue([]);
  storageMock.getSnapshotsForTest.mockResolvedValue([]);
  storageMock.getSlices.mockResolvedValue([
    {
      id: "s1", name: "Отдел продаж", testId: "test1",
      conditionsJson: { groupIds: ["g1"] }, createdBy: "u-owner",
    },
  ]);
});

describe("GET /api/analytics/slices", () => {
  it("считает величины среза, а не отдаёт сохранённые", async () => {
    const res = await ask("?testId=test1");

    expect(res.status).toBe(200);
    expect(res.body.slices).toHaveLength(1);
    expect(res.body.slices[0]).toMatchObject({
      id: "s1",
      name: "Отдел продаж",
      completed: 12,
      passed: 9,
      passRate: 75,
      enoughData: true,
    });
  });

  it("подставляет тест рамки в условия среза (FR-07e)", async () => {
    await ask("?testId=test1");

    expect(storageMock.selectObservations).toHaveBeenCalledWith(
      expect.objectContaining({ testIds: ["test1"] }),
    );
  });

  it("не считает средние без теста: у разных тестов разные пороги и шкалы", async () => {
    const res = await ask();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/тест/i);
  });

  it("принимает период как рамку расчёта и передаёт его в выборку", async () => {
    await ask("?testId=test1&from=2026-09-01&to=2026-09-30");

    expect(storageMock.selectObservations).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date("2026-09-01T00:00:00.000Z"),
        to: new Date("2026-09-30T23:59:59.999Z"),
      }),
    );
  });

  it("работает без периода: пустые даты значат «за всё время» (FR-07j)", async () => {
    const res = await ask("?testId=test1");

    expect(res.status).toBe(200);
    const call = storageMock.selectObservations.mock.calls.at(-1)![0];
    expect(call.from).toBeUndefined();
    expect(call.to).toBeUndefined();
  });

  it("ниже порога наблюдений отдаёт объём вместо процентов", async () => {
    storageMock.getAllAttempts.mockResolvedValue(attempts(3, 2));

    const res = await ask("?testId=test1");

    expect(res.body.slices[0]).toMatchObject({
      completed: 3, enoughData: false, passRate: null, avgPercent: null,
    });
  });

  it("отдаёт пустой список, когда срезов ещё нет", async () => {
    storageMock.getSlices.mockResolvedValue([]);

    const res = await ask("?testId=test1");

    expect(res.status).toBe(200);
    expect(res.body.slices).toEqual([]);
  });
});

describe("GET /api/analytics/slices — условия среза целиком", () => {
  it("вариант и версия среза доходят до выборки, а не теряются", async () => {
    storageMock.getSlices.mockResolvedValue([{
      id: "s2", name: "Вариант Б, версия 3", testId: "test1",
      conditionsJson: { formIds: ["form-b"], snapshotIds: ["snap-3"] }, createdBy: "u-owner",
    }]);

    await ask("?testId=test1");

    expect(storageMock.selectObservations).toHaveBeenCalledWith(
      expect.objectContaining({ formIds: ["form-b"], snapshotIds: ["snap-3"] }),
    );
  });

  it("период среза пересекается с периодом рамки", async () => {
    storageMock.getSlices.mockResolvedValue([{
      id: "s3", name: "Июль", testId: "test1",
      conditionsJson: { from: "2026-07-01", to: "2026-07-31" }, createdBy: "u-owner",
    }]);

    await ask("?testId=test1&from=2026-07-15");

    const calls = storageMock.selectObservations.mock.calls.map(call => call[0]);
    expect(calls).toContainEqual(expect.objectContaining({
      from: new Date("2026-07-15T00:00:00.000Z"),
      to: new Date("2026-07-31T23:59:59.999Z"),
    }));
  });

  it("временный срез из строки списка подписан своим именем", async () => {
    const conditions = encodeURIComponent(JSON.stringify({ groupIds: ["g1"] }));
    const res = await ask(`?testId=test1&conditions=${conditions}&conditionsName=${encodeURIComponent("Розница")}`);

    expect(res.body.slices[0]).toMatchObject({ id: "adhoc", name: "Розница" });
  });

  it("отбор без имени остаётся «Текущим отбором»", async () => {
    const conditions = encodeURIComponent(JSON.stringify({ groupIds: ["g1"] }));
    const res = await ask(`?testId=test1&conditions=${conditions}`);

    expect(res.body.slices[0]).toMatchObject({ id: "adhoc", name: "Текущий отбор" });
  });
});

describe("GET /api/analytics/slices?axis=... — разбиение", () => {
  it("разбивает выборку по оси и считает каждый срез", async () => {
    storageMock.getGroups.mockResolvedValue([
      { id: "g1", name: "Отдел продаж" },
      { id: "g2", name: "Розница" },
    ]);
    storageMock.getGroupUsers.mockImplementation(async (groupId: string) =>
      groupId === "g1"
        ? Array.from({ length: 12 }, (_, i) => ({ id: `u${i}` }))
        : [],
    );

    const res = await ask("?testId=test1&axis=group");

    expect(res.status).toBe(200);
    const sales = res.body.slices.find((slice: { name: string }) => slice.name === "Отдел продаж");
    expect(sales).toMatchObject({ completed: 12, passed: 9, enoughData: true });
  });

  it("не теряет прохождения вне групп", async () => {
    storageMock.getGroups.mockResolvedValue([{ id: "g1", name: "Отдел продаж" }]);
    storageMock.getGroupUsers.mockResolvedValue([]);

    const res = await ask("?testId=test1&axis=group");

    expect(res.body.slices.map((slice: { name: string }) => slice.name)).toEqual(["Без группы"]);
  });

  it("отдаёт условия среза на языке реестра, чтобы из строки был переход (FR-08)", async () => {
    storageMock.getGroups.mockResolvedValue([{ id: "g1", name: "Отдел продаж" }]);
    storageMock.getGroupUsers.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({ id: `u${i}` })),
    );

    const res = await ask("?testId=test1&axis=group");

    const sales = res.body.slices.find((slice: { name: string }) => slice.name === "Отдел продаж");
    // Не `{ axis, key }`: реестр отбирает своим языком условий, и перевод делается там, где
    // разбиение известно, — иначе клиенту пришлось бы завести второе описание осей.
    expect(sales.conditions).toEqual({ groupIds: ["g1"] });
  });

  it("отказывает в неизвестной оси, а не молча отдаёт сохранённые срезы", async () => {
    // Оргструктура осью стала (FR-06b отменено 2026-09-28); региона в продукте нет.
    const res = await ask("?testId=test1&axis=region");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ось/i);
  });

  it("разбивает по подразделению из профиля и считает «назначено» по профилю (Р-7)", async () => {
    // u0..u7 проходили и числятся в отделе продаж (в двух написаниях), u8..u11 проходили без
    // подразделения; u20 из отдела продаж назначен, но не начинал.
    const unitOf = (index: number) =>
      index < 4 ? "Отдел продаж" : index < 8 ? "ОТДЕЛ ПРОДАЖ" : index === 20 ? "отдел продаж" : null;
    storageMock.getUser.mockImplementation(async (id: string) => {
      const index = Number(id.replace("u", ""));
      return Number.isNaN(index)
        ? { id, name: "Оценщик", email: "o@b.c" }
        : { id, name: id, unit: unitOf(index) };
    });
    storageMock.getTestAssignments.mockResolvedValue([
      ...Array.from({ length: 12 }, (_, i) => ({ userId: `u${i}`, groupId: null })),
      { userId: "u20", groupId: null },
    ]);

    const res = await ask("?testId=test1&axis=unit");

    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      res.body.slices.map((slice: { name: string }) => [slice.name, slice]),
    );
    expect(Object.keys(byName).sort()).toEqual(["Не указано", "Отдел продаж"]);
    expect(byName["Отдел продаж"]).toMatchObject({
      completed: 8,
      conditions: { units: ["Отдел продаж"] },
    });
    expect(byName["Не указано"]).toMatchObject({ completed: 4, conditions: {} });
    // Назначено больше, чем прошло: u20 позван и не начинал — ради этого числа ось и нужна.
    expect(byName["Отдел продаж"].assigned).toBe(9);
    expect(byName["Не указано"].assigned).toBe(4);
  });
});

describe("GET /api/analytics/slices?withWhole=1 — тест целиком", () => {
  it("добавляет срез без условий, которым сравнивают с тестом целиком (FR-07a)", async () => {
    const res = await ask("?testId=test1&withWhole=1");

    expect(res.status).toBe(200);
    const whole = res.body.slices.find((slice: { id: string }) => slice.id === "whole");
    expect(whole).toMatchObject({ name: "Тест целиком", completed: 12, passed: 9 });
  });

  it("не заводит отдельной сущности «эталон»: это обычный срез без условий", async () => {
    const res = await ask("?testId=test1&withWhole=1");

    const whole = res.body.slices.find((slice: { id: string }) => slice.id === "whole");
    expect(whole.conditions).toEqual({});
  });

  it("без параметра среза «тест целиком» в списке нет", async () => {
    const res = await ask("?testId=test1");

    expect(res.body.slices.some((slice: { id: string }) => slice.id === "whole")).toBe(false);
  });
});

describe("POST /api/analytics/slices — сохранение среза", () => {
  it("заводит срез с именем и условиями", async () => {
    storageMock.createSlice.mockResolvedValue({
      id: "new", name: "Розница, не сдали", testId: "test1",
      conditionsJson: { groupIds: ["g1"], outcomes: ["failed"] }, createdBy: "u-owner",
    });

    const res = await save({
      name: "Розница, не сдали",
      conditions: { testIds: ["test1"], groupIds: ["g1"], outcomes: ["failed"] },
    });

    expect(res.status).toBe(201);
    expect(storageMock.createSlice).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Розница, не сдали",
        kind: "slice",
        // Тест берётся ИЗ УСЛОВИЙ, а не из отдельного поля: иначе сохранённая выборка и её
        // подпись расходятся.
        testId: "test1",
        createdBy: "u-owner",
      }),
    );
  });

  it("срез по НЕСКОЛЬКИМ тестам не сохраняется и предлагает фильтр", async () => {
    // Средние, пороги и сравнение поверх разных тестов не значат ничего. Раньше такой срез
    // сохранялся, молча забирая первый тест, и автор сравнивал не ту выборку, что отобрал.
    const res = await save({
      name: "Два теста",
      conditions: { testIds: ["test1", "test2"], outcomes: ["failed"] },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/несколько тестов/i);
    expect(res.body.error).toMatch(/фильтр/i);
    expect(storageMock.createSlice).not.toHaveBeenCalled();
  });

  it("срез БЕЗ теста не сохраняется: считать его не на чем", async () => {
    const res = await save({ name: "Без теста", conditions: { outcomes: ["failed"] } });

    expect(res.status).toBe(400);
    expect(storageMock.createSlice).not.toHaveBeenCalled();
  });

  it("сохранённый ФИЛЬТР принимает сколько угодно тестов", async () => {
    // Фильтр отвечает на другой вопрос — «покажи эти прохождения», — и внутри одного теста
    // его запирать незачем (решение владельца 2026-09-25).
    storageMock.createSlice.mockResolvedValue({ id: "f1", name: "Мои потоки", kind: "filter" });

    const res = await save({
      name: "Мои потоки",
      kind: "filter",
      conditions: { testIds: ["test1", "test2"], sources: ["web"] },
    });

    expect(res.status).toBe(201);
    expect(storageMock.createSlice).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "filter", testId: null }),
    );
  });

  it("не сохраняет срез без имени: безымянный срез неотличим в списке", async () => {
    const res = await save({ conditions: { groupIds: ["g1"] } });

    expect(res.status).toBe(400);
    expect(storageMock.createSlice).not.toHaveBeenCalled();
  });

  it("не сохраняет срез без условий: это не отбор, а весь тест", async () => {
    const res = await save({ name: "Пустой", conditions: {} });

    expect(res.status).toBe(400);
    expect(storageMock.createSlice).not.toHaveBeenCalled();
  });

  it("сообщает понятно, когда имя уже занято", async () => {
    storageMock.createSlice.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" }),
    );

    const res = await save({ name: "Розница", conditions: { testIds: ["test1"], groupIds: ["g1"] } });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/уже есть/i);
  });
});

describe("GET /api/analytics/slices/topics — разворот строки (FR-06e)", () => {
  const askTopics = (query: string) =>
    request(makeApp()).get(`/api/analytics/slices/topics?${query}`).set("x-test-user", "u-owner");

  /** Веб-попытка участника с одним ответом на `q1`. */
  const run = (id: string, userId: string, answer: number) => ({
    id, testId: "test1", userId,
    startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
    variantJson: { sections: [{ topicId: "tp-1", questionIds: ["q1"] }] },
    answersJson: { q1: answer },
    resultJson: { overallPercent: 80, overallPassed: true, totalPossiblePoints: 1, totalEarnedPoints: 1 },
  });

  beforeEach(() => {
    storageMock.getGroups.mockResolvedValue([{ id: "g1", name: "Отдел продаж" }]);
    storageMock.getGroupUsers.mockResolvedValue([{ id: "u1" }]);
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", type: "single", prompt: "Вопрос", topicId: "tp-1", tags: [], correctJson: { correctIndex: 0 } },
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "tp-1", name: "Бюджет" }]);
    storageMock.getTestSections.mockResolvedValue([
      { id: "s1", testId: "test1", topicId: "tp-1", topicPassRuleJson: null },
    ]);
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    storageMock.selectAnswersForTest.mockResolvedValue([]);
    storageMock.getAllAttempts.mockResolvedValue([run("a1", "u1", 0), run("a2", "u2", 1)]);
  });

  it("считает темы по прохождениям ЭТОГО среза, а не всего теста", async () => {
    // В группе один участник, и он ответил верно; второй в срез не входит. По тесту целиком
    // доля была бы 50 %, и если она появится здесь — разворот показывает не срез.
    const res = await askTopics("testId=test1&axis=group&key=g1");

    expect(res.status).toBe(200);
    expect(res.body.topics).toEqual([
      { topicId: "tp-1", topicName: "Бюджет", correctShare: 100, inSample: 1 },
    ]);
  });

  it("срез без прохождений отдаёт пустой список, а не нули", async () => {
    storageMock.getAllAttempts.mockResolvedValue([]);

    expect((await askTopics("testId=test1&axis=group&key=g1")).body.topics).toEqual([]);
  });

  it("неизвестную ось отвергает, а не отвечает не о том", async () => {
    expect((await askTopics("testId=test1&axis=должность&key=x")).status).toBe(400);
  });

  it("без теста не считает: средние законны только внутри одного теста", async () => {
    expect((await askTopics("axis=group&key=g1")).status).toBe(400);
  });

  it("без среза не считает", async () => {
    expect((await askTopics("testId=test1")).status).toBe(400);
  });

  it("сохранённый срез разворачивается своими условиями", async () => {
    const res = await askTopics("testId=test1&sliceId=s1");

    expect(res.status).toBe(200);
    expect(res.body.topics[0]).toMatchObject({ topicId: "tp-1" });
  });

  it("срез, которого нет, отвечает 404", async () => {
    expect((await askTopics("testId=test1&sliceId=нет-такого")).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Э3 (решение владельца 2026-10-03): срезы живут на уровне теста.
describe("срезы на уровне теста (Э3)", () => {
  it("список и сравнение берут только срезы этого теста", async () => {
    await ask("?testId=test1");
    expect(storageMock.getSlices).toHaveBeenCalledWith("u-owner", "slice", "test1");
  });

  it("разворот сохранённого среза ищет его среди срезов этого теста", async () => {
    await request(makeApp())
      .get("/api/analytics/slices/topics?testId=test1&sliceId=s1")
      .set("x-test-user", "u-owner");
    expect(storageMock.getSlices).toHaveBeenCalledWith("u-owner", "slice", "test1");
  });

  it("вне области теста — отказ, как у requireTestScope, и срезы не читаются", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTest.mockResolvedValue({ ...TEST, ownerId: "someone-else" });

    const listed = await ask("?testId=test1");
    expect(listed.status).toBe(403);
    expect(storageMock.getSlices).not.toHaveBeenCalled();

    const saved = await save({ name: "Чужой", kind: "slice", conditions: { testIds: ["test1"], groupIds: ["g1"] } });
    expect(saved.status).toBe(403);
    expect(storageMock.createSlice).not.toHaveBeenCalled();
  });

  it("правка среза чужого теста — отказ, срез не меняется", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTest.mockResolvedValue({ ...TEST, ownerId: "someone-else" });
    storageMock.getSlice.mockResolvedValue({ id: "s1", kind: "slice", testId: "test1", createdBy: "u-owner" });

    const res = await request(makeApp()).put("/api/analytics/slices/s1").set("x-test-user", "u-owner").send({ name: "Новое" });
    expect(res.status).toBe(403);
    expect(storageMock.updateSlice).not.toHaveBeenCalled();
  });

  it("разбивка по оси считается в выборке с условиями уровня теста (Э3.2)", async () => {
    const conditions = encodeURIComponent(JSON.stringify({ sources: ["web"], groupIds: ["g1"] }));
    await ask(`?testId=test1&axis=source&conditions=${conditions}`);

    const query = storageMock.selectObservations.mock.calls[0][0];
    expect(query.testIds).toEqual(["test1"]);
    expect(query.sources).toEqual(["web"]);
    expect(query.groupIds).toEqual(["g1"]);
  });

  it("меню «Сохранённые» получает срезы теста без расчёта (Э3.2)", async () => {
    const res = await request(makeApp()).get("/api/analytics/slices/saved?testId=test1").set("x-test-user", "u-owner");

    expect(res.status).toBe(200);
    expect(res.body.slices).toEqual([{ id: "s1", name: "Отдел продаж", conditions: { groupIds: ["g1"] } }]);
    expect(storageMock.getSlices).toHaveBeenCalledWith("u-owner", "slice", "test1");
    // Без расчёта: наблюдения не читаются.
    expect(storageMock.selectObservations).not.toHaveBeenCalled();
  });

  it("несуществующий тест — 404", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await ask("?testId=nope");
    expect(res.status).toBe(404);
  });
});
