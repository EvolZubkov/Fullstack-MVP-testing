import express, { type Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import MemoryStore from "memorystore";
import multer from "multer";
import * as XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { storage } from "./storage";
import { generateScormPackage } from "./scorm-exporter";
import type { TestVariant, AttemptResult, TopicResult, PassRule, Question } from "@shared/schema";
import { sendPasswordResetEmail } from "./email";
import { maskEmail } from "./utils/mask-email";


const upload = multer({ storage: multer.memoryStorage() });
const mediaDir = path.resolve(process.cwd(), "uploads", "media");
fs.mkdirSync(mediaDir, { recursive: true });

const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${Date.now()}_${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB на dev, подстрой
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("audio/") ||
      file.mimetype.startsWith("video/");
    cb(ok ? null : new Error("Unsupported media type") as any, ok);
  },
});


declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

function rejectBase64MediaUrl(mediaUrl: unknown, res: Response) {
  if (typeof mediaUrl !== "string") return false;
  const v = mediaUrl.trim();
  if (v.startsWith("data:")) {
    res.status(413).json({
      error:
        "Base64 (data:...) запрещён. Загрузи файл через /api/media/upload и сохрани url вида /uploads/media/...",
    });
    return true;
  }
  return false;
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
  // CORS для телеметрии SCORM (временно для тестирования)
  app.use("/api/scorm-telemetry", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

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
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      const user = await storage.validatePassword(email, password);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Проверяем статус пользователя
      if (user.status === "inactive") {
        return res.status(403).json({ error: "Account is deactivated. Please contact administrator." });
      }

      // Обновляем lastLoginAt
      await storage.updateUserLastLogin(user.id);

      req.session.userId = user.id;
      res.json({ 
        user: { 
          id: user.id, 
          email: user.email, 
          name: user.name,
          role: user.role,
          status: user.status,
          mustChangePassword: user.mustChangePassword,
          gdprConsent: user.gdprConsent,
        } 
      });
    } catch (error) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.post(
    "/api/media/upload",
    requireAuth,
    mediaUpload.single("file"),
    (req: Request, res: Response) => {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const url = `/uploads/media/${req.file.filename}`;
      res.json({
        url,
        mime: req.file.mimetype,
        originalName: req.file.originalname,
        size: req.file.size,
      });
    }
  );

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Проверяем статус
    if (user.status === "inactive") {
      req.session.destroy(() => {});
      return res.status(403).json({ error: "Account is deactivated" });
    }

    res.json({ 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        gdprConsent: user.gdprConsent,
      } 
    });
 });

  // ============================================
  // Password Reset routes (Public)
  // ============================================

  // Проверка email для подсказки (без отправки письма)
  app.post("/api/auth/check-email", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        return res.json({ exists: false, maskedEmail: null });
      }

      return res.json({ 
        exists: true, 
        maskedEmail: maskEmail(user.email) 
      });
    } catch (error) {
      console.error("Check email error:", error);
      res.status(500).json({ error: "Failed to check email" });
    }
  });

  
  // Запрос сброса пароля
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const user = await storage.getUserByEmail(email);
      
      // Всегда возвращаем успех, чтобы не раскрывать существование email
      if (!user) {
        return res.json({ 
          success: true, 
          message: "If the email exists, a reset link has been sent.",
          maskedEmail: null 
        });
      }

      // Проверяем лимит запросов (3 в час)
      const recentCount = await storage.getRecentTokensCount(user.id, 1);
      if (recentCount >= 3) {
        return res.status(429).json({ error: "Too many reset requests. Please try again later." });
      }

      // Генерируем токен
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHmac("sha256", process.env.SESSION_SECRET || "secret")
        .update(rawToken)
        .digest("hex");

      // Получаем IP
      const requestIp = req.ip || req.socket.remoteAddress || "unknown";

      // Сохраняем токен
      await storage.createPasswordResetToken(user.id, tokenHash, requestIp);

      // Формируем ссылку для сброса пароля
      const resetLink = `${req.protocol}://${req.get("host")}/reset-password?token=${rawToken}`;

      // Отправляем email (или выводим в консоль если SMTP не настроен)
      await sendPasswordResetEmail(user.email, resetLink, user.name || undefined);

      res.json({ 
        success: true, 
        message: "If the email exists, a reset link has been sent.",
        maskedEmail: maskEmail(user.email)
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  });

  // Проверка токена (для отображения формы)
  app.get("/api/auth/verify-reset-token", async (req, res) => {
    try {
      const { token } = req.query;
      
      if (!token || typeof token !== "string") {
        return res.status(400).json({ error: "Token is required", valid: false });
      }

      const tokenHash = crypto.createHmac("sha256", process.env.SESSION_SECRET || "secret")
        .update(token)
        .digest("hex");

      const resetToken = await storage.getPasswordResetToken(tokenHash);

      if (!resetToken) {
        return res.json({ valid: false, error: "Invalid token" });
      }

      if (resetToken.usedAt) {
        return res.json({ valid: false, error: "Token already used" });
      }

      if (new Date(resetToken.expiresAt) < new Date()) {
        return res.json({ valid: false, error: "Token expired" });
      }

      res.json({ valid: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to verify token", valid: false });
    }
  });

  // Сброс пароля с токеном
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      
      if (!token || !newPassword) {
        return res.status(400).json({ error: "Token and new password are required" });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const passwordRegex = /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/;
      if (!passwordRegex.test(newPassword)) {
        return res.status(400).json({ error: "Password can only contain Latin letters, numbers and special characters" });
      }

      const tokenHash = crypto.createHmac("sha256", process.env.SESSION_SECRET || "secret")
        .update(token)
        .digest("hex");

      const resetToken = await storage.getPasswordResetToken(tokenHash);

      if (!resetToken) {
        return res.status(400).json({ error: "Invalid token" });
      }

      if (resetToken.usedAt) {
        return res.status(400).json({ error: "Token already used" });
      }

      if (new Date(resetToken.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Token expired" });
      }

      // Обновляем пароль
      await storage.updateUserPassword(resetToken.userId, newPassword);
      
      // Помечаем токен как использованный
      await storage.markTokenAsUsed(resetToken.id);

      res.json({ success: true, message: "Password has been reset successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // ============================================
  // First Login Flow routes
  // ============================================

  // Завершение первого входа (GDPR + смена пароля + имя)
  app.post("/api/auth/complete-first-login", requireAuth, async (req, res) => {
    try {
      const { gdprConsent, newPassword, name } = req.body;
      const userId = req.session.userId!;

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Проверяем GDPR согласие
      if (!gdprConsent) {
        return res.status(400).json({ error: "GDPR consent is required" });
      }

      // Проверяем пароль если требуется смена
      if (user.mustChangePassword) {
        if (!newPassword) {
          return res.status(400).json({ error: "New password is required" });
        }
        if (newPassword.length < 8) {
          return res.status(400).json({ error: "Password must be at least 8 characters" });
        }

        const passwordRegex = /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/;
        if (!passwordRegex.test(newPassword)) {
          return res.status(400).json({ error: "Password can only contain Latin letters, numbers and special characters" });
        }
        await storage.updateUserPassword(userId, newPassword);
      }

      // Обновляем данные пользователя
      const updateData: any = {
        gdprConsent: true,
        gdprConsentAt: new Date(),
        mustChangePassword: false,
        status: "active",
      };

      if (name && name.trim()) {
        updateData.name = name.trim();
      }

      const updatedUser = await storage.updateUser(userId, updateData);

      res.json({
        user: {
          id: updatedUser!.id,
          email: updatedUser!.email,
          name: updatedUser!.name,
          role: updatedUser!.role,
          status: updatedUser!.status,
          mustChangePassword: updatedUser!.mustChangePassword,
          gdprConsent: updatedUser!.gdprConsent,
        },
      });
    } catch (error) {
      console.error("Complete first login error:", error);
      res.status(500).json({ error: "Failed to complete first login" });
    }
  });

  // ============================================
  // Users Management routes (Author only)
  // ============================================
  
  // Получить всех пользователей
  app.get("/api/users", requireAuthor, async (req, res) => {
    try {
      const users = await storage.getUsers();
      // Не отправляем passwordHash клиенту
      const safeUsers = users.map(({ passwordHash, ...user }) => user);
      res.json(safeUsers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Получить одного пользователя
  app.get("/api/users/:id", requireAuthor, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // Создать пользователя
  app.post("/api/users", requireAuthor, async (req, res) => {
    try {
      const { email, password, name, role, status, mustChangePassword, expiresAt } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      // Проверяем, не существует ли уже пользователь с таким email
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: "User with this email already exists" });
      }

      const user = await storage.createUser({
        email,
        passwordHash: password, // будет захэширован в createUser
        name: name || null,
        role: role || "learner",
        status: status || "pending",
        mustChangePassword: mustChangePassword ?? true,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: req.session.userId,
      });

      const { passwordHash, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  // Обновить пользователя
  app.put("/api/users/:id", requireAuthor, async (req, res) => {
    try {
      const { email, name, role, status, mustChangePassword, expiresAt } = req.body;
      
      // Если меняется email, проверяем уникальность
      if (email) {
        const existing = await storage.getUserByEmail(email);
        if (existing && existing.id !== req.params.id) {
          return res.status(409).json({ error: "User with this email already exists" });
        }
      }

      const updateData: any = {};
      if (email !== undefined) updateData.email = email;
      if (name !== undefined) updateData.name = name;
      if (role !== undefined) updateData.role = role;
      if (status !== undefined) updateData.status = status;
      if (mustChangePassword !== undefined) updateData.mustChangePassword = mustChangePassword;
      if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;

      const user = await storage.updateUser(req.params.id, updateData);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // Сбросить пароль пользователя (админ устанавливает новый)
  app.post("/api/users/:id/reset-password", requireAuthor, async (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword) {
        return res.status(400).json({ error: "New password is required" });
      }

      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      await storage.updateUserPassword(req.params.id, newPassword);
      
      // Устанавливаем флаг "сменить при входе"
      await storage.updateUser(req.params.id, { mustChangePassword: true });

      res.json({ success: true, message: "Password reset successfully" });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // Деактивировать пользователя
  app.post("/api/users/:id/deactivate", requireAuthor, async (req, res) => {
    try {
      // Нельзя деактивировать себя
      if (req.params.id === req.session.userId) {
        return res.status(400).json({ error: "Cannot deactivate yourself" });
      }

      const user = await storage.deactivateUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ error: "Failed to deactivate user" });
    }
  });

  // Активировать пользователя
  app.post("/api/users/:id/activate", requireAuthor, async (req, res) => {
    try {
      const user = await storage.activateUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ error: "Failed to activate user" });
    }
  });

  // Reset user attempts for a specific test
  app.post("/api/users/:id/reset-attempts", requireAuthor, async (req, res) => {
    try {
      const { testId } = req.body;
      
      if (!testId) {
        return res.status(400).json({ error: "testId is required" });
      }

      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const test = await storage.getTest(testId);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      // Удаляем все попытки пользователя для этого теста
      await storage.deleteAttemptsByUserAndTest(req.params.id, testId);

      res.json({ success: true, message: "Attempts reset successfully" });
    } catch (error) {
      console.error("Reset attempts error:", error);
      res.status(500).json({ error: "Failed to reset attempts" });
    }
  });

  // Get user attempts summary (for reset dialog)
  app.get("/api/users/:id/attempts-summary", requireAuthor, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const attempts = await storage.getAttemptsByUser(req.params.id);
      const tests = await storage.getTests();
      const testMap = new Map(tests.map(t => [t.id, t]));

      // Группируем попытки по тестам
      const attemptsByTest: Record<string, { 
        testId: string; 
        testTitle: string;
        maxAttempts: number | null;
        completedAttempts: number;
        inProgressAttempts: number;
      }> = {};

      for (const attempt of attempts) {
        const test = testMap.get(attempt.testId);
        if (!test) continue;

        if (!attemptsByTest[attempt.testId]) {
          attemptsByTest[attempt.testId] = {
            testId: attempt.testId,
            testTitle: test.title,
            maxAttempts: test.maxAttempts,
            completedAttempts: 0,
            inProgressAttempts: 0,
          };
        }

        if (attempt.finishedAt) {
          attemptsByTest[attempt.testId].completedAttempts++;
        } else {
          attemptsByTest[attempt.testId].inProgressAttempts++;
        }
      }

      res.json(Object.values(attemptsByTest));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch attempts summary" });
    }
  });

  // ============================================
  // Groups Management routes (Author only)
  // ============================================

  // Получить все группы
  app.get("/api/groups", requireAuthor, async (req, res) => {
    try {
      const allGroups = await storage.getGroups();
      
      // Добавляем количество пользователей в каждой группе
      const groupsWithCount = await Promise.all(
        allGroups.map(async (group) => {
          const users = await storage.getGroupUsers(group.id);
          return {
            ...group,
            userCount: users.length,
          };
        })
      );
      
      res.json(groupsWithCount);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch groups" });
    }
  });

  // Получить одну группу с пользователями
  app.get("/api/groups/:id", requireAuthor, async (req, res) => {
    try {
      const group = await storage.getGroup(req.params.id);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }

      const users = await storage.getGroupUsers(req.params.id);
      const safeUsers = users.map(({ passwordHash, ...user }) => user);

      res.json({ ...group, users: safeUsers });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch group" });
    }
  });

  // Создать группу
  app.post("/api/groups", requireAuthor, async (req, res) => {
    try {
      const { name, description } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }

      const group = await storage.createGroup({
        name,
        description: description || null,
        createdBy: req.session.userId,
      });

      res.status(201).json({ ...group, userCount: 0 });
    } catch (error) {
      res.status(500).json({ error: "Failed to create group" });
    }
  });

  // Обновить группу
  app.put("/api/groups/:id", requireAuthor, async (req, res) => {
    try {
      const { name, description } = req.body;

      const group = await storage.updateGroup(req.params.id, { name, description });
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }

      const users = await storage.getGroupUsers(req.params.id);
      res.json({ ...group, userCount: users.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to update group" });
    }
  });

  // Удалить группу
  app.delete("/api/groups/:id", requireAuthor, async (req, res) => {
    try {
      const success = await storage.deleteGroup(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Group not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete group" });
    }
  });

  // Добавить пользователя в группу
  app.post("/api/groups/:id/users", requireAuthor, async (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      // Проверяем существование группы и пользователя
      const group = await storage.getGroup(req.params.id);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      try {
        await storage.addUserToGroup(userId, req.params.id);
      } catch (e: any) {
        // Если пользователь уже в группе (unique constraint)
        if (e.code === '23505') {
          return res.status(409).json({ error: "User already in group" });
        }
        throw e;
      }

      res.status(201).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to add user to group" });
    }
  });

  // Удалить пользователя из группы
  app.delete("/api/groups/:id/users/:userId", requireAuthor, async (req, res) => {
    try {
      const success = await storage.removeUserFromGroup(req.params.userId, req.params.id);
      if (!success) {
        return res.status(404).json({ error: "User not in group" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove user from group" });
    }
  });

  // Получить группы пользователя
  app.get("/api/users/:id/groups", requireAuthor, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const userGroupsList = await storage.getUserGroups(req.params.id);
      res.json(userGroupsList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user groups" });
    }
  });

  // Установить группы пользователя (заменяет все)
  app.put("/api/users/:id/groups", requireAuthor, async (req, res) => {
    try {
      const { groupIds } = req.body;
      
      if (!Array.isArray(groupIds)) {
        return res.status(400).json({ error: "groupIds must be an array" });
      }

      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      await storage.setUserGroups(req.params.id, groupIds);
      
      const updatedGroups = await storage.getUserGroups(req.params.id);
      res.json(updatedGroups);
    } catch (error) {
      res.status(500).json({ error: "Failed to update user groups" });
    }
  });

  // ============================================
  // Test Assignments routes (Author only)
  // ============================================

  // Получить все назначения для теста
  app.get("/api/tests/:id/assignments", requireAuthor, async (req, res) => {
    try {
      const test = await storage.getTest(req.params.id);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      const assignments = await storage.getTestAssignments(req.params.id);
      
      // Добавляем информацию о пользователях и группах
      const enrichedAssignments = await Promise.all(
        assignments.map(async (assignment) => {
          let user = null;
          let group = null;
          
          if (assignment.userId) {
            const u = await storage.getUser(assignment.userId);
            if (u) {
              const { passwordHash, ...safeUser } = u;
              user = safeUser;
            }
          }
          
          if (assignment.groupId) {
            group = await storage.getGroup(assignment.groupId);
          }
          
          return { ...assignment, user, group };
        })
      );

      res.json(enrichedAssignments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch assignments" });
    }
  });

  // Назначить тест пользователю или группе
  app.post("/api/tests/:id/assignments", requireAuthor, async (req, res) => {
    try {
      const { userId, groupId, dueDate } = req.body;
      
      if (!userId && !groupId) {
        return res.status(400).json({ error: "userId or groupId is required" });
      }

      const test = await storage.getTest(req.params.id);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      if (userId) {
        const user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
      }

      if (groupId) {
        const group = await storage.getGroup(groupId);
        if (!group) {
          return res.status(404).json({ error: "Group not found" });
        }
      }

      const assignment = await storage.createTestAssignment({
        testId: req.params.id,
        userId: userId || null,
        groupId: groupId || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        assignedBy: req.session.userId!,
      });

      res.status(201).json(assignment);
    } catch (error) {
      res.status(500).json({ error: "Failed to create assignment" });
    }
  });

  // Массовое назначение теста
  app.post("/api/tests/:id/assignments/bulk", requireAuthor, async (req, res) => {
    try {
      const { userIds, groupIds, dueDate } = req.body;
      
      if ((!userIds || userIds.length === 0) && (!groupIds || groupIds.length === 0)) {
        return res.status(400).json({ error: "userIds or groupIds is required" });
      }

      const test = await storage.getTest(req.params.id);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      const assignments: any[] = [];

      // Назначаем пользователям
      if (userIds && userIds.length > 0) {
        for (const userId of userIds) {
          const assignment = await storage.createTestAssignment({
            testId: req.params.id,
            userId,
            groupId: null,
            dueDate: dueDate ? new Date(dueDate) : null,
            assignedBy: req.session.userId!,
          });
          assignments.push(assignment);
        }
      }

      // Назначаем группам
      if (groupIds && groupIds.length > 0) {
        for (const groupId of groupIds) {
          const assignment = await storage.createTestAssignment({
            testId: req.params.id,
            userId: null,
            groupId,
            dueDate: dueDate ? new Date(dueDate) : null,
            assignedBy: req.session.userId!,
          });
          assignments.push(assignment);
        }
      }

      res.status(201).json(assignments);
    } catch (error) {
      res.status(500).json({ error: "Failed to create assignments" });
    }
  });

  // Удалить назначение
  app.delete("/api/assignments/:id", requireAuthor, async (req, res) => {
    try {
      const success = await storage.deleteTestAssignment(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Assignment not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete assignment" });
    }
  });

  // Получить назначенные тесты для текущего learner
  app.get("/api/learner/assigned-tests", requireLearner, async (req, res) => {
    try {
      const assignedTests = await storage.getAssignedTestsForUser(req.session.userId!);
      res.json(assignedTests);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch assigned tests" });
    }
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
      const { name, description, feedback, folderId } = req.body;
      const topic = await storage.updateTopic(req.params.id, { name, description, feedback, folderId });
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
      const { topicId, type, prompt, dataJson, correctJson, points, difficulty, feedback, feedbackMode, feedbackCorrect, feedbackIncorrect, shuffleAnswers, mediaUrl, mediaType } = req.body;
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
        difficulty: difficulty ?? 50,
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
      const { topicId, type, prompt, dataJson, correctJson, points, difficulty, feedback, feedbackMode, feedbackCorrect, feedbackIncorrect, shuffleAnswers, mediaUrl, mediaType } = req.body;
      const question = await storage.updateQuestion(req.params.id, {
        topicId,
        type,
        prompt,
        dataJson,
        correctJson,
        points,
        difficulty,
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
          "Сложность": q.difficulty ?? 50,
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
          const difficulty = Math.min(100, Math.max(0, Number(row["Сложность"]) || 50));
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
            difficulty,
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

  // Get difficulty distribution for a topic (for adaptive test setup)
  app.get("/api/topics/:topicId/difficulty-distribution", requireAuthor, async (req, res) => {
    try {
      const { topicId } = req.params;
      const questions = await storage.getQuestionsByTopic(topicId);

      if (questions.length === 0) {
        return res.json({
          totalQuestions: 0,
          histogram: [],
          suggestedLevels: [],
          warnings: ["В этой теме нет вопросов"],
        });
      }

      // Build histogram (0-10, 11-20, ..., 91-100)
      const histogram: { min: number; max: number; count: number }[] = [];
      for (let i = 0; i <= 90; i += 10) {
        const min = i;
        const max = i + 10;
        const count = questions.filter(q => {
          const d = q.difficulty ?? 50;
          return d >= min && (max === 100 ? d <= max : d < max);
        }).length;
        histogram.push({ min, max: max === 100 ? 100 : max - 1, count });
      }

      // Check for questions without explicit difficulty (all at default 50)
      const defaultDifficultyCount = questions.filter(q => q.difficulty === 50 || q.difficulty === null).length;
      const warnings: string[] = [];
      if (defaultDifficultyCount === questions.length) {
        warnings.push("Все вопросы имеют сложность по умолчанию (50). Рекомендуется задать сложность для каждого вопроса.");
      } else if (defaultDifficultyCount > questions.length * 0.5) {
        warnings.push(`${defaultDifficultyCount} из ${questions.length} вопросов имеют сложность по умолчанию (50).`);
      }

      // Suggest levels based on distribution
      const difficulties = questions.map(q => q.difficulty ?? 50).sort((a, b) => a - b);
      const minQuestions = 10; // Minimum questions per level

      // Try to create 3 levels with roughly equal questions
      const suggestedLevels: { levelName: string; minDifficulty: number; maxDifficulty: number; questionCount: number }[] = [];
      
      if (questions.length >= minQuestions * 2) {
        // Can support at least 2 levels
        const tercile1 = difficulties[Math.floor(difficulties.length / 3)];
        const tercile2 = difficulties[Math.floor(difficulties.length * 2 / 3)];
        
        const easyCount = questions.filter(q => (q.difficulty ?? 50) <= tercile1).length;
        const mediumCount = questions.filter(q => (q.difficulty ?? 50) > tercile1 && (q.difficulty ?? 50) <= tercile2).length;
        const hardCount = questions.filter(q => (q.difficulty ?? 50) > tercile2).length;

        if (easyCount >= minQuestions && mediumCount >= minQuestions && hardCount >= minQuestions) {
          // 3 levels
          suggestedLevels.push(
            { levelName: "Начальный", minDifficulty: 0, maxDifficulty: tercile1, questionCount: easyCount },
            { levelName: "Средний", minDifficulty: tercile1 + 1, maxDifficulty: tercile2, questionCount: mediumCount },
            { levelName: "Продвинутый", minDifficulty: tercile2 + 1, maxDifficulty: 100, questionCount: hardCount }
          );
        } else if (easyCount + mediumCount >= minQuestions && hardCount >= minQuestions) {
          // 2 levels: easy+medium combined, hard
          suggestedLevels.push(
            { levelName: "Базовый", minDifficulty: 0, maxDifficulty: tercile2, questionCount: easyCount + mediumCount },
            { levelName: "Продвинутый", minDifficulty: tercile2 + 1, maxDifficulty: 100, questionCount: hardCount }
          );
        } else {
          // Single level
          suggestedLevels.push(
            { levelName: "Общий", minDifficulty: 0, maxDifficulty: 100, questionCount: questions.length }
          );
          warnings.push("Недостаточно вопросов для разделения на уровни. Рекомендуется добавить больше вопросов с разной сложностью.");
        }
      } else {
        // Not enough questions
        suggestedLevels.push(
          { levelName: "Общий", minDifficulty: 0, maxDifficulty: 100, questionCount: questions.length }
        );
        warnings.push(`Недостаточно вопросов (${questions.length}). Рекомендуется минимум ${minQuestions * 2} вопросов для адаптивного тестирования.`);
      }

      res.json({
        totalQuestions: questions.length,
        histogram,
        suggestedLevels,
        warnings,
      });
    } catch (error) {
      console.error("Difficulty distribution error:", error);
      res.status(500).json({ error: "Failed to get difficulty distribution" });
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

          // If adaptive test, load adaptive settings
          let adaptiveSettings = null;
          if (test.mode === "adaptive") {
            const topicSettings = await storage.getAdaptiveTopicSettingsByTest(test.id);
            const levels = await storage.getAdaptiveLevelsByTest(test.id);
            
            adaptiveSettings = await Promise.all(
              topicSettings.map(async (ts) => {
                const topicLevels = levels.filter(l => l.topicId === ts.topicId);
                const levelsWithLinks = await Promise.all(
                  topicLevels.map(async (level) => {
                    const links = await storage.getAdaptiveLevelLinks(level.id);
                    return { ...level, links };
                  })
                );
                return {
                  ...ts,
                  topicName: topicMap.get(ts.topicId)?.name || "Unknown",
                  levels: levelsWithLinks,
                };
              })
            );
          }

          return { ...test, sections: sectionsWithDetails, adaptiveSettings };
        })
      );

      res.json(testsWithSections);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tests" });
    }
  });

  app.post("/api/tests", requireAuthor, async (req, res) => {
    try {
      const { 
        title, description, overallPassRuleJson, webhookUrl, sections, 
        showCorrectAnswers, timeLimitMinutes, maxAttempts, startPageContent, feedback,
        mode, showDifficultyLevel, adaptiveSettings 
      } = req.body;
      
      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }
      
      // For standard mode, sections are required
      if (mode !== "adaptive" && (!sections || sections.length === 0)) {
        return res.status(400).json({ error: "Sections are required for standard tests" });
      }

      const test = await storage.createTest(
        { 
          title, description, overallPassRuleJson, webhookUrl, published: false, 
          showCorrectAnswers, timeLimitMinutes, maxAttempts, startPageContent, feedback,
          mode: mode || "standard",
          showDifficultyLevel: showDifficultyLevel ?? true
        },
        sections || []
      );

      // If adaptive mode, save adaptive settings
      if (mode === "adaptive" && adaptiveSettings) {
        for (const topicSettings of adaptiveSettings) {
          // Create topic settings (failure feedback)
          await storage.createAdaptiveTopicSettings({
            testId: test.id,
            topicId: topicSettings.topicId,
            failureFeedback: topicSettings.failureFeedback || null,
          });

          // Create levels for this topic
          for (const level of topicSettings.levels || []) {
            const createdLevel = await storage.createAdaptiveLevel({
              testId: test.id,
              topicId: topicSettings.topicId,
              levelIndex: level.levelIndex,
              levelName: level.levelName,
              minDifficulty: level.minDifficulty,
              maxDifficulty: level.maxDifficulty,
              questionsCount: level.questionsCount,
              passThreshold: level.passThreshold,
              passThresholdType: level.passThresholdType || "percent",
              feedback: level.feedback || null,
            });

            // Create links for this level
            for (const link of level.links || []) {
              await storage.createAdaptiveLevelLink({
                levelId: createdLevel.id,
                title: link.title,
                url: link.url,
              });
            }
          }
        }
      }

      res.status(201).json(test);
    } catch (error) {
      console.error("Create test error:", error);
      res.status(500).json({ error: "Failed to create test" });
    }
  });

  // Get adaptive settings for a test
  app.get("/api/tests/:id/adaptive-settings", requireAuthor, async (req, res) => {
    try {
      const testId = req.params.id;
      const topicSettings = await storage.getAdaptiveTopicSettingsByTest(testId);
      const levels = await storage.getAdaptiveLevelsByTest(testId);
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t]));

      const adaptiveSettings = await Promise.all(
        topicSettings.map(async (ts) => {
          const topicLevels = levels.filter(l => l.topicId === ts.topicId);
          const levelsWithLinks = await Promise.all(
            topicLevels.map(async (level) => {
              const links = await storage.getAdaptiveLevelLinks(level.id);
              return { ...level, links };
            })
          );
          return {
            ...ts,
            topicName: topicMap.get(ts.topicId)?.name || "Unknown",
            levels: levelsWithLinks,
          };
        })
      );

      res.json(adaptiveSettings);
    } catch (error) {
      console.error("Get adaptive settings error:", error);
      res.status(500).json({ error: "Failed to get adaptive settings" });
    }
  });
  
  app.put("/api/tests/:id", requireAuthor, async (req, res) => {
    try {
      const { 
        title, description, overallPassRuleJson, webhookUrl, sections, 
        showCorrectAnswers, timeLimitMinutes, maxAttempts, startPageContent, feedback,
        mode, showDifficultyLevel, adaptiveSettings 
      } = req.body;
      
      // Update test basic info (without sections - we'll handle them separately)
      const test = await storage.updateTest(
        req.params.id,
        { 
          title, description, overallPassRuleJson, webhookUrl, 
          showCorrectAnswers, timeLimitMinutes, maxAttempts, startPageContent, feedback,
          mode, showDifficultyLevel
        },
        mode === "standard" ? sections : undefined  // Only update sections for standard mode
      );
      
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      // If adaptive mode and settings provided, update adaptive settings
      if (mode === "adaptive" && adaptiveSettings) {
        // Delete old adaptive settings
        await storage.deleteAdaptiveLevelLinksByTest(test.id);
        await storage.deleteAdaptiveLevelsByTest(test.id);
        await storage.deleteAdaptiveTopicSettingsByTest(test.id);

        // Create new adaptive settings
        for (const topicSettings of adaptiveSettings) {
          await storage.createAdaptiveTopicSettings({
            testId: test.id,
            topicId: topicSettings.topicId,
            failureFeedback: topicSettings.failureFeedback || null,
          });

          for (const level of topicSettings.levels || []) {
            const createdLevel = await storage.createAdaptiveLevel({
              testId: test.id,
              topicId: topicSettings.topicId,
              levelIndex: level.levelIndex,
              levelName: level.levelName,
              minDifficulty: level.minDifficulty,
              maxDifficulty: level.maxDifficulty,
              questionsCount: level.questionsCount,
              passThreshold: level.passThreshold,
              passThresholdType: level.passThresholdType || "percent",
              feedback: level.feedback || null,
            });

            for (const link of level.links || []) {
              await storage.createAdaptiveLevelLink({
                levelId: createdLevel.id,
                title: link.title,
                url: link.url,
              });
            }
          }
        }
      }
      // Note: We keep both standard sections and adaptive settings in DB
      // This allows users to switch between modes without losing configuration

      res.json(test);
    } catch (error) {
      console.error("Update test error:", error);
      res.status(500).json({ error: "Failed to update test" });
    }
  });

  app.delete("/api/tests/:id", requireAuthor, async (req, res) => {
    try {
      // Delete adaptive settings first
      await storage.deleteAdaptiveLevelLinksByTest(req.params.id);
      await storage.deleteAdaptiveLevelsByTest(req.params.id);
      await storage.deleteAdaptiveTopicSettingsByTest(req.params.id);

      const success = await storage.deleteTest(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Test not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete test" });
    }
  });


  // Export SCORM with optional telemetry
  // GET /api/tests/:id/export/scorm?telemetry=true
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

      // Load adaptive settings if test is adaptive
      let adaptiveSettings = null;
      if (test.mode === "adaptive") {
        const topicSettings = await storage.getAdaptiveTopicSettingsByTest(test.id);
        const levels = await storage.getAdaptiveLevelsByTest(test.id);
        
        // Load links for each level
        const levelsWithLinks = await Promise.all(
          levels.map(async (level) => {
            const links = await storage.getAdaptiveLevelLinks(level.id);
            return { ...level, links };
          })
        );

        adaptiveSettings = {
          topicSettings,
          levels: levelsWithLinks,
        };
      }

      // Telemetry configuration
      let telemetryConfig = null;
      const enableTelemetry = req.query.telemetry === "true";
      
      if (enableTelemetry) {
        const packageId = crypto.randomUUID();
        const secretKey = crypto.randomBytes(32).toString("hex");
        const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5001}`;
        
        // Create scorm_package record
        await storage.createScormPackage({
          id: packageId,
          testId: test.id,
          testTitle: test.title,
          testMode: test.mode || "standard",
          secretKey: secretKey,
          apiBaseUrl: apiBaseUrl,
          exportedAt: new Date(),
          createdBy: req.session.userId!,
          isActive: true,
        });
        
        telemetryConfig = {
          enabled: true,
          packageId: packageId,
          secretKey: secretKey,
          apiBaseUrl: apiBaseUrl,
        };
        
        console.log(`[SCORM] Created telemetry package: ${packageId} for test: ${test.id}`);
      }

      const buffer = await generateScormPackage({ 
        test, 
        sections: exportSections,
        adaptiveSettings,
        telemetry: telemetryConfig,
      });

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
      // Получаем только назначенные тесты для текущего пользователя
      const assignedTests = await storage.getAssignedTestsForUser(req.session.userId!);
      
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t.name]));

      const testsWithSections = await Promise.all(
        assignedTests.map(async (test) => {
          const sections = await storage.getTestSections(test.id);
          const sectionsWithNames = sections.map((s) => ({
            ...s,
            topicName: topicMap.get(s.topicId) || "Unknown",
          }));
          
          // Получаем количество завершённых попыток пользователя для этого теста
          const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
          const completedAttempts = userAttempts.filter(a => a.finishedAt !== null).length;
          
          // Проверяем есть ли незавершённая попытка
          const inProgressAttempt = userAttempts.find(a => a.finishedAt === null);
          
          return { 
            ...test, 
            sections: sectionsWithNames,
            completedAttempts,
            inProgressAttemptId: inProgressAttempt?.id || null,
          };
        })
      );

      res.json(testsWithSections);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tests" });
    }
  });

  // === Adaptive Testing Endpoints ===

  // Start adaptive test attempt
  app.post("/api/tests/:testId/attempts/start-adaptive", requireLearner, async (req, res) => {
    try {
      const test = await storage.getTest(req.params.testId);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      // Проверяем ограничение попыток
      if (test.maxAttempts !== null) {
        const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
        const completedAttempts = userAttempts.filter(a => a.finishedAt !== null).length;
        
        if (completedAttempts >= test.maxAttempts) {
          return res.status(403).json({ error: "Attempts exhausted", code: "ATTEMPTS_EXHAUSTED" });
        }
      }

      if (test.mode !== "adaptive") {
        return res.status(400).json({ error: "This is not an adaptive test" });
      }

      const adaptiveSettings = await storage.getAdaptiveTopicSettingsByTest(test.id);
      const adaptiveLevels = await storage.getAdaptiveLevelsByTest(test.id);
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t.name]));

      if (adaptiveSettings.length === 0) {
        return res.status(400).json({ error: "Adaptive test has no settings configured" });
      }

      // Build adaptive variant
      const adaptiveTopics: any[] = [];

      for (const topicSettings of adaptiveSettings) {
        const topicLevels = adaptiveLevels
          .filter(l => l.topicId === topicSettings.topicId)
          .sort((a, b) => a.levelIndex - b.levelIndex);

        if (topicLevels.length === 0) continue;

        // Get questions for this topic
        const allQuestions = await storage.getQuestionsByTopic(topicSettings.topicId);

        // Build levels state
        const levelsState: any[] = [];

        for (const level of topicLevels) {
          // Filter questions by difficulty range
          const levelQuestions = allQuestions.filter(
            q => (q.difficulty ?? 50) >= level.minDifficulty && (q.difficulty ?? 50) <= level.maxDifficulty
          );

          // Shuffle and select questions for this level
          const shuffled = levelQuestions.sort(() => Math.random() - 0.5);
          const selected = shuffled.slice(0, level.questionsCount);
          const questionIds = selected.map(q => q.id);

          levelsState.push({
            levelIndex: level.levelIndex,
            levelName: level.levelName,
            minDifficulty: level.minDifficulty,
            maxDifficulty: level.maxDifficulty,
            questionsCount: level.questionsCount,
            passThreshold: level.passThreshold,
            passThresholdType: level.passThresholdType,
            questionIds,
            answeredQuestionIds: [],
            correctCount: 0,
            status: "pending",
          });
        }

        // Start from median level
        const startLevelIndex = Math.floor(topicLevels.length / 2);

        adaptiveTopics.push({
          topicId: topicSettings.topicId,
          topicName: topicMap.get(topicSettings.topicId) || "Unknown",
          currentLevelIndex: startLevelIndex,
          levelsState,
          finalLevelIndex: null,
          status: "in_progress",
        });
      }

      if (adaptiveTopics.length === 0) {
        return res.status(400).json({ error: "No valid adaptive topics configured" });
      }

      // Set first level to in_progress and get first question
      const firstTopic = adaptiveTopics[0];
      const firstLevel = firstTopic.levelsState[firstTopic.currentLevelIndex];
      firstLevel.status = "in_progress";
      const firstQuestionId = firstLevel.questionIds[0] || null;

      const variant = {
        mode: "adaptive",
        topics: adaptiveTopics,
        currentTopicIndex: 0,
        currentQuestionId: firstQuestionId,
      };

      const attempt = await storage.createAttempt({
        userId: req.session.userId!,
        testId: test.id,
        testVersion: test.version || 1,
        variantJson: variant,
        answersJson: {},
        resultJson: null,
        startedAt: new Date(),
        finishedAt: null,
      });

      // Get first question details
      let firstQuestion = null;
      if (firstQuestionId) {
        const questions = await storage.getQuestionsByIds([firstQuestionId]);
        firstQuestion = questions[0] || null;
      }

      res.status(201).json({
        attemptId: attempt.id,
        testTitle: test.title,
        showDifficultyLevel: test.showDifficultyLevel,
        showCorrectAnswers: test.showCorrectAnswers,
        timeLimitMinutes: test.timeLimitMinutes || null,
        currentQuestion: firstQuestion ? {
          id: firstQuestion.id,
          question: firstQuestion,
          topicName: firstTopic.topicName,
          levelName: firstLevel.levelName,
          questionNumber: 1,
          totalInLevel: firstLevel.questionIds.length,
        } : null,
        totalTopics: adaptiveTopics.length,
        currentTopicIndex: 0,
      });
    } catch (error) {
      console.error("Start adaptive attempt error:", error);
      res.status(500).json({ error: "Failed to start adaptive attempt" });
    }
  });

  // Answer question in adaptive test
  app.post("/api/attempts/:attemptId/answer-adaptive", requireLearner, async (req, res) => {
    try {
      const attempt = await storage.getAttempt(req.params.attemptId);
      if (!attempt) {
        return res.status(404).json({ error: "Attempt not found" });
      }

      if (attempt.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (attempt.finishedAt) {
        return res.status(400).json({ error: "Attempt already finished" });
      }

      const { questionId, answer } = req.body;
      const variant = attempt.variantJson as any;

      if (variant.mode !== "adaptive") {
        return res.status(400).json({ error: "This is not an adaptive attempt" });
      }

      const test = await storage.getTest(attempt.testId);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      // Get current state
      const currentTopic = variant.topics[variant.currentTopicIndex];
      const currentLevel = currentTopic.levelsState[currentTopic.currentLevelIndex];

      // Verify this is the expected question
      if (variant.currentQuestionId !== questionId) {
        return res.status(400).json({ error: "Unexpected question ID" });
      }

      // Get question and check answer
      const questions = await storage.getQuestionsByIds([questionId]);
      const question = questions[0];
      if (!question) {
        return res.status(404).json({ error: "Question not found" });
      }

      // Check answer correctness
      const isCorrect = checkAnswer(question, answer) === 1;

      // Update answers
      const updatedAnswers = { ...(attempt.answersJson as any || {}), [questionId]: answer };

      // Update level state
      currentLevel.answeredQuestionIds.push(questionId);
      if (isCorrect) {
        currentLevel.correctCount++;
      }

      // Calculate if level is passed/failed
      const answeredCount = currentLevel.answeredQuestionIds.length;
      const remainingQuestions = currentLevel.questionIds.length - answeredCount;
      const correctCount = currentLevel.correctCount;

      // Calculate threshold
      let requiredCorrect: number;
      if (currentLevel.passThresholdType === "percent") {
        requiredCorrect = Math.ceil(currentLevel.questionIds.length * currentLevel.passThreshold / 100);
      } else {
        requiredCorrect = currentLevel.passThreshold;
      }

      // Check for early pass (enough correct answers)
      const canStillPass = correctCount + remainingQuestions >= requiredCorrect;
      const alreadyPassed = correctCount >= requiredCorrect;

      // Check for early fail (impossible to pass)
      const alreadyFailed = !canStillPass;

      // Check if all questions answered
      const allAnswered = remainingQuestions === 0;

      let levelTransition: any = null;
      let topicTransition: any = null;
      let isFinished = false;
      let nextQuestionData: any = null;

      if (alreadyPassed || (allAnswered && correctCount >= requiredCorrect)) {
        // Level passed!
        currentLevel.status = "passed";
        
        // Record this as achieved level (even if not the highest)
        currentTopic.finalLevelIndex = currentTopic.currentLevelIndex;

        // Check if there's a higher level
        const nextLevelIndex = currentTopic.currentLevelIndex + 1;
        if (nextLevelIndex < currentTopic.levelsState.length) {
          const nextLevel = currentTopic.levelsState[nextLevelIndex];
          
          // Only move up if next level is pending (not already failed/passed)
          if (nextLevel.status === "pending") {
            // Move to higher level
            levelTransition = {
              type: "up",
              fromLevel: currentLevel.levelName,
              toLevel: nextLevel.levelName,
              message: `Уровень "${currentLevel.levelName}" пройден! Переход на уровень "${nextLevel.levelName}"`,
            };

            currentTopic.currentLevelIndex = nextLevelIndex;
            nextLevel.status = "in_progress";

            // Get first question of new level
            const nextQuestionId = nextLevel.questionIds[0];
            variant.currentQuestionId = nextQuestionId;

            if (nextQuestionId) {
              const nextQuestions = await storage.getQuestionsByIds([nextQuestionId]);
              if (nextQuestions[0]) {
                nextQuestionData = {
                  id: nextQuestionId,
                  question: nextQuestions[0],
                  topicName: currentTopic.topicName,
                  levelName: nextLevel.levelName,
                  questionNumber: 1,
                  totalInLevel: nextLevel.questionIds.length,
                };
              }
            }
          } else {
            // Next level is failed/passed - cannot skip, topic complete
            currentTopic.status = "completed";
            levelTransition = {
              type: "complete",
              fromLevel: currentLevel.levelName,
              toLevel: null,
              message: `Тема завершена. Достигнутый уровень: "${currentLevel.levelName}"`,
            };

            // Check if there's another topic
            const nextTopicIndex = variant.currentTopicIndex + 1;
            if (nextTopicIndex < variant.topics.length) {
              topicTransition = {
                fromTopic: currentTopic.topicName,
                toTopic: variant.topics[nextTopicIndex].topicName,
              };

              variant.currentTopicIndex = nextTopicIndex;
              const nextTopic = variant.topics[nextTopicIndex];
              const startLevel = nextTopic.levelsState[nextTopic.currentLevelIndex];
              startLevel.status = "in_progress";

              const nextQuestionId = startLevel.questionIds[0];
              variant.currentQuestionId = nextQuestionId;

              if (nextQuestionId) {
                const nextQuestions = await storage.getQuestionsByIds([nextQuestionId]);
                if (nextQuestions[0]) {
                  nextQuestionData = {
                    id: nextQuestionId,
                    question: nextQuestions[0],
                    topicName: nextTopic.topicName,
                    levelName: startLevel.levelName,
                    questionNumber: 1,
                    totalInLevel: startLevel.questionIds.length,
                  };
                }
              }
            } else {
              // All topics complete
              isFinished = true;
              variant.currentQuestionId = null;
            }
          }
        } else {
          // Highest level passed - topic complete!
          currentTopic.status = "completed";

          levelTransition = {
            type: "complete",
            fromLevel: currentLevel.levelName,
            toLevel: null,
            message: `Поздравляем! Достигнут максимальный уровень "${currentLevel.levelName}"!`,
          };

          // Check if there's another topic
          const nextTopicIndex = variant.currentTopicIndex + 1;
          if (nextTopicIndex < variant.topics.length) {
            // Move to next topic
            topicTransition = {
              fromTopic: currentTopic.topicName,
              toTopic: variant.topics[nextTopicIndex].topicName,
            };

            variant.currentTopicIndex = nextTopicIndex;
            const nextTopic = variant.topics[nextTopicIndex];
            const startLevel = nextTopic.levelsState[nextTopic.currentLevelIndex];
            startLevel.status = "in_progress";

            const nextQuestionId = startLevel.questionIds[0];
            variant.currentQuestionId = nextQuestionId;

            if (nextQuestionId) {
              const nextQuestions = await storage.getQuestionsByIds([nextQuestionId]);
              if (nextQuestions[0]) {
                nextQuestionData = {
                  id: nextQuestionId,
                  question: nextQuestions[0],
                  topicName: nextTopic.topicName,
                  levelName: startLevel.levelName,
                  questionNumber: 1,
                  totalInLevel: startLevel.questionIds.length,
                };
              }
            }
          } else {
            // All topics complete
            isFinished = true;
            variant.currentQuestionId = null;
          }
        }
      } else if (alreadyFailed || (allAnswered && correctCount < requiredCorrect)) {
        // Level failed!
        currentLevel.status = "failed";

        // If we already achieved a level, topic is complete with that level
        if (currentTopic.finalLevelIndex !== null) {
          currentTopic.status = "completed";
          levelTransition = {
            type: "complete",
            fromLevel: currentLevel.levelName,
            toLevel: null,
            message: `Тема завершена. Достигнутый уровень: "${currentTopic.levelsState[currentTopic.finalLevelIndex].levelName}"`,
          };

          // Check if there's another topic
          const nextTopicIndex = variant.currentTopicIndex + 1;
          if (nextTopicIndex < variant.topics.length) {
            topicTransition = {
              fromTopic: currentTopic.topicName,
              toTopic: variant.topics[nextTopicIndex].topicName,
            };

            variant.currentTopicIndex = nextTopicIndex;
            const nextTopic = variant.topics[nextTopicIndex];
            const startLevel = nextTopic.levelsState[nextTopic.currentLevelIndex];
            startLevel.status = "in_progress";

            const nextQuestionId = startLevel.questionIds[0];
            variant.currentQuestionId = nextQuestionId;

            if (nextQuestionId) {
              const nextQuestions = await storage.getQuestionsByIds([nextQuestionId]);
              if (nextQuestions[0]) {
                nextQuestionData = {
                  id: nextQuestionId,
                  question: nextQuestions[0],
                  topicName: nextTopic.topicName,
                  levelName: startLevel.levelName,
                  questionNumber: 1,
                  totalInLevel: startLevel.questionIds.length,
                };
              }
            }
          } else {
            // All topics complete
            isFinished = true;
            variant.currentQuestionId = null;
          }
        } else {
          // No level achieved yet, check if there's a lower level
          const prevLevelIndex = currentTopic.currentLevelIndex - 1;
          if (prevLevelIndex >= 0) {
            const prevLevel = currentTopic.levelsState[prevLevelIndex];
            
            // Only move down if previous level is pending (not already failed/passed)
            if (prevLevel.status === "pending") {
              // Move to lower level
              levelTransition = {
                type: "down",
                fromLevel: currentLevel.levelName,
                toLevel: prevLevel.levelName,
                message: `Уровень "${currentLevel.levelName}" не пройден. Переход на уровень "${prevLevel.levelName}"`,
              };

              currentTopic.currentLevelIndex = prevLevelIndex;
              prevLevel.status = "in_progress";

              // Get first question of new level
              const nextQuestionId = prevLevel.questionIds[0];
              variant.currentQuestionId = nextQuestionId;

              if (nextQuestionId) {
                const nextQuestions = await storage.getQuestionsByIds([nextQuestionId]);
                if (nextQuestions[0]) {
                  nextQuestionData = {
                    id: nextQuestionId,
                    question: nextQuestions[0],
                    topicName: currentTopic.topicName,
                    levelName: prevLevel.levelName,
                    questionNumber: 1,
                    totalInLevel: prevLevel.questionIds.length,
                  };
                }
              }
            } else {
              // Previous level is also failed/passed - topic complete with no achievement
              currentTopic.finalLevelIndex = null;
              currentTopic.status = "completed";

              levelTransition = {
                type: "complete",
                fromLevel: currentLevel.levelName,
                toLevel: null,
                message: `К сожалению, уровень "${currentLevel.levelName}" не пройден.`,
              };

              // Check if there's another topic
              const nextTopicIndex = variant.currentTopicIndex + 1;
              if (nextTopicIndex < variant.topics.length) {
                topicTransition = {
                  fromTopic: currentTopic.topicName,
                  toTopic: variant.topics[nextTopicIndex].topicName,
                };

                variant.currentTopicIndex = nextTopicIndex;
                const nextTopic = variant.topics[nextTopicIndex];
                const startLevel = nextTopic.levelsState[nextTopic.currentLevelIndex];
                startLevel.status = "in_progress";

                const nextQuestionId = startLevel.questionIds[0];
                variant.currentQuestionId = nextQuestionId;

                if (nextQuestionId) {
                  const nextQuestions = await storage.getQuestionsByIds([nextQuestionId]);
                  if (nextQuestions[0]) {
                    nextQuestionData = {
                      id: nextQuestionId,
                      question: nextQuestions[0],
                      topicName: nextTopic.topicName,
                      levelName: startLevel.levelName,
                      questionNumber: 1,
                      totalInLevel: startLevel.questionIds.length,
                    };
                  }
                }
              } else {
                // All topics complete
                isFinished = true;
                variant.currentQuestionId = null;
              }
            }
          } else {
            // Lowest level failed - topic complete with failure
            currentTopic.finalLevelIndex = null;
            currentTopic.status = "completed";

            levelTransition = {
              type: "complete",
              fromLevel: currentLevel.levelName,
              toLevel: null,
              message: `К сожалению, базовый уровень "${currentLevel.levelName}" не пройден.`,
            };

            // Check if there's another topic
            const nextTopicIndex = variant.currentTopicIndex + 1;
            if (nextTopicIndex < variant.topics.length) {
              topicTransition = {
                fromTopic: currentTopic.topicName,
                toTopic: variant.topics[nextTopicIndex].topicName,
              };

              variant.currentTopicIndex = nextTopicIndex;
              const nextTopic = variant.topics[nextTopicIndex];
              const startLevel = nextTopic.levelsState[nextTopic.currentLevelIndex];
              startLevel.status = "in_progress";

              const nextQuestionId = startLevel.questionIds[0];
              variant.currentQuestionId = nextQuestionId;

              if (nextQuestionId) {
                const nextQuestions = await storage.getQuestionsByIds([nextQuestionId]);
                if (nextQuestions[0]) {
                  nextQuestionData = {
                    id: nextQuestionId,
                    question: nextQuestions[0],
                    topicName: nextTopic.topicName,
                    levelName: startLevel.levelName,
                    questionNumber: 1,
                    totalInLevel: startLevel.questionIds.length,
                  };
                }
              }
            } else {
              // All topics complete
              isFinished = true;
              variant.currentQuestionId = null;
            }
          }
        }
      } else {
        // Continue with next question in same level
        const currentQuestionIndex = currentLevel.questionIds.indexOf(questionId);
        const nextQuestionId = currentLevel.questionIds[currentQuestionIndex + 1];
        variant.currentQuestionId = nextQuestionId;

        if (nextQuestionId) {
          const nextQuestions = await storage.getQuestionsByIds([nextQuestionId]);
          if (nextQuestions[0]) {
            nextQuestionData = {
              id: nextQuestionId,
              question: nextQuestions[0],
              topicName: currentTopic.topicName,
              levelName: currentLevel.levelName,
              questionNumber: currentQuestionIndex + 2,
              totalInLevel: currentLevel.questionIds.length,
            };
          }
        }
      }

      // Build result if finished
      let result: any = null;
      if (isFinished) {
        result = await buildAdaptiveResult(variant, test.id, storage);
      }

      // Update attempt
      await storage.updateAttempt(attempt.id, {
        variantJson: variant,
        answersJson: updatedAnswers,
        resultJson: isFinished ? result : null,
        finishedAt: isFinished ? new Date() : null,
      });

      // Build response
      const response: any = {
        isCorrect,
        nextQuestion: nextQuestionData,
        levelTransition,
        topicTransition,
        isFinished,
        result,
      };

      // Add correct answer if showCorrectAnswers is enabled
      if (test.showCorrectAnswers) {
        response.correctAnswer = question.correctJson;
        response.feedback = question.feedback;
      }

      res.json(response);
    } catch (error) {
      console.error("Answer adaptive error:", error);
      res.status(500).json({ error: "Failed to process answer" });
    }
  });

  // Helper function to build adaptive result
  async function buildAdaptiveResult(variant: any, testId: string, storage: any) {
    const adaptiveSettings = await storage.getAdaptiveTopicSettingsByTest(testId);
    const adaptiveLevels = await storage.getAdaptiveLevelsByTest(testId);

    const topicResults: any[] = [];
    let overallPassed = true;

    for (const topic of variant.topics) {
      const topicSettings = adaptiveSettings.find((s: any) => s.topicId === topic.topicId);
      const topicLevels = adaptiveLevels.filter((l: any) => l.topicId === topic.topicId);

      // Calculate stats
      let totalQuestionsAnswered = 0;
      let totalCorrect = 0;
      const levelsAttempted: any[] = [];

      for (const levelState of topic.levelsState) {
        if (levelState.status === "passed" || levelState.status === "failed") {
          totalQuestionsAnswered += levelState.answeredQuestionIds.length;
          totalCorrect += levelState.correctCount;
          levelsAttempted.push({
            levelIndex: levelState.levelIndex,
            levelName: levelState.levelName,
            questionsAnswered: levelState.answeredQuestionIds.length,
            correctCount: levelState.correctCount,
            status: levelState.status,
          });
        }
      }

      // Get achieved level info
      let achievedLevelName: string | null = null;
      let levelPercent = 0;
      let feedback: string | null = null;
      let recommendedLinks: any[] = [];

      if (topic.finalLevelIndex !== null) {
        const achievedLevel = topicLevels.find((l: any) => l.levelIndex === topic.finalLevelIndex);
        if (achievedLevel) {
          achievedLevelName = achievedLevel.levelName;
          const levelState = topic.levelsState.find((ls: any) => ls.levelIndex === topic.finalLevelIndex);
          if (levelState && levelState.answeredQuestionIds.length > 0) {
            levelPercent = (levelState.correctCount / levelState.answeredQuestionIds.length) * 100;
          }
          feedback = achievedLevel.feedback;

          // Get links for this level
          const links = await storage.getAdaptiveLevelLinks(achievedLevel.id);
          recommendedLinks = links.map((l: any) => ({ title: l.title, url: l.url }));
        }
      } else {
        // Failed all levels
        overallPassed = false;
        feedback = topicSettings?.failureFeedback || null;
      }

      topicResults.push({
        topicId: topic.topicId,
        topicName: topic.topicName,
        achievedLevelIndex: topic.finalLevelIndex,
        achievedLevelName,
        levelPercent,
        totalQuestionsAnswered,
        totalCorrect,
        levelsAttempted,
        feedback,
        recommendedLinks,
      });
    }

    return {
      mode: "adaptive",
      overallPassed,
      topicResults,
    };
  }

  // Learner routes

  // Attempts - Learner only
  app.post("/api/tests/:testId/attempts/start", requireLearner, async (req, res) => {
    try {
      const test = await storage.getTest(req.params.testId);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      // Проверяем ограничение попыток
      if (test.maxAttempts !== null) {
        const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
        const completedAttempts = userAttempts.filter(a => a.finishedAt !== null).length;
        
        if (completedAttempts >= test.maxAttempts) {
          return res.status(403).json({ error: "Attempts exhausted", code: "ATTEMPTS_EXHAUSTED" });
        }
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

      // If showCorrectAnswers is enabled, include correctJson, otherwise strip it
      const questionsForClient = test.showCorrectAnswers 
        ? allQuestions 
        : allQuestions.map(q => ({
            ...q,
            correctJson: undefined,
          }));

      res.status(201).json({
        ...attempt,
        testTitle: test.title,
        showCorrectAnswers: test.showCorrectAnswers || false,
        timeLimitMinutes: test.timeLimitMinutes || null,
        questions: questionsForClient,
      });
    } catch (error) {
      console.error("Start attempt error:", error);
      res.status(500).json({ error: "Failed to start attempt" });
    }
  });

  // Save progress for standard test (auto-save)
  app.post("/api/attempts/:attemptId/save-progress", requireLearner, async (req, res) => {
    try {
      const attempt = await storage.getAttempt(req.params.attemptId);
      if (!attempt) {
        return res.status(404).json({ error: "Attempt not found" });
      }

      if (attempt.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Не сохраняем если попытка уже завершена
      if (attempt.finishedAt) {
        return res.status(400).json({ error: "Attempt already finished" });
      }

      const { answers, currentIndex, shuffleMappings } = req.body;

      const updatedVariant = {
        ...(attempt.variantJson as any),
        currentIndex,
      };
      
      // Сохраняем shuffleMappings только если переданы
      if (shuffleMappings) {
        updatedVariant.shuffleMappings = shuffleMappings;
      }

      await storage.updateAttempt(attempt.id, {
        answersJson: answers,
        variantJson: updatedVariant,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Save progress error:", error);
      res.status(500).json({ error: "Failed to save progress" });
    }
  });

  // Resume in-progress attempt
  app.get("/api/tests/:testId/resume", requireLearner, async (req, res) => {
    try {
      const test = await storage.getTest(req.params.testId);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
      const inProgressAttempt = userAttempts.find(a => a.finishedAt === null);

      if (!inProgressAttempt) {
        return res.json({ hasInProgress: false });
      }

      const variant = inProgressAttempt.variantJson as any;
      const allQuestionIds = variant.sections.flatMap((s: any) => s.questionIds);
      const allQuestions = await storage.getQuestionsByIds(allQuestionIds);

      // Для режима showCorrectAnswers передаём correctJson
      const questionsForClient = test.showCorrectAnswers 
        ? allQuestions 
        : allQuestions.map(q => ({
            ...q,
            correctJson: undefined,
          }));

      res.json({
        hasInProgress: true,
        attempt: {
          ...inProgressAttempt,
          testTitle: test.title,
          showCorrectAnswers: test.showCorrectAnswers || false,
          timeLimitMinutes: test.timeLimitMinutes || null,
          questions: questionsForClient,
        },
        savedAnswers: inProgressAttempt.answersJson || {},
        currentIndex: variant.currentIndex || 0,
      });
    } catch (error) {
      console.error("Resume attempt error:", error);
      res.status(500).json({ error: "Failed to resume attempt" });
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
      
      // Получаем информацию о попытках
      const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, attempt.testId);
      const completedAttempts = userAttempts.filter(a => a.finishedAt !== null).length;
      const maxAttempts = test?.maxAttempts || null;
      const canRetake = maxAttempts === null || completedAttempts < maxAttempts;

      res.json({
        ...attempt,
        testTitle: test?.title || "Unknown Test",
        result: attempt.resultJson as AttemptResult,
        canRetake,
        attemptsInfo: maxAttempts !== null ? {
          completed: completedAttempts,
          max: maxAttempts,
        } : null,
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

  // Детальная аналитика по конкретному тесту
app.get("/api/analytics/tests/:testId", requireAuthor, async (req: Request, res: Response) => {
  try {
    const testId = req.params.testId;
    const test = await storage.getTest(testId);
    
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }
    
    const allAttempts = await storage.getAllAttempts();
    const testAttempts = allAttempts.filter(a => a.testId === testId);
    const completedAttempts = testAttempts.filter(a => a.resultJson !== null);
    
    // Уникальные пользователи
    const uniqueUsers = new Set(completedAttempts.map(a => a.userId)).size;
    
    // Базовая статистика
    let totalPercent = 0;
    let totalPassed = 0;
    let totalScore = 0;
    let maxScore = 0;
    let totalDuration = 0;
    let durationCount = 0;
    
    for (const attempt of completedAttempts) {
      const result = attempt.resultJson as AttemptResult | null;
      if (result) {
        totalPercent += result.overallPercent || 0;
        if (result.overallPassed) totalPassed++;
        totalScore += result.totalEarnedPoints || 0;
        if ((result.totalPossiblePoints || 0) > maxScore) {
          maxScore = result.totalPossiblePoints || 0;
        }
        
        if (attempt.startedAt && attempt.finishedAt) {
          const duration = (new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000;
          totalDuration += duration;
          durationCount++;
        }
      }
    }
    
    const summary = {
      totalAttempts: testAttempts.length,
      completedAttempts: completedAttempts.length,
      uniqueUsers,
      avgPercent: completedAttempts.length > 0 ? totalPercent / completedAttempts.length : 0,
      avgDuration: durationCount > 0 ? totalDuration / durationCount : null,
      passRate: completedAttempts.length > 0 ? (totalPassed / completedAttempts.length) * 100 : 0,
      avgScore: completedAttempts.length > 0 ? totalScore / completedAttempts.length : 0,
      maxScore,
    };
    
    // Статистика по темам
    interface TopicStatsEntry {
      topicId: string;
      topicName: string;
      totalAnswers: number;
      correctAnswers: number;
      earnedPoints: number;
      possiblePoints: number;
      passedCount: number;
      failedCount: number;
    }
    
    const topicStatsMap = new Map<string, TopicStatsEntry>();
    
    for (const attempt of completedAttempts) {
      const result = attempt.resultJson as any;
      if (!result?.topicResults) continue;
      
      for (const tr of result.topicResults) {
        const existing = topicStatsMap.get(tr.topicId) || {
          topicId: tr.topicId,
          topicName: tr.topicName,
          totalAnswers: 0,
          correctAnswers: 0,
          earnedPoints: 0,
          possiblePoints: 0,
          passedCount: 0,
          failedCount: 0,
        };
        
        existing.totalAnswers += tr.total || tr.totalQuestionsAnswered || 0;
        existing.correctAnswers += tr.correct || tr.totalCorrect || 0;
        existing.earnedPoints += tr.earnedPoints || 0;
        existing.possiblePoints += tr.possiblePoints || 0;
        
        if (tr.passed === true || (tr.achievedLevelIndex !== undefined && tr.achievedLevelIndex !== null)) {
          existing.passedCount++;
        } else if (tr.passed === false || tr.achievedLevelIndex === null) {
          existing.failedCount++;
        }
        
        topicStatsMap.set(tr.topicId, existing);
      }
    }
    
    const topicStats = Array.from(topicStatsMap.values()).map(ts => ({
      topicId: ts.topicId,
      topicName: ts.topicName,
      totalAnswers: ts.totalAnswers,
      correctAnswers: ts.correctAnswers,
      avgPercent: ts.possiblePoints > 0 ? (ts.earnedPoints / ts.possiblePoints) * 100 : 0,
      passRate: (ts.passedCount + ts.failedCount) > 0 
        ? (ts.passedCount / (ts.passedCount + ts.failedCount)) * 100 
        : null,
    }));
    
    // Статистика по вопросам
    interface QuestionStatsEntry {
      questionId: string;
      questionPrompt: string;
      questionType: string;
      topicId: string;
      topicName: string;
      difficulty: number;
      totalAnswers: number;
      correctAnswers: number;
    }
    
    const questionStatsMap = new Map<string, QuestionStatsEntry>();
    
    const allQuestionIds = new Set<string>();
    for (const attempt of testAttempts) {
      const variant = attempt.variantJson as any;
      if (variant?.sections) {
        for (const section of variant.sections) {
          for (const qId of section.questionIds || []) {
            allQuestionIds.add(qId);
          }
        }
      }
      if (variant?.topics) {
        for (const topic of variant.topics) {
          for (const level of topic.levelsState || []) {
            for (const qId of level.questionIds || []) {
              allQuestionIds.add(qId);
            }
          }
        }
      }
    }
    
    const questions = await storage.getQuestionsByIds(Array.from(allQuestionIds));
    const questionMap = new Map(questions.map(q => [q.id, q]));
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));
    
    for (const attempt of completedAttempts) {
      const answers = (attempt.answersJson || {}) as Record<string, unknown>;
      
      for (const [qId, answer] of Object.entries(answers)) {
        const question = questionMap.get(qId);
        if (!question) continue;
        
        const existing = questionStatsMap.get(qId) || {
          questionId: qId,
          questionPrompt: question.prompt,
          questionType: question.type,
          topicId: question.topicId,
          topicName: topicMap.get(question.topicId) || "Unknown",
          difficulty: question.difficulty || 50,
          totalAnswers: 0,
          correctAnswers: 0,
        };
        
        existing.totalAnswers++;
        if (checkAnswer(question, answer) === 1) {
          existing.correctAnswers++;
        }
        
        questionStatsMap.set(qId, existing);
      }
    }
    
    const questionStats = Array.from(questionStatsMap.values()).map(qs => ({
      questionId: qs.questionId,
      questionPrompt: qs.questionPrompt,
      questionType: qs.questionType,
      topicId: qs.topicId,
      topicName: qs.topicName,
      difficulty: qs.difficulty,
      totalAnswers: qs.totalAnswers,
      correctAnswers: qs.correctAnswers,
      correctPercent: qs.totalAnswers > 0 ? (qs.correctAnswers / qs.totalAnswers) * 100 : 0,
    })).sort((a, b) => a.correctPercent - b.correctPercent);
    
    // Статистика по уровням (для адаптивных тестов)
    interface LevelStatsEntry {
      levelIndex: number;
      levelName: string;
      topicId: string;
      topicName: string;
      achievedCount: number;
      attemptedCount: number;
      passedCount: number;
      failedCount: number;
      totalCorrect: number;
      totalAnswered: number;
    }
    
    let levelStats: Array<LevelStatsEntry & { avgCorrectPercent: number }> = [];
    
    if (test.mode === "adaptive") {
      const levelStatsMap = new Map<string, LevelStatsEntry>();
      
      for (const attempt of completedAttempts) {
        const result = attempt.resultJson as any;
        if (!result?.topicResults) continue;
        
        for (const tr of result.topicResults) {
          if (tr.achievedLevelIndex !== undefined && tr.achievedLevelIndex !== null) {
            const key = `${tr.topicId}-${tr.achievedLevelIndex}`;
            const existing = levelStatsMap.get(key) || {
              levelIndex: tr.achievedLevelIndex,
              levelName: tr.achievedLevelName || `Level ${tr.achievedLevelIndex}`,
              topicId: tr.topicId,
              topicName: tr.topicName,
              achievedCount: 0,
              attemptedCount: 0,
              passedCount: 0,
              failedCount: 0,
              totalCorrect: 0,
              totalAnswered: 0,
            };
            existing.achievedCount++;
            levelStatsMap.set(key, existing);
          }
          
          for (const la of tr.levelsAttempted || []) {
            const key = `${tr.topicId}-${la.levelIndex}`;
            const existing = levelStatsMap.get(key) || {
              levelIndex: la.levelIndex,
              levelName: la.levelName,
              topicId: tr.topicId,
              topicName: tr.topicName,
              achievedCount: 0,
              attemptedCount: 0,
              passedCount: 0,
              failedCount: 0,
              totalCorrect: 0,
              totalAnswered: 0,
            };
            
            existing.attemptedCount++;
            existing.totalCorrect += la.correctCount || 0;
            existing.totalAnswered += la.questionsAnswered || 0;
            
            if (la.status === "passed") {
              existing.passedCount++;
            } else if (la.status === "failed") {
              existing.failedCount++;
            }
            
            levelStatsMap.set(key, existing);
          }
        }
      }
      
      levelStats = Array.from(levelStatsMap.values()).map(ls => ({
        ...ls,
        avgCorrectPercent: ls.totalAnswered > 0 ? (ls.totalCorrect / ls.totalAnswered) * 100 : 0,
      })).sort((a, b) => {
        if (a.topicId !== b.topicId) return a.topicId.localeCompare(b.topicId);
        return a.levelIndex - b.levelIndex;
      });
    }
    
    // Распределение результатов
    const scoreRanges = [
      { range: "0-10", min: 0, max: 10, count: 0 },
      { range: "11-20", min: 11, max: 20, count: 0 },
      { range: "21-30", min: 21, max: 30, count: 0 },
      { range: "31-40", min: 31, max: 40, count: 0 },
      { range: "41-50", min: 41, max: 50, count: 0 },
      { range: "51-60", min: 51, max: 60, count: 0 },
      { range: "61-70", min: 61, max: 70, count: 0 },
      { range: "71-80", min: 71, max: 80, count: 0 },
      { range: "81-90", min: 81, max: 90, count: 0 },
      { range: "91-100", min: 91, max: 100, count: 0 },
    ];
    
    for (const attempt of completedAttempts) {
      const result = attempt.resultJson as AttemptResult | null;
      const percent = result?.overallPercent || 0;
      for (const range of scoreRanges) {
        if (percent >= range.min && percent <= range.max) {
          range.count++;
          break;
        }
      }
    }
    
    const scoreDistribution = scoreRanges.map(r => ({ range: r.range, count: r.count }));
    
    // Тренды по дням
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const dailyMap = new Map<string, { date: string; attempts: number; totalPercent: number; passed: number }>();
    
    for (const attempt of completedAttempts) {
      if (!attempt.finishedAt) continue;
      const finishedDate = new Date(attempt.finishedAt);
      if (finishedDate < thirtyDaysAgo) continue;
      
      const dateStr = finishedDate.toISOString().split("T")[0];
      const result = attempt.resultJson as AttemptResult | null;
      
      const existing = dailyMap.get(dateStr) || { date: dateStr, attempts: 0, totalPercent: 0, passed: 0 };
      existing.attempts++;
      existing.totalPercent += result?.overallPercent || 0;
      if (result?.overallPassed) existing.passed++;
      dailyMap.set(dateStr, existing);
    }
    
    const dailyTrends = Array.from(dailyMap.values())
      .map(d => ({
        date: d.date,
        attempts: d.attempts,
        avgPercent: d.attempts > 0 ? d.totalPercent / d.attempts : 0,
        passRate: d.attempts > 0 ? (d.passed / d.attempts) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    res.json({
      testId: test.id,
      testTitle: test.title,
      testMode: test.mode,
      summary,
      topicStats,
      questionStats,
      levelStats: test.mode === "adaptive" ? levelStats : undefined,
      scoreDistribution,
      dailyTrends,
    });
    
  } catch (error) {
    console.error("Test analytics error:", error);
    res.status(500).json({ error: "Failed to fetch test analytics" });
  }
});

// GET /api/analytics/scorm-attempts - Все SCORM попытки для аналитики
app.get("/api/analytics/scorm-attempts", requireAuthor, async (req: Request, res: Response) => {
  try {
    const attempts = await storage.getAllScormAttempts();
    const packages = await storage.getScormPackages();
    
    // Создаем map пакетов для быстрого доступа
    const packageMap = new Map(packages.map(p => [p.id, p]));
    
    // Обогащаем попытки данными пакета
    const enrichedAttempts = await Promise.all(attempts.map(async (attempt) => {
      const pkg = packageMap.get(attempt.packageId);
      const answers = await storage.getScormAnswersByAttempt(attempt.id);
      
      return {
        id: attempt.id,
        packageId: attempt.packageId,
        sessionId: attempt.sessionId,
        
        // Данные теста из пакета
        testId: pkg?.testId || null,
        testTitle: pkg?.testTitle || "Удалённый тест",
        testMode: pkg?.testMode || "standard",
        
        // Данные пользователя LMS
        lmsUserId: attempt.lmsUserId,
        lmsUserName: attempt.lmsUserName,
        lmsUserEmail: attempt.lmsUserEmail,
        lmsUserOrg: attempt.lmsUserOrg,
        
        // Временные метки
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        
        // Результаты
        resultPercent: attempt.resultPercent,
        resultPassed: attempt.resultPassed,
        totalPoints: attempt.totalPoints,
        maxPoints: attempt.maxPoints,
        totalQuestions: attempt.totalQuestions,
        correctAnswers: attempt.correctAnswers,
        
        // Для адаптивных
        achievedLevels: attempt.achievedLevelsJson,
        
        // Количество ответов
        answersCount: answers.length,
        
        // Источник
        source: "lms" as const,
      };
    }));
    
    res.json(enrichedAttempts);
  } catch (error) {
    console.error("Get SCORM attempts error:", error);
    res.status(500).json({ error: "Failed to get SCORM attempts" });
  }
});

// GET /api/analytics/scorm-attempts/:attemptId - Детали SCORM попытки
app.get("/api/analytics/scorm-attempts/:attemptId", requireAuthor, async (req: Request, res: Response) => {
  try {
    const attempt = await storage.getScormAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }
    
    const pkg = await storage.getScormPackage(attempt.packageId);
    const answers = await storage.getScormAnswersByAttempt(attempt.id);
    
    // Вычисляем duration
    const duration = attempt.startedAt && attempt.finishedAt
      ? (new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000
      : null;
    
    // Группируем ответы по темам для topicResults
    const topicResultsMap = new Map<string, {
      topicId: string;
      topicName: string;
      earnedPoints: number;
      possiblePoints: number;
      correct: number;
      total: number;
    }>();
    
    const detailedAnswers = answers.map(a => {
      // Собираем статистику по темам
      if (a.topicId) {
        const existing = topicResultsMap.get(a.topicId) || {
          topicId: a.topicId,
          topicName: a.topicName || "Unknown",
          earnedPoints: 0,
          possiblePoints: 0,
          correct: 0,
          total: 0,
        };
        existing.total++;
        existing.possiblePoints += a.maxPoints || 1;
        if (a.isCorrect) {
          existing.correct++;
          existing.earnedPoints += a.points || 0;
        }
        topicResultsMap.set(a.topicId, existing);
      }
      
      return {
        questionId: a.questionId,
        questionPrompt: a.questionPrompt,
        questionType: a.questionType,
        topicId: a.topicId,
        topicName: a.topicName,
        difficulty: a.difficulty,
        userAnswer: a.userAnswerJson,
        correctAnswer: a.correctAnswerJson,
        isCorrect: a.isCorrect,
        earnedPoints: a.points,
        possiblePoints: a.maxPoints,
        // Варианты ответов для отображения
        options: a.optionsJson,
        leftItems: a.leftItemsJson,
        rightItems: a.rightItemsJson,
        items: a.itemsJson,
        levelIndex: a.levelIndex,
        levelName: a.levelName,
        answeredAt: a.answeredAt,
      };
    });
    
    const topicResults = Array.from(topicResultsMap.values()).map(tr => ({
      topicId: tr.topicId,
      topicName: tr.topicName,
      percent: tr.possiblePoints > 0 ? (tr.earnedPoints / tr.possiblePoints) * 100 : 0,
      passed: null, // LMS не знает о pass rules
      earnedPoints: tr.earnedPoints,
      possiblePoints: tr.possiblePoints,
    }));
    
    // Парсим achievedLevels если есть
    let achievedLevels = null;
    if (attempt.achievedLevelsJson) {
      try {
        achievedLevels = typeof attempt.achievedLevelsJson === 'string'
          ? JSON.parse(attempt.achievedLevelsJson as string)
          : attempt.achievedLevelsJson;
      } catch (e) {
        achievedLevels = null;
      }
    }
    
    res.json({
      attemptId: attempt.id,
      lmsUserId: attempt.lmsUserId,
      lmsUserName: attempt.lmsUserName,
      lmsUserEmail: attempt.lmsUserEmail,
      testId: pkg?.testId || null,
      testTitle: pkg?.testTitle || "Удалённый тест",
      testMode: pkg?.testMode || "standard",
      startedAt: attempt.startedAt?.toISOString() || null,
      finishedAt: attempt.finishedAt?.toISOString() || null,
      duration,
      overallPercent: attempt.resultPercent || 0,
      earnedPoints: attempt.totalPoints || 0,
      possiblePoints: attempt.maxPoints || 0,
      passed: attempt.resultPassed || false,
      answers: detailedAnswers,
      topicResults,
      achievedLevels,
      source: "lms",
    });
  } catch (error) {
    console.error("Get SCORM attempt details error:", error);
    res.status(500).json({ error: "Failed to get attempt details" });
  }
});

// GET /api/analytics/combined - Комбинированная аналитика (Web + LMS)
app.get("/api/analytics/combined", requireAuthor, async (req: Request, res: Response) => {
  try {
    const source = req.query.source as string || "all"; // "all" | "web" | "lms"
    const testId = req.query.testId as string || null;
    
    let webAttempts: any[] = [];
    let lmsAttempts: any[] = [];
    
    // Web attempts
    if (source === "all" || source === "web") {
      const attempts = await storage.getAllAttempts();
      const users = await Promise.all(
        [...new Set(attempts.map(a => a.userId))].map(id => storage.getUser(id))
      );
      const userMap = new Map(users.filter(Boolean).map(u => [u!.id, u!]));
      
      // Загружаем тесты для названий
      const tests = await storage.getTests();
      const testMap = new Map(tests.map(t => [t.id, t]));

      webAttempts = attempts
        .filter(a => !testId || a.testId === testId)
        .filter(a => a.finishedAt) // Только завершённые
        .map(a => {
          const user = userMap.get(a.userId);
          const result = a.resultJson as any;
          const test = testMap.get(a.testId);
          return {
            id: a.id,
            testId: a.testId,
            testTitle: test?.title || "Удалённый тест",
            userId: a.userId,
            username: user?.name || user?.email || "Unknown",
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            resultPercent: result?.overallPercent || 0,
            resultPassed: result?.overallPassed || false,
            totalPoints: result?.totalEarnedPoints || 0,
            maxPoints: result?.totalPossiblePoints || 0,
            source: "web" as const,
          };
        });
    }
    
    // LMS attempts
    if (source === "all" || source === "lms") {
      const attempts = await storage.getAllScormAttempts();
      const packages = await storage.getScormPackages();
      const packageMap = new Map(packages.map(p => [p.id, p]));
      
      lmsAttempts = attempts
        .filter(a => {
          if (!testId) return true;
          const pkg = packageMap.get(a.packageId);
          return pkg?.testId === testId;
        })
        .filter(a => a.finishedAt) // Только завершённые
        .map(a => {
          const pkg = packageMap.get(a.packageId);
          return {
            id: a.id,
            testId: pkg?.testId || null,
            testTitle: pkg?.testTitle || "Удалённый тест",
            lmsUserId: a.lmsUserId,
            lmsUserName: a.lmsUserName,
            lmsUserEmail: a.lmsUserEmail,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            resultPercent: a.resultPercent || 0,
            resultPassed: a.resultPassed || false,
            totalPoints: a.totalPoints || 0,
            maxPoints: a.maxPoints || 0,
            source: "lms" as const,
          };
        });
    }
    
    // Combine and sort by date
    const combined = [...webAttempts, ...lmsAttempts].sort((a, b) => 
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    
    // Summary
    const totalAttempts = combined.length;
    const passedAttempts = combined.filter(a => a.resultPassed).length;
    const avgPercent = totalAttempts > 0 
      ? combined.reduce((sum, a) => sum + (a.resultPercent || 0), 0) / totalAttempts 
      : 0;
    
    res.json({
      summary: {
        totalAttempts,
        passedAttempts,
        passRate: totalAttempts > 0 ? (passedAttempts / totalAttempts) * 100 : 0,
        avgPercent,
        webAttempts: webAttempts.length,
        lmsAttempts: lmsAttempts.length,
      },
      attempts: combined,
    });
  } catch (error) {
    console.error("Get combined analytics error:", error);
    res.status(500).json({ error: "Failed to get combined analytics" });
  }
});

// Список попыток по тесту
app.get("/api/analytics/tests/:testId/attempts", requireAuthor, async (req: Request, res: Response) => {
  try {
    const testId = req.params.testId;
    const test = await storage.getTest(testId);
    
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }
    
    const allAttempts = await storage.getAllAttempts();
    const testAttempts = allAttempts.filter(a => a.testId === testId);
    
    const userIds = Array.from(new Set(testAttempts.map(a => a.userId)));
    const users = await Promise.all(userIds.map(id => storage.getUser(id)));
    const userMap = new Map<string, string>();
    for (const u of users) {
      if (u) userMap.set(u.id, u.name || u.email || "Unknown");
    }
    
    const attemptsList = testAttempts.map(attempt => {
      const result = attempt.resultJson as any;
      const duration = attempt.startedAt && attempt.finishedAt
        ? (new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000
        : null;
      
      let achievedLevels: Array<{ topicName: string; levelName: string | null }> | undefined;
      if (test.mode === "adaptive" && result?.topicResults) {
        achievedLevels = result.topicResults.map((tr: any) => ({
          topicName: tr.topicName,
          levelName: tr.achievedLevelName || null,
        }));
      }
      
      return {
        attemptId: attempt.id,
        userId: attempt.userId,
        username: userMap.get(attempt.userId) || "Unknown",
        startedAt: attempt.startedAt?.toISOString() || null,
        finishedAt: attempt.finishedAt?.toISOString() || null,
        duration,
        overallPercent: result?.overallPercent || 0,
        earnedPoints: result?.totalEarnedPoints || 0,
        possiblePoints: result?.totalPossiblePoints || 0,
        passed: result?.overallPassed || false,
        completed: result !== null,
        achievedLevels,
      };
    }).sort((a, b) => {
      if (a.completed !== b.completed) return b.completed ? 1 : -1;
      const dateA = a.finishedAt || a.startedAt || "";
      const dateB = b.finishedAt || b.startedAt || "";
      return dateB.localeCompare(dateA);
    });
    
    res.json({
      testId: test.id,
      testTitle: test.title,
      testMode: test.mode,
      attempts: attemptsList,
    });
    
  } catch (error) {
    console.error("Test attempts list error:", error);
    res.status(500).json({ error: "Failed to fetch attempts list" });
  }
});

// Детализация конкретной попытки
app.get("/api/analytics/attempts/:attemptId", requireAuthor, async (req: Request, res: Response) => {
  try {
    const attemptId = req.params.attemptId;
    const attempt = await storage.getAttempt(attemptId);
    
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }
    
    const test = await storage.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }
    
    const user = await storage.getUser(attempt.userId);
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));
    
    const result = attempt.resultJson as any;
    const answers = (attempt.answersJson || {}) as Record<string, unknown>;
    const variant = attempt.variantJson as any;
    
    const questionIds: string[] = [];
    if (variant?.sections) {
      for (const section of variant.sections) {
        questionIds.push(...(section.questionIds || []));
      }
    }
    if (variant?.topics) {
      for (const topic of variant.topics) {
        for (const level of topic.levelsState || []) {
          questionIds.push(...(level.questionIds || []));
        }
      }
    }
    
    const uniqueQuestionIds = Array.from(new Set(questionIds));
    const questions = await storage.getQuestionsByIds(uniqueQuestionIds);
    const questionMap = new Map(questions.map(q => [q.id, q]));
    
    interface DetailedAnswerItem {
      questionId: string;
      questionPrompt: string;
      questionType: string;
      topicId: string;
      topicName: string;
      userAnswer: unknown;
      userAnswerRaw: unknown;
      correctAnswer: unknown;
      correctAnswerRaw: unknown;
      isCorrect: boolean;
      earnedPoints: number;
      possiblePoints: number;
      difficulty: number;
      levelName?: string;
      levelIndex?: number;
      questionData?: unknown;
    }
    
    const detailedAnswers: DetailedAnswerItem[] = [];
    
    for (const [qId, userAnswer] of Object.entries(answers)) {
      const question = questionMap.get(qId);
      if (!question) continue;
      
      const isCorrect = checkAnswer(question, userAnswer) === 1;
      
      let levelName: string | undefined;
      let levelIndex: number | undefined;
      
      if (variant?.topics) {
        for (const topic of variant.topics) {
          for (const level of topic.levelsState || []) {
            if (level.answeredQuestionIds?.includes(qId)) {
              levelName = level.levelName;
              levelIndex = level.levelIndex;
              break;
            }
          }
        }
      }
      
      // Форматируем ответы для отображения
      const dataJson = question.dataJson as any;
      const correctJson = question.correctJson as any;
      
      let formattedUserAnswer: any = userAnswer;
      let formattedCorrectAnswer: any = correctJson;
      
      if (question.type === "single" && dataJson?.options) {
        formattedUserAnswer = dataJson.options[userAnswer as number] || userAnswer;
        formattedCorrectAnswer = dataJson.options[correctJson?.correctIndex] || correctJson;
      } else if (question.type === "multiple" && dataJson?.options) {
        const userIndices = (userAnswer as number[]) || [];
        formattedUserAnswer = userIndices.map(i => dataJson.options[i]).filter(Boolean);
        formattedCorrectAnswer = (correctJson?.correctIndices || []).map((i: number) => dataJson.options[i]).filter(Boolean);
      } else if (question.type === "matching" && dataJson?.left && dataJson?.right) {
        const userPairs = userAnswer as Record<number, number> || {};
        formattedUserAnswer = Object.entries(userPairs).map(([l, r]) => ({
          left: dataJson.left[parseInt(l)],
          right: dataJson.right[r as number],
        }));
        formattedCorrectAnswer = (correctJson?.pairs || []).map((p: {left: number, right: number}) => ({
          left: dataJson.left[p.left],
          right: dataJson.right[p.right],
        }));
      } else if (question.type === "ranking" && dataJson?.items) {
        const userOrder = (userAnswer as number[]) || [];
        formattedUserAnswer = userOrder.map(i => dataJson.items[i]).filter(Boolean);
        formattedCorrectAnswer = (correctJson?.correctOrder || []).map((i: number) => dataJson.items[i]).filter(Boolean);
      }

      detailedAnswers.push({
        questionId: qId,
        questionPrompt: question.prompt,
        questionType: question.type,
        topicId: question.topicId,
        topicName: topicMap.get(question.topicId) || "Unknown",
        userAnswer: formattedUserAnswer,
        userAnswerRaw: userAnswer,
        correctAnswer: formattedCorrectAnswer,
        correctAnswerRaw: correctJson,
        isCorrect,
        earnedPoints: isCorrect ? (question.points || 1) : 0,
        possiblePoints: question.points || 1,
        difficulty: question.difficulty || 50,
        levelName,
        levelIndex,
        questionData: dataJson, // Добавляем данные вопроса для отображения
      });
    }
    
    interface TrajectoryItem {
      action: string;
      topicId?: string;
      topicName?: string;
      levelIndex?: number;
      levelName?: string;
      message?: string;
    }
    
    interface AchievedLevelItem {
      topicId: string;
      topicName: string;
      levelIndex: number | null;
      levelName: string | null;
    }
    
    let trajectory: TrajectoryItem[] | undefined;
    let achievedLevels: AchievedLevelItem[] | undefined;
    
    if (test.mode === "adaptive" && variant?.topics) {
      achievedLevels = variant.topics.map((t: any) => ({
        topicId: t.topicId,
        topicName: t.topicName,
        levelIndex: t.finalLevelIndex,
        levelName: t.finalLevelIndex !== null && t.levelsState[t.finalLevelIndex]
          ? t.levelsState[t.finalLevelIndex].levelName
          : null,
      }));
      
      trajectory = [];
      for (const topic of variant.topics) {
        for (const level of topic.levelsState || []) {
          if (level.status === "passed" || level.status === "failed") {
            trajectory.push({
              action: level.status === "passed" ? "level_up" : "level_down",
              topicId: topic.topicId,
              topicName: topic.topicName,
              levelIndex: level.levelIndex,
              levelName: level.levelName,
              message: level.status === "passed" 
                ? `Уровень "${level.levelName}" пройден` 
                : `Уровень "${level.levelName}" не пройден`,
            });
          }
        }
      }
    }
    
    const duration = attempt.startedAt && attempt.finishedAt
      ? (new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000
      : null;
    
    res.json({
      attemptId: attempt.id,
      userId: attempt.userId,
      username: user?.name || user?.email || "Unknown",
      testId: test.id,
      testTitle: test.title,
      testMode: test.mode,
      startedAt: attempt.startedAt?.toISOString() || null,
      finishedAt: attempt.finishedAt?.toISOString() || null,
      duration,
      overallPercent: result?.overallPercent || 0,
      earnedPoints: result?.totalEarnedPoints || 0,
      possiblePoints: result?.totalPossiblePoints || 0,
      passed: result?.overallPassed || false,
      answers: detailedAnswers,
      topicResults: result?.topicResults || [],
      trajectory,
      achievedLevels,
    });
    
  } catch (error) {
    console.error("Attempt detail error:", error);
    res.status(500).json({ error: "Failed to fetch attempt details" });
  }
});

  // ============================================
// Phase 5: Excel Export Endpoint (UPDATED)
// Заменить предыдущую версию в routes.ts
// ============================================

// Экспорт аналитики теста в Excel
app.get("/api/analytics/tests/:testId/export/excel", requireAuthor, async (req: Request, res: Response) => {
  try {
    const testId = req.params.testId;
    const test = await storage.getTest(testId);
    
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }
    
    const allAttempts = await storage.getAllAttempts();
    const testAttempts = allAttempts.filter(a => a.testId === testId);
    const completedAttempts = testAttempts.filter(a => a.resultJson !== null);
    
    // Загружаем пользователей
    const userIds = Array.from(new Set(testAttempts.map(a => a.userId)));
    const users = await Promise.all(userIds.map(id => storage.getUser(id)));
    const userMap = new Map<string, string>();
    for (const u of users) {
      if (u) userMap.set(u.id, u.name || u.email || "Unknown");
    }
    
    // Загружаем темы
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));
    
    // Собираем все вопросы
    const allQuestionIds = new Set<string>();
    for (const attempt of testAttempts) {
      const variant = attempt.variantJson as any;
      if (variant?.sections) {
        for (const section of variant.sections) {
          for (const qId of section.questionIds || []) {
            allQuestionIds.add(qId);
          }
        }
      }
      if (variant?.topics) {
        for (const topic of variant.topics) {
          for (const level of topic.levelsState || []) {
            for (const qId of level.questionIds || []) {
              allQuestionIds.add(qId);
            }
          }
        }
      }
    }
    
    const questions = await storage.getQuestionsByIds(Array.from(allQuestionIds));
    const questionMap = new Map(questions.map(q => [q.id, q]));
    
    // ===== ЛИСТ 1: Сводка =====
    const summaryData: any[][] = [
      ["Аналитика теста"],
      [],
      ["Название теста", test.title],
      ["Режим", test.mode === "adaptive" ? "Адаптивный" : "Стандартный"],
      ["Дата экспорта", new Date().toLocaleString("ru-RU")],
      [],
      ["Показатель", "Значение"],
      ["Всего попыток", testAttempts.length],
      ["Завершённых попыток", completedAttempts.length],
      ["Уникальных пользователей", new Set(completedAttempts.map(a => a.userId)).size],
    ];
    
    if (completedAttempts.length > 0) {
      const avgPercent = completedAttempts.reduce((sum, a) => {
        const result = a.resultJson as any;
        return sum + (result?.overallPercent || 0);
      }, 0) / completedAttempts.length;
      
      const passedCount = completedAttempts.filter(a => {
        const result = a.resultJson as any;
        return result?.overallPassed;
      }).length;
      
      summaryData.push(
        ["Средний результат", `${avgPercent.toFixed(1)}%`],
        ["Процент прохождения", `${((passedCount / completedAttempts.length) * 100).toFixed(1)}%`]
      );
    }
    
    // ===== ЛИСТ 2: Попытки =====
    const attemptsHeaders = [
      "ID попытки",
      "Пользователь",
      "Дата начала",
      "Дата завершения",
      "Время (сек)",
      "Результат (%)",
      "Баллы",
      "Макс. баллы",
      "Статус",
    ];
    
    if (test.mode === "adaptive") {
      attemptsHeaders.push("Достигнутые уровни");
    }
    
    const attemptsData: any[][] = [attemptsHeaders];
    
    for (const attempt of testAttempts) {
      const result = attempt.resultJson as any;
      const duration = attempt.startedAt && attempt.finishedAt
        ? Math.round((new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000)
        : null;
      
      const row: any[] = [
        attempt.id,
        userMap.get(attempt.userId) || "Unknown",
        attempt.startedAt ? new Date(attempt.startedAt).toLocaleString("ru-RU") : "",
        attempt.finishedAt ? new Date(attempt.finishedAt).toLocaleString("ru-RU") : "",
        duration ?? "",
        result?.overallPercent?.toFixed(1) ?? "",
        result?.totalEarnedPoints ?? "",
        result?.totalPossiblePoints ?? "",
        result ? (result.overallPassed ? "Сдан" : "Не сдан") : "В процессе",
      ];
      
      if (test.mode === "adaptive" && result?.topicResults) {
        const levels = result.topicResults
          .map((tr: any) => `${tr.topicName}: ${tr.achievedLevelName || "—"}`)
          .join("; ");
        row.push(levels);
      }
      
      attemptsData.push(row);
    }
    
    // ===== ЛИСТ 3: Детальные ответы =====
    const answersHeaders = [
      "ID попытки",
      "Пользователь",
      "Время начала",
      "Вопрос",
      "Тема",
      "Тип вопроса",
      "Сложность",
      "Варианты ответа",
      "Правильный ответ",
      "Ответ пользователя",
      "Результат",
      "Баллы",
    ];
    
    if (test.mode === "adaptive") {
      answersHeaders.push("Уровень");
    }
    
    const answersData: any[][] = [answersHeaders];
    
    // Сортируем попытки по пользователю и дате
    const sortedAttempts = [...completedAttempts].sort((a, b) => {
      const userA = userMap.get(a.userId) || "";
      const userB = userMap.get(b.userId) || "";
      if (userA !== userB) return userA.localeCompare(userB);
      const dateA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const dateB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return dateA - dateB;
    });
    
    for (const attempt of sortedAttempts) {
      const answers = (attempt.answersJson || {}) as Record<string, unknown>;
      const variant = attempt.variantJson as any;
      const username = userMap.get(attempt.userId) || "Unknown";
      const startDateStr = attempt.startedAt 
        ? new Date(attempt.startedAt).toLocaleString("ru-RU") 
        : "";
      
      for (const [qId, userAnswer] of Object.entries(answers)) {
        const question = questionMap.get(qId);
        if (!question) continue;
        
        const isCorrect = checkAnswer(question, userAnswer) === 1;
        const dataJson = question.dataJson as any;
        const correctJson = question.correctJson as any;
        
        // Форматируем варианты ответа
        const allOptions = formatAllOptions(question.type, dataJson);
        
        // Форматируем правильный ответ (текстом)
        const correctAnswerText = formatCorrectAnswerText(question.type, dataJson, correctJson);
        
        // Форматируем ответ пользователя (текстом)
        const userAnswerText = formatUserAnswerText(question.type, dataJson, userAnswer);
        
        // Находим уровень для адаптивных тестов
        let levelName = "";
        if (variant?.topics) {
          for (const topic of variant.topics) {
            for (const level of topic.levelsState || []) {
              if (level.answeredQuestionIds?.includes(qId)) {
                levelName = level.levelName;
                break;
              }
            }
          }
        }
        
        const row: any[] = [
          attempt.id,
          username,
          startDateStr,
          question.prompt,
          topicMap.get(question.topicId) || "Unknown",
          formatQuestionType(question.type),
          question.difficulty || 50,
          allOptions,
          correctAnswerText,
          userAnswerText,
          isCorrect ? "Верно" : "Неверно",
          isCorrect ? (question.points || 1) : 0,
        ];
        
        if (test.mode === "adaptive") {
          row.push(levelName);
        }
        
        answersData.push(row);
      }
    }
    
    // ===== ЛИСТ 4: Статистика по вопросам =====
    const questionStatsMap = new Map<string, { total: number; correct: number }>();
    
    for (const attempt of completedAttempts) {
      const answers = (attempt.answersJson || {}) as Record<string, unknown>;
      for (const [qId, answer] of Object.entries(answers)) {
        const question = questionMap.get(qId);
        if (!question) continue;
        
        const stats = questionStatsMap.get(qId) || { total: 0, correct: 0 };
        stats.total++;
        if (checkAnswer(question, answer) === 1) {
          stats.correct++;
        }
        questionStatsMap.set(qId, stats);
      }
    }
    
    const questionStatsData: any[][] = [
      ["Вопрос", "Тема", "Тип", "Сложность", "Варианты ответа", "Правильный ответ", "Всего ответов", "Правильных", "% правильных"]
    ];
    
    for (const [qId, stats] of questionStatsMap.entries()) {
      const question = questionMap.get(qId);
      if (!question) continue;
      
      const dataJson = question.dataJson as any;
      const correctJson = question.correctJson as any;
      
      questionStatsData.push([
        question.prompt,
        topicMap.get(question.topicId) || "Unknown",
        formatQuestionType(question.type),
        question.difficulty || 50,
        formatAllOptions(question.type, dataJson),
        formatCorrectAnswerText(question.type, dataJson, correctJson),
        stats.total,
        stats.correct,
        stats.total > 0 ? `${((stats.correct / stats.total) * 100).toFixed(1)}%` : "0%",
      ]);
    }
    
    // Сортируем по % правильных (от меньшего к большему)
    const header = questionStatsData.shift();
    questionStatsData.sort((a, b) => {
      const pctA = parseFloat(String(a[8]).replace("%", "")) || 0;
      const pctB = parseFloat(String(b[8]).replace("%", "")) || 0;
      return pctA - pctB;
    });
    questionStatsData.unshift(header!);
    
    // ===== Создаём Excel файл =====
    const workbook = XLSX.utils.book_new();
    
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Сводка");
    
    const attemptsSheet = XLSX.utils.aoa_to_sheet(attemptsData);
    attemptsSheet["!cols"] = [
      { wch: 36 }, // ID попытки
      { wch: 20 }, // Пользователь
      { wch: 18 }, // Дата начала
      { wch: 18 }, // Дата завершения
      { wch: 12 }, // Время
      { wch: 12 }, // Результат
      { wch: 10 }, // Баллы
      { wch: 12 }, // Макс баллы
      { wch: 12 }, // Статус
      { wch: 40 }, // Уровни
    ];
    XLSX.utils.book_append_sheet(workbook, attemptsSheet, "Попытки");
    
    const answersSheet = XLSX.utils.aoa_to_sheet(answersData);
    answersSheet["!cols"] = [
      { wch: 36 }, // ID попытки
      { wch: 15 }, // Пользователь
      { wch: 18 }, // Время начала
      { wch: 50 }, // Вопрос
      { wch: 20 }, // Тема
      { wch: 15 }, // Тип вопроса
      { wch: 10 }, // Сложность
      { wch: 50 }, // Варианты ответа
      { wch: 30 }, // Правильный ответ
      { wch: 30 }, // Ответ пользователя
      { wch: 10 }, // Результат
      { wch: 8 },  // Баллы
      { wch: 15 }, // Уровень
    ];
    XLSX.utils.book_append_sheet(workbook, answersSheet, "Ответы");
    
    const questionStatsSheet = XLSX.utils.aoa_to_sheet(questionStatsData);
    questionStatsSheet["!cols"] = [
      { wch: 50 }, // Вопрос
      { wch: 20 }, // Тема
      { wch: 15 }, // Тип
      { wch: 10 }, // Сложность
      { wch: 50 }, // Варианты
      { wch: 30 }, // Правильный
      { wch: 12 }, // Всего
      { wch: 12 }, // Правильных
      { wch: 12 }, // %
    ];
    XLSX.utils.book_append_sheet(workbook, questionStatsSheet, "Статистика вопросов");
    
    // Генерируем буфер
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    
    // Отправляем файл
    const filename = `analytics_${test.title.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`;
    
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
    
  } catch (error) {
    console.error("Excel export error:", error);
    res.status(500).json({ error: "Failed to export Excel" });
  }
});

// ===== Вспомогательные функции для форматирования =====

// Форматирование типа вопроса на русском
function formatQuestionType(type: string): string {
  const types: Record<string, string> = {
    single: "Один ответ",
    multiple: "Несколько ответов",
    matching: "Сопоставление",
    ranking: "Ранжирование",
  };
  return types[type] || type;
}

// Все варианты ответа
function formatAllOptions(type: string, dataJson: any): string {
  if (!dataJson) return "";
  
  switch (type) {
    case "single":
    case "multiple":
      // options: ["A", "B", "C", "D"]
      if (dataJson.options && Array.isArray(dataJson.options)) {
        return dataJson.options.map((opt: string, i: number) => `${i + 1}) ${opt}`).join("\n");
      }
      break;
      
    case "matching":
      // left: ["A", "B"], right: ["1", "2"]
      if (dataJson.left && dataJson.right) {
        const leftStr = dataJson.left.map((l: string, i: number) => `${i + 1}. ${l}`).join(", ");
        const rightStr = dataJson.right.map((r: string, i: number) => `${String.fromCharCode(65 + i)}. ${r}`).join(", ");
        return `Левая: ${leftStr}\nПравая: ${rightStr}`;
      }
      break;
      
    case "ranking":
      // items: ["First", "Second", "Third"]
      if (dataJson.items && Array.isArray(dataJson.items)) {
        return dataJson.items.map((item: string, i: number) => `${i + 1}) ${item}`).join("\n");
      }
      break;
  }
  
  return JSON.stringify(dataJson);
}

// Правильный ответ текстом
function formatCorrectAnswerText(type: string, dataJson: any, correctJson: any): string {
  if (!correctJson) return "";
  
  switch (type) {
    case "single":
      // correctIndex: 2 -> "3) Option C"
      if (correctJson.correctIndex !== undefined && dataJson?.options) {
        const idx = correctJson.correctIndex;
        return `${idx + 1}) ${dataJson.options[idx] || "?"}`;
      }
      break;
      
    case "multiple":
      // correctIndices: [0, 2] -> "1) A, 3) C"
      if (correctJson.correctIndices && dataJson?.options) {
        return correctJson.correctIndices
          .map((idx: number) => `${idx + 1}) ${dataJson.options[idx] || "?"}`)
          .join(", ");
      }
      break;
      
    case "matching":
      // pairs: [{left: 0, right: 1}, {left: 1, right: 0}]
      if (correctJson.pairs && dataJson?.left && dataJson?.right) {
        return correctJson.pairs
          .map((p: any) => `${dataJson.left[p.left]} → ${dataJson.right[p.right]}`)
          .join(", ");
      }
      break;
      
    case "ranking":
      // correctOrder: [2, 0, 1] -> items in correct order
      if (correctJson.correctOrder && dataJson?.items) {
        return correctJson.correctOrder
          .map((idx: number, pos: number) => `${pos + 1}. ${dataJson.items[idx] || "?"}`)
          .join(", ");
      }
      break;
  }
  
  return JSON.stringify(correctJson);
}

// Ответ пользователя текстом
function formatUserAnswerText(type: string, dataJson: any, userAnswer: unknown): string {
  if (userAnswer === null || userAnswer === undefined) return "(нет ответа)";
  
  switch (type) {
    case "single":
      // userAnswer: 1 -> "2) Option B"
      if (typeof userAnswer === "number" && dataJson?.options) {
        return `${userAnswer + 1}) ${dataJson.options[userAnswer] || "?"}`;
      }
      break;
      
    case "multiple":
      // userAnswer: [0, 2] -> "1) A, 3) C"
      if (Array.isArray(userAnswer) && dataJson?.options) {
        if (userAnswer.length === 0) return "(ничего не выбрано)";
        return userAnswer
          .map((idx: number) => `${idx + 1}) ${dataJson.options[idx] || "?"}`)
          .join(", ");
      }
      break;
      
    case "matching":
      // userAnswer: {0: 1, 1: 0} -> "A → 2, B → 1"
      if (typeof userAnswer === "object" && dataJson?.left && dataJson?.right) {
        const pairs = userAnswer as Record<string, number>;
        return Object.entries(pairs)
          .map(([leftIdx, rightIdx]) => {
            const leftItem = dataJson.left[Number(leftIdx)] || "?";
            const rightItem = dataJson.right[rightIdx] || "?";
            return `${leftItem} → ${rightItem}`;
          })
          .join(", ");
      }
      break;
      
    case "ranking":
      // userAnswer: [1, 2, 0] -> "1. B, 2. C, 3. A"
      if (Array.isArray(userAnswer) && dataJson?.items) {
        return userAnswer
          .map((idx: number, pos: number) => `${pos + 1}. ${dataJson.items[idx] || "?"}`)
          .join(", ");
      }
      break;
  }
  
  return String(userAnswer);
}

// Получить данные для фильтров экспорта (тесты и пользователи)
app.get("/api/export/filters", requireAuthor, async (req: Request, res: Response) => {
  try {
    const tests = await storage.getTests();
    const allAttempts = await storage.getAllAttempts();
    const allScormAttempts = await storage.getAllScormAttempts();
    const scormPackages = await storage.getScormPackages();
    
    // Создаём карту testId -> packageId для SCORM
    const scormTestIds = new Set(scormPackages.map(p => p.testId));
    
    // Определяем какие тесты имеют Web и/или LMS попытки
    const webTestIds = new Set(allAttempts.filter(a => a.finishedAt).map(a => a.testId));
    const lmsTestIds = new Set<string>();
    for (const attempt of allScormAttempts) {
      if (attempt.finishedAt) {
        const pkg = scormPackages.find(p => p.id === attempt.packageId);
        if (pkg?.testId) lmsTestIds.add(pkg.testId);
      }
    }
    
    const testOptions = tests.map(t => ({
      id: t.id,
      title: t.title,
      mode: t.mode || "standard",
      hasWebAttempts: webTestIds.has(t.id),
      hasLmsAttempts: lmsTestIds.has(t.id),
    }));
    
    // Получаем уникальных Web-пользователей из попыток
    const userIds = Array.from(new Set(allAttempts.map(a => a.userId)));
    const users = await Promise.all(userIds.map(id => storage.getUser(id)));
    
    const webUserOptions = users
      .filter((u): u is NonNullable<typeof u> => u !== undefined)
      .map(u => ({
        id: u.id,
        username: u.name || u.email || "Unknown",
        source: "web" as const,
      }));

    // Получаем уникальных LMS-пользователей из SCORM попыток
    const lmsUserMap = new Map<string, { id: string; username: string; email?: string }>();
    for (const attempt of allScormAttempts) {
      if (!attempt.finishedAt) continue; // Только завершённые попытки
      const odataUserId = attempt.lmsUserId || attempt.sessionId;
      if (odataUserId && !lmsUserMap.has(odataUserId)) {
        // Формируем понятное имя: Имя > Email > сокращённый ID
        let displayName = attempt.lmsUserName || attempt.lmsUserEmail;
        if (!displayName) {
          displayName = `LMS User (${odataUserId.slice(0, 8)}...)`;
        }
        lmsUserMap.set(odataUserId, {
          id: odataUserId,
          username: displayName,
          email: attempt.lmsUserEmail || undefined,
        });
      }
    }
    
    const lmsUserOptions = Array.from(lmsUserMap.values()).map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      source: "lms" as const,
    }));

    const userOptions = [...webUserOptions, ...lmsUserOptions]
      .sort((a, b) => (a.username || "").localeCompare(b.username || ""));
    
    // Получаем группы
    const groups = await storage.getGroups();
    const groupOptions = await Promise.all(groups.map(async g => {
      const groupUsers = await storage.getGroupUsers(g.id);
      return {
        id: g.id,
        name: g.name,
        userCount: groupUsers.length,
        userIds: groupUsers.map(u => u.id),
      };
    }));
    
    // SCORM пакеты
    const scormOptions = scormPackages.map(p => ({
      id: p.id,
      testId: p.testId,
      testTitle: p.testTitle,
      exportedAt: p.exportedAt,
      isActive: p.isActive,
    }));
    
    res.json({
      tests: testOptions,
      users: userOptions,
      groups: groupOptions,
      scormPackages: scormOptions,
    });
  } catch (error) {
    console.error("Export filters error:", error);
    res.status(500).json({ error: "Failed to fetch export filters" });
  }
});

// ============================================
// Export report to Excel (POST /api/export/excel)
// ============================================
app.post("/api/export/excel", requireAuthor, async (req: Request, res: Response) => {
  try {
    const config = req.body as any;

    const testIds: string[] = Array.isArray(config?.testIds) ? config.testIds : [];
    const userIds: string[] = Array.isArray(config?.userIds) ? config.userIds : [];
    const dateFrom: string = config?.dateFrom || "";
    const dateTo: string = config?.dateTo || "";
    const bestAttemptOnly: boolean = !!config?.bestAttemptOnly;
    const bestAttemptCriteria: "percent" | "level_sum" | "level_count" = config?.bestAttemptCriteria || "percent";
    const includeSheets = config?.includeSheets || {
      summary: true, attempts: true, answers: true, questionStats: true, levelStats: true,
    };

    if (!testIds.length) {
      return res.status(400).json({ error: "testIds is required" });
    }

    const tests = await storage.getTests();
    const selectedTests = tests.filter(t => testIds.includes(t.id));
    const testTitleMap = new Map(selectedTests.map(t => [t.id, t.title]));
    const testModeMap = new Map(selectedTests.map(t => [t.id, t.mode || "standard"]));

    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    const allAttempts = await storage.getAllAttempts();

    // --- filter attempts by testIds/userIds/dates ---
    let attempts = allAttempts.filter(a => testIds.includes(a.testId));

    // Фильтрация по группам
    const groupIds: string[] = Array.isArray(config?.groupIds) ? config.groupIds : [];
    let effectiveUserIds = [...userIds];
    
    if (groupIds.length > 0) {
      // Получаем пользователей из выбранных групп
      const groupUserIds = new Set<string>();
      for (const groupId of groupIds) {
        const groupUsers = await storage.getGroupUsers(groupId);
        groupUsers.forEach(u => groupUserIds.add(u.id));
      }
      
      if (userIds.length > 0) {
        // Если выбраны и группы и пользователи — пересечение
        effectiveUserIds = userIds.filter(id => groupUserIds.has(id));
      } else {
        // Если только группы — все пользователи из групп
        effectiveUserIds = Array.from(groupUserIds);
      }
    }

    if (effectiveUserIds.length > 0) {
      const set = new Set(effectiveUserIds);
      attempts = attempts.filter(a => set.has(a.userId));
    }

    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

    if (from || to) {
      attempts = attempts.filter(a => {
        const dt = a.finishedAt ? new Date(a.finishedAt) : (a.startedAt ? new Date(a.startedAt) : null);
        if (!dt) return false;
        if (from && dt < from) return false;
        if (to && dt > to) return false;
        return true;
      });
    }

    // завершённые
    let completed = attempts.filter(a => a.resultJson !== null);

    // --- bestAttemptOnly ---
    if (bestAttemptOnly) {
      const best = new Map<string, any>(); // key = testId:userId

      const scoreKey = (a: any) => {
        const mode = testModeMap.get(a.testId) || "standard";
        const r = a.resultJson as any;

        if (mode !== "adaptive") {
          return { primary: r?.overallPercent ?? 0, secondary: 0 };
        }

        const trs = r?.topicResults || [];
        const levelSum = trs.reduce((s: number, tr: any) => s + (typeof tr.achievedLevelIndex === "number" ? tr.achievedLevelIndex : -1), 0);
        const levelCount = trs.filter((tr: any) => tr.achievedLevelIndex !== null && tr.achievedLevelIndex !== undefined).length;
        const percent = r?.overallPercent ?? 0;

        if (bestAttemptCriteria === "level_sum") return { primary: levelSum, secondary: percent };
        if (bestAttemptCriteria === "level_count") return { primary: levelCount, secondary: percent };
        return { primary: percent, secondary: levelSum };
      };

      for (const a of completed) {
        const k = `${a.testId}:${a.userId}`;
        const prev = best.get(k);
        if (!prev) { best.set(k, a); continue; }

        const A = scoreKey(a);
        const P = scoreKey(prev);

        const aTime = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
        const pTime = prev.finishedAt ? new Date(prev.finishedAt).getTime() : 0;

        if (A.primary > P.primary) best.set(k, a);
        else if (A.primary === P.primary && A.secondary > P.secondary) best.set(k, a);
        else if (A.primary === P.primary && A.secondary === P.secondary && aTime > pTime) best.set(k, a);
      }

      completed = Array.from(best.values());
    }

    // --- users map ---
    const uniqUserIds = Array.from(new Set(completed.map(a => a.userId)));
    const users = await Promise.all(uniqUserIds.map(id => storage.getUser(id)));
    const userMap = new Map<string, string>();
    for (const u of users) if (u) userMap.set(u.id, u.name || u.email || "Unknown");

    // --- collect questions from variants ---
    const allQuestionIds = new Set<string>();
    for (const attempt of completed) {
      const variant = attempt.variantJson as any;
      if (variant?.sections) {
        for (const s of variant.sections) for (const qId of (s.questionIds || [])) allQuestionIds.add(qId);
      }
      if (variant?.topics) {
        for (const t of variant.topics) for (const lvl of (t.levelsState || [])) for (const qId of (lvl.questionIds || [])) allQuestionIds.add(qId);
      }
    }

    const questions = await storage.getQuestionsByIds(Array.from(allQuestionIds));
    const questionMap = new Map(questions.map(q => [q.id, q]));

    const wb = XLSX.utils.book_new();

    // ===== Sheet: Summary =====
    if (includeSheets.summary) {
      const rows: any[][] = [
        ["Отчёт по аналитике"],
        ["Дата экспорта", new Date().toLocaleString("ru-RU")],
        ["Тестов", selectedTests.length],
        ["Попыток (завершённых)", completed.length],
        ["Пользователей", new Set(completed.map(a => a.userId)).size],
        ["bestAttemptOnly", bestAttemptOnly ? "Да" : "Нет"],
        ["Период", `${dateFrom || "—"} .. ${dateTo || "—"}`],
        [],
        ["Тест", "Попыток", "Средний %", "Процент сдачи"],
      ];

      for (const t of selectedTests) {
        const ta = completed.filter(a => a.testId === t.id);
        const avg = ta.length ? (ta.reduce((s, a) => s + ((a.resultJson as any)?.overallPercent ?? 0), 0) / ta.length) : 0;
        const passed = ta.filter(a => ((a.resultJson as any)?.overallPassed)).length;
        rows.push([t.title, ta.length, `${avg.toFixed(1)}%`, ta.length ? `${(passed / ta.length * 100).toFixed(1)}%` : "0%"]);
      }

      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Сводка");
    }

    // ===== Sheet: Attempts =====
    if (includeSheets.attempts) {
      const rows: any[][] = [[
        "Тест", "ID попытки", "Пользователь", "Дата начала", "Дата завершения",
        "Время (сек)", "Результат (%)", "Баллы", "Макс. баллы", "Статус",
      ]];

      for (const a of completed) {
        const r = a.resultJson as any;
        const dur = a.startedAt && a.finishedAt
          ? Math.round((new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000)
          : "";

        rows.push([
          testTitleMap.get(a.testId) || a.testId,
          a.id,
          userMap.get(a.userId) || "Unknown",
          a.startedAt ? new Date(a.startedAt).toLocaleString("ru-RU") : "",
          a.finishedAt ? new Date(a.finishedAt).toLocaleString("ru-RU") : "",
          dur,
          r?.overallPercent?.toFixed(1) ?? "",
          r?.totalEarnedPoints ?? "",
          r?.totalPossiblePoints ?? "",
          r ? (r.overallPassed ? "Сдан" : "Не сдан") : "—",
        ]);
      }

      const sh = XLSX.utils.aoa_to_sheet(rows);
      sh["!cols"] = [{ wch: 24 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, sh, "Попытки");
    }

    // ===== Sheet: Answers =====
    if (includeSheets.answers) {
      const rows: any[][] = [[
        "Тест","ID попытки","Пользователь","Время начала","Вопрос","Тема","Тип","Сложность",
        "Варианты ответа","Правильный ответ","Ответ пользователя","Результат","Баллы",
      ]];

      for (const attempt of completed) {
        const answers = (attempt.answersJson || {}) as Record<string, unknown>;
        const username = userMap.get(attempt.userId) || "Unknown";
        const startStr = attempt.startedAt ? new Date(attempt.startedAt).toLocaleString("ru-RU") : "";

        for (const [qId, userAnswer] of Object.entries(answers)) {
          const q = questionMap.get(qId);
          if (!q) continue;

          const isCorrect = checkAnswer(q, userAnswer) === 1;
          const dataJson = q.dataJson as any;
          const correctJson = q.correctJson as any;

          rows.push([
            testTitleMap.get(attempt.testId) || attempt.testId,
            attempt.id,
            username,
            startStr,
            q.prompt,
            topicMap.get(q.topicId) || "Unknown",
            formatQuestionType(q.type),
            q.difficulty || 50,
            formatAllOptions(q.type, dataJson),
            formatCorrectAnswerText(q.type, dataJson, correctJson),
            formatUserAnswerText(q.type, dataJson, userAnswer),
            isCorrect ? "Верно" : "Неверно",
            isCorrect ? (q.points || 1) : 0,
          ]);
        }
      }

      const sh = XLSX.utils.aoa_to_sheet(rows);
      sh["!cols"] = [{ wch: 24 }, { wch: 36 }, { wch: 15 }, { wch: 18 }, { wch: 50 }, { wch: 20 }, { wch: 15 }, { wch: 10 }, { wch: 50 }, { wch: 30 }, { wch: 30 }, { wch: 10 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, sh, "Ответы");
    }

    // ===== Sheet: Question stats =====
    if (includeSheets.questionStats) {
      const stat = new Map<string, { total: number; correct: number; testId: string }>();

      for (const attempt of completed) {
        const answers = (attempt.answersJson || {}) as Record<string, unknown>;
        for (const [qId, ans] of Object.entries(answers)) {
          const q = questionMap.get(qId);
          if (!q) continue;

          const key = `${attempt.testId}:${qId}`;
          const s = stat.get(key) || { total: 0, correct: 0, testId: attempt.testId };
          s.total++;
          if (checkAnswer(q, ans) === 1) s.correct++;
          stat.set(key, s);
        }
      }

      const rows: any[][] = [[ "Тест","Вопрос","Тема","Тип","Сложность","Всего","Правильных","% правильных" ]];
      for (const [key, s] of stat.entries()) {
        const qId = key.split(":")[1];
        const q = questionMap.get(qId);
        if (!q) continue;

        rows.push([
          testTitleMap.get(s.testId) || s.testId,
          q.prompt,
          topicMap.get(q.topicId) || "Unknown",
          formatQuestionType(q.type),
          q.difficulty || 50,
          s.total,
          s.correct,
          s.total ? `${((s.correct / s.total) * 100).toFixed(1)}%` : "0%",
        ]);
      }

      const sh = XLSX.utils.aoa_to_sheet(rows);
      sh["!cols"] = [{ wch: 24 }, { wch: 50 }, { wch: 20 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, sh, "Статистика вопросов");
    }

    // levelStats (пока пропускаем, если не нужно — чтобы быстро заработало)
    // if (includeSheets.levelStats) { ... }

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `report_${new Date().toISOString().split("T")[0]}.xlsx`;
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);

  } catch (e) {
    console.error("POST /api/export/excel error:", e);
    res.status(500).json({ error: "Failed to export Excel" });
  }
});

// ============================================
// POST /api/export/excel-lms - Экспорт LMS данных в Excel
// ДОБАВЬ в routes.ts ПОСЛЕ строки 3674 (после закрывающей скобки /api/export/excel)
// ============================================

app.post("/api/export/excel-lms", requireAuthor, async (req: Request, res: Response) => {
  try {
    const config = req.body as any;

    const testIds: string[] = Array.isArray(config?.testIds) ? config.testIds : [];
    const dateFrom: string = config?.dateFrom || "";
    const dateTo: string = config?.dateTo || "";
    const bestAttemptOnly: boolean = !!config?.bestAttemptOnly;
    const includeSheets = config?.includeSheets || {
      summary: true, attempts: true, answers: true, questionStats: true, levelStats: true,
    };

    if (!testIds.length) {
      return res.status(400).json({ error: "testIds is required" });
    }

    // Загружаем данные
    const tests = await storage.getTests();
    const selectedTests = tests.filter(t => testIds.includes(t.id));
    const testTitleMap = new Map(selectedTests.map(t => [t.id, t.title]));
    const testModeMap = new Map(selectedTests.map(t => [t.id, t.mode || "standard"]));

    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    // Загружаем SCORM пакеты и попытки
    const packages = await storage.getScormPackages();
    const packageMap = new Map(packages.map(p => [p.id, p]));
    
    // Фильтруем пакеты по выбранным тестам
    const relevantPackages = packages.filter(p => p.testId && testIds.includes(p.testId));
    const relevantPackageIds = new Set(relevantPackages.map(p => p.id));

    const allAttempts = await storage.getAllScormAttempts();
    
    // Фильтруем попытки
    let attempts = allAttempts.filter(a => relevantPackageIds.has(a.packageId));

    // Фильтр по датам
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

    if (from || to) {
      attempts = attempts.filter(a => {
        const dt = a.finishedAt ? new Date(a.finishedAt) : (a.startedAt ? new Date(a.startedAt) : null);
        if (!dt) return false;
        if (from && dt < from) return false;
        if (to && dt > to) return false;
        return true;
      });
    }

    // Только завершённые
    let completed = attempts.filter(a => a.finishedAt !== null);

    // Фильтрация по LMS пользователям
    const userIds: string[] = Array.isArray(config?.userIds) ? config.userIds : [];
    if (userIds.length > 0) {
      const userSet = new Set(userIds);
      completed = completed.filter(a => {
        const odataUserId = a.lmsUserId || a.sessionId;
        return userSet.has(odataUserId);
      });
    }

    // Best attempt only
    if (bestAttemptOnly) {
      const best = new Map<string, any>();
      
      for (const a of completed) {
        const pkg = packageMap.get(a.packageId);
        if (!pkg) continue;
        
        const userId = a.lmsUserId || a.sessionId;
        const k = `${pkg.testId}:${userId}`;
        const prev = best.get(k);
        
        if (!prev) { 
          best.set(k, a); 
          continue; 
        }

        const aPercent = a.resultPercent || 0;
        const pPercent = prev.resultPercent || 0;
        const aTime = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
        const pTime = prev.finishedAt ? new Date(prev.finishedAt).getTime() : 0;

        if (aPercent > pPercent) best.set(k, a);
        else if (aPercent === pPercent && aTime > pTime) best.set(k, a);
      }

      completed = Array.from(best.values());
    }

    // Загружаем ответы для всех попыток
    const attemptAnswers = new Map<string, any[]>();
    for (const attempt of completed) {
      const answers = await storage.getScormAnswersByAttempt(attempt.id);
      attemptAnswers.set(attempt.id, answers);
    }

    // Загружаем вопросы
    const allQuestionIds = new Set<string>();
    for (const answers of attemptAnswers.values()) {
      for (const ans of answers) {
        if (ans.questionId) allQuestionIds.add(ans.questionId);
      }
    }
    const questions = await storage.getQuestionsByIds(Array.from(allQuestionIds));
    const questionMap = new Map(questions.map(q => [q.id, q]));

    const wb = XLSX.utils.book_new();

    // ===== Sheet: Summary =====
    if (includeSheets.summary) {
      const rows: any[][] = [
        ["Отчёт по LMS аналитике"],
        ["Дата экспорта", new Date().toLocaleString("ru-RU")],
        ["Источник", "LMS (SCORM)"],
        ["Тестов", selectedTests.length],
        ["Попыток (завершённых)", completed.length],
        ["Уникальных пользователей", new Set(completed.map(a => a.lmsUserId || a.sessionId)).size],
        ["bestAttemptOnly", bestAttemptOnly ? "Да" : "Нет"],
        ["Период", `${dateFrom || "—"} .. ${dateTo || "—"}`],
        [],
        ["Тест", "Попыток", "Средний %", "Процент сдачи"],
      ];

      for (const t of selectedTests) {
        const relevantPkgIds = relevantPackages.filter(p => p.testId === t.id).map(p => p.id);
        const ta = completed.filter(a => relevantPkgIds.includes(a.packageId));
        const avg = ta.length ? (ta.reduce((s, a) => s + (a.resultPercent || 0), 0) / ta.length) : 0;
        const passed = ta.filter(a => a.resultPassed).length;
        rows.push([
          t.title, 
          ta.length, 
          `${avg.toFixed(1)}%`, 
          ta.length ? `${(passed / ta.length * 100).toFixed(1)}%` : "0%"
        ]);
      }

      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Сводка");
    }

    // ===== Sheet: Attempts =====
    if (includeSheets.attempts) {
      const rows: any[][] = [[
        "Тест", "ID попытки", "LMS User ID", "ФИО", "Email", "Организация",
        "Дата начала", "Дата завершения", "Время (сек)", 
        "Результат (%)", "Баллы", "Макс. баллы", "Статус",
      ]];

      for (const a of completed) {
        const pkg = packageMap.get(a.packageId);
        const dur = a.startedAt && a.finishedAt
          ? Math.round((new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000)
          : "";

        rows.push([
          pkg?.testTitle || "—",
          a.id,
          a.lmsUserId || "—",
          a.lmsUserName || "—",
          a.lmsUserEmail || "—",
          a.lmsUserOrg || "—",
          a.startedAt ? new Date(a.startedAt).toLocaleString("ru-RU") : "",
          a.finishedAt ? new Date(a.finishedAt).toLocaleString("ru-RU") : "",
          dur,
          a.resultPercent?.toFixed(1) ?? "",
          a.totalPoints ?? "",
          a.maxPoints ?? "",
          a.resultPassed ? "Сдан" : "Не сдан",
        ]);
      }

      const sh = XLSX.utils.aoa_to_sheet(rows);
      sh["!cols"] = [
        { wch: 24 }, { wch: 36 }, { wch: 20 }, { wch: 25 }, { wch: 25 }, { wch: 20 },
        { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }
      ];
      XLSX.utils.book_append_sheet(wb, sh, "Попытки");
    }

    // ===== Sheet: Answers =====
    if (includeSheets.answers) {
      const rows: any[][] = [[
        "Тест", "ID попытки", "ФИО", "Email", "Время начала",
        "Вопрос", "Тема", "Тип", "Сложность",
        "Варианты ответа", "Правильный ответ", "Ответ пользователя", 
        "Результат", "Баллы", "Уровень (адапт.)",
      ]];

      for (const attempt of completed) {
        const pkg = packageMap.get(attempt.packageId);
        const answers = attemptAnswers.get(attempt.id) || [];
        const startStr = attempt.startedAt ? new Date(attempt.startedAt).toLocaleString("ru-RU") : "";

        for (const ans of answers) {
          const q = questionMap.get(ans.questionId);
          const dataJson = q?.dataJson as any;

          rows.push([
            pkg?.testTitle || "—",
            attempt.id,
            attempt.lmsUserName || "—",
            attempt.lmsUserEmail || "—",
            startStr,
            ans.questionPrompt || q?.prompt || "—",
            ans.topicName || topicMap.get(ans.topicId || "") || "—",
            formatQuestionType(ans.questionType || q?.type || "unknown"),
            ans.difficulty || q?.difficulty || 50,
            formatAllOptions(ans.questionType || q?.type, dataJson),
            formatCorrectAnswerText(ans.questionType || q?.type, dataJson, ans.correctAnswerJson || q?.correctJson),
            formatUserAnswerText(ans.questionType || q?.type, dataJson, ans.userAnswerJson),
            ans.isCorrect ? "Верно" : "Неверно",
            ans.points || 0,
            ans.levelName || "—",
          ]);
        }
      }

      const sh = XLSX.utils.aoa_to_sheet(rows);
      sh["!cols"] = [
        { wch: 24 }, { wch: 36 }, { wch: 25 }, { wch: 25 }, { wch: 18 },
        { wch: 50 }, { wch: 20 }, { wch: 15 }, { wch: 10 },
        { wch: 50 }, { wch: 30 }, { wch: 30 },
        { wch: 10 }, { wch: 8 }, { wch: 15 },
      ];
      XLSX.utils.book_append_sheet(wb, sh, "Ответы");
    }

    // ===== Sheet: Question stats =====
    if (includeSheets.questionStats) {
      const stat = new Map<string, { prompt: string; testId: string; total: number; correct: number; topicName: string; type: string; difficulty: number }>();

      for (const attempt of completed) {
        const pkg = packageMap.get(attempt.packageId);
        if (!pkg) continue;
        
        const answers = attemptAnswers.get(attempt.id) || [];
        for (const ans of answers) {
          const q = questionMap.get(ans.questionId);
          const testId = pkg.testId || "";
          const key = `${testId}:${ans.questionId}`;
          const s = stat.get(key) || {
            prompt: ans.questionPrompt || q?.prompt || "—",
            testId,
            total: 0, 
            correct: 0,
            topicName: ans.topicName || topicMap.get(ans.topicId || q?.topicId || "") || "—",
            type: ans.questionType || q?.type || "—",
            difficulty: ans.difficulty || q?.difficulty || 50,
          };
          s.total++;
          if (ans.isCorrect) s.correct++;
          stat.set(key, s);
        }
      }

      const rows: any[][] = [["Тест", "Вопрос", "Тема", "Тип", "Сложность", "Всего", "Правильных", "% правильных"]];
      for (const [_, s] of stat.entries()) {
        rows.push([
          testTitleMap.get(s.testId) || s.testId,
          s.prompt,
          s.topicName,
          formatQuestionType(s.type),
          s.difficulty,
          s.total,
          s.correct,
          s.total ? `${((s.correct / s.total) * 100).toFixed(1)}%` : "0%",
        ]);
      }

      const sh = XLSX.utils.aoa_to_sheet(rows);
      sh["!cols"] = [{ wch: 24 }, { wch: 50 }, { wch: 20 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, sh, "Статистика вопросов");
    }

    // ===== Sheet: Level stats (для адаптивных) =====
    if (includeSheets.levelStats) {
      const levelStat = new Map<string, { testTitle: string; topicName: string; levelName: string; total: number; correct: number }>();

      for (const attempt of completed) {
        const pkg = packageMap.get(attempt.packageId);
        if (!pkg || pkg.testMode !== "adaptive") continue;
        
        const answers = attemptAnswers.get(attempt.id) || [];
        for (const ans of answers) {
          if (!ans.levelName) continue;
          
          const key = `${pkg.testId}:${ans.topicId}:${ans.levelIndex}`;
          const s = levelStat.get(key) || {
            testTitle: pkg.testTitle,
            topicName: ans.topicName || "—",
            levelName: ans.levelName,
            total: 0,
            correct: 0,
          };
          s.total++;
          if (ans.isCorrect) s.correct++;
          levelStat.set(key, s);
        }
      }

      if (levelStat.size > 0) {
        const rows: any[][] = [["Тест", "Тема", "Уровень", "Всего ответов", "Правильных", "% правильных"]];
        for (const [_, s] of levelStat.entries()) {
          rows.push([
            s.testTitle,
            s.topicName,
            s.levelName,
            s.total,
            s.correct,
            s.total ? `${((s.correct / s.total) * 100).toFixed(1)}%` : "0%",
          ]);
        }

        const sh = XLSX.utils.aoa_to_sheet(rows);
        sh["!cols"] = [{ wch: 24 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, sh, "Статистика уровней");
      }
    }

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `report_lms_${new Date().toISOString().split("T")[0]}.xlsx`;
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);

  } catch (e) {
    console.error("POST /api/export/excel-lms error:", e);
    res.status(500).json({ error: "Failed to export LMS Excel" });
  }
});

// ============================================
// SCORM Telemetry API
// Добавить в routes.ts ПЕРЕД return httpServer;
// ============================================

// Rate limiting state (in-memory)
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

// POST /api/scorm-telemetry/start
app.post("/api/scorm-telemetry/start", async (req: Request, res: Response) => {
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
    
    // НОВОЕ: attemptNumber из клиента или следующий номер
    const attemptNumber = data?.attemptNumber || await storage.getNextAttemptNumber(packageId, sessionId);
    
    // Ищем конкретную попытку по номеру
    let attempt = await storage.getScormAttemptBySession(packageId, sessionId, attemptNumber);
    
    if (!attempt) {
      // Создаём новую попытку
      attempt = await storage.createScormAttempt({
        id: crypto.randomUUID(),
        packageId: pkg.id,
        sessionId,
        attemptNumber, // <-- НОВОЕ ПОЛЕ
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


// POST /api/scorm-telemetry/answer
app.post("/api/scorm-telemetry/answer", async (req: Request, res: Response) => {
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
    
    // НОВОЕ: attemptNumber для правильной привязки ответа
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
      // Варианты ответов для отображения в аналитике
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


// POST /api/scorm-telemetry/finish
app.post("/api/scorm-telemetry/finish", async (req: Request, res: Response) => {
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
    
    // НОВОЕ: attemptNumber для завершения правильной попытки
    const attemptNumber = data?.attemptNumber;
    const attempt = attemptNumber
      ? await storage.getScormAttemptBySession(packageId, sessionId, attemptNumber)
      : await storage.getScormAttemptBySession(packageId, sessionId);
    
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }
    
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

// GET /api/scorm-packages - Список пакетов автора
app.get("/api/scorm-packages", requireAuthor, async (req: Request, res: Response) => {
  try {
    const packages = await storage.getScormPackages();
    
    // Добавляем статистику к каждому пакету
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
app.get("/api/scorm-packages/:id", requireAuthor, async (req: Request, res: Response) => {
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
app.post("/api/scorm-packages/:id/regenerate-key", requireAuthor, async (req: Request, res: Response) => {
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
app.post("/api/scorm-packages/:id/deactivate", requireAuthor, async (req: Request, res: Response) => {
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
app.post("/api/scorm-packages/:id/activate", requireAuthor, async (req: Request, res: Response) => {
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

// ============================================
// Обновлённый API для комбинированной аналитики
// ЗАМЕНИ предыдущий /api/analytics/combined-full
// ============================================

// GET /api/analytics/combined-full - Полная комбинированная аналитика
app.get("/api/analytics/combined-full", requireAuthor, async (req: Request, res: Response) => {
  try {
    const source = (req.query.source as string) || "all";
    const testIdFilter = req.query.testId as string | undefined;

    let webAttempts: any[] = [];
    let lmsAttempts: any[] = [];
    const allTests = await storage.getTests();
    const testMap = new Map(allTests.map(t => [t.id, t]));
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    // ===== WEB ATTEMPTS =====
    if (source === "all" || source === "web") {
      const attempts = await storage.getAllAttempts();
      const users = await Promise.all(
        [...new Set(attempts.map(a => a.userId))].map(id => storage.getUser(id))
      );
      const userMap = new Map(users.filter(Boolean).map(u => [u!.id, u!]));

      webAttempts = attempts
        .filter(a => !testIdFilter || a.testId === testIdFilter)
        .filter(a => a.finishedAt)
        .map(a => {
          const user = userMap.get(a.userId);
          const test = testMap.get(a.testId);
          const result = a.resultJson as any;
          const duration = a.startedAt && a.finishedAt
            ? (new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000
            : null;
          return {
            id: a.id,
            testId: a.testId,
            testTitle: test?.title || "Удалённый тест",
            testMode: test?.mode || "standard",
            userId: a.userId,
            username: user?.name || user?.email || "Unknown",
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            duration,
            resultPercent: result?.overallPercent || 0,
            resultPassed: result?.overallPassed || false,
            totalPoints: result?.earnedPoints || result?.totalEarnedPoints || 0,
            maxPoints: result?.possiblePoints || result?.totalPossiblePoints || 0,
            source: "web" as const,
          };
        });
    }

    // ===== LMS ATTEMPTS =====
    if (source === "all" || source === "lms") {
      const attempts = await storage.getAllScormAttempts();
      const packages = await storage.getScormPackages();
      const packageMap = new Map(packages.map(p => [p.id, p]));

      lmsAttempts = attempts
        .filter(a => {
          if (!testIdFilter) return true;
          const pkg = packageMap.get(a.packageId);
          return pkg?.testId === testIdFilter;
        })
        .filter(a => a.finishedAt)
        .map(a => {
          const pkg = packageMap.get(a.packageId);
          const duration = a.startedAt && a.finishedAt
            ? (new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000
            : null;
          return {
            id: a.id,
            testId: pkg?.testId || null,
            testTitle: pkg?.testTitle || "Удалённый тест",
            testMode: pkg?.testMode || "standard",
            lmsUserId: a.lmsUserId,
            lmsUserName: a.lmsUserName,
            lmsUserEmail: a.lmsUserEmail,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            duration,
            resultPercent: a.resultPercent || 0,
            resultPassed: a.resultPassed || false,
            totalPoints: a.totalPoints || 0,
            maxPoints: a.maxPoints || 0,
            source: "lms" as const,
          };
        });
    }

    // ===== COMBINE & SORT =====
    const combined = [...webAttempts, ...lmsAttempts].sort(
      (a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime()
    );

    // ===== SUMMARY =====
    const totalAttempts = combined.length;
    const passedAttempts = combined.filter(a => a.resultPassed).length;
    const avgPercent = totalAttempts > 0
      ? combined.reduce((sum, a) => sum + (a.resultPercent || 0), 0) / totalAttempts
      : 0;

    const uniqueWebUsers = new Set(webAttempts.map(a => a.userId)).size;
    const uniqueLmsUsers = new Set(lmsAttempts.map(a => a.lmsUserId).filter(Boolean)).size;

    // ===== TEST STATS =====
    const testStatsMap = new Map<string, {
      testId: string;
      testTitle: string;
      totalAttempts: number;
      webAttempts: number;
      lmsAttempts: number;
      passedCount: number;
      totalPercent: number;
    }>();

    combined.forEach(a => {
      if (!a.testId) return;
      const existing = testStatsMap.get(a.testId) || {
        testId: a.testId,
        testTitle: a.testTitle,
        totalAttempts: 0,
        webAttempts: 0,
        lmsAttempts: 0,
        passedCount: 0,
        totalPercent: 0,
      };
      existing.totalAttempts++;
      if (a.source === "web") existing.webAttempts++;
      else existing.lmsAttempts++;
      if (a.resultPassed) existing.passedCount++;
      existing.totalPercent += a.resultPercent || 0;
      testStatsMap.set(a.testId, existing);
    });

    const testStats = Array.from(testStatsMap.values()).map(ts => ({
      testId: ts.testId,
      testTitle: ts.testTitle,
      totalAttempts: ts.totalAttempts,
      webAttempts: ts.webAttempts,
      lmsAttempts: ts.lmsAttempts,
      passRate: ts.totalAttempts > 0 ? (ts.passedCount / ts.totalAttempts) * 100 : 0,
      avgPercent: ts.totalAttempts > 0 ? ts.totalPercent / ts.totalAttempts : 0,
    }));

    // ===== TOPIC STATS (из ответов) =====
    const topicStatsMap = new Map<string, {
      topicId: string;
      topicName: string;
      totalAnswers: number;
      correctAnswers: number;
      totalPercent: number;
      failureCount: number;
    }>();

    // Собираем статистику из LMS ответов
    for (const attempt of lmsAttempts) {
      const answers = await storage.getScormAnswersByAttempt(attempt.id);
      for (const ans of answers) {
        if (!ans.topicId) continue;
        const existing = topicStatsMap.get(ans.topicId) || {
          topicId: ans.topicId,
          topicName: ans.topicName || topicMap.get(ans.topicId) || "Unknown",
          totalAnswers: 0,
          correctAnswers: 0,
          totalPercent: 0,
          failureCount: 0,
        };
        existing.totalAnswers++;
        if (ans.isCorrect) existing.correctAnswers++;
        else existing.failureCount++;
        topicStatsMap.set(ans.topicId, existing);
      }
    }

    // Собираем статистику из Web ответов
    for (const attempt of webAttempts) {
      const fullAttempt = await storage.getAttempt(attempt.id);
      if (!fullAttempt?.answersJson) continue;
      const answers = fullAttempt.answersJson as Record<string, any>;
      const variant = fullAttempt.variantJson as any;
      
      // Получаем вопросы
      const questionIds = Object.keys(answers);
      const questions = await storage.getQuestionsByIds(questionIds);
      
      for (const q of questions) {
        const existing = topicStatsMap.get(q.topicId) || {
          topicId: q.topicId,
          topicName: topicMap.get(q.topicId) || "Unknown",
          totalAnswers: 0,
          correctAnswers: 0,
          totalPercent: 0,
          failureCount: 0,
        };
        existing.totalAnswers++;
        const isCorrect = checkAnswer(q, answers[q.id]) === 1;
        if (isCorrect) existing.correctAnswers++;
        else existing.failureCount++;
        topicStatsMap.set(q.topicId, existing);
      }
    }

    const topicStats = Array.from(topicStatsMap.values()).map(ts => ({
      ...ts,
      avgPercent: ts.totalAnswers > 0 ? (ts.correctAnswers / ts.totalAnswers) * 100 : 0,
    }));

    // ===== TRENDS (30 days) =====
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trendsMap = new Map<string, {
      date: string;
      attempts: number;
      webAttempts: number;
      lmsAttempts: number;
      passedCount: number;
      totalPercent: number;
    }>();

    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      trendsMap.set(dateStr, {
        date: dateStr,
        attempts: 0,
        webAttempts: 0,
        lmsAttempts: 0,
        passedCount: 0,
        totalPercent: 0,
      });
    }

    combined
      .filter(a => a.finishedAt && new Date(a.finishedAt) >= thirtyDaysAgo)
      .forEach(a => {
        const dateStr = new Date(a.finishedAt!).toISOString().split("T")[0];
        const existing = trendsMap.get(dateStr);
        if (existing) {
          existing.attempts++;
          if (a.source === "web") existing.webAttempts++;
          else existing.lmsAttempts++;
          if (a.resultPassed) existing.passedCount++;
          existing.totalPercent += a.resultPercent || 0;
        }
      });

    const trends = Array.from(trendsMap.values())
      .map(t => ({
        date: t.date,
        attempts: t.attempts,
        webAttempts: t.webAttempts,
        lmsAttempts: t.lmsAttempts,
        avgPercent: t.attempts > 0 ? t.totalPercent / t.attempts : 0,
        passRate: t.attempts > 0 ? (t.passedCount / t.attempts) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      summary: {
        totalAttempts,
        passedAttempts,
        passRate: totalAttempts > 0 ? (passedAttempts / totalAttempts) * 100 : 0,
        avgPercent,
        webAttempts: webAttempts.length,
        lmsAttempts: lmsAttempts.length,
        uniqueWebUsers,
        uniqueLmsUsers,
      },
      attempts: combined,
      testStats,
      topicStats,
      trends,
    });
  } catch (error) {
    console.error("Combined analytics error:", error);
    res.status(500).json({ error: "Failed to get analytics" });
  }
});

  return httpServer;
}

// Returns a score between 0 and 1 (all-or-nothing scoring)
function checkAnswer(question: any, answer: any): number {
  if (answer === undefined || answer === null) return 0;

  const correct = question.correctJson as any;

  if (question.type === "single") {
    // Single choice: all or nothing
    return answer === correct.correctIndex ? 1 : 0;
  }

  if (question.type === "multiple") {
    // Multiple choice: all or nothing
    // Must select ALL correct options and NO incorrect options
    const correctIndices = new Set(correct.correctIndices as number[]);
    const answerList = (answer || []) as number[];
    const answerSet = new Set(answerList);
    
    // Check if sets are equal
    if (correctIndices.size !== answerSet.size) return 0;
    
    for (const idx of correctIndices) {
      if (!answerSet.has(idx)) return 0;
    }
    
    return 1;
  }

  if (question.type === "matching") {
    // Matching: all or nothing - all pairs must be correct
    const pairs = answer || {};
    const correctPairs = correct.pairs || [];
    
    if (correctPairs.length === 0) return 0;
    
    for (const p of correctPairs) {
      if (pairs[p.left] !== p.right) {
        return 0;
      }
    }
    
    return 1;
  }

  if (question.type === "ranking") {
    // Ranking: all or nothing - order must be exactly correct
    const order = answer || [];
    const correctOrder = correct.correctOrder;
    
    if (correctOrder.length === 0) return 0;
    if (order.length !== correctOrder.length) return 0;
    
    for (let i = 0; i < correctOrder.length; i++) {
      if (order[i] !== correctOrder[i]) {
        return 0;
      }
    }
    
    return 1;
  }

  return 0;
}