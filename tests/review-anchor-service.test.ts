/**
 * @module tests/review-anchor-service
 *
 * PRD-52 FR-19/FR-20: снимок контекста и пин содержимого якоря. Ярлык хранится
 * рядом с комментарием, чтобы тот оставался читаемым после удаления объекта, а
 * хеш — чтобы автор видел «изменено после комментария», когда содержимое вопроса
 * разошлось с тем, что рецензент видел.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getQuestion: vi.fn(),
    getTopic: vi.fn(),
    getContentPage: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { describeAnchor, anchorContentHash } from "../server/services/review-anchor";

const QUESTION = {
  id: "q1",
  topicId: "tp1",
  prompt: "Согласно «Стратегии-2030», какова целевая доля компании?",
  dataJson: { options: ["15%", "20%"] },
  correctJson: { correctIndex: 1 },
  feedback: "Смотри раздел 4 стратегии",
};

const TOPIC = { id: "tp1", name: "О компании" };

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getQuestion.mockResolvedValue({ ...QUESTION });
  storageMock.getTopic.mockResolvedValue({ ...TOPIC });
  storageMock.getContentPage.mockResolvedValue({
    id: "p1", kind: "info", templateKey: "info.default",
    valuesJson: { values: { title: "Введение", body: "<p>Текст</p>" } },
  });
});

describe("describeAnchor — ярлык контекста", () => {
  it("вопрос: раздел и начало формулировки", async () => {
    const snap = await describeAnchor({ kind: "question", questionId: "q1" });
    expect(snap.contextLabel).toBe(
      "Раздел «О компании» · Вопрос «Согласно «Стратегии-2030», какова целевая доля компании?»",
    );
  });

  it("длинная формулировка обрезается, а не растягивает список", async () => {
    storageMock.getQuestion.mockResolvedValue({ ...QUESTION, prompt: "П".repeat(400) });
    const snap = await describeAnchor({ kind: "question", questionId: "q1" });
    expect(snap.contextLabel!.length).toBeLessThanOrEqual(160);
    expect(snap.contextLabel).toContain("…");
  });

  it("страница контента: её заголовок", async () => {
    const snap = await describeAnchor({ kind: "content-page", contentPageId: "p1" });
    expect(snap.contextLabel).toBe("Страница «Введение»");
  });

  it("тема: её имя", async () => {
    const snap = await describeAnchor({ kind: "topic", topicId: "tp1" });
    expect(snap.contextLabel).toBe("Раздел «О компании»");
  });

  it("экраны и тест целиком описываются без обращения к базе", async () => {
    await expect(describeAnchor({ kind: "start" })).resolves.toEqual({
      contextLabel: "Стартовый экран",
      pinnedContentHash: null,
    });
    await expect(describeAnchor({ kind: "results" })).resolves.toEqual({
      contextLabel: "Экран итогов",
      pinnedContentHash: null,
    });
    await expect(describeAnchor({ kind: "test" })).resolves.toEqual({
      contextLabel: "Тест в целом",
      pinnedContentHash: null,
    });
    expect(storageMock.getQuestion).not.toHaveBeenCalled();
    expect(storageMock.getTopic).not.toHaveBeenCalled();
  });

  it("удалённый объект: ярлыка нет, но и падения нет", async () => {
    storageMock.getQuestion.mockResolvedValue(undefined);
    const snap = await describeAnchor({ kind: "question", questionId: "gone" });
    expect(snap.contextLabel).toBeNull();
    expect(snap.pinnedContentHash).toBeNull();
  });
});

describe("anchorContentHash — пин содержимого", () => {
  it("вопрос даёт стабильный хеш sha-256", async () => {
    const a = await anchorContentHash({ kind: "question", questionId: "q1" });
    const b = await anchorContentHash({ kind: "question", questionId: "q1" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it("правка формулировки меняет хеш", async () => {
    const before = await anchorContentHash({ kind: "question", questionId: "q1" });
    storageMock.getQuestion.mockResolvedValue({ ...QUESTION, prompt: "Иначе" });
    expect(await anchorContentHash({ kind: "question", questionId: "q1" })).not.toBe(before);
  });

  it("правка КЛЮЧА тоже меняет хеш: рецензент чаще спорит именно о нём", async () => {
    const before = await anchorContentHash({ kind: "question", questionId: "q1" });
    storageMock.getQuestion.mockResolvedValue({ ...QUESTION, correctJson: { correctIndex: 0 } });
    expect(await anchorContentHash({ kind: "question", questionId: "q1" })).not.toBe(before);
  });

  it("переименование темы не трогает хеш вопроса", async () => {
    const before = await anchorContentHash({ kind: "question", questionId: "q1" });
    storageMock.getTopic.mockResolvedValue({ ...TOPIC, name: "Новое имя" });
    expect(await anchorContentHash({ kind: "question", questionId: "q1" })).toBe(before);
  });

  it("экраны и тест целиком не пинятся — там нечему устаревать", async () => {
    await expect(anchorContentHash({ kind: "start" })).resolves.toBeNull();
    await expect(anchorContentHash({ kind: "test" })).resolves.toBeNull();
  });
});
