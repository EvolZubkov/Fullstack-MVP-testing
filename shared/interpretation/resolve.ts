/**
 * @module shared/interpretation/resolve
 * @description Разрешение ТОЛКОВАНИЯ темы и подтемы — текста, который объясняет результат.
 *
 * Толкование и обратная связь — разные вещи, и это различие держится именно здесь:
 *
 *  - толкование ПЕЧАТАЕТСЯ ВСЕГДА, при любом вердикте и при его отсутствии; рекомендация
 *    выдаётся по своему правилу (тема не взята; доля подтемы ниже общего порога теста);
 *  - толкование стоит ПРИ СВОЕЙ теме или полосе; рекомендация уходит в сводный блок
 *    «Рекомендации» вместе с курсами, материалами и мероприятиями;
 *  - у толкования нет вложений: оно ничего не советует.
 *
 * Модуль чистый — ни DOM, ни Node, ни схемы БД: он едет в бандл `shared-runtime`, поэтому
 * экран итогов, отчёт и SCORM-пакет разрешают толкование ОДНИМ кодом, а редактор показывает
 * автору ровно тот текст, который получит участник.
 */

/** Текст толкования в том виде, в каком его хранят тема и раздел. */
export interface InterpretationText {
  format?: "plain" | "richText" | "html";
  text?: string | null;
}

/** Откуда пришёл разрешённый текст — это видит автор в карточке редактора. */
export type InterpretationSource = "topic" | "test";

/** Разрешённое толкование: текст, его формат и источник. */
export interface ResolvedInterpretation {
  format: "plain" | "richText" | "html";
  text: string;
  source: InterpretationSource;
}

/** Есть ли в записи непустой текст. Пустой текст = толкования нет (гейт стоит на ТЕКСТЕ). */
function hasText(value: InterpretationText | null | undefined): boolean {
  return typeof value?.text === "string" && value.text.trim().length > 0;
}

function normalize(value: InterpretationText, source: InterpretationSource): ResolvedInterpretation {
  return { format: value.format ?? "plain", text: String(value.text ?? ""), source };
}

/**
 * Толкование темы: текст ТЕСТА заменяет текст темы ЦЕЛИКОМ.
 *
 * Замена, а не сложение — то же правило, что у обратной связи темы (PRD-29 §7.1a): две
 * редакции одного текста, склеенные в выдаче, автор нигде не видит и не может проверить,
 * а участник читает противоречие.
 *
 * `null` означает «толкования нет»: строка темы печатается так, как печаталась до этой
 * работы, и ни один тест, ничего не заполнивший, вида не меняет.
 *
 * @param topic Толкование самой темы (`topics.interpretation_json`).
 * @param section Толкование, заданное этим тестом (`test_sections.interpretation_json`).
 */
export function resolveTopicInterpretation(
  topic: InterpretationText | null | undefined,
  section: InterpretationText | null | undefined,
): ResolvedInterpretation | null {
  if (hasText(section)) return normalize(section as InterpretationText, "test");
  if (hasText(topic)) return normalize(topic as InterpretationText, "topic");
  return null;
}

/**
 * Толкование ОДНОЙ подтемы внутри раздела.
 *
 * Слоя «своё/общее» здесь нет и быть не может: сущности «тег» в базе не существует, тексты
 * подтем принадлежат разделу, то есть тесту. Источник у разрешённого значения всё равно
 * называется — чтобы карточка редактора и выдача пользовались одной формой.
 *
 * @param texts Карта «ключ подтемы -> текст» (`test_sections.breakdown_interpretation_json.keys`).
 * @param key Ключ подтемы КАК ЕГО НАПИСАЛ АВТОР; сопоставление ключей — забота вызывающего
 *   (`tagKey`), как и у обратной связи подтем.
 */
export function resolveBreakdownInterpretation(
  texts: Readonly<Record<string, InterpretationText>> | null | undefined,
  key: string,
): ResolvedInterpretation | null {
  const value = texts?.[key];
  return hasText(value) ? normalize(value as InterpretationText, "test") : null;
}
