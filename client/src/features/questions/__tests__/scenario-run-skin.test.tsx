/**
 * @module client/features/questions/__tests__/scenario-run-skin
 *
 * The web run of a «Сценарий в ИС» scenario wears the test's design template. In the SCORM package
 * the player sits in the package document next to the template stylesheet, so a template's
 * `.tbsim …` rules restyle it (the «Терминал» template does); on the web the template stylesheet
 * lives only inside the scene's shadow root, which is unmounted during a run. `ScenarioRun` with a
 * skin therefore mounts the player in its own shadow root carrying that stylesheet; without one —
 * the author's check in the question drawer — the player keeps its built-in look in the document.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Scenario } from "@shared/sim/contract";
import { ScenarioRun } from "../scenario/scenario-run";

const scenario = {
  format: "skillum.sim-scenario",
  version: 1,
  meta: { title: "Регистрация", task: "Зарегистрируйте письмо" },
  media: [{ id: "home", file: "/api/media/a1", w: 400, h: 200 }],
  fields: [],
  start: "home",
  scenes: [{ id: "home", elements: [{ id: "bg", media: "home", x: 0, y: 0 }], zones: [] }],
} as unknown as Scenario;

/** A template skin that restyles the player bar, the way the «Терминал» template does. */
const skin = {
  css: ":root{--background:0 0% 0%}\n.tbsim .tbsim__bar{border-bottom-color:#1f6b42}",
  cssVars: { "--primary": "140 100% 61%" },
  dataTheme: "dark" as const,
};

afterEach(() => {
  cleanup();
  document.getElementById("tbsim-css")?.remove();
});

describe("ScenarioRun и шаблон оформления", () => {
  it("со скином играет сценарий в shadow root рядом с таблицей стилей шаблона", () => {
    render(<ScenarioRun scenario={scenario} skin={skin} onClose={() => undefined} />);
    const host = screen.getByTestId("scenario-player");
    const shadow = host.shadowRoot;
    expect(shadow).not.toBeNull();
    const css = [...shadow!.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    expect(css).toContain(".tbsim .tbsim__bar{border-bottom-color:#1f6b42}");
    // The template's `:root` tokens are remapped onto the shadow host, exactly as for the scene.
    expect(css).toContain(":host{--background:0 0% 0%}");
    expect(shadow!.getElementById("tbsim-css")).not.toBeNull();
    expect(shadow!.querySelector(".tbsim")).not.toBeNull();
    expect(host.getAttribute("data-theme")).toBe("dark");
    expect(host.classList.contains("ou--dark")).toBe(true);
    expect(host.style.getPropertyValue("--primary")).toBe("140 100% 61%");
  });

  it("без скина играет сценарий в документе со встроенным видом плеера", () => {
    render(<ScenarioRun scenario={scenario} onClose={() => undefined} />);
    const host = screen.getByTestId("scenario-player");
    expect(host.shadowRoot).toBeNull();
    expect(host.querySelector(".tbsim")).not.toBeNull();
    expect(document.getElementById("tbsim-css")).not.toBeNull();
  });
});
