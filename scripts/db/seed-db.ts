/**
 * @module scripts/db/seed-db
 * @description Manual development-database seeder. Creates demo accounts (admin +
 * learner), the IPTV/WiFi topics and their questions — only when the database has
 * no users yet (idempotent). It REFUSES to run in production: the default demo
 * credentials must never be created on a real deployment (this is why the seeder
 * is a manual script, not a server-startup step). Run with `npm run seed`.
 *
 * Credentials can be overridden via env: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 * and SEED_LEARNER_EMAIL / SEED_LEARNER_PASSWORD.
 */
import { randomUUID } from "node:crypto";
import { db, closeDatabaseConnection } from "../../server/db";
import { users, userRoles, topics, questions } from "../../shared/schema";
import { encryptEmail, hashEmail, hashPassword } from "../../server/utils/crypto";
import { initConfig } from "../../server/config";
import { loadEnv } from "../../server/config-loader.mjs";

async function seedDatabase(): Promise<void> {
  const existingUsers = await db.select().from(users);
  if (existingUsers.length > 0) {
    console.log("[seed] Users already present — nothing to seed.");
    return;
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@test.com";
  const learnerEmail = process.env.SEED_LEARNER_EMAIL || "learner@test.com";
  const adminPassword = await hashPassword(process.env.SEED_ADMIN_PASSWORD || "admin123");
  const learnerPassword = await hashPassword(process.env.SEED_LEARNER_PASSWORD || "learner123");

  const adminId = randomUUID();
  const learnerId = randomUUID();

  await db.insert(users).values([
    {
      id: adminId,
      email: await encryptEmail(adminEmail),
      emailHash: hashEmail(adminEmail),
      passwordHash: adminPassword,
      name: "Администратор",
      status: "active",
      mustChangePassword: false,
      gdprConsent: true,
      gdprConsentAt: new Date(),
      createdAt: new Date(),
    },
    {
      id: learnerId,
      email: await encryptEmail(learnerEmail),
      emailHash: hashEmail(learnerEmail),
      passwordHash: learnerPassword,
      name: "Тестовый ученик",
      status: "active",
      mustChangePassword: false,
      gdprConsent: true,
      gdprConsentAt: new Date(),
      createdAt: new Date(),
    },
  ]);

  // PRD-13: roles live in `user_roles` (the legacy `users.role` column was dropped).
  await db.insert(userRoles).values([
    { id: randomUUID(), userId: adminId, role: "administrator" },
    { id: randomUUID(), userId: learnerId, role: "learner" },
  ]);

  const iptvTopicId = randomUUID();
  const wifiTopicId = randomUUID();

  // TD-02 r.3: recommended courses live in the topic's rich feedback, not the
  // legacy topic_courses table (which delivery no longer reads).
  await db.insert(topics).values([
    {
      id: iptvTopicId, name: "IPTV",
      description: "Internet Protocol Television fundamentals and configuration",
      feedbackJson: {
        format: "plain", text: "", assets: [], events: [],
        links: [{ title: "IPTV Fundamentals Course", url: "https://example.com/iptv-course" }],
      },
    },
    {
      id: wifiTopicId, name: "WiFi",
      description: "Wireless networking standards and troubleshooting",
      feedbackJson: {
        format: "plain", text: "", assets: [], events: [],
        links: [{ title: "WiFi Troubleshooting Guide", url: "https://example.com/wifi-course" }],
      },
    },
  ]);

  // T-40: scoring is a property of the test — seed questions carry content only.
  const iptvQuestions = [
    { topicId: iptvTopicId, type: "single" as const, prompt: "What does IPTV stand for?", dataJson: { options: ["Internet Protocol Television", "Internal Protocol TV", "Integrated Platform TV", "Internet Provider Television"] }, correctJson: { correctIndex: 0 } },
    { topicId: iptvTopicId, type: "single" as const, prompt: "Which protocol is commonly used for IPTV streaming?", dataJson: { options: ["HTTP", "RTSP", "FTP", "SMTP"] }, correctJson: { correctIndex: 1 } },
    { topicId: iptvTopicId, type: "multiple" as const, prompt: "Select all valid IPTV delivery methods:", dataJson: { options: ["Unicast", "Multicast", "Broadcast", "Anycast"] }, correctJson: { correctIndices: [0, 1] } },
    { topicId: iptvTopicId, type: "matching" as const, prompt: "Match the IPTV term with its definition:", dataJson: { left: ["STB", "EPG", "VOD"], right: ["Set-Top Box", "Electronic Program Guide", "Video on Demand"] }, correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }] } },
    { topicId: iptvTopicId, type: "ranking" as const, prompt: "Rank these IPTV setup steps in correct order:", dataJson: { items: ["Connect STB to network", "Configure network settings", "Authenticate with provider", "Start watching channels"] }, correctJson: { correctOrder: [0, 1, 2, 3] } },
    { topicId: iptvTopicId, type: "single" as const, prompt: "What is the typical bandwidth required for HD IPTV?", dataJson: { options: ["1 Mbps", "5 Mbps", "8-10 Mbps", "50 Mbps"] }, correctJson: { correctIndex: 2 } },
  ];

  const wifiQuestions = [
    { topicId: wifiTopicId, type: "single" as const, prompt: "What does WiFi stand for?", dataJson: { options: ["Wireless Fidelity", "Wired Fiber", "Wireless Fiber", "Wide Fidelity"] }, correctJson: { correctIndex: 0 } },
    { topicId: wifiTopicId, type: "single" as const, prompt: "Which frequency band provides faster speeds but shorter range?", dataJson: { options: ["2.4 GHz", "5 GHz", "900 MHz", "60 GHz"] }, correctJson: { correctIndex: 1 } },
    { topicId: wifiTopicId, type: "multiple" as const, prompt: "Select all valid WiFi security protocols:", dataJson: { options: ["WPA2", "WPA3", "WEP", "HTTP"] }, correctJson: { correctIndices: [0, 1, 2] } },
    { topicId: wifiTopicId, type: "matching" as const, prompt: "Match the WiFi standard with its maximum theoretical speed:", dataJson: { left: ["802.11n", "802.11ac", "802.11ax"], right: ["600 Mbps", "6.9 Gbps", "9.6 Gbps"] }, correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }] } },
    { topicId: wifiTopicId, type: "ranking" as const, prompt: "Rank WiFi security protocols from least to most secure:", dataJson: { items: ["WEP", "WPA", "WPA2", "WPA3"] }, correctJson: { correctOrder: [0, 1, 2, 3] } },
    { topicId: wifiTopicId, type: "single" as const, prompt: "What is the main advantage of mesh WiFi systems?", dataJson: { options: ["Lower cost", "Better coverage", "Higher speeds", "Less power consumption"] }, correctJson: { correctIndex: 1 } },
  ];

  for (const q of [...iptvQuestions, ...wifiQuestions]) {
    await db.insert(questions).values({ id: randomUUID(), ...q });
  }

  console.log(`[seed] Seeded admin (${adminEmail}) + learner (${learnerEmail}), 2 topics, 12 questions.`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("[seed] Refusing to run in production — demo credentials must not be created on a real deployment.");
    process.exit(1);
  }
  loadEnv();
  await initConfig();
  await seedDatabase();
  await closeDatabaseConnection();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[seed] Failed:", err instanceof Error ? err.message : err);
  await closeDatabaseConnection().catch(() => {});
  process.exit(1);
});
