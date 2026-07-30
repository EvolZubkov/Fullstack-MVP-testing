import nodemailer from "nodemailer";
import { logger } from "./logger";
import { config, appBaseUrl } from "./config";

// SMTP settings are read from `config` (populated by initConfig) inside the
// functions below — not at import time (the DI model). Non-secret settings
// (host/port/secure/from) come from the config file; credentials are secrets.
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const { host, port, secure, auth } = config.email;
  if (!host || !auth.user || !auth.pass) {
    logger.info("SMTP not configured. Email sending disabled.");
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: auth.user, pass: auth.pass },
    });
  }

  return transporter;
}

/** Product name used in subjects/sender, read at send time. */
function appName(): string {
  return config.server.appName;
}

/** Envelope "from" address (falls back to the SMTP user), read at send time. */
function fromAddress(): string {
  return config.email.from || config.email.auth.user;
}

export async function sendPasswordResetEmail(
  to: string,
  resetLink: string,
  userName?: string
): Promise<boolean> {
  const transport = getTransporter();
  const APP_NAME = appName();
  const SMTP_FROM = fromAddress();

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

export async function sendAssignmentEmail(opts: {
  to: string;
  userName?: string;
  testTitle: string;
  testDescription?: string | null;
  dueDate?: Date | null;
  /**
   * The one-time passwordless entry link (`/access/<token>`). Omitted when the
   * recipient holds any role other than `learner` (see
   * `mayReceiveAssignmentLink`, PLAN_MAGIC_LINK_SCOPE.md Этап 3): such an
   * account must never receive a password-free entry link, so the letter falls
   * back to an ordinary link to the login page and says nothing about why the
   * quick link is absent (no mention of roles/permissions — an e-mail gets
   * forwarded, spelling out the protection in it is pointless disclosure).
   */
  magicLink?: string;
}): Promise<boolean> {
  const transport = getTransporter();
  const APP_NAME = appName();
  const SMTP_FROM = fromAddress();

  const dueDateStr = opts.dueDate
    ? opts.dueDate.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
    : null;

  // No magic link was minted for this recipient: fall back to the ordinary
  // login page. `ctaHref` is never a token in this branch.
  const hasMagicLink = Boolean(opts.magicLink);
  const ctaHref = opts.magicLink ?? `${appBaseUrl()}/login`;

  if (!transport) {
    logger.info("===========================================");
    logger.info("ASSIGNMENT MAGIC LINK (SMTP not configured):");
    logger.info(`Test: ${opts.testTitle}`);
    logger.info(`To: ${opts.to}`);
    logger.info(hasMagicLink ? `Link: ${ctaHref}` : `Login: ${ctaHref}`);
    logger.info("===========================================");
    return false;
  }

  // The call-to-action block: unchanged (byte-for-byte) when a magic link was
  // minted; falls back to a plain login CTA otherwise, with no hint of why.
  const ctaHtmlBlock = hasMagicLink
    ? `<p>Для прохождения теста нажмите на кнопку ниже — вход произойдёт автоматически, пароль не требуется:</p>
      <p style="text-align: center;">
        <a href="${ctaHref}" class="button">Пройти тест</a>
      </p>
      <p style="font-size:13px;color:#666;">Или скопируйте ссылку в браузер:</p>
      <p style="word-break: break-all; background: #e5e7eb; padding: 10px; border-radius: 4px; font-size: 13px;">
        ${ctaHref}
      </p>
      <div class="warning">
        ⚠️ Ссылка персональная — не передавайте её другим людям.${dueDateStr ? ` Ссылка действительна до ${dueDateStr}.` : ""}
      </div>`
    : `<p>Для прохождения теста нажмите на кнопку ниже:</p>
      <p style="text-align: center;">
        <a href="${ctaHref}" class="button">Войти и пройти тест</a>
      </p>
      <p style="font-size:13px;color:#666;">После входа тест будет в списке назначенных.</p>`;

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
    .button { display: inline-block; background: #2563eb; color: white; padding: 14px 36px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-size: 16px; font-weight: 600; }
    .meta { background: #e5e7eb; border-radius: 6px; padding: 14px 18px; margin: 16px 0; font-size: 14px; }
    .meta p { margin: 4px 0; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
    .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 10px; border-radius: 4px; margin-top: 20px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${APP_NAME}</h1>
    </div>
    <div class="content">
      <h2>Вам назначен тест</h2>
      <p>Здравствуйте${opts.userName ? `, ${opts.userName}` : ""}!</p>
      <p>Вам назначено прохождение теста:</p>
      <div class="meta">
        <p><strong>📋 Тест:</strong> ${opts.testTitle}</p>
        ${opts.testDescription ? `<p><strong>📝 Описание:</strong> ${opts.testDescription}</p>` : ""}
        ${dueDateStr ? `<p><strong>📅 Срок сдачи:</strong> ${dueDateStr}</p>` : ""}
      </div>
      ${ctaHtmlBlock}
    </div>
    <div class="footer">
      <p>Это автоматическое сообщение, не отвечайте на него.</p>
      <p>© ${new Date().getFullYear()} ${APP_NAME}</p>
    </div>
  </div>
</body>
</html>
  `;

  const ctaTextBlock = hasMagicLink
    ? `Для прохождения перейдите по ссылке (пароль не требуется):
${ctaHref}

Ссылка персональная — не передавайте её другим.`
    : `Для прохождения теста перейдите на страницу входа:
${ctaHref}

После входа тест будет в списке назначенных.`;

  const text = `
Вам назначен тест — ${APP_NAME}

Здравствуйте${opts.userName ? `, ${opts.userName}` : ""}!

Вам назначено прохождение теста: ${opts.testTitle}
${opts.testDescription ? `Описание: ${opts.testDescription}\n` : ""}${dueDateStr ? `Срок сдачи: ${dueDateStr}\n` : ""}
${ctaTextBlock}

---
Это автоматическое сообщение, не отвечайте на него.
© ${new Date().getFullYear()} ${APP_NAME}
  `;

  try {
    await transport.sendMail({
      from: `"${APP_NAME}" <${SMTP_FROM}>`,
      to: opts.to,
      subject: `Вам назначен тест: ${opts.testTitle}`,
      text,
      html,
    });
    logger.info(`Assignment email sent to ${opts.to} for test "${opts.testTitle}"`);
    return true;
  } catch (error) {
    logger.error("Failed to send assignment email: " + (error as Error).message);
    logger.info("===========================================");
    logger.info("ASSIGNMENT MAGIC LINK (email send failed):");
    logger.info(`Test: ${opts.testTitle}`);
    logger.info(`To: ${opts.to}`);
    logger.info(hasMagicLink ? `Link: ${ctaHref}` : `Login: ${ctaHref}`);
    logger.info("===========================================");
    return false;
  }
}

export async function sendInviteEmail(opts: {
  to: string;
  userName?: string;
  inviteLink: string;
  inviterName?: string;
}): Promise<boolean> {
  const transport = getTransporter();
  const APP_NAME = appName();
  const SMTP_FROM = fromAddress();

  if (!transport) {
    logger.info("===========================================");
    logger.info("INVITE LINK (SMTP not configured):");
    logger.info(`To: ${opts.to}`);
    logger.info(`Link: ${opts.inviteLink}`);
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
    .button { display: inline-block; background: #2563eb; color: white; padding: 14px 36px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-size: 16px; font-weight: 600; }
    .steps { background: #eff6ff; border-radius: 6px; padding: 16px 20px; margin: 16px 0; }
    .steps ol { margin: 8px 0; padding-left: 20px; }
    .steps li { margin: 6px 0; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
    .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 10px; border-radius: 4px; margin-top: 20px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${APP_NAME}</h1>
    </div>
    <div class="content">
      <h2>Добро пожаловать!</h2>
      <p>Здравствуйте${opts.userName ? `, ${opts.userName}` : ""}!</p>
      <p>${opts.inviterName ? `<strong>${opts.inviterName}</strong> создал` : "Для вас создан"} аккаунт в системе <strong>${APP_NAME}</strong>.</p>
      <p>Для начала работы нажмите кнопку ниже — вы перейдёте на страницу создания пароля:</p>
      <p style="text-align: center;">
        <a href="${opts.inviteLink}" class="button">Активировать аккаунт</a>
      </p>
      <div class="steps">
        <strong>Что нужно сделать:</strong>
        <ol>
          <li>Нажмите кнопку «Активировать аккаунт»</li>
          <li>Придумайте и введите пароль</li>
          <li>Начните работу с системой</li>
        </ol>
      </div>
      <p style="font-size:13px;color:#666;">Или скопируйте ссылку в браузер:</p>
      <p style="word-break: break-all; background: #e5e7eb; padding: 10px; border-radius: 4px; font-size: 13px;">
        ${opts.inviteLink}
      </p>
      <div class="warning">
        ⚠️ Ссылка действительна в течение 7 дней. Если вы получили это письмо по ошибке — просто проигнорируйте его.
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
Добро пожаловать в ${APP_NAME}!

Здравствуйте${opts.userName ? `, ${opts.userName}` : ""}!

${opts.inviterName ? `${opts.inviterName} создал` : "Для вас создан"} аккаунт в системе ${APP_NAME}.

Для активации аккаунта перейдите по ссылке:
${opts.inviteLink}

Что нужно сделать:
1. Перейдите по ссылке
2. Придумайте и введите пароль
3. Начните работу с системой

Ссылка действительна в течение 7 дней.

---
Это автоматическое сообщение, не отвечайте на него.
© ${new Date().getFullYear()} ${APP_NAME}
  `;

  try {
    await transport.sendMail({
      from: `"${APP_NAME}" <${SMTP_FROM}>`,
      to: opts.to,
      subject: `Приглашение в ${APP_NAME}`,
      text,
      html,
    });
    logger.info(`Invite email sent to ${opts.to}`);
    return true;
  } catch (error) {
    logger.error("Failed to send invite email: " + (error as Error).message);
    logger.info("===========================================");
    logger.info("INVITE LINK (email send failed):");
    logger.info(`To: ${opts.to}`);
    logger.info(`Link: ${opts.inviteLink}`);
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