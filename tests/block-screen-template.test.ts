// @vitest-environment jsdom
/**
 * @module tests/block-screen-template
 *
 * Headless check that the retake block-wall layout (system.blocked.html) binds the
 * cooldown data via the unified renderer (PRD-6 / PRD-12 #3). Branch visibility is
 * CSS-driven (data-retake-branch) and verified in the browser; here we assert the
 * data-path values bind into the cooldown branch.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";

const layout = fs.readFileSync(
  path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts", "system.blocked.html"),
  "utf8",
);

describe("system.blocked.html — cooldown data binding", () => {
  const root = document.createElement("div");
  renderScreenInto(root, {
    layout,
    context: { retake: { cooldownPeriodDays: 30, availableDateHuman: "1 июля 2026" } },
  });

  it("binds the cooldown period and human-readable available date", () => {
    expect(root.querySelector('[data-path="retake.cooldownPeriodDays"]')?.textContent).toBe("30");
    expect(root.querySelector('[data-path="retake.availableDateHuman"]')?.textContent).toBe("1 июля 2026");
  });

  it("keeps all three branches present for CSS/JS toggling", () => {
    expect(root.querySelector('[data-retake-branch="default"]')).not.toBeNull();
    expect(root.querySelector('[data-retake-branch="cooldown"]')).not.toBeNull();
    expect(root.querySelector('[data-retake-branch="error"]')).not.toBeNull();
  });
});
