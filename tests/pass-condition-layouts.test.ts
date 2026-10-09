/**
 * @module tests/pass-condition-layouts
 * @description Every shipped template prints the pass condition the shared builders
 * prepare: the cover tile «8 из 8 / обязательных тем для прохождения» and, on the section
 * intro, the threshold line, the «Обязательная тема» mark and the timer warning banner.
 * A layout that forgets a field is caught here for all three templates at once, and a
 * context without the fields must render the screens exactly as before.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildStartState } from "../shared/template/start-state";
import { buildSectionIntroContext, type SectionIntroInput } from "../shared/template/result-context";
import { renderScreenInto } from "../shared/template/render-screen";
import { TEMPLATE_IDS, templateFile } from "./helpers/template-roots";

const COVERS = TEMPLATE_IDS.flatMap((id) => [
  templateFile(id, "layouts/start.html"),
  templateFile(id, "layouts/start.image-right.html"),
]);
const INTROS = TEMPLATE_IDS.map((id) => templateFile(id, "layouts/section-intro.html"));

const SECTIONS = [
  { required: true, topicPassRule: { source: "custom", type: "absolute", value: 7 } },
  { required: true, topicPassRule: { source: "custom", type: "absolute", value: 5 } },
];

/** Renders a cover under a «Тест пройден, если» policy and returns the root. */
function renderCover(layoutPath: string, passDecisionPolicy: string | null): HTMLElement {
  const { course, state } = buildStartState({
    info: {
      title: "Сертификация",
      questionCount: 64,
      passPercent: 80,
      passDecisionPolicy,
      overallPassRule: { type: "percent", value: 80 },
      sections: SECTIONS,
    },
    maxAttempts: 1,
    completedAttempts: 0,
    hasCompletedResults: false,
    canStartNew: true,
  });
  const root = document.createElement("div");
  renderScreenInto(root, { layout: readFileSync(layoutPath, "utf8"), context: { course, state, design: {} } });
  return root;
}

/** Renders a section intro from builder input and returns the root. */
function renderIntro(layoutPath: string, extra: Partial<SectionIntroInput>): HTMLElement {
  const built = buildSectionIntroContext({ sectionNumber: 2, sectionsTotal: 8, topicName: "Финансы", questionCount: 10, ...extra });
  const root = document.createElement("div");
  renderScreenInto(root, {
    layout: readFileSync(layoutPath, "utf8"),
    context: { course: built.course, sectionIntro: built.sectionIntro, design: {}, page: {} },
    slots: { instruction: "" },
  });
  return root;
}

describe.each(COVERS)("cover %s", (layoutPath) => {
  it("topics decide: the topic tile, no overall percent", () => {
    const text = renderCover(layoutPath, "required_topics_only").textContent ?? "";
    expect(text).toContain("2 из 2");
    expect(text).toContain("обязательных тем для прохождения");
    expect(text).not.toContain("проходной балл");
  });

  it("the overall result decides: the percent tile, no topic tile", () => {
    const text = renderCover(layoutPath, "overall_only").textContent ?? "";
    expect(text).toContain("проходной балл");
    expect(text).not.toContain("тем для прохождения");
  });
});

describe.each(INTROS)("section intro %s", (layoutPath) => {
  it("prints the threshold, the mark and the timer warning", () => {
    const root = renderIntro(layoutPath, {
      timeLimitMinutes: 17,
      passRule: { type: "count", value: 7 },
      possiblePoints: 10,
      required: true,
      passDecisionPolicy: "required_topics_only",
    });
    const text = root.textContent ?? "";
    expect(text).toContain("Для прохождения: 7 баллов из 10");
    expect(text).toContain("Обязательная тема");
    const banner = root.querySelector(".ou-banner--warning");
    expect(banner?.textContent).toContain("начнётся отсчёт времени раздела — 17 мин");
  });

  it("without the facts the intro is as before", () => {
    const root = renderIntro(layoutPath, {});
    const text = root.textContent ?? "";
    expect(text).not.toContain("Для прохождения");
    expect(text).not.toContain("Обязательная тема");
    expect(root.querySelector(".ou-banner--warning")).toBeNull();
  });
});
