/**
 * @module features/tests/review/review-panel
 * @description PRD-52: панель комментариев рецензирования — ОДИН компонент на три
 * входа (вкладка в ящике теста, вкладка в отладчике, ссылка `?review=<id>`).
 *
 * Два режима отличаются только тем, откуда берётся место комментария:
 *   - `player` — из текущего экрана прогона, автоматически;
 *   - `editor` — выбирается явно, по умолчанию «тест в целом».
 *
 * Кто что может, решает не панель, а `canResolve`: исход ставит только тот, кто
 * правит тест. Рецензент видит уже проставленный исход и кнопок закрытия не имеет —
 * «учтено» означает обещание правки, а правит автор.
 */
import { useState } from "react";
import {
  Avatar, Banner, Button, Card, Cluster, EmptyState, SegmentedControl, Stack, Switch, Tag, Text,
  Textarea,
} from "@skillum/ui-kit";
import { ArrowRight, MessageSquarePlus } from "lucide-react";
import { pluralize } from "@/lib/i18n";
import { useReviewComments } from "./use-review-comments";
import { ReviewCommentForm, type ReviewAnchorItem } from "./review-comment-form";
import type { ReviewThread } from "./review-api";
import { resolveAnchorTarget, type ReviewAnchor, type AnchorTarget } from "@shared/review/anchor";
import "./review-panel.css";

export interface ReviewPanelProps {
  testId: string;
  /** Откуда берётся место нового комментария. */
  mode: "player" | "editor";
  /** Может ли текущий пользователь закрывать ветки с исходом (edit-доступ). */
  canResolve?: boolean;
  /** Идентификатор текущего пользователя — чтобы отличать свои комментарии. */
  currentUserId?: string;
  /** Место текущего экрана прогона; в режиме `editor` не используется. */
  screenAnchor?: ReviewAnchor;
  /** Разделы и их содержимое для выбора места в режиме `editor`. */
  anchorOptions?: { topics: { id: string; name: string }[]; items?: ReviewAnchorItem[] };
  /** Переход по якорю: панель только зовёт, открывает редактор хозяин панели. */
  onNavigate?: (target: AnchorTarget, thread: ReviewThread) => void;
  /** Ветка, раскрытая по ссылке `?review=<id>`. */
  focusThreadId?: string;
}

/** Подпись исхода ветки. */
function statusTag(thread: ReviewThread) {
  if (thread.status === "accepted") return <Tag size="s" tone="success">учтено</Tag>;
  if (thread.status === "rejected") return <Tag size="s" variant="soft">отклонено</Tag>;
  return <Tag size="s" tone="warning">открыто</Tag>;
}

/**
 * Инициалы для аватара. Имя может не прийти вовсе (пользователь удалён, ответ сервера
 * без него) — тогда кружок остаётся пустым, но с места не уходит: строка не должна
 * прыгать из-за отсутствующего имени.
 */
function initialsOf(name: string | null | undefined, mine: boolean): string {
  const source = (name ?? "").trim() || (mine ? "Вы" : "");
  if (!source) return "";
  const parts = source.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/** Дата в том виде, в каком её читают в списке: «2 сентября, 14:20». */
function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export function ReviewPanel({
  testId, mode, canResolve = false, currentUserId,
  screenAnchor, anchorOptions, onNavigate, focusThreadId,
}: ReviewPanelProps) {
  const review = useReviewComments(testId);
  const [composing, setComposing] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [resolving, setResolving] = useState<{ id: string; status: "accepted" | "rejected" } | null>(null);
  const [rejectReply, setRejectReply] = useState("");
  const [cursor, setCursor] = useState(0);

  // Сколько человек высказалось: авторы веток И ответов — отвечавший тоже участник
  // разговора, и по одним веткам его не видно.
  const expertCount = new Set(
    review.threads.flatMap((t) => [t.authorId, ...t.replies.map((r) => r.authorId)]),
  ).size;

  // Порядок обхода — тот же, в каком ветки показаны: обход по списку, а не по времени.
  const visibleThreads = review.groups.flatMap((group) => group.threads);

  /**
   * Переводит на следующую ветку по кругу: прокручивает к ней и отдаёт ей фокус.
   * Круг, а не остановка на последней: рецензент обходит замечания несколько раз, и
   * упершийся в конец список выглядел бы сломанной кнопкой.
   */
  function goToNextThread() {
    if (visibleThreads.length === 0) return;
    const next = cursor % visibleThreads.length;
    setCursor(next + 1);
    const thread = visibleThreads[next];
    const el = document.querySelector<HTMLElement>(`[data-testid="thread-${thread.id}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus?.();
  }

  if (review.isLoading) {
    return <Text tone="muted" variant="body-s">Загружаем комментарии…</Text>;
  }

  if (review.error) {
    return (
      <Banner tone="error" title="Не удалось загрузить комментарии">
        {review.error.message}
      </Banner>
    );
  }

  async function submitResolve() {
    if (!resolving) return;
    // При отклонении ответ обязателен — сервер это тоже проверяет, но человек не
    // должен узнавать о правиле из отказа: он видит его в форме.
    if (resolving.status === "rejected" && rejectReply.trim()) {
      await review.create.mutateAsync({ body: rejectReply.trim(), parentId: resolving.id });
    }
    await review.resolve.mutateAsync({ commentId: resolving.id, status: resolving.status });
    setResolving(null);
    setRejectReply("");
  }

  const rejectBlocked = resolving?.status === "rejected" && !rejectReply.trim();

  return (
    <Stack gap={3} className="rvp">
      <Cluster gap={3} align="center" className="rvp__bar">
        <Button
          variant="primary"
          size="s"
          leadingIcon={<MessageSquarePlus size={14} />}
          onClick={() => setComposing((v) => !v)}
          data-testid="add-comment"
        >
          {mode === "player" ? "Комментарий к этому экрану" : "Добавить комментарий"}
        </Button>
        <span className="rvp__spacer" />
        {/* Переключатель, затем подпись — как везде в ящике: сначала состояние, потом
            то, чем оно управляет. */}
        <label className="rvp__toggle">
          <Switch
            checked={review.openOnly}
            onChange={(e) => review.setOpenOnly(e.target.checked)}
            aria-label="Только открытые"
            data-testid="toggle-open-only"
          />
          <span className="rvp__toggle-lbl">Только открытые</span>
        </label>
        {/* Обход веток по одной: с двумя десятками комментариев прокрутка перестаёт
            быть навигацией, а рецензент читает их подряд, а не выбирает из списка. */}
        <Button
          variant="secondary"
          size="s"
          disabled={visibleThreads.length === 0}
          onClick={goToNextThread}
          data-testid="next-comment"
        >
          Следующий комментарий
        </Button>
      </Cluster>

      {composing ? (
        <ReviewCommentForm
          mode={mode}
          screenAnchor={screenAnchor}
          topics={anchorOptions?.topics ?? []}
          items={anchorOptions?.items ?? []}
          busy={review.create.isPending}
          onCancel={() => setComposing(false)}
          onSubmit={async (input) => {
            await review.create.mutateAsync(input);
            setComposing(false);
          }}
        />
      ) : null}

      {review.groups.length === 0 ? (
        <EmptyState
          title={review.openOnly ? "Открытых комментариев нет" : "Комментариев пока нет"}
          description={
            review.openOnly
              ? "Снимите фильтр, чтобы увидеть закрытые."
              : "Первый комментарий появится здесь, как только его оставят."
          }
          well
        />
      ) : null}

      {review.groups.map((group) => (
        <Stack gap={2} key={group.key}>
          {/* Общий заголовок группы ящика, а не свой: эскиз прямо называет этот класс. */}
          <div className="tb-section-label">{group.title}</div>
          {group.threads.map((thread) => {
            // Ветка несёт якорь плоскими полями — резолвер ждёт его отдельным объектом.
            const anchor: ReviewAnchor = {
              kind: thread.anchorKind,
              questionId: thread.questionId,
              topicId: thread.topicId,
              contentPageId: thread.contentPageId,
            };
            const target = resolveAnchorTarget(anchor);
            const canNavigate = Boolean(target) && !thread.orphaned && Boolean(onNavigate);
            const mine = currentUserId != null && thread.authorId === currentUserId;
            return (
              <Card
                key={thread.id}
                variant="outlined"
                size="sm"
                className={thread.id === focusThreadId ? "rvp__thread is-focused" : "rvp__thread"}
                data-testid={`thread-${thread.id}`}
                data-expanded={thread.id === focusThreadId ? "true" : "false"}
              >
                <Cluster gap={2} align="center" className="rvp__head">
                  {/* Аватар с инициалами: в ветке на десяток реплик имя читается медленнее,
                      чем цветной кружок, — по нему взгляд и находит своего собеседника. */}
                  <Avatar size="xs" initials={initialsOf(thread.authorName, mine)} />
                  <strong className="rvp__who">{thread.authorName || (mine ? "Вы" : thread.authorId)}</strong>
                  <span className="rvp__when">{when(thread.createdAt)}</span>
                  <span className="rvp__spacer" />
                  {statusTag(thread)}
                </Cluster>
                {thread.contextLabel ? <div className="rvp__ctx">{thread.contextLabel}</div> : null}
                <p className="rvp__text">{thread.body}</p>

                {thread.replies.length ? (
                  <div className="rvp__replies">
                    {thread.replies.map((reply) => (
                      <div key={reply.id}>
                        <Cluster gap={2} align="center" className="rvp__head">
                          <Avatar
                            size="xs"
                            initials={initialsOf(reply.authorName, reply.authorId === currentUserId)}
                          />
                          <strong className="rvp__who">
                            {reply.authorName || (reply.authorId === currentUserId ? "Вы" : reply.authorId)}
                          </strong>
                          <span className="rvp__when">{when(reply.createdAt)}</span>
                        </Cluster>
                        <p className="rvp__text">{reply.body}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {replyTo === thread.id ? (
                  <ReviewCommentForm
                    mode="reply"
                    busy={review.create.isPending}
                    onCancel={() => setReplyTo(null)}
                    onSubmit={async (input) => {
                      await review.create.mutateAsync({ body: input.body, parentId: thread.id });
                      setReplyTo(null);
                    }}
                  />
                ) : null}

                {resolving?.id === thread.id ? (
                  <Stack gap={2} className="rvp__resolve">
                    {/* Исход — выбор ОДНОГО из двух, а не две команды: эскиз ставит здесь
                        переключатель с подписью поля. Двумя кнопками выбранный исход
                        читался как «нажми обе». */}
                    <div className="ou-formfield">
                      <span className="ou-formfield__lbl">Исход</span>
                      <SegmentedControl<"accepted" | "rejected">
                        size="s"
                        variant="accent"
                        aria-label="Исход комментария"
                        value={resolving.status}
                        items={[
                          { value: "accepted", label: "Учтено" },
                          { value: "rejected", label: "Отклонено" },
                        ]}
                        onChange={(status) => setResolving({ id: thread.id, status })}
                      />
                    </div>
                    {resolving.status === "rejected" ? (
                      <Textarea
                        label="Ответ автора"
                        hint="При отклонении ответ обязателен: эксперт должен увидеть причину."
                        placeholder="Почему комментарий отклонён"
                        rows={3}
                        value={rejectReply}
                        onChange={(e) => setRejectReply(e.target.value)}
                        data-testid="reject-reply"
                      />
                    ) : null}
                    <Cluster gap={2} align="center">
                      <Button variant="ghost" size="s" onClick={() => { setResolving(null); setRejectReply(""); }}>
                        Отмена
                      </Button>
                      <span className="rvp__spacer" />
                      <Button
                        variant="primary"
                        size="s"
                        disabled={rejectBlocked || review.resolve.isPending}
                        onClick={submitResolve}
                        data-testid="confirm-resolve"
                      >
                        Закрыть комментарий
                      </Button>
                    </Cluster>
                  </Stack>
                ) : (
                  <Cluster gap={2} align="center" className="rvp__actions">
                    {thread.stale ? (
                      <Tag size="s" variant="outline">изменено после комментария</Tag>
                    ) : null}
                    {thread.orphaned ? <Tag size="s" variant="soft">объект удалён</Tag> : null}
                    {target ? (
                      <Button
                        variant="secondary"
                        size="s"
                        disabled={!canNavigate}
                        onClick={() => canNavigate && onNavigate!(target!, thread)}
                        data-testid={`goto-${thread.id}`}
                        trailingIcon={<ArrowRight size={13} aria-hidden="true" />}
                      >
                        Перейти к вопросу
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="s" onClick={() => setReplyTo(thread.id)}>
                      Ответить
                    </Button>
                    <span className="rvp__spacer" />
                    {canResolve && thread.status === "open" ? (
                      <Button
                        variant="secondary"
                        size="s"
                        onClick={() => setResolving({ id: thread.id, status: "accepted" })}
                        data-testid={`resolve-${thread.id}`}
                      >
                        Закрыть комментарий
                      </Button>
                    ) : null}
                    {canResolve && thread.status !== "open" ? (
                      <Button
                        variant="secondary"
                        size="s"
                        onClick={() => review.reopen.mutate(thread.id)}
                      >
                        Открыть заново
                      </Button>
                    ) : null}
                  </Cluster>
                )}
              </Card>
            );
          })}
        </Stack>
      ))}

      <div className="rvp__sum">
        <Text tone="muted" variant="body-s">
          {`Всего ${review.threads.length} ${pluralize(review.threads.length, "комментарий", "комментария", "комментариев")}`}
          {` · открытых ${review.openCount}`}
          {expertCount > 0
            ? ` · от ${expertCount} ${pluralize(expertCount, "эксперта", "экспертов", "экспертов")}`
            : ""}
        </Text>
      </div>
    </Stack>
  );
}
