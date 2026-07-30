/**
 * @module shared/report/report-preview
 *
 * PRD-27 Фаза 4 — вход отчёта для ПРЕДПРОСМОТРА в настройках теста (FR-18, FR-19).
 *
 * Здесь нет ни своего рендерера, ни своей вёрстки: модуль только собирает
 * {@link ReportInput}/{@link AdaptiveReportInput}, который дальше идёт в те же
 * `buildReportContext`/`buildAdaptiveReportContext`, что и настоящая выдача. Иначе
 * предпросмотр показывал бы не то, что получит обучающийся, — а именно за этим он и нужен.
 *
 * Что берётся из теста, а что придумывается (FR-18): название теста, состав и названия
 * разделов — РЕАЛЬНЫЕ, из редактируемого черновика; баллы, проценты, вердикты и обратная
 * связь — демонстрационные. Персональные данные не используются: слушатель обозначается
 * нейтрально.
 *
 * Числа ДЕТЕРМИНИРОВАННЫЕ (никакого `Math.random`): предпросмотр, который при каждой
 * перерисовке показывает другие цифры, не даёт сравнить два варианта между собой.
 * И они СОГЛАСОВАНЫ между собой — процент считается из тех же долей, что показаны
 * в темах, иначе автор увидит «4 из 10» рядом с «85 %» и решит, что это дефект макета.
 *
 * Чистый модуль: ни DOM, ни Node.
 */

import type { AdaptiveReportInput, ReportInput, AdaptiveReportTopic } from "./report-html";
import type { TopicInput } from "../template/result-context";

/** Исход попытки, который показывает предпросмотр (FR-19). */
export type ReportPreviewOutcome = "passed" | "failed";

/** Раздел редактируемого теста — то немногое, что предпросмотру нужно знать о структуре. */
export interface ReportPreviewSection {
  topicId?: string;
  topicName: string;
  /** Сколько вопросов выдаётся из раздела; 0/отсутствие — берётся демонстрационное число. */
  questionCount?: number;
}

/** Структура редактируемого теста, на которой строится предпросмотр. */
export interface ReportPreviewTest {
  testName: string;
  sections: ReportPreviewSection[];
  /** Лестница уровней адаптивного теста — названия по возрастанию. */
  levelNames?: string[];
}

/**
 * Слушатель в предпросмотре обозначается нейтрально — персональных данных нет (FR-18).
 * Не словом «Слушатель»: макет печатает строку «Слушатель: <значение>», и подпись с
 * значением слились бы в «Слушатель: Слушатель». Заполнитель показывает ФОРМУ имени —
 * по ней видно, сколько места строка займёт у настоящего человека.
 */
export const PREVIEW_LEARNER_NAME = "Фамилия Имя Отчество";

/** Демонстрационный порог темы: по нему расставляются вердикты «Пройдено»/«Не пройдено». */
const DEMO_TOPIC_THRESHOLD = 70;

/** Вопросов в разделе, когда автор ещё не задал выдачу. */
const DEMO_QUESTION_COUNT = 5;

/**
 * Вердикты тем по циклу — чтобы в сетке были РАЗНЫЕ строки, а не одинаковые.
 *
 * У пройденного отчёта провальной строки быть не должно: «Тест пройден» над красной темой
 * автор прочтёт как дефект макета, а не как замысел. У непройденного нужен контраст —
 * иначе не видно, чем отличаются состояния.
 */
const DEMO_TOPIC_VERDICTS: Record<ReportPreviewOutcome, boolean[]> = {
  passed: [true, true, true, true],
  failed: [false, true, false, false],
};

/**
 * Сколько верных ответов дать теме, чтобы её вердикт получился ЗАДУМАННЫЙ.
 *
 * Считается ОТ ПОРОГА, а не от доли: доля с округлением сваливается через порог на малой
 * выдаче (0.75 от трёх вопросов — это два, то есть 67 %, то есть «не пройдено» в отчёте,
 * который заявлен пройденным). Верхняя граница провала берётся и от «порог минус процент»,
 * чтобы округление вверх не вытолкнуло тему обратно за порог на большой выдаче.
 *
 * @param total Вопросов в теме.
 * @param wantPass Каким должен получиться вердикт.
 * @param i Номер темы — им разводятся числа, чтобы строки не были одинаковыми.
 */
function demoCorrect(total: number, wantPass: boolean, i: number): number {
  if (total <= 0) return 0;
  const need = Math.ceil((total * DEMO_TOPIC_THRESHOLD) / 100);
  if (wantPass) return Math.min(total, need + (i % 2));
  const belowThreshold = Math.floor(((DEMO_TOPIC_THRESHOLD - 1) * total) / 100);
  return Math.max(0, Math.min(need - 1 - (i % 2), belowThreshold));
}

/** Демонстрационная обратная связь непройденной темы — чтобы блок рекомендаций был виден. */
const DEMO_FEEDBACK = "Демонстрационная рекомендация: повторите материал раздела.";

/** Сколько попыток «учитывает» подпись «Лучший результат за N попыток». */
const DEMO_ATTEMPTS = 2;

/** Разделы, приведённые к непустому списку: тест без разделов всё равно должен рисоваться. */
function previewSections(test: ReportPreviewTest): ReportPreviewSection[] {
  const real = (test.sections ?? []).filter((s) => s && (s.topicName || "").trim().length > 0);
  return real.length > 0 ? real : [{ topicName: "Раздел теста" }];
}

/**
 * Вход стандартного отчёта на структуре редактируемого теста.
 *
 * @param test Название и разделы черновика.
 * @param outcome Исход, который показывает переключатель (FR-19).
 */
export function buildReportPreviewInput(
  test: ReportPreviewTest,
  outcome: ReportPreviewOutcome,
): ReportInput {
  const verdicts = DEMO_TOPIC_VERDICTS[outcome];
  const topicResults: TopicInput[] = previewSections(test).map((section, i) => {
    const total = section.questionCount && section.questionCount > 0 ? section.questionCount : DEMO_QUESTION_COUNT;
    const correct = demoCorrect(total, verdicts[i % verdicts.length], i);
    // Процент считается ИЗ этих же долей, а не задаётся отдельно: «4 из 10» и «40 %»
    // обязаны сходиться, иначе автор примет расхождение за дефект макета. И вердикт
    // берётся из процента — один источник истины, а не два расходящихся.
    const percent = Math.round((correct / total) * 100);
    const passed = percent >= DEMO_TOPIC_THRESHOLD;
    return {
      ...(section.topicId ? { topicId: section.topicId } : {}),
      topicName: section.topicName,
      correct,
      total,
      percent,
      // Цену вопроса предпросмотр не знает (она разрешается через PRD-15 блок D уже
      // при выдаче), поэтому показывает балл за ответ — это и есть системный дефолт.
      earnedPoints: correct,
      possiblePoints: total,
      passed,
      ...(passed ? {} : { feedback: DEMO_FEEDBACK }),
    };
  });

  const correct = topicResults.reduce((n, t) => n + t.correct, 0);
  const totalQuestions = topicResults.reduce((n, t) => n + t.total, 0);
  return {
    testName: test.testName || "Тест",
    learnerName: PREVIEW_LEARNER_NAME,
    attemptsCount: DEMO_ATTEMPTS,
    result: {
      passed: outcome === "passed",
      percent: totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0,
      totalQuestions,
      correct,
      earnedPoints: correct,
      possiblePoints: totalQuestions,
      topicResults,
    },
  };
}

/**
 * Вход адаптивного отчёта: у тем не проценты, а достигнутые уровни (D-5).
 *
 * @param test Название, разделы и лестница уровней черновика.
 * @param outcome Исход, который показывает переключатель (FR-19).
 */
export function buildAdaptiveReportPreviewInput(
  test: ReportPreviewTest,
  outcome: ReportPreviewOutcome,
): AdaptiveReportInput {
  const ladder = (test.levelNames ?? []).filter((n) => (n || "").trim().length > 0);
  const levels = ladder.length > 0 ? ladder : ["Базовый", "Уверенный", "Экспертный"];
  const topicResults: AdaptiveReportTopic[] = previewSections(test).map((section, i) => {
    // Пройден — уровень подтверждён у всех тем; не пройден — у части минимум не взят
    // (`null`), чтобы автор увидел ОБА состояния плашки уровня.
    const achieved = outcome === "passed" ? levels.length - 1 - (i % levels.length) : i % 2 === 0 ? null : 0;
    const total = section.questionCount && section.questionCount > 0 ? section.questionCount : DEMO_QUESTION_COUNT;
    return {
      topicName: section.topicName,
      achievedLevelIndex: achieved,
      achievedLevelName: achieved == null ? null : levels[achieved],
      totalQuestionsAnswered: total,
      totalCorrect: achieved == null ? Math.floor(total / 3) : total - (i % 2),
      ...(achieved == null ? { feedback: DEMO_FEEDBACK } : {}),
    };
  });

  return {
    adaptive: true,
    testName: test.testName || "Тест",
    learnerName: PREVIEW_LEARNER_NAME,
    attemptsCount: DEMO_ATTEMPTS,
    result: { passed: outcome === "passed", topicResults },
  };
}
