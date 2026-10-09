/**
 * @module tests/breakdown-telemetry-silence
 * @description PRD-50 FR-41: телеметрия SCORM новых полей не получает.
 *
 * Требование держится тремя белыми списками подряд — вызывающий (`finishAndClose`), модуль
 * (`Telemetry.finish`) и серверный маршрут. Каждый расширяется одной строкой, и ни один тест
 * этого не заметит: пакет продолжит работать, просто в БД поедет то, чего спека запретила.
 * Поэтому здесь пришпилен ПОЛНЫЙ состав полезной нагрузки, а не отсутствие слова «breakdown».
 *
 * 2026-09-14, PRD-56 FR-21 (решение владельца): состав РАСШИРЕН на `scales` и `variables` —
 * до этого живая телеметрия значений шкал не сообщала вовсе, и профиль по шкалам видел
 * опросник, пройденный в вебе и загруженный книгой, но не тот, что прошли в LMS. Запрет
 * FR-41 это не отменяет: он о записях РАЗРЕЗА (PRD-50), которых здесь по-прежнему нет.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Имена полей объектного литерала: `имя:` в начале строки. */
const literalKeys = (block: string) =>
  [...block.matchAll(/^\s*([A-Za-z_][\w]*)\s*:/gm)].map((m) => m[1]);

describe("FR-41: состав телеметрии финиша зафиксирован", () => {
  it("модуль телеметрии шлёт ровно десять полей", () => {
    const src = read("server/scorm/template/app/telemetry/telemetry.js");
    // Ровно как в исходнике: `finish: function(results) {`, без пробела перед скобкой.
    const body = src.match(/finish: function\(results\) \{[\s\S]*?\n {4}\},/)?.[0];
    expect(body).toBeTruthy();
    expect(literalKeys(body!.slice(body!.indexOf("{", body!.indexOf("send("))))).toEqual([
      "percent", "passed", "earnedPoints", "possiblePoints",
      "totalQuestions", "correctAnswers", "achievedLevels", "failedTopicCourses",
      "scales", "variables",
    ]);
  });

  it("вызывающий собирает ровно десять полей", () => {
    const src = read("server/scorm/template/app/render/resultsPage.js");
    const body = src.match(/Telemetry\.finish\(\{[\s\S]*?\n {2}\}\);/)?.[0];
    expect(body).toBeTruthy();
    expect(literalKeys(body!)).toEqual([
      "percent", "passed", "earnedPoints", "possiblePoints",
      "totalQuestions", "correct", "achievedLevels", "failedTopicCourses",
      "scales", "variables",
    ]);
  });

  it("маршрут финиша пишет ровно двенадцать колонок и ни одной под разрез", () => {
    const src = read("server/routes/scorm-telemetry.ts");
    // Якорь по `finishedAt:` обязателен: в файле есть ещё два вызова
    // `updateScormAttempt(attempt.id, { … })`, и без якоря ленивый разбор уезжает в них.
    const body = src.match(/updateScormAttempt\(attempt\.id, \{\r?\n {6}finishedAt:[\s\S]*?\r?\n {4}\}\);/)?.[0];
    expect(body).toBeTruthy();
    expect(literalKeys(body!)).toEqual([
      "finishedAt", "lastActivityAt", "resultPercent", "resultPassed", "totalPoints",
      "maxPoints", "totalQuestions", "correctAnswers", "achievedLevelsJson",
      "failedTopicCoursesJson", "scalesJson", "variablesJson",
    ]);
  });
});
