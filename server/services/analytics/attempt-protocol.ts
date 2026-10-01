/**
 * @module server/services/analytics/attempt-protocol
 * @description Протокол ОДНОГО прохождения книгой Excel — кнопка «Скачать детали» окна попытки.
 *
 * Раньше протокол собирался в браузере CSV-файлом, и ответ с эталоном попадали туда сырым
 * `JSON.stringify` — `{"0":2}` вместо слов, хотя окно на экране тот же ответ показывает текстом
 * (дефект D3 UX-аудита аналитики). Теперь книга строится на сервере из ТОГО ЖЕ разбора, что
 * отдаётся окну (`loadWebAttemptDetail`, `loadScormAttemptDetail`), а ответ переводится в слова
 * тем же переводом, что у остальных выгрузок аналитики (`formatUserAnswerText`).
 *
 * Состав книги — прежний состав протокола: сведения о попытке, ответы, шкалы, показатели.
 */
import type { Response } from "express";

import {
  formatCorrectAnswerText,
  formatQuestionType,
  formatUserAnswerText,
} from "../../routes/analytics/helpers";
import { addAoaSheet, ExcelJS, workbookToBuffer } from "../../utils/excel";

/** Откуда разбор: у веб-попытки и строки LMS ответ и варианты лежат по-разному. */
export type ProtocolSource = "web" | "lms";

/** Строка ответа разбора — общая часть веб- и LMS-разбора, которую читает протокол. */
interface DetailAnswer {
  questionPrompt?: string | null;
  questionType?: string | null;
  topicName?: string | null;
  difficulty?: number | null;
  isCorrect?: boolean;
  measurementOnly?: boolean;
  ratio?: number;
  earnedPoints?: number | null;
  possiblePoints?: number | null;
  contribs?: Array<{ scaleKey: string; delta: number }>;
  /** Веб: ответ и эталон в исходном виде и данные вопроса. */
  userAnswerRaw?: unknown;
  correctAnswerRaw?: unknown;
  questionData?: unknown;
  /** LMS: ответ и эталон в исходном виде и снимок вариантов, пришедший с ответом. */
  userAnswer?: unknown;
  correctAnswer?: unknown;
  options?: unknown;
  leftItems?: unknown;
  rightItems?: unknown;
  items?: unknown;
}

/** «62 %» — с неразрывным пробелом, как проценты на экранах аналитики. */
function percentText(value: number): string {
  return `${Math.round(value)} %`;
}

/** Число до сотых без хвостовых нулей. */
function round2(value: unknown): string {
  return typeof value === "number" ? String(Math.round(value * 100) / 100) : "";
}

/** Дата и время по-русски; пусто, если даты нет. */
function dateText(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return new Date(value).toLocaleString("ru-RU");
}

/** Длительность «м:сс»; пусто, если её не посчитать. */
function durationText(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Данные вопроса для перевода ответа в слова.
 *
 * У веб-попытки это текущие данные вопроса; у строки LMS — снимок вариантов, приехавший вместе
 * с ответом: вопрос с тех пор могли поправить, а протокол обязан показать то, что видел участник.
 * Импорт выгрузки снимка не несёт — тогда разбор отдаёт текущие данные вопроса.
 */
function questionDataOf(answer: DetailAnswer, source: ProtocolSource): unknown {
  if (source === "web") return answer.questionData ?? {};
  if (!answer.options && !answer.leftItems && !answer.items) return answer.questionData ?? {};
  return {
    options: answer.options,
    left: answer.leftItems,
    right: answer.rightItems,
    items: answer.items,
  };
}

/**
 * Строки листа «Ответы».
 *
 * @param answers ответы разбора
 * @param source источник разбора
 */
export function answerRows(answers: readonly DetailAnswer[], source: ProtocolSource): unknown[][] {
  const rows: unknown[][] = [[
    "Вопрос", "Тема", "Тип", "Ответ", "Правильный ответ", "Результат", "Баллы", "Сложность",
    "Доля", "Вклады в шкалы",
  ]];
  for (const answer of answers) {
    const type = answer.questionType ?? "";
    const data = questionDataOf(answer, source);
    const raw = source === "web" ? answer.userAnswerRaw : answer.userAnswer;
    const correct = source === "web" ? answer.correctAnswerRaw : answer.correctAnswer;
    // Измерительный вопрос не проверяется: у него нет ни эталона, ни баллов, ни «неверно»
    // (PRD-26 FR-08, PRD-44 FR-09) — окно на экране ставит здесь метку «Измерение».
    const measurement = answer.measurementOnly === true;
    rows.push([
      answer.questionPrompt ?? "",
      answer.topicName ?? "",
      formatQuestionType(type),
      formatUserAnswerText(type, data, raw),
      measurement || correct === null || correct === undefined
        ? ""
        : formatCorrectAnswerText(type, data, correct),
      measurement ? "Измерение" : answer.isCorrect ? "Верно" : "Неверно",
      // Баллов нет у ответа из импорта выгрузки: отчёт LMS их не несёт, и «0 / 0» читалось бы
      // как ноль за вопрос.
      measurement || (answer.earnedPoints == null && answer.possiblePoints == null)
        ? ""
        : `${round2(answer.earnedPoints ?? 0)} / ${round2(answer.possiblePoints ?? 0)}`,
      answer.difficulty ?? "",
      measurement || typeof answer.ratio !== "number" ? "" : percentText(answer.ratio * 100),
      (answer.contribs ?? [])
        .map(c => `${c.scaleKey} ${c.delta >= 0 ? "+" : ""}${c.delta}`)
        .join(" | "),
    ]);
  }
  return rows;
}

/**
 * Строки листа «Попытка»: кто, что, когда и с каким итогом.
 *
 * Итог печатается по тем же правилам, что в окне: процента нет, где оценивать было нечего, а
 * «Сдан / Не сдан» — только там, где вердикт вынесен (PRD-29 §6.7). Адаптивную попытку судят
 * уровни, а не баллы, — у неё вместо результата лист уровней.
 */
export function summaryRows(detail: Record<string, any>, source: ProtocolSource): unknown[][] {
  const rows: unknown[][] = [
    ["Тест", detail.testTitle ?? ""],
    ["Участник", (source === "web" ? detail.username : detail.lmsUserName) ?? ""],
    ["Email", (source === "web" ? detail.userEmail : detail.lmsUserEmail) ?? ""],
    ["Источник", source === "web" ? "Веб" : "LMS"],
    ["Начало", dateText(detail.startedAt)],
    ["Окончание", dateText(detail.finishedAt)],
    ["Длительность", durationText(detail.duration)],
  ];
  if (typeof detail.snapshotVersion === "number") rows.push(["Версия публикации", detail.snapshotVersion]);
  rows.push(["Попытка", detail.attemptId ?? ""]);

  if (detail.testMode === "adaptive") {
    rows.push(["Режим", "Адаптивный"]);
    return rows;
  }
  if (detail.scored !== false) {
    rows.push(["Результат", percentText(Number(detail.overallPercent ?? 0))]);
    rows.push(["Баллы", `${round2(detail.earnedPoints ?? 0)} / ${round2(detail.possiblePoints ?? 0)}`]);
  }
  rows.push([
    "Статус",
    detail.verdictPronounced === false ? "Без вердикта" : detail.passed ? "Сдан" : "Не сдан",
  ]);
  return rows;
}

/**
 * Собрать книгу протокола.
 *
 * @param detail разбор прохождения — ровно то, что отдаётся окну попытки
 * @param source источник разбора
 */
export function buildAttemptProtocol(detail: Record<string, any>, source: ProtocolSource): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  addAoaSheet(workbook, "Попытка", summaryRows(detail, source), [24, 60]);

  if (detail.testMode === "adaptive") {
    // У строки LMS уровни приезжают как прислал пакет — бывает и не список; такое не печатается.
    const levels = (Array.isArray(detail.achievedLevels) ? detail.achievedLevels : []) as Array<{
      topicName?: string; levelName?: string | null;
    }>;
    addAoaSheet(workbook, "Уровни", [
      ["Тема", "Достигнутый уровень"],
      ...levels.map(level => [level.topicName ?? "", level.levelName || "Не достигнут"]),
    ], [40, 30]);
  }

  addAoaSheet(workbook, "Ответы", answerRows(detail.answers ?? [], source), [
    60, 24, 20, 40, 40, 12, 10, 10, 8, 30,
  ]);

  // Шкалы (PRD-5): значение и уровень. Процент не выгружается — это вспомогательная величина
  // формул показателей, а не результат шкалы.
  const scales = Object.entries((detail.scaleResults ?? {}) as Record<string, {
    raw?: number; level?: string; label?: string; hasValue?: boolean;
  }>);
  if (scales.length) {
    addAoaSheet(workbook, "Шкалы", [
      ["Шкала", "Значение", "Уровень"],
      ...scales.map(([key, scale]) => [key, scale.hasValue ? round2(scale.raw) : "", scale.label || scale.level || ""]),
    ], [30, 12, 30]);
  }

  // Показатели (PRD-2).
  const variables = Object.entries((detail.resultVariables ?? {}) as Record<string, unknown>);
  if (variables.length) {
    addAoaSheet(workbook, "Показатели", [
      ["Показатель", "Значение"],
      ...variables.map(([name, value]) => [
        name,
        typeof value === "boolean" ? (value ? "да" : "нет") : typeof value === "number" ? round2(value) : String(value ?? ""),
      ]),
    ], [30, 20]);
  }

  return workbook;
}

/**
 * Отдать протокол файлом.
 *
 * Имя файла — участник и дата: так протоколы нескольких попыток различимы в папке загрузок.
 */
export async function sendAttemptProtocol(
  res: Response,
  detail: Record<string, any>,
  source: ProtocolSource,
): Promise<void> {
  const buffer = await workbookToBuffer(buildAttemptProtocol(detail, source));
  const who = String((source === "web" ? detail.username : detail.lmsUserName) || "участник")
    .replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, "_");
  const filename = `attempt_${who}_${new Date().toISOString().split("T")[0]}.xlsx`;
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}
