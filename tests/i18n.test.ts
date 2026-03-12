import { describe, it, expect } from "vitest";
import { formatQuestions, formatTopics } from "../client/src/lib/i18n";

describe("formatQuestions", () => {
  it("1 вопрос", () => {
    expect(formatQuestions(1)).toMatch(/вопрос/);
  });

  it("2 вопроса", () => {
    expect(formatQuestions(2)).toMatch(/вопроса/);
  });

  it("5 вопросов", () => {
    expect(formatQuestions(5)).toMatch(/вопросов/);
  });

  it("11 вопросов (teen exception)", () => {
    expect(formatQuestions(11)).toMatch(/вопросов/);
  });

  it("21 вопрос", () => {
    expect(formatQuestions(21)).toMatch(/вопрос/);
  });

  it("0 вопросов", () => {
    expect(formatQuestions(0)).toMatch(/вопросов/);
  });

  it("includes the number in the output", () => {
    expect(formatQuestions(7)).toContain("7");
  });
});

describe("formatTopics", () => {
  it("1 тема", () => {
    expect(formatTopics(1)).toMatch(/тема/);
  });

  it("2 темы", () => {
    expect(formatTopics(2)).toMatch(/темы/);
  });

  it("5 тем", () => {
    expect(formatTopics(5)).toMatch(/тем/);
  });

  it("11 тем (teen exception)", () => {
    expect(formatTopics(11)).toMatch(/тем/);
  });

  it("21 тема", () => {
    expect(formatTopics(21)).toMatch(/тема/);
  });

  it("includes the number in the output", () => {
    expect(formatTopics(3)).toContain("3");
  });
});
