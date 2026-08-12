/**
 * @module tests/debug-player-finish-guard
 * @description `guardFinishButton` (inspector-compute.js) is the debug player's own
 * safety net: it disables the «Завершить …» control after its first click so a
 * finished run can't be re-submitted while the debugger is watching. Its selector
 * only recognised `data-action="test-finish"`/`"router-finish"` or the exact text
 * "Завершить тест" — the standard (non-adaptive) results screen's control carries
 * `data-action="results-finish"` and the shorter default label "Завершить"
 * (`shared/template/results-nav.ts`), so the guard silently missed it and the button
 * stayed clickable in the debug player too, same as reported live in Moodle.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

interface GuardApi {
  guardFinishButton(win: { document: Document }): void;
}

beforeAll(() => {
  const src = fs.readFileSync(
    path.resolve("server/scorm/debug-player/assets/inspector-compute.js"),
    "utf8",
  );
  new Function(src)();
});

function ref(): GuardApi {
  return (window as unknown as { TBInspector: GuardApi }).TBInspector;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("guardFinishButton — recognises every finish-action control", () => {
  it("disables the standard results screen's «results-finish» button (short label)", async () => {
    document.body.innerHTML = '<button data-action="results-finish">Завершить</button>';
    const btn = document.querySelector("button") as HTMLButtonElement;
    ref().guardFinishButton({ document });
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(true);
  });

  it("still disables the post-results «test-finish» button (already worked)", async () => {
    document.body.innerHTML = '<button data-action="test-finish">Завершить тест</button>';
    const btn = document.querySelector("button") as HTMLButtonElement;
    ref().guardFinishButton({ document });
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(true);
  });

  it("still disables the adaptive results screen's «finish» button (bare text match)", async () => {
    document.body.innerHTML = '<button data-action="finish">Завершить тест</button>';
    const btn = document.querySelector("button") as HTMLButtonElement;
    ref().guardFinishButton({ document });
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(true);
  });
});
