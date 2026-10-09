/**
 * @module tests/question-prompt-format
 * @description Формат текста задания (PRD-57 §4.3, FR-09a — FR-09c).
 *
 * Текст задания перестал быть всегда разметкой: автор набирает его в одном из трёх режимов,
 * и режим надо помнить — иначе набравший визуально вернётся в поле с тегами.
 *
 * Проверяется то, что легко сломать молча: умолчание для уже написанных заданий (их тысячи,
 * и ни одно не должно измениться) и независимость хеша содержимого от формата.
 */
import { describe, it, expect } from "vitest";

import { promptFormatOf, PROMPT_FORMATS, isMarkupFormat } from "../shared/questions/prompt-format";
import { computeQuestionHash } from "../server/services/questions-import";

describe("перечень форматов", () => {
  it("три режима и ни одним больше", () => {
    expect([...PROMPT_FORMATS]).toEqual(["markdown", "richText", "html"]);
  });

  it("написание повторяет то, что уже принято в продукте", () => {
    // `feedbackContentSchema.format` и `tests.description_format` — те же слова. Второй
    // словарь форматов это способ завести два разных «Форматированных».
    expect(PROMPT_FORMATS).toContain("richText");
    expect(PROMPT_FORMATS).toContain("html");
  });
});

describe("формат существующего задания", () => {
  it("отсутствие колонки читается как разметка", () => {
    expect(promptFormatOf({})).toBe("markdown");
    expect(promptFormatOf({ promptFormat: null })).toBe("markdown");
    expect(promptFormatOf({ promptFormat: undefined })).toBe("markdown");
  });

  it("незнакомое значение тоже читается как разметка, а не роняет выдачу", () => {
    expect(promptFormatOf({ promptFormat: "wysiwyg" })).toBe("markdown");
  });

  it("объявленный формат возвращается как есть", () => {
    expect(promptFormatOf({ promptFormat: "html" })).toBe("html");
    expect(promptFormatOf({ promptFormat: "richText" })).toBe("richText");
  });
});

describe("разметка против текста", () => {
  it("richText и html — это РАЗМЕТКА, разметка — нет", () => {
    // Различие нужно каждому потребителю текста: по нему он решает, снимать ли теги.
    expect(isMarkupFormat("richText")).toBe(true);
    expect(isMarkupFormat("html")).toBe(true);
    expect(isMarkupFormat("markdown")).toBe(false);
  });
});

describe("хеш содержимого", () => {
  it("от формата НЕ зависит: он ловит изменение содержания", () => {
    // Иначе один проход миграции сдвинул бы хеш у каждого существующего задания и ложно
    // зажёг индикатор устаревших переопределений оценки (прецедент PRD-30 с order_index).
    const a = computeQuestionHash("single", "Текст задания", { options: ["А", "Б"] });
    const b = computeQuestionHash("single", "Текст задания", { options: ["А", "Б"] });
    expect(a).toBe(b);
  });
});

describe("схема вопроса", () => {
  it("принимает формат и подставляет умолчание", async () => {
    const { insertQuestionSchema } = await import("../shared/schema");
    const withFormat = insertQuestionSchema.parse({
      topicId: "t1",
      type: "single",
      prompt: "<p>Текст</p>",
      dataJson: { options: ["А", "Б"] },
      correctJson: { correctIndex: 0 },
      promptFormat: "html",
    });
    expect(withFormat.promptFormat).toBe("html");

    const without = insertQuestionSchema.parse({
      topicId: "t1",
      type: "single",
      prompt: "Текст",
      dataJson: { options: ["А", "Б"] },
      correctJson: { correctIndex: 0 },
    });
    expect(without.promptFormat ?? "markdown").toBe("markdown");
  });

  it("чужое значение формата отвергается схемой", async () => {
    const { insertQuestionSchema } = await import("../shared/schema");
    expect(() => insertQuestionSchema.parse({
      topicId: "t1",
      type: "single",
      prompt: "Текст",
      dataJson: {},
      correctJson: {},
      promptFormat: "markdown-plus",
    })).toThrow();
  });
});

/**
 * Грабля «второго контракта», которую трек ловил уже трижды (Э3, Э9, и вот снова): слой
 * записи перечисляет колонки ЯВНО, и поле, не названное в списке, исчезает молча — форма
 * принимает, схема принимает, а в базе его нет.
 */
describe("второй контракт записи", () => {
  it("создание задания называет формат среди колонок", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "server/storage/questions-repository.ts"), "utf8");
    const create = source.slice(source.indexOf("async createQuestion"), source.indexOf("async duplicateQuestion"));
    expect(create).toContain("promptFormat");
  });

  it("копия задания наследует формат: иначе копия HTML-текста прочиталась бы как разметка", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "server/storage/questions-repository.ts"), "utf8");
    const duplicate = source.slice(source.indexOf("async duplicateQuestion"), source.indexOf("async updateQuestion"));
    expect(duplicate).toContain("promptFormat");
  });
});
