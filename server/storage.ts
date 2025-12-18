import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { eq, inArray, and, sql } from "drizzle-orm";
import { db } from "./db";
import {
  users, topics, topicCourses, questions, tests, testSections, attempts, folders,
  type User, type InsertUser,
  type Folder, type InsertFolder,
  type Topic, type InsertTopic,
  type TopicCourse, type InsertTopicCourse,
  type Question, type InsertQuestion,
  type Test, type InsertTest,
  type TestSection, type InsertTestSection,
  type Attempt, type InsertAttempt,
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  validatePassword(username: string, password: string): Promise<User | null>;

  getFolders(): Promise<Folder[]>;
  getFolder(id: string): Promise<Folder | undefined>;
  createFolder(folder: InsertFolder): Promise<Folder>;
  updateFolder(id: string, folder: Partial<InsertFolder>): Promise<Folder | undefined>;
  deleteFolder(id: string): Promise<boolean>;

  getTopics(): Promise<Topic[]>;
  getTopic(id: string): Promise<Topic | undefined>;
  createTopic(topic: InsertTopic): Promise<Topic>;
  updateTopic(id: string, topic: Partial<InsertTopic>): Promise<Topic | undefined>;
  deleteTopic(id: string): Promise<boolean>;
  deleteTopicsBulk(ids: string[]): Promise<number>;

  getTopicCourses(topicId: string): Promise<TopicCourse[]>;
  createTopicCourse(course: InsertTopicCourse): Promise<TopicCourse>;
  deleteTopicCourse(id: string): Promise<boolean>;

  getQuestions(): Promise<Question[]>;
  getQuestionsByTopic(topicId: string): Promise<Question[]>;
  getQuestion(id: string): Promise<Question | undefined>;
  getQuestionsByIds(ids: string[]): Promise<Question[]>;
  createQuestion(question: InsertQuestion): Promise<Question>;
  updateQuestion(id: string, question: Partial<InsertQuestion>): Promise<Question | undefined>;
  deleteQuestion(id: string): Promise<boolean>;
  deleteQuestionsBulk(ids: string[]): Promise<number>;

  getTests(): Promise<Test[]>;
  getTest(id: string): Promise<Test | undefined>;
  createTest(test: InsertTest, sections: Omit<InsertTestSection, "testId">[]): Promise<Test>;
  updateTest(id: string, test: Partial<InsertTest>, sections?: Omit<InsertTestSection, "testId">[]): Promise<Test | undefined>;
  deleteTest(id: string): Promise<boolean>;
  getTestSections(testId: string): Promise<TestSection[]>;

  createAttempt(attempt: InsertAttempt): Promise<Attempt>;
  getAttempt(id: string): Promise<Attempt | undefined>;
  updateAttempt(id: string, updates: Partial<Attempt>): Promise<Attempt | undefined>;
  getAttemptsByUser(userId: string): Promise<Attempt[]>;
  getAllAttempts(): Promise<Attempt[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const hashedPassword = await bcrypt.hash(insertUser.password, 10);
    const [user] = await db.insert(users).values({
      id,
      username: insertUser.username,
      password: hashedPassword,
      role: insertUser.role || "learner",
    }).returning();
    return user;
  }

  async validatePassword(username: string, password: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password);
    return valid ? user : null;
  }

  async getFolders(): Promise<Folder[]> {
    return db.select().from(folders);
  }

  async getFolder(id: string): Promise<Folder | undefined> {
    const [folder] = await db.select().from(folders).where(eq(folders.id, id));
    return folder || undefined;
  }

  async createFolder(folder: InsertFolder): Promise<Folder> {
    const id = randomUUID();
    const [newFolder] = await db.insert(folders).values({
      id,
      name: folder.name,
      parentId: folder.parentId || null,
    }).returning();
    return newFolder;
  }

  async updateFolder(id: string, updates: Partial<InsertFolder>): Promise<Folder | undefined> {
    const [updated] = await db.update(folders).set(updates).where(eq(folders.id, id)).returning();
    return updated || undefined;
  }

  async deleteFolder(id: string): Promise<boolean> {
    // When deleting a folder, move all its topics to root (folderId = null)
    await db.update(topics).set({ folderId: null }).where(eq(topics.folderId, id));
    // Move child folders to root (parentId = null)
    await db.update(folders).set({ parentId: null }).where(eq(folders.parentId, id));
    const result = await db.delete(folders).where(eq(folders.id, id)).returning();
    return result.length > 0;
  }

  async getTopics(): Promise<Topic[]> {
    return db.select().from(topics);
  }

  async getTopic(id: string): Promise<Topic | undefined> {
    const [topic] = await db.select().from(topics).where(eq(topics.id, id));
    return topic || undefined;
  }

  async createTopic(topic: InsertTopic): Promise<Topic> {
    const id = randomUUID();
    const [newTopic] = await db.insert(topics).values({
      id,
      name: topic.name,
      description: topic.description || null,
      feedback: topic.feedback || null,
      folderId: topic.folderId || null,
    }).returning();
    return newTopic;
  }

  async updateTopic(id: string, updates: Partial<InsertTopic>): Promise<Topic | undefined> {
    const [updated] = await db.update(topics).set(updates).where(eq(topics.id, id)).returning();
    return updated || undefined;
  }

  async deleteTopic(id: string): Promise<boolean> {
    // Cascade delete: first delete questions and courses for this topic
    await db.delete(questions).where(eq(questions.topicId, id));
    await db.delete(topicCourses).where(eq(topicCourses.topicId, id));
    const result = await db.delete(topics).where(eq(topics.id, id)).returning();
    return result.length > 0;
  }

  async deleteTopicsBulk(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    // Cascade delete: first delete questions and courses for these topics
    await db.delete(questions).where(inArray(questions.topicId, ids));
    await db.delete(topicCourses).where(inArray(topicCourses.topicId, ids));
    const result = await db.delete(topics).where(inArray(topics.id, ids)).returning();
    return result.length;
  }

  async getTopicCourses(topicId: string): Promise<TopicCourse[]> {
    return db.select().from(topicCourses).where(eq(topicCourses.topicId, topicId));
  }

  async createTopicCourse(course: InsertTopicCourse): Promise<TopicCourse> {
    const id = randomUUID();
    const [newCourse] = await db.insert(topicCourses).values({ id, ...course }).returning();
    return newCourse;
  }

  async deleteTopicCourse(id: string): Promise<boolean> {
    const result = await db.delete(topicCourses).where(eq(topicCourses.id, id)).returning();
    return result.length > 0;
  }

  async getQuestions(): Promise<Question[]> {
    return db.select().from(questions);
  }

  async getQuestionsByTopic(topicId: string): Promise<Question[]> {
    return db.select().from(questions).where(eq(questions.topicId, topicId));
  }

  async getQuestion(id: string): Promise<Question | undefined> {
    const [question] = await db.select().from(questions).where(eq(questions.id, id));
    return question || undefined;
  }

  async getQuestionsByIds(ids: string[]): Promise<Question[]> {
    if (ids.length === 0) return [];
    return db.select().from(questions).where(inArray(questions.id, ids));
  }

  async createQuestion(question: InsertQuestion): Promise<Question> {
    const id = randomUUID();
    const [newQuestion] = await db.insert(questions).values({
      id,
      topicId: question.topicId,
      type: question.type,
      prompt: question.prompt,
      dataJson: question.dataJson,
      correctJson: question.correctJson,
      points: question.points ?? 1,
      mediaUrl: question.mediaUrl || null,
      mediaType: question.mediaType || null,
      shuffleAnswers: question.shuffleAnswers ?? true,
      feedback: question.feedback || null,
    }).returning();
    return newQuestion;
  }

  async duplicateQuestion(id: string): Promise<Question | undefined> {
    const original = await this.getQuestion(id);
    if (!original) return undefined;

    const newId = randomUUID();
    const [newQuestion] = await db.insert(questions).values({
      id: newId,
      topicId: original.topicId,
      type: original.type,
      prompt: original.prompt + " (копия)",
      dataJson: original.dataJson,
      correctJson: original.correctJson,
      feedback: original.feedback,
      points: original.points,
      mediaUrl: original.mediaUrl,
      mediaType: original.mediaType,
      shuffleAnswers: original.shuffleAnswers,
    }).returning();
    return newQuestion;
  }

  async duplicateTopicWithQuestions(id: string): Promise<{ topic: Topic; questions: Question[] } | undefined> {
    const originalTopic = await this.getTopic(id);
    if (!originalTopic) return undefined;

    const newTopicId = randomUUID();
    const [newTopic] = await db.insert(topics).values({
      id: newTopicId,
      name: originalTopic.name + " (копия)",
      description: originalTopic.description,
      feedback: originalTopic.feedback,
    }).returning();

    const originalCourses = await this.getTopicCourses(id);
    for (const course of originalCourses) {
      await db.insert(topicCourses).values({
        id: randomUUID(),
        topicId: newTopicId,
        title: course.title,
        url: course.url,
      });
    }

    const originalQuestions = await this.getQuestionsByTopic(id);
    const newQuestions: Question[] = [];

    for (const q of originalQuestions) {
      const [newQ] = await db.insert(questions).values({
        id: randomUUID(),
        topicId: newTopicId,
        type: q.type,
        prompt: q.prompt,
        dataJson: q.dataJson,
        correctJson: q.correctJson,
        points: q.points,
        mediaUrl: q.mediaUrl,
        mediaType: q.mediaType,
        shuffleAnswers: q.shuffleAnswers,
        feedback: q.feedback,
      }).returning();
      newQuestions.push(newQ);
    }

    return { topic: newTopic, questions: newQuestions };
  }

  async getTopicByName(name: string): Promise<Topic | undefined> {
    const [topic] = await db.select().from(topics).where(eq(topics.name, name));
    return topic || undefined;
  }

  async updateQuestion(id: string, updates: Partial<InsertQuestion>): Promise<Question | undefined> {
    const [updated] = await db.update(questions).set(updates).where(eq(questions.id, id)).returning();
    return updated || undefined;
  }

  async deleteQuestion(id: string): Promise<boolean> {
    const result = await db.delete(questions).where(eq(questions.id, id)).returning();
    return result.length > 0;
  }

  async deleteQuestionsBulk(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await db.delete(questions).where(inArray(questions.id, ids)).returning();
    return result.length;
  }

  async getTests(): Promise<Test[]> {
    return db.select().from(tests);
  }

  async getTest(id: string): Promise<Test | undefined> {
    const [test] = await db.select().from(tests).where(eq(tests.id, id));
    return test || undefined;
  }

  async createTest(test: InsertTest, sections: Omit<InsertTestSection, "testId">[]): Promise<Test> {
    const id = randomUUID();
    const [newTest] = await db.insert(tests).values({
      id,
      title: test.title,
      description: test.description || null,
      overallPassRuleJson: test.overallPassRuleJson,
      webhookUrl: test.webhookUrl || null,
      published: test.published || false,
      showCorrectAnswers: test.showCorrectAnswers || false,
      timeLimitMinutes: test.timeLimitMinutes || null,
      maxAttempts: test.maxAttempts || null,
      startPageContent: test.startPageContent || null,
      feedback: test.feedback || null,
    }).returning();

    for (const section of sections) {
      const sectionId = randomUUID();
      await db.insert(testSections).values({
        id: sectionId,
        testId: id,
        topicId: section.topicId,
        drawCount: section.drawCount,
        topicPassRuleJson: section.topicPassRuleJson || null,
      });
    }

    return newTest;
  }

  async updateTest(id: string, updates: Partial<InsertTest>, sections?: Omit<InsertTestSection, "testId">[]): Promise<Test | undefined> {
    // Increment version when test is updated
    const [updated] = await db.update(tests)
      .set({ ...updates, version: sql`${tests.version} + 1` })
      .where(eq(tests.id, id))
      .returning();
    if (!updated) return undefined;

    if (sections) {
      await db.delete(testSections).where(eq(testSections.testId, id));
      for (const section of sections) {
        const sectionId = randomUUID();
        await db.insert(testSections).values({
          id: sectionId,
          testId: id,
          topicId: section.topicId,
          drawCount: section.drawCount,
          topicPassRuleJson: section.topicPassRuleJson || null,
        });
      }
    }

    return updated;
  }

  async deleteTest(id: string): Promise<boolean> {
    await db.delete(testSections).where(eq(testSections.testId, id));
    const result = await db.delete(tests).where(eq(tests.id, id)).returning();
    return result.length > 0;
  }

  async getTestSections(testId: string): Promise<TestSection[]> {
    return db.select().from(testSections).where(eq(testSections.testId, testId));
  }

  async createAttempt(attempt: InsertAttempt): Promise<Attempt> {
    const id = randomUUID();
    const [newAttempt] = await db.insert(attempts).values({
      id,
      userId: attempt.userId,
      testId: attempt.testId,
      testVersion: attempt.testVersion || 1,
      variantJson: attempt.variantJson,
      answersJson: attempt.answersJson || null,
      resultJson: attempt.resultJson || null,
      startedAt: new Date(attempt.startedAt),
      finishedAt: attempt.finishedAt ? new Date(attempt.finishedAt) : null,
    }).returning();
    return newAttempt;
  }

  async getAttempt(id: string): Promise<Attempt | undefined> {
    const [attempt] = await db.select().from(attempts).where(eq(attempts.id, id));
    return attempt || undefined;
  }

  async updateAttempt(id: string, updates: Partial<Attempt>): Promise<Attempt | undefined> {
    const [updated] = await db.update(attempts).set(updates).where(eq(attempts.id, id)).returning();
    return updated || undefined;
  }

  async getAttemptsByUser(userId: string): Promise<Attempt[]> {
    return db.select().from(attempts).where(eq(attempts.userId, userId));
  }

  async getAllAttempts(): Promise<Attempt[]> {
    return db.select().from(attempts);
  }
}

export const storage = new DatabaseStorage();

export async function seedDatabase() {
  const existingUsers = await db.select().from(users);
  if (existingUsers.length > 0) return;

  const adminPassword = await bcrypt.hash("admin123", 10);
  const learnerPassword = await bcrypt.hash("learner123", 10);

  const adminId = randomUUID();
  const learnerId = randomUUID();

  await db.insert(users).values([
    { id: adminId, username: "admin", password: adminPassword, role: "author" },
    { id: learnerId, username: "learner", password: learnerPassword, role: "learner" },
  ]);

  const iptvTopicId = randomUUID();
  const wifiTopicId = randomUUID();

  await db.insert(topics).values([
    { id: iptvTopicId, name: "IPTV", description: "Internet Protocol Television fundamentals and configuration" },
    { id: wifiTopicId, name: "WiFi", description: "Wireless networking standards and troubleshooting" },
  ]);

  await db.insert(topicCourses).values([
    { id: randomUUID(), topicId: iptvTopicId, title: "IPTV Fundamentals Course", url: "https://example.com/iptv-course" },
    { id: randomUUID(), topicId: wifiTopicId, title: "WiFi Troubleshooting Guide", url: "https://example.com/wifi-course" },
  ]);

  const iptvQuestions = [
    { topicId: iptvTopicId, type: "single" as const, prompt: "What does IPTV stand for?", dataJson: { options: ["Internet Protocol Television", "Internal Protocol TV", "Integrated Platform TV", "Internet Provider Television"] }, correctJson: { correctIndex: 0 }, points: 1 },
    { topicId: iptvTopicId, type: "single" as const, prompt: "Which protocol is commonly used for IPTV streaming?", dataJson: { options: ["HTTP", "RTSP", "FTP", "SMTP"] }, correctJson: { correctIndex: 1 }, points: 1 },
    { topicId: iptvTopicId, type: "multiple" as const, prompt: "Select all valid IPTV delivery methods:", dataJson: { options: ["Unicast", "Multicast", "Broadcast", "Anycast"] }, correctJson: { correctIndices: [0, 1] }, points: 2 },
    { topicId: iptvTopicId, type: "matching" as const, prompt: "Match the IPTV term with its definition:", dataJson: { left: ["STB", "EPG", "VOD"], right: ["Set-Top Box", "Electronic Program Guide", "Video on Demand"] }, correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }] }, points: 3 },
    { topicId: iptvTopicId, type: "ranking" as const, prompt: "Rank these IPTV setup steps in correct order:", dataJson: { items: ["Connect STB to network", "Configure network settings", "Authenticate with provider", "Start watching channels"] }, correctJson: { correctOrder: [0, 1, 2, 3] }, points: 2 },
    { topicId: iptvTopicId, type: "single" as const, prompt: "What is the typical bandwidth required for HD IPTV?", dataJson: { options: ["1 Mbps", "5 Mbps", "8-10 Mbps", "50 Mbps"] }, correctJson: { correctIndex: 2 }, points: 1 },
  ];

  const wifiQuestions = [
    { topicId: wifiTopicId, type: "single" as const, prompt: "What does WiFi stand for?", dataJson: { options: ["Wireless Fidelity", "Wired Fiber", "Wireless Fiber", "Wide Fidelity"] }, correctJson: { correctIndex: 0 }, points: 1 },
    { topicId: wifiTopicId, type: "single" as const, prompt: "Which frequency band provides faster speeds but shorter range?", dataJson: { options: ["2.4 GHz", "5 GHz", "900 MHz", "60 GHz"] }, correctJson: { correctIndex: 1 }, points: 1 },
    { topicId: wifiTopicId, type: "multiple" as const, prompt: "Select all valid WiFi security protocols:", dataJson: { options: ["WPA2", "WPA3", "WEP", "HTTP"] }, correctJson: { correctIndices: [0, 1, 2] }, points: 2 },
    { topicId: wifiTopicId, type: "matching" as const, prompt: "Match the WiFi standard with its maximum theoretical speed:", dataJson: { left: ["802.11n", "802.11ac", "802.11ax"], right: ["600 Mbps", "6.9 Gbps", "9.6 Gbps"] }, correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }] }, points: 3 },
    { topicId: wifiTopicId, type: "ranking" as const, prompt: "Rank WiFi security protocols from least to most secure:", dataJson: { items: ["WEP", "WPA", "WPA2", "WPA3"] }, correctJson: { correctOrder: [0, 1, 2, 3] }, points: 2 },
    { topicId: wifiTopicId, type: "single" as const, prompt: "What is the main advantage of mesh WiFi systems?", dataJson: { options: ["Lower cost", "Better coverage", "Higher speeds", "Less power consumption"] }, correctJson: { correctIndex: 1 }, points: 1 },
  ];

  for (const q of [...iptvQuestions, ...wifiQuestions]) {
    await db.insert(questions).values({ id: randomUUID(), ...q });
  }
}
