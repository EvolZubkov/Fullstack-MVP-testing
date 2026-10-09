/**
 * @module features/tests/review/review-api
 * @description PRD-52: клиентские запросы к API комментариев рецензирования.
 *
 * Один модуль на все три входа панели (ящик теста, отладчик, ссылка на ветку):
 * форма ответа сервера и адреса маршрутов не должны повторяться в трёх местах.
 */
import { apiRequest } from "@/lib/queryClient";
import type { ReviewAnchor, ReviewAnchorKind } from "@shared/review/anchor";

/** Комментарий как его отдаёт сервер. */
export interface ReviewComment {
  id: string;
  testId: string;
  authorId: string;
  authorName?: string | null;
  parentId: string | null;
  body: string;
  anchorKind: ReviewAnchorKind;
  questionId: string | null;
  topicId: string | null;
  contentPageId: string | null;
  contextLabel: string | null;
  pinnedContentHash: string | null;
  status: "open" | "accepted" | "rejected" | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Ветка: корень, его ответы и состояние якоря на момент чтения. */
export interface ReviewThread extends ReviewComment {
  replies: ReviewComment[];
  /** Содержимое якоря разошлось с тем, что было при создании комментария. */
  stale: boolean;
  /** Объект якоря удалён — переход некуда вести. */
  orphaned: boolean;
}

/** Исход, которым закрывают ветку. */
export type ReviewOutcome = "accepted" | "rejected";

export async function fetchReviewThreads(testId: string): Promise<ReviewThread[]> {
  const res = await apiRequest("GET", `/api/tests/${testId}/review/comments`);
  return (await res.json()) as ReviewThread[];
}

export async function createReviewComment(
  testId: string,
  input: { body: string; anchor?: ReviewAnchor; parentId?: string },
): Promise<ReviewComment> {
  const res = await apiRequest("POST", `/api/tests/${testId}/review/comments`, input);
  return (await res.json()) as ReviewComment;
}

export async function updateReviewComment(
  testId: string,
  commentId: string,
  body: string,
): Promise<ReviewComment> {
  const res = await apiRequest("PATCH", `/api/tests/${testId}/review/comments/${commentId}`, { body });
  return (await res.json()) as ReviewComment;
}

export async function deleteReviewComment(testId: string, commentId: string): Promise<void> {
  await apiRequest("DELETE", `/api/tests/${testId}/review/comments/${commentId}`);
}

export async function resolveReviewComment(
  testId: string,
  commentId: string,
  status: ReviewOutcome,
): Promise<ReviewComment> {
  const res = await apiRequest(
    "POST",
    `/api/tests/${testId}/review/comments/${commentId}/resolve`,
    { status },
  );
  return (await res.json()) as ReviewComment;
}

export async function reopenReviewComment(testId: string, commentId: string): Promise<ReviewComment> {
  const res = await apiRequest("POST", `/api/tests/${testId}/review/comments/${commentId}/reopen`);
  return (await res.json()) as ReviewComment;
}

/** Ключ кэша веток теста — общий для панели во всех её местах. */
export const reviewThreadsKey = (testId: string) => ["tests", testId, "review-comments"] as const;
