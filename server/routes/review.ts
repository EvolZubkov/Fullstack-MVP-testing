/**
 * @module routes/review
 * @description PRD-52 — API рецензирования теста: комментарии и их жизненный цикл.
 *
 * Доступ на ЧТЕНИЕ и на СОЗДАНИЕ комментария даёт `requireReviewScope` — грант
 * `review` на этом тесте или уже имеющийся edit-доступ. Роль здесь не проверяется
 * сознательно: внешний рецензент приходит по ссылке с ролью `learner`, и гейт по
 * capability закрыл бы дверь ровно перед той аудиторией, ради которой всё сделано.
 *
 * ЗАКРЫТИЕ ветки с исходом — наоборот, действие автора теста, поэтому оно идёт под
 * edit-скоупом. Рецензент видит уже проставленный исход, но поставить его не может:
 * «учтено» означает обещание правки, а правит тест автор.
 *
 * Правила ветки, которые держит этот роутер (FR-21..FR-25):
 *   - ответ ровно одного уровня: ответ на ответ отвергается;
 *   - исход живёт только на корне;
 *   - при отклонении в ветке обязан быть ответ — отказ без объяснения не проходит;
 *   - править и удалять можно только СВОЙ комментарий и только пока не ответили;
 *   - чужой комментарий не удаляет никто, включая владельца теста: история приёмки
 *     не должна редактироваться задним числом.
 */
import { Router, type Request, type Response } from "express";
import { config } from "../config";
import { requireUserContext, requirePermission } from "../middleware/auth";
import { respondWorkbookReadError, workbookUploadSingle } from "../middleware/upload";
import { requireReviewScope } from "../middleware/review-scope";
import { requireTestScope } from "../middleware/test-scope";
import { storage } from "../storage";
import { describeAnchor, isAnchorStale, isAnchorOrphaned } from "../services/review-anchor";
import { openRunSession, servePackageFile, closeRunSession } from "../scorm/debug-player/run-session";
import { inviteReviewers } from "../services/review-invite";
import {
  classifyParticipants,
  ParticipantsInviteError,
  parseParticipantsWorkbook,
} from "../services/participants-invite";
import {
  buildRecipientTemplateWorkbook,
  readGivenRows,
  recipientRefusalMessage,
} from "../services/recipient-list";
import { canGrantAccess } from "../services/test-access";
import { readShimJs, readInspectorComputeJs } from "../scorm/debug-player/assets";
import type { ReviewAnchor, ReviewAnchorKind } from "@shared/review/anchor";
import { audit, logger } from "../logger";

const router = Router();

/** Чтение и создание — по ревью-скоупу. */
const reviewGate = [requireUserContext, requireReviewScope()];
/** Исход ветки — по edit-скоупу теста. */
const resolveGate = [requirePermission("tests.edit"), requireTestScope("edit")];

const ANCHOR_KINDS: ReviewAnchorKind[] = [
  "question", "content-page", "topic", "start", "results", "test",
];

/** Предел длины комментария: поле ввода, а не документ. */
const BODY_MAX = 4000;

/** Разбирает якорь из запроса; `null` — якорь не задан или задан неверно. */
function parseAnchor(raw: unknown): ReviewAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const anchor = raw as Record<string, unknown>;
  const kind = anchor.kind;
  if (typeof kind !== "string" || !ANCHOR_KINDS.includes(kind as ReviewAnchorKind)) return null;
  return {
    kind: kind as ReviewAnchorKind,
    questionId: typeof anchor.questionId === "string" ? anchor.questionId : null,
    topicId: typeof anchor.topicId === "string" ? anchor.topicId : null,
    contentPageId: typeof anchor.contentPageId === "string" ? anchor.contentPageId : null,
  };
}

/** Якорь ветки — то, по чему считаются пометки устаревания и осиротелости. */
function anchorOf(row: {
  anchorKind: string; questionId: string | null; topicId: string | null; contentPageId: string | null;
}): ReviewAnchor {
  return {
    kind: row.anchorKind as ReviewAnchorKind,
    questionId: row.questionId,
    topicId: row.topicId,
    contentPageId: row.contentPageId,
  };
}

// GET /api/tests/:id/review/comments — ветки теста с пометками состояния якоря.
router.get("/:id/review/comments", ...reviewGate, async (req: Request, res: Response) => {
  try {
    const threads = await storage.listReviewThreads(req.params.id);

    // Имена авторов: комментарий подписан ЧЕЛОВЕКОМ, а не идентификатором. Читаются
    // одним проходом по участникам ветки — иначе на каждую строку ленты пришлось бы
    // по запросу, а веток на тесте бывают десятки.
    const authorIds = new Set<string>();
    for (const thread of threads) {
      authorIds.add(thread.authorId);
      for (const reply of thread.replies) authorIds.add(reply.authorId);
    }
    const names = new Map<string, string>();
    await Promise.all(
      [...authorIds].map(async (id) => {
        const user = await storage.getUser(id);
        if (user) names.set(id, user.name || user.email || "Участник");
      }),
    );
    const named = <T extends { authorId: string }>(row: T) => ({
      ...row,
      authorName: names.get(row.authorId) ?? null,
    });

    const decorated = await Promise.all(
      threads.map(async (thread) => {
        const anchor = anchorOf(thread);
        const [stale, orphaned] = await Promise.all([
          isAnchorStale(anchor, thread.pinnedContentHash),
          isAnchorOrphaned(anchor),
        ]);
        // `stale` и `orphaned` НЕ хранятся: это состояние теста на момент чтения,
        // а не свойство комментария. Записанные, они разошлись бы с содержимым при
        // первой же правке в обход панели.
        return { ...named(thread), replies: thread.replies.map(named), stale, orphaned };
      }),
    );
    res.json(decorated);
  } catch (error) {
    logger.error("Review comments read failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось прочитать комментарии" });
  }
});

// POST /api/tests/:id/review/comments — новый комментарий или ответ в ветке.
router.post("/:id/review/comments", ...reviewGate, async (req: Request, res: Response) => {
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) return res.status(400).json({ error: "Комментарий не может быть пустым" });
  if (body.length > BODY_MAX) return res.status(400).json({ error: "Комментарий слишком длинный" });

  const parentId = typeof req.body?.parentId === "string" ? req.body.parentId : null;
  try {
    if (parentId) {
      const parent = await storage.getReviewComment(parentId);
      if (!parent || parent.testId !== req.params.id) {
        return res.status(404).json({ error: "Комментарий не найден" });
      }
      if (parent.parentId) {
        return res.status(422).json({ error: "Ответить можно только на исходный комментарий" });
      }
      const created = await storage.createReviewComment({
        testId: req.params.id,
        authorId: req.currentUser!.id,
        parentId,
        body,
        // Ответ наследует якорь корня: он о том же месте, и своего якоря не имеет.
        anchorKind: parent.anchorKind,
        questionId: parent.questionId,
        topicId: parent.topicId,
        contentPageId: parent.contentPageId,
      });
      return res.status(201).json(created);
    }

    const anchor = parseAnchor(req.body?.anchor);
    if (!anchor) return res.status(400).json({ error: "Не указано место комментария" });
    const snapshot = await describeAnchor(anchor);
    const created = await storage.createReviewComment({
      testId: req.params.id,
      authorId: req.currentUser!.id,
      parentId: null,
      body,
      anchorKind: anchor.kind,
      questionId: anchor.questionId ?? null,
      topicId: anchor.topicId ?? null,
      contentPageId: anchor.contentPageId ?? null,
      contextLabel: snapshot.contextLabel,
      pinnedContentHash: snapshot.pinnedContentHash,
    });
    res.status(201).json(created);
  } catch (error) {
    logger.error("Review comment create failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось сохранить комментарий" });
  }
});

/**
 * Загружает комментарий этого теста и проверяет, что правит его АВТОР и что в ветке
 * ещё не отвечали. Возвращает `null`, если ответ уже отправлен вызывающему.
 */
async function loadOwnEditable(req: Request, res: Response) {
  const comment = await storage.getReviewComment(req.params.commentId);
  if (!comment || comment.testId !== req.params.id) {
    res.status(404).json({ error: "Комментарий не найден" });
    return null;
  }
  if (comment.authorId !== req.currentUser!.id) {
    res.status(403).json({ error: "Чужой комментарий" });
    return null;
  }
  if (await storage.hasReviewReplies(comment.id)) {
    res.status(409).json({ error: "В ветке уже есть ответ" });
    return null;
  }
  return comment;
}

// PATCH /api/tests/:id/review/comments/:commentId — правка собственного текста.
router.patch("/:id/review/comments/:commentId", ...reviewGate, async (req: Request, res: Response) => {
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) return res.status(400).json({ error: "Комментарий не может быть пустым" });
  try {
    if (!(await loadOwnEditable(req, res))) return;
    const updated = await storage.updateReviewCommentBody(req.params.commentId, body);
    res.json(updated);
  } catch (error) {
    logger.error("Review comment update failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось изменить комментарий" });
  }
});

// DELETE /api/tests/:id/review/comments/:commentId — удаление собственного.
router.delete("/:id/review/comments/:commentId", ...reviewGate, async (req: Request, res: Response) => {
  try {
    if (!(await loadOwnEditable(req, res))) return;
    res.json({ deleted: await storage.deleteReviewComment(req.params.commentId) });
  } catch (error) {
    logger.error("Review comment delete failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось удалить комментарий" });
  }
});

// POST /api/tests/:id/review/comments/:commentId/resolve — закрытие с исходом.
router.post("/:id/review/comments/:commentId/resolve", ...resolveGate, async (req: Request, res: Response) => {
  const status = req.body?.status;
  if (status !== "accepted" && status !== "rejected") {
    return res.status(400).json({ error: "Исход должен быть «учтено» или «отклонено»" });
  }
  try {
    const comment = await storage.getReviewComment(req.params.commentId);
    if (!comment || comment.testId !== req.params.id) {
      return res.status(404).json({ error: "Комментарий не найден" });
    }
    if (comment.parentId) {
      return res.status(422).json({ error: "Исход ставится на исходный комментарий, а не на ответ" });
    }
    if (status === "rejected" && !(await storage.hasReviewReplies(comment.id))) {
      // Отклонение без объяснения оставляет рецензента без ответа на вопрос
      // «почему»; ответ в ветке — и есть это объяснение.
      return res.status(422).json({ error: "При отклонении нужен ответ с объяснением" });
    }
    const resolved = await storage.resolveReviewComment(comment.id, {
      status,
      resolvedBy: req.currentUser!.id,
    });
    res.json(resolved);
  } catch (error) {
    logger.error("Review comment resolve failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось закрыть комментарий" });
  }
});

// POST /api/tests/:id/review/comments/:commentId/reopen — открыть заново.
router.post("/:id/review/comments/:commentId/reopen", ...resolveGate, async (req: Request, res: Response) => {
  try {
    const comment = await storage.getReviewComment(req.params.commentId);
    if (!comment || comment.testId !== req.params.id) {
      return res.status(404).json({ error: "Комментарий не найден" });
    }
    if (comment.parentId) {
      return res.status(422).json({ error: "Открыть заново можно исходный комментарий" });
    }
    res.json(await storage.reopenReviewComment(comment.id));
  } catch (error) {
    logger.error("Review comment reopen failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось открыть комментарий" });
  }
});

// ─── Прогон рецензирования ───────────────────────────────────────────────────
// Тот же движок, что у отладчика автора (PRD-18): живая сборка, телеметрия
// выключена, попытка не создаётся. Отличается только гейт — грант `review`.

// POST /api/tests/:id/review/session — собрать пакет и открыть прогон.
router.post("/:id/review/session", ...reviewGate, (req: Request, res: Response) =>
  openRunSession(req, res, "review"));

// GET /api/tests/:id/review/play/:token[/*] — раздача файлов пакета same-origin.
router.get("/:id/review/play/:token{/*splat}", ...reviewGate, servePackageFile);

// DELETE /api/tests/:id/review/session/:token — закрыть прогон.
router.delete("/:id/review/session/:token", ...reviewGate, closeRunSession);

// GET /api/tests/:id/review/shim.js — RTE-шим, который окно рецензента держит в
// СВОЁМ окне: SCO находит `API_1484_11` подъёмом по `window.parent`.
router.get("/:id/review/shim.js", ...reviewGate, (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.send(readShimJs());
});

// GET /api/tests/:id/review/inspector-compute.js — вычислительный слой инспектора.
router.get("/:id/review/inspector-compute.js", ...reviewGate, (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.send(readInspectorComputeJs());
});

// ─── Приглашение рецензентов ─────────────────────────────────────────────────

/** Сколько живёт ревью-ссылка, если срок не задан явно. */
const REVIEW_LINK_DAYS = 30;

/** Книга со списком рецензентов приходит тем же полем, что и книга участников. */
const reviewerListUpload = workbookUploadSingle("file");

/**
 * Гейт списка рецензентов: право `tests.review.invite` даёт действие в принципе,
 * `canGrantAccess` — на ЭТОТ тест (владелец; администратор — на любой).
 *
 * Одна пара на все четыре маршрута списка. Предпросмотр, шаблон и отметка о
 * выгрузке показывают и обслуживают ровно то, что делает приглашение, и прятать
 * их за другой дверью — значит однажды разойтись с ним в правах (PRD-52, 14).
 *
 * @returns `true`, если можно продолжать; иначе ответ уже отправлен.
 */
async function ensureInviteScope(req: Request, res: Response): Promise<boolean> {
  const test = await storage.getTest(req.params.id);
  if (!test) {
    res.status(404).json({ error: "Тест не найден" });
    return false;
  }
  if (!canGrantAccess(req.effectiveRoles ?? [], req.currentUser!.id, test)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// POST /api/tests/:id/review/preview — разбор списка рецензентов (FR-35).
// Книга или набранный вручную список — разбор и классификация те же, что у
// участников (PRD-28 раздел 16): общим остаётся конвейер, а не право.
router.post(
  "/:id/review/preview",
  requirePermission("tests.review.invite"),
  reviewerListUpload,
  async (req: Request, res: Response) => {
    try {
      if (!(await ensureInviteScope(req, res))) return;
      const rows = req.file
        ? await parseParticipantsWorkbook(req.file.buffer, {
          maxRows: config.limits.participantsImportMaxRows,
        })
        : readGivenRows(req.body?.rows, config.limits.participantsImportMaxRows);
      res.json(await classifyParticipants(rows, { testId: req.params.id, storage }));
    } catch (error) {
      if (respondWorkbookReadError(res, error)) return;
      if (error instanceof ParticipantsInviteError) {
        return res.status(400).json({ code: error.kind, error: recipientRefusalMessage(error) });
      }
      logger.error("Review preview failed: " + (error as Error).message, "review");
      res.status(500).json({ error: "Не удалось разобрать список" });
    }
  },
);

// GET /api/tests/:id/review/template — шаблон книги для списка рецензентов.
router.get(
  "/:id/review/template",
  requirePermission("tests.review.invite"),
  async (req: Request, res: Response) => {
    if (!(await ensureInviteScope(req, res))) return;
    const buf = await buildRecipientTemplateWorkbook();
    res.setHeader("Content-Disposition", "attachment; filename=participants-template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  },
);

// POST /api/tests/:id/review/links-exported — отметка о выгрузке ссылок.
// Ссылки сюда НЕ едут: файл собирается в браузере из отчёта, который он и так
// держит, — серверу сообщается только факт и число (PRD-28 FR-20).
router.post(
  "/:id/review/links-exported",
  requirePermission("tests.review.invite"),
  async (req: Request, res: Response) => {
    if (!(await ensureInviteScope(req, res))) return;
    const raw = Number(req.body?.count);
    audit.participantLinksExported(req.params.id, Number.isFinite(raw) ? raw : 0);
    res.status(204).end();
  },
);

// POST /api/tests/:id/review/invite — выдать грант `review` и разослать ссылки.
// Гейт — своё право звать рецензентов на ЭТОТ тест. Раньше здесь стояло
// `tests.access.grant`: выдать доступ руками и позвать рецензировать — разные
// действия, и второе не должно тянуть за собой первое (PRD-52 раздел 14).
router.post("/:id/review/invite", requirePermission("tests.review.invite"), async (req: Request, res: Response) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: "Некого приглашать" });
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Тест не найден" });
    if (!canGrantAccess(req.effectiveRoles ?? [], req.currentUser!.id, test)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const expiresAt = typeof req.body?.linkExpiresAt === "string"
      ? new Date(req.body.linkExpiresAt)
      : new Date(Date.now() + REVIEW_LINK_DAYS * 24 * 60 * 60 * 1000);

    const report = await inviteReviewers({
      testId: req.params.id,
      rows: rows
        .map((row: { email?: unknown; userId?: unknown; name?: unknown }) => ({
          email: typeof row.email === "string" ? row.email.trim().toLowerCase() : undefined,
          userId: typeof row.userId === "string" ? row.userId : undefined,
          name: typeof row.name === "string" ? row.name : null,
        }))
        // Строка без адреса И без выбранного пользователя приглашать некого.
        .filter((row: { email?: string; userId?: string }) =>
          Boolean(row.userId) || Boolean(row.email?.includes("@"))),
      actorId: req.currentUser!.id,
      linkExpiresAt: expiresAt,
      sendEmail: req.body?.sendEmail !== false,
      storage,
    });
    // Отчёт отдаётся в ФОРМЕ отчёта рассылки участников: вкладка «Списком из файла»
    // у обоих назначений одна, и второй формат заставил бы её ветвиться в разборе
    // ответа — там, где разницы по сути нет.
    res.json({
      created: report.results.filter((r) => r.accountCreated).length,
      reused: report.results.filter((r) => !r.accountCreated).length,
      assigned: report.invited,
      groupId: null,
      linksExpireAt: expiresAt.toISOString(),
      results: report.results.map((r) => ({
        email: r.email,
        name: null,
        status: r.accountCreated ? "new" : r.granted ? "external" : "assigned",
        magicLink: r.magicLink,
        delivered: r.delivered ?? false,
      })),
      failed: report.failed.map((f) => ({
        email: f.email,
        reason: f.reason,
        accountCreated: false,
        assignmentCreated: false,
      })),
    });
  } catch (error) {
    logger.error("Review invite failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось пригласить рецензентов" });
  }
});

// GET /api/tests/:id/review/reviewers — кто приглашён рецензировать этот тест.
// Показывается на первой вкладке диалога: приглашённые, а не участники прохождения.
router.get("/:id/review/reviewers", requirePermission("tests.access.grant"), async (req: Request, res: Response) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Тест не найден" });
    if (!canGrantAccess(req.effectiveRoles ?? [], req.currentUser!.id, test)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const grants = (await storage.getTestAccessGrants(req.params.id))
      .filter((grant) => grant.accessLevel === "review");
    const counts = await storage.listReviewThreads(req.params.id);

    const reviewers = await Promise.all(
      grants.map(async (grant) => {
        const user = await storage.getUser(grant.userId);
        return {
          userId: grant.userId,
          name: user?.name ?? null,
          email: user?.email ?? null,
          // Внешний участник заходит ТОЛЬКО по ссылке; штатный — своей учётной
          // записью, и ссылка ему нужна лишь как приглашение.
          external: Boolean(user?.isExternal),
          grantedAt: grant.createdAt,
          // Сколько этот человек уже написал — по нему видно, дошли ли руки.
          comments: counts.filter((thread) => thread.authorId === grant.userId).length,
        };
      }),
    );
    res.json(reviewers);
  } catch (error) {
    logger.error("Reviewers read failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось прочитать список рецензентов" });
  }
});

// DELETE /api/tests/:id/review/reviewers/:userId — отозвать доступ рецензента.
// Снимается и грант, и все живые ссылки: оставить ссылку значило бы оставить дверь
// открытой после отзыва. Комментарии человека остаются — это история приёмки.
router.delete("/:id/review/reviewers/:userId", requirePermission("tests.access.grant"), async (req: Request, res: Response) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Тест не найден" });
    if (!canGrantAccess(req.effectiveRoles ?? [], req.currentUser!.id, test)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const grant = await storage.getTestGrantForUser(req.params.id, req.params.userId);
    if (grant?.accessLevel === "review") {
      await storage.removeTestAccessGrant(req.params.id, req.params.userId);
    }
    await storage.revokeReviewLinks(req.params.id, req.params.userId);
    res.json({ revoked: true });
  } catch (error) {
    logger.error("Reviewer revoke failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось отозвать доступ" });
  }
});

export default router;
