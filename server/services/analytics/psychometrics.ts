/**
 * @module server/services/analytics/psychometrics
 * @description PRD-66: сведение матрицы наблюдений и расчётного движка.
 *
 * Разделение ответственности здесь намеренное и жёсткое. `response-matrix` знает, ГДЕ взять
 * наблюдения; `shared/psychometrics` знает, КАК считать; этот модуль — что с чем сопоставить:
 * какому заданию сколько вариантов, какой порог применить к какому числу, что показывать, а
 * что скрыть за недостатком данных. Считать он не умеет ничего, и это проверяется тем, что ни
 * одной формулы в нём нет.
 *
 * Функция чистая: наблюдения и справочники приходят готовыми. Поэтому она проверяется без базы
 * — на матрице, собранной руками, где каждое число известно заранее.
 */

import { isSingleIndexChoice } from "@shared/questions/question-type";
import {
  abilities,
  difficulty as difficultyOf,
  discriminationIndex,
  guessingCorrectedDifficulty,
  itemRestCorrelation,
  type ItemResponse,
} from "@shared/psychometrics/item-metrics";
import {
  alphaOf,
  coreReliability,
  countWithinBand,
  cutScoreBand,
  pairwiseReliability,
  spearmanBrown,
  standardErrorOfMeasurement,
  type CutScoreBand,
  type ItemValue,
  type Reliability,
  type ReliabilityGap,
} from "@shared/psychometrics/reliability";
import { analyseUnits, type UnitAnalysis } from "@shared/psychometrics/units";
import {
  coefficientConfidence,
  descriptiveConfidence,
  type ConfidenceLevel,
} from "@shared/psychometrics/confidence";
import {
  analyseOptions,
  flagsOf,
  type ChoiceResponse,
} from "@shared/psychometrics/distractors";
import {
  rushedShare,
  summariseTiming,
  timingFlags,
  type TimingFlags,
  type TimingSummary,
} from "@shared/psychometrics/timing";

import type { ResponseFact } from "./response-matrix";
import { pickAttemptIds, type AttemptCandidate, type AttemptPick } from "@shared/analytics/attempt-pick";

/** Что известно о задании помимо наблюдений за ним. */
export interface QuestionInfo {
  id: string;
  type: string;
  prompt: string;
  dataJson: unknown;
  /**
   * Эталон задания. Нужен разбору по единицам (Э4а): верная пара, верное место, правила
   * пропуска; необязателен — без него разбора по единицам нет.
   */
  correctJson?: unknown;
  /** Трудность, заявленная автором (PRD-16, необязательна); `null` — сравнивать не с чем. */
  difficulty: number | null;
}

/** Условия, в которых считается психометрика. */
export interface PsychometricsContext {
  questionById: ReadonlyMap<string, QuestionInfo>;
  /** Порог описательных величин инстанса (`analytics.minObservations`). */
  minObservations: number;
  /** Проходной балл теста в долях, если он объявлен: по нему строится интервал у порога. */
  cutRatio?: number | null;
  /**
   * FR-20: выдача неоднородна (случайный отбор, квоты, адаптив) — у участников разные наборы, и
   * надёжность считается оценкой по связям заданий, а не альфой полного набора.
   */
  unevenDelivery?: boolean;
  /**
   * Пул выдачи теста (`delivery-pool`, решение владельца 2026-09-26): вопросы, которые тест
   * может выдать. Вопрос пула без единого наблюдения в ТЕКУЩЕЙ выборке идёт строкой «Вопрос ещё
   * не выдавался» (`neverDelivered`). Без поля список строится по ответам, как раньше.
   */
  poolQuestionIds?: readonly string[];
}

/** Психометрика ОДНОГО задания. */
export interface ItemPsychometrics {
  questionId: string;
  /** Наблюдений, где задание было выдано и оценено. */
  observations: number;
  /**
   * FR-41: доля наблюдений задания, где оно НЕ ВЫДАВАЛОСЬ.
   *
   * Трудность считается по тем, кто задание видел, поэтому у выборки, собранной из импорта,
   * эта доля и есть мера смещения `p`: чем она выше, тем меньше выборка под числом. Ноль —
   * факт «видели все», а не отсутствие сведений.
   */
  missingShare: number;
  difficulty: number | null;
  /** Трудность с поправкой на угадывание; `null` — к этому типу неприменима (FR-17a). */
  correctedDifficulty: number | null;
  /** Корреляция задание-остаток. */
  itemRest: number | null;
  /** Индекс крайних групп `D`. */
  discrimination: number | null;
  timing: TimingSummary | null;
  timingFlags: TimingFlags;
  /** Уровни доверия — РАЗНЫЕ у описательных величин и коэффициентов (FR-04, FR-38a). */
  difficultyConfidence: ConfidenceLevel;
  coefficientConfidence: ConfidenceLevel;
  flags: ItemFlags;
  /** Заявленная автором трудность рядом с наблюдаемой (FR-18). */
  declaredDifficulty: number | null;
  /**
   * Вопрос пула выдачи, которого в выборке нет ни у одного участника: «Вопрос ещё не
   * выдавался». Все числа у такой строки пустые, и в надёжность, ошибку измерения и счёт
   * «под подозрением» она не входит. Отсутствует у строк, построенных по ответам.
   */
  neverDelivered?: true;
}

/** Признаки задания — симптомы, названные числами, а не приговор (FR-50). */
export interface ItemFlags {
  /** `p < 0.2`: задание проходит почти никто. */
  tooHard: boolean;
  /** `p > 0.9`: задание проходят все — оно почти ничего не измеряет. */
  tooEasy: boolean;
  /** `r < 0` или `D < 0`: сильные ошибаются чаще слабых. Красный флаг первого приоритета. */
  negativeDiscrimination: boolean;
  /** Скорректированная трудность на уровне случайного попадания. */
  atChanceLevel: boolean;
  /**
   * `0 <= r < 0.20`: вопрос почти не отделяет сильных от слабых — «Сильные и слабые отвечают
   * одинаково». Отрицательная `r` сюда не попадает: у неё свой признак первого приоритета.
   */
  weakDiscrimination: boolean;
}

/** Психометрика теста целиком. */
export interface TestPsychometrics {
  items: ItemPsychometrics[];
  /** Коэффициент надёжности либо причина, по которой его нет. */
  reliability: Reliability | ReliabilityGap;
  /**
   * FR-20: альфа по общему ядру — рядом с оценкой по связям заданий, когда у неоднородной
   * выдачи есть задания, которые видели все. `null` — ядра нет либо выдача однородна.
   */
  coreReliability: Reliability | null;
  /**
   * Ошибка измерения в единицах расчёта — сумме долей балла по вопросам; `null` — надёжность не
   * посчиталась. На экран идёт `semPercent`.
   */
  sem: number | null;
  /**
   * Та же ошибка в процентных пунктах результата (план сверки 5.3): «4,2 п.п.» автор сопоставляет
   * с порогом в процентах, а сумма долей по вопросам ему ничего не говорит — она зависит от длины
   * варианта. Делитель — число вопросов, по которым считалась надёжность.
   */
  semPercent: number | null;
  /**
   * Интервал вокруг проходного балла; `null` — порога нет либо ошибка не посчиталась.
   *
   * `withinBand` (FR-21a) — скольких участников он фактически задел: «решение ненадёжно» без
   * этого числа предупреждает ни о чём, потому что двое из шестидесяти и половина потока
   * требуют разных действий.
   */
  cutBand: (CutScoreBand & {
    withinBand: number;
    /** Порог и границы интервала в процентах результата — то, что читает экран. */
    cutPercent: number;
    lowPercent: number;
    highPercent: number;
  }) | null;
  /**
   * Прогноз длины для надёжности 0,90 — строгой планки для решения «сдал / не сдал» (эскиз:
   * баннер у порога). `null` — порога или надёжности нет. Прогноз плитки (`lengthForecast`) —
   * до 0,80, общего ориентира; у порога нужна планка выше, потому что решение касается человека.
   */
  cutForecast: { target: number; factor: number; itemsDelta: number } | null;
  /**
   * FR-22: во сколько раз изменить длину теста ради целевой надёжности и на сколько заданий
   * это выходит. `null` — надёжности нет, и удлинять нечего.
   */
  lengthForecast: { target: number; factor: number; itemsDelta: number } | null;
  sample: {
    /** Респондентов в выборке. */
    respondents: number;
    /** Наблюдений за ответами. */
    responses: number;
    /** Сколько наблюдений пришло из каждого источника — на чём стоят числа (FR-42). */
    bySource: Record<string, number>;
    /**
     * Прохождений из каждого источника — то, что показывает строка «Выборка» (план сверки 5.4).
     * Наблюдения там читались как прохождения: «веб — 26» рядом с «20 прохождений» у надёжности
     * были двумя разными единицами в одной строке. Сумма совпадает с числом прохождений расчёта.
     */
    passagesBySource: Record<string, number>;
    /** Доля наблюдений с неизвестной редакцией задания (FR-09c): мера огрубления серий. */
    unknownVersionShare: number;
  };
}

/** Пороги признаков трудности — из FR-13. */
const TOO_HARD = 0.2;
const TOO_EASY = 0.9;

/**
 * Целевая надёжность прогноза длины (FR-22) — 0,80, общепринятый ориентир для аттестации.
 *
 * Константа, а не настройка теста (решение владельца 2026-09-24): это число почти никто не
 * меняет, и поле ради него добавило бы автору выбор, которого он не просил, — а объяснять,
 * чем 0,75 отличается от 0,85, пришлось бы на том же экране.
 */
const TARGET_RELIABILITY = 0.8;

/** Надёжность, которой добиваются, когда по тесту выносят решение о человеке (баннер порога). */
const CUT_TARGET_RELIABILITY = 0.9;

/**
 * Интервал у порога вместе с числом задетых участников (FR-21a).
 *
 * Считается по ТЕМ ЖЕ полным наборам, на которых стоит сама надёжность: у участника, видевшего
 * не все задания, сумма меньше по построению, и сравнивать её с порогом значило бы записать его
 * в сомнительные без основания.
 */
function bandWithCount(band: CutScoreBand, values: readonly ItemValue[], variantLength?: number) {
  return { ...band, withinBand: countWithinBand(values, band, variantLength) };
}

/**
 * Порог и интервал — ещё и в процентах результата: экран сопоставляет их с порогом теста,
 * заданным в процентах, а не с суммой долей по вопросам.
 */
function withPercents<T extends CutScoreBand>(band: T, cutRatio: number, items: number) {
  return {
    ...band,
    cutPercent: cutRatio * 100,
    lowPercent: (band.low / items) * 100,
    highPercent: (band.high / items) * 100,
  };
}

/**
 * Прогноз длины теста ради целевой надёжности.
 *
 * Отдельная обёртка над формулой нужна ради ОГОВОРКИ, которую иначе негде поставить: прогноз
 * исходит из того, что добавленные задания будут такого же качества, что нынешние. На практике
 * они обычно хуже, поэтому число оптимистично — и экран обязан это сказать.
 */
function forecastOf(alpha: number, items: number, target = TARGET_RELIABILITY) {
  const forecast = spearmanBrown(alpha, target, items);
  return forecast === null ? null : { target, ...forecast };
}

/**
 * Насколько отрицательной должна быть дискриминативность, чтобы это был ПРИЗНАК, а не шум.
 *
 * Вскрыто приёмкой на синтетических данных: задание, которое решают 97 %, получило ярлык
 * «Сильные ошибаются чаще» при r = −0,02 и D = 0,00. У задания без разброса корреляция
 * болтается около нуля, и её знак не значит ничего — зато ярлык первого приоритета перекрыл
 * осмысленное «Слишком лёгкое» и увёл автора чинить исправное задание.
 *
 * Формально FR-14 называет красным флагом любое `r < 0`; порог не отменяет правило, а отделяет
 * направление от дрожания нуля.
 */
const NEGATIVE_DISCRIMINATION = -0.05;

/**
 * Нижняя граница приемлемой дискриминативности — из FR-14: `r >= 0.20` приемлемо.
 *
 * Ниже неё, но не в минусе, вопрос почти не отделяет сильных от слабых: признак «Сильные и
 * слабые отвечают одинаково» (решение владельца 2026-09-25). Отрицательная `r` остаётся
 * признаком «Сильные ошибаются чаще» и дважды не метится.
 */
const WEAK_DISCRIMINATION = 0.2;

/** Сколько вариантов у задания: по ним считается вероятность случайного попадания. */
function optionCountOf(question: QuestionInfo | undefined): number {
  const options = (question?.dataJson as { options?: unknown[] } | null)?.options;
  return Array.isArray(options) ? options.length : 0;
}

/**
 * Оставить ответы прохождений, выбранных правилом (FR-51, дельта 2026-10-07).
 *
 * Повторные попытки одного человека не независимы: он помнит задания, и вторая попытка говорит
 * о памяти не меньше, чем о способности. Умолчание — «только первая»; иное правило выбирает
 * читатель, и экран сопровождает смещённые правила предупреждением.
 *
 * Кандидаты — прохождения, в которых есть ответы, как и прежде у «первой»: начатая и брошенная
 * попытка без ответов не должна заслонять следующую. Процент результата приходит отдельно — у
 * ответа его нет, он свойство прохождения. Сообщённый пакетом номер попытки (импорт выгрузки,
 * PRD-54 решение 13) тоже идёт в кандидата: по нему «первая» не берёт повторную.
 *
 * @param responses ответы выборки
 * @param pick правило выбора попытки
 * @param percentByObservation процент результата прохождения; нужен только правилу `best`
 * @returns ответы оставленных прохождений
 */
export function pickAttemptResponses(
  responses: readonly ResponseFact[],
  pick: AttemptPick,
  percentByObservation: ReadonlyMap<string, number | null>,
): ResponseFact[] {
  const candidates = new Map<string, AttemptCandidate>();
  for (const response of responses) {
    if (candidates.has(response.observationId)) continue;
    candidates.set(response.observationId, {
      id: response.observationId,
      participantId: response.respondentId,
      at: response.occurredAt.getTime(),
      percent: percentByObservation.get(response.observationId) ?? null,
      reportedAttempt: response.reportedAttempt ?? null,
    });
  }
  const kept = pickAttemptIds(candidates.values(), pick);
  return kept === null ? [...responses] : responses.filter(response => kept.has(response.observationId));
}

/**
 * Ответы матрицы по правилу выбора попытки — одна точка для всех ручек психометрики.
 *
 * @param matrix прохождения и ответы выборки
 * @param pick правило выбора попытки
 */
export function pickMatrixResponses(
  matrix: { observations: ReadonlyArray<{ id: string; percent: number | null }>; responses: readonly ResponseFact[] },
  pick: AttemptPick,
): ResponseFact[] {
  return pickAttemptResponses(
    matrix.responses,
    pick,
    new Map(matrix.observations.map(observation => [observation.id, observation.percent])),
  );
}

/**
 * Строка вопроса пула, которого выборка не видела: «Вопрос ещё не выдавался».
 *
 * Все величины пустые, доверие — «недостаточно», признаков нет: судить не на чем, и это не
 * «здоров». `missingShare` — ноль, а не единица: доля невыданных наблюдений меряет смещение
 * трудности, а трудности здесь нет вовсе.
 */
function neverDeliveredItem(questionId: string, question: QuestionInfo | undefined): ItemPsychometrics {
  return {
    questionId,
    observations: 0,
    missingShare: 0,
    difficulty: null,
    correctedDifficulty: null,
    itemRest: null,
    discrimination: null,
    timing: null,
    timingFlags: { rushed: false, slow: false },
    difficultyConfidence: "insufficient",
    coefficientConfidence: "insufficient",
    declaredDifficulty: question?.difficulty ?? null,
    flags: {
      tooHard: false,
      tooEasy: false,
      negativeDiscrimination: false,
      atChanceLevel: false,
      weakDiscrimination: false,
    },
    neverDelivered: true,
  };
}

/**
 * Посчитать психометрику по наблюдениям.
 *
 * @param responses наблюдения за ответами — уже отобранные фильтром экрана
 * @param ctx справочник заданий и пороги
 */
export function computePsychometrics(
  responses: readonly ResponseFact[],
  ctx: PsychometricsContext,
): TestPsychometrics {
  // В расчёт идут только опознанные респонденты: без ключа человека нельзя ни построить
  // способность, ни отличить его вторую попытку от чужой первой.
  const identified = responses.filter(r => r.respondentId !== null);

  const graded: ItemResponse[] = identified.map(r => ({
    respondentId: r.respondentId!,
    itemId: r.questionId,
    ratio: r.scoreRatio,
  }));
  const ability = abilities(graded);

  const byItem = new Map<string, ResponseFact[]>();
  for (const response of identified) {
    const list = byItem.get(response.questionId);
    if (list) list.push(response);
    else byItem.set(response.questionId, [response]);
  }

  // Медиана времени ПО ТЕСТУ — та величина, относительно которой задание считается тормозящим.
  const testTiming = summariseTiming(identified.map(r => r.latencyMs));

  const items: ItemPsychometrics[] = [];
  for (const [questionId, facts] of byItem) {
    const question = ctx.questionById.get(questionId);
    const scored = facts.filter(f => f.scoreRatio !== null);
    const observations = scored.length;

    const p = difficultyOf(scored.map(f => ({
      respondentId: f.respondentId!,
      itemId: questionId,
      ratio: f.scoreRatio,
    })));
    // Поправка считается ТОЛЬКО у заданий с одним верным ответом из перечисленных вариантов:
    // у остальных типов вероятность случайного попадания невычислима, и пустое место там
    // честнее нуля (FR-17a).
    const corrected = question && isSingleIndexChoice(question.type)
      ? guessingCorrectedDifficulty(p, optionCountOf(question))
      : null;

    const itemRest = itemRestCorrelation(questionId, graded);
    const groups = discriminationIndex(questionId, graded, ability);
    const timing = summariseTiming(facts.map(f => f.latencyMs));
    const rushed = rushedShare(facts.map(f => f.latencyMs), question?.prompt.length ?? 0);

    const difficultyConfidenceLevel = descriptiveConfidence(observations, ctx.minObservations);
    const coefficientConfidenceLevel = coefficientConfidence(observations);
    const descriptiveEnough = difficultyConfidenceLevel !== "insufficient";
    const coefficientEnough = coefficientConfidenceLevel !== "insufficient";
    const tooHard = descriptiveEnough && p !== null && p < TOO_HARD;
    const tooEasy = descriptiveEnough && p !== null && p > TOO_EASY;
    // Достаточно ОДНОГО из двух показателей: они считаются по-разному и ловят разное, а
    // симптом у них один — сильные ошибаются чаще слабых (FR-16).
    const negativeDiscrimination = coefficientEnough
      && ((itemRest !== null && itemRest <= NEGATIVE_DISCRIMINATION)
        || (groups !== null && groups.index <= NEGATIVE_DISCRIMINATION));

    items.push({
      questionId,
      observations,
      // FR-41: доля УЧАСТНИКОВ выборки, которым задание не досталось.
      //
      // Считать долю наблюдений с исходом `missing` нельзя: невыданное задание не порождает
      // наблюдения вовсе — веб-адаптер перебирает ВЫДАННЫЙ состав, а выгрузка LMS не отличает
      // «не выдано» от «нечего оценивать». Такая доля была бы нулём всегда и меру смещения не
      // давала бы. Знаменатель — вся выборка, потому что смещение меряется относительно неё,
      // а не относительно тех, кто задание видел.
      // Обе стороны дроби считаются по ОДНОЙ совокупности — участникам выборки: человек,
      // ответивший только на измерительные задания, в выборку не входит, и включать его в
      // числитель значило бы вычитать из знаменателя то, чего в нём нет.
      missingShare: ability.size === 0
        ? 0
        : (ability.size - facts.reduce((seen, f) => (
          ability.has(f.respondentId!) ? seen.add(f.respondentId!) : seen
        ), new Set<string>()).size) / ability.size,
      difficulty: p,
      correctedDifficulty: corrected,
      itemRest,
      discrimination: groups?.index ?? null,
      timing,
      timingFlags: timingFlags(timing, rushed, testTiming?.medianMs ?? null, p),
      difficultyConfidence: difficultyConfidenceLevel,
      coefficientConfidence: coefficientConfidenceLevel,
      declaredDifficulty: question?.difficulty ?? null,
      // ПРИЗНАК НЕ СТАВИТСЯ ПО ЧИСЛУ, КОТОРОМУ САМ ЭКРАН НЕ ВЕРИТ (FR-05, AC-05).
      //
      // Вскрыто приёмкой: на выборке в два наблюдения задание получало ярлык «Сильные
      // ошибаются чаще» с дискриминативностью −1,00, а в колонке рядом честно стояло «мало
      // данных». Два наблюдения дают корреляцию −1 просто потому, что их двое, и печатать по
      // ней приговор — ровно то, что запрещает порог коэффициентов.
      //
      // Поэтому признаки трудности живут при пороге ОПИСАТЕЛЬНЫХ величин, а признаки
      // дискриминации и угадывания — при пороге КОЭФФИЦИЕНТОВ: каждый при том пороге, по
      // которому посчитана вызвавшая его величина.
      flags: {
        tooHard,
        tooEasy,
        negativeDiscrimination,
        atChanceLevel: coefficientEnough && corrected !== null && corrected <= 0,
        // Слабая дискриминативность — только по `r` и только в неотрицательной зоне: минус уже
        // назван «Сильные ошибаются чаще», и два ярлыка на один симптом спорили бы друг с другом.
        // У вопроса крайней трудности `r` близка к нулю ПО ПОСТРОЕНИЮ: баллы почти у всех
        // одинаковы, различать нечем. Там причина — трудность, и ярлык про различение, стоящий
        // в ранге выше, вытеснил бы настоящий диагноз «Слишком трудный / лёгкий».
        weakDiscrimination: coefficientEnough
          && !negativeDiscrimination
          && !tooHard
          && !tooEasy
          && itemRest !== null
          && itemRest >= 0
          && itemRest < WEAK_DISCRIMINATION,
      },
    });
  }

  // Вопросы пула, которых в выборке нет вовсе (решение владельца 2026-09-26). Строки строятся
  // ПОСЛЕ расчёта и мимо него: наблюдений у них нет, и ни одна величина теста от них не зависит.
  const neverDelivered: ItemPsychometrics[] = [];
  const seenPool = new Set<string>();
  for (const questionId of ctx.poolQuestionIds ?? []) {
    if (byItem.has(questionId) || seenPool.has(questionId)) continue;
    seenPool.add(questionId);
    neverDelivered.push(neverDeliveredItem(questionId, ctx.questionById.get(questionId)));
  }

  const values: ItemValue[] = graded
    .filter(r => r.ratio !== null)
    .map(r => ({ respondentId: r.respondentId, itemId: r.itemId, value: r.ratio! }));
  // FR-20: при неоднородной выдаче полного набора нет ни у кого, и альфа по нему не считается.
  // Основное число — оценка по связям заданий; альфа по общему ядру, если оно есть, идёт рядом,
  // а основной становится, только когда оценку по связям строить не на чем.
  let reliability: Reliability | ReliabilityGap;
  let core: Reliability | null = null;
  if (ctx.unevenDelivery) {
    const byPairs = pairwiseReliability(values);
    const byCore = coreReliability(values);
    const coreValue = byCore !== null && typeof byCore !== "string" ? byCore : null;
    if (typeof byPairs !== "string") {
      reliability = byPairs;
      core = coreValue;
    } else {
      reliability = coreValue ?? byPairs;
    }
  } else {
    reliability = alphaOf(values);
  }
  const sem = typeof reliability === "string"
    ? null
    : standardErrorOfMeasurement(reliability.totalSd, reliability.alpha);

  const bySource: Record<string, number> = {};
  for (const response of identified) bySource[response.source] = (bySource[response.source] ?? 0) + 1;
  const passagesBySource: Record<string, number> = {};
  const passagesSeen = new Set<string>();
  for (const response of identified) {
    if (passagesSeen.has(response.observationId)) continue;
    passagesSeen.add(response.observationId);
    passagesBySource[response.source] = (passagesBySource[response.source] ?? 0) + 1;
  }

  return {
    // Невыданные — в конце: порядок показа решает экран, но выгрузка и срезы читают этот.
    items: [
      ...items.sort((a, b) => a.questionId.localeCompare(b.questionId)),
      ...neverDelivered.sort((a, b) => a.questionId.localeCompare(b.questionId)),
    ],
    reliability,
    coreReliability: core,
    sem,
    semPercent: sem === null || typeof reliability === "string" || reliability.items === 0
      ? null
      : (sem / reliability.items) * 100,
    // Порог переводится в ту же единицу, что и суммарный балл расчёта: сумма долей баллов по
    // пунктам. Сравнивать интервал в долях с порогом в процентах — ошибка на два порядка.
    cutBand: sem !== null && ctx.cutRatio !== null && ctx.cutRatio !== undefined && typeof reliability !== "string"
      ? withPercents(
        bandWithCount(
          cutScoreBand(ctx.cutRatio * reliability.items, sem),
          values,
          reliability.method === "pairwise" ? reliability.items : undefined,
        ),
        ctx.cutRatio,
        reliability.items,
      )
      : null,
    cutForecast: ctx.cutRatio !== null && ctx.cutRatio !== undefined && typeof reliability !== "string"
      ? forecastOf(reliability.alpha, reliability.items, CUT_TARGET_RELIABILITY)
      : null,
    // FR-22: прогноз длины считается ВСЕГДА, когда есть надёжность, — и когда её не хватает,
    // и когда её с запасом. Второе не менее важно: это единственное число трека, которое
    // разрешает СОКРАТИТЬ прогон участника, а не добавляет ему работы.
    lengthForecast: typeof reliability === "string"
      ? null
      : forecastOf(reliability.alpha, reliability.items),
    sample: {
      respondents: ability.size,
      responses: identified.length,
      bySource,
      passagesBySource,
      unknownVersionShare: identified.length === 0
        ? 0
        : identified.filter(r => r.psychoHash === null).length / identified.length,
    },
  };
}

/** Одна редакция содержания задания в выборке (FR-49). */
export interface ItemVersion {
  /** Отпечаток редакции; `null` — серия «версия неизвестна» (FR-09c). */
  psychoHash: string | null;
  observations: number;
  difficulty: number | null;
  /**
   * Корреляция вопрос-остаток по наблюдениям ЭТОЙ редакции; `null` — наблюдений меньше порога
   * коэффициентов (FR-05): корреляция по десятку ответов — шум, и в таблице версий, где рядом
   * стоят две редакции, она читалась бы как «после правки стало хуже».
   */
  itemRest: number | null;
  /** Когда по этой редакции отвечали впервые и в последний раз — ею и различают версии. */
  firstAt: string;
  lastAt: string;
}

/** Разбор ОДНОГО задания: то, что нужно его карточке. */
export interface ItemBreakdown {
  item: ItemPsychometrics;
  /**
   * Редакции содержания, встреченные в выборке, и объёмы по каждой (FR-49).
   *
   * Наблюдения разных редакций НЕ складываются: после правки это психометрически другое
   * задание, и статистика начинается заново. Список нужен затем, чтобы автор мог ответить на
   * главный вопрос после правки — стало ли задание лучше.
   */
  versions: ItemVersion[];
  /** Крайние группы по способности — то, из чего складывается индекс `D`. */
  groups: { size: number; share: number; topDifficulty: number; bottomDifficulty: number } | null;
  /**
   * Варианты ответа с частотами и связью с остальным баллом; `null` — к типу задания
   * дистракторный анализ не применяется (FR-27).
   */
  options: Array<{
    index: number;
    label: string;
    correct: boolean;
    share: number;
    bottomShare: number | null;
    topShare: number | null;
    restCorrelation: number | null;
    dead: boolean;
    inverted: boolean;
    correctButWeak: boolean;
  }> | null;
  /**
   * Э4а: сопоставление, ранжирование и пропуски — разбор по единицам (пары, места, пропуски) с
   * теми же крайними группами, что у вариантов; `null` — у задания единиц нет.
   */
  units: UnitAnalysis | null;
}

/**
 * Выбранные варианты ответа по индексам; `null` — ответ не про выбор варианта.
 *
 * Сопоставление, ранжирование и распределение баллов сюда не идут (FR-27): «вариантов» там нет,
 * а есть пары, порядок и доли, и дистракторный анализ над ними бессмыслен.
 */
function chosenIndexes(type: string, answer: unknown): number[] | null {
  if (type === "single") return typeof answer === "number" ? [answer] : [];
  if (type === "multiple") {
    return Array.isArray(answer) ? answer.filter((i): i is number => typeof i === "number") : [];
  }
  return null;
}

/** Подписи вариантов задания — то, что видел участник. */
function optionLabels(dataJson: unknown): string[] {
  const options = (dataJson as { options?: unknown[] } | null)?.options;
  if (!Array.isArray(options)) return [];
  return options.map(option =>
    typeof option === "string" ? option : String((option as { text?: unknown })?.text ?? ""));
}

/**
 * Собрать разбор задания (FR-24 — FR-26).
 *
 * Крайние группы здесь те же, что у индекса дискриминации: два разных деления выборки дали бы
 * два разных ответа на вопрос «кто здесь сильный», и таблица вариантов перестала бы объяснять
 * стоящее рядом число.
 *
 * @param responses наблюдения выборки
 * @param ctx справочник заданий и пороги
 * @param questionId задание
 * @param correctIndexes индексы верных вариантов по эталону
 */
export function computeItemBreakdown(
  responses: readonly ResponseFact[],
  ctx: PsychometricsContext,
  questionId: string,
  correctIndexes: readonly number[],
  /**
   * Редакция, на наблюдения которой считается карточка (FR-49a); `undefined` — все сразу.
   *
   * Выбор редакции — это смена ВЫБОРКИ, а не просмотр отдельного экрана: пересчитывается вся
   * карточка, включая варианты ответа и время.
   */
  psychoHash?: string | null,
): ItemBreakdown | null {
  const versions = versionsOf(responses, questionId);
  // Отбор по редакции делается ДО расчёта: иначе плитки считались бы по всей выборке, а
  // таблица версий обещала бы, что показана одна.
  if (psychoHash !== undefined) {
    responses = responses.filter(r => r.questionId !== questionId || r.psychoHash === psychoHash);
  }
  // Пул здесь не нужен: разбор строится по наблюдениям, и у невыданного вопроса разбирать нечего.
  const all = computePsychometrics(responses, { ...ctx, poolQuestionIds: undefined });
  const item = all.items.find(row => row.questionId === questionId);
  if (!item) return null;

  const identified = responses.filter(r => r.respondentId !== null);
  const graded: ItemResponse[] = identified.map(r => ({
    respondentId: r.respondentId!,
    itemId: r.questionId,
    ratio: r.scoreRatio,
  }));
  const ability = abilities(graded);
  const groups = discriminationIndex(questionId, graded, ability);

  const question = ctx.questionById.get(questionId);
  const labels = optionLabels(question?.dataJson);
  const choices: ChoiceResponse[] = [];
  let applicable = labels.length > 0;
  for (const response of identified) {
    if (response.questionId !== questionId) continue;
    const chosen = chosenIndexes(question?.type ?? "", response.answer);
    if (chosen === null) {
      applicable = false;
      break;
    }
    choices.push({ respondentId: response.respondentId!, chosen });
  }

  const analysis = applicable
    ? analyseOptions(choices, correctIndexes, labels.length, ability)
    : null;

  const unitType = question?.type === "matching" || question?.type === "ranking" || question?.type === "blanks"
    ? question.type
    : null;
  const units = unitType && question
    ? analyseUnits(
      { type: unitType, prompt: question.prompt, data: question.dataJson, correct: question.correctJson ?? {} },
      identified
        .filter(response => response.questionId === questionId)
        .map(response => ({ respondentId: response.respondentId!, answer: response.answer })),
      ability,
    )
    : null;

  return {
    item,
    versions,
    groups: groups
      ? {
        size: groups.size,
        share: groups.share,
        topDifficulty: groups.topDifficulty,
        bottomDifficulty: groups.bottomDifficulty,
      }
      : null,
    options: analysis
      ? analysis.options.map(option => ({
        index: option.index,
        label: labels[option.index] ?? `Вариант ${option.index + 1}`,
        correct: option.correct,
        share: option.share,
        bottomShare: option.bottomShare,
        topShare: option.topShare,
        restCorrelation: option.restCorrelation,
        ...flagsOf(option),
      }))
      : null,
    units,
  };
}

/**
 * Какую редакцию показывает карточка, пока автор не выбрал другую (FR-49a, эскиз: «По умолчанию —
 * текущая»).
 *
 * Наблюдения разных редакций не складываются, поэтому при нескольких редакциях карточка по
 * умолчанию считается по ОДНОЙ: по текущей, если по ней уже отвечали, иначе по самой свежей серии
 * с известной редакцией. При одной редакции выбирать нечего —
 * `undefined`, и карточка считается по всей выборке, что то же самое.
 *
 * @param responses наблюдения выборки
 * @param questionId вопрос
 * @param currentHash отпечаток текущей редакции вопроса; `null` — неизвестен
 */
export function defaultVersionOf(
  responses: readonly ResponseFact[],
  questionId: string,
  currentHash: string | null,
): string | null | undefined {
  const versions = versionsOf(responses, questionId);
  if (versions.length <= 1) return undefined;
  if (currentHash !== null && versions.some(v => v.psychoHash === currentHash)) return currentHash;
  // Серий больше одной, а «версия неизвестна» — только одна из них: серия с отпечатком есть.
  return versions.find(v => v.psychoHash !== null)!.psychoHash;
}

/**
 * Редакции задания в выборке с объёмами (FR-49).
 *
 * Порядок — по последнему наблюдению, новые сверху: после правки автор смотрит на свежую
 * серию, а прежняя нужна ему для сравнения, а не наоборот.
 */
function versionsOf(responses: readonly ResponseFact[], questionId: string): ItemVersion[] {
  const identified = responses.filter(r => r.respondentId !== null);
  const byHash = new Map<string | null, ResponseFact[]>();
  for (const response of identified) {
    if (response.questionId !== questionId) continue;
    const list = byHash.get(response.psychoHash);
    if (list) list.push(response);
    else byHash.set(response.psychoHash, [response]);
  }

  const out: ItemVersion[] = [];
  for (const [hash, facts] of byHash) {
    const scored = facts.filter(f => f.scoreRatio !== null);
    const times = facts.map(f => f.occurredAt.getTime());
    // Остаток — ТЕ ЖЕ остальные вопросы, что у общей корреляции карточки; от этого вопроса
    // берутся только ответы на эту редакцию. Иначе числа двух строк считались бы по разным
    // правилам, и сравнение «до и после правки» ничего бы не доказывало.
    const graded: ItemResponse[] = identified
      .filter(r => r.questionId !== questionId || r.psychoHash === hash)
      .map(r => ({ respondentId: r.respondentId!, itemId: r.questionId, ratio: r.scoreRatio }));
    out.push({
      psychoHash: hash,
      observations: scored.length,
      difficulty: difficultyOf(scored.map(f => ({
        respondentId: f.respondentId!,
        itemId: questionId,
        ratio: f.scoreRatio,
      }))),
      itemRest: coefficientConfidence(scored.length) === "insufficient"
        ? null
        : itemRestCorrelation(questionId, graded),
      firstAt: new Date(Math.min(...times)).toISOString(),
      lastAt: new Date(Math.max(...times)).toISOString(),
    });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
