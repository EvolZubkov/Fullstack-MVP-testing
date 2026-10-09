import { Router, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { logger } from "../logger";
import { parseTestVersion } from "@shared/lms-export/meta";

const router = Router();

// ============================================
// PRD-56: то, что пакет сообщает О ПРОХОЖДЕНИИ
// ============================================

/**
 * Снимок публикации по номеру версии, сообщённому пакетом (FR-19a).
 *
 * `null` во всех сомнительных случаях: версия не сообщена, сообщена мусором, снимка с таким
 * номером нет (тест заведён заново, снимок подчищен `pruneSnapshots`) или база не ответила.
 * Прохождение тогда идёт в разрез отдельной строкой «Версия не указана» — приписать его
 * текущей версии значит сделать разрез слепым ровно там, где он и нужен.
 *
 * Сбой чтения не имеет права сорвать НАЧАЛО прохождения: телеметрия — аналитика, и её потеря
 * не должна стоить участнику попытки.
 */
async function resolveSnapshotId(testId: string | null, version: unknown): Promise<string | null> {
  const parsed = parseTestVersion(
    version === undefined || version === null ? null : String(version),
  );
  if (!testId || parsed === null) return null;

  try {
    const snapshot = await storage.getSnapshotByVersion(testId, parsed);
    if (snapshot) return snapshot.id;
    logger.warn(
      `PRD-56: версия ${parsed} теста ${testId} не найдена — прохождение без версии`,
      "scorm",
    );
  } catch (error) {
    logger.warn("PRD-56: снимок версии не прочитан — " + (error as Error).message, "scorm");
  }
  return null;
}

/**
 * Карта «тема -> вариант» из тела запроса (FR-18).
 *
 * Тело приходит из LMS-окружения, которым мы не управляем, поэтому читается защитно: не
 * объект, массив или значения не-строки — значит вариантов нет. Пустая карта пишется как
 * `null`: у теста без вариантов их и правда нет.
 */
/**
 * Учётная запись по идентификатору обучающегося в LMS (PRD-54 BR-54-31, BR-54-33).
 *
 * `null` — совпадения нет либо идентификатор не пришёл: прохождение остаётся несвязанным, как
 * было до этой работы. Ошибка поиска тоже даёт `null`: телеметрия — поток из чужой LMS, и ронять
 * приём прохождения из-за недоступной сверки нельзя, данные о нём важнее связи с человеком.
 */
async function linkedUserId(learnerId: unknown): Promise<string | null> {
  if (typeof learnerId !== "string" || !learnerId.trim()) return null;
  try {
    const user = await storage.getUserByLmsLearnerId(learnerId);
    return user?.id ?? null;
  } catch (error) {
    logger.warn("Связывание прохождения по learner_id не выполнено — " + (error as Error).message, "scorm");
    return null;
  }
}

function readDeliveredForms(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const out: Record<string, string> = {};
  for (const [topicId, formId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof formId === "string" && formId !== "") out[topicId] = formId;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Значения шкал прохождения — «ключ -> число» (FR-21).
 *
 * Та же колонка и та же форма, что у импорта выгрузки (PRD-54): у одной величины не должно
 * оказаться двух представлений. Нечисловое значение отбрасывается — шкала измеряется числом.
 */
function readScaleValues(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Значения показателей прохождения — «имя -> строка» (FR-21).
 *
 * Строкой, а не числом: показатель бывает и числом, и кодом исхода, и выгрузка хранит его так же.
 */
function readVariableValues(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    out[name] = String(value);
  }
  return Object.keys(out).length > 0 ? out : null;
}

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
    logger.warn(`Timestamp expired: ts=${ts} now=${now} diff=${Math.abs(now - ts)}`, "scorm");
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
      // PRD-56 FR-19a/FR-18: версия публикации и выданные варианты известны ровно в начале
      // попытки — пакет сообщает их вместе со стартом, как и состав выдачи (PRD-55).
      const snapshotId = await resolveSnapshotId(pkg.testId, data?.publicationVersion);
      const formsJson = readDeliveredForms(data?.deliveredForms);

      // Создаём новую попытку
      attempt = await storage.createScormAttempt({
        id: crypto.randomUUID(),
        packageId: pkg.id,
        sessionId,
        attemptNumber,
        // PRD-54 BR-54-31: прохождение связывается с учётной записью по идентификатору
        // обучающегося в LMS. До этого телеметрия не связывалась ВООБЩЕ: один человек,
        // прошедший тест в LMS и попавший в выгрузку, считался двумя участниками, и номер
        // попытки их не склеивал — связывать было нечем.
        //
        // Псевдоним здесь не считается и считаться не может: подразделения и должности
        // рантайм LMS не сообщает, а `learner_id` строго лучше — он не меняется ни при
        // переводе человека, ни при смене секрета инстанса.
        userId: await linkedUserId(data?.lmsUserId),
        lmsUserId: data?.lmsUserId || null,
        lmsUserName: data?.lmsUserName || null,
        lmsUserEmail: data?.lmsUserEmail || null,
        lmsUserOrg: data?.lmsUserOrg || null,
        snapshotId,
        formsJson,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      });
      logger.info(`New attempt created: ${attempt.id} #${attemptNumber} session=${sessionId} pkg=${packageId}`, "scorm");

      // PRD-55 (FR-01/FR-07): единственное место, где сервер узнаёт СОСТАВ выданной формы —
      // `answer` описывает отвеченное, а экспозиция это показ. Инкремент привязан к СОЗДАНИЮ
      // прохождения: продолжение той же попытки счётчик не двигает. Пакеты, собранные до
      // появления поля, его не шлют — по ним экспозиция просто не считается.
      const deliveredIds: string[] = Array.isArray(data?.deliveredQuestionIds)
        ? data.deliveredQuestionIds.filter((id: unknown): id is string => typeof id === "string")
        : [];
      if (pkg.testId && deliveredIds.length > 0) {
        try {
          await storage.recordDeliveries(deliveredIds, pkg.testId, new Date());
        } catch (error) {
          logger.warn("PRD-55: выдача заданий не записана — " + (error as Error).message, "scorm");
        }
      }
    } else {
      await storage.updateScormAttempt(attempt.id, { lastActivityAt: new Date() });
      logger.info(`Attempt resumed: ${attempt.id} #${attemptNumber} session=${sessionId}`, "scorm");
    }
    
    res.json({ success: true, attemptId: attempt.id, attemptNumber });
  } catch (error) {
    logger.error("Telemetry start error: " + (error as Error).message, "scorm");
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
      // Время на задании: пакеты, выданные до измерения, поля не шлют вовсе — тогда NULL,
      // потому что ноль означал бы «ответил мгновенно».
      latencyMs: typeof data.latencyMs === "number" && data.latencyMs > 0 ? Math.round(data.latencyMs) : null,
      answeredAt: new Date(),
    });
    
    await storage.updateScormAttempt(attempt.id, { lastActivityAt: new Date() });
    
    res.json({ success: true });
  } catch (error) {
    logger.error("Telemetry answer error: " + (error as Error).message, "scorm");
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
    
    logger.debug(`Finish received failedTopicCourses: ${JSON.stringify(data?.failedTopicCourses)}`, "scorm");
    
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
      // PRD-56 FR-21: шкалы и показатели прохождения. Колонки те же, что заполняет импорт
      // выгрузки (PRD-54): до этого живая телеметрия их не сообщала вовсе, и профиль по
      // шкалам не видел ни одного прохождения из LMS.
      scalesJson: readScaleValues(data?.scales),
      variablesJson: readVariableValues(data?.variables),
    });
    
    logger.info(`Attempt finished: ${attempt.id} #${attemptNumber} percent=${data?.percent}% passed=${data?.passed}`, "scorm");
    
    res.json({ success: true });
  } catch (error) {
    logger.error("Telemetry finish error: " + (error as Error).message, "scorm");
    res.status(500).json({ error: "Failed to finish attempt" });
  }
});

// ============================================
// SCORM Package Management (for authors)
// ============================================

// GET /api/scorm-packages - Список пакетов
router.get("/scorm-packages", requirePermission("scormPackages.manage"), async (req: Request, res: Response) => {
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
    logger.error("Get SCORM packages error: " + (error as Error).message, "scorm")
    res.status(500).json({ error: "Failed to get packages" });
  }
});

// GET /api/scorm-packages/:id - Детали пакета
router.get("/scorm-packages/:id", requirePermission("scormPackages.manage"), async (req: Request, res: Response) => {
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
    logger.error("Get SCORM package error: " + (error as Error).message, "scorm");
    res.status(500).json({ error: "Failed to get package" });
  }
});

// POST /api/scorm-packages/:id/regenerate-key - Перегенерация ключа
router.post("/scorm-packages/:id/regenerate-key", requirePermission("scormPackages.manage"), async (req: Request, res: Response) => {
  try {
    const pkg = await storage.getScormPackage(req.params.id);
    if (!pkg) {
      return res.status(404).json({ error: "Package not found" });
    }
    
    const newSecretKey = crypto.randomBytes(32).toString("hex");
    
    await storage.updateScormPackage(pkg.id, {
      secretKey: newSecretKey,
    });
    logger.info(`Secret key regenerated for package: ${pkg.id}`, "scorm");
    
    res.json({ 
      success: true, 
      message: "Secret key regenerated. Old SCORM packages will no longer work.",
    });
  } catch (error) {
    logger.error("Regenerate key error: " + (error as Error).message, "scorm");
    res.status(500).json({ error: "Failed to regenerate key" });
  }
});

// POST /api/scorm-packages/:id/deactivate - Деактивация пакета
router.post("/scorm-packages/:id/deactivate", requirePermission("scormPackages.manage"), async (req: Request, res: Response) => {
  try {
    const pkg = await storage.getScormPackage(req.params.id);
    if (!pkg) {
      return res.status(404).json({ error: "Package not found" });
    }
    
    await storage.updateScormPackage(pkg.id, {
      isActive: false,
    });
    logger.info(`Package deactivated: ${pkg.id}`, "scorm");
    
    res.json({ success: true });
  } catch (error) {
    logger.error("Deactivate package error: " + (error as Error).message, "scorm");
    res.status(500).json({ error: "Failed to deactivate package" });
  }
});

// POST /api/scorm-packages/:id/activate - Активация пакета
router.post("/scorm-packages/:id/activate", requirePermission("scormPackages.manage"), async (req: Request, res: Response) => {
  try {
    const pkg = await storage.getScormPackage(req.params.id);
    if (!pkg) {
      return res.status(404).json({ error: "Package not found" });
    }
    
    await storage.updateScormPackage(pkg.id, {
      isActive: true,
    });
    logger.info(`Package activated: ${pkg.id}`, "scorm");
    
    res.json({ success: true });
  } catch (error) {
    logger.error("Activate package error: " + (error as Error).message, "scorm");
    res.status(500).json({ error: "Failed to activate package" });
  }
});

export default router;