import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { generateScormPackage } from "../../server/scorm/index";

// PRD-19 Block F (FR-20) local acceptance: build a SCORM package for a test WITH a
// retake policy (webtutor_cooldown — the scorm-player mocks its ClientBridge), so
// setting a recent "last completion date" in the player drives the gate's BLOCKED
// branch and renders the cooldown state ON start.html. Self-contained fixture (no
// DB), modelled on tests/scorm-retake-acceptance.ts. Throwaway dev tooling.

const TOPIC_ID = "cooldown-topic";

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
    id: "cooldown-demo", title: "Основы сетей",
    description: "Проверка знаний по основам компьютерных сетей.",
    mode: "standard", showDifficultyLevel: true,
    overallPassRuleJson: { type: "percent", value: 80 }, webhookUrl: null,
    feedback: null, timeLimitMinutes: 30, maxAttempts: 3, showCorrectAnswers: false,
    startPageContent: null, published: true, status: "published", folderId: null,
    designSettingsJson: { templateId: "default", params: {} },
    retakePolicyJson: {
      enabled: true,
      cooldownPeriodDays: 30,
      gateMode: "before_internal_start",
      eligibilityPlugin: { key: "webtutor_cooldown", configId: "webtutor_catalog_default", failPolicy: "failOpen" },
    },
    createdAt: new Date(), updatedAt: new Date(),
  },
  sections: [{
    id: "s1", testId: "cooldown-demo", topicId: TOPIC_ID, drawCount: 3, sortOrder: 0,
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
  writeFileSync("out/cooldown-demo.zip", buf);
  console.log("WROTE out/cooldown-demo.zip");
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e?.message || e); process.exit(1); });
