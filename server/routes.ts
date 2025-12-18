import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import MemoryStore from "memorystore";
import multer from "multer";
import * as XLSX from "xlsx";
import { storage } from "./storage";
import { generateScormPackage } from "./scorm-exporter";
import type { TestVariant, AttemptResult, TopicResult, PassRule, Question } from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage() });

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

const MemStore = MemoryStore(session);

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

async function requireAuthor(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "author") {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  } catch (error) {
    return res.status(500).json({ error: "Authorization error" });
  }
}

async function requireLearner(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "learner") {
      return res.status(403).json({ error: "Forbidden - Learner access required" });
    }
    next();
  } catch (error) {
    return res.status(500).json({ error: "Authorization error" });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(
    session({
      store: new MemStore({ checkPeriod: 86400000 }),
      secret: process.env.SESSION_SECRET || "scorm-test-constructor-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );

  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      const user = await storage.validatePassword(username, password);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      req.session.userId = user.id;
      res.json({ user: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({ user: { id: user.id, username: user.username, role: user.role } });
  });

  // Folders routes
  app.get("/api/folders", requireAuth, async (req, res) => {
    try {
      const folders = await storage.getFolders();
      res.json(folders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch folders" });
    }
  });

  app.post("/api/folders", requireAuthor, async (req, res) => {
    try {
      const { name, parentId } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }
      const folder = await storage.createFolder({ name, parentId: parentId || null });
      res.status(201).json(folder);
    } catch (error) {
      res.status(500).json({ error: "Failed to create folder" });
    }
  });

  app.put("/api/folders/:id", requireAuthor, async (req, res) => {
    try {
      const { name, parentId } = req.body;
      const folder = await storage.updateFolder(req.params.id, { name, parentId });
      if (!folder) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.json(folder);
    } catch (error) {
      res.status(500).json({ error: "Failed to update folder" });
    }
  });

  app.delete("/api/folders/:id", requireAuthor, async (req, res) => {
    try {
      const success = await storage.deleteFolder(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete folder" });
    }
  });

  // Topics routes
  app.get("/api/topics", requireAuth, async (req, res) => {
    try {
      const topics = await storage.getTopics();
      const topicsWithDetails = await Promise.all(
        topics.map(async (topic) => {
          const courses = await storage.getTopicCourses(topic.id);
          const questions = await storage.getQuestionsByTopic(topic.id);
          return {
            ...topic,
            courses,
            questionCount: questions.length,
          };
        })
      );
      res.json(topicsWithDetails);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch topics" });
    }
  });

  app.post("/api/topics", requireAuthor, async (req, res) => {
    try {
      const { name, description, folderId } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }
      const topic = await storage.createTopic({ name, description, folderId: folderId || null });
      res.status(201).json(topic);
    } catch (error) {
      res.status(500).json({ error: "Failed to create topic" });
    }
  });

  app.put("/api/topics/:id", requireAuthor, async (req, res) => {
    try {
      const { name, description, folderId } = req.body;
      const topic = await storage.updateTopic(req.params.id, { name, description, folderId });
      if (!topic) {
        return res.status(404).json({ error: "Topic not found" });
      }
      res.json(topic);
    } catch (error) {
      res.status(500).json({ error: "Failed to update topic" });
    }
  });

  app.delete("/api/topics/:id", requireAuthor, async (req, res) => {
    try {
      const success = await storage.deleteTopic(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Topic not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete topic" });
    }
  });

  // Bulk delete topics
  app.post("/api/topics/bulk-delete", requireAuthor, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Invalid ids array" });
      }
      const count = await storage.deleteTopicsBulk(ids);
      res.json({ success: true, count });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete topics" });
    }
  });

  // Topic courses routes
  app.post("/api/topics/:topicId/courses", requireAuthor, async (req, res) => {
    try {
      const { title, url } = req.body;
      if (!title || !url) {
        return res.status(400).json({ error: "Title and URL are required" });
      }
      const course = await storage.createTopicCourse({
        topicId: req.params.topicId,
        title,
        url,
      });
      res.status(201).json(course);
    } catch (error) {
      res.status(500).json({ error: "Failed to create course" });
    }
  });

  app.delete("/api/courses/:id", requireAuthor, async (req, res) => {
    try {
      const success = await storage.deleteTopicCourse(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Course not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete course" });
    }
  });

  // Questions routes
  app.get("/api/questions", requireAuth, async (req, res) => {
    try {
      const questions = await storage.getQuestions();
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t.name]));

      const questionsWithTopic = questions.map((q) => ({
        ...q,
        topicName: topicMap.get(q.topicId) || "Unknown",
      }));

      res.json(questionsWithTopic);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch questions" });
    }
  });

  app.post("/api/questions", requireAuthor, async (req, res) => {
    try {
      const { topicId, type, prompt, dataJson, correctJson, points, feedback, feedbackMode, feedbackCorrect, feedbackIncorrect, shuffleAnswers, mediaUrl, mediaType } = req.body;
      if (!topicId || !type || !prompt) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const question = await storage.createQuestion({
        topicId,
        type,
        prompt,
        dataJson,
        correctJson,
        points: points || 1,
        feedback,
        feedbackMode,
        feedbackCorrect,
        feedbackIncorrect,
        shuffleAnswers: shuffleAnswers ?? true,
        mediaUrl,
        mediaType,
      });
      res.status(201).json(question);
    } catch (error) {
      res.status(500).json({ error: "Failed to create question" });
    }
  });

  app.put("/api/questions/:id", requireAuthor, async (req, res) => {
    try {
      const { topicId, type, prompt, dataJson, correctJson, points, feedback, feedbackMode, feedbackCorrect, feedbackIncorrect, shuffleAnswers, mediaUrl, mediaType } = req.body;
      const question = await storage.updateQuestion(req.params.id, {
        topicId,
        type,
        prompt,
        dataJson,
        correctJson,
        points,
        feedback,
        feedbackMode,
        feedbackCorrect,
        feedbackIncorrect,
        shuffleAnswers,
        mediaUrl,
        mediaType,
      });
      if (!question) {
        return res.status(404).json({ error: "Question not found" });
      }
      res.json(question);
    } catch (error) {
      res.status(500).json({ error: "Failed to update question" });
    }
  });

  app.delete("/api/questions/:id", requireAuthor, async (req, res) => {
    try {
      const success = await storage.deleteQuestion(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Question not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete question" });
    }
  });

  // Bulk delete questions
  app.post("/api/questions/bulk-delete", requireAuthor, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Invalid ids array" });
      }
      const count = await storage.deleteQuestionsBulk(ids);
      res.json({ success: true, count });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete questions" });
    }
  });

  // Duplicate question
  app.post("/api/questions/:id/duplicate", requireAuthor, async (req, res) => {
    try {
      const question = await storage.duplicateQuestion(req.params.id);
      if (!question) {
        return res.status(404).json({ error: "Question not found" });
      }
      res.status(201).json(question);
    } catch (error) {
      res.status(500).json({ error: "Failed to duplicate question" });
    }
  });

  // Duplicate topic with all questions
  app.post("/api/topics/:id/duplicate", requireAuthor, async (req, res) => {
    try {
      const result = await storage.duplicateTopicWithQuestions(req.params.id);
      if (!result) {
        return res.status(404).json({ error: "Topic not found" });
      }
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to duplicate topic" });
    }
  });

  // Export questions to Excel
  app.get("/api/questions/export", requireAuthor, async (req, res) => {
    try {
      const questions = await storage.getQuestions();
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t.name]));

      const rows = questions.map((q) => {
        const data = q.dataJson as any;
        const correct = q.correctJson as any;
        
        let typeLabel = "";
        let optionsStr = "";
        let correctStr = "";
        
        if (q.type === "single") {
          typeLabel = "multiple_choice";
          optionsStr = (data.options || []).join("#");
          correctStr = String((correct.correctIndex ?? 0) + 1);
        } else if (q.type === "multiple") {
          typeLabel = "multiple_response";
          optionsStr = (data.options || []).join("#");
          correctStr = (correct.correctIndices || []).map((i: number) => i + 1).join(",");
        } else if (q.type === "ranking") {
          typeLabel = "order";
          optionsStr = (data.items || []).join("#");
          correctStr = (correct.correctOrder || []).map((i: number) => i + 1).join(",");
        } else if (q.type === "matching") {
          typeLabel = "correspondence";
          optionsStr = (data.left || []).join("#") + "|" + (data.right || []).join("#");
          correctStr = (correct.pairs || []).map((p: any) => `${p.left + 1}/${p.right + 1}`).join(",");
        }

        return {
          "Тема": topicMap.get(q.topicId) || "",
          "Тип вопроса": typeLabel,
          "Текст вопроса": q.prompt,
          "Балл": q.points,
          "Тексты вариантов ответа": optionsStr,
          "Номера правильных ответов": correctStr,
          "Следование вариантов ответов": q.shuffleAnswers ? "Random" : "",
          "Обратная связь": q.feedback || "",
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Вопросы");

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="questions_export.xlsx"');
      res.send(buffer);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export questions" });
    }
  });

  // Import questions from Excel
  app.post("/api/questions/import", requireAuthor, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet) as any[];

      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.name, t.id]));

      const imported: Question[] = [];
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // Excel row number (header is row 1)

        try {
          const topicName = String(row["Тема"] || "").trim();
          const typeLabel = String(row["Тип вопроса"] || "").trim().toLowerCase();
          const prompt = String(row["Текст вопроса"] || "").trim();
          const points = Number(row["Балл"]) || 1;
          const optionsStr = String(row["Тексты вариантов ответа"] || "").trim();
          const correctStr = String(row["Номера правильных ответов"] || "").trim();
          const orderStr = String(row["Следование вариантов ответов"] || "").trim().toLowerCase();
          const feedbackStr = String(row["Обратная связь"] || "").trim();

          if (!topicName || !prompt) {
            errors.push(`Строка ${rowNum}: отсутствует тема или текст вопроса`);
            continue;
          }

          let topicId = topicMap.get(topicName);
          if (!topicId) {
            const newTopic = await storage.createTopic({ name: topicName });
            topicId = newTopic.id;
            topicMap.set(topicName, topicId);
          }

          let type: "single" | "multiple" | "matching" | "ranking";
          let dataJson: any;
          let correctJson: any;

          if (typeLabel === "multiple_choice") {
            type = "single";
            const options = optionsStr.split("#").filter(Boolean);
            const correctIndex = (parseInt(correctStr) || 1) - 1;
            dataJson = { options };
            correctJson = { correctIndex };
          } else if (typeLabel === "multiple_response") {
            type = "multiple";
            const options = optionsStr.split("#").filter(Boolean);
            const correctIndices = correctStr.split(",").map((s) => (parseInt(s.trim()) || 1) - 1);
            dataJson = { options };
            correctJson = { correctIndices };
          } else if (typeLabel === "order") {
            type = "ranking";
            const items = optionsStr.split("#").filter(Boolean);
            const correctOrder = correctStr.split(",").map((s) => (parseInt(s.trim()) || 1) - 1);
            dataJson = { items };
            correctJson = { correctOrder };
          } else if (typeLabel === "correspondence") {
            type = "matching";
            const parts = optionsStr.split("|");
            const left = (parts[0] || "").split("#").filter(Boolean);
            const right = (parts[1] || "").split("#").filter(Boolean);
            const pairs = correctStr.split(",").map((s) => {
              const [l, r] = s.trim().split("/");
              return { left: (parseInt(l) || 1) - 1, right: (parseInt(r) || 1) - 1 };
            });
            dataJson = { left, right };
            correctJson = { pairs };
          } else {
            errors.push(`Строка ${rowNum}: неизвестный тип вопроса "${typeLabel}"`);
            continue;
          }

          const shuffleAnswers = orderStr === "random" || orderStr === "";

          const question = await storage.createQuestion({
            topicId,
            type,
            prompt,
            dataJson,
            correctJson,
            points,
            shuffleAnswers,
            feedback: feedbackStr || null,
          });

          imported.push(question);
        } catch (err) {
          errors.push(`Строка ${rowNum}: ошибка обработки`);
        }
      }

      res.json({
        imported: imported.length,
        errors,
      });
    } catch (error) {
      console.error("Import error:", error);
      res.status(500).json({ error: "Failed to import questions" });
    }
  });

  // Tests routes
  app.get("/api/tests", requireAuth, async (req, res) => {
    try {
      const tests = await storage.getTests();
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t]));

      const testsWithSections = await Promise.all(
        tests.map(async (test) => {
          const sections = await storage.getTestSections(test.id);
          const sectionsWithDetails = await Promise.all(
            sections.map(async (s) => {
              const topic = topicMap.get(s.topicId);
              const questions = await storage.getQuestionsByTopic(s.topicId);
              return {
                ...s,
                topicName: topic?.name || "Unknown",
                maxQuestions: questions.length,
              };
            })
          );
          return { ...test, sections: sectionsWithDetails };
        })
      );

      res.json(testsWithSections);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tests" });
    }
  });

  app.post("/api/tests", requireAuthor, async (req, res) => {
    try {
      const { title, description, overallPassRuleJson, webhookUrl, sections, showCorrectAnswers, timeLimitMinutes, maxAttempts, startPageContent, feedback } = req.body;
      if (!title || !sections || sections.length === 0) {
        return res.status(400).json({ error: "Title and sections are required" });
      }

      const test = await storage.createTest(
        { title, description, overallPassRuleJson, webhookUrl, published: false, showCorrectAnswers, timeLimitMinutes, maxAttempts, startPageContent, feedback },
        sections
      );

      res.status(201).json(test);
    } catch (error) {
      res.status(500).json({ error: "Failed to create test" });
    }
  });

  app.put("/api/tests/:id", requireAuthor, async (req, res) => {
    try {
      const { title, description, overallPassRuleJson, webhookUrl, sections, showCorrectAnswers, timeLimitMinutes, maxAttempts, startPageContent, feedback } = req.body;
      const test = await storage.updateTest(
        req.params.id,
        { title, description, overallPassRuleJson, webhookUrl, showCorrectAnswers, timeLimitMinutes, maxAttempts, startPageContent, feedback },
        sections
      );
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }
      res.json(test);
    } catch (error) {
      res.status(500).json({ error: "Failed to update test" });
    }
  });

  app.delete("/api/tests/:id", requireAuthor, async (req, res) => {
    try {
      const success = await storage.deleteTest(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Test not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete test" });
    }
  });

  // SCORM export
  app.get("/api/tests/:id/export/scorm", requireAuthor, async (req, res) => {
    try {
      const test = await storage.getTest(req.params.id);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      const sections = await storage.getTestSections(test.id);
      const exportSections = await Promise.all(
        sections.map(async (s) => {
          const topic = await storage.getTopic(s.topicId);
          const questions = await storage.getQuestionsByTopic(s.topicId);
          const courses = await storage.getTopicCourses(s.topicId);
          return {
            ...s,
            topic: topic!,
            questions,
            courses,
          };
        })
      );

      const buffer = await generateScormPackage({ test, sections: exportSections });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="test_${test.id}_scorm.zip"`
      );
      res.send(buffer);
    } catch (error) {
      console.error("SCORM export error:", error);
      res.status(500).json({ error: "Failed to export SCORM package" });
    }
  });

  // Learner tests - Learner only
  app.get("/api/learner/tests", requireLearner, async (req, res) => {
    try {
      const tests = await storage.getTests();
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t.name]));

      const testsWithSections = await Promise.all(
        tests.map(async (test) => {
          const sections = await storage.getTestSections(test.id);
          const sectionsWithNames = sections.map((s) => ({
            ...s,
            topicName: topicMap.get(s.topicId) || "Unknown",
          }));
          return { ...test, sections: sectionsWithNames };
        })
      );

      res.json(testsWithSections);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tests" });
    }
  });

  // Attempts - Learner only
  app.post("/api/tests/:testId/attempts/start", requireLearner, async (req, res) => {
    try {
      const test = await storage.getTest(req.params.testId);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      const sections = await storage.getTestSections(test.id);
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t.name]));

      const variant: TestVariant = { sections: [] };
      const allQuestionIds: string[] = [];

      for (const section of sections) {
        const questions = await storage.getQuestionsByTopic(section.topicId);
        const shuffled = questions.sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, section.drawCount);
        const qIds = selected.map((q) => q.id);

        variant.sections.push({
          topicId: section.topicId,
          topicName: topicMap.get(section.topicId) || "Unknown",
          questionIds: qIds,
        });

        allQuestionIds.push(...qIds);
      }

      const allQuestions = await storage.getQuestionsByIds(allQuestionIds);

      const attempt = await storage.createAttempt({
        userId: req.session.userId!,
        testId: test.id,
        testVersion: test.version || 1,
        variantJson: variant,
        answersJson: null,
        resultJson: null,
        startedAt: new Date(),
        finishedAt: null,
      });

      res.status(201).json({
        ...attempt,
        testTitle: test.title,
        questions: allQuestions,
      });
    } catch (error) {
      console.error("Start attempt error:", error);
      res.status(500).json({ error: "Failed to start attempt" });
    }
  });

  app.post("/api/attempts/:attemptId/finish", requireLearner, async (req, res) => {
    try {
      const attempt = await storage.getAttempt(req.params.attemptId);
      if (!attempt) {
        return res.status(404).json({ error: "Attempt not found" });
      }

      if (attempt.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { answers } = req.body;
      const variant = attempt.variantJson as TestVariant;
      const test = await storage.getTest(attempt.testId);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      const sections = await storage.getTestSections(test.id);
      const sectionMap = new Map(sections.map((s) => [s.topicId, s]));

      let totalCorrect = 0;
      let totalQuestions = 0;
      let totalEarnedPoints = 0;
      let totalPossiblePoints = 0;
      const topicResults: TopicResult[] = [];

      for (const variantSection of variant.sections) {
        const section = sectionMap.get(variantSection.topicId);
        const questions = await storage.getQuestionsByIds(variantSection.questionIds);
        const courses = await storage.getTopicCourses(variantSection.topicId);

        let sectionCorrect = 0;
        let sectionEarnedPoints = 0;
        let sectionPossiblePoints = 0;
        const sectionTotal = questions.length;

        for (const q of questions) {
          const answer = answers?.[q.id];
          const scoreRatio = checkAnswer(q, answer);
          const qPoints = q.points || 1;
          sectionPossiblePoints += qPoints;
          
          // For counting purposes, consider fully correct if score is 1
          if (scoreRatio === 1) {
            sectionCorrect++;
          }
          // Award partial points based on score ratio
          sectionEarnedPoints += qPoints * scoreRatio;
        }

        totalCorrect += sectionCorrect;
        totalQuestions += sectionTotal;
        totalEarnedPoints += sectionEarnedPoints;
        totalPossiblePoints += sectionPossiblePoints;

        // Use point-based percentage for pass evaluation (reflects partial credit)
        const sectionPercent = sectionPossiblePoints > 0 
          ? (sectionEarnedPoints / sectionPossiblePoints) * 100 
          : 0;
        const passRule = section?.topicPassRuleJson as PassRule | null;
        let passed: boolean | null = null;

        if (passRule) {
          if (passRule.type === "percent") {
            // Percentage pass rule uses points-based percentage
            passed = sectionPercent >= passRule.value;
          } else {
            // Count-based pass rule uses fully correct question count
            passed = sectionCorrect >= passRule.value;
          }
        }

        topicResults.push({
          topicId: variantSection.topicId,
          topicName: variantSection.topicName,
          correct: sectionCorrect,
          total: sectionTotal,
          percent: sectionPercent,
          earnedPoints: sectionEarnedPoints,
          possiblePoints: sectionPossiblePoints,
          passed,
          passRule,
          recommendedCourses: courses.map((c) => ({ title: c.title, url: c.url })),
        });
      }

      // Use point-based percentage for overall score (reflects partial credit)
      const overallPercent = totalPossiblePoints > 0 
        ? (totalEarnedPoints / totalPossiblePoints) * 100 
        : 0;
      const overallPassRule = test.overallPassRuleJson as PassRule;
      let overallPassed = true;

      if (overallPassRule.type === "percent") {
        // Percentage pass rule uses points-based percentage
        overallPassed = overallPercent >= overallPassRule.value;
      } else {
        // Count-based pass rule uses fully correct question count
        overallPassed = totalCorrect >= overallPassRule.value;
      }

      for (const tr of topicResults) {
        if (tr.passed === false) {
          overallPassed = false;
          break;
        }
      }

      const result: AttemptResult = {
        totalCorrect,
        totalQuestions,
        overallPercent,
        totalEarnedPoints,
        totalPossiblePoints,
        overallPassed,
        topicResults,
      };

      await storage.updateAttempt(attempt.id, {
        answersJson: answers,
        resultJson: result,
        finishedAt: new Date(),
      });

      res.json({ success: true, result });
    } catch (error) {
      console.error("Finish attempt error:", error);
      res.status(500).json({ error: "Failed to finish attempt" });
    }
  });

  app.get("/api/attempts/:attemptId/result", requireLearner, async (req, res) => {
    try {
      const attempt = await storage.getAttempt(req.params.attemptId);
      if (!attempt) {
        return res.status(404).json({ error: "Attempt not found" });
      }

      if (attempt.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const test = await storage.getTest(attempt.testId);

      res.json({
        ...attempt,
        testTitle: test?.title || "Unknown Test",
        result: attempt.resultJson as AttemptResult,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch result" });
    }
  });

  // Learner attempt history - grouped by test with comparison data
  app.get("/api/learner/attempts", requireLearner, async (req, res) => {
    try {
      const attempts = await storage.getAttemptsByUser(req.session.userId!);
      const tests = await storage.getTests();
      const testMap = new Map(tests.map((t) => [t.id, t]));

      // Filter completed attempts and sort by date (newest first)
      const completedAttempts = attempts
        .filter((a) => a.finishedAt !== null)
        .sort((a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime());

      // Group by test
      const groupedByTest: Record<string, {
        testId: string;
        testTitle: string;
        currentVersion: number;
        attempts: any[];
      }> = {};

      for (const attempt of completedAttempts) {
        const test = testMap.get(attempt.testId);
        const result = attempt.resultJson as AttemptResult | null;
        
        if (!groupedByTest[attempt.testId]) {
          groupedByTest[attempt.testId] = {
            testId: attempt.testId,
            testTitle: test?.title || "Unknown Test",
            currentVersion: test?.version || 1,
            attempts: [],
          };
        }
        
        groupedByTest[attempt.testId].attempts.push({
          id: attempt.id,
          testVersion: attempt.testVersion,
          finishedAt: attempt.finishedAt,
          overallPercent: result?.overallPercent || 0,
          overallPassed: result?.overallPassed || false,
          totalEarnedPoints: result?.totalEarnedPoints || 0,
          totalPossiblePoints: result?.totalPossiblePoints || 0,
        });
      }

      // Add comparison data (deltas, outdated flags)
      const testGroups = Object.values(groupedByTest).map((group) => {
        const attemptsWithComparison = group.attempts.map((attempt, index) => {
          const prevAttempt = group.attempts[index + 1];
          const delta = prevAttempt 
            ? attempt.overallPercent - prevAttempt.overallPercent 
            : null;
          const isOutdated = attempt.testVersion < group.currentVersion;
          
          return {
            ...attempt,
            delta,
            isOutdated,
          };
        });

        // Calculate overall improvement (first vs latest)
        const latestAttempt = group.attempts[0];
        const firstAttempt = group.attempts[group.attempts.length - 1];
        const overallImprovement = group.attempts.length > 1 
          ? latestAttempt.overallPercent - firstAttempt.overallPercent 
          : null;

        return {
          testId: group.testId,
          testTitle: group.testTitle,
          currentVersion: group.currentVersion,
          attemptCount: group.attempts.length,
          overallImprovement,
          attempts: attemptsWithComparison,
        };
      });

      res.json(testGroups);
    } catch (error) {
      console.error("Fetch learner attempts error:", error);
      res.status(500).json({ error: "Failed to fetch attempt history" });
    }
  });

  // Analytics - Author only
  app.get("/api/analytics", requireAuthor, async (req, res) => {
    try {
      const tests = await storage.getTests();
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t.name]));
      const allAttempts = await storage.getAllAttempts();

      // Only consider completed attempts (those with results)
      const completedAttempts = allAttempts.filter((a) => a.resultJson !== null);

      // Aggregate stats per test
      const testStats = tests.map((test) => {
        const testAttempts = completedAttempts.filter((a) => a.testId === test.id);
        const totalAttempts = testAttempts.length;
        
        if (totalAttempts === 0) {
          return {
            testId: test.id,
            testTitle: test.title,
            totalAttempts: 0,
            passRate: 0,
            avgScore: 0,
            avgPercent: 0,
          };
        }

        const passedAttempts = testAttempts.filter((a) => {
          const result = a.resultJson as AttemptResult | null;
          return result?.overallPassed === true;
        }).length;

        const avgPercent = testAttempts.reduce((sum, a) => {
          const result = a.resultJson as AttemptResult | null;
          return sum + (result?.overallPercent || 0);
        }, 0) / totalAttempts;

        const avgScore = testAttempts.reduce((sum, a) => {
          const result = a.resultJson as AttemptResult | null;
          return sum + (result?.totalEarnedPoints || 0);
        }, 0) / totalAttempts;

        return {
          testId: test.id,
          testTitle: test.title,
          totalAttempts,
          passRate: (passedAttempts / totalAttempts) * 100,
          avgScore,
          avgPercent,
        };
      });

      // Aggregate stats per topic
      const topicStatsMap = new Map<string, {
        topicId: string;
        topicName: string;
        totalAppearances: number;
        totalEarnedPoints: number;
        totalPossiblePoints: number;
        passedCount: number;
        failedCount: number;
      }>();

      for (const topic of topics) {
        topicStatsMap.set(topic.id, {
          topicId: topic.id,
          topicName: topic.name,
          totalAppearances: 0,
          totalEarnedPoints: 0,
          totalPossiblePoints: 0,
          passedCount: 0,
          failedCount: 0,
        });
      }

      for (const attempt of completedAttempts) {
        const result = attempt.resultJson as AttemptResult | null;
        if (!result?.topicResults) continue;

        for (const tr of result.topicResults) {
          const stats = topicStatsMap.get(tr.topicId);
          if (stats) {
            stats.totalAppearances++;
            stats.totalEarnedPoints += tr.earnedPoints;
            stats.totalPossiblePoints += tr.possiblePoints;
            // Only count passed/failed when a pass rule was set (passed is not null)
            if (tr.passed === true) {
              stats.passedCount++;
            } else if (tr.passed === false) {
              stats.failedCount++;
            }
            // passed === null means no pass rule was set, so we don't count it
          }
        }
      }

      const topicStats = Array.from(topicStatsMap.values()).map((stats) => {
        // For pass rate, only consider topics that have pass/fail outcomes
        const topicWithPassRuleCount = stats.passedCount + stats.failedCount;
        const hasPassRule = topicWithPassRuleCount > 0;
        return {
          topicId: stats.topicId,
          topicName: stats.topicName,
          totalAppearances: stats.totalAppearances,
          avgPercent: stats.totalPossiblePoints > 0 
            ? (stats.totalEarnedPoints / stats.totalPossiblePoints) * 100 
            : 0,
          // Pass rate is calculated only among attempts where a pass rule was set
          passRate: hasPassRule 
            ? (stats.passedCount / topicWithPassRuleCount) * 100 
            : null,
          hasPassRule,
          failureCount: stats.failedCount,
        };
      });

      // Attempt trends by day (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentAttempts = completedAttempts.filter(
        (a) => a.finishedAt && new Date(a.finishedAt) >= thirtyDaysAgo
      );

      const trendsMap = new Map<string, { date: string; count: number; avgPercent: number; passed: number }>();

      for (const attempt of recentAttempts) {
        const dateStr = new Date(attempt.finishedAt!).toISOString().split("T")[0];
        const result = attempt.resultJson as AttemptResult | null;
        const existing = trendsMap.get(dateStr) || { date: dateStr, count: 0, avgPercent: 0, passed: 0 };
        
        existing.count++;
        existing.avgPercent += result?.overallPercent || 0;
        if (result?.overallPassed) existing.passed++;
        
        trendsMap.set(dateStr, existing);
      }

      const trends = Array.from(trendsMap.values())
        .map((t) => ({
          date: t.date,
          attempts: t.count,
          avgPercent: t.avgPercent / t.count,
          passRate: (t.passed / t.count) * 100,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Overall summary
      const summary = {
        totalTests: tests.length,
        totalAttempts: completedAttempts.length,
        overallPassRate: completedAttempts.length > 0
          ? (completedAttempts.filter((a) => (a.resultJson as AttemptResult | null)?.overallPassed).length / completedAttempts.length) * 100
          : 0,
        overallAvgPercent: completedAttempts.length > 0
          ? completedAttempts.reduce((sum, a) => sum + ((a.resultJson as AttemptResult | null)?.overallPercent || 0), 0) / completedAttempts.length
          : 0,
      };

      res.json({
        summary,
        testStats,
        topicStats,
        trends,
      });
    } catch (error) {
      console.error("Analytics error:", error);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  return httpServer;
}

// Returns a score between 0 and 1 (partial credit support)
function checkAnswer(question: any, answer: any): number {
  if (answer === undefined || answer === null) return 0;

  const correct = question.correctJson as any;

  if (question.type === "single") {
    // Single choice: all or nothing
    return answer === correct.correctIndex ? 1 : 0;
  }

  if (question.type === "multiple") {
    // Multiple choice: partial credit based on correct selections
    // Score = (correct selections - incorrect selections) / total correct options
    // Minimum score is 0
    const correctIndices = new Set(correct.correctIndices as number[]);
    const answerList = (answer || []) as number[];
    const totalCorrect = correctIndices.size;
    
    if (totalCorrect === 0) return 0;
    
    let correctSelections = 0;
    let incorrectSelections = 0;
    
    for (const idx of answerList) {
      if (correctIndices.has(idx)) {
        correctSelections++;
      } else {
        incorrectSelections++;
      }
    }
    
    // Partial credit formula: (correct - incorrect) / total, minimum 0
    const score = Math.max(0, (correctSelections - incorrectSelections) / totalCorrect);
    return score;
  }

  if (question.type === "matching") {
    // Matching: partial credit for each correct pair
    const pairs = answer || {};
    const correctPairs = correct.pairs || [];
    const totalPairs = correctPairs.length;
    
    if (totalPairs === 0) return 0;
    
    let correctCount = 0;
    for (const p of correctPairs) {
      if (pairs[p.left] === p.right) {
        correctCount++;
      }
    }
    
    return correctCount / totalPairs;
  }

  if (question.type === "ranking") {
    // Ranking: partial credit for correctly positioned items
    const order = answer || [];
    const correctOrder = correct.correctOrder;
    
    if (correctOrder.length === 0) return 0;
    if (order.length !== correctOrder.length) return 0;
    
    let correctPositions = 0;
    for (let i = 0; i < correctOrder.length; i++) {
      if (order[i] === correctOrder[i]) {
        correctPositions++;
      }
    }
    
    return correctPositions / correctOrder.length;
  }

  return 0;
}
