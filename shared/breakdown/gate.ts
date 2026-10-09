/**
 * @module shared/breakdown/gate
 * @description PRD-50 §16 (FR-52 - FR-54): порог подтемы и её исход.
 *
 * Своего числа у подтемы нет и не будет: порог ПРОИЗВОДНЫЙ — разрешённое правило её темы,
 * а у сводных записей области теста — общее правило теста. Индивидуальные пороги ключей
 * отменены владельцем 2026-09-04: подтема несёт два-четыре вопроса, и собственный порог на
 * такой выборке означает «ошибся один — провал». Автору, которому нужен другой порог, ответ
 * один — завести отдельную тему.
 *
 * Модуль чистый: ни DOM, ни Node, ни типов хоста. Он едет в бандл `shared-runtime`, поэтому
 * экран итогов, отчёт и SCORM-пакет судят подтему ОДНИМ кодом.
 */
import type { BreakdownEntry } from "./types";
import type { ResolvedRule } from "../scoring/pass-rule";

/**
 * Порог области в процентах, или `null`, когда порога нет.
 *
 * Правило, заданное СУММОЙ БАЛЛОВ, переводится в долю от достижимого в этой области: подтема
 * несёт свою, малую сумму баллов, и сравнивать её с абсолютом темы бессмысленно. Без перевода
 * тест с порогом в баллах молча остался бы без окраски и без текстов подтем — настройка,
 * которая ничего не делает, хуже приблизительного перевода (то же решение, что в FR-50).
 *
 * @param rule Разрешённое правило области (`resolveTopicRule` / `resolveOverallRule`).
 * @param possiblePoints Достижимые баллы области — темы для её подтем, теста для сводных.
 */
export function thresholdPercentOf(
  rule: ResolvedRule | null,
  possiblePoints: number,
): number | null {
  if (!rule) return null;
  if (rule.type === "percent") return rule.value;
  const possible = Number(possiblePoints);
  if (!Number.isFinite(possible) || possible <= 0) return null;
  return (rule.value / possible) * 100;
}

/**
 * Проставить исход каждой записи и сказать, провалена ли хоть одна.
 *
 * Сравнивается доля БАЛЛОВ (`percentPoints`) независимо от выбранной базы показа (FR-21):
 * база решает, какое число НАПЕЧАТАТЬ, а не по какому судить. Записи правятся на месте —
 * они принадлежат результату попытки, который вызывающий как раз собирает.
 *
 * Возвращаемый признак — единственное, что нужно вердикту темы (FR-53); сам вердикт этот
 * модуль не выносит: политика теста живёт в `aggregate`.
 */
export function applyBreakdownGate(
  entries: BreakdownEntry[],
  thresholdPercent: number | null,
): boolean {
  const threshold =
    typeof thresholdPercent === "number" && Number.isFinite(thresholdPercent)
      ? thresholdPercent
      : null;
  let anyFailed = false;
  for (const entry of entries) {
    if (threshold === null) {
      entry.passed = null;
      entry.thresholdPercent = null;
      continue;
    }
    const passed = entry.percentPoints >= threshold;
    entry.passed = passed;
    entry.thresholdPercent = threshold;
    if (!passed) anyFailed = true;
  }
  return anyFailed;
}
