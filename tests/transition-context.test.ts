// @vitest-environment jsdom
/**
 * @module tests/transition-context
 *
 * Verifies the shared adaptive TRANSITION builder + layout (PRD-12 §10): the
 * builder's Core-prepared icon/level classes and labels, and an e2e render of the
 * real `system.transition.html` against the built context (icon, title, level box
 * with type class, topic note, and the gated "Продолжить" action).
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
  it("correct + level up + topic + continue", () => {
    const { transition } = buildTransitionContext({
      isCorrect: true,
      levelTransition: { type: "up", message: "Уровень повышен" },
      topicTransition: { toTopic: "Сети" },
      showContinue: true,
    });
    expect(transition.iconClass).toBe("is-pass");
    expect(transition.title).toBe("Правильно!");
    expect(transition.level).toEqual({ class: "is-up", isUp: true, isDown: false, isComplete: false, message: "Уровень повышен" });
    expect(transition.topic).toEqual({ toTopic: "Сети" });
    expect(transition.showContinue).toBe(true);
  });

  it("incorrect + level down", () => {
    const { transition } = buildTransitionContext({ isCorrect: false, levelTransition: { type: "down", message: "Понижен" } });
    expect(transition.iconClass).toBe("is-fail");
    expect(transition.title).toBe("Неправильно");
    expect(transition.level!.class).toBe("is-down");
    expect(transition.level!.isDown).toBe(true);
    expect(transition.showContinue).toBe(false);
  });

  it("complete level (any non up/down type)", () => {
    const { transition } = buildTransitionContext({ isCorrect: true, levelTransition: { type: "complete", message: "Готово" } });
    expect(transition.level!.class).toBe("is-complete");
    expect(transition.level!.isComplete).toBe(true);
  });

  it("no level / no topic → omitted", () => {
    const { transition } = buildTransitionContext({ isCorrect: true });
    expect(transition.level).toBeUndefined();
    expect(transition.topic).toBeUndefined();
  });
});

describe("system.transition.html render", () => {
  it("renders icon class, title, level box + message, topic, continue button", () => {
    const root = render(
      buildTransitionContext({
        isCorrect: true,
        levelTransition: { type: "up", message: "Уровень повышен" },
        topicTransition: { toTopic: "Сети" },
        showContinue: true,
      }),
    );
    expect(root.querySelector(".transition-icon")?.className).toContain("is-pass");
    expect(root.querySelector(".transition-title")?.textContent).toBe("Правильно!");
    const level = root.querySelector(".transition-level");
    expect(level?.className).toContain("is-up");
    expect(level?.querySelector(".transition-level-msg")?.textContent).toBe("Уровень повышен");
    expect(root.querySelector(".transition-topic")?.textContent).toContain("Сети");
    expect(root.querySelector('[data-action="continue"]')).not.toBeNull();
  });

  it("omits level/topic/continue when absent (web auto-advance)", () => {
    const root = render(buildTransitionContext({ isCorrect: false }));
    expect(root.querySelector(".transition-icon")?.className).toContain("is-fail");
    expect(root.querySelector(".transition-level")).toBeNull();
    expect(root.querySelector(".transition-topic")).toBeNull();
    expect(root.querySelector('[data-action="continue"]')).toBeNull();
  });
});
