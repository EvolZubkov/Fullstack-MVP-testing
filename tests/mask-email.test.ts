import { describe, it, expect } from "vitest";
import { maskEmail } from "../server/utils/mask-email";

describe("maskEmail", () => {
  it("shows first 2 chars + 5 stars + domain", () => {
    expect(maskEmail("friend042791@gmail.com")).toBe("fr*****@gmail.com");
  });

  it("works with short local part (1 char)", () => {
    expect(maskEmail("a@mail.ru")).toBe("a*****@mail.ru");
  });

  it("works with short local part (2 chars)", () => {
    expect(maskEmail("ab@mail.ru")).toBe("ab*****@mail.ru");
  });

  it("works with longer local part", () => {
    expect(maskEmail("johndoe@example.com")).toBe("jo*****@example.com");
  });

  it("returns fallback for invalid email (no @)", () => {
    expect(maskEmail("notanemail")).toBe("**@***.***");
  });

  it("returns fallback for empty string", () => {
    expect(maskEmail("")).toBe("**@***.***");
  });

  it("works with subdomain emails", () => {
    expect(maskEmail("kate@corp.company.ru")).toBe("ka*****@corp.company.ru");
  });

  it("always uses exactly 5 stars regardless of local length", () => {
    const result = maskEmail("verylongemail@test.com");
    const starsPart = result.split("@")[0].slice(2);
    expect(starsPart).toBe("*****");
  });
});
