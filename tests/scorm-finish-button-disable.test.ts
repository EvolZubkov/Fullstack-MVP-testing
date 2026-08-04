/**
 * @module tests/scorm-finish-button-disable
 * @description The «Завершить тест» button stays clickable after the learner has
 * already triggered `finishAndClose()` — the guard in resultsPage.js only sets the
 * in-memory `scormFinished` flag, it never touches the DOM. On hosts that don't
 * actually close the window (e.g. Moodle embedding the SCO in an iframe instead of
 * a script-opened popup) the button is left looking fully interactive forever,
 * which reads as "nothing happened" and invites re-clicks. `disableFinishButtons`
 * is the extracted fix: it disables every rendered finish-action control
 * regardless of which screen produced it (standard/adaptive/post-results).
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const resultsSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
  "utf8",
);

function makeDisableFinishButtons(): () => void {
  const match = resultsSrc.match(/function disableFinishButtons\(\)\s*\{[\s\S]*?\n\}/);
  if (!match) throw new Error("disableFinishButtons not found in resultsPage.js");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${match[0]}\n;return disableFinishButtons;`)() as () => void;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("disableFinishButtons — every finish-action control goes inert", () => {
  it("disables the standard results screen's «results-finish» button", () => {
    document.body.innerHTML = '<button data-action="results-finish">Завершить</button>';
    makeDisableFinishButtons()();
    expect(
      (document.querySelector('[data-action="results-finish"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables the adaptive results screen's «finish» button", () => {
    document.body.innerHTML = '<button data-action="finish">Завершить тест</button>';
    makeDisableFinishButtons()();
    expect(
      (document.querySelector('[data-action="finish"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables the post-results last-page «test-finish» button", () => {
    document.body.innerHTML = '<button data-action="test-finish">Завершить тест</button>';
    makeDisableFinishButtons()();
    expect(
      (document.querySelector('[data-action="test-finish"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("leaves unrelated footer buttons (e.g. «Скачать отчёт») enabled", () => {
    document.body.innerHTML =
      '<button data-action="download-report">Скачать отчёт</button>' +
      '<button data-action="results-finish">Завершить</button>';
    makeDisableFinishButtons()();
    expect(
      (document.querySelector('[data-action="download-report"]') as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
