/**
 * @module tests/scorm-root-score
 *
 * Что пакет сообщает LMS корневым баллом (`cmi.score.*`) — и чего НЕ сообщает.
 *
 * Измерительный тест уезжал в LMS как «Пройден, 0 баллов»: вердикт верен по построению
 * (порог не к чему применить, PRD-26 FR-09), а ноль — нет. Уровнем ниже, у целей, пакет
 * ведёт себя аккуратно с 2026-08: `buildTopicObjective` блок score измерительной темы
 * пропускает. Здесь та же аккуратность закрепляется для КОРНЕВОГО балла.
 *
 * Как и в соседнем `scorm-topic-objectives`, запись проверяется исполнением настоящего
 * `assets/runtime.js` поверх поддельного API LMS: не записанный элемент и записанный нулём
 * в коде выглядят одинаково, а в отчёте заказчика — по-разному.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const wrapperSrc = readFileSync(resolve(process.cwd(), "server/scorm/assets/runtime.js"), "utf8");
const resultsSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
  "utf8",
);

/** The real SCORM wrapper over a fake LMS, so writes can be observed element by element. */
function makeScorm() {
  const written: Array<[string, string]> = [];
  const api = {
    Initialize: () => "true",
    SetValue: (k: string, v: string) => { written.push([k, v]); return "true"; },
    GetValue: () => "",
    Commit: () => "true",
    Terminate: () => "true",
    GetLastError: () => "0",
  };
  const win: Record<string, unknown> = { API_1484_11: api };
  win.parent = win;
  const SCORM = new Function("window", "console", `${wrapperSrc}\nreturn SCORM;`)(win, { log() {} });
  return {
    SCORM: SCORM as {
      init: () => boolean;
      finish: (raw: number | null, max: number | null, passed: boolean, o: unknown[], i: unknown[]) => void;
    },
    keys: () => written.map(([k]) => k),
    value: (key: string) => written.filter(([k]) => k === key).map(([, v]) => v),
  };
}

describe("корневой балл оцениваемого теста", () => {
  it("едет полностью: raw, min, max, scaled", () => {
    const s = makeScorm();
    s.SCORM.init();
    s.SCORM.finish(83, 100, true, [], []);

    expect(s.value("cmi.score.raw")).toEqual(["83"]);
    expect(s.value("cmi.score.min")).toEqual(["0"]);
    expect(s.value("cmi.score.max")).toEqual(["100"]);
    expect(s.value("cmi.score.scaled")).toEqual(["0.83"]);
  });

  it("вердикт и завершение отправляются как прежде", () => {
    const s = makeScorm();
    s.SCORM.init();
    s.SCORM.finish(83, 100, true, [], []);

    expect(s.value("cmi.success_status")).toEqual(["passed"]);
    expect(s.value("cmi.completion_status")).toEqual(["completed"]);
  });
});

describe("корневой балл измерительного теста", () => {
  it("НЕ отправляется вовсе — ни одного элемента cmi.score", () => {
    // SCORM 2004 допускает отсутствие cmi.score. «0 из 100» — утверждение, которого у нас нет.
    const s = makeScorm();
    s.SCORM.init();
    s.SCORM.finish(null, null, true, [], []);

    expect(s.keys().filter((k) => k.indexOf("cmi.score") === 0)).toEqual([]);
  });

  it("вердикт «пройден» при этом сохраняется", () => {
    // Снимается утверждение о БАЛЛЕ, а не о прохождении: опросник пройден по построению.
    const s = makeScorm();
    s.SCORM.init();
    s.SCORM.finish(null, null, true, [], []);

    expect(s.value("cmi.success_status")).toEqual(["passed"]);
    expect(s.value("cmi.completion_status")).toEqual(["completed"]);
  });
});

describe("оба пути завершения решают про балл ОДНОЙ функцией", () => {
  // Путей два — обычный и адаптивный, — и раньше каждый слал балл сам по себе.
  it("обычный путь спрашивает lmsScoreFor", () => {
    const start = resultsSrc.indexOf("function finishScormLmsOnly(");
    const body = resultsSrc.slice(start).match(/^function [^\n]*\n[\s\S]*?\n\}/)![0];
    expect(body).toContain("lmsScoreFor");
  });

  it("адаптивный путь спрашивает lmsScoreFor", () => {
    const start = resultsSrc.indexOf("function finishScormAdaptive(");
    const body = resultsSrc.slice(start).match(/^function [^\n]*\n[\s\S]*?\n\}/)![0];
    expect(body).toContain("lmsScoreFor");
  });

  it("обычный путь передаёт помощнику настоящий вердикт и проходной теста", () => {
    // WebTutor ставит «Пройден» / «Не пройден» по баллам против проходного курса и не читает
    // success_status (стенд, 2026-09-30): вердикт пакета доезжает только через баллы.
    const start = resultsSrc.indexOf("function finishScormLmsOnly(");
    const body = resultsSrc.slice(start).match(/^function [^\n]*\n[\s\S]*?\n\}/)![0];
    expect(body).toContain("passed: (results.gradingComplete === false || typeof verdictForLms !== 'boolean') ? null : verdictForLms");
    expect(body).toContain("lmsThreshold: TEST_DATA.passPercent");
  });

  it("безусловной отправки процента больше нет ни в одном пути", () => {
    expect(resultsSrc).not.toContain("SCORM.finish(percentScore, 100");
  });
});
