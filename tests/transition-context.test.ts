// @vitest-environment jsdom
/**
 * @module tests/transition-context
 *
 * Verifies the shared adaptive TRANSITION builder + layout (PRD-12 §10, plan 6.2):
 * this interstitial is a LEVEL CHANGE within the current topic — the title states the
 * level change, the eyebrow names the topic. It is NOT a per-answer verdict and NOT a
 * topic move (flat adaptive is a deferred future PRD).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildTransitionContext } from "../shared/template/transition-context";
import { renderScreenInto } from "../shared/template/render-screen";

const layout = fs.readFileSync(
  path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts", "system.transition.html"),
  "utf8",
);

function render(context: unknown): HTMLElement {
  const root = document.createElement("div");
  renderScreenInto(root, { layout, context });
  return root;
}

describe("buildTransitionContext", () => {
  it("titles the level change, names the topic, no per-answer verdict", () => {
    const { transition } = buildTransitionContext({
      topicName: "Базовые угрозы",
      levelTransition: { type: "up", message: "" },
      showContinue: true,
    });
    expect(transition.topicName).toBe("Базовые угрозы");
    expect(transition.title).toBe("Сложность повышена");
    expect(transition.title).not.toMatch(/Правильно|Неправильно/);
    expect(transition.level).toEqual({
      class: "is-up",
      isUp: true,
      isDown: false,
      isComplete: false,
      message: "Следующие вопросы будут сложнее",
    });
    expect(transition.showContinue).toBe(true);
    // No answer-verdict / topic-move fields.
    expect((transition as Record<string, unknown>).isCorrect).toBeUndefined();
    expect((transition as Record<string, unknown>).topic).toBeUndefined();
  });

  it("level down → «Сложность понижена», honours a host message", () => {
    const { transition } = buildTransitionContext({ topicName: "Сети", levelTransition: { type: "down", message: "Стало проще" } });
    expect(transition.title).toBe("Сложность понижена");
    expect(transition.level.class).toBe("is-down");
    expect(transition.level.isDown).toBe(true);
    expect(transition.level.message).toBe("Стало проще");
    expect(transition.showContinue).toBe(false);
  });

  it("complete level (any non up/down type) → «Уровень зафиксирован»", () => {
    const { transition } = buildTransitionContext({ topicName: "БД", levelTransition: { type: "complete" } });
    expect(transition.title).toBe("Уровень зафиксирован");
    expect(transition.level.class).toBe("is-complete");
    expect(transition.level.isComplete).toBe(true);
  });
});

describe("system.transition.html render", () => {
  it("renders the level icon, topic eyebrow, level-change title, message + continue", () => {
    const root = render(
      buildTransitionContext({ topicName: "Базовые угрозы", levelTransition: { type: "up", message: "Дальше сложнее" }, showContinue: true }),
    );
    expect(root.querySelector(".tb-transition-icon")?.className).toContain("is-up");
    expect(root.querySelector(".tb-eyebrow")?.textContent).toContain("Базовые угрозы");
    expect(root.querySelector(".tb-scene__hero")?.textContent).toBe("Сложность повышена");
    expect(root.querySelector(".tb-scene__lead")?.textContent).toBe("Дальше сложнее");
    expect(root.querySelector('[data-action="continue"]')).not.toBeNull();
    // No verdict / topic-move markup.
    expect(root.textContent).not.toMatch(/Правильно|Неправильно|Переход к теме/);
  });

  it("omits the continue action when the host auto-advances (web)", () => {
    const root = render(buildTransitionContext({ topicName: "Сети", levelTransition: { type: "down" } }));
    expect(root.querySelector(".tb-transition-icon")?.className).toContain("is-down");
    expect(root.querySelector('[data-action="continue"]')).toBeNull();
  });
});
