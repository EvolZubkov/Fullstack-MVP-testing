import { describe, it, expect } from "vitest";
import { designSettingsSchema } from "@shared/schema";

const BASE = { templateId: "default", templateVersion: "1.6.0", templateApiVersion: "1.0", params: {} };

describe("designSettingsSchema (PRD-49)", () => {
  it("keeps the stored labels", () => {
    const parsed = designSettingsSchema.parse({
      ...BASE,
      labels: { "results.scales": { on: true, text: "Профиль" }, "results.topics": { on: false } },
    });
    expect(parsed.labels?.["results.scales"]).toEqual({ on: true, text: "Профиль" });
    expect(parsed.labels?.["results.topics"]).toEqual({ on: false });
  });

  it("keeps the stored sub-block order", () => {
    const parsed = designSettingsSchema.parse({ ...BASE, resultsBlockOrder: ["topics", "scales"] });
    expect(parsed.resultsBlockOrder).toEqual(["topics", "scales"]);
  });

  it("stays valid without either field", () => {
    const parsed = designSettingsSchema.parse(BASE);
    expect(parsed.labels).toBeUndefined();
    expect(parsed.resultsBlockOrder).toBeUndefined();
  });
});
