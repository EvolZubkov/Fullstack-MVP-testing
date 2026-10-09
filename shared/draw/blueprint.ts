/**
 * @module shared/draw/blueprint
 *
 * Pure stratified-draw core (PRD-11, Stage 2; scoring-model §2.4). Given a
 * topic's available questions, the target `drawCount` and an optional draw
 * blueprint, it selects the questions to present, guaranteeing per-tag (sub-topic)
 * coverage. It is the authoritative implementation; a plain-JS twin
 * (server/scorm/assets/app.js `drawSection`) runs in the SCORM package and is
 * kept in parity by a golden test (tests/draw-blueprint-port.test.ts). The
 * server-side attempt builder (server/routes/attempts.ts) calls this directly.
 *
 * Algorithm (PRD-11 §5; FR-02/03/03a/03b/04/06):
 * - no blueprint -> uniform draw `shuffle(all).slice(0, drawCount)` (FR-02).
 * - blueprint -> per stratum take `count` tagged questions (shared `used` set, so
 *   a question with several quota-tags counts once, FR-04); a shortfall is a
 *   non-blocking warning (FR-06). The remainder up to `drawCount` is drawn from
 *   questions WITHOUT any `exact`-mode tag (so `exact` strata stay exactly
 *   `count`, while `min` strata and untagged questions can fill it, FR-03a).
 *
 * The SELECTION itself is injected as `pick` (PRD-55 FR-24): the web host passes a
 * pick weighted by accumulated exposure, the package passes one weighted by the
 * baked weight, feasibility passes a plain head-of-pool, and tests pass a
 * deterministic one. A uniform draw is just the case where every weight is equal,
 * so there is no second copy of the draw algorithm and no "correction off" branch.
 */

import type { DrawBlueprint, DrawStratum } from "../schema";
import { tagKey } from "../tags";

/** A question the draw can see — only id and tags matter for selection. */
export interface DrawableQuestion {
  id: string;
  tags?: string[];
}

/** A non-blocking shortfall: fewer tagged questions than the quota (FR-06). */
export interface DrawWarning {
  tag: string;
  requested: number;
  available: number;
}

export interface DrawResult<Q> {
  selected: Q[];
  warnings: DrawWarning[];
}

/**
 * Отбор `k` заданий из пула.
 *
 * PRD-55 (FR-24): заменил прежний `ShuffleFn`. Равномерный отбор выражается через него как
 * `shuffle(pool).slice(0, k)`, а взвешенный по экспозиции — через `weightedPick`
 * (`shared/draw/exposure`), поэтому второй реализации алгоритма выдачи в проекте не заводится и
 * «поправка выключена» не становится отдельной веткой кода.
 */
export type PickFn = <T extends DrawableQuestion>(pool: T[], k: number) => T[];

/**
 * Перемешивание списка целиком.
 *
 * Осталось отдельным типом после PRD-55: отбор («какие задания выдать») и перемешивание («в каком
 * порядке их показать») — разные операции, и путать их нельзя. Им пользуются порядок выдачи
 * (`order-questions`), выбор варианта (`forms`) и сборка потока (`assemble-delivery`), где
 * взвешивать по экспозиции нечего — состав там уже определён.
 */
export type ShuffleFn = <T>(arr: T[]) => T[];

/** Effective mode of a stratum — per-tag, defaulting to "exact" (FR-03b). */
function effectiveMode(stratum: DrawStratum): "exact" | "min" {
  return stratum.mode ?? "exact";
}

/**
 * Select questions for one topic. `questions` is already filtered by the caller's
 * cross-section dedup; this adds the within-section stratified selection.
 */
export function drawSection<Q extends DrawableQuestion>(
  questions: Q[],
  drawCount: number,
  blueprint: DrawBlueprint | null | undefined,
  pick: PickFn,
): DrawResult<Q> {
  if (!blueprint || !blueprint.strata || blueprint.strata.length === 0) {
    return { selected: pick(questions.slice(), drawCount), warnings: [] };
  }

  const selected: Q[] = [];
  const used: Record<string, boolean> = {};
  const warnings: DrawWarning[] = [];
  // Match case-insensitively on the normalized tag key (PRD-11 §3a): precompute
  // each question's key set so "Финансы" on a question matches "финансы" in a quota.
  const keysOf = (q: Q): string[] => (Array.isArray(q.tags) ? q.tags.map(tagKey) : []);
  const qKeys = new Map<string, string[]>();
  for (const q of questions) qKeys.set(q.id, keysOf(q));
  const hasTag = (q: Q, key: string) => (qKeys.get(q.id) ?? []).indexOf(key) !== -1;
  const exactKeys = new Set(
    blueprint.strata.filter((s) => effectiveMode(s) === "exact").map((s) => tagKey(s.tag)),
  );

  // Step 1: take `count` questions per stratum, in order, sharing `used` (FR-04).
  for (const stratum of blueprint.strata) {
    const stratumKey = tagKey(stratum.tag);
    const pool = questions.filter((q) => !used[q.id] && hasTag(q, stratumKey));
    const take = pick(pool.slice(), stratum.count);
    if (take.length < stratum.count) {
      warnings.push({ tag: stratum.tag, requested: stratum.count, available: take.length });
    }
    for (const q of take) {
      used[q.id] = true;
      selected.push(q);
    }
  }

  // Step 2: fill the remainder up to drawCount from questions WITHOUT any exact
  // tag (untagged and `min`-tagged questions participate; `exact` stays exactly
  // `count`, FR-03a). `selected.length <= Σcount <= drawCount` by FR-05.
  const remainder = drawCount - selected.length;
  if (remainder > 0) {
    const free = questions.filter(
      (q) => !used[q.id] && !(qKeys.get(q.id) ?? []).some((k) => exactKeys.has(k)),
    );
    for (const q of pick(free.slice(), remainder)) {
      used[q.id] = true;
      selected.push(q);
    }
  }

  return { selected: selected.slice(0, drawCount), warnings };
}
