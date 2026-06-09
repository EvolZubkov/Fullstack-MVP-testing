/**
 * @module tests/result-context-parity
 *
 * Locks the SHARED results-context builder (PRD-12 §10): the single source of the
 * results shaping (passClass / statusLabel / ring offset / per-topic rows / adaptive
 * level labels). Proves (a) the base output (web) and the SCORM-opts output, and
 * (b) PARITY — the web adapter (server/services/result-context, from an AttemptResult)
 * and a direct shared call on the equivalent normalized input produce the identical
 * `result` core, so the two hosts cannot drift.
 */

import { describe, it, expect } from "vitest";
import {
  buildResultContext as sharedBuild,
  buildAdaptiveResultContext as sharedAdaptive,
} from "../shared/template/result-context";
import { buildResultContext as webBuild } from "../server/services/result-context";

const normalized = {
  passed: true,
  percent: 80,
  totalQuestions: 5,
  totalCorrect: 4,
  totalEarnedPoints: 4,
  totalPossiblePoints: 5,
  // shared input field names:
};

const sharedInput = {
  passed: true,
  percent: 80,
  totalQuestions: 5,
  correct: 4,
  earnedPoints: 4,
  possiblePoints: 5,
  topicResults: [
    { topicId: "t1", topicName: "Тема 1", correct: 4, total: 5, percent: 80, earnedPoints: 4, possiblePoints: 5, passed: true },
  ],
};

// The web's AttemptResult shape (overall*/total*) for the same data.
const attemptResult = {
  overallPassed: true,
  overallPercent: 80,
  totalQuestions: 5,
  totalCorrect: 4,
  totalEarnedPoints: 4,
  totalPossiblePoints: 5,
  topicResults: [
    { topicId: "t1", topicName: "Тема 1", correct: 4, total: 5, percent: 80, earnedPoints: 4, possiblePoints: 5, passed: true },
  ],
} as any;

describe("shared buildResultContext", () => {
  it("base output: Core-prepared fields, no SCORM extras", () => {
    const { result } = sharedBuild(sharedInput, "Тест");
    expect(result.passClass).toBe("is-pass");
    expect(result.statusLabel).toBe("Пройден");
    expect(result.scorePercent).toBe(80);
    expect(result.ringDashoffset).toBe(Math.round(2 * Math.PI * 63 * 0.2));
    const t0 = (result.topicResults as any[])[0];
    expect(t0.passClass).toBe("is-pass");
    expect(t0.statusLabel).toBe("Пройдено");
    expect(t0.pointsLabel).toBeUndefined(); // web omits the points row
    expect(result.recommendedCourses).toBeUndefined();
    expect(result.backAction).toBeUndefined();
  });

  it("SCORM opts: points row + recommendations + back action", () => {
    const { result } = sharedBuild(
      { ...sharedInput, topicResults: [{ ...sharedInput.topicResults[0], requiredLabel: "Требуется: 70%", topicFeedback: "ок" }] },
      "Тест",
      {
        withTopicPoints: true,
        recommendedCourses: [{ title: "Курс", url: "#" }],
        backAction: "back-to-start",
        backLabel: "Назад",
      },
    );
    const t0 = (result.topicResults as any[])[0];
    expect(t0.pointsLabel).toBe("4 / 5");
    expect(t0.requiredLabel).toBe("Требуется: 70%");
    expect(t0.topicFeedback).toBe("ок");
    expect(result.recommendedCourses?.length).toBe(1);
    expect(result.backAction).toBe("back-to-start");
  });
});

describe("host parity", () => {
  it("web adapter (AttemptResult) === shared base on equivalent input", () => {
    const web = webBuild(attemptResult, "Тест");
    const shared = sharedBuild(sharedInput, "Тест");
    expect(web).toEqual(shared);
  });
});

describe("shared buildAdaptiveResultContext", () => {
  const adaptiveInput = {
    passed: false,
    topicResults: [
      { topicName: "Сети", achievedLevelIndex: 1, achievedLevelName: "Средний", feedback: "ок", recommendedLinks: [{ title: "L", url: "#" }] },
      { topicName: "БД", achievedLevelIndex: null, achievedLevelName: null, feedback: "", recommendedLinks: [] },
    ],
  };

  it("base output: level views, no SCORM action flags", () => {
    const { result } = sharedAdaptive(adaptiveInput, "Адаптивный");
    expect(result.adaptive).toBe(true);
    const ts = result.topicResults as any[];
    expect(ts[0].levelLabel).toBe("Средний");
    expect(ts[0].levelClass).toBe("is-info");
    expect(ts[0].hasFeedback).toBe(true);
    expect(ts[0].hasLinks).toBe(true);
    expect(ts[1].levelLabel).toBe("Не достигнут");
    expect(ts[1].levelClass).toBe("is-fail");
    expect(result.hasScormActions).toBeUndefined();
  });

  it("SCORM opts: PDF/retry/finish action flags", () => {
    const { result } = sharedAdaptive(adaptiveInput, "Адаптивный", {
      hasScormActions: true,
      showPdf: true,
      canRetry: true,
      showFinish: false,
    });
    expect(result.hasScormActions).toBe(true);
    expect(result.showPdf).toBe(true);
    expect(result.canRetry).toBe(true);
    expect(result.showFinish).toBe(false);
  });
});

// `normalized` is the documentation anchor for the field-name mapping between hosts.
void normalized;
