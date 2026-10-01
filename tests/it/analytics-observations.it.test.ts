/**
 * @module tests/it/analytics-observations.it.test
 * @description PRD-56 FR-33: выборка наблюдений на реальной базе.
 *
 * Проверять это без базы нельзя. Слой наблюдений отбирает, сортирует и режет на порции
 * ЗАПРОСОМ, а не в памяти: ленивая подгрузка реестра (FR-01c) опирается на то, что лимит со
 * смещением дают ту же последовательность, что и полный список. Ошибка тут не роняет запрос —
 * она проявляется пропавшими или задвоенными строками при прокрутке.
 *
 * Вторая проверяемая вещь — область видимости (FR-35): она обязана попасть В УСЛОВИЕ запроса,
 * иначе лимит отсчитается до отсечения недоступных тестов и страница вернёт меньше строк, чем
 * обещала.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { attempts, groups, lmsImportBatches, scormAttempts, scormPackages, tests, userGroups, users } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { loadObservations } from "../../server/services/analytics/observations";
// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { storage } from "../../server/storage";

const ALL_TESTS = { all: true, ids: new Set<string>() };

let gradedTestId: string;
let otherTestId: string;
let userId: string;

/** Веб-попытка теста: завершённая и сдавшая, если не сказано иное. */
async function webAttempt(over: Record<string, unknown> = {}) {
  const row = {
    id: randomUUID(),
    userId,
    testId: gradedTestId,
    testVersion: 1,
    variantJson: {},
    resultJson: { overallPercent: 78, overallPassed: true, totalPossiblePoints: 20 },
    startedAt: new Date("2026-09-11T14:00:00Z"),
    finishedAt: new Date("2026-09-11T14:20:00Z"),
    ...over,
  };
  await h.current!.db.insert(attempts).values(row as never);
  return row;
}

/** Прохождение из LMS: телеметрия, если не сказано иное. */
async function lmsAttempt(over: Record<string, unknown> = {}) {
  const row = {
    id: randomUUID(),
    packageId: null,
    sessionId: null,
    testId: gradedTestId,
    origin: "telemetry" as const,
    participantKey: null,
    groupId: null,
    userId: null,
    lmsUserName: "Иванов Пётр",
    resultPercent: 64,
    resultPassed: false,
    maxPoints: 20,
    startedAt: new Date("2026-09-10T09:00:00Z"),
    finishedAt: new Date("2026-09-10T09:30:00Z"),
    lastActivityAt: new Date("2026-09-10T09:30:00Z"),
    ...over,
  };
  await h.current!.db.insert(scormAttempts).values(row as never);
  return row;
}

beforeAll(async () => {
  h.current = await createHarness();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  gradedTestId = randomUUID();
  otherTestId = randomUUID();
  userId = randomUUID();
  await h.current!.db.insert(users).values({
    id: userId,
    email: "a@b.c",
    passwordHash: "x",
    name: "Морозова Анна",
  } as never);
  for (const id of [gradedTestId, otherTestId]) {
    await h.current!.db.insert(tests).values({
      id,
      title: "Тест " + id.slice(0, 4),
      // Проходной балл объявлен: без него у теста нет вердикта и все прохождения
      // стали бы «завершено», а проверять надо как раз «сдал / не сдал».
      overallPassRuleJson: { type: "percent", value: 70 },
      createdBy: userId,
    } as never);
  }
});

describe("loadObservations", () => {
  it("отдаёт оба источника одним списком, новые прохождения первыми", async () => {
    await webAttempt();
    await lmsAttempt();

    const page = await loadObservations({}, ALL_TESTS);

    expect(page.total).toBe(2);
    expect(page.rows.map(r => r.source)).toEqual(["web", "telemetry"]);
  });

  it("отбирает по тесту", async () => {
    await webAttempt();
    await webAttempt({ testId: otherTestId });

    const page = await loadObservations({ testIds: [gradedTestId] }, ALL_TESTS);

    expect(page.total).toBe(1);
    expect(page.rows[0].testId).toBe(gradedTestId);
  });

  it("отбирает по источнику", async () => {
    await webAttempt();
    await lmsAttempt();
    await lmsAttempt({ origin: "import", participantKey: "a".repeat(64), lmsUserName: null });

    const onlyImport = await loadObservations({ sources: ["import"] }, ALL_TESTS);

    expect(onlyImport.total).toBe(1);
    expect(onlyImport.rows[0].source).toBe("import");
  });

  it("отбирает по периоду по дате начала", async () => {
    await webAttempt();
    await lmsAttempt();

    const page = await loadObservations(
      { from: new Date("2026-09-11T00:00:00Z") },
      ALL_TESTS,
    );

    expect(page.total).toBe(1);
    expect(page.rows[0].source).toBe("web");
  });

  it("отбирает по исходу, не смешивая незавершённое с несдавшим", async () => {
    await webAttempt();
    await lmsAttempt();
    await webAttempt({ finishedAt: null, resultJson: null });

    const failed = await loadObservations({ outcomes: ["failed"] }, ALL_TESTS);
    const incomplete = await loadObservations({ outcomes: ["incomplete"] }, ALL_TESTS);

    expect(failed.rows.map(r => r.source)).toEqual(["telemetry"]);
    expect(incomplete.rows.map(r => r.source)).toEqual(["web"]);
  });

  it("не считает незавершённой попытку с посчитанным результатом без отметки времени", async () => {
    // Такие строки в базе есть: результат посчитан, а `finished_at` не проставлен. Сервис
    // считает их состоявшимися, и запрос обязан считать так же — иначе фильтр «сдал» их
    // теряет, а фильтр «не завершено» показывает то, что на экране значится сдавшим.
    await webAttempt({ finishedAt: null });

    const passed = await loadObservations({ outcomes: ["passed"] }, ALL_TESTS);
    const incomplete = await loadObservations({ outcomes: ["incomplete"] }, ALL_TESTS);

    expect(passed.total).toBe(1);
    expect(incomplete.total).toBe(0);
  });

  it("отбирает по исходу адаптивное прохождение, у которого нет ни баллов, ни порога", async () => {
    // Адаптивный тест судят подтверждённые уровни: вердикт у него есть ВСЕГДА, хотя ни
    // достижимых баллов, ни процента в записи может не быть, а правило зачёта у теста —
    // «none». Отбор по исходу считается запросом, и если запрос об этом не знает, он молча
    // возвращает пусто: экран показывает строку «не сдал», а фильтр «не сдал» её теряет.
    const adaptiveTestId = randomUUID();
    await h.current!.db.insert(tests).values({
      id: adaptiveTestId,
      title: "Адаптивный",
      mode: "adaptive",
      overallPassRuleJson: { type: "none", value: 0 },
      createdBy: userId,
    } as never);
    await webAttempt({
      testId: adaptiveTestId,
      resultJson: { mode: "adaptive", overallPassed: false, topicResults: [] },
    });
    await webAttempt({
      testId: adaptiveTestId,
      resultJson: { mode: "adaptive", overallPassed: true, topicResults: [] },
    });

    const failed = await loadObservations({ testIds: [adaptiveTestId], outcomes: ["failed"] }, ALL_TESTS);
    const passed = await loadObservations({ testIds: [adaptiveTestId], outcomes: ["passed"] }, ALL_TESTS);

    expect(failed.total).toBe(1);
    expect(failed.rows.map(r => r.outcome)).toEqual(["failed"]);
    expect(passed.total).toBe(1);
    expect(passed.rows.map(r => r.outcome)).toEqual(["passed"]);
  });

  it("не показывает прохождения теста вне области видимости", async () => {
    await webAttempt();
    await webAttempt({ testId: otherTestId });

    const page = await loadObservations({}, { all: false, ids: new Set([gradedTestId]) });

    expect(page.total).toBe(1);
    expect(page.rows[0].testId).toBe(gradedTestId);
  });

  it("режет на порции, не теряя и не повторяя строк", async () => {
    for (let i = 0; i < 5; i++) {
      await webAttempt({ startedAt: new Date(`2026-09-0${i + 1}T10:00:00Z`) });
    }

    const whole = await loadObservations({}, ALL_TESTS);
    const first = await loadObservations({ limit: 2 }, ALL_TESTS);
    const second = await loadObservations({ limit: 2, offset: 2 }, ALL_TESTS);

    expect(whole.rows).toHaveLength(5);
    expect(first.rows.map(r => r.id)).toEqual(whole.rows.slice(0, 2).map(r => r.id));
    expect(second.rows.map(r => r.id)).toEqual(whole.rows.slice(2, 4).map(r => r.id));
  });

  it("считает общее число независимо от лимита", async () => {
    for (let i = 0; i < 5; i++) await webAttempt();

    const page = await loadObservations({ limit: 2 }, ALL_TESTS);

    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it("находит прохождение старой телеметрии, у которой тест известен только через пакет", async () => {
    // PRD-54: `test_id` проставлен backfill'ом, но у части старых строк его нет. Пакет —
    // запасной путь; без него такие прохождения выпадали бы из выборки по тесту молча.
    const packageId = randomUUID();
    await h.current!.db.insert(scormPackages).values({
      id: packageId,
      testId: gradedTestId,
      testTitle: "Тест",
      secretKey: "s",
      apiBaseUrl: "http://localhost",
      exportedAt: new Date("2026-01-01T00:00:00Z"),
      createdBy: userId,
    } as never);
    await lmsAttempt({ testId: null, packageId });

    const page = await loadObservations({ testIds: [gradedTestId] }, ALL_TESTS);

    expect(page.total).toBe(1);
    expect(page.rows[0].testId).toBe(gradedTestId);
  });

  it("отбирает по исходу строку из LMS, у которой известен процент, но не баллы", async () => {
    // Выражение исхода в запросе обязано судить так же, как нормализация в сервисе: иначе
    // фильтр по исходу и колонки строки говорят разное об одном прохождении.
    await lmsAttempt({ maxPoints: null, totalPoints: null, resultPercent: 30, resultPassed: false });

    const failed = await loadObservations({ outcomes: ["failed"] }, ALL_TESTS);

    expect(failed.total).toBe(1);
    expect(failed.rows[0].percent).toBe(30);
    expect(failed.rows[0].outcome).toBe("failed");
  });

  it("отбирает по группе веб-попытку участника этой группы", async () => {
    // «Группа» обязана значить в реестре то же, что в остальном продукте: членство человека
    // (`user_groups`). Метка группы у импортированной строки — второй путь к тому же смыслу,
    // а не другое понятие.
    const groupId = randomUUID();
    await h.current!.db.insert(groups).values({ id: groupId, name: "Отдел продаж" } as never);
    await h.current!.db.insert(userGroups).values({
      id: randomUUID(), userId, groupId,
    } as never);
    await webAttempt();
    // Прохождение участника без группы под условие не подходит.
    const outsiderId = randomUUID();
    await h.current!.db.insert(users).values({
      id: outsiderId, email: "out@b.c", passwordHash: "x", name: "Без группы",
    } as never);
    await webAttempt({ userId: outsiderId });

    const page = await loadObservations({ groupIds: [groupId] }, ALL_TESTS);

    expect(page.total).toBe(1);
    expect(page.rows[0].userId).toBe(userId);
  });

  it("отбирает по группе импортированную строку с меткой этой группы", async () => {
    const groupId = randomUUID();
    await h.current!.db.insert(groups).values({ id: groupId, name: "Розница" } as never);
    await lmsAttempt({ origin: "import", participantKey: "a".repeat(64), groupId, lmsUserName: null });
    await lmsAttempt();

    const page = await loadObservations({ groupIds: [groupId] }, ALL_TESTS);

    expect(page.total).toBe(1);
    expect(page.rows[0].source).toBe("import");
  });
});

describe("партия, снятая с учёта, из выборки уходит (PRD-66 FR-12)", () => {
  /** Партия импорта; `counted` по умолчанию `true`, как и у всех уже загруженных. */
  async function batch(counted: boolean) {
    const id = randomUUID();
    await h.current!.db.insert(lmsImportBatches).values({
      id,
      testId: gradedTestId,
      fileName: "f.xlsx",
      fileHash: "h",
      anonymized: true,
      sourceAnonymized: false,
      linkUsers: false,
      importedBy: userId,
      counted,
    } as never);
    return id;
  }

  it("строки снятой партии не попадают в наблюдения, оставаясь в базе", async () => {
    // Выгрузка, в которой засомневались, перестаёт искажать числа — но не удаляется: прежде у
    // партии было два состояния, загружена и удалена, и любое сомнение решалось необратимо.
    const off = await batch(false);
    await lmsAttempt({ origin: "import", participantKey: "a".repeat(64), lmsUserName: null, batchId: off });

    const page = await loadObservations({}, ALL_TESTS);

    expect(page.total).toBe(0);
    const stored = await h.current!.db.select().from(scormAttempts);
    expect(stored).toHaveLength(1);
  });

  it("партия на учёте наблюдения даёт", async () => {
    const on = await batch(true);
    await lmsAttempt({ origin: "import", participantKey: "b".repeat(64), lmsUserName: null, batchId: on });

    expect((await loadObservations({}, ALL_TESTS)).total).toBe(1);
  });

  it("прохождение живой телеметрии партии не имеет и учитывается всегда", async () => {
    // `batch_id` у телеметрии пуст по построению: снятие партий её касаться не должно, иначе
    // одно переключение выключило бы половину источников разом.
    await lmsAttempt();

    expect((await loadObservations({}, ALL_TESTS)).total).toBe(1);
  });
});

describe("версия публикации и варианты доезжают из базы (PRD-56 FR-19a)", () => {
  it("оба источника отдают снимок и карту «тема -> вариант»", async () => {
    // Колонки новые: проверяется именно ВЫБОРКА — что запрос их берёт, а не только то, что
    // приведение умеет их читать.
    await webAttempt({
      snapshotId: "snap-web",
      variantJson: { sections: [{ topicId: "tp-1", questionIds: ["q1"], formId: "form-a" }] },
    });
    await lmsAttempt({ snapshotId: "snap-lms", formsJson: { "tp-2": "form-b" } });

    const page = await loadObservations({}, ALL_TESTS);
    const byId = new Map(page.rows.map(r => [r.source, r]));

    expect(byId.get("web")).toMatchObject({
      snapshotId: "snap-web",
      forms: { "tp-1": "form-a" },
    });
    expect(byId.get("telemetry")).toMatchObject({
      snapshotId: "snap-lms",
      forms: { "tp-2": "form-b" },
    });
  });

  it("прохождения без них не выдумывают ни версии, ни варианта", async () => {
    await webAttempt();
    await lmsAttempt();

    const page = await loadObservations({}, ALL_TESTS);

    expect(page.rows.every(r => r.snapshotId === null)).toBe(true);
    expect(page.rows.every(r => Object.keys(r.forms).length === 0)).toBe(true);
  });
});

/**
 * PRD-56 (задача 2.4 плана сверки): «Попытка» и «Группа» сортируются на сервере.
 *
 * Номер попытки — свойство прохождения, а не выборки: он считается по ВСЕМ прохождениям
 * участника по тесту в обоих источниках, и фильтр его не меняет. Значит и сортировать по нему
 * можно только запросом — на странице видны не все попытки человека.
 */
describe("сортировка по номеру попытки и группе", () => {
  const at = (hour: number) => new Date(`2026-09-11T${String(hour).padStart(2, "0")}:00:00Z`);

  it("номер попытки считается по обоим источникам и не зависит от фильтра", async () => {
    const first = await webAttempt({ startedAt: at(8), finishedAt: at(9) });
    // Вторая попытка того же человека — в LMS: нумерация общая, иначе вышло бы две «первые».
    await lmsAttempt({ userId, startedAt: at(10), finishedAt: at(11) });
    const third = await webAttempt({ startedAt: at(12), finishedAt: at(13) });
    // Другой человек, опознанный только псевдонимом импорта, — одна попытка.
    const other = await lmsAttempt({ origin: "import", participantKey: "b".repeat(64), startedAt: at(14) });

    const desc = await loadObservations({ sources: ["web", "import"], sort: "attempt", dir: "desc" }, ALL_TESTS);
    // Фильтр убрал вторую попытку, но третья осталась третьей и стоит выше первых.
    expect(desc.rows[0].id).toBe(third.id);
    expect(new Set(desc.rows.slice(1).map(r => r.id))).toEqual(new Set([other.id, first.id]));

    const asc = await loadObservations({ sources: ["web", "import"], sort: "attempt", dir: "asc" }, ALL_TESTS);
    expect(asc.rows.at(-1)!.id).toBe(third.id);
  });

  it("прохождение без опознанного участника номера не имеет и уходит в конец", async () => {
    const known = await webAttempt({ startedAt: at(8), finishedAt: at(9) });
    const anonymous = await lmsAttempt({ userId: null, participantKey: null, startedAt: at(10) });

    for (const dir of ["asc", "desc"] as const) {
      const page = await loadObservations({ sort: "attempt", dir }, ALL_TESTS);
      expect(page.rows.map(r => r.id)).toEqual([known.id, anonymous.id]);
    }
  });

  it("группа сортируется по названию, «без группы» — последней в обоих направлениях", async () => {
    const [alpha, beta, gamma] = [randomUUID(), randomUUID(), randomUUID()];
    await h.current!.db.insert(groups).values([
      { id: alpha, name: "Альфа" }, { id: beta, name: "Бета" }, { id: gamma, name: "Гамма" },
    ] as never);
    // Веб-попытка берёт группу из членства участника.
    await h.current!.db.insert(userGroups).values({ id: randomUUID(), userId, groupId: beta } as never);
    const inBeta = await webAttempt();
    const loneId = randomUUID();
    await h.current!.db.insert(users).values({
      id: loneId, email: "lone@b.c", passwordHash: "x", name: "Одиночка",
    } as never);
    const none = await webAttempt({ userId: loneId });
    // Импортированная строка — меткой группы из выгрузки.
    const inGamma = await lmsAttempt({ origin: "import", participantKey: "c".repeat(64), groupId: gamma });
    const inAlpha = await lmsAttempt({ origin: "import", participantKey: "d".repeat(64), groupId: alpha });

    const asc = await loadObservations({ sort: "group", dir: "asc" }, ALL_TESTS);
    expect(asc.rows.map(r => r.id)).toEqual([inAlpha.id, inBeta.id, inGamma.id, none.id]);
    const desc = await loadObservations({ sort: "group", dir: "desc" }, ALL_TESTS);
    expect(desc.rows.map(r => r.id)).toEqual([inGamma.id, inBeta.id, inAlpha.id, none.id]);
  });
});

/**
 * PRD-56 FR-17: «ошиблись на вопросе» приходит в выборку списком прохождений — правилами
 * оценивания его считает сервис, а запрос лишь отбирает названные строки обоих источников.
 */
describe("поимённый отбор прохождений", () => {
  it("отбирает названные строки обоих источников и считает только их", async () => {
    const web = await webAttempt();
    await webAttempt();
    const lms = await lmsAttempt();
    await lmsAttempt();

    const page = await storage.selectObservations({ attemptIds: [web.id, lms.id] });

    expect(page.total).toBe(2);
    expect(page.order.map(row => row.id).sort()).toEqual([web.id, lms.id].sort());
  });

  it("пустой список — ни одной строки, а не снятое условие", async () => {
    await webAttempt();
    await lmsAttempt();

    const page = await storage.selectObservations({ attemptIds: [] });

    expect(page.total).toBe(0);
  });
});
