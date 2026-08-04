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
  extractCourseCompletionDate,
  extractSecid,
  type WebtutorAttemptFilter,
} from "../shared/eligibility/plugins";
import { findEligibilityConfig } from "../shared/eligibility/registry";
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

// REQUIREMENT GUARD (do not delete). The cooldown MUST fire after ANY completed
// attempt, passed OR failed — not only a passed one. This is asserted against the
// SHIPPED registry filter (not a local fixture), because the historical regression
// was exactly a shipped filter that only recognised a passed attempt: the runtime
// was switched from the learning-records collection to scraping the course card's
// "passed" marker, so a failed attempt left no date and the gate never engaged.
// If someone narrows the shipped `attemptFilter` back to passed-only (e.g. a
// pass-restrictive `stateIn`), THIS test fails — the behaviour cannot silently
// regress again.
describe("webtutor_cooldown REQUIREMENT: a FAILED completed attempt blocks the retake", () => {
  const shipped = findEligibilityConfig("webtutor_cooldown", "webtutor_catalog_default");
  const shippedFilter = (shipped?.config as { attemptFilter?: WebtutorAttemptFilter } | undefined)?.attemptFilter;

  it("ships a records-collection filter that counts BOTH outcomes (not passed-only)", () => {
    expect(shippedFilter).toBeDefined();
    expect(shippedFilter?.dateField).toBe("last_usage_date");
    // The requirement forbids pass-only: «Не пройден» (failed) must be counted too.
    // On the live RT grid the finished states are «Пройден» / «Не пройден».
    expect(shippedFilter?.stateIn).toContain("Не пройден");
    expect(shippedFilter?.stateIn).toContain("Пройден");
  });

  it("selects the date of a completed-but-FAILED attempt and blocks", () => {
    const failed = [{ name: "Курс", state: "Не пройден", progress: "0 из 100 баллов", last_usage_date: "08.05.2026" }];
    const r = webtutorCooldownDecide(failed, shippedFilter as WebtutorAttemptFilter, ctx, "Курс");
    expect(r.data?.lastAttemptDate).toBe("2026-05-08"); // the failed date WAS selected
    expect(r.allowed).toBe(false); // 2026-05-20 - 2026-05-08 = 12 < 30 -> blocked
    expect(r.reason).toBe("cooldown_active");
  });

  it("treats all ASSIGNMENTS of one course (same name, different object_id) as one course", () => {
    // Three assignments of «Курс»; latest finished date must win regardless of object_id.
    const recs = [
      { name: "Курс", object_id: "1", state: "Пройден", last_usage_date: "01.05.2026" },
      { name: "Курс", object_id: "2", state: "Не пройден", last_usage_date: "18.05.2026" },
      { name: "Другой курс", object_id: "3", state: "Пройден", last_usage_date: "19.05.2026" }, // different course
    ];
    const r = webtutorCooldownDecide(recs, shippedFilter as WebtutorAttemptFilter, ctx, "Курс");
    expect(r.data?.lastAttemptDate).toBe("2026-05-18"); // latest assignment of «Курс», not the other course
    expect(r.allowed).toBe(false);
  });

  it("ignores an open-ended assignment never taken (sentinel date «31.12.9999»)", () => {
    const recs = [{ name: "Курс", state: "Не пройден", last_usage_date: "31.12.9999" }];
    const r = webtutorCooldownDecide(recs, shippedFilter as WebtutorAttemptFilter, ctx, "Курс");
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("no_prior_attempt");
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
