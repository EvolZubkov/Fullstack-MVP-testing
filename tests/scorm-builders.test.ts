/**
 * Tests for SCORM builder utilities:
 * - scorm/utils/escape.ts
 * - scorm/builders/metadata.ts
 * - scorm/builders/test-json.ts
 * - scorm/builders/manifest.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// escape.ts — чистая функция, без моков
// ─────────────────────────────────────────────────────────────────────────────
import { escapeXml } from "../server/scorm/utils/escape";

describe("escapeXml", () => {
  it("escapes ampersand", () => {
    expect(escapeXml("A & B")).toBe("A &amp; B");
  });

  it("escapes less-than and greater-than", () => {
    expect(escapeXml("<tag>")).toBe("&lt;tag&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeXml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeXml("it's")).toBe("it&apos;s");
  });

  it("escapes all special chars together", () => {
    expect(escapeXml(`<a href="x&y">it's</a>`))
      .toBe("&lt;a href=&quot;x&amp;y&quot;&gt;it&apos;s&lt;/a&gt;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeXml("Hello World 123")).toBe("Hello World 123");
  });

  it("handles empty string", () => {
    expect(escapeXml("")).toBe("");
  });

  it("handles null/undefined gracefully (coerced via String)", () => {
    expect(escapeXml(null as any)).toBe("");
    expect(escapeXml(undefined as any)).toBe("");
  });

  it("handles string with only special chars", () => {
    expect(escapeXml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// metadata.ts — шаблон XML, без моков
// ─────────────────────────────────────────────────────────────────────────────
import { buildMetadataXml } from "../server/scorm/builders/metadata";

const baseTest: any = {
  id: "test-123",
  title: "JavaScript Basics",
  description: "A test about JS",
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  createdAt: new Date(),
};

describe("buildMetadataXml", () => {
  it("returns valid XML string", () => {
    const xml = buildMetadataXml(baseTest);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<lom");
    expect(xml).toContain("</lom>");
  });

  it("includes test id in entry element", () => {
    const xml = buildMetadataXml(baseTest);
    expect(xml).toContain("<entry>test-123</entry>");
  });

  it("includes test title escaped", () => {
    const xml = buildMetadataXml(baseTest);
    expect(xml).toContain("JavaScript Basics");
  });

  it("includes description", () => {
    const xml = buildMetadataXml(baseTest);
    expect(xml).toContain("A test about JS");
  });

  it("uses fallback description when description is null", () => {
    const xml = buildMetadataXml({ ...baseTest, description: null });
    expect(xml).toContain("Assessment test");
  });

  it("escapes special chars in title", () => {
    const xml = buildMetadataXml({ ...baseTest, title: "Test <A> & B" });
    expect(xml).toContain("Test &lt;A&gt; &amp; B");
    expect(xml).not.toContain("Test <A>");
  });

  it("escapes special chars in description", () => {
    const xml = buildMetadataXml({ ...baseTest, description: 'Say "hello"' });
    expect(xml).toContain("&quot;hello&quot;");
  });

  it("contains LOM educational metadata", () => {
    const xml = buildMetadataXml(baseTest);
    expect(xml).toContain("<interactivityType>");
    expect(xml).toContain("<learningResourceType>");
    expect(xml).toContain("active");
    expect(xml).toContain("exercise");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// test-json.ts — buildTestJson, без моков (чистая функция)
// ─────────────────────────────────────────────────────────────────────────────
import { buildTestJson } from "../server/scorm/builders/test-json";

const dbQuestion: any = {
  id: "q1", topicId: "t1", type: "single", prompt: "What is JS?",
  dataJson: { options: ["A language", "A food"] },
  correctJson: { correctIndex: 0 },
  points: 5, difficulty: 60, shuffleAnswers: true,
  mediaUrl: null, mediaType: null,
  feedback: null, feedbackMode: "general",
  feedbackCorrect: null, feedbackIncorrect: null,
};

const dbTopic: any = { id: "t1", name: "JavaScript", feedback: null };

const dbSection: any = {
  id: "s1", testId: "test-123", topicId: "t1",
  topic: dbTopic,
  questions: [dbQuestion],
  courses: [{ title: "JS Course", url: "https://example.com/js" }],
  events: [{ id: "ev1", topicId: "t1", title: "Мастер-класс по JS" }],
  drawCount: 1,
  topicPassRuleJson: { type: "percent", value: 60 },
};

const exportData: any = {
  test: { ...baseTest, webhookUrl: null, feedback: null, timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, startPageContent: null, showDifficultyLevel: true },
  sections: [dbSection],
};

describe("buildTestJson — standard mode", () => {
  it("returns valid JSON string", () => {
    const json = buildTestJson(exportData);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("includes test id, title, mode", () => {
    const data = JSON.parse(buildTestJson(exportData));
    expect(data.id).toBe("test-123");
    expect(data.title).toBe("JavaScript Basics");
    expect(data.mode).toBe("standard");
  });

  it("calculates passPercent from overallPassRule percent type", () => {
    const data = JSON.parse(buildTestJson(exportData));
    expect(data.passPercent).toBe(70);
  });

  it("calculates passPercent from overallPassRule count type", () => {
    const countTest = {
      ...exportData,
      test: { ...exportData.test, overallPassRuleJson: { type: "count", value: 1 } },
    };
    const data = JSON.parse(buildTestJson(countTest));
    expect(data.passPercent).toBe(100); // 1/1 * 100
  });

  it("includes totalQuestions as sum of section drawCounts", () => {
    const data = JSON.parse(buildTestJson(exportData));
    expect(data.totalQuestions).toBe(1);
  });

  it("includes sections with topic info, questions, courses and events", () => {
    const data = JSON.parse(buildTestJson(exportData));
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0].topicId).toBe("t1");
    expect(data.sections[0].topicName).toBe("JavaScript");
    expect(data.sections[0].questions).toHaveLength(1);
    expect(data.sections[0].recommendedCourses).toHaveLength(1);
    expect(data.sections[0].recommendedCourses[0].url).toBe("https://example.com/js");
    expect(data.sections[0].recommendedEvents).toHaveLength(1);
    expect(data.sections[0].recommendedEvents[0].title).toBe("Мастер-класс по JS");
  });

  it("recommendedEvents has no url field", () => {
    const data = JSON.parse(buildTestJson(exportData));
    const ev = data.sections[0].recommendedEvents[0];
    expect(ev.title).toBe("Мастер-класс по JS");
    expect(ev.url).toBeUndefined();
  });

  it("recommendedEvents is empty array when no events", () => {
    const noEventsData = {
      ...exportData,
      sections: [{ ...dbSection, events: [] }],
    };
    const data = JSON.parse(buildTestJson(noEventsData));
    expect(data.sections[0].recommendedEvents).toEqual([]);
  });

  it("maps question fields correctly", () => {
    const data = JSON.parse(buildTestJson(exportData));
    const q = data.sections[0].questions[0];
    expect(q.id).toBe("q1");
    expect(q.type).toBe("single");
    expect(q.points).toBe(5);
    expect(q.difficulty).toBe(60);
    expect(q.data.options).toHaveLength(2);
    expect(q.correct.correctIndex).toBe(0);
  });

  it("does not include adaptiveTopics for standard mode", () => {
    const data = JSON.parse(buildTestJson(exportData));
    expect(data.adaptiveTopics).toBeUndefined();
  });

  it("includes timeLimitMinutes when set", () => {
    const d = { ...exportData, test: { ...exportData.test, timeLimitMinutes: 30 } };
    const data = JSON.parse(buildTestJson(d));
    expect(data.timeLimitMinutes).toBe(30);
  });

  it("includes showCorrectAnswers flag", () => {
    const d = { ...exportData, test: { ...exportData.test, showCorrectAnswers: true } };
    const data = JSON.parse(buildTestJson(d));
    expect(data.showCorrectAnswers).toBe(true);
  });

  it("includes telemetry config when enabled", () => {
    const d = {
      ...exportData,
      telemetry: { enabled: true, packageId: "pkg1", secretKey: "secret", apiBaseUrl: "https://api.test.com" },
    };
    const data = JSON.parse(buildTestJson(d));
    expect(data.telemetry).toBeDefined();
    expect(data.telemetry.packageId).toBe("pkg1");
    expect(data.telemetry.secretKey).toBe("secret");
  });

  it("omits telemetry when disabled", () => {
    const d = {
      ...exportData,
      telemetry: { enabled: false, packageId: "pkg1", secretKey: "secret", apiBaseUrl: "" },
    };
    const data = JSON.parse(buildTestJson(d));
    expect(data.telemetry).toBeUndefined();
  });

  it("omits telemetry when not provided", () => {
    const data = JSON.parse(buildTestJson(exportData));
    expect(data.telemetry).toBeUndefined();
  });
});

describe("buildTestJson — adaptive mode", () => {
  const adaptiveLevel: any = {
    id: "lv1", topicId: "t1", levelIndex: 0, levelName: "Beginner",
    minDifficulty: 0, maxDifficulty: 40, questionsCount: 3,
    passThreshold: 2, passThresholdType: "count",
    feedback: "Good start!", links: [{ title: "Link", url: "https://x.com" }],
  };

  const adaptiveData: any = {
    test: { ...exportData.test, mode: "adaptive" },
    sections: [dbSection],
    adaptiveSettings: {
      topicSettings: [{ topicId: "t1", failureFeedback: "Study more!" }],
      levels: [adaptiveLevel],
    },
  };

  it("includes adaptiveTopics for adaptive mode", () => {
    const data = JSON.parse(buildTestJson(adaptiveData));
    expect(data.adaptiveTopics).toBeDefined();
    expect(data.adaptiveTopics).toHaveLength(1);
  });

  it("maps adaptive topic fields correctly", () => {
    const data = JSON.parse(buildTestJson(adaptiveData));
    const topic = data.adaptiveTopics[0];
    expect(topic.topicId).toBe("t1");
    expect(topic.topicName).toBe("JavaScript");
    expect(topic.failureFeedback).toBe("Study more!");
  });

  it("includes levels sorted by levelIndex", () => {
    const multiLevel: any = {
      ...adaptiveData,
      adaptiveSettings: {
        topicSettings: [{ topicId: "t1", failureFeedback: null }],
        levels: [
          { ...adaptiveLevel, levelIndex: 2, levelName: "Advanced", links: [] },
          { ...adaptiveLevel, levelIndex: 0, levelName: "Beginner", links: [] },
          { ...adaptiveLevel, levelIndex: 1, levelName: "Intermediate", links: [] },
        ],
      },
    };
    const data = JSON.parse(buildTestJson(multiLevel));
    const levels = data.adaptiveTopics[0].levels;
    expect(levels[0].levelIndex).toBe(0);
    expect(levels[1].levelIndex).toBe(1);
    expect(levels[2].levelIndex).toBe(2);
  });

  it("includes level links", () => {
    const data = JSON.parse(buildTestJson(adaptiveData));
    const level = data.adaptiveTopics[0].levels[0];
    expect(level.links).toHaveLength(1);
    expect(level.links[0].url).toBe("https://x.com");
  });

  it("includes all questions in adaptive topic", () => {
    const data = JSON.parse(buildTestJson(adaptiveData));
    expect(data.adaptiveTopics[0].questions).toHaveLength(1);
    expect(data.adaptiveTopics[0].questions[0].id).toBe("q1");
  });

  it("skips adaptiveTopics when adaptiveSettings is null", () => {
    const d = { ...adaptiveData, adaptiveSettings: null };
    const data = JSON.parse(buildTestJson(d));
    expect(data.adaptiveTopics).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// manifest.ts — мокируем fs чтобы не писать реальные файлы
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue("{}"),
    writeFileSync: vi.fn(),
  };
});

import { buildManifest } from "../server/scorm/builders/manifest";
import * as fsMock from "fs";

const manifestTest: any = {
  id: "test-abc", title: "JS Test",
  description: "JS stuff",
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 75 },
  createdAt: new Date(),
};

const manifestSection: any = {
  ...dbSection,
  drawCount: 5,
  topicPassRuleJson: { type: "percent", value: 60 },
};

const manifestData: any = {
  test: manifestTest,
  sections: [manifestSection],
};

describe("buildManifest", () => {
  beforeEach(() => {
    vi.mocked(fsMock.existsSync).mockReturnValue(false);
    vi.mocked(fsMock.readFileSync).mockReturnValue("{}");
    vi.mocked(fsMock.writeFileSync).mockImplementation(() => {});
    vi.mocked(fsMock.mkdirSync).mockImplementation(() => undefined);
  });

  it("returns XML string with manifest root element", () => {
    const xml = buildManifest(manifestTest, manifestData);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<manifest");
    expect(xml).toContain("</manifest>");
  });

  it("includes test title escaped", () => {
    const xml = buildManifest(manifestTest, manifestData);
    expect(xml).toContain("JS Test");
  });

  it("escapes special chars in title", () => {
    const specialTest = { ...manifestTest, title: "Test <Ops> & More" };
    const xml = buildManifest(specialTest, { test: specialTest, sections: [manifestSection] });
    expect(xml).toContain("Test &lt;Ops&gt; &amp; More");
  });

  it("includes overall pass threshold for percent rule", () => {
    const xml = buildManifest(manifestTest, manifestData);
    // 75% → 0.75
    expect(xml).toContain("<imsss:minNormalizedMeasure>0.75</imsss:minNormalizedMeasure>");
  });

  it("includes overall pass threshold for count rule", () => {
    const countTest = { ...manifestTest, overallPassRuleJson: { type: "count", value: 4 } };
    const xml = buildManifest(countTest, {
      test: countTest,
      sections: [{ ...manifestSection, drawCount: 5 }],
    });
    // 4/5 → 0.80
    expect(xml).toContain("0.80");
  });

  it("includes topic objective with threshold", () => {
    const xml = buildManifest(manifestTest, manifestData);
    expect(xml).toContain('objectiveID="obj_topic_t1"');
    // 60% → 0.60
    expect(xml).toContain("0.60");
  });

  it("includes SCO resource pointing to index.html", () => {
    const xml = buildManifest(manifestTest, manifestData);
    expect(xml).toContain('href="index.html"');
    expect(xml).toContain('adlcp:scormType="sco"');
  });

  it("includes standard SCORM file references", () => {
    const xml = buildManifest(manifestTest, manifestData);
    expect(xml).toContain('<file href="styles.css"/>');
    expect(xml).toContain('<file href="runtime.js"/>');
    expect(xml).toContain('<file href="app.js"/>');
  });

  it("includes extra files when provided", () => {
    const xml = buildManifest(manifestTest, manifestData, [
      "assets/media/sound.mp3",
      "assets/img/pic.png",
    ]);
    expect(xml).toContain('href="assets/media/sound.mp3"');
    expect(xml).toContain('href="assets/img/pic.png"');
  });

  it("deduplicates extra files", () => {
    const xml = buildManifest(manifestTest, manifestData, [
      "assets/file.png",
      "assets/file.png",
    ]);
    const count = (xml.match(/assets\/file\.png/g) || []).length;
    expect(count).toBe(1);
  });

  it("reuses existing SCORM code from identifiers.json", () => {
    vi.mocked(fsMock.existsSync).mockReturnValue(true);
    vi.mocked(fsMock.readFileSync).mockReturnValue(
      JSON.stringify({ "test-abc": { code: "EXISTING_CODE", createdAt: "20240101" } })
    );
    vi.mocked(fsMock.writeFileSync).mockClear();
    const xml = buildManifest(manifestTest, manifestData);
    expect(xml).toContain("EXISTING_CODE");
    // код уже есть — не должен перезаписывать
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it("creates new SCORM code when not in identifiers.json", () => {
    vi.mocked(fsMock.existsSync).mockReturnValue(false);
    const xml = buildManifest(manifestTest, manifestData);
    // код должен содержать slug из заголовка (JS_Test)
    expect(xml).toContain("JS_Test");
    expect(fsMock.writeFileSync).toHaveBeenCalled();
  });

  it("generates code with date stamp format YYYYMMDD", () => {
    vi.mocked(fsMock.existsSync).mockReturnValue(false);
    const xml = buildManifest(manifestTest, manifestData);
    // manifest identifier должен содержать 8-значный датастамп
    const identifierMatch = xml.match(/identifier="(\d{8}_[^"]+)"/);
    expect(identifierMatch).not.toBeNull();
  });

  it("handles write failure gracefully (still returns XML)", () => {
    vi.mocked(fsMock.existsSync).mockReturnValue(false);
    vi.mocked(fsMock.writeFileSync).mockImplementation(() => { throw new Error("disk full"); });
    expect(() => buildManifest(manifestTest, manifestData)).not.toThrow();
  });

  it("hides LMS navigation UI elements", () => {
    const xml = buildManifest(manifestTest, manifestData);
    expect(xml).toContain("<adlnav:hideLMSUI>continue</adlnav:hideLMSUI>");
    expect(xml).toContain("<adlnav:hideLMSUI>previous</adlnav:hideLMSUI>");
    expect(xml).toContain("<adlnav:hideLMSUI>abandon</adlnav:hideLMSUI>");
  });

  it("handles multiple sections with separate objectives", () => {
    const section2: any = {
      ...manifestSection,
      topic: { id: "t2", name: "CSS" },
      topicPassRuleJson: { type: "percent", value: 80 },
    };
    const xml = buildManifest(manifestTest, {
      test: manifestTest,
      sections: [manifestSection, section2],
    });
    expect(xml).toContain('objectiveID="obj_topic_t1"');
    expect(xml).toContain('objectiveID="obj_topic_t2"');
  });

  it("uses default 0.5 threshold when topicPassRule is null", () => {
    const noRuleSection = { ...manifestSection, topicPassRuleJson: null };
    const xml = buildManifest(manifestTest, { test: manifestTest, sections: [noRuleSection] });
    expect(xml).toContain("<imsss:minNormalizedMeasure>0.5</imsss:minNormalizedMeasure>");
  });

  it("transliterates Russian title to Latin for SCORM code", () => {
    const ruTest = { ...manifestTest, id: "test-ru", title: "Основы JavaScript" };
    vi.mocked(fsMock.existsSync).mockReturnValue(false);
    const savedArg = vi.fn();
    vi.mocked(fsMock.writeFileSync).mockImplementation((_, data) => savedArg(data));
    buildManifest(ruTest, { test: ruTest, sections: [manifestSection] });
    const written = JSON.parse(savedArg.mock.calls[0][0] as string);
    expect(written["test-ru"].code).toMatch(/Osnovy_JavaScript/);
  });
});
