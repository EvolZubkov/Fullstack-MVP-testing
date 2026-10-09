/**
 * @module features/tests/review/use-review-comments
 * @description PRD-52: загрузка веток комментариев, фильтр «только открытые» и
 * группировка по месту.
 *
 * Группировка живёт здесь, а не в разметке, потому что она — правило чтения, а не
 * оформление: комментарии выстраиваются по разделам теста, а «тест в целом» уходит
 * в конец. Иначе замечание об общем пороге вклинивалось бы между вопросами.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchReviewThreads, createReviewComment, updateReviewComment, deleteReviewComment,
  resolveReviewComment, reopenReviewComment, reviewThreadsKey,
  type ReviewThread, type ReviewOutcome,
} from "./review-api";
import type { ReviewAnchor } from "@shared/review/anchor";

/** Ветки одного места: раздел, страница или тест целиком. */
export interface ReviewGroup {
  key: string;
  title: string;
  threads: ReviewThread[];
}

/** Заголовок группы по первой ветке в ней. */
function groupTitleOf(thread: ReviewThread): { key: string; title: string } {
  if (thread.anchorKind === "test") return { key: "test", title: "Тест в целом" };
  if (thread.anchorKind === "start") return { key: "start", title: "Стартовый экран" };
  if (thread.anchorKind === "results") return { key: "results", title: "Экран итогов" };
  const topicKey = thread.topicId ?? "no-topic";
  // Ярлык контекста начинается с раздела («Раздел «X» · Вопрос …»), поэтому имя
  // раздела берётся из него — второго обращения к темам не требуется.
  const label = thread.contextLabel ?? "";
  const dot = label.indexOf(" · ");
  const title = dot > 0 ? label.slice(0, dot) : label || "Без раздела";
  return { key: topicKey, title };
}

export function useReviewComments(testId: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled !== false && Boolean(testId);
  const queryClient = useQueryClient();
  const [openOnly, setOpenOnly] = useState(true);

  const query = useQuery({
    queryKey: reviewThreadsKey(testId),
    queryFn: () => fetchReviewThreads(testId),
    enabled,
  });

  const threads = useMemo(() => query.data ?? [], [query.data]);

  const visible = useMemo(
    () => (openOnly ? threads.filter((t) => t.status === "open") : threads),
    [threads, openOnly],
  );

  const groups = useMemo<ReviewGroup[]>(() => {
    const byKey = new Map<string, ReviewGroup>();
    for (const thread of visible) {
      const { key, title } = groupTitleOf(thread);
      const group = byKey.get(key);
      if (group) group.threads.push(thread);
      else byKey.set(key, { key, title, threads: [thread] });
    }
    // «Тест в целом» — последним: это замечание обо всём сразу, и в начале списка
    // оно оттесняло бы разговор о конкретных вопросах.
    return [...byKey.values()].sort((a, b) => {
      const rank = (g: ReviewGroup) => (g.key === "test" ? 1 : 0);
      return rank(a) - rank(b);
    });
  }, [visible]);

  const openCount = useMemo(() => threads.filter((t) => t.status === "open").length, [threads]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: reviewThreadsKey(testId) });

  const create = useMutation({
    mutationFn: (input: { body: string; anchor?: ReviewAnchor; parentId?: string }) =>
      createReviewComment(testId, input),
    onSuccess: invalidate,
  });

  const edit = useMutation({
    mutationFn: (input: { commentId: string; body: string }) =>
      updateReviewComment(testId, input.commentId, input.body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => deleteReviewComment(testId, commentId),
    onSuccess: invalidate,
  });

  const resolve = useMutation({
    mutationFn: (input: { commentId: string; status: ReviewOutcome }) =>
      resolveReviewComment(testId, input.commentId, input.status),
    onSuccess: invalidate,
  });

  const reopen = useMutation({
    mutationFn: (commentId: string) => reopenReviewComment(testId, commentId),
    onSuccess: invalidate,
  });

  return {
    threads, visible, groups, openCount,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    openOnly, setOpenOnly,
    create, edit, remove, resolve, reopen,
  };
}
