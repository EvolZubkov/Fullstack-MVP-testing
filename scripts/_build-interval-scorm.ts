import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { generateScormPackage } from "../server/scorm/index";

// PRD-31 local acceptance: build a SCORM package carrying BOTH access barriers —
// the calendar cooldown between assignments (barrier A, webtutor_cooldown, which
// scorm-player mocks) and the hour interval between attempts inside one assignment
// (barrier B, decided post-Initialize from suspend_data).
//
// `maxAttempts: 3` matters: the point of the PRD is that a learner with attempts
// LEFT must not be locked out by the between-assignments cooldown, and that the
// next attempt inside the assignment waits out the interval instead.
//
// Self-contained fixture (no DB), modelled on _build-cooldown-scorm.ts.
// Throwaway dev tooling.

const TOPIC_ID = "interval-topic";

function question(id: string, prompt: string) {
  return {
    id, topicId: TOPIC_ID, type: "single", prompt,
    dataJson: { options: ["Вариант A", "Вариант B", "Вариант C"] },
    correctJson: { correctIndex: 0 },
    points: 1, difficulty: 50, mediaUrl: null, mediaType: null, feedback: null,
    feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
    tags: [], createdAt: new Date(), updatedAt: new Date(),
  };
}

const topic = { id: TOPIC_ID, name: "Основы сетей", description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() };

const fixture = {
  test: {
    id: "interval-demo", title: "Основы сетей",
    description: "Проверка знаний по основам компьютерных сетей.",
    mode: "standard", showDifficultyLevel: true,
    overallPassRuleJson: { type: "percent", value: 80 }, webhookUrl: null,
    feedback: null, timeLimitMinutes: null, maxAttempts: 3, showCorrectAnswers: false,
    startPageContent: null, published: true, status: "published", folderId: null,
    designSettingsJson: { templateId: "default", params: {} },
    retakePolicyJson: {
      enabled: true,
      cooldownPeriodDays: 30,
      gateMode: "before_internal_start",
      eligibilityPlugin: { key: "webtutor_cooldown", configId: "webtutor_catalog_default", failPolicy: "failOpen" },
      attemptInterval: { enabled: true, hours: 24 },
    },
    createdAt: new Date(), updatedAt: new Date(),
  },
  sections: [{
    id: "s1", testId: "interval-demo", topicId: TOPIC_ID, drawCount: 3, sortOrder: 0,
    required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null,
    topic, courses: [], events: [],
    questions: [
      question("q1", "Какой уровень модели OSI отвечает за маршрутизацию?"),
      question("q2", "Что такое MAC-адрес?"),
      question("q3", "Сколько бит в адресе IPv4?"),
    ],
  }],
  adaptiveSettings: null, contentPages: [],
  designSettings: { templateId: "default", params: {} }, telemetry: null,
};

async function main() {
  const buf = await generateScormPackage(fixture as never);
  mkdirSync("out", { recursive: true });
  writeFileSync("out/interval-demo.zip", buf);
  console.log("WROTE out/interval-demo.zip");
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e?.message || e); process.exit(1); });
