/**
 * @module server/services/__tests__/description-format
 * @description PRD-59 FR-23/FR-24: description markup is sanitised on the server,
 * because the editor is not the only writer (workbook import, test transfer).
 */
import { describe, it, expect } from "vitest";
import { sanitizeDescription, DESCRIPTION_SCOPE } from "../description-format";

describe("sanitizeDescription", () => {
  it("leaves plain text untouched, script tag and all", () => {
    const raw = "Текст со словом <script> внутри";
    expect(sanitizeDescription(raw, "plain")).toBe(raw);
  });

  it("strips a script element from markup", () => {
    expect(sanitizeDescription("<p>Курс</p><script>alert(1)</script>", "richText")).toBe(
      "<p>Курс</p>",
    );
  });

  it("strips an inline event handler", () => {
    expect(sanitizeDescription('<p onclick="steal()">Курс</p>', "html")).not.toContain("onclick");
  });

  it("confines a pasted style block to the description's own region", () => {
    const out = sanitizeDescription("<style>body { display: none }</style><p>Курс</p>", "html");
    expect(out).toContain(DESCRIPTION_SCOPE);
    expect(out).not.toMatch(/(^|\s)body\s*\{/);
  });
});
