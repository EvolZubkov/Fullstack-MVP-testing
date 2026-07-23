/**
 * @module shared/scoring/pass-rule
 * @description Single source of pass-rule resolution + evaluation for BOTH hosts
 * (the web grader and the SCORM package runtime), PRD-18 unification. Topic rules
 * are authored as the editor `{source}` union; the overall rule as `{type,value}`.
 * This normalises EVERY shape to one runtime rule `{type:'percent'|'count', value}`
 * (or `null` = no gate) and applies the PRD-10 FR-10 basis: a `percent` rule
 * compares the points-based percent, a `count` rule compares Σ EARNED POINTS (NOT
 * the fully-correct question count).
 *
 * Replaces the two divergent inline implementations — `checkPassRuleWithPartial`
 * (resultsPage.js, Σ-points basis, no source handling) and the inline cast in
 * attempts.ts (correct-COUNT basis, no source handling) — both of which mis-graded
 * `inherit_overall` / `none` (treated as an unsatisfiable `value:undefined` count
 * rule, so the topic always failed) and disagreed on the count basis.
 */

/** A resolved, runtime-ready pass rule. `null` means "no gate" (topic informational). */
export type ResolvedRule = { type: "percent" | "count"; value: number };

/** Resolve the OVERALL pass rule (stored `{type:'percent'|'absolute'|'none', value}`). */
export function resolveOverallRule(raw: unknown): ResolvedRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { type?: string; value?: number };
  if (r.type === "none") return null;
  if (r.type === "percent") return { type: "percent", value: Number(r.value) || 0 };
  if (typeof r.value === "number") return { type: "count", value: r.value }; // 'absolute' / 'count'
  return null;
}

/**
 * Delivery context for topic-rule resolution (PRD-24). Carries what the learner
 * was actually given, so a rule can depend on it. Absent/empty = unknown delivery.
 */
export interface TopicRuleContext {
  /** Stable PRD-17 `formId` of the variant delivered for this topic in this attempt. */
  formId?: string | null;
}

/**
 * Resolve a TOPIC pass rule against the ALREADY-resolved overall rule.
 * - `{source:'inherit_overall'}` («Как у теста») → the overall rule (or `null` when
 *   the overall rule is «none»).
 * - `{source:'none'}` («Не проверять отдельно») → `null` (no gate, `passed` stays
 *   informational/null).
 * - `{source:'custom', type, value}` → `{type: percent|count, value}`.
 * - `{source:'by_variant', byForm}` (PRD-24) → the threshold of the DELIVERED variant
 *   (`ctx.formId`); when the variant is unknown or absent from the map, degrades to
 *   the overall rule (FR-09) — the topic stays gated rather than silently ungated.
 * - legacy `{type, value}` (pre-`source` data) → itself (`none` → `null`).
 * - `null`/`undefined`/non-object → `null` (no gate).
 */
export function resolveTopicRule(
  raw: unknown,
  overall: ResolvedRule | null,
  ctx?: TopicRuleContext,
): ResolvedRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    source?: string;
    type?: string;
    value?: number;
    byForm?: Record<string, { type?: string; value?: number }>;
  };
  if (r.source === "inherit_overall") return overall;
  if (r.source === "none") return null;
  if (r.source === "by_variant") {
    const entry = ctx?.formId ? r.byForm?.[ctx.formId] : undefined;
    if (!entry) return overall;
    return entry.type === "percent"
      ? { type: "percent", value: Number(entry.value) || 0 }
      : { type: "count", value: Number(entry.value) || 0 };
  }
  if (r.source === "custom") {
    return r.type === "percent"
      ? { type: "percent", value: Number(r.value) || 0 }
      : { type: "count", value: Number(r.value) || 0 };
  }
  // legacy direct `{type, value}` rule stored on the section
  if (r.type === "none") return null;
  if (r.type === "percent") return { type: "percent", value: Number(r.value) || 0 };
  if (typeof r.value === "number") return { type: "count", value: r.value };
  return null;
}

/**
 * Evaluate a resolved rule. A `null` rule passes (no gate). `percent` → the
 * points-based percent ≥ value; `count` → Σ earned points ≥ value (PRD-10 FR-10).
 */
export function checkPassRule(rule: ResolvedRule | null, percent: number, earnedScore: number): boolean {
  if (!rule) return true;
  if (rule.type === "percent") return percent >= rule.value;
  return earnedScore >= rule.value;
}
