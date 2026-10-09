/**
 * @module features/tests/editor/profile-diagnostics
 * @description Находки формы «Профиль по группе шкал» (PRD-53 §5.3.2) — одним чистым
 * расчётом на всех потребителей.
 *
 * Потребителей два, и это причина, по которой модуль существует отдельно. Общая
 * валидация редактора (`validateTestEditor`) кладёт находки в контур индикации: оттуда
 * берутся точка на вкладке, сводный баннер и переход по якорю
 * (`docs/architecture/test-editor-contracts.md`, «Индикация проблем»). Секция показателей
 * печатает их же у самой карточки. Считать это дважды нельзя: два источника правды
 * разойдутся молча, и автор увидит предупреждение в одном месте и не увидит в другом.
 *
 * Почему не в `shared/formula/validate`: тамошний валидатор видит ТОЛЬКО строку формулы,
 * а эти находки — про сочетание формулы с перечнем исходов показателя и с описаниями и
 * нормализацией шкал теста. Такие данные в формулу не входят.
 */

import { readScaleGroup } from "@shared/formula/outcome-literals";
import { parseGroupThreshold } from "@shared/formula/scale-group";
import { outcomeMatchKey } from "@shared/scales/interpretation";
import { pluralize } from "@/lib/i18n";
import { profileMatrix } from "./profile-matrix";
import type { ResultVariableModel } from "./test-editor.types";

/**
 * Что расчёту нужно от шкалы. Не `ScaleModel`: потребителей два, и у секции показателей
 * шкалы приходят своим урезанным видом (`ScaleRef`). Минимальная форма позволяет обоим
 * передать своё, ничего не конвертируя.
 */
export type ProfileScaleFacts = {
  key: string;
  label: string;
  description: string;
  normalization: string;
};

/** Одна находка: уровень, устойчивый код и текст для автора. */
export type ProfileFinding = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

/**
 * Текст про негодный порог. Вынесен, потому что проверяют его ДВА места: здесь — по
 * формуле, и форма шаблона — по тому, что автор набрал. Второе необходимо: отрицательный
 * порог делает формулу неразбираемой (`topGroup([...], -1)` парсер не принимает вовсе),
 * и до находки по модели дело просто не доходит.
 */
export const PROFILE_THRESHOLD_MESSAGE =
  "Порог верхней зоны — неотрицательное число или доля вида «10%».";

/** Сколько непокрытых кодов перечислять поимённо, прежде чем сказать «и ещё N». */
const CODES_SHOWN = 5;

/**
 * Находки одного показателя-профиля. Показатель, чья формула профиля не объявляет,
 * не даёт находок вовсе — возвращается пустой список, а не «всё хорошо».
 *
 * @public
 */
export function profileFindings(
  variable: ResultVariableModel,
  scales: readonly ProfileScaleFacts[],
): ProfileFinding[] {
  const group = readScaleGroup(variable.formula);
  if (!group) return [];

  const out: ProfileFinding[] = [];
  const byKey = new Map(scales.map((s) => [s.key, s]));

  if (group.keys.length < 2) {
    out.push({
      severity: "error",
      code: "profile_group_small",
      message: "В группе профиля нужны хотя бы две шкалы.",
    });
  }

  const threshold = parseGroupThreshold(group.threshold);
  if (threshold === null) {
    out.push({
      severity: "error",
      code: "profile_threshold",
      message: PROFILE_THRESHOLD_MESSAGE,
    });
  }

  // Шкала, удалённую из теста, автор обязан увидеть и снять; форма показывает её
  // отключённой строкой, а здесь называется причина (FR-33).
  for (const key of group.keys) {
    if (!byKey.has(key)) {
      out.push({
        severity: "error",
        code: "profile_unknown_scale",
        message: `Шкала «${key}» удалена из теста — снимите её из группы профиля.`,
      });
    }
  }

  // Наборы без текста. Подавляется на пустом перечне исходов: автор ещё не начал
  // заполнять, и упрекать его пока не в чем.
  const declared = variable.outcomes.map((o) => o.code.trim()).filter((c) => c !== "");
  if (group.keys.length >= 2 && declared.length > 0) {
    const known = new Set(declared.map(outcomeMatchKey));
    const uncovered = profileMatrix(group.keys, scales)
      .map((row) => row.code)
      .filter(
        (code) => !known.has(outcomeMatchKey(code)) && !known.has(`count:${code.split("+").length}`),
      );
    if (uncovered.length > 0) {
      const shown = uncovered.slice(0, CODES_SHOWN).join(", ");
      const rest = uncovered.length > CODES_SHOWN ? ` и ещё ${uncovered.length - CODES_SHOWN}` : "";
      out.push({
        severity: "warning",
        code: "profile_uncovered",
        message: `Не для всех наборов есть текст: ${shown}${rest}. Участник с таким результатом увидит карточку без толкования.`,
      });
    }
  }

  // Блок «вне профиля» собирает текст из описаний шкал: пустое описание печатается
  // голым названием.
  if (variable.restScales?.show) {
    const bare = variable.restScales.keys
      .map((key) => byKey.get(key))
      .filter((s): s is ProfileScaleFacts => !!s && s.description.trim() === "")
      .map((s) => s.label || s.key);
    if (bare.length > 0) {
      out.push({
        severity: "warning",
        code: "profile_bare_rest",
        message: `Блок «вне профиля» напечатает голые названия: у шкал ${bare.join(", ")} пустое описание.`,
      });
    }
  }

  // Абсолютный порог на группе с разной нормализацией сравнивает несопоставимые
  // величины. Долевой порог от этого свободен, поэтому условие сужено.
  // Условие видит и валидатор формулы (§5.3.1, код `scale-group-normalization`), но находка
  // нужна ИМЕННО ЗДЕСЬ: отсюда она попадает в общий контур индикации — точку на вкладке,
  // сводный баннер и переход по якорю, — куда ответ валидатора не идёт. Чтобы у автора не
  // стояло два одинаковых баннера подряд (приёмка 2026-09-07 нашла их различающимися одной
  // точкой), гасится КОПИЯ ВАЛИДАТОРА в карточке — см. `CARD_DUPLICATED_CODES`.
  if (threshold?.kind === "abs") {
    const modes = new Set(
      group.keys.map((key) => byKey.get(key)?.normalization).filter((m) => m !== undefined),
    );
    if (modes.size > 1) {
      out.push({
        severity: "warning",
        code: "profile_mixed_normalization",
        message:
          "Шкалы группы нормализованы по-разному: порог в баллах сравнивает несопоставимые" +
          " величины. Задайте порог долей от максимума.",
      });
    }
  }

  return out;
}

/**
 * Подсказка о числе наборов. Не находка: это арифметика, о которой автор не думал, а не
 * признак ошибки, и в контур индикации она не попадает — там всего два уровня.
 *
 * @public
 */
export function profileSetCountHint(variable: ResultVariableModel): string | null {
  const group = readScaleGroup(variable.formula);
  if (!group || group.keys.length < 5) return null;
  const total = 2 ** group.keys.length - 1;
  // Число подставляется, поэтому и слово при нём склоняется: «31 набор», а не «31 наборов»
  // (приёмка 2026-09-07). Тексты считаются отдельно: их столько же, сколько шкал.
  const наборов = pluralize(total, "набор", "набора", "наборов");
  const текстов = pluralize(group.keys.length, "текст", "текста", "текстов");
  return (
    `${group.keys.length} шкал дают ${total} ${наборов} — столько текстов пишут редко.` +
    ` Можно обойтись заготовками по размеру набора: ${group.keys.length} ${текстов} вместо ${total}.`
  );
}
