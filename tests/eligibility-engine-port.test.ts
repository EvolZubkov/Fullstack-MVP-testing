/**
 * @module tests/eligibility-engine-port
 *
 * Golden parity for the PRD-6 retake gate. The SCORM package runs a hand-written
 * plain-JS port (server/scorm/template/app/eligibility/engine.js + plugins.js) of
 * the authoritative TypeScript (shared/eligibility/engine.ts + plugins.ts). Both
 * are exercised over shared scenarios so they can never silently diverge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as tsEngine from "../shared/eligibility/engine";
import * as tsPlugins from "../shared/eligibility/plugins";
import type { EligibilityContext } from "../shared/eligibility/types";

const root = process.cwd();
const engineSrc = readFileSync(resolve(root, "server/scorm/template/app/eligibility/engine.js"), "utf8");
const pluginsSrc = readFileSync(resolve(root, "server/scorm/template/app/eligibility/plugins.js"), "utf8");
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const port = new Function(
  `${engineSrc}\n${pluginsSrc}\n;return { EligibilityEngine: EligibilityEngine, EligibilityPlugins: EligibilityPlugins };`,
)() as { EligibilityEngine: any; EligibilityPlugins: any };

const ctx = (days = 30, today = "2026-05-20"): EligibilityContext => ({
  test: { id: "t", title: "T" },
  retakePolicy: { cooldownPeriodDays: days },
  runtime: { todayDate: today },
});

const filter = {
  stateField: "state",
  stateIn: ["Завершен", "Пройден"],
  excludeStateIn: ["Не начат"],
  progressField: "progress",
  progressCompletePattern: "^100\\b",
  dateField: "last_usage_date",
  dateFormat: "dd.MM.yyyy",
};

describe("eligibility engine — TS ↔ JS port parity", () => {
  it("cooldownDecision matches across scenarios", () => {
    const cases: Array<[string | null, string, number]> = [
      [null, "2026-05-20", 30],
      ["2026-05-08", "2026-05-08", 30],
      ["2026-05-08", "2026-06-07", 30],
      ["2026-05-08", "2026-06-08", 30],
      ["2026-02-28", "2026-03-30", 30],
      ["bad", "2026-05-20", 30],
    ];
    for (const [last, today, days] of cases) {
      expect(port.EligibilityEngine.cooldownDecision(last, today, days)).toEqual(
        tsEngine.cooldownDecision(last, today, days),
      );
    }
  });

  it("cooldownDecision matches when the clock is rolled back", () => {
    const cases: Array<[string | null, string, number]> = [
      ["2026-05-20", "2026-05-01", 30],
      ["2026-05-20", "2026-05-20", 30],
    ];
    for (const [last, today, days] of cases) {
      expect(port.EligibilityEngine.cooldownDecision(last, today, days)).toEqual(
        tsEngine.cooldownDecision(last, today, days),
      );
    }
  });

  it("daysUntilDate matches", () => {
    const cases: Array<[string | null, string]> = [
      ["2026-06-30", "2026-06-28"],
      ["2026-06-30", "2026-06-30"],
      ["2026-06-29", "2026-06-30"],
      [null, "2026-06-30"],
      ["garbage", "2026-06-30"],
    ];
    for (const [iso, today] of cases) {
      expect(port.EligibilityEngine.daysUntilDate(iso, today)).toEqual(tsEngine.daysUntilDate(iso, today));
    }
  });

  it("normalizeVerdict matches", () => {
    const verdicts: any[] = [
      true,
      false,
      { allowed: false, availableDate: "2026-06-07", source: "p" },
      { allowed: false, data: { nextAllowedDate: "2026-06-07" } },
      { allowed: true, reason: "ok" },
    ];
    for (const v of verdicts) {
      expect(port.EligibilityEngine.normalizeVerdict(v)).toEqual(tsEngine.normalizeVerdict(v));
    }
  });

  it("applyFailPolicy matches", () => {
    for (const fp of ["failOpen", "failClosed", undefined] as const) {
      expect(port.EligibilityEngine.applyFailPolicy(fp, "boom")).toEqual(tsEngine.applyFailPolicy(fp, "boom"));
    }
  });

  it("buildRetakeState matches", () => {
    const result = { allowed: false, availableDate: "2026-06-07", source: "webtutor_cooldown", reason: "cooldown_active", data: { lastAttemptDate: "2026-05-08" } };
    const c = { todayDate: "2026-05-20", cooldownPeriodDays: 30 };
    expect(port.EligibilityEngine.buildRetakeState(result, c)).toEqual(tsEngine.buildRetakeState(result, c));
  });

  it("parseFlexibleDate matches", () => {
    for (const v of ["08.05.2026", "2026-05-08", "", "May 8", "1.2.2026"]) {
      expect(port.EligibilityPlugins.parseFlexibleDate(v, "dd.MM.yyyy")).toEqual(
        tsPlugins.parseFlexibleDate(v, "dd.MM.yyyy"),
      );
    }
  });

  it("selectLastAttemptDate + webtutorCooldownDecide match", () => {
    const records = [
      { state: "Завершен", progress: "100%", last_usage_date: "01.05.2026" },
      { state: "Пройден", progress: "100 / 100", last_usage_date: "08.05.2026" },
      { state: "Не начат", progress: "0%", last_usage_date: "20.05.2026" },
      { state: "В процессе", progress: "40%", last_usage_date: "19.05.2026" },
    ];
    expect(port.EligibilityPlugins.selectLastAttemptDate(records, filter)).toEqual(
      tsPlugins.selectLastAttemptDate(records, filter),
    );
    expect(port.EligibilityPlugins.webtutorCooldownDecide(records, filter, ctx())).toEqual(
      tsPlugins.webtutorCooldownDecide(records, filter, ctx()),
    );
  });

  it("suspendDataCooldownDecide matches", () => {
    for (const d of ["2026-04-01", "2026-05-15", null]) {
      expect(port.EligibilityPlugins.suspendDataCooldownDecide(d, ctx())).toEqual(
        tsPlugins.suspendDataCooldownDecide(d, ctx()),
      );
    }
  });

  it("ClientBridge parse (extractCourseCompletionDate / extractSecid / unescapeXml) matches", () => {
    const soap =
      '<result>&lt;Label Class="XAML-block-best_learn_step_success"&gt;Курс был пройден&lt;/Label&gt;' +
      '&lt;Button&gt;08.05.2026 &amp;rarr;&lt;/Button&gt;</result>';
    expect(port.EligibilityPlugins.extractCourseCompletionDate(soap, {})).toEqual(
      tsPlugins.extractCourseCompletionDate(soap, {}),
    );
    expect(port.EligibilityPlugins.extractCourseCompletionDate("<result>nope</result>", {})).toEqual(
      tsPlugins.extractCourseCompletionDate("<result>nope</result>", {}),
    );
    const card = 'x 90B9DA0B3BFE7DFB94CC23DACDEA27CD y';
    expect(port.EligibilityPlugins.extractSecid(card)).toEqual(tsPlugins.extractSecid(card));
    expect(port.EligibilityPlugins.unescapeXml("&lt;a&gt;&amp;&#10;b")).toEqual(
      tsPlugins.unescapeXml("&lt;a&gt;&amp;&#10;b"),
    );
  });
});
