/**
 * @module tests/scorm-latency
 *
 * Время на задании доезжает до LMS (техдолг ROADMAP §0.3, PRD-54 §14.2).
 *
 * Колонка «Продолжительность (сек.)» отчёта была пуста всегда по двум причинам сразу:
 * `SCORM.setInteraction` не писал `latency` вовсе, а измерять было и нечего — пакет не
 * засекал время показа вопроса. Здесь закрепляются обе половины: засечки в цикле показа и
 * запись элемента поверх настоящего API LMS.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatScormDuration } from "@shared/lms-export/duration";
import { createQuestionTime } from "@shared/questions/question-time";

const RUNTIME = "server/scorm/template/app";
const wrapperSrc = readFileSync(resolve(process.cwd(), "server/scorm/assets/runtime.js"), "utf8");
const resultsSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/render/resultsPage.js`), "utf8");
const mainRenderSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/render/mainRender.js`), "utf8");
const adaptiveSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/render/adaptiveRender.js`), "utf8");
const qtypeSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/utils/qtype.js`), "utf8");
const textSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/utils/escapeHtml.js`), "utf8");
const questionTimeSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/utils/questionTime.js`), "utf8");

function extractTopLevel(src: string, name: string): string {
  const m = src.match(new RegExp(`^function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "m"));
  if (!m) throw new Error(`${name} не найдена среди функций верхнего уровня`);
  return m[0];
}

// Функции, из которых собирается взаимодействие. Список приходится держать вручную: тест
// выдёргивает их из файла рантайма, который в модуль не разложен. С Э3 PRD-57 сюда переехал
// `correctPatternFor` (эталон `fill-in`), и пока его здесь не было, три теста этого набора
// падали на `ReferenceError` — а набор никто не гонял.
const SHARED = ["to1", "mapScormType", "formatResponse", "correctPatternFor", "getCorrectAnswerFor", "interactionResultFor", "questionLatency", "buildQuestionInteraction"];

/** The interaction builder over the REAL question-time tracker and a clock we drive. */
function makeBuilder() {
  const clock = { t: 5_000_000 };
  // PRD-66 FR-37: счётчик пакет берёт из общего бандла (`TBTemplate`) — тот же, что и веб.
  // Поэтому в песочницу он и подаётся: подменять здесь нечего, кроме часов.
  const build = new Function(
    "Date",
    "TBTemplate",
    `${qtypeSrc}
     ${textSrc}
     ${questionTimeSrc}
     // Оценка здесь не проверяется: сборщик спрашивает долю цены для исхода (PRD-54, решение 13).
     function checkAnswer() { return 0; }
     ${SHARED.map((n) => extractTopLevel(resultsSrc, n)).join("\n")}
     return { build: buildQuestionInteraction, time: TBQuestionTime };`,
  )({ now: () => clock.t }, { createQuestionTime: () => createQuestionTime(() => clock.t) }) as {
    build: (q: { id: string; type: string; prompt?: string; correct?: unknown }, ans: unknown, ok: boolean) => { latency?: string };
    time: { show: (id: string) => void; leave: () => void };
  };
  return { ...build, clock };
}

/** The real SCORM wrapper over a fake LMS. */
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
    SCORM: SCORM as { init: () => boolean; setInteraction: (i: number, ...rest: unknown[]) => void },
    value: (key: string) => written.filter(([k]) => k === key).map(([, v]) => v),
  };
}

const Q = { id: "q-1", type: "single", prompt: "Вопрос", correct: { correctIndex: 0 } };

describe("взаимодействие несёт время на задании", () => {
  it("длительность берётся у накопителя и пишется по ISO 8601", () => {
    const b = makeBuilder();
    b.time.show("q-1");
    b.clock.t += 95000;
    b.time.leave();
    expect(b.build(Q, 0, true).latency).toBe("PT1M35S");
  });

  it("вопрос, который не показывали, времени не заявляет", () => {
    // Пустая строка, а не «PT0S»: ноль означал бы «ответил мгновенно».
    const b = makeBuilder();
    expect(b.build(Q, 0, true).latency).toBe("");
  });

  it("формат совпадает с общим модулем, а не пересказывает его", () => {
    const b = makeBuilder();
    b.time.show("q-1");
    b.clock.t += 3725000;
    b.time.leave();
    expect(b.build(Q, 0, true).latency).toBe(formatScormDuration(3725000));
  });
});

describe("запись latency в LMS", () => {
  it("элемент пишется, когда длительность известна", () => {
    const s = makeScorm();
    s.SCORM.init();
    s.SCORM.setInteraction(0, "q_1", "choice", "correct", "1", "1", "Вопрос", "PT35S");
    expect(s.value("cmi.interactions.0.latency")).toEqual(["PT35S"]);
  });

  it("пустая длительность НЕ пишется вовсе", () => {
    // Тот же приём, что у описания и эталона: молчание честнее нуля.
    const s = makeScorm();
    s.SCORM.init();
    s.SCORM.setInteraction(0, "q_1", "choice", "correct", "1", "1", "Вопрос", "");
    expect(s.value("cmi.interactions.0.latency")).toEqual([]);
  });

  it("finish передаёт длительность каждого взаимодействия", () => {
    const s = makeScorm();
    s.SCORM.init();
    (s.SCORM as unknown as { finish: (a: unknown, b: unknown, c: boolean, o: unknown[], i: unknown[]) => void }).finish(
      80, 100, true, [],
      [{ id: "q_1", type: "choice", result: "correct", response: "1", correct: "1", description: "Вопрос", latency: "PT12S" }],
    );
    expect(s.value("cmi.interactions.0.latency")).toEqual(["PT12S"]);
  });
});

describe("засечки в цикле показа вопроса", () => {
  it("обычный рендер отмечает показанный вопрос", () => {
    expect(mainRenderSrc).toContain("TBQuestionTime.show(");
  });

  it("уход с вопроса закрывает заход", () => {
    expect(mainRenderSrc).toContain("TBQuestionTime.leave()");
  });

  it("адаптивный путь тоже измеряет — у него свой рендер вопроса", () => {
    expect(adaptiveSrc).toContain("TBQuestionTime.show(");
  });

  it("сборщик взаимодействия спрашивает накопитель ровно в одном месте", () => {
    expect((resultsSrc.match(/TBQuestionTime\.totalMsFor\(/g) || []).length).toBe(1);
  });
});

/**
 * PRD-57 FR-33: время на задании собирается у новых типов так же, как у прочих.
 *
 * Замер ведётся по ПОКАЗУ задания, а не по виду ответа, поэтому «должно работать само
 * собой» — и именно поэтому проверяется: у открытого ответа время единственная объективная
 * метрика вовлечённости, и молчаливая потеря замера не проявилась бы ничем.
 */
describe("время на задании у текстовых типов (PRD-57 FR-33)", () => {
  const CASES: Array<{ type: string; answer: unknown; correct?: unknown }> = [
    { type: "short", answer: "Ростехнадзор", correct: { answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }] } },
    { type: "long", answer: "Сначала обесточить.", correct: {} },
    {
      type: "blanks",
      answer: { city: "Москва" },
      correct: { blanks: [{ id: "city", answerKind: "text", join: "any", rules: [] }] },
    },
  ];

  it.each(CASES)("$type: взаимодействие несёт замер", ({ type, answer, correct }) => {
    const b = makeBuilder();
    b.time.show("q-1");
    b.clock.t += 62_000;
    b.time.leave();
    const interaction = b.build({ id: "q-1", type, prompt: "Вопрос", correct }, answer, true);
    expect(interaction.latency).toBe("PT1M2S");
  });

  it("замер суммирует заходы: участник возвращается к открытому заданию дописать", () => {
    const b = makeBuilder();
    b.time.show("q-1");
    b.clock.t += 30_000;
    b.time.leave();
    b.time.show("q-1");
    b.clock.t += 45_000;
    b.time.leave();
    expect(b.build({ id: "q-1", type: "long", prompt: "Вопрос", correct: {} }, "текст", true).latency)
      .toBe("PT1M15S");
  });

  it("событие телеметрии шлёт замер независимо от типа задания", () => {
    // Ветки по типу в отправке события нет вовсе: `latencyMs` берётся у накопителя один раз
    // на весь путь фиксации ответа — значит новые типы попадают в него вместе со старыми.
    const feedbackSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/feedback/feedback.js`), "utf8");
    expect(feedbackSrc).toContain("TBQuestionTime.totalMsFor(q.id)");
    expect((feedbackSrc.match(/latencyMs:/g) || []).length).toBe(1);
  });
});
