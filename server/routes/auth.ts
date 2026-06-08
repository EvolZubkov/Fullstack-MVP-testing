import { Router } from "express";
import crypto from "node:crypto";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { getEffectiveRoles, getUserCapabilities } from "../services/access";
import { sendPasswordResetEmail } from "../email";
import { maskEmail } from "../utils/mask-email";
import { logger, audit, requestContext } from "../logger";

const router = Router();

// Simple in-memory rate limiter for login: max 10 attempts per IP per 15 min
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (entry.count >= LOGIN_LIMIT) return false;
  entry.count++;
  return true;
}

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkLoginRateLimit(ip)) {
      logger.warn(`Login rate limit exceeded for IP: ${ip}`, "auth");
      return res.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });
    }

    const user = await storage.validatePassword(email, password);
    if (!user) {
      logger.warn(`Failed login attempt: ${email} from ${ip}`, "auth");
      audit.login(email, false, ip);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.status === "inactive") {
      logger.warn(`Login blocked - account inactive: ${email} from ${ip}`, "auth");
      return res.status(403).json({ error: "Account is deactivated. Please contact administrator." });
    }

    await storage.updateUserLastLogin(user.id);
    logger.info(`User logged in: ${email} from ${ip}`, "auth");
    audit.login(email, true, ip);

    // Подтягиваем userId в контекст запроса сразу после логина
    const ctx = requestContext.getStore();
    if (ctx) ctx.userId = user.id;

    req.session.userId = user.id;

    // Явно сохраняем сессию перед ответом — гарантирует что сессия в store
    // до того как браузер отправит следующий запрос с cookie
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          logger.error("Session save error: " + err.message, "auth");
          reject(err);
        } else {
          resolve();
        }
      });
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: await getEffectiveRoles(user),
        permissions: [...(await getUserCapabilities(user))],
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        gdprConsent: user.gdprConsent,
      },
    });
  } catch (error) {
    logger.error("Login error: " + (error as Error).message, "auth")
    res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  const userId = req.session.userId;
  if (userId) {
    const user = await storage.getUser(userId).catch(() => null);
    logger.info(`User logged out: ${user?.email ?? userId}`, "auth");
  }
  audit.logout();
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// POST /api/auth/change-password
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const user = await storage.getUser(req.session.userId!);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isValid = await storage.validatePassword(user.email, currentPassword);
    if (!isValid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    await storage.updateUserPassword(user.id, newPassword);
    audit.passwordChange(user.id);
    res.json({ success: true });
  } catch (error) {
    logger.error("Change password error: " + (error as Error).message, "auth");
    res.status(500).json({ error: "Failed to change password" });
  }
});

// GET /api/auth/me
router.get("/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "User not found" });
    }

    if (user.status === "inactive") {
      req.session.destroy(() => {});
      return res.status(403).json({ error: "Account is deactivated" });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: await getEffectiveRoles(user),
        permissions: [...(await getUserCapabilities(user))],
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        gdprConsent: user.gdprConsent,
      },
    });
  } catch (error) {
    logger.error("Get me error: " + (error as Error).message, "auth");
    res.status(500).json({ error: "Failed to get user" });
  }
});

// POST /api/auth/check-email
router.post("/check-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const user = await storage.getUserByEmail(email);
    res.json({ exists: !!user });
  } catch (error) {
    logger.error("Check email error: " + (error as Error).message, "auth")
    res.status(500).json({ error: "Failed to check email" });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const user = await storage.getUserByEmail(email);

    // Всегда возвращаем успех (чтобы не раскрывать существование email)
    if (!user) {
      return res.json({
        success: true,
        message: "If this email exists, a reset link has been sent",
      });
    }

    // Проверяем лимит запросов (3 в час)
    const recentTokens = await storage.getRecentTokensCount(user.id, 1);
    if (recentTokens >= 3) {
      return res.status(429).json({
        error: "Too many reset requests. Please try again later.",
      });
    }

    // Генерируем токен
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Сохраняем токен
    const requestIp = req.ip || req.socket.remoteAddress || "unknown";
    await storage.createPasswordResetToken(user.id, tokenHash, requestIp);

    // Формируем ссылку
    const baseUrl = (process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5001}`).replace(/\/$/, '');
    const resetLink = `${baseUrl}/reset-password?token=${token}`;

    // Отправляем email
    const emailSent = await sendPasswordResetEmail(user.email, resetLink);
    logger.info(`Password reset requested: ${maskEmail(user.email)} from ${requestIp}`, "auth");

    res.json({
      success: true,
      message: "If this email exists, a reset link has been sent",
      hint: maskEmail(user.email),
      ...(process.env.NODE_ENV === "development" && !emailSent && { devLink: resetLink }),
    });
  } catch (error) {
    logger.error("Forgot password error: " + (error as Error).message, "auth");
    res.status(500).json({ error: "Failed to process request" });
  }
});

// GET /api/auth/verify-reset-token
router.get("/verify-reset-token", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Token required" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const resetToken = await storage.getPasswordResetToken(tokenHash);

    if (!resetToken) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    if (resetToken.usedAt) {
      return res.status(400).json({ error: "Token has already been used" });
    }

    if (new Date() > resetToken.expiresAt) {
      return res.status(400).json({ error: "Token has expired" });
    }

    const user = await storage.getUser(resetToken.userId);
    res.json({
      valid: true,
      emailHint: user ? maskEmail(user.email) : null,
    });
  } catch (error) {
    logger.error("Verify reset token error: " + (error as Error).message, "auth");
    res.status(500).json({ error: "Failed to verify token" });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const resetToken = await storage.getPasswordResetToken(tokenHash);

    if (!resetToken) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    if (resetToken.usedAt) {
      return res.status(400).json({ error: "Token has already been used" });
    }

    if (new Date() > resetToken.expiresAt) {
      return res.status(400).json({ error: "Token has expired" });
    }

    // Обновляем пароль
    await storage.updateUserPassword(resetToken.userId, newPassword);

    // Помечаем токен как использованный
    await storage.markTokenAsUsed(resetToken.id);

    // Активируем пользователя если был pending
    const user = await storage.getUser(resetToken.userId);
    if (user && user.status === "pending") {
      await storage.updateUser(resetToken.userId, { status: "active" });
    }

    logger.info(`Password reset completed for user: ${resetToken.userId}`, "auth");
    res.json({ success: true, message: "Password has been reset successfully" });
  } catch (error) {
    logger.error("Reset password error: " + (error as Error).message, "auth");
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// POST /api/auth/complete-first-login
router.post("/complete-first-login", requireAuth, async (req, res) => {
  try {
    const { newPassword, gdprConsent } = req.body;
    const userId = req.session.userId!;

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.mustChangePassword && user.gdprConsent) {
      return res.status(400).json({ error: "First login already completed" });
    }

    // Обновляем пароль если передан
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      await storage.updateUserPassword(userId, newPassword);
    }

    // Обновляем GDPR согласие
    const updates: any = {
      mustChangePassword: false,
    };

    if (gdprConsent) {
      updates.gdprConsent = true;
      updates.gdprConsentAt = new Date();
    }

    // Активируем пользователя если был pending
    if (user.status === "pending") {
      updates.status = "active";
    }

    await storage.updateUser(userId, updates);

    const updatedUser = await storage.getUser(userId);

    res.json({
      success: true,
      user: {
        id: updatedUser!.id,
        email: updatedUser!.email,
        name: updatedUser!.name,
        status: updatedUser!.status,
        mustChangePassword: updatedUser!.mustChangePassword,
        gdprConsent: updatedUser!.gdprConsent,
      },
    });
  } catch (error) {
    logger.error("Complete first login error: " + (error as Error).message, "auth");
    res.status(500).json({ error: "Failed to complete first login" });
  }
});

export default router;