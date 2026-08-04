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
      // Clock rolled back behind the last attempt (untrusted "today").
      ["2026-05-20", "2026-05-01", 30],
      // Valid last attempt, unparseable "today".
      ["2026-05-08", "garbage", 30],
    ];
    for (const [last, today, days] of cases) {
      expect(port.EligibilityEngine.cooldownDecision(last, today, days)).toEqual(
        tsEngine.cooldownDecision(last, today, days),
      );
    }
  });

  it("daysUntilDate matches", () => {
    const cases: Array<[string | null, string | null | undefined]> = [
      ["2026-06-30", "2026-06-28"],
      ["2026-06-30", "2026-06-30"],
      ["2026-06-29", "2026-06-30"],
      [null, "2026-06-30"],
      ["garbage", "2026-06-30"],
      ["2026-06-30", "garbage"],
      // `effectiveToday` from cooldownDecision is null when access is open (the
      // dead-fallback removal in server/services/retake-gate.ts relies on this
      // being tolerated, not coerced).
      ["2026-06-30", null],
      // Same tolerance for `undefined` (an omitted argument), not just `null`.
      ["2026-06-30", undefined],
    ];
    for (const [iso, today] of cases) {
      expect(port.EligibilityEngine.daysUntilDate(iso, today)).toEqual(tsEngine.daysUntilDate(iso, today));
    }
  });

  it("attemptIntervalDecision matches", () => {
    const cases: Array<[string | null, string, number]> = [
      [null, "2026-08-01T10:00:00.000Z", 24],
      ["2026-08-01T10:00:00.000Z", "2026-08-02T09:59:59.999Z", 24],
      ["2026-08-01T10:00:00.000Z", "2026-08-02T10:00:00.000Z", 24],
      // Clock rolled back behind the last attempt (untrusted "now").
      ["2026-08-01T10:00:00.000Z", "2026-07-20T00:00:00.000Z", 24],
      ["garbage", "2026-08-01T10:00:00.000Z", 24],
      ["2026-08-01T10:00:00.000Z", "garbage", 24],
      ["2026-08-01T10:00:00.000Z", "2026-08-01T12:00:00.000Z", 1],
    ];
    for (const [last, now, hours] of cases) {
      expect(port.EligibilityEngine.attemptIntervalDecision(last, now, hours)).toEqual(
        tsEngine.attemptIntervalDecision(last, now, hours),
      );
    }
  });

  it("resolveCooldownDays matches", () => {
    const cases: Array<[Record<string, unknown>, boolean | null]> = [
      [{ cooldownPeriodDays: 30 }, true],
      [{ cooldownPeriodDays: 30 }, false],
      [{ cooldownPeriodDays: 30 }, null],
      [{ cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 }, true],
      [{ cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 }, false],
      // Unknown outcome -> the LARGER of the two (conservative default).
      [{ cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 }, null],
      [{ cooldownByOutcome: true, cooldownPeriodDaysPassed: 7, cooldownPeriodDaysFailed: 90 }, null],
      // Only one split value configured (should not happen past schema validation,
      // but the resolver must not throw): falls back to the one present.
      [{ cooldownByOutcome: true, cooldownPeriodDaysPassed: 90 }, null],
      [{ cooldownByOutcome: true, cooldownPeriodDaysFailed: 7 }, null],
      [{ cooldownByOutcome: true }, null],
    ];
    for (const [policy, passed] of cases) {
      expect(port.EligibilityEngine.resolveCooldownDays(policy, passed)).toEqual(
        tsEngine.resolveCooldownDays(policy as any, passed),
      );
    }
    // Concrete values, not just "both sides agree" (a both-undefined match proves nothing).
    expect(tsEngine.resolveCooldownDays({ cooldownPeriodDays: 30 }, true)).toBe(30);
    expect(
      tsEngine.resolveCooldownDays(
        { cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 },
        true,
      ),
    ).toBe(90);
    expect(
      tsEngine.resolveCooldownDays(
        { cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 },
        false,
      ),
    ).toBe(7);
    expect(
      tsEngine.resolveCooldownDays(
        { cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 },
        null,
      ),
    ).toBe(90);
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
    const c = { todayDate: "2026-05-20", cooldownPeriodDays: 30 };
    const results: any[] = [
      // `effectiveToday` is lifted out of `data` alongside `lastAttemptDate`...
      { allowed: false, availableDate: "2026-06-07", source: "webtutor_cooldown", reason: "cooldown_active", data: { lastAttemptDate: "2026-05-08", effectiveToday: "2026-05-20" } },
      // ...and stays null when the verdict carries no cooldown math (failPolicy).
      { allowed: true, source: "core_failpolicy", reason: "plugin_error_fail_open", data: { error: "boom" } },
      // An explicit null must not leak into the state either...
      { allowed: false, availableDate: "2026-06-07", data: { lastAttemptDate: "2026-05-08", effectiveToday: null } },
      // ...nor a value of the wrong TYPE: only `typeof === 'string'` is lifted, so a
      // numeric date (a hand-rolled plugin returning 20260530) is dropped, not stringified.
      { allowed: false, availableDate: "2026-06-07", data: { lastAttemptDate: 20260508, effectiveToday: 20260530 } },
    ];
    for (const result of results) {
      expect(port.EligibilityEngine.buildRetakeState(result, c)).toEqual(tsEngine.buildRetakeState(result, c));
    }
    // The field genuinely arrives (a both-null parity match would prove nothing).
    expect(tsEngine.buildRetakeState(results[0], c).effectiveToday).toBe("2026-05-20");
    expect(tsEngine.buildRetakeState(results[1], c).effectiveToday).toBeNull();
    // Both twins drop the non-string pair rather than carrying 20260530 through.
    for (const impl of [tsEngine.buildRetakeState, port.EligibilityEngine.buildRetakeState]) {
      expect(impl(results[3] as any, c)).toMatchObject({ lastAttemptDate: null, effectiveToday: null });
    }
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
    // The last entry is an attempt AFTER the reported "today" — an untrusted (rolled
    // back) clock — so `data.effectiveToday` differs from `data.todayDate` and the
    // parity check covers the clamp, not just the pass-through case.
    for (const d of ["2026-04-01", "2026-05-15", null, "2026-06-01"]) {
      expect(port.EligibilityPlugins.suspendDataCooldownDecide(d, ctx())).toEqual(
        tsPlugins.suspendDataCooldownDecide(d, ctx()),
      );
    }
    // The clamped value is the one the plugin reports (both twins, same assertion).
    for (const impl of [tsPlugins, port.EligibilityPlugins as typeof tsPlugins]) {
      expect(impl.suspendDataCooldownDecide("2026-06-01", ctx()).data).toMatchObject({
        todayDate: "2026-05-20",
        effectiveToday: "2026-06-01",
      });
      expect(impl.suspendDataCooldownDecide(null, ctx()).data).toMatchObject({ effectiveToday: null });
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
