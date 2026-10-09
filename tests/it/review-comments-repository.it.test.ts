/**
 * @module tests/it/review-comments-repository.it.test
 * @description PRD-52 раздел 6: слой данных комментариев рецензирования на реальной
 * базе (pglite).
 *
 * Круглый рейс здесь обязателен, а не избыточен: форма ветки держится на двух
 * соглашениях, которые видит только база, — статус живёт ТОЛЬКО у корня, а удаление
 * корня забирает ответы. Ошибка в любом из них не роняет ни один запрос: она
 * проявится позже, как ветка без исхода или как ответы-сироты, которые никто не
 * читает и никто не удаляет.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { tests } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { ReviewCommentsRepository } from "../../server/storage/review-comments-repository";

let repo: ReviewCommentsRepository;
let testId: string;
let otherTestId: string;

beforeAll(async () => {
  h.current = await createHarness();
  repo = new ReviewCommentsRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  testId = randomUUID();
  otherTestId = randomUUID();
  // Комментарии ссылаются на тест внешним ключом — тесты должны существовать.
  await h.current!.db.insert(tests).values([
    { id: testId, title: "Тест на рецензии", overallPassRuleJson: { type: "percent", value: 80 } },
    { id: otherTestId, title: "Соседний тест", overallPassRuleJson: { type: "percent", value: 80 } },
  ] as never);
});

/** Корневой комментарий с якорем на вопрос. */
function rootInput(over: Record<string, unknown> = {}) {
  return {
    testId,
    authorId: "expert-1",
    body: "Формулировка допускает два прочтения",
    anchorKind: "question" as const,
    questionId: "q1",
    topicId: "tp1",
    contextLabel: "Раздел «О компании» · Вопрос «…»",
    pinnedContentHash: "a".repeat(64),
    ...over,
  };
}

describe("ветки", () => {
  it("собирает корни с ответами в порядке появления", async () => {
    const root = await repo.createReviewComment(rootInput());
    await repo.createReviewComment({
      testId, authorId: "author-1", body: "Поправлю", parentId: root.id, anchorKind: "question", questionId: "q1",
    });
    await repo.createReviewComment({
      testId, authorId: "expert-2", body: "Согласен", parentId: root.id, anchorKind: "question", questionId: "q1",
    });

    const threads = await repo.listReviewThreads(testId);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((r) => r.body)).toEqual(["Поправлю", "Согласен"]);
  });

  it("корень открывается со статусом open, ответ не несёт статуса вовсе", async () => {
    const root = await repo.createReviewComment(rootInput());
    const reply = await repo.createReviewComment({
      testId, authorId: "author-1", body: "Ответ", parentId: root.id, anchorKind: "question", questionId: "q1",
    });
    expect(root.status).toBe("open");
    expect(reply.status).toBeNull();
  });

  it("не смешивает комментарии соседнего теста", async () => {
    await repo.createReviewComment(rootInput());
    await repo.createReviewComment(rootInput({ testId: otherTestId }));
    expect(await repo.listReviewThreads(testId)).toHaveLength(1);
    expect(await repo.listReviewThreads(otherTestId)).toHaveLength(1);
  });
});

describe("жизненный цикл", () => {
  it("закрытие пишет исход, автора и время", async () => {
    const root = await repo.createReviewComment(rootInput());
    await repo.resolveReviewComment(root.id, { status: "rejected", resolvedBy: "author-1" });

    const [thread] = await repo.listReviewThreads(testId);
    expect(thread.status).toBe("rejected");
    expect(thread.resolvedBy).toBe("author-1");
    expect(thread.resolvedAt).toBeInstanceOf(Date);
  });

  it("переоткрытие снимает исход вместе со следом о закрытии", async () => {
    const root = await repo.createReviewComment(rootInput());
    await repo.resolveReviewComment(root.id, { status: "accepted", resolvedBy: "author-1" });
    const reopened = await repo.reopenReviewComment(root.id);
    expect(reopened!.status).toBe("open");
    expect(reopened!.resolvedBy).toBeNull();
    expect(reopened!.resolvedAt).toBeNull();
  });

  it("правка текста не трогает якорь и пин", async () => {
    const root = await repo.createReviewComment(rootInput());
    const updated = await repo.updateReviewCommentBody(root.id, "Другой текст");
    expect(updated!.body).toBe("Другой текст");
    expect(updated!.questionId).toBe("q1");
    expect(updated!.pinnedContentHash).toBe(root.pinnedContentHash);
  });

  it("удаление корня забирает ответы: сирот не остаётся", async () => {
    const root = await repo.createReviewComment(rootInput());
    await repo.createReviewComment({
      testId, authorId: "author-1", body: "Ответ", parentId: root.id, anchorKind: "question", questionId: "q1",
    });
    expect(await repo.deleteReviewComment(root.id)).toBe(true);
    expect(await repo.listReviewThreads(testId)).toHaveLength(0);
    expect(await repo.getReviewComment(root.id)).toBeUndefined();
  });

  it("знает, отвечали ли в ветке — от этого зависят правка и отклонение", async () => {
    const root = await repo.createReviewComment(rootInput());
    expect(await repo.hasReviewReplies(root.id)).toBe(false);
    await repo.createReviewComment({
      testId, authorId: "author-1", body: "Ответ", parentId: root.id, anchorKind: "question", questionId: "q1",
    });
    expect(await repo.hasReviewReplies(root.id)).toBe(true);
  });
});

describe("счётчики открытых", () => {
  it("считает только открытые корни, не ответы и не закрытые", async () => {
    const a = await repo.createReviewComment(rootInput());
    await repo.createReviewComment(rootInput({ body: "Второй" }));
    await repo.createReviewComment({
      testId, authorId: "author-1", body: "Ответ", parentId: a.id, anchorKind: "question", questionId: "q1",
    });
    await repo.resolveReviewComment(a.id, { status: "accepted", resolvedBy: "author-1" });

    expect(await repo.countOpenReviewComments(testId)).toBe(1);
  });

  it("считает по многим тестам одним запросом и молчит о тестах без открытых", async () => {
    await repo.createReviewComment(rootInput());
    await repo.createReviewComment(rootInput({ testId: otherTestId }));
    await repo.createReviewComment(rootInput({ testId: otherTestId, body: "Ещё" }));

    const counts = await repo.countOpenReviewCommentsByTests([testId, otherTestId, randomUUID()]);
    expect(counts[testId]).toBe(1);
    expect(counts[otherTestId]).toBe(2);
    expect(Object.keys(counts)).toHaveLength(2);
  });

  it("пустой список тестов не идёт в базу вовсе", async () => {
    expect(await repo.countOpenReviewCommentsByTests([])).toEqual({});
  });
});
