// @vitest-environment node
/**
 * @module tests/scorm-shared-bundle
 *
 * Verifies the PRD-12 (2-7) bundle path: the shared template runtime is bundled
 * from `@shared` sources into a self-contained browser IIFE exposing the
 * `TBTemplate` global, and that global's `renderTemplate` actually works. This is
 * what makes the SCORM package consume the same renderer as the web host.
 */

import { describe, it, expect } from "vitest";
import { buildSharedRuntimeBundle, SHARED_RUNTIME_GLOBAL } from "../server/scorm/builders/shared-runtime";

describe("shared runtime bundle (SCORM package)", () => {
  it("bundles to an IIFE exposing TBTemplate with a working renderTemplate", async () => {
    const code = await buildSharedRuntimeBundle();
    expect(code).toContain(SHARED_RUNTIME_GLOBAL);

    // Evaluate the IIFE and capture the global it defines (no DOM needed for
    // renderTemplate, which is pure).
    const capture: { TBTemplate?: any } = {};
    // eslint-disable-next-line no-new-func
    new Function("sandbox", `${code}\nsandbox.TBTemplate = ${SHARED_RUNTIME_GLOBAL};`)(capture);

    expect(typeof capture.TBTemplate?.renderTemplate).toBe("function");
    expect(typeof capture.TBTemplate?.renderResultField).toBe("function");
    expect(typeof capture.TBTemplate?.renderScreenInto).toBe("function");

    const html = capture.TBTemplate.renderTemplate(
      "{{#if ok}}<b>{{ course.title }}</b>{{/if}}",
      { ok: true, course: { title: "Демо" } },
    );
    expect(html).toBe("<b>Демо</b>");
  }, 30000);
});
