import { Router, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { requireAuthor } from "../middleware/auth";

const router = Router();

// ============================================
// Rate limiting (in-memory)
// ============================================
const rateLimits = {
  packages: new Map<string, { count: number; resetAt: number }>(),
  sessions: new Map<string, { count: number; resetAt: number }>(),
};

function checkRateLimit(type: "package" | "session", key: string, limit: number): boolean {
  const map = type === "package" ? rateLimits.packages : rateLimits.sessions;
  const now = Date.now();
  const entry = map.get(key);
  
  if (!entry || entry.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }
  
  if (entry.count >= limit) {
    return false;
  }
  
  entry.count++;
  return true;
}

// ============================================
// Signature verification
// ============================================
function verifyTelemetrySignature(
  secretKey: string, 
  packageId: string, 
  sessionId: string, 
  timestamp: string, 
  data: any, 
  signature: string
): boolean {
  const ts = parseInt(timestamp, 10);
  const now = Date.now();
  
  // Check timestamp freshness (5 minutes)
  if (isNaN(ts) || Math.abs(now - ts) > 5 * 60 * 1000) {
    console.log("[Telemetry] Timestamp expired:", { ts, now, diff: Math.abs(now - ts) });
    return false;
  }
  
  // Compute expected signature
  const dataToSign = `${packageId}:${sessionId}:${timestamp}:${JSON.stringify(data || {})}`;
  const expectedSignature = crypto
    .createHmac("sha256", secretKey)
    .update(dataToSign)
    .digest("hex");
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

// ============================================
// POST /api/scorm-telemetry/start - Начало попытки
// ============================================
router.post("/scorm-telemetry/start", async (req: Request, res: Response) => {
  try {
    const { packageId, sessionId, signature, timestamp, data } = req.body;
    
    if (!packageId || !sessionId || !signature || !timestamp) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    const pkg = await storage.getScormPackage(packageId);
    if (!pkg || !pkg.isActive) {
      return res.status(404).json({ error: "Package not found or inactive" });
    }
    
    if (!verifyTelemetrySignature(pkg.secretKey, packageId, sessionId, timestamp, data, signature)) {
      return res.status(401).json({ error: "Invalid signature or expired timestamp" });
    }
    
    if (!checkRateLimit("package", packageId, 1000)) {
      return res.status(429).json({ error: "Package rate limit exceeded" });
    }
    if (!checkRateLimit("session", `${packageId}:${sessionId}`, 60)) {
      return res.status(429).json({ error: "Session rate limit exceeded" });
    }
    
    // attemptNumber из клиента или следующий номер
    const attemptNumber = data?.attemptNumber || await storage.getNextAttemptNumber(packageId, sessionId);
    
    // Ищем конкретную попытку по номеру
    let attempt = await storage.getScormAttemptBySession(packageId, sessionId, attemptNumber);
    
    if (!attempt) {
      // Создаём новую попытку
      attempt = await storage.createScormAttempt({
        id: crypto.randomUUID(),
        packageId: pkg.id,
        sessionId,
        attemptNumber,
        lmsUserId: data?.lmsUserId || null,
        lmsUserName: data?.lmsUserName || null,
        lmsUserEmail: data?.lmsUserEmail || null,
        lmsUserOrg: data?.lmsUserOrg || null,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      });
      console.log("[Telemetry] New attempt created:", attempt.id, "attemptNumber:", attemptNumber);
    } else {
      await storage.updateScormAttempt(attempt.id, { lastActivityAt: new Date() });
      console.log("[Telemetry] Existing attempt resumed:", attempt.id, "attemptNumber:", attemptNumber);
    }
    
    res.json({ success: true, attemptId: attempt.id, attemptNumber });
  } catch (error) {
    console.error("Telemetry start error:", error);
    res.status(500).json({ error: "Failed to start attempt" });
  }
});

// ============================================
// POST /api/scorm-telemetry/answer - Сохранение ответа
// ============================================
router.post("/scorm-telemetry/answer", async (req: Request, res: Response) => {
  try {
    const { packageId, sessionId, signature, timestamp, data } = req.body;
    
    if (!packageId || !sessionId || !signature || !timestamp) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    const pkg = await storage.getScormPackage(packageId);
    if (!pkg || !pkg.isActive) {
      return res.status(404).json({ error: "Package not found or inactive" });
    }
    
    if (!verifyTelemetrySignature(pkg.secretKey, packageId, sessionId, timestamp, data, signature)) {
      return res.status(401).json({ error: "Invalid signature or expired timestamp" });
    }
    
    if (!checkRateLimit("package", packageId, 1000)) {
      return res.status(429).json({ error: "Package rate limit exceeded" });
    }
    if (!checkRateLimit("session", `${packageId}:${sessionId}`, 60)) {
      return res.status(429).json({ error: "Session rate limit exceeded" });
    }
    
    // attemptNumber для правильной привязки ответа
    const attemptNumber = data?.attemptNumber;
    const attempt = attemptNumber 
      ? await storage.getScormAttemptBySession(packageId, sessionId, attemptNumber)
      : await storage.getScormAttemptBySession(packageId, sessionId);
    
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found. Call /start first." });
    }
    
    await storage.createScormAnswer({
      id: crypto.randomUUID(),
      attemptId: attempt.id,
      questionId: data.questionId,
      questionPrompt: data.questionPrompt || "",
      questionType: data.questionType || "single",
      topicId: data.topicId || null,
      topicName: data.topicName || null,
      difficulty: data.difficulty ?? null,
      userAnswerJson: data.userAnswer,
      correctAnswerJson: data.correctAnswer,
      isCorrect: !!data.isCorrect,
      points: data.points || 0,
      maxPoints: data.maxPoints || 1,
      optionsJson: data.options || null,
      leftItemsJson: data.leftItems || null,
      rightItemsJson: data.rightItems || null,
      itemsJson: data.items || null,
      levelIndex: data.levelIndex ?? null,
      levelName: data.levelName || null,
      answeredAt: new Date(),
    });
    
    await storage.updateScormAttempt(attempt.id, { lastActivityAt: new Date() });
    
    res.json({ success: true });
  } catch (error) {
    console.error("Telemetry answer error:", error);
    res.status(500).json({ error: "Failed to save answer" });
  }
});

// ============================================
// POST /api/scorm-telemetry/finish - Завершение попытки
// ============================================
router.post("/scorm-telemetry/finish", async (req: Request, res: Response) => {
  try {
    const { packageId, sessionId, signature, timestamp, data } = req.body;
    
    if (!packageId || !sessionId || !signature || !timestamp) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    const pkg = await storage.getScormPackage(packageId);
    if (!pkg || !pkg.isActive) {
      return res.status(404).json({ error: "Package not found or inactive" });
    }
    
    if (!verifyTelemetrySignature(pkg.secretKey, packageId, sessionId, timestamp, data, signature)) {
      return res.status(401).json({ error: "Invalid signature or expired timestamp" });
    }
    
    if (!checkRateLimit("package", packageId, 1000)) {
      return res.status(429).json({ error: "Package rate limit exceeded" });
    }
    
    // attemptNumber для завершения правильной попытки
    const attemptNumber = data?.attemptNumber;
    const attempt = attemptNumber
      ? await storage.getScormAttemptBySession(packageId, sessionId, attemptNumber)
      : await storage.getScormAttemptBySession(packageId, sessionId);
    
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }
    
    console.log("[Telemetry] Received data.failedTopicCourses:", JSON.stringify(data?.failedTopicCourses));
    
    await storage.updateScormAttempt(attempt.id, {
      finishedAt: new Date(),
      lastActivityAt: new Date(),
      resultPercent: Math.round(data?.percent || 0),
      resultPassed: !!data?.passed,
      totalPoints: data?.earnedPoints || 0,
      maxPoints: data?.possiblePoints || 0,
      totalQuestions: data?.totalQuestions || 0,
      correctAnswers: data?.correctAnswers || 0,
      achievedLevelsJson: data?.achievedLevels || null,
      failedTopicCoursesJson: data?.failedTopicCourses || null,
    });
    
    console.log("[Telemetry] Attempt finished:", attempt.id, "attemptNumber:", attemptNumber, {
      percent: data?.percent,
      passed: data?.passed,
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("Telemetry finish error:", error);
    res.status(500).json({ error: "Failed to finish attempt" });
  }
});

// ============================================
// SCORM Package Management (for authors)
// ============================================

// GET /api/scorm-packages - Список пакетов
router.get("/scorm-packages", requireAuthor, async (req: Request, res: Response) => {
  try {
    const packages = await storage.getScormPackages();
    
    const packagesWithStats = await Promise.all(packages.map(async (pkg) => {
      const attempts = await storage.getScormAttemptsByPackage(pkg.id);
      const completedAttempts = attempts.filter(a => a.finishedAt);
      
      return {
        ...pkg,
        stats: {
          totalAttempts: attempts.length,
          completedAttempts: completedAttempts.length,
          uniqueUsers: new Set(attempts.map(a => a.lmsUserId).filter(Boolean)).size,
        },
      };
    }));
    
    res.json(packagesWithStats);
  } catch (error) {
    console.error("Get SCORM packages error:", error);
    res.status(500).json({ error: "Failed to get packages" });
  }
});

// GET /api/scorm-packages/:id - Детали пакета
router.get("/scorm-packages/:id", requireAuthor, async (req: Request, res: Response) => {
  try {
    const pkg = await storage.getScormPackage(req.params.id);
    if (!pkg) {
      return res.status(404).json({ error: "Package not found" });
    }
    
    const attempts = await storage.getScormAttemptsByPackage(pkg.id);
    
    res.json({
      ...pkg,
      attempts,
    });
  } catch (error) {
    console.error("Get SCORM package error:", error);
    res.status(500).json({ error: "Failed to get package" });
  }
});

// POST /api/scorm-packages/:id/regenerate-key - Перегенерация ключа
router.post("/scorm-packages/:id/regenerate-key", requireAuthor, async (req: Request, res: Response) => {
  try {
    const pkg = await storage.getScormPackage(req.params.id);
    if (!pkg) {
      return res.status(404).json({ error: "Package not found" });
    }
    
    const newSecretKey = crypto.randomBytes(32).toString("hex");
    
    await storage.updateScormPackage(pkg.id, {
      secretKey: newSecretKey,
    });
    
    res.json({ 
      success: true, 
      message: "Secret key regenerated. Old SCORM packages will no longer work.",
    });
  } catch (error) {
    console.error("Regenerate key error:", error);
    res.status(500).json({ error: "Failed to regenerate key" });
  }
});

// POST /api/scorm-packages/:id/deactivate - Деактивация пакета
router.post("/scorm-packages/:id/deactivate", requireAuthor, async (req: Request, res: Response) => {
  try {
    const pkg = await storage.getScormPackage(req.params.id);
    if (!pkg) {
      return res.status(404).json({ error: "Package not found" });
    }
    
    await storage.updateScormPackage(pkg.id, {
      isActive: false,
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("Deactivate package error:", error);
    res.status(500).json({ error: "Failed to deactivate package" });
  }
});

// POST /api/scorm-packages/:id/activate - Активация пакета
router.post("/scorm-packages/:id/activate", requireAuthor, async (req: Request, res: Response) => {
  try {
    const pkg = await storage.getScormPackage(req.params.id);
    if (!pkg) {
      return res.status(404).json({ error: "Package not found" });
    }
    
    await storage.updateScormPackage(pkg.id, {
      isActive: true,
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("Activate package error:", error);
    res.status(500).json({ error: "Failed to activate package" });
  }
});

export default router;