/**
 * @module shared/breakdown/feedback
 * @description PRD-50 FR-55: какие тексты подтем получает обучающийся.
 *
 * Правило одно: текст выдаётся, когда подтема НЕ ВЗЯТА по порогу своей темы — при любом
 * вердикте теста и темы. «При любом вердикте» — часть правила, а не упрощение: провал по
 * подтеме внутри сданного теста и есть тот случай, ради которого текст пишут. Обратная связь
 * ТЕМЫ так себя не ведёт (её гасит пройденная тема), и это сознательное расхождение.
 *
 * Считать здесь нечего: исход подтемы штампует `shared/breakdown/gate` при подведении итога,
 * и модуль только читает готовое поле. Так экран, отчёт и пакет не могут разойтись в том,
 * что человек прочитал, а тексты старой попытки не переезжают при смене настроек теста.
 */

import type { BreakdownEntry } from "./types";

/** Раздел глазами отбора: его подытоги и тексты его подтем. */
export interface BreakdownFeedbackTopic<T> {
  breakdown?: BreakdownEntry[] | null;
  /** Ключ подтемы -> её текст (`test_sections.breakdown_feedback_json`). */
  breakdownFeedback?: Record<string, T> | null;
}

/**
 * Тексты подтем, которые обучающийся должен прочитать, в порядке разделов и подытогов.
 *
 * `passed === false` и ничто иное: `null` значит «порога не было» (тема не судит либо попытка
 * завершена до §16), и выдавать по нему текст было бы суждением, которого никто не выносил.
 * Подтема, которой выдача не дала ни одного вопроса, в подытогах не появляется — значит, и
 * текста не даёт: рекомендация по неспрошенному ни на чём не основана.
 */
export function collectBreakdownFeedback<T>(
  topics: ReadonlyArray<BreakdownFeedbackTopic<T>>,
): T[] {
  const out: T[] = [];
  for (const topic of topics) {
    const texts = topic.breakdownFeedback;
    if (!texts) continue;
    for (const entry of topic.breakdown ?? []) {
      if (entry.passed !== false) continue;
      const block = texts[entry.key];
      if (block) out.push(block);
    }
  }
  return out;
}
