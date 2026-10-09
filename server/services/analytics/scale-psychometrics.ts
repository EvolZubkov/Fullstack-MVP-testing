/**
 * @module server/services/analytics/scale-psychometrics
 * @description PRD-66 FR-29 — FR-32: психометрика измерительных ШКАЛ.
 *
 * У заданий без эталона нет ни трудности, ни дискриминации: проверять нечего, и единица
 * анализа для них — шкала PRD-5, а не тест. Пункты шкалы считаются согласованными между собой,
 * а не верными или неверными.
 *
 * ЗНАЧЕНИЕ ПУНКТА — ВКЛАД ОТВЕТА В ШКАЛУ со знаком и весом (FR-19a), а не номер выбранной
 * градации. Вклад считает тот же движок, что и результат участника
 * (`shared/scales/engine`): второй способ его вычисления развёл бы психометрику с тем, что
 * участник видел в своём отчёте.
 *
 * Отсюда же вычислимость вопроса «а что, если вклад перевернуть» (FR-31b): знак меняется,
 * наблюдения остаются те же, и подпись даёт проверяемое следствие вместо догадки о причине.
 */

import { computeAnswerContributions, type Answer, type MeasurementSpec } from "@shared/scales/engine";
import type { QuestionType } from "@shared/questions/question-type";
import { itemRestCorrelation, type ItemResponse } from "@shared/psychometrics/item-metrics";
import { alphaOf, type Reliability, type ReliabilityGap } from "@shared/psychometrics/reliability";
import {
  alphaIfMirrored,
  gradeDistribution,
  isDeadItem,
  looksIpsative,
  scaleValues,
  type ScaleResponse,
} from "@shared/psychometrics/scales";

import type { ResponseFact } from "./response-matrix";

/** Что известно о пункте шкалы помимо наблюдений за ним. */
export interface ScaleItemInfo {
  questionId: string;
  prompt: string;
  type: string;
  /** Подписи градаций ответа — их задаёт автор (PRD-26), и придумывать их нельзя. */
  gradeLabels: string[];
}

/** Условия расчёта по шкалам. */
export interface ScaleContext {
  /** Единицы измерения теста — те же, по которым считается результат участника. */
  measurements: MeasurementSpec[];
  /** Ключ шкалы -> её название на экране. */
  scaleLabels: ReadonlyMap<string, string>;
  itemById: ReadonlyMap<string, ScaleItemInfo>;
}

/**
 * Вклад пункта в шкалу одним числом — колонка «Вклад» (эскиз prd66-item-quality, wf-scales).
 *
 * `value` — на сколько сдвигается шкала за шаг ответа: у пункта Ликерта — за одну градацию
 * вверх, у вклада «за ответ» — за сам ответ, у распределения баллов — за один назначенный балл.
 * Знак и есть то, что автор проверяет: у обратного пункта он должен быть отрицательным.
 * `exact: false` — вклады градаций неравномерны, и число — наклон по методу наименьших квадратов,
 * то есть направление пункта, а не точный шаг.
 */
export interface ItemContribution {
  value: number;
  exact: boolean;
}

/** Пункт шкалы с его психометрикой. */
export interface ScaleItemPsychometrics {
  questionId: string;
  prompt: string;
  /** Тип вопроса — для пиктограммы в строке: сырой тип в интерфейсе недопустим. */
  questionType: string;
  /**
   * Вклад пункта в эту шкалу (см. {@link ItemContribution}); `null` — одним числом он не
   * выражается: вклад зависит от того, КАКОЙ вариант выбран, а варианты не упорядочены.
   */
  contribution: ItemContribution | null;
  observations: number;
  /** Корреляция пункта с остатком СВОЕЙ шкалы; `null` — считать не на чем. */
  itemRest: number | null;
  /** Доли ответов по градациям — форма распределения (FR-30a). */
  distribution: number[];
  gradeLabels: string[];
  /** Пункт, где почти все ответили одинаково: он ничего не различает. */
  dead: boolean;
  /**
   * Пункт ведёт себя противоположно своей шкале (FR-31a).
   *
   * Причину признак НЕ называет: обратная формулировка с неперевёрнутым вкладом, пункт не из
   * этой шкалы, перепутанный знак и случайность на малой выборке дают одно и то же число.
   */
  againstScale: boolean;
  /**
   * Какой стала бы альфа шкалы с перевёрнутым вкладом этого пункта (FR-31b); `null` — пересчёт
   * невозможен. Это вычислимое следствие вместо догадки о причине.
   */
  alphaIfMirrored: number | null;
}

/** Психометрика одной шкалы. */
export interface ScalePsychometrics {
  scaleKey: string;
  label: string;
  /** Альфа по вносящим вклад пунктам либо причина, по которой её нет. */
  reliability: Reliability | ReliabilityGap;
  respondents: number;
  /**
   * Ипсативная методика: сумма вкладов респондента фиксирована по построению (FR-32).
   *
   * Вклады там связаны отрицательно не потому, что пункты плохи, а потому, что иначе не
   * бывает, — и альфа систематически занижена. Число выводится с оговоркой, а не как дефект.
   */
  ipsative: boolean;
  items: ScaleItemPsychometrics[];
}

/** Номер выбранной градации — по нему строится гистограмма распределения. */
function gradeOf(type: string, answer: unknown): number | null {
  // Шкала Ликерта (PRD-26) отвечает индексом градации; прочие типы гистограммы не имеют.
  if (type === "scale" && typeof answer === "number") return answer;
  if (type === "single" && typeof answer === "number") return answer;
  return null;
}

/** Погрешность сравнения вкладов: они приходят из JSON и бывают дробными. */
const EPSILON = 1e-9;

/**
 * Вклад пункта в шкалу одним числом (колонка «Вклад»).
 *
 * Источник — ТЕ ЖЕ единицы измерения, по которым считается результат участника и значение
 * пункта в этой же психометрике: вклад единицы — `value * weight`, как в `unitContribution`
 * движка шкал. Своего второго представления о «прямом» и «обратном» пункте здесь нет.
 *
 * - вклад «за ответ» (`question`) — сумма его единиц;
 * - пункт Ликерта с вкладом по градациям — наклон вклада по номеру градации; невыбранная
 *   градация без единицы вносит 0, как и в движке. Равный шаг даёт точное число («+1»),
 *   неравный — направление (`exact: false`);
 * - распределение баллов и множественный выбор — общий множитель, если он у всех единиц один;
 * - одиночный выбор с неупорядоченными вариантами, соответствия, ранжирование и смешанные
 *   источники — `null`: вклад зависит от выбранного варианта.
 *
 * @param measurements единицы измерения теста
 * @param questionId пункт
 * @param scaleKey шкала
 * @param type тип вопроса
 * @param gradeCount число градаций вопроса (по подписям)
 */
export function itemContribution(
  measurements: readonly MeasurementSpec[],
  questionId: string,
  scaleKey: string,
  type: string,
  gradeCount: number,
): ItemContribution | null {
  const units = measurements.filter(m => m.questionId === questionId && m.scaleKey === scaleKey);
  if (units.length === 0) return null;
  const kinds = new Set(units.map(unit => unit.sourceType));
  if (kinds.size !== 1) return null;
  const kind = units[0].sourceType;
  const coefficient = (unit: MeasurementSpec) => unit.value * unit.weight;

  if (kind === "question") {
    return { value: units.reduce((sum, unit) => sum + coefficient(unit), 0), exact: true };
  }

  if (kind === "option" && type === "scale") {
    const indexes = units.map(unit => Number(unit.sourceKey));
    if (indexes.some(index => !Number.isInteger(index) || index < 0)) return null;
    const count = Math.max(gradeCount, Math.max(...indexes) + 1);
    if (count < 2) return null;
    const perGrade = new Array<number>(count).fill(0);
    units.forEach((unit, i) => { perGrade[indexes[i]] += coefficient(unit); });

    const meanX = (count - 1) / 2;
    const meanY = perGrade.reduce((sum, y) => sum + y, 0) / count;
    let covariance = 0;
    let variance = 0;
    perGrade.forEach((y, x) => {
      covariance += (x - meanX) * (y - meanY);
      variance += (x - meanX) ** 2;
    });
    const slope = covariance / variance;
    const exact = perGrade.every((y, x) => Math.abs(y - (perGrade[0] + slope * x)) < EPSILON);
    return { value: slope, exact };
  }

  if (kind === "option_allocation" || (kind === "option" && type === "multiple")) {
    const first = coefficient(units[0]);
    return units.every(unit => Math.abs(coefficient(unit) - first) < EPSILON)
      ? { value: first, exact: true }
      : null;
  }

  return null;
}

/**
 * Какие шкалы меряет каждый пункт — по единицам измерения теста.
 *
 * @param measurements единицы измерения теста
 * @returns пункт -> ключи его шкал
 */
function scalesMeasuredBy(measurements: readonly MeasurementSpec[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of measurements) {
    const set = out.get(m.questionId) ?? new Set<string>();
    set.add(m.scaleKey);
    out.set(m.questionId, set);
  }
  return out;
}

/**
 * Дал ли участник ответ на пункт. Пропуск (`missing`) и пустой ответ — не ответ: дополнить
 * их нулём значило бы приписать участнику мнение, которого он не высказывал.
 *
 * @param response наблюдение
 */
function answered(response: ResponseFact): boolean {
  if (response.outcome === "missing") return false;
  const answer = response.answer;
  if (answer === null || answer === undefined || answer === "") return false;
  if (Array.isArray(answer)) return answer.length > 0;
  if (typeof answer === "object") return Object.keys(answer).length > 0;
  return true;
}

/**
 * Состоит ли шкала только из пунктов распределения баллов (PRD-44).
 *
 * @param measurements единицы измерения теста
 * @param scaleKey шкала
 */
function allocationOnly(measurements: readonly MeasurementSpec[], scaleKey: string): boolean {
  const units = measurements.filter(m => m.scaleKey === scaleKey);
  return units.length > 0 && units.every(m => m.sourceType === "option_allocation");
}

/**
 * Психометрика шкал теста.
 *
 * @param responses наблюдения выборки — те же, на которых считается всё остальное
 * @param ctx единицы измерения, названия шкал и справочник пунктов
 */
export function computeScalePsychometrics(
  responses: readonly ResponseFact[],
  ctx: ScaleContext,
): ScalePsychometrics[] {
  const identified = responses.filter(r => r.respondentId !== null);
  const scalesByQuestion = scalesMeasuredBy(ctx.measurements);

  // Вклад ответа в каждую шкалу: одна единица измерения — одна запись, поэтому ответ с
  // несколькими выбранными вариантами законно двигает шкалу несколько раз.
  const byScale = new Map<string, ScaleResponse[]>();
  for (const response of identified) {
    const info = ctx.itemById.get(response.questionId);
    const contributions = computeAnswerContributions(
      ctx.measurements,
      response.questionId,
      response.answer as Answer,
      info?.type as QuestionType | undefined,
    );
    const summed = new Map<string, number>();
    for (const contribution of contributions) {
      summed.set(contribution.scaleKey, (summed.get(contribution.scaleKey) ?? 0) + contribution.delta);
    }
    // Шкала, которую пункт меряет, но в которую ответ ничего не внёс, получает НОЛЬ, а не
    // пропуск. Движок шкал не «зажигает» утверждение с нулём баллов (PRD-44 FR-12) — для
    // результата участника это верно, а для психометрики ноль и есть ответ: «этот стиль не мой».
    // Пропуском он выбрасывал участника из полных строк альфы, и на опроснике ведущего стиля
    // из 21 прохождения в расчёт шкалы попадали 3–6 (2026-10-06).
    if (answered(response)) {
      for (const scaleKey of scalesByQuestion.get(response.questionId) ?? []) {
        if (!summed.has(scaleKey)) summed.set(scaleKey, 0);
      }
    }
    // Задание, не меряющее ни одной шкалы, в расчёт не идёт.
    if (summed.size === 0) continue;

    for (const [scaleKey, value] of summed) {
      const list = byScale.get(scaleKey) ?? [];
      list.push({
        respondentId: response.respondentId!,
        itemId: response.questionId,
        grade: gradeOf(info?.type ?? "", response.answer) ?? -1,
        value,
      });
      byScale.set(scaleKey, list);
    }
  }

  const out: ScalePsychometrics[] = [];
  for (const [scaleKey, scaleResponses] of byScale) {
    const values = scaleValues(scaleResponses);
    const reliability = alphaOf(values);
    const baseAlpha = typeof reliability === "string" ? null : reliability.alpha;

    const itemIds = [...new Set(scaleResponses.map(r => r.itemId))];
    const forCorrelation: ItemResponse[] = scaleResponses.map(r => ({
      respondentId: r.respondentId,
      itemId: r.itemId,
      // Корреляция считается по ВКЛАДУ: он и есть значение пункта в этой шкале.
      ratio: r.value,
    }));

    const items: ScaleItemPsychometrics[] = itemIds.map(questionId => {
      const info = ctx.itemById.get(questionId);
      const own = scaleResponses.filter(r => r.itemId === questionId);
      const itemRest = itemRestCorrelation(questionId, forCorrelation);
      // У типа без выбранной градации (распределение баллов, ранжирование) гистограммы не
      // существует: участник не выбирает вариант, а раскладывает баллы. Пустой массив, а НЕ
      // массив нулей: нули рисуются столбиками нулевой высоты и читаются как «ответили мимо»
      // при том, что ответы есть (вскрыто на стенде, опросник ведущего стиля).
      const graded = own.filter(r => r.grade >= 0);
      const distribution = graded.length === 0
        ? []
        : gradeDistribution(own, info?.gradeLabels.length ?? 0);
      const mirrored = alphaIfMirrored(scaleResponses, questionId);

      return {
        questionId,
        prompt: info?.prompt ?? questionId,
        questionType: info?.type ?? "",
        contribution: itemContribution(
          ctx.measurements, questionId, scaleKey, info?.type ?? "", info?.gradeLabels.length ?? 0,
        ),
        observations: own.length,
        itemRest,
        distribution,
        gradeLabels: info?.gradeLabels ?? [],
        dead: isDeadItem(distribution),
        againstScale: itemRest !== null && itemRest < 0,
        // Следствие показывается только там, где оно осмысленно: пункт, и так согласованный
        // со шкалой, переворачивать незачем, и число рядом с ним сбивало бы с толку.
        alphaIfMirrored: typeof mirrored === "string" || baseAlpha === null || itemRest === null || itemRest >= 0
          ? null
          : mirrored.alpha,
      };
    });

    out.push({
      scaleKey,
      label: ctx.scaleLabels.get(scaleKey) ?? scaleKey,
      reliability,
      respondents: new Set(scaleResponses.map(r => r.respondentId)).size,
      // Распределение баллов ипсативно по построению, но запас баллов делится МЕЖДУ шкалами:
      // постоянна сумма по всем шкалам, а внутри одной шкалы суммы у людей законно разные.
      // Сверка сумм в пределах шкалы его не видит, поэтому признак берётся и от типа пунктов.
      ipsative: looksIpsative(scaleResponses) || allocationOnly(ctx.measurements, scaleKey),
      items: items.sort((a, b) => a.questionId.localeCompare(b.questionId)),
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}
