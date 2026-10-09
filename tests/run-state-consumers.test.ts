/**
 * @module tests/run-state-consumers
 * @description PRD-36 FR-07/FR-08/FR-09: экраны, отчёт и гейт работают по СВОДКЕ, а
 * повопросные данные для interactions разворачиваются из позиций лучшей попытки. Файл
 * сторожит то, что легко потерять при переходе на новый формат: массив попыток не читает
 * никто, отчёт в LMS строится по статусам ТОЙ попытки, а не текущей, и повторный вход
 * в назначение опознаётся у пакетов обоих форматов.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const resultsSrc = read("server/scorm/template/app/render/resultsPage.js");
const startSrc = read("server/scorm/template/app/render/startPage.js");
const pdfSrc = read("server/scorm/template/app/utils/pdfExport.js");
const gateSrc = read("server/scorm/template/app/eligibility/gate.js");
const suspendSrc = read("server/scorm/template/app/utils/scorm/suspendAttempts.js");
const runStateSrc = read("server/scorm/template/app/utils/scorm/runState.js");

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${runStateSrc}\nreturn TBRunState;`)() as any;

describe("массив попыток не читает никто", () => {
  it("хелпера getAllAttempts больше нет", () => {
    // Заглушка вместо него вернула бы пустой список, и экран старта молча решил бы,
    // что завершённых попыток не было.
    expect(suspendSrc).not.toMatch(/function getAllAttempts/);
    expect(resultsSrc).not.toMatch(/getAllAttempts\(\)/);
    expect(startSrc).not.toMatch(/getAllAttempts\(\)/);
    expect(pdfSrc).not.toMatch(/getAllAttempts\(\)/);
  });

  it("запись попытки не дописывается в список", () => {
    expect(suspendSrc).not.toMatch(/attempts\.push/);
  });

  it("PDF берёт число попыток из счётчика", () => {
    expect(pdfSrc).toMatch(/attemptsCount: .*getAttemptsUsed\(\)/);
  });
});

describe("отчёт в LMS по лучшей попытке", () => {
  it("собирается из её рядов, а не подменой сохранённых flatQuestions", () => {
    expect(resultsSrc).not.toMatch(/state\.flatQuestions = bestAttempt\.flatQuestions/);
    expect(resultsSrc).toMatch(/TBRunState\.decodeDelivery/);
  });

  it("статусы берутся из ТОЙ попытки (§8, дефект 1)", () => {
    // gradedAnswerFor читает state.questionStatuses; без подстановки статусов попытки
    // interactions прошлой попытки фильтровались бы статусами текущей.
    expect(resultsSrc).toMatch(/state\.questionStatuses = \{\}/);
    expect(resultsSrc).toMatch(/decodeStatuses/);
  });

  it("состояние текущего прогона возвращается на место после сборки", () => {
    expect(resultsSrc).toMatch(/state\.questionStatuses = savedStatuses/);
    expect(resultsSrc).toMatch(/state\.flatQuestions = savedFlatQuestions/);
  });
});

describe("гейт повторного входа", () => {
  it("опознаёт состояние обоих форматов", () => {
    expect(gateSrc).toMatch(/obj\.best/);
    // Легаси-пакеты ещё живут в LMS и пишут свой массив — их учащийся не должен
    // упереться в кулдаун при возврате в СВОЁ назначение.
    expect(gateSrc).toMatch(/obj\.attempts/);
  });
});

describe("разворот сводки для экранов", () => {
  const TEST_DATA = {
    sections: [{
      topicId: "t1",
      topicName: "Право",
      questions: [{ id: "q1", type: "single" }],
      recommendedCourses: [{ title: "Курс", url: "https://example.test" }],
      recommendedEvents: [{ title: "Семинар" }],
      groupKey: "block-a",
    }],
    breakdownKeys: ["ПДн"],
  };
  const summary = {
    n: 2, at: "2026-08-15T10:00:00.000Z", src: "portal",
    pc: 75, c: 3, q: 4, e: 3, p: 4, ok: true,
    t: [{ s: 0, c: 3, q: 4, e: 3, p: 4, pc: 75, ok: true, f: "form-a", r: 70,
      bd: [{ k: 0, i: 2, a: 2, e: 1, p: 2, pp: 50, pu: 50 }] }],
    bd: [{ k: 0, i: 4, a: 4, e: 2, p: 4, pp: 50, pu: 50 }],
    rv: { risk: 12 }, sv: { E: 7 },
  };

  it("название темы, материалы и блок возвращаются из пакета", () => {
    const r = RS.expandSummary(summary, TEST_DATA);
    expect(r.topicResults[0].topicName).toBe("Право");
    expect(r.topicResults[0].recommendedCourses).toEqual([{ title: "Курс", url: "https://example.test" }]);
    expect(r.topicResults[0].recommendedEvents).toEqual([{ title: "Семинар" }]);
    expect(r.topicResults[0].groupKey).toBe("block-a");
  });

  it("порог, по которому судили тему, восстанавливается как есть (PRD-24)", () => {
    const r = RS.expandSummary(summary, TEST_DATA);
    expect(r.topicResults[0].resolvedPassRule).toEqual({ type: "percent", value: 70 });
    expect(r.topicResults[0].formId).toBe("form-a");
  });

  it("ключ разреза возвращается текстом, области различимы", () => {
    const r = RS.expandSummary(summary, TEST_DATA);
    expect(r.breakdowns[0]).toMatchObject({ scope: "test", key: "ПДн", percentPoints: 50 });
    expect(r.topicResults[0].breakdown[0]).toMatchObject({ scope: "section:t1", key: "ПДн" });
  });

  it("числа попытки читаются под теми же именами, что у текущего результата", () => {
    const r = RS.expandSummary(summary, TEST_DATA);
    expect(r.percent).toBe(75);
    expect(r.totalCorrect).toBe(3);
    expect(r.totalQuestions).toBe(4);
    expect(r.passed).toBe(true);
    expect(r.completedAt).toBe("2026-08-15T10:00:00.000Z");
    expect(r.resultValues).toEqual({ risk: 12 });
    expect(r.scaleValues).toEqual({ E: 7 });
  });

  it("пустая сводка разворачивается в null, а не в пустой результат", () => {
    expect(RS.expandSummary(null, TEST_DATA)).toBeNull();
  });
});
