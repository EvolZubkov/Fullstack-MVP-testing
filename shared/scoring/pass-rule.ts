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

/**
 * How the overall threshold and the per-topic gates combine into the test verdict
 * (`tests.pass_decision_policy`). Semantics per
 * `docs/architecture/test-settings-parameter-structure.md` §3.4 and PRD-4 §5.2:
 *
 * - `overall_only`               — only the overall rule decides; topic results are informational.
 * - `overall_and_required_topics`— overall rule AND every REQUIRED topic's gate.
 * - `required_topics_only`       — every REQUIRED topic's gate; the overall result is informational.
 * - `all_topics_passed`          — every gated topic, required or not; overall informational.
 */
export type PassDecisionPolicy =
  | "overall_only"
  | "overall_and_required_topics"
  | "required_topics_only"
  | "all_topics_passed";

/**
 * Normalise a stored policy value. Returns `null` for anything unrecognised —
 * including a missing field, which is what a legacy attempt, a legacy publication
 * snapshot or a SCORM package built before the policy shipped carries. `null` is
 * NOT a synonym for a default policy: {@link aggregateStandardResult} keeps the
 * pre-policy verdict (overall rule AND every gated topic) for it, so grading such
 * data never changes retroactively.
 */
export function resolvePassDecisionPolicy(raw: unknown): PassDecisionPolicy | null {
  return raw === "overall_only" ||
    raw === "overall_and_required_topics" ||
    raw === "required_topics_only" ||
    raw === "all_topics_passed"
    ? raw
    : null;
}

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
