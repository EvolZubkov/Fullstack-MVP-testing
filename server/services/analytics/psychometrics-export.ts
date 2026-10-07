/**
 * @module server/services/analytics/psychometrics-export
 * @description PRD-66 FR-53, FR-54: листы психометрического отчёта и матрицы ответов.
 *
 * Построение листов вынесено из маршрута и сделано чистым: лист — это таблица значений, и
 * проверять её надо по значениям, а не по байтам файла.
 *
 * Состав выборки печатается на КАЖДОМ листе (FR-53). Выгрузку уносят из системы и читают
 * отдельно от экрана — через неделю и на чужом компьютере; лист без условий отбора невозможно
 * ни повторить, ни оспорить, и он превращается в набор чисел без происхождения.
 */

import type { ResponseFact } from "./response-matrix";
import type { TestPsychometrics } from "./psychometrics";
import type { AttemptPick } from "@shared/analytics/attempt-pick";

/** Строка «Попытки» шапки листа: правило словами, как его прочтёт тот, кому переслали файл. */
const ATTEMPTS_HEADER: Record<AttemptPick, string> = {
  all: "все попытки",
  first: "только первая каждого участника",
  best: "только лучшая каждого участника (отбор по результату, статистика смещена)",
  last: "только последняя каждого участника",
};

/** Значение ячейки листа: Excel принимает строки и числа. */
export type Cell = string | number;

/** Условия, при которых собрана выгрузка, — шапка каждого листа. */
export interface ExportContext {
  testTitle: string;
  /** Условия отбора словами — те же, что показаны на экране. */
  conditions: string;
  /** Какая попытка участника взята: от правила зависят все числа листа (FR-51). */
  attempts: AttemptPick;
  generatedAt: Date;
}

/** Как в матрице кодируется отсутствие наблюдения (FR-54a). */
export const MATRIX_NOT_DELIVERED = "NA";
/** Как в матрице кодируется ответ, которому нечего оценивать. */
export const MATRIX_NOT_GRADED = "NG";

/** Дата и время одной строкой — без привязки к локали читателя. */
function stamp(at: Date): string {
  return at.toISOString().replace("T", " ").slice(0, 16);
}

/**
 * Шапка листа: на чём стоят его числа.
 *
 * Печатается перед таблицей, а не в отдельном листе «О выгрузке»: лист открывают по одному, и
 * условия, лежащие в соседней вкладке книги, не читает никто.
 */
export function sampleHeader(ctx: ExportContext, sample: TestPsychometrics["sample"]): Cell[][] {
  const bySource = Object.entries(sample.bySource)
    .map(([source, count]) => `${source}: ${count}`)
    .join(", ");
  return [
    [`Тест: ${ctx.testTitle}`],
    [`Условия отбора: ${ctx.conditions || "без условий"}`],
    [`Попытки: ${ATTEMPTS_HEADER[ctx.attempts]}`],
    [`Выборка: респондентов ${sample.respondents}, наблюдений ${sample.responses}`],
    [`Источники: ${bySource || "нет наблюдений"}`],
    [`Редакция неизвестна: ${(sample.unknownVersionShare * 100).toFixed(1)} % наблюдений`],
    [`Выгружено: ${stamp(ctx.generatedAt)}`],
    [],
  ];
}

/** Число под Excel: `null` печатается прочерком, а не нулём и не пустотой. */
function num(value: number | null, digits = 2): Cell {
  return value === null ? "—" : Number(value.toFixed(digits));
}

/**
 * Лист «Задания»: по строке на задание — все величины, что считает движок.
 *
 * Уровни доверия печатаются РЯДОМ с числами, а не вместо них: в файле, в отличие от экрана,
 * прятать коэффициент незачем — читатель уносит его во внешний пакет, — но знать, на скольких
 * наблюдениях он получен, обязан.
 */
export function itemsSheet(
  ctx: ExportContext,
  psychometrics: TestPsychometrics,
  promptById: ReadonlyMap<string, string>,
): Cell[][] {
  const rows: Cell[][] = sampleHeader(ctx, psychometrics.sample);
  rows.push([
    "Вопрос", "Текст", "Наблюдений", "Трудность", "Трудность с поправкой",
    "Дискриминативность (r)", "Индекс дискриминации (D)", "Заявленная сложность (0 — легко, 100 — сложно)",
    "Медиана времени, с", "Доверие к трудности", "Доверие к коэффициентам", "Признаки",
  ]);

  for (const item of psychometrics.items) {
    const flags = [
      // FR-46a: вопрос пула без наблюдений — словом, как на экране: пустые клетки читались бы
      // как сбой выгрузки, а не как «тест его пока не выдавал».
      item.neverDelivered ? "вопрос ещё не выдавался" : "",
      item.flags.negativeDiscrimination ? "сильные ошибаются чаще" : "",
      item.flags.atChanceLevel ? "на уровне угадывания" : "",
      item.flags.weakDiscrimination ? "сильные и слабые отвечают одинаково" : "",
      item.flags.tooHard ? "слишком трудный" : "",
      item.flags.tooEasy ? "слишком лёгкий" : "",
      item.timingFlags.rushed ? "отвечают не читая" : "",
      item.timingFlags.slow ? "тормозит прогон" : "",
    ].filter(Boolean).join("; ");

    rows.push([
      item.questionId,
      promptById.get(item.questionId) ?? "",
      item.observations,
      num(item.difficulty),
      num(item.correctedDifficulty),
      num(item.itemRest),
      num(item.discrimination),
      item.declaredDifficulty === null ? "—" : item.declaredDifficulty,
      item.timing === null ? "—" : Number((item.timing.medianMs / 1000).toFixed(1)),
      item.difficultyConfidence,
      item.coefficientConfidence,
      flags,
    ]);
  }
  return rows;
}

/** Лист «Тест»: надёжность и то, что из неё следует. */
export function testSheet(ctx: ExportContext, psychometrics: TestPsychometrics): Cell[][] {
  const rows: Cell[][] = sampleHeader(ctx, psychometrics.sample);
  rows.push(["Показатель", "Значение", "Пояснение"]);

  if (typeof psychometrics.reliability === "string") {
    // Причина отказа печатается словами: пустая клетка на месте альфы читается как ошибка
    // выгрузки, а не как «посчитать было не на чем».
    const reason: Record<string, string> = {
      "too-few-items": "в наборе меньше двух вопросов",
      "too-few-respondents": "меньше двух респондентов с полным набором вопросов",
      "no-variance": "все участники набрали поровну — сравнивать разбросы не с чем",
      "random-delivery": "неприменимо к случайной выдаче: у участников разные наборы, и пар вопросов с достаточным пересечением слишком мало (FR-20)",
    };
    rows.push(["Надёжность (альфа)", "—", reason[psychometrics.reliability] ?? psychometrics.reliability]);
    return rows;
  }

  const reliability = psychometrics.reliability;
  // FR-20: при неоднородной выдаче число — оценка по связям заданий либо альфа по общему ядру;
  // в файле это названо так же прямо, как на экране.
  if (reliability.method === "pairwise") {
    rows.push(["Надёжность (оценка по связям вопросов)", num(reliability.alpha),
      `средняя корреляция по ${reliability.pairs ?? 0} парам вопросов, пересчитанная по Спирмену-Брауну на вариант из ${reliability.items} вопросов`]);
    rows.push(["Вопросов в варианте", reliability.items, ""]);
    rows.push(["Респондентов в расчёте", reliability.respondents, "все участники выборки: каждая пара — по тем, кому досталось и то и другое"]);
  } else {
    rows.push([
      reliability.method === "core" ? "Надёжность (альфа по общему ядру)" : "Надёжность (альфа)",
      num(reliability.alpha),
      reliability.method === "core" ? "вопросы, которые видели все участники выборки" : "внутренняя согласованность вопросов",
    ]);
    rows.push(["Вопросов в расчёте", reliability.items, ""]);
    rows.push([
      "Респондентов в расчёте",
      reliability.respondents,
      "только полные наборы: разброс суммы и разбросы пунктов считаются на одной выборке",
    ]);
  }
  if (psychometrics.coreReliability) {
    rows.push(["Альфа по общему ядру", num(psychometrics.coreReliability.alpha),
      `${psychometrics.coreReliability.items} вопросов, которые видели все участники выборки`]);
  }
  rows.push([
    "Дихотомический набор",
    reliability.dichotomous ? "да" : "нет",
    reliability.dichotomous ? "альфа здесь совпадает с KR-20" : "",
  ]);
  rows.push(["Стандартное отклонение суммы", num(reliability.totalSd), ""]);
  // Методисту нужны обе единицы: сумма долей балла — чтобы сверить расчёт по формуле, процентные
  // пункты — чтобы сопоставить с порогом теста, как это делает экран.
  rows.push(["Ошибка измерения (SEM)", num(psychometrics.sem), "в сумме долей балла по вопросам"]);
  rows.push([
    "Ошибка измерения, п.п.",
    num(psychometrics.semPercent),
    "в процентных пунктах результата: SEM, делённая на число вопросов расчёта",
  ]);
  if (psychometrics.cutBand) {
    rows.push([
      "Интервал вокруг проходного балла",
      `${psychometrics.cutBand.low.toFixed(2)} — ${psychometrics.cutBand.high.toFixed(2)}`,
      `в сумме долей балла; множитель ошибки ${psychometrics.cutBand.z}`,
    ]);
    rows.push([
      "Интервал вокруг проходного балла, %",
      `${psychometrics.cutBand.lowPercent.toFixed(1)} — ${psychometrics.cutBand.highPercent.toFixed(1)}`,
      `порог ${psychometrics.cutBand.cutPercent.toFixed(1)} %`,
    ]);
  }
  return rows;
}

/**
 * Лист «Матрица ответов»: строка — респондент, колонка — задание, ячейка — доля балла (FR-54).
 *
 * Это не отчёт, а СЫРЬЁ: стандартный вход внешнего пакета психометрики и способ для методиста
 * заказчика проверить наши числа своими средствами.
 *
 * «Не выдавалось» и «выдано, ответа нет» кодируются РАЗНЫМИ значениями (FR-54a): первое — `NA`,
 * второе — ноль. Свести их к пустой ячейке значило бы воспроизвести ровно тот дефект разбора,
 * который трек и чинил: задание, которого человек не видел, считалось бы проваленным.
 *
 * Строка подписана псевдонимным ключом респондента, а не ФИО, независимо от настройки
 * обезличивания импорта (FR-54c): выгрузка уходит из системы, и имя в ней — это персональные
 * данные, уехавшие вместе с файлом.
 */
export function matrixSheet(
  ctx: ExportContext,
  responses: readonly ResponseFact[],
  sample: TestPsychometrics["sample"],
): Cell[][] {
  const rows: Cell[][] = sampleHeader(ctx, sample);
  rows.push([
    `Обозначения: ${MATRIX_NOT_DELIVERED} — вопрос не выдавался; `
    + `${MATRIX_NOT_GRADED} — ответ не оценивается (нет эталона); число — доля балла от 0 до 1`,
  ]);
  rows.push([]);

  const questionIds = [...new Set(responses.map(r => r.questionId))].sort();
  const byRespondent = new Map<string, Map<string, ResponseFact>>();
  for (const response of responses) {
    if (!response.respondentId) continue;
    let row = byRespondent.get(response.respondentId);
    if (!row) {
      row = new Map<string, ResponseFact>();
      byRespondent.set(response.respondentId, row);
    }
    row.set(response.questionId, response);
  }

  rows.push(["Респондент", ...questionIds]);
  for (const [respondentId, answers] of [...byRespondent].sort(([a], [b]) => a.localeCompare(b))) {
    rows.push([
      respondentId,
      ...questionIds.map(questionId => {
        const fact = answers.get(questionId);
        if (!fact) return MATRIX_NOT_DELIVERED;
        if (fact.scoreRatio === null) return MATRIX_NOT_GRADED;
        return Number(fact.scoreRatio.toFixed(4));
      }),
    ]);
  }
  return rows;
}
