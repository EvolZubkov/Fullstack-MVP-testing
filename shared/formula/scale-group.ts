/**
 * @module shared/formula/scale-group
 *
 * Верхняя зона группы шкал (PRD-53 §4.1) — арифметика источника `topGroup(...)`.
 *
 * Типологическая методика толкует результат не по одной шкале, а по НАБОРУ шкал, отставших от
 * максимума не более чем на порог. Три решения, которые этот модуль фиксирует:
 *
 *  1. **Сравнение по НОРМАЛИЗОВАННОМУ значению**, как и ранжирование в
 *     {@link module:shared/formula/scale-rank}: сырые значения шкал с разными доменами
 *     несопоставимы, а `direction: inverse` уже применён к нормализованному.
 *  2. **Граница включается**: отставание ровно на порог — ещё верхняя зона. Иначе методика,
 *     объявившая «разница ≤ 5», на разнице 5 давала бы другой профиль.
 *  3. **Код набора канонический** — ключи в АВТОРСКОМ порядке шкал теста. Одна и та же зона обязана
 *     давать одну строку в вебе, в пакете и при пересчёте из снимка.
 *
 * Чистый модуль — ни DOM, ни Node; плоский двойник живёт в
 * `server/scorm/template/app/dsl/formula.js`.
 */

import type { ScaleResult } from "./types";

/** Порог верхней зоны: абсолютный либо доля от максимума по группе. */
export interface GroupThreshold {
  kind: "abs" | "pct";
  value: number;
}

/** Что источник отдаёт формуле. */
export interface TopGroupResult {
  /** Канонический код набора; `""` у пустой группы. */
  code: string;
  /** Сколько шкал в верхней зоне; `0` у пустой группы. */
  count: number;
  /** Максимум по группе; `0` у пустой группы. */
  max: number;
}

const PERCENT = /^(\d+(?:\.\d+)?)%$/;

/**
 * Столько шкал в группе ещё можно перечислить подмножествами. 2^12−1 = 4095 строк — уже за
 * пределами осмысленного, но конечно; выше начинается зависание редактора, а не помощь автору.
 */
export const MAX_GROUP_FOR_SUBSETS = 12;

/**
 * Порог из аргумента формулы. `null` — аргумент не порог; вычислитель тогда отдаёт `null`, как и на
 * всяком другом неопределённом значении, и попытка не ломается.
 *
 * Строка принимается ТОЛЬКО в виде «N%»: голая строка «10» означала бы, что автор ошибся кавычками,
 * и молча превратить её в абсолютный порог значило бы скрыть опечатку.
 */
export function parseGroupThreshold(raw: number | string): GroupThreshold | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? { kind: "abs", value: raw } : null;
  }
  const match = PERCENT.exec(String(raw).trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? { kind: "pct", value } : null;
}

/** Ключи в авторском порядке шкал теста; неизвестный ключ уходит в конец. */
function inAuthorOrder(keys: readonly string[], authorOrder: readonly string[]): string[] {
  const index = new Map(authorOrder.map((key, i) => [key, i]));
  return [...keys].sort(
    (a, b) => (index.get(a) ?? Number.MAX_SAFE_INTEGER) - (index.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Канонический код набора: ключи в авторском порядке через «+». */
export function groupCode(keys: readonly string[], authorOrder: readonly string[]): string {
  return inAuthorOrder(keys, authorOrder).join("+");
}

/**
 * Верхняя зона группы.
 *
 * Шкала без значения выброшена ДО подсчёта максимума — по той же причине, по которой её выбрасывает
 * `rankScales`: неотвеченная шкала не имеет места в сравнении, а её ноль занял бы низ впереди
 * действительно измеренных. Ключ, повторённый в группе, места не удваивает.
 */
export function resolveTopGroup(
  keys: readonly string[],
  values: Record<string, ScaleResult>,
  authorOrder: readonly string[],
  threshold: GroupThreshold,
): TopGroupResult {
  const present = keys
    .filter((key, i, all) => all.indexOf(key) === i)
    .filter((key) => values[key]?.hasValue === true);
  if (present.length === 0) return { code: "", count: 0, max: 0 };

  const max = present.reduce((acc, key) => Math.max(acc, values[key].normalized), -Infinity);
  // Доля берётся от МОДУЛЯ максимума: у шкалы с отрицательными значениями иначе получился бы
  // отрицательный порог, то есть зона шире всей группы.
  const delta = threshold.kind === "abs" ? threshold.value : (Math.abs(max) * threshold.value) / 100;
  const top = present.filter((key) => values[key].normalized >= max - delta);

  return { code: groupCode(top, authorOrder), count: top.length, max };
}

/**
 * Все непустые подмножества группы, по возрастанию размера, — заготовки исходов для генератора
 * матрицы. Слишком большая группа даёт пустой список: перечислять её бессмысленно, а редактор
 * предупреждает об этом отдельно.
 */
export function subsetCodes(keys: readonly string[], authorOrder: readonly string[]): string[] {
  const ordered = inAuthorOrder([...new Set(keys)], authorOrder);
  if (ordered.length === 0 || ordered.length > MAX_GROUP_FOR_SUBSETS) return [];

  const bySize: string[][] = Array.from({ length: ordered.length + 1 }, () => []);
  for (let mask = 1; mask < 1 << ordered.length; mask++) {
    const subset = ordered.filter((_, i) => (mask >> i) & 1);
    bySize[subset.length].push(subset.join("+"));
  }
  return bySize.flat();
}
