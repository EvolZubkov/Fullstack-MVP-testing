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
// Ветвь отчёта выбирается ТЕМ ЖЕ правилом, что и в выдаче: предпросмотр, решающий иначе,
// показывал бы не тот документ, что уйдёт в PDF.
import { resolveReportIntro, type TestIntroLike } from "./report-intro";
import type {
  BreakdownDisplaySetting,
  ResultHeadings,
  TopicInput,
} from "../template/result-context";
import type { BarFillSetting } from "../template/bar-fill";

/** Исход попытки, который показывает предпросмотр (FR-19). */
export type ReportPreviewOutcome = "passed" | "failed";

/** Раздел редактируемого теста — то немногое, что предпросмотру нужно знать о структуре. */
export interface ReportPreviewSection {
  topicId?: string;
  topicName: string;
  /** Сколько вопросов выдаётся из раздела; 0/отсутствие — берётся демонстрационное число. */
  questionCount?: number;
  /** Группа тем, в которой стоит раздел; `null`/отсутствие — вне групп. */
  groupKey?: string | null;
}

/** Структура редактируемого теста, на которой строится предпросмотр. */
export interface ReportPreviewTest {
  testName: string;
  sections: ReportPreviewSection[];
  /** Лестница уровней адаптивного теста — названия по возрастанию. */
  levelNames?: string[];
  /**
   * Заголовки итога теста (свойства узла «Итоги теста»).
   *
   * Предпросмотр обязан их показывать: автор задаёт заголовок документа и смотрит, как он
   * лёг, ИМЕННО в этом окне. Без них окно печатало название теста и «Тест не пройден» —
   * то есть отвечало не на тот вопрос, ради которого его открыли.
   */
  headings?: ResultHeadings;
  /**
   * Настройка показа подытогов теста (`tests.breakdown_display_json`).
   *
   * Едет из РЕАЛЬНОГО теста, а не подставляется демонстрационной: печать полос и толкований
   * подтем — авторский выбор, и предпросмотр, решающий его за автора, показал бы не тот
   * документ, что уйдёт в PDF. Отсутствие = подытоги скрыты, как у теста без настройки.
   */
  breakdownDisplay?: BreakdownDisplaySetting;
  /**
   * Окраска полос подтем — из параметров оформления, которые автор правит в этом же окне
   * настроек ({@link module:shared/template/bar-fill barFillFromParams}). Отсутствие =
   * «по вердикту».
   */
  barFill?: BarFillSetting | null;
  /**
   * Группы тем теста (`tests.section_groups_json`).
   *
   * Блок со счётчиком — главная примета референсного вида, и предпросмотр без него
   * показывал бы плоский список там, где слушатель получит блоки.
   */
  sectionGroups?: { key: string; label: string; order?: number }[];
  /**
   * Вводные блоки теста (`tests.intro_json`) — ЦЕЛИКОМ, обе ветви выдачи.
   *
   * Едут из РЕАЛЬНОГО теста, как и настройка подытогов выше: вводный текст автор пишет
   * прямо перед тем, как открыть это окно, и не увидеть его здесь — значит проверять
   * вёрстку вместо содержания. До PRD-61 окно не подавало `intro` вовсе, и это была одна
   * из трёх его слепых зон.
   *
   * Какую ветвь взять, решает `resolveReportIntro` — то же правило, что и в выдаче; какой
   * текст исхода напечатать, решает построитель по вердикту образца.
   */
  intro?: TestIntroLike | null;
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

/**
 * Демонстрационное ТОЛКОВАНИЕ темы.
 *
 * Предпросмотр показывает раскладку, а не содержание теста («темы этого теста, показатели
 * демонстрационные»), и без этого текста вариант блока со строкой в две колонки открывался
 * бы пустой правой колонкой — то есть выглядел бы сломанным ровно там, где автор его и
 * выбирает.
 */
/**
 * Демонстрационные ПОДТЕМЫ: одна строка разреза на ключ.
 *
 * Без них правая колонка знаниевой темы в варианте «строка в две колонки» открывается
 * пустой — то есть вариант выглядит сломанным ровно там, где автор его и выбирает. Доли
 * разные намеренно: одинаковые полосы не показывают, чем строки отличаются.
 */
const DEMO_BREAKDOWN: { key: string; percent: number }[] = [
  { key: "Демонстрационная подтема 1", percent: 40 },
  { key: "Демонстрационная подтема 2", percent: 63 },
  { key: "Демонстрационная подтема 3", percent: 85 },
];

const DEMO_KEY_INTERPRETATION =
  "Демонстрационное толкование подтемы: что именно она проверяет.";

const DEMO_INTERPRETATION =
  "Демонстрационное толкование: что именно проверяет эта тема и что стоит за её результатом.";

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
      ...(section.groupKey ? { groupKey: section.groupKey } : {}),
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
      // Толкование печатается при ЛЮБОМ вердикте — в этом его отличие от рекомендации,
      // и предпросмотр обязан показывать то же правило.
      interpretation: { format: "plain", text: DEMO_INTERPRETATION },
      // Полосы подтем: их печать включает настройка теста, и предпросмотр её не знает,
      // поэтому записи едут всегда — показать их или нет, решает уже построитель.
      breakdown: DEMO_BREAKDOWN.map(({ key, percent }) => ({
        scope: "section:preview",
        axis: "tag" as const,
        key,
        items: total,
        answered: total,
        earned: Math.round((total * percent) / 100),
        possible: total,
        unitEarned: Math.round((total * percent) / 100),
        unitPossible: total,
        percentPoints: percent,
        percentUnits: percent,
      })),
      // Толкование ПОДТЕМЫ: печатать его или нет, решает настройка теста, поэтому текст
      // едет всегда — иначе включённый показ было бы не на чем проверить.
      breakdownInterpretation: {
        [DEMO_BREAKDOWN[0].key]: { format: "plain" as const, text: DEMO_KEY_INTERPRETATION },
      },
    };
  });

  const correct = topicResults.reduce((n, t) => n + t.correct, 0);
  const totalQuestions = topicResults.reduce((n, t) => n + t.total, 0);
  return {
    testName: test.testName || "Тест",
    learnerName: PREVIEW_LEARNER_NAME,
    attemptsCount: DEMO_ATTEMPTS,
    ...(test.headings ? { headings: test.headings } : {}),
    ...(test.breakdownDisplay ? { breakdownDisplay: test.breakdownDisplay } : {}),
    ...(test.barFill ? { barFill: test.barFill } : {}),
    // PRD-61 FR-23: вводный блок отчёта. Текст исхода выберет построитель — по вердикту
    // образца, который задаёт переключатель окна.
    ...(resolveReportIntro(test.intro) ? { intro: resolveReportIntro(test.intro)! } : {}),
    result: {
      passed: outcome === "passed",
      percent: totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0,
      totalQuestions,
      correct,
      earnedPoints: correct,
      possiblePoints: totalQuestions,
      topicResults,
      // Блоки разделов: их разбирает тот же построитель, что и в выдаче, поэтому счётчик
      // в предпросмотре считается ровно так же, как его увидит слушатель.
      ...(test.sectionGroups?.length ? { sectionGroups: test.sectionGroups } : {}),
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
    // PRD-61: вводный блок печатается и здесь, но БЕЗ текстов исхода — адаптивный режим
    // вердикта не выносит (FR-14b), и построитель их не возьмёт.
    ...(resolveReportIntro(test.intro) ? { intro: resolveReportIntro(test.intro)! } : {}),
    result: { passed: outcome === "passed", topicResults },
  };
}
