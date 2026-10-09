/**
 * @module features/content/__tests__/question-link.test
 * @description Unit tests for the analytics → «Темы и вопросы» deep link
 * ({@link module:features/content/question-link}): the href the analytics menu
 * builds must be read back by the content tree, and stripping the param must keep
 * every other query parameter.
 */
import { describe, expect, it } from "vitest";
import {
  CONTENT_PATH,
  QUESTION_PARAM,
  questionFromSearch,
  questionInTopicHref,
  searchWithoutQuestion,
} from "../question-link";

describe("question-link", () => {
  it("questionInTopicHref round-trips through questionFromSearch", () => {
    const id = "3f2a9c1e-0b7d-4e5a-9c61-2d8f0a1b7e44";
    const href = questionInTopicHref(id);
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe(CONTENT_PATH);
    expect(url.searchParams.get(QUESTION_PARAM)).toBe(id);
    expect(questionFromSearch(url.search)).toBe(id);
  });

  it("encodes ids with reserved characters and still reads them back", () => {
    const id = "a b&c=d";
    expect(questionFromSearch(new URL(questionInTopicHref(id), "http://localhost").search)).toBe(id);
  });

  it("questionFromSearch returns null for a missing or blank param", () => {
    expect(questionFromSearch("")).toBeNull();
    expect(questionFromSearch("?other=1")).toBeNull();
    expect(questionFromSearch(`?${QUESTION_PARAM}=%20%20`)).toBeNull();
  });

  it("searchWithoutQuestion drops only the question param", () => {
    expect(searchWithoutQuestion(`?${QUESTION_PARAM}=q1&tab=x`)).toBe("?tab=x");
    expect(searchWithoutQuestion(`?${QUESTION_PARAM}=q1`)).toBe("");
    expect(searchWithoutQuestion("")).toBe("");
  });
});
