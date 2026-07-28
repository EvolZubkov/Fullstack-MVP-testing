/**
 * @module tests/shared.router-hub
 *
 * The hub's rules and markup. Both hosts read these, so a disagreement here is a
 * section a learner can open in the LMS and cannot open on the web (or vice
 * versa) — which is why they live in one module.
 */
import { describe, it, expect } from "vitest";
import {
  buildRouterHubHtml,
  isRouterReadyToFinish,
  isSectionUnlocked,
  pluralQuestions,
  statusLabel,
  type RouterHubState,
  type RouterSection,
} from "../shared/flow/router-hub";

const SECTIONS: RouterSection[] = [
  { topicId: "t1", topicName: "О компании", drawCount: 16 },
  { topicId: "t2", topicName: "Финансы", drawCount: 10 },
];

const base = (over: Partial<RouterHubState> = {}): RouterHubState => ({
  topicStates: {},
  sectionResults: {},
  unlockRules: {},
  completionPolicy: null,
  ...over,
});

describe("router-hub — section unlock", () => {
  it("opens a section with no rule", () => {
    expect(isSectionUnlocked(SECTIONS[1], base())).toBe(true);
  });

  it("gates after_sections_completed on the listed sections", () => {
    const state = base({ unlockRules: { t2: { mode: "after_sections_completed", sectionIds: ["t1"] } } });
    expect(isSectionUnlocked(SECTIONS[1], state)).toBe(false);
    expect(isSectionUnlocked(SECTIONS[1], { ...state, topicStates: { t1: "completed" } })).toBe(true);
  });

  it("gates after_sections_passed on the result, treating a null pass as passed", () => {
    const rules = { t2: { mode: "after_sections_passed", sectionIds: ["t1"] } };
    const done = { t1: "completed" as const };
    expect(isSectionUnlocked(SECTIONS[1], base({ unlockRules: rules, topicStates: done, sectionResults: { t1: { passed: false } } }))).toBe(false);
    expect(isSectionUnlocked(SECTIONS[1], base({ unlockRules: rules, topicStates: done, sectionResults: { t1: { passed: true } } }))).toBe(true);
    // No pass rule on the section ⇒ it cannot be failed, so it must not block.
    expect(isSectionUnlocked(SECTIONS[1], base({ unlockRules: rules, topicStates: done, sectionResults: { t1: { passed: null } } }))).toBe(true);
  });

  // A rule this build does not understand must not lock a learner out of content
  // they are entitled to take.
  it("fails open on an unknown rule mode", () => {
    expect(isSectionUnlocked(SECTIONS[1], base({ unlockRules: { t2: { mode: "from_the_future" } } }))).toBe(true);
  });
});

describe("router-hub — completion policy", () => {
  it("requires every required section completed by default", () => {
    expect(isRouterReadyToFinish(SECTIONS, base({ topicStates: { t1: "completed" } }))).toBe(false);
    expect(isRouterReadyToFinish(SECTIONS, base({ topicStates: { t1: "completed", t2: "completed" } }))).toBe(true);
  });

  it("ignores optional sections", () => {
    const sections = [SECTIONS[0], { ...SECTIONS[1], required: false }];
    expect(isRouterReadyToFinish(sections, base({ topicStates: { t1: "completed" } }))).toBe(true);
  });

  it("allows finishing at any time when nothing is required", () => {
    expect(isRouterReadyToFinish(SECTIONS.map((s) => ({ ...s, required: false })), base())).toBe(true);
  });

  it("under all_required_passed, a missing or unpassed result blocks", () => {
    const done = { t1: "completed" as const, t2: "completed" as const };
    const state = (results: RouterHubState["sectionResults"]) =>
      base({ topicStates: done, sectionResults: results, completionPolicy: "all_required_passed" });
    expect(isRouterReadyToFinish(SECTIONS, state({ t1: { passed: true } }))).toBe(false); // t2 has no result
    expect(isRouterReadyToFinish(SECTIONS, state({ t1: { passed: true }, t2: { passed: null } }))).toBe(false);
    expect(isRouterReadyToFinish(SECTIONS, state({ t1: { passed: true }, t2: { passed: true } }))).toBe(true);
  });
});

describe("router-hub — markup", () => {
  it("emits one selectable card per section with its state", () => {
    const html = buildRouterHubHtml(SECTIONS, base({ topicStates: { t1: "completed" } }));
    expect(html).toContain('data-action="router-select:t2"');
    expect(html).toContain("О компании");
    expect(html).toContain("16 вопросов");
    // A completed card is disabled and carries no action — no re-entry.
    expect(html).toContain('data-router-status="completed"');
    expect(html).not.toContain('data-action="router-select:t1"');
  });

  it("marks a locked card and withholds its action", () => {
    const html = buildRouterHubHtml(
      SECTIONS,
      base({ unlockRules: { t2: { mode: "after_sections_completed", sectionIds: ["t1"] } } }),
    );
    expect(html).toContain("router-topic-card--locked");
    expect(html).toContain("Недоступна");
    expect(html).not.toContain('data-action="router-select:t2"');
  });

  it("counts only required sections in the progress bar", () => {
    const sections = [SECTIONS[0], { ...SECTIONS[1], required: false }];
    const html = buildRouterHubHtml(sections, base({ topicStates: { t1: "completed" } }));
    expect(html).toContain("1 / 1");
    expect(html).toContain("(необязательная)");
  });

  it("does not emit its own «Завершить» — it lives in the standard footer", () => {
    // The finish action is the layout's footer nav button (gated by page.nextDisabled),
    // not part of the hub body. The body must never carry a duplicate button.
    expect(buildRouterHubHtml(SECTIONS, base())).not.toContain("router-finish");
    const ready = buildRouterHubHtml(SECTIONS, base({ topicStates: { t1: "completed", t2: "completed" } }));
    expect(ready).not.toContain("router-finish");
    expect(ready).not.toContain(">Завершить<");
  });

  it("renders the deadline block only when a deadline exists", () => {
    expect(buildRouterHubHtml(SECTIONS, base())).not.toContain("router-stats");
    expect(buildRouterHubHtml(SECTIONS, base(), { deadline: { date: "31.12.2026" } })).toContain("31.12.2026");
  });

  it("escapes section names rather than letting them inject markup", () => {
    const html = buildRouterHubHtml([{ topicId: "x", topicName: '<img src=x onerror="alert(1)">' }], base());
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("router-hub — labels", () => {
  it("pluralises «вопрос» correctly", () => {
    expect(pluralQuestions(1)).toBe("вопрос");
    expect(pluralQuestions(3)).toBe("вопроса");
    expect(pluralQuestions(11)).toBe("вопросов");
    expect(pluralQuestions(21)).toBe("вопрос");
  });

  it("labels each status", () => {
    expect(statusLabel("notStarted")).toBe("Не начата");
    expect(statusLabel("inProgress")).toBe("В процессе");
    expect(statusLabel("completed")).toBe("Пройдена");
  });
});
