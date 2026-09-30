/**
 * @module server/services/analytics/answer-spread
 * @description PRD-56 FR-22: разброс ответов измерительного задания.
 *
 * У опросника эталона нет (PRD-26 FR-08, PRD-44 FR-09), поэтому «доля верных» для него — не
 * слабое число, а ложное: «0 % верных» утверждает, что люди ошиблись, тогда как ошибиться там
 * не во что. Сказать о таком задании можно одно — ЧТО выбирали, и этим разбросом доля верных
 * на вкладке «Вопросы» и заменяется.
 *
 * Разброс считается по-разному у двух типов, потому что «ответ» у них разный по существу:
 *
 *   - ШКАЛА: участник выбирает ОДНУ градацию, и доля градации — доля выбравших её людей.
 *     Сумма долей равна ста процентам, потому что каждый ответ попадает ровно в одну.
 *   - РАСПРЕДЕЛЕНИЕ БАЛЛОВ: участник делит бюджет между утверждениями, и «доля утверждения» —
 *     доля ОТДАННЫХ ЕМУ баллов от всех розданных. Считать здесь людей нельзя: человек отдал
 *     баллы нескольким утверждениям сразу, и сумма «долей выбравших» превысила бы сотню.
 *
 *   - КОРОТКИЙ ОТВЕТ (PRD-57 FR-28x): участник ПИШЕТ, поэтому вариантов не существует
 *     заранее — их образуют сами ответы. Здесь разброс не заменяет долю верных, а дополняет
 *     её: эталон у задания есть, и автору важно видеть, какие написания правила НЕ ловят.
 *
 * Тона у полос нет намеренно (FR-21b): высокая доля градации не «хорошо» и не «плохо» —
 * эталона, относительно которого это оценивать, у опросника не существует.
 */
import { normalizeForCompare, parseNumericAnswer } from "@shared/answer-check";

/** Доля одного варианта в разбросе. */
export interface SpreadOption {
  /** Подпись варианта: градация шкалы либо утверждение распределения. */
  label: string;
  /** Доля в процентах: у шкалы — доля людей, у распределения — доля розданных баллов. */
  share: number;
}

/** Разброс ответов одного задания. */
export interface AnswerSpread {
  options: SpreadOption[];
  /** Сколько ответов легло в основу: знаменатель, без которого доли не читаются (FR-27). */
  answered: number;
}

export interface AnswerSpreadInput {
  type: "scale" | "allocation" | "short";
  /**
   * Варианты задания: и у шкалы, и у распределения они лежат в `dataJson.options`.
   * У короткого ответа список ПУСТ — варианты образуют сами ответы.
   */
  options: readonly string[];
  /** Сырые ответы участников: индекс градации либо баллы по утверждениям. */
  answers: readonly unknown[];
  /**
   * Вид ответа из набора правил (PRD-57 FR-28ag). У числа частотная таблица написаний
   * бесполезна — «3,14» и «3.14» это один ответ, — поэтому значения раскладываются по
   * корзинам. Отдельной ручки в API для этого не заводится: вид ответа и так лежит
   * рядом с заданием, в `correct_json`.
   */
  answerKind?: "text" | "number";
}

/** Баллы распределения: ключ — индекс утверждения строкой, значение — сколько отдано. */
/**
 * Написанный ответ строкой; `null`, если ответ не текст.
 *
 * Набранный ответ хранится в `jsonb` строкой, но драйвер drizzle при чтении ещё раз пробует
 * `JSON.parse` на каждой строке (`pg-core/columns/jsonb`): «15» приходит числом 15, «true» —
 * булевым. Без обратного превращения числовой ответ выпадал из гистограммы целиком, а у
 * текстового задания пропадали все ответы, похожие на число. Написание при этом может
 * сместиться («1e3» станет «1000»), но сам ответ не теряется.
 */
function writtenOf(answer: unknown): string | null {
  if (typeof answer === "string") return answer;
  if (typeof answer === "number" && Number.isFinite(answer)) return String(answer);
  if (typeof answer === "boolean") return String(answer);
  return null;
}

function allocationOf(answer: unknown): Record<string, number> | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  return answer as Record<string, number>;
}

/**
 * Свёртка написанных ответов по частоте.
 *
 * Ключом служит ФОРМА СРАВНЕНИЯ ответа (`normalizeForCompare`), а подписью строки — самое
 * частое исходное написание в группе. Иначе «Ростехнадзор» и «ростехнадзор» разошлись бы по
 * двум строкам, и автор не увидел бы, что это один ответ — ровно того, ради чего таблица и
 * заводится: понять, почему у задания низкая доля верных.
 *
 * Строки идут по убыванию доли: сверху то, что пишут чаще всего.
 */
function textSpread(answers: readonly unknown[]): AnswerSpread | null {
  const groups = new Map<string, { total: number; spellings: Map<string, number> }>();
  let counted = 0;

  for (const raw of answers) {
    const answer = writtenOf(raw);
    if (answer === null) continue;
    const key = normalizeForCompare(answer);
    // Пустой ответ знаменателя не меняет: «не ответил» — не написание.
    if (key === "") continue;
    const group = groups.get(key) ?? { total: 0, spellings: new Map<string, number>() };
    group.total += 1;
    group.spellings.set(answer, (group.spellings.get(answer) ?? 0) + 1);
    groups.set(key, group);
    counted += 1;
  }

  if (counted === 0) return null;

  const options = [...groups.values()]
    .map((group) => {
      let label = "";
      let best = -1;
      for (const [spelling, times] of group.spellings) {
        if (times > best) {
          best = times;
          label = spelling;
        }
      }
      return { label, share: Math.round((group.total / counted) * 1000) / 10 };
    })
    .sort((a, b) => b.share - a.share);

  return { options, answered: counted };
}

/** Печать значения по-русски: запятая, без хвостовых нулей. */
function formatValue(value: number): string {
  return String(Number(value.toFixed(6))).replace(".", ",");
}

/** Ближайший «круглый» шаг не меньше заданного: 1, 2 или 5 на своём порядке. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const order = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const factor of [1, 2, 5, 10]) {
    if (order * factor >= raw) return order * factor;
  }
  return order * 10;
}

/** Следующий «круглый» шаг после заданного — когда корзин вышло слишком много. */
function widerStep(step: number): number {
  return niceStep(step * 1.0001 + Number.EPSILON);
}

/**
 * Гистограмма введённых значений (FR-28ag).
 *
 * Частотная таблица написаний числу не годится: «3,14», «3.14» и «1/2» — это значения, а
 * не написания, и автору важно не то, кто как набрал, а КУДА попали ответы. Массовый
 * промах ровно в тысячу раз виден корзиной и не виден списком строк.
 *
 * Пустые корзины не печатаются: разброс рисуется строками с полосами, и ряд нулевых
 * строк между двумя населёнными ничего не сообщает, а место занимает. Порядок — по
 * возрастанию значения, потому что это шкала, а не рейтинг; строка «не число» идёт
 * последней: это не диапазон, а сообщение о том, что участник не понял, чего от него
 * ждут.
 */
function numericSpread(answers: readonly unknown[]): AnswerSpread | null {
  const values: number[] = [];
  let notNumbers = 0;

  for (const raw of answers) {
    const answer = writtenOf(raw);
    if (answer === null || answer.trim() === "") continue;
    const parsed = parseNumericAnswer(answer);
    if (parsed === null) notNumbers += 1;
    else values.push(parsed);
  }

  const counted = values.length + notNumbers;
  if (counted === 0) return null;

  const share = (times: number) => Math.round((times / counted) * 1000) / 10;
  const nan: SpreadOption[] = notNumbers > 0 ? [{ label: "не число", share: share(notNumbers) }] : [];
  if (values.length === 0) return { options: nan, answered: counted };

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return { options: [{ label: formatValue(min), share: share(values.length) }, ...nan], answered: counted };
  }

  let step = niceStep((max - min) / 10);
  let start = Math.floor(min / step) * step;
  while (Math.floor((max - start) / step) + 1 > 10) {
    step = widerStep(step);
    start = Math.floor(min / step) * step;
  }

  const buckets = new Map<number, number>();
  for (const value of values) {
    const index = Math.floor((value - start) / step);
    buckets.set(index, (buckets.get(index) ?? 0) + 1);
  }

  const options = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, times]) => ({
      label: `от ${formatValue(start + index * step)} до ${formatValue(start + (index + 1) * step)}`,
      share: share(times),
    }));

  return { options: [...options, ...nan], answered: counted };
}

/** Сводка свободного текста: сколько написали и как длинно (PRD-57 FR-32). */
export interface TextVolume {
  /** Сколько ответов оказалось непустыми: знаменатель всего остального. */
  answered: number;
  /** Медиана длины в символах — типичная работа. */
  medianLength: number;
  minLength: number;
  maxLength: number;
}

/**
 * Сводка свободного текста (PRD-57 FR-32).
 *
 * Частотная таблица развёрнутому ответу не годится по устройству: двух одинаковых ответов
 * не бывает, и список из сотни строк с долей «1 %» каждая не сообщает ничего. Объективного
 * о таком задании ровно две вещи — СКОЛЬКО написали и КАК ДЛИННО, и обе здесь.
 *
 * Медиана, а не среднее: одна работа на три тысячи знаков сдвигает среднее и врёт о
 * типичном ответе, тогда как медиана остаётся на месте. Границы печатаются рядом — именно
 * они показывают, что такая работа была.
 *
 * Длина меряется по видимому тексту: краевые пробелы — свойство поля ввода, а не ответа.
 *
 * @param answers сырые ответы участников
 * @returns сводка либо `null`, когда никто не написал ни слова
 */
export function textVolume(answers: readonly unknown[]): TextVolume | null {
  const lengths: number[] = [];
  for (const raw of answers) {
    const answer = writtenOf(raw);
    if (answer === null) continue;
    const text = answer.trim();
    if (text === "") continue;
    lengths.push(text.length);
  }
  if (lengths.length === 0) return null;

  lengths.sort((a, b) => a - b);
  const middle = Math.floor(lengths.length / 2);
  // Чётное число ответов: берётся НИЖНЯЯ из двух середин, а не их среднее — длина это
  // целое число символов, и «6,5 символа» читается как ошибка счёта.
  const median = lengths.length % 2 === 1 ? lengths[middle] : lengths[middle - 1];

  return {
    answered: lengths.length,
    medianLength: median,
    minLength: lengths[0],
    maxLength: lengths[lengths.length - 1],
  };
}

/**
 * Разброс ответов задания.
 *
 * @returns доли по вариантам либо `null`, когда разбрасывать нечего: заданию не из чего
 *   строить варианты или на него никто не ответил. Пустой разброс и разброс из нулей —
 *   разные вещи, и `null` говорит именно «считать не из чего».
 */
export function answerSpread(input: AnswerSpreadInput): AnswerSpread | null {
  const { type, options, answers, answerKind } = input;
  // Короткий ответ проверяется ПЕРВЫМ: вариантов у него нет по устройству, и общая
  // проверка «нет вариантов — считать не из чего» отбросила бы его целиком.
  if (type === "short") return answerKind === "number" ? numericSpread(answers) : textSpread(answers);
  if (options.length === 0 || answers.length === 0) return null;

  const weight = new Array<number>(options.length).fill(0);
  let counted = 0;

  for (const answer of answers) {
    if (type === "scale") {
      // Индекс приходит числом от веба и строкой из выгрузки LMS — оба вида читаются.
      const index = typeof answer === "number" ? answer : Number(answer);
      if (!Number.isInteger(index) || index < 0 || index >= options.length) continue;
      weight[index] += 1;
      counted += 1;
      continue;
    }

    const points = allocationOf(answer);
    if (points === null) continue;
    let given = 0;
    for (let index = 0; index < options.length; index += 1) {
      const value = Number(points[String(index)] ?? 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      weight[index] += value;
      given += value;
    }
    // Ответ, в котором не роздано ничего, знаменателя не меняет: иначе он разбавил бы доли
    // так, будто человек ответил, ничего не выбрав.
    if (given > 0) counted += 1;
  }

  if (counted === 0) return null;

  const total = weight.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;

  return {
    options: options.map((label, index) => ({
      label,
      share: (weight[index] / total) * 100,
    })),
    answered: counted,
  };
}
