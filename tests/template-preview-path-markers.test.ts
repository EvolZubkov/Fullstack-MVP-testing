/**
 * @module tests/template-preview-path-markers
 *
 * The committed `preview.html` of every shipped template must not depend on the OS it was built
 * on. The generator (`scripts/docs/generate-prd1-template-previews.mjs`) marks each inlined runtime
 * file with its path; written with the platform separator, every `npm run build` on Windows
 * rewrote the committed preview with `\` and every build on Linux rewrote it back with `/`, so the
 * tree was dirty after each build without a real change in it. The marker is always `/`.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { TEMPLATE_IDS, templateFile } from "./helpers/template-roots";

describe("template preview — OS-independent path markers", () => {
  for (const id of TEMPLATE_IDS) {
    it(`«${id}»: runtime markers use forward slashes`, () => {
      const html = fs.readFileSync(templateFile(id, "preview.html"), "utf8");
      const markers = html.match(/\/\* server[\\/]scorm[\\/][^*]+\*\//g) ?? [];
      expect(markers.length).toBeGreaterThan(0);
      expect(markers.filter((m) => m.includes("\\"))).toEqual([]);
    });
  }
});
