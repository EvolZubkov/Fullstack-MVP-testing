/**
 * @module tests/scorm-topic-objectives
 *
 * Как результат ТЕМЫ попадает в цель SCORM 2004 (`cmi.objectives.n.*`).
 *
 * Раньше цель несла четыре элемента, и `score.raw` держал ПРОЦЕНТ — число без шкалы:
 * «18» в отчёте LMS не отвечало на вопрос «из скольких». Теперь цель несёт баллы вместе
 * со своей шкалой (`min`/`max`/`scaled`) и имя темы текстом, потому что по одному
 * `topic_<uuid>` тему в отчёте не опознать.
 *
 * Проверяется и сборка (resultsPage.js), и ЗАПИСЬ (assets/runtime.js) — последняя
 * исполняется по-настоящему, поверх поддельного API LMS: молча не записанный элемент и
 * записанный пустой строкой выглядят в коде одинаково, а в отчёте по-разному.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
  "utf8",
);
const wrapperSrc = readFileSync(resolve(process.cwd(), "server/scorm/assets/runtime.js"), "utf8");

/** A top-level `function name(...) { ... }` — declared and closed at column 0. */
function extractTopLevel(name: string): string {
  const m = src.match(new RegExp(`^function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "m"));
  if (!m) throw new Error(`${name} не найдена среди функций верхнего уровня resultsPage.js`);
  return m[0];
}

function declarationCount(name: string): number {
  return (src.match(new RegExp(`function ${name}\\(`, "g")) || []).length;
}

function finishPath(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} не найдена в resultsPage.js`);
  return src.slice(start).match(/^function [^\n]*\n[\s\S]*?\n\}/)![0];
}

interface Objective {
  id: string;
  description: string;
  score: { raw: number; min: number; max: number; scaled: number } | null;
  success: string;
  completion: string;
}

const buildTopicObjective = new Function(
  `${extractTopLevel("buildTopicObjective")}
   ${extractTopLevel("ratio")}
   return buildTopicObjective;`,
)() as (tr: Record<string, unknown>) => Objective;

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
  return { SCORM, written, keys: () => written.map(([k]) => k) };
}

const TOPIC = { topicId: "t-1", topicName: "Основы лидерства", earnedPoints: 7, possiblePoints: 10, percent: 70, passed: true };

describe("сборка цели существует в ОДНОМ экземпляре", () => {
  it("buildTopicObjective объявлена один раз", () => {
    expect(declarationCount("buildTopicObjective")).toBe(1);
  });

  it("оба пути отправки собирают цель общей функцией", () => {
    expect(finishPath("finishScormLmsOnly")).toContain("buildTopicObjective");
    expect(finishPath("finishScormAdaptive")).toContain("buildTopicObjective");
  });
});

describe("баллы темы", () => {
  it("едут баллами со своей шкалой, а не процентом", () => {
    expect(buildTopicObjective(TOPIC).score).toEqual({ raw: 7, min: 0, max: 10, scaled: 0.7 });
  });

  it("доля округляется — LMS не нужен хвост двоичной дроби", () => {
    const o = buildTopicObjective({ ...TOPIC, earnedPoints: 10, possiblePoints: 15 });
    expect(o.score!.scaled).toBe(0.6667);
  });

  it("тема без оцениваемых вопросов не несёт баллов вовсе", () => {
    // Измерительная тема (ЧИЛ): ноль из нуля — не «ноль баллов», а «нечего оценивать».
    expect(buildTopicObjective({ ...TOPIC, earnedPoints: 0, possiblePoints: 0, percent: 0, passed: null }).score).toBeNull();
  });

  it("запись попытки БЕЗ баллов деградирует к процентной шкале", () => {
    // Попытка, сохранённая в suspend_data старой версией пакета, несёт только percent;
    // лучшая попытка берётся именно оттуда, и терять её результат нельзя.
    const legacy = { topicId: "t-1", topicName: "Тема", percent: 62.5, passed: true };
    expect(buildTopicObjective(legacy).score).toEqual({ raw: 63, min: 0, max: 100, scaled: 0.625 });
  });
});

describe("вердикт темы", () => {
  it("нет правила — статус unknown, а не failed", () => {
    expect(buildTopicObjective({ ...TOPIC, passed: null }).success).toBe("unknown");
  });

  it("правило есть — passed/failed", () => {
    expect(buildTopicObjective({ ...TOPIC, passed: true }).success).toBe("passed");
    expect(buildTopicObjective({ ...TOPIC, passed: false }).success).toBe("failed");
  });

  it("завершённость темы не зависит от вердикта", () => {
    expect(buildTopicObjective({ ...TOPIC, passed: false }).completion).toBe("completed");
  });
});

describe("имя темы", () => {
  it("едет описанием цели", () => {
    expect(buildTopicObjective(TOPIC).description).toBe("Основы лидерства");
    expect(buildTopicObjective(TOPIC).id).toBe("topic_t-1");
  });

  it("безымянная тема даёт пустое описание, а не undefined", () => {
    expect(buildTopicObjective({ ...TOPIC, topicName: undefined }).description).toBe("");
  });
});

describe("запись цели в модель данных", () => {
  it("пишет id, описание, шкалу и статусы", () => {
    const { SCORM, written } = makeScorm();
    SCORM.setObjective(0, buildTopicObjective(TOPIC));
    const map = Object.fromEntries(written);
    // Всё уезжает СТРОКАМИ: `setValue` приводит значение к строке, каким бы оно ни было.
    expect(map["cmi.objectives.0.id"]).toBe("topic_t-1");
    expect(map["cmi.objectives.0.description"]).toBe("Основы лидерства");
    expect(map["cmi.objectives.0.score.raw"]).toBe("7");
    expect(map["cmi.objectives.0.score.min"]).toBe("0");
    expect(map["cmi.objectives.0.score.max"]).toBe("10");
    expect(map["cmi.objectives.0.score.scaled"]).toBe("0.7");
    expect(map["cmi.objectives.0.success_status"]).toBe("passed");
    expect(map["cmi.objectives.0.completion_status"]).toBe("completed");
  });

  it("id пишется ПЕРВЫМ — до него цели для LMS не существует", () => {
    const { SCORM, keys } = makeScorm();
    SCORM.setObjective(0, buildTopicObjective(TOPIC));
    expect(keys()[0]).toBe("cmi.objectives.0.id");
  });

  it("без баллов элементы score не пишутся вовсе", () => {
    const { SCORM, keys } = makeScorm();
    SCORM.setObjective(0, buildTopicObjective({ ...TOPIC, earnedPoints: 0, possiblePoints: 0, passed: null }));
    expect(keys().some((k) => k.includes(".score."))).toBe(false);
    expect(keys()).toContain("cmi.objectives.0.success_status");
  });

  it("длинное имя темы обрезается до предела элемента", () => {
    // description — localized_string_type, SPM 250 символов; длиннее LMS вправе отвергнуть.
    const { SCORM, written } = makeScorm();
    SCORM.setObjective(0, buildTopicObjective({ ...TOPIC, topicName: "я".repeat(400) }));
    const map = Object.fromEntries(written);
    expect(map["cmi.objectives.0.description"]).toHaveLength(250);
  });
});
