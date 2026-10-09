/**
 * @module server/services/__tests__/lms-export-import
 * @description PRD-54 разделы 4 и 8: план импорта, источники `external_id`, связывание и запись.
 */
import { describe, it, expect } from "vitest";
import { buildImportPlan, runImport } from "../lms-export-import";

/** Разобранная книга из одной строки — форма ровно та, что отдаёт `parseLmsExport`. */
const book = {
  questionIds: ["q1"],
  scaleKeys: ["cel"],
  variableNames: ["lead_margin"],
  unknownColumns: [],
  rows: [{
    participantName: "Иванов Иван",
    participantCode: "",
    org: "ПАО",
    courseActivatedAt: "",
    moduleActivatedAt: "2026-09-09T13:39:00.000Z",
    passed: true,
    points: 0,
    answers: { q1: "0[.]7,1[.]0" },
    results: { q1: "neutral" },
    scales: { cel: 29 },
    scaleLevels: {},
    variables: { lead_margin: "6" },
  }],
};

const OFF = { anonymize: false, linkUsers: false };
const ON = { anonymize: true, linkUsers: false };

/** Та же книга, но файл готовил внешний обезличиватель: у строки есть `external_id`. */
const withExternal = (externalId: string) => ({
  ...book,
  hasExternalId: true,
  rows: [{ ...book.rows[0], externalId }],
});

describe("buildImportPlan", () => {
  it("обезличивает: ФИО в план не попадает, external_id вычислен", () => {
    const plan = buildImportPlan(book as never, ON);
    expect(plan.rows[0].participantKey).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.rows[0].lmsUserName).toBeNull();
    expect(plan.rows[0].lmsUserOrg).toBeNull();
  });

  it("без обезличивания external_id вычисляется ТОТ ЖЕ, но ФИО сохраняется", () => {
    // Ключ не зависит от режима намеренно: иначе переключение параметра порвало бы связь с уже
    // загруженными строками того же человека.
    const on = buildImportPlan(book as never, ON);
    const off = buildImportPlan(book as never, OFF);
    expect(off.rows[0].participantKey).toBe(on.rows[0].participantKey);
    expect(off.rows[0].lmsUserName).toBe("Иванов Иван");
    expect(off.rows[0].lmsUserOrg).toBe("ПАО");
  });

  it("external_id из файла берётся как есть и повторно не хешируется", () => {
    const plan = buildImportPlan(withExternal("9f86d081884c7d65") as never, ON);
    expect(plan.rows[0].participantKey).toBe("9f86d081884c7d65");
  });

  it("пустая ячейка external_id равна отсутствию колонки: значение вычисляется", () => {
    const computed = buildImportPlan(book as never, ON).rows[0].participantKey;
    expect(buildImportPlan(withExternal("") as never, ON).rows[0].participantKey).toBe(computed);
  });

  it("о сочетании обезличивания и связывания больше не предупреждает (BR-54-38)", () => {
    // Флажка нет, связывание идёт всегда, а заведённая запись носит подпись, а не ФИО.
    const plan = buildImportPlan(book as never, ON);
    expect(plan.warnings.join()).not.toContain("Обезличивание и связывание");
  });

  it("дата активации модуля идёт и в начало, и в конец попытки", () => {
    // Даты завершения файл не даёт вовсе; без `finishedAt` строка выпала бы из аналитики,
    // которая отбирает только завершённые попытки.
    const plan = buildImportPlan(book as never, ON);
    expect(plan.rows[0].startedAt.toISOString()).toBe("2026-09-09T13:39:00.000Z");
    expect(plan.rows[0].finishedAt.toISOString()).toBe("2026-09-09T13:39:00.000Z");
  });

  it("строка без даты активации модуля пропускается с предупреждением", () => {
    const noDate = { ...book, rows: [{ ...book.rows[0], moduleActivatedAt: "" }] };
    const plan = buildImportPlan(noDate as never, ON);
    expect(plan.rows).toHaveLength(0);
    expect(plan.warnings.some((w) => w.includes("без даты активации модуля"))).toBe(true);
  });

  it("в предупреждении о пропуске ФИО не раскрывается, когда обезличивание включено", () => {
    const noDate = { ...book, rows: [{ ...book.rows[0], moduleActivatedAt: "" }] };
    expect(buildImportPlan(noDate as never, ON).warnings.join()).not.toContain("Иванов");
    expect(buildImportPlan(noDate as never, OFF).warnings.join()).toContain("Иванов");
  });

  it("неопознанные колонки попадают в протокол", () => {
    const withUnknown = { ...book, unknownColumns: ["foo_bar"] };
    expect(buildImportPlan(withUnknown as never, ON).warnings.join()).toContain("foo_bar");
  });

  it("колонка «Код» в external_id не входит", () => {
    // В реальных выгрузках она пуста, а поле, которое то есть, то нет, развело бы человека надвое.
    const withCode = { ...book, rows: [{ ...book.rows[0], participantCode: "AB-12" }] };
    expect(buildImportPlan(withCode as never, ON).rows[0].participantKey)
      .toBe(buildImportPlan(book as never, ON).rows[0].participantKey);
  });

  it("шкалы, показатели и ответы переносятся как есть", () => {
    const row = buildImportPlan(book as never, ON).rows[0];
    expect(row.scalesJson).toEqual({ cel: 29 });
    expect(row.variablesJson).toEqual({ lead_margin: "6" });
    // `latencyMs: null` — выгрузка этого пакета времени на задании не несла; `protocol: null` — не сценарий.
    expect(row.answers).toEqual([
      { questionId: "q1", raw: "0[.]7,1[.]0", result: "neutral", latencyMs: null, protocol: null },
    ]);
  });
});

/**
 * Хранилище-заглушка: пишет ничего, но помнит, что у него просили.
 *
 * @param externalKeys карта «нормализованный ключ -> id пользователя»
 */
function storageStub(
  externalKeys: Record<string, string> = {},
  learnerIds: Record<string, string> = {},
  existing: Array<{ id: string; participantKey: string; startedAt: Date; attemptKey: string | null }> = [],
) {
  /** Переданные ключи (BR-54-37): какая запись какой ключ переняла. */
  const keyTransfers: Array<{ id: string; attemptKey: string }> = [];
  /** Заведённые внешние записи (BR-54-38): что о участнике пришло в метод. */
  const createdUsers: Array<Record<string, unknown>> = [];
  /** Поставленное членство (BR-54-41). */
  const memberships: Array<{ userId: string; groupId: string }> = [];
  /** Учёт партии (BR-54-43). */
  const batchUsers: Array<{ batchId: string; userId: string; createdUser: boolean; addedToGroup: boolean }> = [];
  const batches: unknown[] = [];
  const attempts: unknown[] = [];
  const answers: unknown[][] = [];
  /** Номера версий, о которых спрашивали: партия обязана спрашивать каждую по разу. */
  const snapshotLookups: number[] = [];
  /** Патчи счётчиков, которыми партия дописывается после записи строк. */
  const batchPatches: Record<string, unknown>[] = [];
  /** Тесты, чей срез экспозиции импорта пересчитан (PRD-55 FR-08). */
  const exposureRebuilds: string[] = [];
  return {
    batches, attempts, answers, snapshotLookups, batchPatches, exposureRebuilds, keyTransfers,
    createdUsers, memberships, batchUsers,
    createImportedExternalUser: async (input: Record<string, unknown>) => {
      createdUsers.push(input);
      return { id: `ext-${createdUsers.length}` };
    },
    ensureGroupMember: async (userId: string, groupId: string) => {
      memberships.push({ userId, groupId });
      return true;
    },
    recordImportBatchUser: async (
      batchId: string, userId: string, flags: { createdUser: boolean; addedToGroup: boolean },
    ) => { batchUsers.push({ batchId, userId, ...flags }); },
    listImportedAttemptKeys: async () => existing.map((e) => ({ ...e })),
    setImportedAttemptKey: async (id: string, attemptKey: string) => { keyTransfers.push({ id, attemptKey }); },
    // PRD-56 FR-19a: у теста одна опубликованная версия — третья.
    getSnapshotByVersion: async (_testId: string, version: number) => {
      snapshotLookups.push(version);
      return version === 3 ? { id: "snap-3", testId: "t1", version } : undefined;
    },
    // Раздел с набором форм (PRD-17): по нему вариант и находит свою тему.
    getTestSections: async () => [{
      id: "s1", testId: "t1", topicId: "t1",
      formSetJson: { forms: [
        { id: "form-a", label: "Форма A", questionIds: ["q1"] },
        { id: "form-b", label: "Форма B", questionIds: ["q1"] },
      ] },
    }],
    getUserByExternalKey: async (key: string) => {
      const id = externalKeys[String(key).trim().toLowerCase()];
      return id ? { id } : undefined;
    },
    getUserByLmsLearnerId: async (learnerId: string) => {
      const id = learnerIds[String(learnerId).trim().toLowerCase()];
      return id ? { id } : undefined;
    },
    getQuestionsByIds: async (ids: string[]) =>
      [{ id: "q1", type: "allocation", prompt: "Вопрос", topicId: "t1" }].filter((q) => ids.includes(q.id)),
    createLmsImportBatch: async (b: unknown) => { batches.push(b); return { id: "batch-1" }; },
    updateLmsImportBatch: async (_id: string, patch: Record<string, unknown>) => { batchPatches.push(patch); return undefined; },
    upsertImportedAttempt: async (a: unknown) => { attempts.push(a); return { id: "a1", created: true }; },
    replaceImportedAnswers: async (_id: string, rows: unknown[]) => { answers.push(rows); },
    rebuildImportExposure: async (testId: string) => { exposureRebuilds.push(testId); },
  };
}

const ctx = {
  testId: "t1", groupId: null, fileName: "f.xlsx",
  fileBuffer: Buffer.from("x"), userId: "me",
};

describe("buildImportPlan — процент прохождения", () => {
  /** Оцениваемое прохождение: исход «верно/неверно» и «Баллы» — процент пакета. */
  const graded = (points: number | null) => ({
    ...book,
    rows: [{ ...book.rows[0], points, results: { q1: "correct" } }],
  });

  it("«Баллы» оцениваемого прохождения становятся процентом при потолке 100", () => {
    const row = buildImportPlan(graded(83) as never, ON).rows[0];
    expect(row.resultPercent).toBe(83);
    expect(row.maxPoints).toBe(100);
    expect(row.totalPoints).toBe(83);
  });

  it("ноль у оцениваемого прохождения — измеренный ноль, а не отсутствие балла", () => {
    const row = buildImportPlan(graded(0) as never, ON).rows[0];
    expect(row.resultPercent).toBe(0);
    expect(row.maxPoints).toBe(100);
  });

  it("процент за пределами 0..100 прижимается к границе и округляется", () => {
    expect(buildImportPlan(graded(104.6) as never, ON).rows[0].resultPercent).toBe(100);
    expect(buildImportPlan(graded(-3) as never, ON).rows[0].resultPercent).toBe(0);
    expect(buildImportPlan(graded(66.6) as never, ON).rows[0].resultPercent).toBe(67);
  });

  it("пустые «Баллы» — процента нет", () => {
    const row = buildImportPlan(graded(null) as never, ON).rows[0];
    expect(row.resultPercent).toBeNull();
    expect(row.maxPoints).toBeNull();
  });

  it("измерительное прохождение со старым «0 баллов» оцененным не становится (PRD-54 §14 п.1)", () => {
    // `book` — ровно такая строка: «Пройден», 0 баллов, единственный исход `neutral`.
    const row = buildImportPlan(book as never, ON).rows[0];
    expect(row.resultPercent).toBeNull();
    expect(row.maxPoints).toBeNull();
  });
});

describe("runImport", () => {
  it("связывает по external_id из файла против внешнего ключа (BR-54-26)", async () => {
    const s = storageStub({ "9f86d081884c7d65": "user-7" });
    const res = await runImport(withExternal("9F86D081884C7D65") as never, ON, ctx, s as never);
    expect(res.rowsLinked).toBe(1);
    expect((s.attempts[0] as { userId: string }).userId).toBe("user-7");
  });

  it("связывает и по ВЫЧИСЛЕННОМУ external_id: алгоритм тот же, что у скрипта", async () => {
    // Заказчик считает ключи своих сотрудников тем же скриптом и грузит их в `external_key` —
    // значит, и строка сырого файла, для которой ключ посчитал импорт, находит своего человека.
    const computed = buildImportPlan(book as never, ON).rows[0].participantKey;
    const s = storageStub({ [computed]: "user-7" });
    const res = await runImport(book as never, ON, ctx, s as never);
    expect(res.rowsLinked).toBe(1);
    expect((s.attempts[0] as { userId: string }).userId).toBe("user-7");
  });

  it("НЕ связывает по ФИО и «Коду», даже когда они совпали с чьим-то внешним ключом", async () => {
    // Кто-то вписал ФИО или табельный номер во внешний ключ — сверяется только `external_id`.
    const withCode = { ...book, rows: [{ ...book.rows[0], participantCode: "К-12" }] };
    const s = storageStub({ "иванов иван": "user-7", "к-12": "user-8" });
    const res = await runImport(withCode as never, OFF, ctx, s as never);
    expect(res.rowsLinked).toBe(0);
    // Ни user-7, ни user-8: человек получает СВОЮ внешнюю запись (BR-54-38), а не чужую.
    expect((s.attempts[0] as { userId: string | null }).userId).toBe("ext-1");
  });

  it("партия помнит, пришёл ли файл с external_id", async () => {
    const plain = storageStub();
    await runImport(book as never, ON, ctx, plain as never);
    expect(plain.batches[0]).toMatchObject({ sourceAnonymized: false });

    const external = storageStub();
    await runImport(withExternal("abc") as never, ON, ctx, external as never);
    expect(external.batches[0]).toMatchObject({ sourceAnonymized: true });
  });

  it("связывает по learner_id, когда обезличиватель дописал колонку (BR-54-32)", async () => {
    // Идентификатор выдаёт сама LMS, поэтому связь по нему не зависит от того, каким
    // алгоритмом построен `external_id`.
    const withLearner = { ...book, rows: [{ ...book.rows[0], learnerId: "u-4471" }] };
    const s = storageStub({}, { "u-4471": "user-9" });

    const res = await runImport(withLearner as never, ON, ctx, s as never);

    expect(res.rowsLinked).toBe(1);
    expect((s.attempts[0] as { userId: string }).userId).toBe("user-9");
  });

  it("learner_id идёт ПЕРЕД внешним ключом (BR-54-33)", async () => {
    // Оба пути ведут к разным людям — значит видно, какой сработал первым.
    const both = { ...withExternal("ext-1"), rows: [{ ...withExternal("ext-1").rows[0], learnerId: "u-4471" }] };
    const s = storageStub({ "ext-1": "user-external" }, { "u-4471": "user-learner" });

    await runImport(both as never, ON, ctx, s as never);

    expect((s.attempts[0] as { userId: string }).userId).toBe("user-learner");
  });

  it("без совпадения по learner_id падает на внешний ключ", async () => {
    const both = { ...withExternal("ext-1"), rows: [{ ...withExternal("ext-1").rows[0], learnerId: "чужой" }] };
    const s = storageStub({ "ext-1": "user-external" }, {});

    await runImport(both as never, ON, ctx, s as never);

    expect((s.attempts[0] as { userId: string }).userId).toBe("user-external");
  });

  it("связывает всегда: флажка больше нет (BR-54-38)", async () => {
    const s = storageStub({ [buildImportPlan(book as never, ON).rows[0].participantKey]: "user-7" });
    const res = await runImport(book as never, ON, ctx, s as never);
    expect(res.rowsLinked).toBe(1);
    expect(res.usersCreated).toBe(0);
    expect((s.attempts[0] as { userId: string | null }).userId).toBe("user-7");
  });

  it("участник без учётной записи получает внешнюю (BR-54-38, BR-54-39)", async () => {
    const s = storageStub();
    const res = await runImport(book as never, ON, ctx, s as never);
    expect(res.rowsCreated).toBe(1);
    expect(res.rowsLinked).toBe(0);
    expect(res.usersCreated).toBe(1);
    expect((s.attempts[0] as { userId: string }).userId).toBe("ext-1");
    // Обезличено: ни ФИО, ни организации; подразделение и должность — всегда.
    expect(s.createdUsers[0]).toMatchObject({
      externalKey: buildImportPlan(book as never, ON).rows[0].participantKey,
      name: null,
      organization: null,
    });
    expect(s.batchUsers).toEqual([{ batchId: "batch-1", userId: "ext-1", createdUser: true, addedToGroup: false }]);
  });

  it("без обезличивания запись получает ФИО и организацию из файла", async () => {
    const s = storageStub();
    await runImport(book as never, OFF, ctx, s as never);
    expect(s.createdUsers[0]).toMatchObject({ name: "Иванов Иван", organization: "ПАО" });
  });

  it("участник с несколькими строками заводится один раз", async () => {
    const twoRows = { ...book, rows: [book.rows[0], { ...book.rows[0], moduleActivatedAt: "2026-09-10T10:00:00.000Z" }] };
    const s = storageStub();
    const res = await runImport(twoRows as never, ON, ctx, s as never);
    expect(res.usersCreated).toBe(1);
    expect(s.createdUsers).toHaveLength(1);
    expect(s.attempts.map((a) => (a as { userId: string }).userId)).toEqual(["ext-1", "ext-1"]);
  });

  it("группа партии — это и членство (BR-54-41), учёт партии его помнит (BR-54-43)", async () => {
    const s = storageStub();
    await runImport(book as never, ON, { ...ctx, groupId: "g1" }, s as never);
    expect(s.memberships).toEqual([{ userId: "ext-1", groupId: "g1" }]);
    expect(s.batchUsers).toEqual([{ batchId: "batch-1", userId: "ext-1", createdUser: true, addedToGroup: true }]);
  });

  it("сухой прогон считает заводимых участников, но ничего не заводит", async () => {
    const s = storageStub();
    const res = await runImport(book as never, ON, { ...ctx, groupId: "g1", dryRun: true }, s as never);
    expect(res.usersCreated).toBe(1);
    expect(s.createdUsers).toEqual([]);
    expect(s.memberships).toEqual([]);
    expect(s.batchUsers).toEqual([]);
  });

  it("процент и потолок доезжают до записи прохождения", async () => {
    const s = storageStub();
    const gradedBook = { ...book, rows: [{ ...book.rows[0], points: 72, results: { q1: "incorrect" } }] };
    await runImport(gradedBook as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({ resultPercent: 72, maxPoints: 100, totalPoints: 72, resultPassed: true });
  });

  it("сухой прогон считает, но ничего не создаёт", async () => {
    const s = storageStub();
    const res = await runImport(book as never, ON, { ...ctx, dryRun: true }, s as never);
    expect(res.rowsCreated).toBe(1);
    expect(s.batches).toHaveLength(0);
    expect(s.attempts).toHaveLength(0);
    expect(s.exposureRebuilds).toHaveLength(0);
  });

  it("выданный состав пишется на прохождение, экспозиция теста пересчитывается (PRD-55 FR-08)", async () => {
    const s = storageStub();
    // q1 — задание теста, q9 — чужое: экспозицию несуществующему заданию не заводят.
    const delivered = { ...book, questionIds: ["q1", "q9"], rows: [{ ...book.rows[0], answers: { q1: "", q9: "1" } }] };
    await runImport(delivered as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({ deliveredQuestionIds: ["q1"] });
    expect(s.exposureRebuilds).toEqual(["t1"]);
  });

  it("выданное, но не отвеченное задание входит в выданный состав", () => {
    const plan = buildImportPlan({ ...book, rows: [{ ...book.rows[0], answers: { q1: "" } }] } as never, ON);
    expect(plan.rows[0].deliveredQuestionIds).toEqual(["q1"]);
  });

  it("ответ раскладывается по типу вопроса, исход берётся из файла", async () => {
    const s = storageStub();
    await runImport(book as never, ON, ctx, s as never);
    expect(s.answers[0]).toHaveLength(1);
    // 0-based у распределения — разбор обязан воспроизводить формат выданных пакетов.
    expect(s.answers[0][0]).toMatchObject({
      questionId: "q1",
      userAnswerJson: { 0: 7, 1: 0 },
      result: "neutral",
      isCorrect: null,
      points: null,
    });
  });

  it("версия формата строки доезжает до разбора ответа", async () => {
    // Та же строка в НОВОМ формате: индексы 1-based, версия сообщена пакетом. Разбор обязан
    // вернуть тот же ответ, что и легаси-строка выше, иначе импорт съедет на единицу.
    const aligned = {
      ...book,
      rows: [{ ...book.rows[0], answers: { q1: "1[.]7,2[.]0" }, responseFormat: 2 }],
    };
    const s = storageStub();
    await runImport(aligned as never, ON, ctx, s as never);
    expect(s.answers[0][0]).toMatchObject({ questionId: "q1", userAnswerJson: { 0: 7, 1: 0 } });
  });

  it("время на задании переносится из выгрузки в миллисекундах", async () => {
    // Колонка отчёта даёт целые секунды, в базе время лежит в миллисекундах — как и у живой
    // телеметрии, иначе два источника нельзя было бы сравнивать в одном запросе.
    const timed = {
      ...book,
      rows: [{ ...book.rows[0], latencySeconds: { q1: 47 } }],
    };
    const s = storageStub();
    await runImport(timed as never, ON, ctx, s as never);
    expect(s.answers[0][0]).toMatchObject({ latencyMs: 47000 });
  });

  it("без измеренного времени в базу идёт NULL, а не ноль", async () => {
    const s = storageStub();
    await runImport(book as never, ON, ctx, s as never);
    expect(s.answers[0][0]).toMatchObject({ latencyMs: null });
  });

  it("вопрос не из этого теста даёт предупреждение и не роняет импорт", async () => {
    const alien = { ...book, questionIds: ["q1", "zzz"] };
    const s = storageStub();
    const res = await runImport(alien as never, ON, ctx, s as never);
    expect(res.rowsCreated).toBe(1);
    expect(res.warnings.join()).toContain("не из этого теста");
  });

  it("у измерительного задания пустой исход остаётся нейтральным (PRD-66 FR-10a)", async () => {
    // `allocation` эталона не имеет вовсе: ни верным, ни неверным его ответ быть не может.
    const blank = { ...book, rows: [{ ...book.rows[0], results: { q1: "" } }] };
    const s = storageStub();
    await runImport(blank as never, ON, ctx, s as never);
    expect(s.answers[0][0]).toMatchObject({ result: "neutral", isCorrect: null });
  });

  it("у оцениваемого задания пустой исход наблюдением не становится", async () => {
    // Раньше пустая ячейка сводилась к `neutral` — и задание, исход которого файл не сообщил,
    // выглядело измерительным. Приписать ему «неверно» значило бы выдумать ответ, которого
    // участник мог и не дать; записать `neutral` — объявить измерительным то, что оценивается.
    // Наблюдения нет, и партия об этом говорит.
    const graded = {
      ...book,
      rows: [{ ...book.rows[0], answers: { q2: "1" }, results: { q2: "" } }],
    };
    const s = storageStub();
    s.getQuestionsByIds = async (ids: string[]) =>
      [{ id: "q2", type: "single", prompt: "Вопрос", topicId: "t1", correctJson: { correctIndex: 0 } }]
        .filter((q) => ids.includes(q.id)) as never;

    const res = await runImport({ ...graded, questionIds: ["q2"] } as never, ON, ctx, s as never);

    expect(s.answers[0]).toHaveLength(0);
    expect(res.warnings.join()).toContain("без исхода");
  });

  it("несопоставленные взаимодействия ХРАНЯТСЯ на партии (PRD-66 FR-11)", async () => {
    // Протокол загрузки живёт ровно один раз — в момент импорта. Психометрике же доля потерь
    // нужна потом и постоянно: она показывается рядом с числом наблюдений как видимая потеря
    // выборки, иначе читатель считает неполную партию полной.
    const alien = {
      ...book,
      questionIds: ["q1", "zzz"],
      rows: [{ ...book.rows[0], answers: { q1: "0[.]7", zzz: "1" }, results: { q1: "neutral", zzz: "correct" } }],
    };
    const s = storageStub();

    const res = await runImport(alien as never, ON, ctx, s as never);

    expect(res.rowsUnmatched).toBe(1);
    expect(s.batchPatches.at(-1)).toMatchObject({ rowsUnmatched: 1 });
  });

  it("партия без потерь пишет ноль, а не пропускает поле", async () => {
    const s = storageStub();
    const res = await runImport(book as never, ON, ctx, s as never);
    expect(res.rowsUnmatched).toBe(0);
    expect(s.batchPatches.at(-1)).toMatchObject({ rowsUnmatched: 0 });
  });

  it("пропущенная строка попадает в rowsSkipped", async () => {
    const noDate = { ...book, rows: [{ ...book.rows[0], moduleActivatedAt: "" }] };
    const res = await runImport(noDate as never, ON, ctx, storageStub() as never);
    expect(res).toMatchObject({ rowsTotal: 1, rowsCreated: 0, rowsSkipped: 1 });
  });
});

describe("runImport — версия публикации и варианты (PRD-56 FR-19a)", () => {
  /** Строка выгрузки, сообщившая версию и выданные варианты. */
  const withMeta = (testVersion: number | null, formIds: string[]) => ({
    ...book,
    rows: [{ ...book.rows[0], testVersion, formIds }],
  });

  it("номер версии превращается в снимок и пишется на прохождение", async () => {
    const s = storageStub();
    await runImport(withMeta(3, []) as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({ snapshotId: "snap-3" });
  });

  it("версия спрашивается ОДИН раз на партию, а не на строку", async () => {
    // В файле тысячи прохождений и три-четыре версии: запрос на строку превратил бы загрузку
    // в тысячу обращений к базе.
    const s = storageStub();
    const many = { ...book, rows: [0, 1, 2].map((i) => ({
      ...book.rows[0], participantName: `Иванов ${i}`, testVersion: 3, formIds: [],
    })) };
    await runImport(many as never, ON, ctx, s as never);
    expect(s.snapshotLookups).toEqual([3]);
  });

  it("версия, которой у теста нет, оставляет прохождение без версии и предупреждает", async () => {
    const s = storageStub();
    const res = await runImport(withMeta(99, []) as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({ snapshotId: null });
    expect(res.warnings.join()).toContain("99");
  });

  it("прохождение пакета прошлой сборки идёт без версии и без запроса", async () => {
    const s = storageStub();
    await runImport(book as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({ snapshotId: null });
    expect(s.snapshotLookups).toEqual([]);
  });

  it("варианты разворачиваются в карту «тема -> вариант» по разделам теста", async () => {
    // Выгрузка знает только идентификаторы форм; тему им возвращает набор форм раздела —
    // так `forms_json` импорта совпадает по форме с телеметрией и с вебом.
    const s = storageStub();
    await runImport(withMeta(3, ["form-a"]) as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({ formsJson: { t1: "form-a" } });
  });

  it("вариант, которого в тесте больше нет, предупреждает, но не роняет загрузку", async () => {
    const s = storageStub();
    const res = await runImport(withMeta(3, ["form-zzz"]) as never, ON, ctx, s as never);
    expect(res.rowsCreated).toBe(1);
    expect(s.attempts[0]).toMatchObject({ formsJson: null });
    expect(res.warnings.join()).toContain("form-zzz");
  });
});

/**
 * PRD-57 FR-34: новые взаимодействия отчёта. Пакет кодирует текстовые ответы с Э3, Э8 и
 * Э9; до этого разбор их не знал, и ответ участника при импорте терялся целиком.
 */
describe("runImport — текстовые взаимодействия (PRD-57 FR-34)", () => {
  /** Та же книга, но вопрос текстовый: заглушка отдаёт его тип и эталон. */
  function textBook(raw: string, result: string) {
    return { ...book, rows: [{ ...book.rows[0], answers: { q1: raw }, results: { q1: result } }] };
  }

  function typedStorage(question: Record<string, unknown>) {
    const s = storageStub();
    s.getQuestionsByIds = async (ids: string[]) =>
      [{ id: "q1", prompt: "Вопрос", topicId: "t1", ...question }].filter((q) => ids.includes(q.id)) as never;
    return s;
  }

  it("короткий ответ приезжает текстом как набран", async () => {
    const s = typedStorage({ type: "short", correctJson: { answerKind: "text", join: "any", rules: [] } });
    await runImport(textBook("3,14", "neutral") as never, ON, ctx, s as never);
    expect(s.answers[0][0]).toMatchObject({ userAnswerJson: "3,14" });
  });

  it("развёрнутый ответ не считается неверным: у него нечего проверять", async () => {
    const s = typedStorage({ type: "long", correctJson: {} });
    await runImport(textBook("Сначала обесточить.", "neutral") as never, ON, ctx, s as never);
    expect(s.answers[0][0]).toMatchObject({
      userAnswerJson: "Сначала обесточить.",
      result: "neutral",
      isCorrect: null,
    });
  });

  it("пропуски раскладываются по именам эталона", async () => {
    const s = typedStorage({
      type: "blanks",
      correctJson: {
        blanks: [
          { id: "city", answerKind: "text", join: "any", rules: [] },
          { id: "year", answerKind: "number", join: "any", rules: [] },
        ],
      },
    });
    await runImport(textBook("Москва[,]1703", "correct") as never, ON, ctx, s as never);
    expect(s.answers[0][0]).toMatchObject({ userAnswerJson: { city: "Москва", year: "1703" } });
  });
});

/**
 * Уровни тем и рекомендованные курсы: импорт пишет их в те же колонки и той же формы, что
 * живая телеметрия, — иначе листы «Статистика уровней» и «Рекомендации» не видели бы LMS-импорт.
 */
describe("runImport — уровни и рекомендованные курсы тем", () => {
  /** Строка книги с блоками тем. */
  const withTopics = (topicLevels: Record<string, string>, topicCourses: Record<string, string[]>) => ({
    ...book,
    rows: [{ ...book.rows[0], topicLevels, topicCourses }],
  });

  /**
   * Заглушка со справочниками: тема `t1` (курс в `feedback_json`) и адаптивный уровень темы `t2`
   * со ссылкой. Помнит, сколько раз читались справочники.
   */
  function topicStorage() {
    const s = storageStub();
    const lookups = { topics: 0 };
    const topics: Record<string, { id: string; name: string }> = {
      t1: { id: "t1", name: "Электробезопасность" },
      t2: { id: "t2", name: "Охрана труда" },
    };
    return Object.assign(s, {
      lookups,
      getTopic: async (id: string) => { lookups.topics += 1; return topics[id]; },
      getTopicCourses: async (topicId: string) => topicId === "t1"
        ? [{ id: "c1", topicId, title: "Курс по электробезопасности", url: "https://wt/view_doc.html?mode=course&object_id=111&x=1" }]
        : [],
      getAdaptiveLevelsByTest: async () => [{ id: "lvl-1", topicId: "t2", levelIndex: 0, levelName: "Базовый" }],
      getAdaptiveLevelLinks: async (levelId: string) => levelId === "lvl-1"
        ? [{ id: "l1", levelId, title: "Курс по охране труда", url: "https://wt/view_doc.html?object_id=222" }]
        : [],
    });
  }

  it("уровень пишется с именем темы, «Уровень не достигнут» — как levelName: null", async () => {
    const s = topicStorage();
    await runImport(withTopics({ t1: "Продвинутый", t2: "Уровень не достигнут" }, {}) as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({
      achievedLevelsJson: [
        { topicId: "t1", topicName: "Электробезопасность", levelName: "Продвинутый" },
        { topicId: "t2", topicName: "Охрана труда", levelName: null },
      ],
      failedTopicCoursesJson: null,
    });
  });

  it("object_id находит курс темы и ссылку уровня адаптивного теста", async () => {
    const s = topicStorage();
    await runImport(withTopics({}, { t1: ["111"], t2: ["222"] }) as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({
      achievedLevelsJson: null,
      failedTopicCoursesJson: [
        { title: "Курс по электробезопасности", url: "https://wt/view_doc.html?mode=course&object_id=111&x=1" },
        { title: "Курс по охране труда", url: "https://wt/view_doc.html?object_id=222" },
      ],
    });
  });

  it("ненайденный object_id не теряется: условное название без адреса", async () => {
    const s = topicStorage();
    await runImport(withTopics({}, { t1: ["999"] }) as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({
      failedTopicCoursesJson: [{ title: "Курс WebTutor 999", url: "" }],
    });
  });

  it("один курс у двух тем попадает в рекомендации один раз", async () => {
    const s = topicStorage();
    await runImport(withTopics({}, { t1: ["111"], t2: ["111", "222"] }) as never, ON, ctx, s as never);
    const courses = (s.attempts[0] as { failedTopicCoursesJson: Array<{ title: string }> }).failedTopicCoursesJson;
    expect(courses.map((c) => c.title)).toEqual(["Курс по электробезопасности", "Курс по охране труда"]);
  });

  it("без блоков тем справочники не читаются, а колонки пишутся пустыми", async () => {
    const s = topicStorage();
    await runImport(book as never, ON, ctx, s as never);
    expect(s.lookups.topics).toBe(0);
    expect(s.attempts[0]).toMatchObject({ achievedLevelsJson: null, failedTopicCoursesJson: null });
  });
});

describe("PRD-54 раздел 8.1: попытки одного участника за одну дату", () => {
  /** Две строки одного человека за одну дату, различающиеся ответом. */
  const twoSameDay = {
    ...book,
    rows: [
      { ...book.rows[0], answers: { q1: "0[.]7,1[.]0" } },
      { ...book.rows[0], answers: { q1: "0[.]3,1[.]4" } },
    ],
  };
  const marked = (mark: string, over: Record<string, unknown> = {}) => ({
    ...book.rows[0], registrationMark: mark, ...over,
  });

  it("две строки за одну дату получают разные ключи и обе записываются (BR-54-34)", async () => {
    const plan = buildImportPlan(twoSameDay as never, ON);
    expect(plan.rows[0].attemptKey).not.toBe(plan.rows[1].attemptKey);
    expect(plan.rows.map((r) => r.attemptKey)).toEqual([
      expect.stringMatching(/^c:[0-9a-f]{16}:1$/),
      expect.stringMatching(/^c:[0-9a-f]{16}:1$/),
    ]);

    const s = storageStub();
    const res = await runImport(twoSameDay as never, ON, ctx, s as never);
    expect(s.attempts).toHaveLength(2);
    expect(res.rowsCreated).toBe(2);
  });

  it("одинаковое содержимое не схлопывается: порядковый номер различает строки (BR-54-36)", () => {
    const twins = { ...book, rows: [book.rows[0], book.rows[0]] };
    const [a, b] = buildImportPlan(twins as never, ON).rows;
    expect(a.attemptKey.replace(/:1$/, "")).toBe(b.attemptKey.replace(/:2$/, ""));
    expect(a.attemptKey).toMatch(/:1$/);
    expect(b.attemptKey).toMatch(/:2$/);
  });

  it("повторная загрузка того же файла даёт те же ключи", () => {
    const first = buildImportPlan(twoSameDay as never, ON).rows.map((r) => r.attemptKey);
    const second = buildImportPlan(twoSameDay as never, OFF).rows.map((r) => r.attemptKey);
    // Режим обезличивания в отпечаток не входит: ФИО — поле личности, а не содержимого.
    expect(second).toEqual(first);
  });

  it("метка регистрации становится ключом, и он не зависит от содержимого (BR-54-35)", () => {
    const before = buildImportPlan({ ...book, rows: [marked("lx1a2b3c")] } as never, ON).rows[0];
    const after = buildImportPlan(
      { ...book, rows: [marked("lx1a2b3c", { points: 90 })] } as never, ON,
    ).rows[0];
    expect(before.attemptKey).toBe("r:lx1a2b3c");
    expect(after.attemptKey).toBe("r:lx1a2b3c");
    expect(before.marked).toBe(true);
  });

  it("метка в отпечаток не входит: строка с меткой и без неё дают один contentKey", () => {
    const plain = buildImportPlan(book as never, ON).rows[0];
    const withMark = buildImportPlan({ ...book, rows: [marked("lx1a2b3c")] } as never, ON).rows[0];
    expect(withMark.contentKey).toBe(plain.contentKey);
  });

  it("протокол называет число участников с несколькими строками за дату", () => {
    const plan = buildImportPlan(twoSameDay as never, ON);
    expect(plan.warnings.join()).toContain("Несколько прохождений одного участника за одну дату: 1");
    expect(buildImportPlan(book as never, ON).warnings.join()).not.toContain("Несколько прохождений");
  });

  it("запись без различителя перенимает ключ первой строки файла, вторая создаётся (BR-54-37)", async () => {
    const plan = buildImportPlan(twoSameDay as never, ON);
    const { participantKey, startedAt } = plan.rows[0];
    const s = storageStub({}, {}, [{ id: "legacy-1", participantKey, startedAt, attemptKey: null }]);

    await runImport(twoSameDay as never, ON, ctx, s as never);

    expect(s.keyTransfers).toEqual([{ id: "legacy-1", attemptKey: plan.rows[0].attemptKey }]);
    expect(s.attempts).toHaveLength(2);
  });

  it("строка с меткой перенимает запись, загруженную по её отпечатку до пересборки пакета", async () => {
    const plain = buildImportPlan(book as never, ON).rows[0];
    const s = storageStub({}, {}, [{
      id: "old-c", participantKey: plain.participantKey, startedAt: plain.startedAt, attemptKey: plain.contentKey,
    }]);

    const res = await runImport({ ...book, rows: [marked("lx1a2b3c")] } as never, { ...ON }, { ...ctx, dryRun: true }, s as never);
    expect(res.rowsUpdated).toBe(1);
    expect(res.rowsCreated).toBe(0);
    // Сухой прогон ничего не пишет, в том числе не передаёт ключей.
    expect(s.keyTransfers).toEqual([]);

    await runImport({ ...book, rows: [marked("lx1a2b3c")] } as never, ON, ctx, s as never);
    expect(s.keyTransfers).toEqual([{ id: "old-c", attemptKey: "r:lx1a2b3c" }]);
  });

  it("строка БЕЗ метки чужой отпечаток не перенимает и попадает в протокол", async () => {
    const plain = buildImportPlan(book as never, ON).rows[0];
    const s = storageStub({}, {}, [{
      id: "other", participantKey: plain.participantKey, startedAt: plain.startedAt, attemptKey: "c:0000000000000000:1",
    }]);

    const res = await runImport(book as never, ON, ctx, s as never);

    expect(s.keyTransfers).toEqual([]);
    expect(res.warnings.join()).toContain("не совпавших с уже загруженными прохождениями того же участника за ту же дату: 1");
  });

  it("строки одного файла друг с другом в протокол «не совпало» не идут", async () => {
    // Найдено приёмкой: три строки за одну дату в пустой базе давали «не совпавших: 2».
    const res = await runImport(twoSameDay as never, ON, { ...ctx, dryRun: true }, storageStub() as never);
    expect(res.warnings.join()).not.toContain("не совпавших");
  });

  it("сухой прогон считает добавленные и обновлённые по базе", async () => {
    const plan = buildImportPlan(twoSameDay as never, ON);
    const s = storageStub({}, {}, [{
      id: "a", participantKey: plan.rows[0].participantKey, startedAt: plan.rows[0].startedAt,
      attemptKey: plan.rows[0].attemptKey,
    }]);

    const res = await runImport(twoSameDay as never, ON, { ...ctx, dryRun: true }, s as never);

    expect(res.rowsUpdated).toBe(1);
    expect(res.rowsCreated).toBe(1);
    expect(s.attempts).toEqual([]);
  });

  it("ключ уходит в запись прохождения", async () => {
    const s = storageStub();
    await runImport({ ...book, rows: [marked("lx1a2b3c")] } as never, ON, ctx, s as never);
    expect((s.attempts[0] as { attemptKey: string }).attemptKey).toBe("r:lx1a2b3c");
  });
});

describe("runImport — «Сценарий в ИС» (Э5б)", () => {
  /** Шаги `performance` и доля цены числом — как их пишет пакет (Э4). */
  const steps = "outcome[.]exited[,]goal[.]0[,]misses[.]0[,]blocked[.]0[,]wrong[.]0[,]detours[.]1[,]traps[.]0[,]hints[.]0";
  const simBook = (result: string, protocol?: string) => ({
    ...book,
    rows: [{ ...book.rows[0], answers: { q1: steps }, results: { q1: result }, simProtocols: protocol ? { q1: protocol } : {} }],
  });
  /** Сценарий из одной сцены с одним шагом в сторону: щелчок по нему и выход. */
  const scenario = {
    meta: { title: "Мини" },
    settings: {},
    media: [{ id: "bg", file: "media/bg.png", w: 100, h: 100 }],
    fields: [],
    start: "home",
    scenes: [
      { id: "home", title: "Стол", elements: [{ id: "bg", media: "bg", x: 0, y: 0 }], zones: [
        { id: "side", x: 0, y: 0, w: 10, h: 10, role: "detour", effects: [{ goto: "away" }] },
      ] },
      { id: "away", title: "В стороне", elements: [{ id: "bg", media: "bg", x: 0, y: 0 }], zones: [] },
    ],
  };
  const withSim = () => ({
    ...storageStub(),
    getQuestionsByIds: async () => [{ id: "q1", type: "simulation", prompt: "Задание", topicId: "t1", dataJson: { scenario } }],
  });

  it("доля цены — в баллы, прогон — повтором протокола", async () => {
    const s = withSim();
    const res = await runImport(simBook("0.75", "1;aside@3e8;x@3e8;z@0") as never, ON, ctx, s as never);
    const row = (s as unknown as { answers: Array<Array<Record<string, unknown>>> }).answers[0][0];
    expect(row).toMatchObject({ questionType: "simulation", result: "incorrect", isCorrect: false, points: 0.75, maxPoints: 1 });
    const run = row.userAnswerJson as { outcome: string; durationMs: number; events: Array<{ type: string }> };
    expect(run.outcome).toBe("exited");
    // Конец прогона — по маркеру `z`: повтор сам знает лишь время последнего ввода.
    expect(run.durationMs).toBe(2 * parseInt("3e8", 36));
    expect(run.events.map((e) => e.type)).toContain("enter");
    expect(res.warnings.join(" ")).not.toContain("Протоколов сценариев");
  });

  it("без протокола остаются шаги; несовпавший протокол — шаги и предупреждение", async () => {
    const plain = withSim();
    await runImport(simBook("1") as never, ON, ctx, plain as never);
    const first = (plain as unknown as { answers: Array<Array<Record<string, unknown>>> }).answers[0][0];
    expect(first).toMatchObject({ userAnswerJson: steps, result: "correct", points: 1 });

    const foreign = withSim();
    const res = await runImport(simBook("0", "1;anope@0") as never, ON, ctx, foreign as never);
    expect((foreign as unknown as { answers: Array<Array<Record<string, unknown>>> }).answers[0][0]).toMatchObject({ userAnswerJson: steps });
    expect(res.warnings.join(" ")).toContain("Протоколов сценариев, не совпавших со сценарием вопроса: 1");
  });

  it("исход без доли цены — пробел, а не «неверно»", async () => {
    const s = withSim();
    await runImport(simBook("") as never, ON, ctx, s as never);
    expect((s as unknown as { answers: unknown[][] }).answers[0]).toEqual([]);
  });
});

describe("runImport — частичный балл (PRD-54, решение 13)", () => {
  const partialBook = (result: string) => ({
    ...book,
    rows: [{ ...book.rows[0], answers: { q1: "1,3" }, results: { q1: result } }],
  });
  const withMultiple = () => ({
    ...storageStub(),
    getQuestionsByIds: async () => [{ id: "q1", type: "multiple", prompt: "Вопрос", topicId: "t1" }],
  });
  const firstRow = (s: unknown) => (s as { answers: Array<Array<Record<string, unknown>>> }).answers[0][0];

  it("доля числом — в баллы при потолке 1, исход «неверно», как у веба", async () => {
    const s = withMultiple();
    await runImport(partialBook("0.5") as never, ON, ctx, s as never);
    expect(firstRow(s)).toMatchObject({ result: "incorrect", isCorrect: false, points: 0.5, maxPoints: 1, userAnswerJson: [0, 2] });
  });

  it("«верно» и «неверно» читаются как раньше — без баллов", async () => {
    const s = withMultiple();
    await runImport(partialBook("correct") as never, ON, ctx, s as never);
    expect(firstRow(s)).toMatchObject({ result: "correct", isCorrect: true, points: null, maxPoints: null });
  });

  it("не число и не исход — пробел, наблюдения нет", async () => {
    const s = withMultiple();
    const res = await runImport(partialBook("наполовину") as never, ON, ctx, s as never);
    expect((s as unknown as { answers: unknown[][] }).answers[0]).toEqual([]);
    expect(res.warnings.join(" ")).toContain("Взаимодействий без исхода");
  });
});

describe("номер и длительность попытки (PRD-54, решение 13)", () => {
  const withMeta = (attemptNumber: number | null, durationSeconds: number | null) => ({
    ...book,
    rows: [{ ...book.rows[0], attemptNumber, durationSeconds }],
  });

  it("конец прохождения — начало плюс длительность; номер — из блока", () => {
    const plan = buildImportPlan(withMeta(3, 1240) as never, ON);
    const row = plan.rows[0];
    expect(row.finishedAt.getTime() - row.startedAt.getTime()).toBe(1_240_000);
    expect(row.attemptNumber).toBe(3);
  });

  it("не сообщено — конец равен началу, номер в записи — 1, как прежде", async () => {
    const plan = buildImportPlan(withMeta(null, null) as never, ON);
    expect(plan.rows[0].finishedAt.getTime()).toBe(plan.rows[0].startedAt.getTime());
    const s = storageStub();
    await runImport(withMeta(null, null) as never, ON, ctx, s as never);
    expect((s as unknown as { attempts: Array<Record<string, unknown>> }).attempts[0]).toMatchObject({ attemptNumber: 1 });
  });

  it("номер доезжает до записи прохождения", async () => {
    const s = storageStub();
    await runImport(withMeta(2, 60) as never, ON, ctx, s as never);
    expect((s as unknown as { attempts: Array<Record<string, unknown>> }).attempts[0]).toMatchObject({ attemptNumber: 2 });
  });
});
