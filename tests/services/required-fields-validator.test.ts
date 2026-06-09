/**
 * @module tests/services/required-fields-validator
 * @description Unit tests for {@link findMissingRequiredFields} and
 * {@link RequiredFieldsMissingError} (PRD-1 §4.3.6).
 */
import { describe, it, expect } from "vitest";
import {
  findMissingRequiredFields,
  RequiredFieldsMissingError,
  type RequiredFieldsViolation,
} from "../../server/services/required-fields-validator";

describe("findMissingRequiredFields", () => {
  const placeholders = [
    { key: "title", required: true },
    { key: "subtitle", required: false },
    { key: "body", required: true },
    { key: "image" }, // required undefined — treated as not required
  ];

  it("returns empty array when all required fields are filled", () => {
    expect(findMissingRequiredFields(placeholders, {
      title: "Hello",
      body: "World",
    })).toEqual([]);
  });

  it("returns keys of missing required fields", () => {
    expect(findMissingRequiredFields(placeholders, { title: "Hello" })).toEqual(["body"]);
  });

  it("flags undefined / null values as missing", () => {
    expect(findMissingRequiredFields(placeholders, {
      title: undefined,
      body: null,
    }).sort()).toEqual(["body", "title"]);
  });

  it("flags empty strings and whitespace-only strings as missing", () => {
    expect(findMissingRequiredFields(placeholders, {
      title: "",
      body: "   \t\n",
    }).sort()).toEqual(["body", "title"]);
  });

  it("flags empty arrays as missing", () => {
    expect(findMissingRequiredFields(placeholders, {
      title: [],
      body: "ok",
    })).toEqual(["title"]);
  });

  it("treats falsy values (0, false) as filled", () => {
    expect(findMissingRequiredFields(placeholders, {
      title: 0,
      body: false,
    })).toEqual([]);
  });

  it("treats objects as filled regardless of contents", () => {
    expect(findMissingRequiredFields(placeholders, {
      title: { whatever: 1 },
      body: { path: "result.scorePercent" },
    })).toEqual([]);
  });

  it("ignores non-required placeholders even when empty", () => {
    expect(findMissingRequiredFields(placeholders, {
      title: "ok",
      body: "ok",
      // subtitle and image are empty/undefined but not required
    })).toEqual([]);
  });

  it("returns [] when values is undefined", () => {
    expect(findMissingRequiredFields([{ key: "x", required: false }], undefined)).toEqual([]);
  });

  it("returns required keys when values is empty object", () => {
    expect(findMissingRequiredFields([
      { key: "x", required: true },
      { key: "y", required: true },
    ], {}).sort()).toEqual(["x", "y"]);
  });
});

describe("RequiredFieldsMissingError", () => {
  it("carries violations and well-known message/name", () => {
    const violations: RequiredFieldsViolation[] = [
      { pageId: "p1", templateKey: "intro.hero", missingFields: ["title"] },
      { pageId: "p2", templateKey: "summary.text", missingFields: ["title", "result"] },
    ];
    const err = new RequiredFieldsMissingError(violations);
    expect(err.message).toBe("required_fields_missing");
    expect(err.name).toBe("RequiredFieldsMissingError");
    expect(err.violations).toEqual(violations);
    expect(err).toBeInstanceOf(Error);
  });

  it("is throwable and catchable as Error", () => {
    expect(() => {
      throw new RequiredFieldsMissingError([
        { pageId: "p1", templateKey: null, missingFields: ["x"] },
      ]);
    }).toThrow("required_fields_missing");
  });
});
