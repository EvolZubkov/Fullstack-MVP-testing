/**
 * @module tests/long-answer-lms
 * @description Предварительный результат в LMS (PRD-57 FR-40): `unknown`, а не `failed`.
 *
 * Расхождение здесь дорого: «не сдал» в отчёте LMS по непроверенной работе — это
 * претензия участника, а не неточность данных. SCORM 2004 предусматривает `unknown`
 * ровно для случая «оценка ещё не выставлена».
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runtimeSrc = readFileSync(resolve(process.cwd(), "server/scorm/assets/runtime.js"), "utf8");

/** Поднять адаптер SCORM с подложным API и собрать всё, что он записал. */
function withAdapter(): { calls: Array<[string, unknown]>; SCORM: Record<string, (...args: never[]) => unknown> } {
  const calls: Array<[string, unknown]> = [];
  const api = {
    Initialize: () => "true",
    SetValue: (key: string, value: unknown) => { calls.push([key, value]); return "true"; },
    GetValue: () => "",
    Commit: () => "true",
    Terminate: () => "true",
    GetLastError: () => "0",
    GetErrorString: () => "",
    GetDiagnostic: () => "",
  };
  const win = { API_1484_11: api, console } as Record<string, unknown>;
  const SCORM = new Function("window", "console", `${runtimeSrc}\n;return SCORM;`)(win, console) as never;
  return { calls, SCORM: SCORM as never };
}

describe("SCORM.finish", () => {
  it("предварительный результат отправляется как unknown", () => {
    const { calls, SCORM } = withAdapter();
    (SCORM as never as { init: () => void }).init();
    (SCORM as never as { finish: (a: number, b: number, c: boolean | null, d: unknown[], e: unknown[]) => void })
      .finish(5, 10, null, [], []);
    const status = calls.find(([key]) => key === "cmi.success_status");
    expect(status?.[1]).toBe("unknown");
  });

  it("окончательный результат по-прежнему passed или failed", () => {
    for (const [passed, expected] of [[true, "passed"], [false, "failed"]] as const) {
      const { calls, SCORM } = withAdapter();
      (SCORM as never as { init: () => void }).init();
      (SCORM as never as { finish: (a: number, b: number, c: boolean | null, d: unknown[], e: unknown[]) => void })
        .finish(5, 10, passed, [], []);
      expect(calls.find(([key]) => key === "cmi.success_status")?.[1]).toBe(expected);
    }
  });
});
