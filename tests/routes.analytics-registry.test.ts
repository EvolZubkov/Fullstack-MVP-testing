/**
 * @module tests/routes.analytics-registry
 * @description PRD-56 FR-01 - FR-05: ручка реестра прохождений.
 *
 * Реестр — плоский список всех источников с условиями отбора и ленивой подгрузкой (FR-01c),
 * поэтому ручка обязана отдавать и порцию, и ОБЩЕЕ число: «показано 25 из 128» читается в
 * подвале таблицы, и второе число не выводится из первого.
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
    getTest: vi.fn(), getTests: vi.fn(),
    getAllAttempts: vi.fn(), getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    // PRD-15 FR-08: область видимости читателя строится по владению и грантам.
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
    selectAttemptOrder: vi.fn(),
    getGroup: vi.fn(),
    getUserGroups: vi.fn(),
    // План оргструктуры: хранящиеся написания оргполей и свёрнутый справочник значений.
    selectOrgSpellings: vi.fn(),
    getOrgValues: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// FR-17: правила оценивания проверены тестами сбора ответов; здесь важна проводка условия.
const { answerFactsMock } = vi.hoisted(() => ({ answerFactsMock: vi.fn() }));
vi.mock("../server/services/analytics/test-answer-facts", () => ({
  loadTestAnswerFacts: answerFactsMock,
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import registryRouter from "../server/routes/analytics/registry";

const TEST = {
  id: "test1", title: "Сертификация руководителей", mode: "standard",
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
  app.use("/api/analytics", registryRouter);
  return app;
}

const ask = (query = "") =>
  request(makeApp()).get(`/api/analytics/registry${query}`).set("x-test-user", "a1");

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.selectAttemptOrder.mockResolvedValue([]);
  storageMock.getGroup.mockResolvedValue(undefined);
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u1", name: "Морозова Анна", email: "a@b.c" });
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTests.mockResolvedValue([TEST]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue([{
    id: "web-1", testId: "test1", userId: "u1",
    startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
    variantJson: {}, answersJson: {},
    resultJson: { overallPercent: 78, overallPassed: true, totalPossiblePoints: 20, totalEarnedPoints: 16 },
  }]);
  storageMock.getAllScormAttempts.mockResolvedValue([{
    id: "lms-1", testId: "test1", packageId: null, origin: "import",
    userId: null, participantKey: "7f3a9c21", groupId: null, lmsUserName: null,
    startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date("2026-09-10T09:30:00Z"),
    resultPercent: 64, resultPassed: false, maxPoints: 20, totalPoints: 13,
  }]);
});

describe("GET /api/analytics/registry — ошибка в вопросе (FR-17)", () => {
  const fact = (attemptId: string, questionId: string, result: string) =>
    ({ attemptId, questionId, result });

  it("отбирает прохождения обоих источников, где ошиблись на вопросе", async () => {
    answerFactsMock.mockResolvedValue({
      facts: [
        fact("web-1", "q1", "incorrect"),
        fact("lms-1", "q1", "incorrect"),
        fact("web-1", "q2", "correct"),
      ],
    });

    const res = await ask("?testId=test1&wrongQuestionId=q1");

    expect(res.status).toBe(200);
    expect(res.body.rows.map((row: { id: string }) => row.id).sort()).toEqual(["lms-1", "web-1"]);
    expect(storageMock.selectObservations.mock.calls.at(-1)![0].attemptIds.sort())
      .toEqual(["lms-1", "web-1"]);
  });

  it("не считает ошибкой верный и измерительный ответ", async () => {
    answerFactsMock.mockResolvedValue({
      facts: [fact("web-1", "q1", "correct"), fact("lms-1", "q1", "neutral")],
    });

    const res = await ask("?testId=test1&wrongQuestionId=q1");

    expect(res.body.rows).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("собирает ответы по завершённым веб-попыткам теста условия", async () => {
    answerFactsMock.mockResolvedValue({ facts: [] });

    await ask("?testId=test1&wrongQuestionId=q1");

    expect(answerFactsMock).toHaveBeenCalledWith("test1", [expect.objectContaining({ id: "web-1" })]);
  });

  it("без теста в условиях не отбирает ничего, а не всё подряд", async () => {
    const res = await ask("?wrongQuestionId=q1");

    expect(answerFactsMock).not.toHaveBeenCalled();
    expect(res.body.total).toBe(0);
  });
});

describe("GET /api/analytics/registry — оргструктура (FR-06b)", () => {
  it("переводит условие по подразделению во все его хранящиеся написания", async () => {
    storageMock.selectOrgSpellings.mockResolvedValue({
      organization: [], unit: ["Отдел продаж", "ОТДЕЛ  ПРОДАЖ", "Логистика"], position: [],
    });

    const res = await ask(`?unit=${encodeURIComponent("отдел продаж")}`);

    expect(res.status).toBe(200);
    const query = storageMock.selectObservations.mock.calls[0][0];
    expect(query.orgValues).toEqual({ unit: ["Отдел продаж", "ОТДЕЛ  ПРОДАЖ"] });
  });

  it("не режет значение по запятой: она бывает в названии организации", async () => {
    storageMock.selectOrgSpellings.mockResolvedValue({
      organization: ["ООО «Альфа, Бета»"], unit: [], position: [],
    });

    await ask(`?organization=${encodeURIComponent("ООО «Альфа, Бета»")}`);

    expect(storageMock.selectObservations.mock.calls[0][0].orgValues)
      .toEqual({ organization: ["ООО «Альфа, Бета»"] });
  });

  it("отдаёт справочник оргзначений под правом аналитики", async () => {
    const values = { organization: [], unit: [{ value: "Отдел продаж", users: 3, attempts: 40 }], position: [] };
    storageMock.getOrgValues.mockResolvedValue(values);

    const res = await request(makeApp()).get("/api/analytics/org-values").set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(values);
  });

  it("отдаёт оргполя строки по правилу OQ-04: у веба — профиль", async () => {
    storageMock.getUser.mockResolvedValue({
      id: "u1", name: "Морозова Анна", email: "a@b.c", unit: "Логистика", position: "Кладовщик",
    });

    const res = await ask();

    const row = res.body.rows.find((r: { id: string }) => r.id === "web-1");
    expect(row).toMatchObject({ unit: "Логистика", position: "Кладовщик", organization: null });
  });
});

describe("GET /api/analytics/registry", () => {
  it("отдаёт строку в том виде, в каком её рисует реестр", async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: { id: string }) => r.id === "web-1");
    expect(row).toMatchObject({
      participant: "Морозова Анна",
      testId: "test1",
      testTitle: "Сертификация руководителей",
      percent: 78,
      outcome: "passed",
      source: "web",
    });
    expect(row.startedAt).toBeTruthy();
  });

  it("подписывает импортированного участника псевдонимом, а не пустотой", async () => {
    const res = await ask();

    const row = res.body.rows.find((r: { id: string }) => r.id === "lms-1");
    expect(row.participant).toBe("Участник 7f3a9c21");
    expect(row.source).toBe("import");
  });

  it("нумерует попытки ИМПОРТИРОВАННОГО участника по его псевдониму", async () => {
    // Выгрузка LMS не приносит истории, но несколько её строк одного псевдонима по одному
    // тесту — это и есть история: записи связываются ключом и выстраиваются по датам.
    storageMock.selectAttemptOrder.mockResolvedValue([
      { id: "lms-1", testId: "test1", participantId: "7f3a9c21", startedAt: new Date("2026-09-10T09:00:00Z") },
      { id: "lms-0", testId: "test1", participantId: "7f3a9c21", startedAt: new Date("2026-08-01T09:00:00Z") },
    ]);

    const res = await ask();

    // Более ранняя — первая, видимая строка — вторая; порядок задаёт дата, а не порядок строк.
    expect(res.body.rows.find((row: { id: string }) => row.id === "lms-1").attemptNumber).toBe(2);
  });

  it("не выдумывает номер там, где участник не опознан", async () => {
    // Ни учётной записи, ни псевдонима — связать прохождения не с чем, и «первая попытка»
    // стала бы утверждением без основания.
    storageMock.selectAttemptOrder.mockResolvedValue([]);

    const res = await ask();

    expect(res.body.rows.every((row: { attemptNumber: number | null }) => row.attemptNumber === null)).toBe(true);
  });

  // Задача 2.4 плана сверки: «Попытка» и «Группа» сортируются сервером наравне с прочими.
  it("пропускает в выборку сортировку по попытке и по группе", async () => {
    for (const sort of ["attempt", "group"]) {
      await ask(`?sort=${sort}&dir=asc`);
      expect(storageMock.selectObservations).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort, dir: "asc" }),
      );
    }
  });

  it("равные по времени попытки нумерует по идентификатору — как запрос сортировки", async () => {
    // Номер в колонке и место строки при сортировке по попытке обязаны совпасть; запрос
    // упорядочивает прохождения одной секунды идентификатором, и код — тоже.
    const same = new Date("2026-09-10T09:00:00Z");
    storageMock.selectAttemptOrder.mockResolvedValue([
      { id: "lms-1", testId: "test1", participantId: "7f3a9c21", startedAt: same },
      { id: "lms-0", testId: "test1", participantId: "7f3a9c21", startedAt: same },
    ]);

    const res = await ask();

    expect(res.body.rows.find((row: { id: string }) => row.id === "lms-1").attemptNumber).toBe(2);
  });

  it("перечисляет группы участника по алфавиту: первая — ключ сортировки", async () => {
    storageMock.getUserGroups.mockResolvedValue([{ name: "Розница" }, { name: "Бухгалтерия" }]);

    const res = await ask();

    expect(res.body.rows.find((row: { id: string }) => row.id === "web-1").groups)
      .toEqual(["Бухгалтерия", "Розница"]);
  });

  it("отдаёт общее число рядом с порцией", async () => {
    const res = await ask("?limit=1");

    expect(res.body.rows).toHaveLength(1);
    expect(res.body.total).toBe(2);
  });

  it("передаёт условия отбора в выборку", async () => {
    await ask("?testId=test1&source=import&outcome=failed&from=2026-09-01&to=2026-09-30&groupId=g1");

    expect(storageMock.selectObservations).toHaveBeenCalledWith(
      expect.objectContaining({
        testIds: ["test1"],
        sources: ["import"],
        outcomes: ["failed"],
        groupIds: ["g1"],
        from: new Date("2026-09-01T00:00:00.000Z"),
        to: new Date("2026-09-30T23:59:59.999Z"),
      }),
    );
  });

  it("не пускает читателя за пределы его области видимости", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);

    await ask();

    expect(storageMock.selectObservations).toHaveBeenCalledWith(
      expect.objectContaining({ impossible: true }),
    );
  });

  it("отвечает пустым списком, а не ошибкой, когда под условия ничего не подошло", async () => {
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});
