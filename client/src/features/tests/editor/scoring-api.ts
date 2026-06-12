/**
 * @module features/tests/editor/scoring-api
 * @description Client helpers of the «Оценка» tab (PRD-15 block D, FR-30/FR-35):
 * the per-(test, question) scoring overrides. Unlike the draft-managed defaults
 * (saved with the single drawer «Сохранить»), overrides persist IMMEDIATELY
 * through dedicated endpoints — applying the modal writes the row, «Сбросить»
 * deletes it. Every write bumps the test version server-side, so a published
 * test flips to «Опубликован, есть изменения» (FR-12).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** The test's override rows; disabled until the test exists (create mode). */
export function useQuestionScoring(testId: string | undefined) {
  return useQuery<QuestionScoringOverride[]>({
    queryKey: [`/api/tests/${testId}/question-scoring`],
    enabled: !!testId,
  });
}

/** Invalidate the override rows and the test caches affected by the version bump. */
function useInvalidateScoring(testId: string | undefined) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/question-scoring`] }),
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] }),
    ]);
  };
}

/**
 * Upsert one question's override. The server pins the question's CURRENT
 * contentHash (FR-30), so re-sending unchanged values is exactly the
 * «Подтвердить актуальность» action for a stale override.
 */
export function useSaveQuestionScoring(testId: string | undefined) {
  const invalidate = useInvalidateScoring(testId);
  return useMutation({
    mutationFn: ({ questionId, patch }: { questionId: string; patch: QuestionScoringPatch }) =>
      mutate("PUT", `/api/tests/${testId}/question-scoring/${questionId}`, patch),
    onSuccess: invalidate,
  });
}

/** Reset one question to the default chain («Сбросить настройку»). */
export function useResetQuestionScoring(testId: string | undefined) {
  const invalidate = useInvalidateScoring(testId);
  return useMutation({
    mutationFn: ({ questionId }: { questionId: string }) =>
      mutate("DELETE", `/api/tests/${testId}/question-scoring/${questionId}`),
    onSuccess: invalidate,
  });
}
