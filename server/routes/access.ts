import { Router, Request, Response } from "express";
import { createHash } from "crypto";
import { logger } from "../logger";
import { storage } from "../storage";
import "../middleware/magic-scope";

const router = Router();

// GET /access/:token — вход по magic link без пароля
router.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params;

  // The raw token is in the URL of THIS request: never let it travel onward in a
  // Referer header and never let a cache keep the response.
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");

  if (!token || token.length < 32) {
    return res.status(400).send(renderErrorPage("Недействительная ссылка"));
  }

  try {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const record = await storage.getAssignmentAccessToken(tokenHash);

    if (!record) {
      return res.status(404).send(renderErrorPage("Ссылка не найдена. Возможно, она уже была использована или никогда не существовала."));
    }

    if (record.revokedAt) {
      return res.status(403).send(renderErrorPage("Ссылка была отозвана. Обратитесь к организатору теста."));
    }

    if (record.expiresAt < new Date()) {
      return res.status(403).send(renderErrorPage("Срок действия ссылки истёк. Обратитесь к организатору теста."));
    }

    // The link is access to ONE test, not a login: the session is marked so the
    // scope guard can hold it inside that test. A password login clears the mark.
    req.session.userId = record.userId;
    req.session.magic = { assignmentId: record.assignmentId, testId: record.testId };
    await new Promise<void>((resolve, reject) =>
      req.session.save(err => err ? reject(err) : resolve())
    );

    logger.info(`Magic link login: userId=${record.userId} testId=${record.testId}`);

    // Редиректим на тест
    res.redirect(`/learner/test/${record.testId}`);
  } catch (error) {
    logger.error("Magic link error: " + (error as Error).message);
    res.status(500).send(renderErrorPage("Произошла ошибка. Попробуйте ещё раз или обратитесь к организатору."));
  }
});

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderErrorPage(message: string): string {
  const safe = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ссылка недействительна</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: white; border-radius: 12px; padding: 40px 32px; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 12px; }
    p { font-size: 15px; color: #6b7280; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔗</div>
    <h1>Ссылка недействительна</h1>
    <p>${safe}</p>
  </div>
</body>
</html>`;
}

export default router;
