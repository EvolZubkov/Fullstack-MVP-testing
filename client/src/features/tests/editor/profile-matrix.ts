/**
 * @module features/tests/editor/profile-matrix
 * @description Заготовки исходов для шаблона «Профиль по группе шкал» (PRD-53 §5.2).
 *
 * Генератор живёт В РЕДАКТОРЕ, а не в ядре формул, по одной причине: метке набора нужны НАЗВАНИЯ
 * шкал, а контекст вычислителя их не несёт — там у измерения есть подпись уровня, но не имя
 * (см. `SCALE_GROUP_PROPS` в `shared/formula/types`). В редакторе имена под рукой, и автор правит
 * предложенную метку, если методика называет профиль иначе.
 *
 * Чистый модуль без React — генерация проверяется юнит-тестами, а секция остаётся тонким видом.
 */

import { subsetCodes } from "@shared/formula/scale-group";

/** Минимальная шкала, какой её знает форма шаблона. */
export type ProfileScale = { key: string; label: string };

/** Одна строка матрицы: код набора и предложенная метка. Тексты автор пишет сам. */
export type ProfileMatrixRow = { code: string; label: string };

/**
 * Как назвать набор по его размеру. Названия ПРЕДЛОЖЕННЫЕ: методика вправе называть профили
 * иначе, и метка исхода правится автором.
 */
const SIZE_NAME = ["Сфокусированный", "Двухвекторный", "Широкий", "Сбалансированный"];

function sizeName(size: number): string {
  return SIZE_NAME[size - 1] ?? `Набор из ${size}`;
}

/**
 * «X», «X и Y», «X, Y и Z» — запятые и союз перед последним, единообразно для любого размера.
 *
 * Книга ЧИЛ в своей ячейке грамматики для трёх векторов союз не ставит, а для четырёх ставит;
 * воспроизводить эту непоследовательность незачем — метка всё равно правится.
 */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
}

/** Предложенная метка набора: размер и состав. @public */
export function profileSetLabel(keys: readonly string[], scales: readonly ProfileScale[]): string {
  const byKey = new Map(scales.map((s) => [s.key, s.label || s.key]));
  const names = keys.map((key) => byKey.get(key) ?? key);
  return `${sizeName(keys.length)}: ${joinNames(names)}`;
}

/**
 * Заготовки исходов группы.
 *
 * `byCountOnly` даёт запасные исходы по размеру набора вместо всех сочетаний — путь для группы
 * из пяти и более шкал, где точных наборов 31 и больше.
 *
 * @public
 */
export function profileMatrix(
  keys: readonly string[],
  scales: readonly ProfileScale[],
  options: { byCountOnly?: boolean } = {},
): ProfileMatrixRow[] {
  const order = scales.map((s) => s.key);
  if (options.byCountOnly) {
    return Array.from({ length: keys.length }, (_, i) => ({
      code: `count:${i + 1}`,
      label: sizeName(i + 1),
    }));
  }
  return subsetCodes(keys, order).map((code) => ({
    code,
    label: profileSetLabel(code.split("+"), scales),
  }));
}
