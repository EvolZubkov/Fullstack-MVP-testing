import nodemailer from "nodemailer";
import { logger } from "./logger";
import { config, appBaseUrl } from "./config";
import { EMAIL_COLORS as C } from "./email-theme";

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

/**
 * Whether a one-time entry link (`/access/<token>`) may be written to the log.
 *
 * Never outside development. Such a link is a passwordless way into the account
 * it was minted for, and the log is exactly where the contents of an
 * undelivered letter end up: a bulk participant run (PRD-28) against a broken
 * transport would drop hundreds of WORKING keys into the file, each one next to
 * its recipient's address. The token stays valid on purpose (недоставка не
 * отменяет выпуск, раздел 6) — which is what makes the logged copy dangerous.
 *
 * Development is the exception on purpose: with SMTP switched off, the log is
 * the only way to lay hands on a link by hand. The check names development
 * explicitly rather than negating production — the same shape as the reset
 * `devLink` in `server/routes/auth.ts` — so an environment that forgot to
 * declare itself is treated as the strict one.
 */
function mayLogEntryLink(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Box of the call-to-action button (everything but its text colour), shared by
 * the `<style>` rule and the inline `style` attribute below.
 */
const BUTTON_BOX =
  `display: inline-block; background: ${C.accent}; ` +
  "padding: 14px 36px; margin: 20px 0; text-decoration: none; border-radius: 6px; " +
  "font-family: Arial, sans-serif; font-size: 16px; font-weight: 600; line-height: 1.2;";

/** Text colour of the button, always `!important` — see {@link ctaButton}. */
const BUTTON_TEXT_COLOR = `color: ${C.accentText} !important;`;

/** `.button` rule for the letters' `<style>` block (a fallback only). */
const BUTTON_CSS = `.button { ${BUTTON_BOX} ${BUTTON_TEXT_COLOR} }`;

/**
 * Render the call-to-action button of a letter.
 *
 * Mail clients (Gmail, Outlook.com, most mobile readers) apply their own link
 * colour to `<a>` and it beats a class rule from `<style>` — the label used to
 * come out accent-on-accent, i.e. unreadable. So the colour is repeated three
 * times over: inline on the anchor, `!important` (inline `!important` outranks
 * the client's stylesheet), and once more on an inner `<span>` for the clients
 * that restyle the anchor but leave its children alone. The `.button` class
 * stays for readers that keep the `<style>` block intact.
 *
 * @param href Absolute URL the button opens.
 * @param label Visible button text.
 * @returns HTML of a single anchor element.
 */
function ctaButton(href: string, label: string): string {
  return (
    `<a href="${href}" class="button" style="${BUTTON_BOX} ${BUTTON_TEXT_COLOR}">` +
    `<span style="${BUTTON_TEXT_COLOR} text-decoration: none;">${label}</span>` +
    "</a>"
  );
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
    body { font-family: Arial, sans-serif; line-height: 1.6; color: ${C.fg}; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${C.accent}; color: ${C.accentText}; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: ${C.page}; padding: 30px; border-radius: 0 0 8px 8px; }
    ${BUTTON_CSS}
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: ${C.fgMuted}; }
    .warning { background: ${C.warningSoft}; border: 1px solid ${C.warning}; padding: 10px; border-radius: 4px; margin-top: 20px; font-size: 14px; }
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
        ${ctaButton(resetLink, "Сбросить пароль")}
      </p>
      <p>Или скопируйте эту ссылку в браузер:</p>
      <p style="word-break: break-all; background: ${C.sunken}; padding: 10px; border-radius: 4px; font-size: 14px;">
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
  /** The assigned test, used for the fallback address when no link is minted. */
  testId: string;
  testTitle: string;
  testDescription?: string | null;
  dueDate?: Date | null;
  /**
   * The one-time passwordless entry link (`/access/<token>`). Omitted when the
   * recipient holds any role other than `learner` (see
   * `mayReceiveAssignmentLink`, PLAN_MAGIC_LINK_SCOPE.md Этап 3): such an
   * account must never receive a password-free entry link, so the letter falls
   * back to an ordinary link and says nothing about why the quick link is
   * absent (no mention of roles/permissions — an e-mail gets forwarded,
   * spelling out the protection in it is pointless disclosure).
   */
  magicLink?: string;
}): Promise<boolean> {
  const transport = getTransporter();
  const APP_NAME = appName();
  const SMTP_FROM = fromAddress();

  const dueDateStr = opts.dueDate
    ? opts.dueDate.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
    : null;

  // No magic link was minted for this recipient: point at the TEST itself
  // (PRD-28 раздел 6) rather than the general login page — the recipient signs
  // in with their own password and lands on the assigned test instead of the
  // cabinet. `ctaHref` is never a token in this branch.
  const hasMagicLink = Boolean(opts.magicLink);
  const ctaHref = opts.magicLink ?? `${appBaseUrl()}/learner/test/${opts.testId}`;

  /**
   * Record a letter that did not go out, in the two ways it can fail to.
   *
   * The recipient and the test are always written — that is what makes the
   * failure actionable. The destination is written only when it is not a
   * one-time key: the fallback `/learner/test/<id>` address is public, while a
   * `/access/<token>` link is written in development only
   * ({@link mayLogEntryLink}).
   *
   * @param why Short reason, printed in the header line.
   */
  const logUndelivered = (why: string): void => {
    logger.info("===========================================");
    logger.info(`ASSIGNMENT MAGIC LINK (${why}):`);
    logger.info(`Test: ${opts.testTitle}`);
    logger.info(`To: ${opts.to}`);
    if (!hasMagicLink) logger.info(`Login required: ${ctaHref}`);
    else if (mayLogEntryLink()) logger.info(`Link: ${ctaHref}`);
    logger.info("===========================================");
  };

  if (!transport) {
    logUndelivered("SMTP not configured");
    return false;
  }

  // The call-to-action block: unchanged (byte-for-byte) when a magic link was
  // minted; falls back to a plain login CTA otherwise, with no hint of why.
  const ctaHtmlBlock = hasMagicLink
    ? `<p>Для прохождения теста нажмите на кнопку ниже — вход произойдёт автоматически, пароль не требуется:</p>
      <p style="text-align: center;">
        ${ctaButton(ctaHref, "Пройти тест")}
      </p>
      <p style="font-size:13px;color:${C.fgMuted};">Или скопируйте ссылку в браузер:</p>
      <p style="word-break: break-all; background: ${C.sunken}; padding: 10px; border-radius: 4px; font-size: 13px;">
        ${ctaHref}
      </p>
      <div class="warning">
        ⚠️ Ссылка персональная — не передавайте её другим людям.${dueDateStr ? ` Ссылка действительна до ${dueDateStr}.` : ""}
      </div>`
    : `<p>Для прохождения теста нажмите на кнопку ниже:</p>
      <p style="text-align: center;">
        ${ctaButton(ctaHref, "Войти и пройти тест")}
      </p>
      <p style="font-size:13px;color:${C.fgMuted};">После входа откроется страница теста.</p>`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: ${C.fg}; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${C.accent}; color: ${C.accentText}; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: ${C.page}; padding: 30px; border-radius: 0 0 8px 8px; }
    ${BUTTON_CSS}
    .meta { background: ${C.sunken}; border-radius: 6px; padding: 14px 18px; margin: 16px 0; font-size: 14px; }
    .meta p { margin: 4px 0; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: ${C.fgMuted}; }
    .warning { background: ${C.warningSoft}; border: 1px solid ${C.warning}; padding: 10px; border-radius: 4px; margin-top: 20px; font-size: 13px; }
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
    : `Для прохождения теста перейдите по ссылке:
${ctaHref}

После входа откроется страница теста.`;

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
    logUndelivered("email send failed");
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
    body { font-family: Arial, sans-serif; line-height: 1.6; color: ${C.fg}; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${C.accent}; color: ${C.accentText}; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: ${C.page}; padding: 30px; border-radius: 0 0 8px 8px; }
    ${BUTTON_CSS}
    .steps { background: ${C.accentSoft}; border-radius: 6px; padding: 16px 20px; margin: 16px 0; }
    .steps ol { margin: 8px 0; padding-left: 20px; }
    .steps li { margin: 6px 0; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: ${C.fgMuted}; }
    .warning { background: ${C.warningSoft}; border: 1px solid ${C.warning}; padding: 10px; border-radius: 4px; margin-top: 20px; font-size: 13px; }
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
        ${ctaButton(opts.inviteLink, "Активировать аккаунт")}
      </p>
      <div class="steps">
        <strong>Что нужно сделать:</strong>
        <ol>
          <li>Нажмите кнопку «Активировать аккаунт»</li>
          <li>Придумайте и введите пароль</li>
          <li>Начните работу с системой</li>
        </ol>
      </div>
      <p style="font-size:13px;color:${C.fgMuted};">Или скопируйте ссылку в браузер:</p>
      <p style="word-break: break-all; background: ${C.sunken}; padding: 10px; border-radius: 4px; font-size: 13px;">
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