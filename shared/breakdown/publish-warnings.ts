/**
 * @module shared/breakdown/publish-warnings
 * @description PRD-50 FR-45 - FR-47: the delivery traps an author is told about when a
 * test is published. WARNINGS, never blocks — publication proceeds and the snapshot is
 * frozen; the author decides what to do. Pure: the caller gathers the data, this only
 * judges it, so the same rules can later feed the editor without a second implementation.
 *
 * The traps come straight from the reference workbook: two questions of «Технологии» belong
 * to no variant and can never be delivered, and nothing in the service ever said so.
 *
 * FR-46 («порог назначен ключу, которого выдача не даст») is GONE: individual key
 * thresholds were dropped in §16, so an unreachable threshold has nothing to make
 * unreachable. In its place stands FR-56 — the gate is on while the subtotals are hidden.
 */
import { tagKey } from "../tags";

export type BreakdownWarningCode =
  /** FR-45: Σ quotas ≠ the section's sample size — the keys do not partition it. */
  | "quota_sum_mismatch"
  /** FR-45: deliverable questions carry no key at all. */
  | "questions_without_key"
  /** FR-47: a question belongs to no variant and will never be delivered. */
  | "question_outside_variants"
  /** FR-47: quotas AND variants are both set; in variants mode quotas are not applied. */
  | "quotas_ignored_in_variants"
  /**
   * FR-56: подтемы учитываются в вердикте темы, а подытоги по подтемам скрыты — участник
   * получит «Не пройдена» без единой видимой причины. Правило уровня ТЕСТА, поэтому темы
   * у предупреждения нет.
   */
  | "gate_without_display";

export interface BreakdownWarning {
  code: BreakdownWarningCode;
  /** Тема, о которой речь. `null` у правил уровня теста (`gate_without_display`). */
  topicId: string | null;
  topicName: string | null;
  /** The key the warning speaks about (`threshold_key_never_delivered`). */
  key?: string;
  /** The number the message quotes: Σ quotas, or how many questions are affected. */
  count?: number;
  /** What `count` is compared against (the section's sample size). */
  total?: number;
  /** Готовый текст — только у правил, которым его негде взять на стороне читателя. */
  message?: string;
}

/** One section as the check sees it: delivery config and the topic's pool. */
export interface BreakdownPublishSection {
  topicId: string;
  topicName: string;
  drawCount: number;
  drawAll: boolean;
  blueprint: { strata: Array<{ tag: string; count: number }> } | null;
  /** PRD-17 variants, or null when the section is not in variants mode. */
  variants: Array<{ id: string; label: string; questionIds: string[] }> | null;
  questions: Array<{ id: string; tags: string[] }>;
}

/**
 * The whole test as the check sees it: its sections plus the two test-level settings FR-56
 * judges. Both flags absent = выключено, что и есть поведение любого теста до §16.
 */
export interface BreakdownPublishInput {
  sections: readonly BreakdownPublishSection[];
  /** `tests.breakdown_gate_enabled` (FR-53). */
  breakdownGateEnabled?: boolean;
  /** Видны ли подытоги по подтемам: `breakdown_display_json.visibility !== "hidden"`. */
  breakdownVisible?: boolean;
}

/** Distinct normalised keys of one question. */
function keysOf(q: { tags: string[] }): Set<string> {
  const out = new Set<string>();
  for (const t of q.tags ?? []) {
    const k = tagKey(t);
    if (k) out.add(k);
  }
  return out;
}

export function checkBreakdownPublish(input: BreakdownPublishInput): BreakdownWarning[] {
  const out: BreakdownWarning[] = [];

  // FR-56: переключатель включён, а подытоги скрыты — участник получит «Не пройдена» без
  // единой видимой причины. Публикацию не блокирует: это предупреждение, как и остальные три.
  if (input.breakdownGateEnabled && !input.breakdownVisible) {
    out.push({
      code: "gate_without_display",
      topicId: null,
      topicName: null,
      message:
        "Подтемы учитываются в вердикте темы, но подытоги по подтемам скрыты — участник не увидит причину.",
    });
  }

  for (const s of input.sections) {
    const at = (w: Omit<BreakdownWarning, "topicId" | "topicName">) =>
      out.push({ topicId: s.topicId, topicName: s.topicName, ...w });
    const variants = s.variants && s.variants.length > 0 ? s.variants : null;

    // FR-47: quotas are silently inert in variants mode (PRD-17 FR-03). Saying so is the
    // whole point — the author configured two things and only one of them runs.
    if (variants && s.blueprint && !s.drawAll) at({ code: "quotas_ignored_in_variants" });

    // FR-47: a question outside every variant will never be delivered — the exact case the
    // reference workbook hides two questions in.
    if (variants) {
      const used = new Set(variants.flatMap((f) => f.questionIds));
      const orphans = s.questions.filter((q) => !used.has(q.id)).length;
      if (orphans > 0) at({ code: "question_outside_variants", count: orphans });
    }

    // The delivery pool the remaining checks judge: in variants mode only what a variant can
    // hand out, otherwise the topic's whole bank.
    const deliverable = variants
      ? s.questions.filter((q) => variants.some((f) => f.questionIds.includes(q.id)))
      : s.questions;
    // Ключи «в игре», когда их объявили квотами ЛИБО когда тест их показывает или судит:
    // индивидуальных порогов раздела с §16 нет, и признаком служат настройки теста.
    const declaresKeys =
      s.blueprint != null || input.breakdownVisible === true || input.breakdownGateEnabled === true;

    // FR-45, first half: quotas that do not add up to the sample are not a partition of it.
    if (!variants && !s.drawAll && s.blueprint) {
      const sum = s.blueprint.strata.reduce((acc, st) => acc + (st.count || 0), 0);
      if (sum !== s.drawCount) at({ code: "quota_sum_mismatch", count: sum, total: s.drawCount });
    }

    // FR-45, second half: a deliverable question with no key falls outside every bar, and the
    // bars therefore do not add up to the section. Only worth saying when keys are in play.
    if (declaresKeys) {
      const withoutKey = deliverable.filter((q) => keysOf(q).size === 0).length;
      if (withoutKey > 0) at({ code: "questions_without_key", count: withoutKey });
    }
  }
  return out;
}
