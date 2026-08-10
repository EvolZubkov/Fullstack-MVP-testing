import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Field {
  key: string;
  type: string;
  default?: unknown;
}

interface ContentTemplate {
  key: string;
  kind: string;
  settings?: Field[];
}

const manifest = JSON.parse(
  readFileSync(resolve("server/scorm/templates/default/manifest.json"), "utf-8"),
) as { contentTemplates: ContentTemplate[] };

function fieldOf(key: string, field: string): Field | undefined {
  return manifest.contentTemplates.find((c) => c.key === key)?.settings?.find((s) => s.key === field);
}

describe("манифест «Стандартного»: переключатель радара", () => {
  it("объявлен у варианта итогов и выключен по умолчанию", () => {
    const field = fieldOf("results.standard", "showCompetencyRadar");
    expect(field).toBeDefined();
    expect(field!.type).toBe("boolean");
    expect(field!.default).toBe(false);
  });

  it("не заводит режима «авто»: у радара только да или нет", () => {
    const field = fieldOf("results.standard", "showCompetencyRadar") as Field & { options?: unknown };
    expect(field.options).toBeUndefined();
  });
});
