import nodemailer from "nodemailer";
import { logger } from "./logger";

// Конфигурация из переменных окружения
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const APP_NAME = process.env.APP_NAME || "Конструктор SCORM-тестов";

// Создаём транспорт
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    logger.info("SMTP not configured. Email sending disabled.");
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }

  return transporter;
}

export async function sendPasswordResetEmail(
  to: string,
  resetLink: string,
  userName?: string
): Promise<boolean> {
  const transport = getTransporter();
  
  if (!transport) {
    logger.info("===========================================");
    logger.info("PASSWORD RESET LINK (SMTP not configured):");
    logger.info(resetLink);
    logger.info("For user: " + to);
    logger.info("===========================================");
    return false;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; background: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
    .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 10px; border-radius: 4px; margin-top: 20px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${APP_NAME}</h1>
    </div>
    <div class="content">
      <h2>Сброс пароля</h2>
      <p>Здравствуйте${userName ? `, ${userName}` : ""}!</p>
      <p>Вы запросили сброс пароля для вашего аккаунта. Нажмите на кнопку ниже, чтобы установить новый пароль:</p>
      <p style="text-align: center;">
        <a href="${resetLink}" class="button">Сбросить пароль</a>
      </p>
      <p>Или скопируйте эту ссылку в браузер:</p>
      <p style="word-break: break-all; background: #e5e7eb; padding: 10px; border-radius: 4px; font-size: 14px;">
        ${resetLink}
      </p>
      <div class="warning">
        ⚠️ Ссылка действительна в течение 30 минут. Если вы не запрашивали сброс пароля, проигнорируйте это письмо.
      </div>
    </div>
    <div class="footer">
      <p>Это автоматическое сообщение, не отвечайте на него.</p>
      <p>© ${new Date().getFullYear()} ${APP_NAME}</p>
    </div>
  </div>
</body>
</html>
  `;

  const text = `
Сброс пароля - ${APP_NAME}

Здравствуйте${userName ? `, ${userName}` : ""}!

Вы запросили сброс пароля для вашего аккаунта.

Перейдите по ссылке для установки нового пароля:
${resetLink}

Ссылка действительна в течение 30 минут.

Если вы не запрашивали сброс пароля, проигнорируйте это письмо.

---
Это автоматическое сообщение, не отвечайте на него.
© ${new Date().getFullYear()} ${APP_NAME}
  `;

  try {
    await transport.sendMail({
      from: `"${APP_NAME}" <${SMTP_FROM}>`,
      to,
      subject: `Сброс пароля - ${APP_NAME}`,
      text,
      html,
    });
    logger.info(`Password reset email sent to ${to}`);
    return true;
  } catch (error) {
    logger.error("Failed to send password reset email: " + (error as Error).message);
    // Выводим ссылку в консоль как fallback
    logger.info("===========================================");
    logger.info("PASSWORD RESET LINK (email send failed):");
    logger.info(resetLink);
    logger.info("For user: " + to);
    logger.info("===========================================");
    return false;
  }
}

export async function verifySmtpConnection(): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) return false;

  try {
    await transport.verify();
    logger.info("SMTP connection verified successfully");
    return true;
  } catch (error) {
    logger.error("SMTP connection verification failed: " + (error as Error).message);
    return false;
  }
}