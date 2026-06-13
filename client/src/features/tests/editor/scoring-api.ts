/**
 * @module features/tests/editor/scoring-api
 * @description Client helpers of the «Оценка» tab (PRD-15 block D, FR-30/FR-35):
 * the per-(test, question) scoring overrides. Like the test/section defaults,
 * overrides are now part of the editor DRAFT — the modal «Применить» and the row
 * «Сбросить» mutate `model.scoring.questionOverrides`, and nothing is persisted
 * until the single drawer «Сохранить». «Закрыть» discards. This module provides
 * the save orchestrator (`saveQuestionOverrides`) that diffs the edited overrides
 * against the last saved snapshot and applies the minimal set of PUT/DELETE calls
 * (mirroring `saveResultVariables` / `saveScales`), plus a normalizer used by both
 * the load mapper and the editor so override objects compare stably. Each write
 * bumps the test version server-side, so a published test flips to «Опубликован,
 * есть изменения» (FR-12) on save.
 */

import type { QuestionScoring } from "@shared/schema";

/** One override row as returned by GET /api/tests/:id/question-scoring. */
export type QuestionScoringOverride = {
  id: string;
  testId: string;
  questionId: string;
  points: number | null;
  scoringJson: QuestionScoring | null;
  difficulty: number | null;
  pinnedContentHash: string | null;
};

/** Values sent on save; each is an independent link of the effective chain. */
export type QuestionScoringPatch = {
  points: number | null;
  scoringJson: QuestionScoring | null;
  difficulty: number | null;
};

/**
 * Build a draft override with a stable key order, so `JSON.stringify`-based
 * dirty detection (`shallowEqualJson` over `model.scoring`) does not report a
 * spurious change. Used by both the load mapper and the editor's apply path.
 * `id` is irrelevant to persistence (the endpoint upserts by questionId) — it is
 * carried only so an unchanged re-edit of a loaded override stays clean.
 */
export function makeQuestionOverride(input: {
  id?: string;
  testId: string;
  questionId: string;
  points: number | null;
  scoringJson: QuestionScoring | null;
  difficulty: number | null;
  pinnedContentHash: string | null;
}): QuestionScoringOverride {
  return {
    id: input.id ?? "",
    testId: input.testId,
    questionId: input.questionId,
    points: input.points,
    scoringJson: input.scoringJson,
    difficulty: input.difficulty,
    pinnedContentHash: input.pinnedContentHash,
  };
}

/** True when two overrides match for every field the server persists/pins. */
function sameOverride(a: QuestionScoringOverride, b: QuestionScoringOverride): boolean {
  return (
    a.points === b.points &&
    a.difficulty === b.difficulty &&
    a.pinnedContentHash === b.pinnedContentHash &&
    JSON.stringify(a.scoringJson) === JSON.stringify(b.scoringJson)
  );
}

async function mutate(method: string, url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string; message?: string }).message ?? "";
    } catch {
      /* non-JSON body */
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? undefined : res.json();
}

/**
 * Persist the edited override list against its last saved snapshot. Deletes run
 * first (questions overridden in the snapshot but reset in the draft), then new
 * and changed overrides are upserted. The PUT endpoint pins the question's
 * CURRENT contentHash (FR-30), so a stale override whose `pinnedContentHash` was
 * refreshed in the draft on «Применить» re-pins here — that is the
 * «Подтвердить актуальность» action. `pinnedContentHash` is part of
 * {@link sameOverride}, so such a re-pin is detected as a change.
 */
export async function saveQuestionOverrides(
  testId: string,
  draft: QuestionScoringOverride[],
  snapshot: QuestionScoringOverride[],
): Promise<void> {
  const base = `/api/tests/${testId}/question-scoring`;
  const draftByQuestion = new Set(draft.map((o) => o.questionId));

  for (const s of snapshot) {
    if (!draftByQuestion.has(s.questionId)) {
      await mutate("DELETE", `${base}/${s.questionId}`);
    }
  }

  const snapByQuestion = new Map(snapshot.map((s) => [s.questionId, s] as const));
  for (const o of draft) {
    const prev = snapByQuestion.get(o.questionId);
    if (!prev || !sameOverride(prev, o)) {
      await mutate("PUT", `${base}/${o.questionId}`, {
        points: o.points,
        scoringJson: o.scoringJson,
        difficulty: o.difficulty,
      });
    }
  }
}
