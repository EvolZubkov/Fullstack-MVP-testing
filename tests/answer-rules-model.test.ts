import { describe, it, expect } from "vitest";
import {
  createDraft,
  switchKind,
  setJoin,
  setAutoCheck,
  addRule,
  updateRule,
  removeRule,
  toCorrectJson,
  isDirty,
} from "../client/src/features/questions/answer-rules/answer-rules-model";

describe("черновик набора правил", () => {
  it("переключение вида ответа не теряет набранного и возвращает его назад", () => {
    let draft = createDraft({
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "wildcard", value: "РТН" }],
    });
    draft = switchKind(draft, "number");
    draft = addRule(draft);
    expect(toCorrectJson(draft).rules[0].kind).toBe("number");

    draft = switchKind(draft, "text");
    expect(toCorrectJson(draft).rules).toEqual([{ kind: "text", match: "wildcard", value: "РТН" }]);
  });

  it("связка одна на набор", () => {
    const draft = setJoin(createDraft(null), "all");
    expect(toCorrectJson(draft).join).toBe("all");
  });

  it("правка правила не трогает соседей", () => {
    let draft = createDraft({
      answerKind: "text",
      join: "any",
      rules: [
        { kind: "text", match: "wildcard", value: "А" },
        { kind: "text", match: "wildcard", value: "Б" },
      ],
    });
    draft = updateRule(draft, 1, { value: "Вторая" });
    expect(toCorrectJson(draft).rules).toEqual([
      { kind: "text", match: "wildcard", value: "А" },
      { kind: "text", match: "wildcard", value: "Вторая" },
    ]);
  });

  it("удаление правила не трогает соседей", () => {
    let draft = createDraft({
      answerKind: "text",
      join: "any",
      rules: [
        { kind: "text", match: "wildcard", value: "А" },
        { kind: "text", match: "wildcard", value: "Б" },
      ],
    });
    draft = removeRule(draft, 0);
    expect(toCorrectJson(draft).rules).toEqual([{ kind: "text", match: "wildcard", value: "Б" }]);
  });

  it("пустой набор отдаётся как отсутствие правил", () => {
    expect(toCorrectJson(createDraft(null)).rules).toEqual([]);
  });

  it("новый вопрос заводится с включённой проверкой, сохранённый без правил — с выключенной", () => {
    // У типа автопроверка и есть смысл, поэтому новый вопрос не заставляет щёлкать
    // переключатель перед первым правилом. Но вопрос, сохранённый БЕЗ правил, автор
    // выключил сознательно — открывать его заново включённым нельзя.
    expect(createDraft(null).autoCheck).toBe(true);
    expect(createDraft({ answerKind: "text", join: "any", rules: [] }).autoCheck).toBe(false);
  });

  it("выключенная автопроверка отдаёт пустой набор, не теряя набранного", () => {
    let draft = createDraft({
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "wildcard", value: "РТН" }],
    });
    draft = setAutoCheck(draft, false);
    expect(toCorrectJson(draft).rules).toEqual([]);

    draft = setAutoCheck(draft, true);
    expect(toCorrectJson(draft).rules).toEqual([{ kind: "text", match: "wildcard", value: "РТН" }]);
  });

  it("новое числовое правило заводится с оператором «равно»", () => {
    const draft = addRule(switchKind(createDraft(null), "number"));
    expect(toCorrectJson(draft).rules[0]).toMatchObject({ kind: "number", op: "eq" });
  });

  it("знает, менялось ли что-нибудь с открытия ящика", () => {
    const initial = {
      answerKind: "text" as const,
      join: "any" as const,
      rules: [{ kind: "text" as const, match: "wildcard" as const, value: "РТН" }],
    };
    const draft = createDraft(initial);
    expect(isDirty(draft)).toBe(false);
    expect(isDirty(updateRule(draft, 0, { value: "Ростехнадзор" }))).toBe(true);
    // Переключение вида и возврат обратно — не правка: набор тот же, что был.
    expect(isDirty(switchKind(switchKind(draft, "number"), "text"))).toBe(false);
  });
});
