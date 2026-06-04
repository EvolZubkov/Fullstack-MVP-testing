/**
 * @module tests/eligibility-plugins
 * @description Unit tests for the PRD-6 plugin pure logic
 * (shared/eligibility/plugins.ts): WebTutor record filtering / latest-attempt
 * selection, flexible date parsing, and the cooldown decisions.
 */
import { describe, it, expect } from "vitest";
import {
  parseFlexibleDate,
  selectLastAttemptDate,
  webtutorCooldownDecide,
  suspendDataCooldownDecide,
  extractCourseCompletionDate,
  extractSecid,
  type WebtutorAttemptFilter,
} from "../shared/eligibility/plugins";
import type { EligibilityContext } from "../shared/eligibility/types";

const ctx: EligibilityContext = {
  test: { id: "t1", title: "Курс" },
  retakePolicy: { cooldownPeriodDays: 30 },
  runtime: { todayDate: "2026-05-20" },
};

const filter: WebtutorAttemptFilter = {
  stateField: "state",
  stateIn: ["Завершен", "Завершён", "Пройден"],
  excludeStateIn: ["Не начат"],
  progressField: "progress",
  progressCompletePattern: "^100\\b",
  dateField: "last_usage_date",
  dateFormat: "dd.MM.yyyy",
};

describe("parseFlexibleDate", () => {
  it("parses dd.MM.yyyy to ISO", () => {
    expect(parseFlexibleDate("08.05.2026", "dd.MM.yyyy")).toBe("2026-05-08");
  });
  it("passes ISO through", () => {
    expect(parseFlexibleDate("2026-05-08", "dd.MM.yyyy")).toBe("2026-05-08");
  });
  it("returns null for unparseable input", () => {
    expect(parseFlexibleDate("", "dd.MM.yyyy")).toBeNull();
    expect(parseFlexibleDate("May 8", "dd.MM.yyyy")).toBeNull();
  });
});

describe("selectLastAttemptDate", () => {
  it("picks the latest record passing the filter", () => {
    const records = [
      { state: "Завершен", progress: "100%", last_usage_date: "01.05.2026" },
      { state: "Пройден", progress: "100 / 100", last_usage_date: "08.05.2026" },
      { state: "Не начат", progress: "0%", last_usage_date: "20.05.2026" }, // excluded
      { state: "В процессе", progress: "40%", last_usage_date: "19.05.2026" }, // not in stateIn
    ];
    expect(selectLastAttemptDate(records, filter)).toBe("2026-05-08");
  });
  it("rejects records failing the progress pattern", () => {
    const records = [{ state: "Завершен", progress: "80%", last_usage_date: "08.05.2026" }];
    expect(selectLastAttemptDate(records, filter)).toBeNull();
  });
  it("returns null for no matching records", () => {
    expect(selectLastAttemptDate([], filter)).toBeNull();
    expect(selectLastAttemptDate(null, filter)).toBeNull();
  });
});

describe("webtutorCooldownDecide", () => {
  it("blocks within cooldown and reports availableDate", () => {
    const records = [{ state: "Завершен", progress: "100%", last_usage_date: "08.05.2026" }];
    const r = webtutorCooldownDecide(records, filter, ctx);
    expect(r.source).toBe("webtutor_cooldown");
    expect(r.allowed).toBe(false); // 2026-05-20 - 2026-05-08 = 12 < 30
    expect(r.availableDate).toBe("2026-06-07");
    expect(r.reason).toBe("cooldown_active");
    expect(r.data?.lastAttemptDate).toBe("2026-05-08");
  });
  it("allows when no full attempt is found", () => {
    const r = webtutorCooldownDecide([], filter, ctx);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("no_prior_attempt");
    expect(r.availableDate).toBeNull();
  });
});

describe("ClientBridge parse (PRD-6 webtutor source — confirmed on live RT portal)", () => {
  const soap =
    '<result>&lt;Label Class="XAML-block-best_learn_step_success"&gt;Курс был пройден&lt;/Label&gt;' +
    '&lt;Button Class="XAML-block-best_learn_step"&gt;08.05.2026 &amp;rarr;&lt;/Button&gt;</result>';

  it("extracts the completion date after the «пройден» marker", () => {
    expect(extractCourseCompletionDate(soap)).toBe("2026-05-08");
  });

  it("returns null when there is no completion block (course not passed => allowed)", () => {
    expect(extractCourseCompletionDate("<result>&lt;SPXMLScreen&gt;&lt;/SPXMLScreen&gt;</result>")).toBeNull();
  });

  it("scrapes a 32-hex SECID from the course card", () => {
    expect(extractSecid('<div data-secid="90B9DA0B3BFE7DFB94CC23DACDEA27CD">x</div>')).toBe(
      "90B9DA0B3BFE7DFB94CC23DACDEA27CD",
    );
    expect(extractSecid("no token here")).toBeNull();
  });
});

describe("suspendDataCooldownDecide", () => {
  it("allows after the cooldown elapses", () => {
    const r = suspendDataCooldownDecide("2026-04-01", ctx); // 49 days >= 30
    expect(r.source).toBe("suspend_data_cooldown");
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("cooldown_passed");
  });
  it("blocks within the cooldown window", () => {
    const r = suspendDataCooldownDecide("2026-05-10", ctx); // 10 < 30
    expect(r.allowed).toBe(false);
    expect(r.availableDate).toBe("2026-06-09");
  });
});
